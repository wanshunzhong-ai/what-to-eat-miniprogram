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

// ---------------------------------------------------------------- 配送估算
//
// ⚠️ 说明：地图接口（腾讯位置服务 / OpenStreetMap）**不返回**起送价、配送费、时效和评分，
//    这些字段只有美团 / 饿了么的开放平台才有。所以这里做的是「近似版」：
//      - 先按店铺品类给出一个合理区间，再用店铺 id 的稳定哈希在区间里取值
//        → 同一家店每次打开看到的数字都一样，不会乱跳；
//      - 页面上统一以「约 / 估」标注，并在列表顶部注明这不是平台报价。
//    想换成真实数据，只需在 decorateShop 里用平台返回值覆盖这几个字段即可。

/** 各品类的配送画像：起送价区间[最低,最高]、配送半径(米)、出餐准备(分钟) */
const DELIVERY_PROFILE = {
  breakfast: { minOrder: [12, 20], radius: 2500, prep: 12 },
  fastfood:  { minOrder: [15, 25], radius: 3000, prep: 15 },
  noodle:    { minOrder: [15, 25], radius: 3000, prep: 15 },
  rice:      { minOrder: [15, 25], radius: 3000, prep: 15 },
  snack:     { minOrder: [12, 22], radius: 2500, prep: 12 },
  stirfry:   { minOrder: [30, 50], radius: 4000, prep: 25 },
  hotpot:    { minOrder: [50, 90], radius: 5000, prep: 35 },
  bbq:       { minOrder: [40, 70], radius: 4500, prep: 30 },
  dessert:   { minOrder: [12, 20], radius: 2500, prep: 12 },
  west:      { minOrder: [40, 70], radius: 4500, prep: 28 },
  japan:     { minOrder: [50, 90], radius: 4500, prep: 30 },
  korea:     { minOrder: [45, 80], radius: 4500, prep: 30 },
  other:     { minOrder: [20, 40], radius: 3000, prep: 20 }
};

/** 品类热度基准（0~1），只用来让「人气参考」有点区分度，不代表真实销量 */
const CAT_HEAT = {
  fastfood: 0.9, noodle: 0.88, rice: 0.88, snack: 0.85, breakfast: 0.8,
  hotpot: 0.92, bbq: 0.9, stirfry: 0.82, dessert: 0.8,
  west: 0.6, japan: 0.62, korea: 0.6, other: 0.6
};

