// utils/recommender.js
// 推荐引擎：按「城市 / 人数 / 口味」组合出一桌菜（人数定结构，口味定选菜）
//
// 菜品库不内嵌在引擎里：由调用方注入（见 setLibrary / opts.dishes）。
//   · 云函数：从云存储取库后注入；
//   · 小程序：dishStore 从云函数取库（或本地缓存 / 内置兜底）后注入。
// 这样加菜、改菜都不用动引擎代码。

const citiesData = require('./cities.js');
const foodData = require('./foodData.js');

// 当前生效的菜品库（由 setLibrary 注入）
let DISHES = [];

/** 注入菜品库（整库替换） */
function setLibrary(list) {
  DISHES = Array.isArray(list) ? list : [];
  return DISHES.length;
}

/** 当前菜品库 */
function getLibrary() {
  return DISHES;
}

// 「非地方特色」菜系：既给出权重，也给出选菜优先级（tier 越小越优先）。
//   tier 1 —— 中式家常 / 街头小吃：最能和任何本地菜系搭在一起
//   tier 2 —— 轻食 / 异国料理：可以点缀，但不该抢占本地味
// 不在表里、又不等同本地菜系的，属于「外地菜系」，tier 3，优先级最低。
const NON_LOCAL_CUISINE = {
  家常菜: { tier: 1, w: 1.6 },
  小吃: { tier: 1, w: 1.0 },
  轻食: { tier: 2, w: 0.9 },
  日料: { tier: 2, w: 0.8 },
  韩餐: { tier: 2, w: 0.8 },
  西餐: { tier: 2, w: 0.8 }
};

// 「清淡」偏好偏爱的分类：少油少辣、以蒸煮凉拌为主
const LIGHT_CATEGORY = { 素: 1, 汤: 1, 凉菜: 1, 轻食: 1 };

/** 计算某道菜在候选池中的基础权重：本地菜系优先，家常菜次之 */
function baseWeight(cuisine, localCuisine) {
  if (cuisine === localCuisine) return 3;
  if (NON_LOCAL_CUISINE[cuisine]) return NON_LOCAL_CUISINE[cuisine].w;
  return 0.6; // 其他地区菜系（例如在成都出现的粤菜）适当降低
}

/** 选菜优先级：0 本地 → 1 家常/小吃 → 2 轻食/异国 → 3 外地 */
function cuisineTier(cuisine, localCuisine) {
  if (cuisine === localCuisine) return 0;
  const item = NON_LOCAL_CUISINE[cuisine];
  return item ? item.tier : 3;
}

const MEAL_LABEL = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐'
};

/** 根据当前时间推断餐次 */
function mealByTime(date) {
  const d = date || new Date();
  const h = d.getHours();
  if (h >= 5 && h < 10) return 'breakfast';
  if (h >= 10 && h < 15) return 'lunch';
  if (h >= 15 && h < 17) return 'lunch';
  return 'dinner';
}

/**
 * 按中式用餐的风俗习惯，把「人数」拆解成一桌菜的结构。
 *
 * 依据（民间点菜惯例，非硬性规定）：
 *  - 热菜「一人一道」：人越多菜越多，小桌保底 2 道，15 人封顶（上限 15 人，再多就该分两桌）
 *  - 凉菜（冷盘）约为人数的 1/3，2 人以下一般不上；最多 4 道 —— 传统「四冷盘」即上限
 *  - 汤：小桌 0~1 道，11 人以上加至 2 道
 *  - 主食：1 道，11 人以上 2 道
 *  - 热菜荤素比：小桌（≤3 人）荤素相当，人多时荤约为素的 1.5 倍（宴席惯例荤多于素）
 *  - 早餐不讲冷热配比，以主食 + 小吃（部分）为主，人多再加轻食 / 汤
 *
 * 返回值除各分类数量外，还带一个 `seq`（上菜顺序的配额序列），供选菜直接使用。
 *
 * @returns {{p, cold, meat, veg, soup, staple, snack, light, seq}}
 */
