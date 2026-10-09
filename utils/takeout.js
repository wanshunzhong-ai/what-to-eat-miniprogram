// utils/takeout.js
// 「点外卖」这条分支的筛选与推荐规则。
//
// 职责：
//   1) 定义品类（每个品类对应一个搜索关键词 + 参考人均区间）
//   2) 定义预算档位
//   3) 把店铺原始数据（腾讯位置服务返回）归一化成可直接渲染的视图对象
//   4) 按「人数 + 预算」给店铺打分排序，并给出「为什么推荐它」的理由
//
// 说明：地图接口不返回价格，所以「参考人均」是按品类给出的经验区间，属于估算，
//      页面上以「参考人均」字样标注，避免误导。

// ---------------------------------------------------------------- 品类

/**
 * 外卖品类。
 * keyword 用于腾讯位置服务周边搜索（空字符串表示不限品类，走美食大类）。
 * perHead 是该品类的参考人均区间（元），[0, 0] 表示不做估算。
 */
const CATEGORIES = [
  { key: 'all',       label: '全部',     emoji: '🍽️', keyword: '',         perHead: [0, 0] },
  { key: 'breakfast', label: '早餐',     emoji: '🥣', keyword: '早餐',     perHead: [8, 25] },
  { key: 'fastfood',  label: '快餐简餐', emoji: '🍱', keyword: '快餐',     perHead: [15, 35] },
  { key: 'noodle',    label: '面食米线', emoji: '🍜', keyword: '面馆',     perHead: [12, 35] },
  { key: 'rice',      label: '盖饭套餐', emoji: '🍚', keyword: '盖饭',     perHead: [15, 35] },
  { key: 'snack',     label: '小吃',     emoji: '🍢', keyword: '小吃',     perHead: [10, 30] },
  { key: 'stirfry',   label: '家常炒菜', emoji: '🥘', keyword: '炒菜',     perHead: [30, 80] },
  { key: 'hotpot',    label: '火锅',     emoji: '🍲', keyword: '火锅',     perHead: [60, 150] },
  { key: 'bbq',       label: '烧烤烤肉', emoji: '🍖', keyword: '烧烤',     perHead: [40, 120] },
  { key: 'dessert',   label: '甜品饮品', emoji: '🍰', keyword: '甜品',     perHead: [10, 30] },
  { key: 'west',      label: '西餐',     emoji: '🍝', keyword: '西餐',     perHead: [50, 160] },
  { key: 'japan',     label: '日料',     emoji: '🍣', keyword: '日本料理', perHead: [60, 200] },
  { key: 'korea',     label: '韩餐',     emoji: '🥓', keyword: '韩国料理', perHead: [50, 140] }
];

/** 兜底品类：识别不出时用它（不参与「推荐」加权，只做展示） */
const FALLBACK_CAT = { key: 'other', label: '餐馆', emoji: '🍴', keyword: '', perHead: [20, 60] };

const CAT_MAP = (function () {
  const m = {};
  CATEGORIES.forEach(function (c) { m[c.key] = c; });
  m[FALLBACK_CAT.key] = FALLBACK_CAT;
  return m;
})();

/** 品类顺位：越靠前越先匹配（先具体后宽泛，避免「快餐」抢走「火锅」） */
const CAT_RULES = [
  { key: 'hotpot',  words: ['火锅', '串串', '麻辣烫', '冒菜', '涮锅', '干锅'] },
  { key: 'japan',   words: ['日本料理', '日式', '日料', '寿司', '居酒屋', '烧鸟', '和食', '刺身', '料理'] },
  { key: 'korea',   words: ['韩国料理', '韩式', '韩餐', '部队锅', '泡菜', '烤肉店'] },
  { key: 'bbq',     words: ['烧烤', '烤串', '烤鱼', '烤肉', '烧肉', '串吧', '大排档'] },
  { key: 'west',    words: ['西餐', '牛排', '意面', '意大利', '披萨', '汉堡', 'pizza', '西式', '轻食', '沙拉'] },
  { key: 'dessert', words: ['甜品', '甜点', '奶茶', '茶饮', '饮品', '蛋糕', '冰淇淋', '面包', '烘焙', '咖啡'] },
  { key: 'breakfast', words: ['早餐', '早点', '包子', '豆浆', '油条', '粥铺', '肠粉'] },
  { key: 'noodle',  words: ['面馆', '面条', '拉面', '米线', '米粉', '螺蛳粉', '馄饨', '饺子', '刀削面', '牛肉面'] },
  { key: 'rice',    words: ['盖饭', '快餐', '便当', '煲仔', '炒饭', '黄焖', '猪脚饭', '套餐'] },
  { key: 'snack',   words: ['小吃', '炸鸡', '炸串', '炸物', '卤味', '煎饼', '凉皮', '肉夹馍', '夜宵', '鸡排'] },
  { key: 'stirfry', words: ['家常', '炒菜', '小炒', '川菜', '湘菜', '粤菜', '鲁菜', '江浙菜', '徽菜', '私房菜', '饭店', '酒楼', '餐厅'] }
];

