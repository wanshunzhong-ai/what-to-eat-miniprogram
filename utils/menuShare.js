// utils/menuShare.js
// 「点菜清单」的导出与分享：
//   - buildText   → 纯文本清单（复制到剪贴板 / 发群里）
//   - encode/decode → 压进分享链接，朋友点开就能看到这一桌
//   - drawCard    → 画成一张清单图（存相册 / 当分享封面）
//
// 分享链接刻意只带「人数 / 餐次 / 城市 / 菜名」，不带明细：
// 菜名之外的信息（做法、用量）在对方设备上按菜品库重新查得到，
// 这样链接足够短，不会撞到小程序 path 长度上限。

const MAX_DISHES_IN_LINK = 24;

const MEAL_LABEL = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  midnight: '夜宵',
  snack: '加餐'
};

function mealLabel(meal) {
  return MEAL_LABEL[meal] || '';
}

// ------------------------------------------------------------------ 文本

/** 生成纯文本清单，用于复制和分享标题 */
function buildText(result) {
  if (!result || !result.dishes || !result.dishes.length) return '';

  const city = (result.city && result.city.name) || '';
  const lines = [];
  lines.push('【今天吃什么】点菜清单');
  lines.push(
    result.people + ' 人 · ' + (result.mealLabel || '一餐') + (city ? ' · ' + city : '')
  );
  lines.push(
    '共 ' + (result.count || result.dishes.length) + ' 道' +
    (result.totalTime ? '，最费时的一道约 ' + result.totalTime + ' 分钟' : '')
  );

  const byCat = groupByCategory(result.dishes);
  byCat.forEach(function (g) {
    lines.push('');
    lines.push('◆ ' + g.category + '（' + g.list.length + '）');
    g.list.forEach(function (d, i) {
      lines.push('  ' + (i + 1) + '. ' + (d.emoji || '') + d.name);
    });
  });

  if (result.menuText) {
    lines.push('');
    lines.push('配比：' + result.menuText);
  }
  if (result.menuTip) lines.push('提示：' + result.menuTip);
  lines.push('');
  lines.push('—— 来自小程序「今天吃什么」');

  return lines.join('\n');
}

/** 按菜品分类分组，尽量按「凉菜 → 热菜 → 汤 → 主食」的顺序 */
const CAT_ORDER = [
  '凉菜', '热菜', '荤', '素', '荤菜', '素菜', '火锅', '轻食',
  '汤', '主食', '小吃', '饮品', '甜品'
];

