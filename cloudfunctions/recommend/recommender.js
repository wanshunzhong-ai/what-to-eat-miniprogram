// utils/recommender.js
// 推荐引擎：根据「城市 / 人数 / 餐次 / 偏好」组合出一桌菜

const dishesData = require('./dishes.js');
const citiesData = require('./cities.js');
const foodData = require('./foodData.js');

const DISHES = dishesData.DISHES;
// 通用菜系的权重：家常菜最百搭，异国料理适当降权
const CUISINE_WEIGHT = {
  家常菜: 1.6,
  小吃: 1.0,
  轻食: 0.9,
  日料: 0.8,
  韩餐: 0.8,
  西餐: 0.8
};

/** 计算某道菜在候选池中的基础权重：本地菜系优先，家常菜次之 */
function baseWeight(cuisine, localCuisine) {
  if (cuisine === localCuisine) return 3;
  if (CUISINE_WEIGHT[cuisine] !== undefined) return CUISINE_WEIGHT[cuisine];
  return 0.6; // 其他地区菜系（例如在成都出现的粤菜）适当降低
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

/** 人数 → 菜品数量 */
function planCount(people, meal) {
  const p = Math.max(1, people || 1);
  if (meal === 'breakfast') {
    if (p <= 1) return 1;
    if (p === 2) return 2;
    return 3;
  }
  if (p <= 1) return 2;
  if (p === 2) return 3;
  if (p === 3) return 4;
  if (p === 4) return 5;
  if (p <= 6) return 6;
  return 7;
}

/** 一桌菜的分类结构（保证荤素汤主食搭配） */
function buildQuotas(count, meal) {
  if (meal === 'breakfast') {
    const seq = ['主食', '小吃', '汤', '轻食'];
    const n = Math.max(1, Math.min(count, seq.length));
    return seq.slice(0, n);
  }
  const out = ['荤', '素', '汤', '主食'];
  const extras = ['荤', '素', '荤', '素'];
  let i = 0;
  while (out.length < count) {
    out.push(extras[i % extras.length]);
    i++;
  }
  return out.slice(0, count);
}

/** 过滤出候选菜品（带权重） */
function buildPool(city, meal, pref) {
  const localCuisine = city && city.cuisine ? city.cuisine : '家常菜';
  const pool = [];
  for (let i = 0; i < DISHES.length; i++) {
    const d = DISHES[i];
    if (d.meal.indexOf(meal) < 0) continue;
    if (typeof pref.spicy === 'number' && pref.spicy >= 0 && d.spicy > pref.spicy) continue;
    if (pref.light && d.spicy > 1) continue;
    if (pref.maxTime && d.time > pref.maxTime) continue;
    if (pref.exclude && pref.exclude.indexOf(d.id) >= 0) continue;

    const w = baseWeight(d.cuisine, localCuisine);
    pool.push({ d: d, w: w });
  }
  // 兜底：过滤太狠导致候选过少时，放宽偏好限制
  if (pool.length < 6) {
    const relaxed = [];
    for (let i = 0; i < DISHES.length; i++) {
      const d = DISHES[i];
      if (d.meal.indexOf(meal) < 0) continue;
      relaxed.push({ d: d, w: baseWeight(d.cuisine, localCuisine) });
    }
    return relaxed;
  }
  return pool;
}

/** 从候选池里按分类结构挑菜 */
function selectDishes(pool, quotas) {
  const used = {};
  const result = [];
  for (let i = 0; i < quotas.length; i++) {
    const cat = quotas[i];
    let best = null;
    let bestScore = -Infinity;
    for (let j = 0; j < pool.length; j++) {
      const item = pool[j];
      if (used[item.d.id]) continue;
      let score = item.w + Math.random() * 1.8;
      if (item.d.category === cat) score += 4;
      if (score > bestScore) {
        bestScore = score;
        best = item;
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
 * @param {Object} opts.pref     { spicy, light, maxTime, exclude }
 */
function recommend(opts) {
  const city = opts.city || { name: '', province: '', cuisine: '家常菜' };
  const people = Math.max(1, opts.people || 1);
  const meal = opts.meal || mealByTime();
  const pref = opts.pref || {};

  const count = planCount(people, meal);
  const pool = buildPool(city, meal, pref);
  const quotas = buildQuotas(count, meal);
  const picked = selectDishes(pool, quotas);

  const dishes = picked.map(function (d) {
    return materialize(d, people);
  });

  // 统计
  let totalTime = 0;
  const cuisineSet = {};
  dishes.forEach(function (d) {
    if (d.time > totalTime) totalTime = d.time;
    cuisineSet[d.cuisine] = true;
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
  materialize: materialize,
  formatAmount: formatAmount,
  MEAL_LABEL: MEAL_LABEL
};