function planMenu(people, meal) {
  // 人数上限 15：超过就该分两桌，本引擎只负责一桌的搭配
  const p = Math.max(1, Math.min(15, Math.round(people || 1)));

  if (meal === 'breakfast') {
    const staple = p <= 4 ? 1 : 2;
    const snack = p <= 1 ? 1 : (p <= 4 ? 2 : 3);
    const light = p >= 6 ? 1 : 0;
    const soup = p >= 8 ? 1 : 0;
    const seq = [];
    let i;
    for (i = 0; i < staple; i++) seq.push('主食');
    for (i = 0; i < snack; i++) seq.push('小吃');
    for (i = 0; i < light; i++) seq.push('轻食');
    for (i = 0; i < soup; i++) seq.push('汤');
    return { p: p, cold: 0, meat: 0, veg: 0, soup: soup, staple: staple, snack: snack, light: light, seq: seq };
  }

  // 凉菜：约 1/3 人数；2 人以下不上；最多 4 道（「四冷盘」为上限）
  let cold = Math.round(p / 3);
  if (p <= 2) cold = 0;
  if (cold > 4) cold = 4;

  // 热菜：一人一道，小桌保底 2 道，15 道封顶（人数上限 15）
  const hot = Math.max(2, Math.min(p, 15));

  // 汤 / 主食
  const soup = p <= 2 ? 0 : (p >= 11 ? 2 : 1);
  const staple = p >= 11 ? 2 : 1;

  // 热菜里的素菜数量：小桌荤素相当，人多时荤约为素的 1.5 倍（宴席惯例荤多于素）
  let veg = p <= 3 ? Math.floor(hot / 2) : Math.round(hot * 0.4);
  if (hot >= 2 && veg < 1) veg = 1;
  if (veg >= hot) veg = hot - 1;
  const meat = hot - veg;

  // 上菜顺序：凉菜 → 热菜（荤 → 素）→ 汤 → 主食
  const seq = [];
  let i;
  for (i = 0; i < cold; i++) seq.push('凉菜');
  for (i = 0; i < meat; i++) seq.push('荤');
  for (i = 0; i < veg; i++) seq.push('素');
  for (i = 0; i < soup; i++) seq.push('汤');
  for (i = 0; i < staple; i++) seq.push('主食');

  return { p: p, cold: cold, meat: meat, veg: veg, soup: soup, staple: staple, snack: 0, light: 0, seq: seq };
}

/** 一桌菜的总道数 */
function planTotal(plan) {
  if (plan.seq && plan.seq.length) return plan.seq.length;
  return plan.cold + plan.meat + plan.veg + plan.soup + plan.staple + (plan.snack || 0) + (plan.light || 0);
}

/** 人数 → 菜品数量（兼容旧接口） */
function planCount(people, meal) {
  return planTotal(planMenu(people, meal));
}

/**
 * 把结构转成好读的建议文案，例如：
 * 「1 凉菜 + 4 热菜（3 荤 1 素）+ 1 汤 + 1 主食」
 */
function describeMenu(plan, meal) {
  if (meal === 'breakfast') {
    const t = [];
    if (plan.staple) t.push(plan.staple + ' 主食');
    if (plan.snack) t.push(plan.snack + ' 小吃');
    if (plan.light) t.push(plan.light + ' 轻食');
    if (plan.soup) t.push(plan.soup + ' 汤');
    return t.join(' + ');
  }
  const t = [];
  if (plan.cold) t.push(plan.cold + ' 凉菜');
  const hot = plan.meat + plan.veg;
  if (hot) t.push(hot + ' 热菜（' + plan.meat + ' 荤 ' + plan.veg + ' 素）');
  if (plan.soup) t.push(plan.soup + ' 汤');
  if (plan.staple) t.push(plan.staple + ' 主食');
  return t.join(' + ');
}

/** 配套的风俗说明，让用户知道这个配比的依据 */
function menuTip(people, meal) {
  if (meal === 'breakfast') {
    return people >= 6
      ? '早餐人多，主食多备一份，再配点小吃和汤'
      : '早餐以主食和小吃为主，简单吃点就好';
  }
  const p = Math.max(1, Math.round(people || 1));
  if (p <= 2) return '人少不上凉菜，一荤一素配主食，清爽不浪费';
  if (p <= 5) return '按「一人一热菜、荤略多于素」的家常习惯配';
  if (p <= 9) return '按待客习惯「N 菜一汤」配，凉菜热菜都齐了';
  if (p <= 12) return '宴席规格：凉菜 + 热菜 + 双汤 + 主食，冷盘四道为限';
  return '十五人大席：四冷盘 + 一人一热菜 + 双汤双主食，一桌也摆得开';
}

/** 取「上菜顺序的配额序列」（直接复用 planMenu 算好的 seq） */
function buildQuotas(plan) {
  return plan.seq || [];
}

/**
 * 过滤出候选菜品（带权重）
 * 推荐只按「人数 + 口味」来定：人数决定一桌的结构（见 planMenu），
 * 口味（辣度 / 清淡）决定从各分类里挑哪几道菜。做菜时间不参与筛选，也不做限定。
 * @param {Number} [need] 一桌需要几道菜，用于决定「放宽偏好」的阈值
 */