// ---------------------------------------------------------------- 预算

/** 人均预算档位（元）；min/max 为 0 表示不限 */
const BUDGETS = [
  { key: 'any',   label: '不限',      min: 0,   max: 0 },
  { key: 'b20',   label: '20 元内',   min: 0,   max: 20 },
  { key: 'b50',   label: '20-50 元',  min: 20,  max: 50 },
  { key: 'b100',  label: '50-100 元', min: 50,  max: 100 },
  { key: 'b100p', label: '100 元以上', min: 100, max: 99999 }
];

/** 取预算区间，'any' 或非法值返回 null（表示不限） */
function budgetRange(key) {
  if (!key || key === 'any') return null;
  const b = BUDGETS.filter(function (x) { return x.key === key; })[0];
  if (!b || (b.min === 0 && b.max === 0)) return null;
  return { min: b.min, max: b.max };
}

// ---------------------------------------------------------------- 人数偏好

/**
 * 按人数给出「适合的品类」优先序列。
 * 一个人吃更适合单份快餐，人多更适合围桌的火锅 / 烤肉 / 炒菜。
 */
function preferredCats(people) {
  const p = Number(people) || 1;
  if (p <= 1) return ['fastfood', 'noodle', 'rice', 'snack', 'breakfast', 'dessert'];
  if (p === 2) return ['stirfry', 'noodle', 'fastfood', 'rice', 'bbq', 'hotpot', 'west'];
  if (p <= 4) return ['stirfry', 'hotpot', 'bbq', 'rice', 'noodle', 'korea', 'japan'];
  return ['hotpot', 'bbq', 'stirfry', 'korea', 'japan', 'west'];
}

// ---------------------------------------------------------------- 归一化

/** 从店铺名称 + 原始分类里推断我们自己的品类 */
function inferCat(shop) {
  const text = ((shop && shop.name) || '') + ' ' + ((shop && shop.category) || '');
  if (!text.trim()) return FALLBACK_CAT.key;
  const lower = text.toLowerCase();
  for (let i = 0; i < CAT_RULES.length; i++) {
    const rule = CAT_RULES[i];
    for (let j = 0; j < rule.words.length; j++) {
      const w = rule.words[j];
      if (lower.indexOf(w.toLowerCase()) >= 0) return rule.key;
    }
  }
  return FALLBACK_CAT.key;
}

/** 品类元信息（含兜底） */
function catInfo(key) {
  return CAT_MAP[key] || FALLBACK_CAT;
}

/** 距离文案：1 公里以内用米，否则用公里 */
function formatDistance(m) {
  if (typeof m !== 'number' || !isFinite(m) || m < 0) return '';
  if (m < 1000) return '约 ' + Math.round(m) + ' 米';
  return '约 ' + (Math.round(m / 100) / 10).toFixed(1) + ' 公里';
}

/** 参考人均文案 */
function perHeadText(key) {
  const ph = catInfo(key).perHead;
  if (!ph || !ph[1]) return '';
  return '¥' + ph[0] + '-' + ph[1];
}

// ---------------------------------------------------------------- 打分

/**
 * 给一家店打分：品类是否符合人数、参考人均是否落在预算内。
 * 只做排序权重，不直接决定留存（结果太少时仍会展示）。
 */