/** 字符串 → 稳定正整数（同一家店永远得到同一个种子） */
function seedOf(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 在 [lo, hi] 里按种子取一个整数 */
function pickInt(lo, hi, seed, salt) {
  if (hi <= lo) return lo;
  return lo + ((seed + salt * 7919) % (hi - lo + 1));
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * 估算一家店的配送信息。
 * 数据来自品类经验值 + 距离，**不是**平台真实报价，页面需如实标注。
 * @param {Object} shop   { id, distanceM, tel, address }
 * @param {String} catKey 品类 key
 */
function deliveryEstimate(shop, catKey) {
  const p = DELIVERY_PROFILE[catKey] || DELIVERY_PROFILE.other;
  const seed = seedOf((shop && shop.id) || (shop && shop.name) || 'x');
  const dist = (typeof shop.distanceM === 'number' && isFinite(shop.distanceM)) ? shop.distanceM : null;

  // 起送价：品类区间内取整到 5 的倍数，看起来更像真实定价
  const rawMin = pickInt(p.minOrder[0], p.minOrder[1], seed, 1);
  const minOrder = Math.max(10, Math.round(rawMin / 5) * 5);

  // 配送费：起步 2~4 元，每超 1 公里加 1 元
  const base = pickInt(2, 4, seed, 2);
  const extraKm = dist === null ? 0 : Math.max(0, Math.ceil((dist - 1000) / 1000));
  const deliveryFee = clamp(base + extraKm, 2, 12);

  // 预计送达：出餐准备 + 路上（约 400 米 1 分钟），封顶 75 分钟
  const eta = dist === null
    ? p.prep + 15
    : clamp(p.prep + Math.round(dist / 400), p.prep + 5, 75);

  // 配送范围：品类的常规配送半径
  const inRange = dist === null ? true : dist <= p.radius;

  // 人气参考：品类热度 + 距离 + 信息完整度，最后落在 3.0~5.0
  let rating = 3.2 + (CAT_HEAT[catKey] || 0.6) * 1.2;
  if (dist !== null) {
    if (dist <= 1000) rating += 0.35;
    else if (dist <= 2500) rating += 0.15;
    else rating -= 0.15;
  }
  if (shop && shop.tel) rating += 0.12;
  if (shop && shop.address && String(shop.address).length > 6) rating += 0.1;
  rating += ((seed % 7) - 3) * 0.06;   // 稳定的小抖动，避免整条街分数一样
  rating = Math.round(clamp(rating, 3.0, 5.0) * 10) / 10;

  return {
    minOrder: minOrder,
    minOrderText: '¥' + minOrder,
    deliveryFee: deliveryFee,
    deliveryFeeText: '¥' + deliveryFee,
    eta: eta,
    etaText: '约 ' + eta + ' 分钟',
    inRange: inRange,
    radius: p.radius,
    radiusText: p.radius >= 1000 ? (p.radius / 1000) + ' 公里' : p.radius + ' 米',
    rating: rating,
    ratingText: rating.toFixed(1)
  };
}

// ---------------------------------------------------------------- 打分

/**
 * 给一家店打分：品类是否符合人数、参考人均是否落在预算内、配送是否够得着。
 * 只做排序权重，不直接决定留存（结果太少时仍会展示）。
 * @param {String} catKey
 * @param {Object} query { people, budget }
 * @param {Object} [est] deliveryEstimate 的结果（可选）
 */
function scoreShop(catKey, query, est) {
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

  // 配送适配：人气参考高的排前面；超出配送半径的排后面（但不剔除，用户可能愿意自取）
  if (est) {
    score += (est.rating - 4) * 8;
    if (!est.inRange) score -= 12;
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
  const est = deliveryEstimate(shop, catKey);
  const p = Number(query && query.people) || 1;

  // 按这个人数点，大概率凑不满起送价 → 给一句实用提醒
  let orderHint = '';
  const ph = cat.perHead;
  if (ph && ph[0] > 0 && p * ph[0] < est.minOrder) {
    orderHint = p <= 1
      ? '一个人可能凑不满起送价，建议拼单'
      : '按 ' + p + ' 人点，差不多能凑够起送价';
  }

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
    faved: isFav ? !!isFav(shop.id) : false,

    // ---- 以下为配送信息（近似版，非平台报价） ----
    minOrder: est.minOrder,
    minOrderText: est.minOrderText,
    deliveryFee: est.deliveryFee,
    deliveryFeeText: est.deliveryFeeText,
    eta: est.eta,
    etaText: est.etaText,
    inRange: est.inRange,
    rangeText: est.radiusText,
    rating: est.rating,
    ratingText: est.ratingText,
    orderHint: orderHint
  };
}

/**
 * 排序 + 装饰。返回 { list, droppedCount }
 * 只有当「预算不符」的店铺多于 5 家时才会把它们裁掉，保证结果不会太少。
 */
function rankAndDecorate(list, query, isFav) {
  const arr = (list || []).map(function (shop) {
    const catKey = inferCat(shop);
    const est = deliveryEstimate(shop, catKey);
    return { shop: shop, catKey: catKey, est: est, score: scoreShop(catKey, query, est) };
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
  deliveryEstimate: deliveryEstimate,
  scoreShop: scoreShop,
  recommendReason: recommendReason,
  decorateShop: decorateShop,
  rankAndDecorate: rankAndDecorate
};