function buildPool(dishes, city, meal, pref, need) {
  const localCuisine = city && city.cuisine ? city.cuisine : '家常菜';
  const pool = [];
  for (let i = 0; i < dishes.length; i++) {
    const d = dishes[i];
    if (d.meal.indexOf(meal) < 0) continue;

    // 辣度是硬约束：用户选了「不吃辣 / 微辣」，超过这个辣度的菜直接不进候选
    if (typeof pref.spicy === 'number' && pref.spicy >= 0 && d.spicy > pref.spicy) continue;
    if (pref.light && d.spicy > 1) continue;
    if (pref.exclude && pref.exclude.indexOf(d.id) >= 0) continue;

    let w = baseWeight(d.cuisine, localCuisine);

    // 口味加权：辣度越贴近用户喜好，权重越高（差 1 级减半，差 2 级不再加分）
    const spicy = d.spicy || 0;
    if (typeof pref.spicy === 'number' && pref.spicy >= 0) {
      w += Math.max(0, 2.4 - Math.abs(spicy - pref.spicy) * 1.2);
    }
    // 口味加权：「想清淡」时优待清淡做法，重口菜降权
    if (pref.light) {
      if (spicy === 0) w += 0.6;
      if (LIGHT_CATEGORY[d.category]) w += 0.8;
      w -= spicy * 0.35;
    }

    pool.push({ d: d, w: w });
  }

  // 兜底：过滤太狠导致候选不足以凑一桌时，放宽偏好限制（保留餐次约束）
  const min = Math.max(6, (need || 0) + 4);
  if (pool.length < min) {
    const relaxed = [];
    for (let i = 0; i < dishes.length; i++) {
      const d = dishes[i];
      if (d.meal.indexOf(meal) < 0) continue;
      relaxed.push({ d: d, w: baseWeight(d.cuisine, localCuisine) });
    }
    return relaxed;
  }
  return pool;
}

/**
 * 从候选池里按分类结构挑菜。
 *
 * 分层优先级：本地菜系 → 家常菜/小吃 → 轻食/异国 → 外地菜系。
 * 只有在高优先层里凑不出这道菜时，才会落到下一层。
 * 这样即便本地菜系缺某个分类（例如川菜本来没有「汤」「主食」），
 * 也会补上家常菜，而不会随机冒出「奶油蘑菇汤」「亲子丼」这类与当地味冲突的菜。
 *
 * 例外：用户明确点了「中辣 / 重辣」时，把够辣的菜一并提到本地层参与竞争，
 * 好让本地口味偏清淡的城市（如上海）也能按口味真正吃到辣菜。
 */
function selectDishes(pool, quotas, localCuisine, pref) {
  const used = {};
  const result = [];
  const local = localCuisine || '家常菜';
  const wantSpicy = pref && typeof pref.spicy === 'number' && pref.spicy >= 2;

  for (let i = 0; i < quotas.length; i++) {
    const cat = quotas[i];

    // 该分类且未使用的候选；若该分类没有候选（数据缺口），放宽为任意未使用的菜
    let cand = [];
    for (let j = 0; j < pool.length; j++) {
      const it = pool[j];
      if (!used[it.d.id] && it.d.category === cat) cand.push(it);
    }
    if (!cand.length) {
      for (let j = 0; j < pool.length; j++) {
        const it = pool[j];
        if (!used[it.d.id]) cand.push(it);
      }
    }
    if (!cand.length) continue;

    // 分层归组
    const tiers = [[], [], [], []];
    for (let j = 0; j < cand.length; j++) {
      let tier = cuisineTier(cand[j].d.cuisine, local);
      // 明确要中辣/重辣时，够辣的菜无视菜系差异，直接和本地菜一起竞争
      if (wantSpicy && (cand[j].d.spicy || 0) >= pref.spicy) tier = 0;
      tiers[tier].push(cand[j]);
    }
    let group = tiers[3];
    for (let t = 0; t < tiers.length; t++) {
      if (tiers[t].length) { group = tiers[t]; break; }
    }

    // 组内按权重随机，保留「换一批」的多样性
    let best = null;
    let bestScore = -Infinity;
    for (let j = 0; j < group.length; j++) {
      const score = group[j].w + Math.random() * 1.8;
      if (score > bestScore) {
        bestScore = score;
        best = group[j];
      }
    }
    if (best) {
      used[best.d.id] = true;
      result.push(best.d);
    }
  }
  return result;
}