function scoreShop(catKey, query) {
  const q = query || {};
  let score = 0;

  // 人数适配：命中的品类越靠前得分越高
  const prefs = preferredCats(q.people);
  const idx = prefs.indexOf(catKey);
  if (idx >= 0) score += (prefs.length - idx) * 10;

  // 预算适配：参考人均与预算区间有重叠 → 加分；完全不沾边 → 减分
  const b = budgetRange(q.budget);
  if (b) {
    const ph = catInfo(catKey).perHead;
    if (ph && ph[1] > 0) {
      const overlap = Math.min(ph[1], b.max) - Math.max(ph[0], b.min);
      score += overlap > 0 ? 18 : -22;
    }
  }
  return score;
}

/** 「为什么推荐它」的一句话理由；不合适时返回空串（不显示） */
function recommendReason(catKey, query) {
  const q = query || {};
  const p = Number(q.people) || 1;
  const prefs = preferredCats(p);
  if (prefs.indexOf(catKey) < 0) return '';

  let why;
  if (p <= 1) why = '一个人吃刚好';
  else if (p >= 5) {
    why = (catKey === 'hotpot' || catKey === 'bbq' || catKey === 'stirfry') ? '人多适合围桌吃' : '人多可以多来几份';
  } else {
    why = '适合 ' + p + ' 个人';
  }

  const ph = catInfo(catKey).perHead;
  if (ph && ph[1] > 0) why += ' · 参考人均 ¥' + ph[0] + '-' + ph[1];
  return why;
}

// ---------------------------------------------------------------- 视图构建

/**
 * 把一家原始店铺转成页面直接可用的对象
 * @param {Object} shop  云函数返回的店铺 { id,name,address,tel,category,distanceM,lat,lng,adname }
 * @param {Object} query { people, budget }
 * @param {Function} [isFav] (id) => boolean
 */
function decorateShop(shop, query, isFav) {
  const catKey = inferCat(shop);
  const cat = catInfo(catKey);
  return {
    id: shop.id,
    name: shop.name,
    address: shop.address || '',
    tel: shop.tel || '',
    region: shop.adname || '',
    category: shop.category || '',
    catKey: catKey,
    catLabel: cat.label,
    catEmoji: cat.emoji,
    distanceM: shop.distanceM,
    distanceText: formatDistance(shop.distanceM),
    perHeadText: perHeadText(catKey),
    lat: shop.lat,
    lng: shop.lng,
    recommendReason: recommendReason(catKey, query),
    faved: isFav ? !!isFav(shop.id) : false
  };
}

/**
 * 排序 + 装饰。返回 { list, droppedCount }
 * 只有当「预算不符」的店铺多于 5 家时才会把它们裁掉，保证结果不会太少。
 */
function rankAndDecorate(list, query, isFav) {
  const arr = (list || []).map(function (shop) {
    return { shop: shop, catKey: inferCat(shop), score: scoreShop(inferCat(shop), query) };
  });

  arr.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    const da = typeof a.shop.distanceM === 'number' ? a.shop.distanceM : 9e9;
    const db = typeof b.shop.distanceM === 'number' ? b.shop.distanceM : 9e9;
    return da - db;
  });

  // 预算明确时，把「明显超预算/远低于预算」的排在后面；若这类太多则直接剔除
  const b = budgetRange(query && query.budget);
  let kept = arr;
  let droppedCount = 0;
  if (b) {
    const bad = arr.filter(function (x) {
      const ph = catInfo(x.catKey).perHead;
      if (!ph || !ph[1]) return false;
      return Math.min(ph[1], b.max) - Math.max(ph[0], b.min) <= 0;
    });
    if (bad.length > 5 && arr.length - bad.length >= 5) {
      kept = arr.filter(function (x) { return bad.indexOf(x) < 0; });
      droppedCount = bad.length;
    }
  }

  return {
    list: kept.map(function (x) { return decorateShop(x.shop, query, isFav); }),
    droppedCount: droppedCount
  };
}

module.exports = {
  CATEGORIES: CATEGORIES,
  BUDGETS: BUDGETS,
  FALLBACK_CAT: FALLBACK_CAT,
  budgetRange: budgetRange,
  preferredCats: preferredCats,
  inferCat: inferCat,
  catInfo: catInfo,
  formatDistance: formatDistance,
  perHeadText: perHeadText,
  scoreShop: scoreShop,
  recommendReason: recommendReason,
  decorateShop: decorateShop,
  rankAndDecorate: rankAndDecorate
};