function groupByCategory(dishes) {
  const map = {};
  const order = [];
  dishes.forEach(function (d) {
    const c = d.category || '其它';
    if (!map[c]) {
      map[c] = [];
      order.push(c);
    }
    map[c].push(d);
  });
  order.sort(function (a, b) {
    const ia = CAT_ORDER.indexOf(a);
    const ib = CAT_ORDER.indexOf(b);
    if (ia < 0 && ib < 0) return 0;
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
  return order.map(function (c) {
    return { category: c, list: map[c] };
  });
}

/** 分享用的一句话标题 */
function buildShareTitle(result) {
  if (!result || !result.dishes || !result.dishes.length) return '今天吃什么？我帮你决定';
  const names = result.dishes.map(function (d) { return d.name; });
  const head = result.people + '人' + (result.mealLabel || '一餐') + '，我点了：';
  return (head + names.join('、')).slice(0, 60);
}

// ------------------------------------------------------------------ 链接编解码

/** 把一桌菜压成短字符串（配合分享 path 使用） */
function encode(result) {
  if (!result || !result.dishes || !result.dishes.length) return '';
  const head = [
    'v1',
    result.people || 2,
    result.meal || '',
    (result.city && result.city.name) || '',
    result.mealLabel || ''
  ].join('~');

  const dishes = result.dishes.slice(0, MAX_DISHES_IN_LINK).map(function (d) {
    return (d.emoji || '') + ' ' + d.name;
  });

  return head + '|' + dishes.join('|');
}

/** 解开分享链接里的那一桌菜；解不开返回 null */
function decode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split('|');
  const head = (parts.shift() || '').split('~');
  if (head[0] !== 'v1') return null;

  const people = Number(head[1]) || 2;
  const meal = head[2] || '';
  const cityName = head[3] || '';
  const label = head[4] || mealLabel(meal) || '一餐';

  const dishes = parts.filter(function (s) { return s; }).map(function (s, i) {
    const sp = s.indexOf(' ');
    const emoji = sp > 0 ? s.slice(0, sp) : '🍽️';
    const name = sp > 0 ? s.slice(sp + 1) : s;
    return { id: 'shared_' + i, emoji: emoji, name: name, category: '' };
  });

  if (!dishes.length) return null;

  return {
    people: people,
    meal: meal,
    mealLabel: label,
    city: { name: cityName, province: '', cuisine: '' },
    count: dishes.length,
    dishes: dishes,
    shared: true,
    source: 'shared'
  };
}

// ------------------------------------------------------------------ 画成图片

const CARD_W = 620;
const PAD = 40;
const HEAD_H = 196;
const ROW_H = 56;
const FOOT_H = 172;

function cardSize(result) {
  const n = Math.max(1, (result.dishes || []).length);
  return { w: CARD_W, h: HEAD_H + n * ROW_H + FOOT_H };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 文本超宽时截断加省略号 */
function clip(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) {
    s = s.slice(0, -1);
  }
  return s + '…';
}

/**
 * 把清单画到 canvas 上。
 * @param {Object} canvas 页面里 <canvas type="2d"> 的 node
 * @param {Object} result 推荐结果
 * @param {Number} dpr   设备像素比
 * @returns {{w:Number,h:Number}} 逻辑尺寸
 */
function drawCard(canvas, result, dpr) {
  const size = cardSize(result);
  const scale = dpr || 2;

  canvas.width = size.w * scale;
  canvas.height = size.h * scale;

  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // 底
  ctx.fillStyle = '#F5F6F7';
  ctx.fillRect(0, 0, size.w, size.h);
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, 14, 14, size.w - 28, size.h - 28, 26);
  ctx.fill();

  // 顶部色块
  ctx.save();
  roundRect(ctx, 14, 14, size.w - 28, HEAD_H - 20, 26);
  ctx.clip();
  ctx.fillStyle = '#F26B3A';
  ctx.fillRect(14, 14, size.w - 28, HEAD_H - 20);
  ctx.restore();

  const left = PAD;
  const rightEdge = size.w - PAD;

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 34px sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('今天吃什么 · 点菜清单', left, 78);

  ctx.font = '24px sans-serif';
  const cityName = (result.city && result.city.name) || '';
  const sub = result.people + ' 人 · ' + (result.mealLabel || '一餐') + (cityName ? ' · ' + cityName : '');
  ctx.fillText(sub, left, 118);

  ctx.font = '22px sans-serif';
  ctx.globalAlpha = 0.92;
  ctx.fillText(
    '共 ' + (result.count || result.dishes.length) + ' 道' +
    (result.totalTime ? ' · 最费时约 ' + result.totalTime + ' 分钟' : ''),
    left,
    152
  );
  ctx.globalAlpha = 1;

  // 菜名列表
  let y = HEAD_H + 26;
  const groups = groupByCategory(result.dishes);
  const numW = 34;
  const nameX = left + numW;
  const catW = 96;

  groups.forEach(function (g) {
    // 分类小标题
    ctx.fillStyle = '#C2410C';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(g.category, left, y);
    y += ROW_H - 12;

    g.list.forEach(function (d) {
      ctx.fillStyle = '#17191C';
      ctx.font = '25px sans-serif';
      const nameMax = rightEdge - nameX - catW - 84;
      ctx.fillText(clip(ctx, d.name, nameMax), nameX, y);

      if (d.category) {
        ctx.fillStyle = '#ADB5BD';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(d.category, rightEdge, y);
        ctx.textAlign = 'left';
      }

      // 虚线分隔
      ctx.strokeStyle = '#EAEDF0';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(left, y + 16);
      ctx.lineTo(rightEdge, y + 16);
      ctx.stroke();
      ctx.setLineDash([]);

      y += ROW_H;
    });
  });

  // 底部：配比 + 落款
  const footY = size.h - FOOT_H + 20;
  ctx.fillStyle = '#F5F6F7';
  roundRect(ctx, left - 12, footY - 24, size.w - 2 * (left - 12), FOOT_H - 44, 16);
  ctx.fill();

  ctx.fillStyle = '#868E96';
  ctx.font = '22px sans-serif';
  if (result.menuText) {
    ctx.fillText(clip(ctx, '配比：' + result.menuText, size.w - 2 * left), left, footY + 14);
  }
  if (result.menuTip) {
    ctx.fillText(clip(ctx, result.menuTip, size.w - 2 * left), left, footY + 50);
  }

  ctx.fillStyle = '#F26B3A';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('微信小程序「今天吃什么」', left, footY + 92);

  return size;
}

/**
 * 在指定页面的 canvas 上画好清单，并导出成临时图片路径。
 * @param {Object} page     页面实例（this）
 * @param {String} canvasId <canvas type="2d"> 的 id
 * @param {Object} result   推荐结果
 * @returns {Promise<String>} 图片临时路径
 */
function exportCard(page, canvasId, result) {
  return new Promise(function (resolve, reject) {
    if (!wx.createSelectorQuery) {
      reject(new Error('当前环境不支持画布导出'));
      return;
    }
    wx.createSelectorQuery().in(page).select('#' + canvasId)
      .fields({ node: true, size: true })
      .exec(function (res) {
        const node = res && res[0] && res[0].node;
        if (!node) {
          reject(new Error('画布没准备好'));
          return;
        }
        let dpr = 2;
        try {
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          dpr = (info && info.pixelRatio) || 2;
        } catch (e) {}

        try {
          drawCard(node, result, dpr);
        } catch (e) {
          reject(new Error((e && e.message) || '绘制失败'));
          return;
        }

        wx.canvasToTempFilePath({
          canvas: node,
          fileType: 'png',
          success(r) { resolve(r.tempFilePath); },
          fail(e) { reject(new Error((e && e.errMsg) || '导出失败')); }
        });
      });
  });
}

module.exports = {
  buildText: buildText,
  buildShareTitle: buildShareTitle,
  encode: encode,
  decode: decode,
  drawCard: drawCard,
  cardSize: cardSize,
  exportCard: exportCard,
  groupByCategory: groupByCategory
};