/** 数量格式化：把「每人份量」换算成总用量 */
function formatAmount(per, people, unit) {
  const amt = per * people;
  if (unit === 'g') {
    if (amt >= 1000) return Math.round((amt / 1000) * 10) / 10 + ' kg';
    return Math.round(amt / 10) * 10 + ' g';
  }
  if (unit === 'ml') {
    if (amt >= 1000) return Math.round((amt / 1000) * 10) / 10 + ' L';
    return Math.round(amt / 10) * 10 + ' ml';
  }
  // 个 / 片 / 张 等计数单位
  let c = Math.round(amt * 2) / 2;
  if (c < 0.5) c = 0.5;
  const text = c % 1 === 0 ? String(c) : c.toFixed(1);
  return text + ' ' + unit;
}

/** 把菜品转换成「按人数换算好份量」的可展示对象 */
function materialize(dish, people) {
  const ingredients = (dish.ing || []).map(function (it) {
    return {
      name: it[0],
      amount: formatAmount(it[1], people, it[2])
    };
  });
  return {
    id: dish.id,
    name: dish.name,
    emoji: dish.emoji,
    cuisine: dish.cuisine,
    category: dish.category,
    spicy: dish.spicy,
    time: dish.time,
    difficulty: dish.difficulty,
    desc: dish.desc,
    ingredients: ingredients,
    seasonings: dish.sea || [],
    steps: dish.steps || [],
    tip: dish.tip || ''
  };
}

/**
 * 主推荐函数
 * @param {Object} opts
 * @param {Object} opts.city     城市对象 { name, province, cuisine }
 * @param {Number} opts.people   人数
 * @param {String} opts.meal     breakfast / lunch / dinner
 * @param {Object} opts.pref     { spicy, light, exclude }
 * @param {Array}  [opts.dishes] 本次使用的菜品库；不传则用 setLibrary 注入的那份
 */
function recommend(opts) {
  const city = opts.city || { name: '', province: '', cuisine: '家常菜' };
  // 人数上限 15，与首页一致；份量也按同一人数换算，避免"菜量对不上"
  const people = Math.max(1, Math.min(15, Math.round(opts.people || 1)));
  const meal = opts.meal || mealByTime();
  const pref = opts.pref || {};
  const dishes0 = (opts.dishes && opts.dishes.length) ? opts.dishes : DISHES;

  // 先按风俗拆解一桌的结构（结构只跟人数 / 餐次有关）
  const menu = planMenu(people, meal);

  // 菜品库不可用：不编造结果，明确告诉调用方，由其决定是否降级
  if (!dishes0.length) {
    return {
      id: 'rec_' + Date.now(),
      city: city,
      people: people,
      meal: meal,
      mealLabel: MEAL_LABEL[meal] || '一餐',
      count: 0,
      dishes: [],
      cuisines: [],
      menu: menu,
      menuText: describeMenu(menu, meal),
      menuTip: menuTip(people, meal),
      catCount: {},
      totalTime: 0,
      localFoods: foodData.getLocalFoods(city),
      createdAt: Date.now(),
      error: 'NO_DISHLIB'
    };
  }

  const quotas = buildQuotas(menu);
  const pool = buildPool(dishes0, city, meal, pref, quotas.length);
  const picked = selectDishes(pool, quotas, city.cuisine, pref);

  const dishes = picked.map(function (d) {
    return materialize(d, people);
  });

  // 统计
  let totalTime = 0;
  const cuisineSet = {};
  const catCount = {};
  dishes.forEach(function (d) {
    if (d.time > totalTime) totalTime = d.time;
    cuisineSet[d.cuisine] = true;
    catCount[d.category] = (catCount[d.category] || 0) + 1;
  });
  const cuisines = Object.keys(cuisineSet);

  return {
    id: 'rec_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    city: city,
    people: people,
    meal: meal,
    mealLabel: MEAL_LABEL[meal] || '一餐',
    count: dishes.length,
    dishes: dishes,
    cuisines: cuisines,
    // 一桌菜的结构建议（冷热配比 / 荤素 / 汤 / 主食）
    menu: menu,
    menuText: describeMenu(menu, meal),
    menuTip: menuTip(people, meal),
    catCount: catCount,
    totalTime: totalTime,
    localFoods: foodData.getLocalFoods(city),
    createdAt: Date.now()
  };
}

/** 定位 → 最近城市 */
function locateCity(lat, lng) {
  return citiesData.findNearest(lat, lng);
}

module.exports = {
  recommend: recommend,
  locateCity: locateCity,
  mealByTime: mealByTime,
  planCount: planCount,
  planMenu: planMenu,
  planTotal: planTotal,
  describeMenu: describeMenu,
  menuTip: menuTip,
  materialize: materialize,
  formatAmount: formatAmount,
  setLibrary: setLibrary,
  getLibrary: getLibrary,
  MEAL_LABEL: MEAL_LABEL
};
