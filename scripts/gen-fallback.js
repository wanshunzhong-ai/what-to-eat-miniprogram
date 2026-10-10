// scripts/gen-fallback.js（一次性生成脚本）
// 从完整菜品库中挑出一份「精简内置兜底」，写入 utils/dishes.js。
// 目标：覆盖全部分类 / 主要菜系 / 三餐，首次无网也能给出合理的一桌菜。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dishlib.json'), 'utf8'));

const QUOTA = { 荤: 10, 素: 8, 汤: 6, 主食: 8, 凉菜: 5, 小吃: 5, 轻食: 4, 火锅: 1 };
const PREFERRED = ['家常菜', '川菜', '粤菜', '湘菜', '鲁菜', '苏菜', '浙菜', '西北菜', '东北菜', '小吃'];

function pick(cat, n) {
  const pool = lib.list.filter(function (d) { return d.category === cat; });
  // 按「菜系优先级 + 是否覆盖三餐」排序
  pool.sort(function (a, b) {
    const ai = PREFERRED.indexOf(a.cuisine);
    const bi = PREFERRED.indexOf(b.cuisine);
    const av = ai < 0 ? 99 : ai;
    const bv = bi < 0 ? 99 : bi;
    if (av !== bv) return av - bv;
    return (b.meal.length - a.meal.length);
  });
  const out = [];
  const seenCuisine = {};
  // 先保证菜系多样
  pool.forEach(function (d) {
    if (out.length >= n) return;
    if (seenCuisine[d.cuisine]) return;
    seenCuisine[d.cuisine] = 1;
    out.push(d);
  });
  // 不足则按序补齐
  pool.forEach(function (d) {
    if (out.length >= n) return;
    if (out.indexOf(d) >= 0) return;
    out.push(d);
  });
  return out;
}

const picked = [];
Object.keys(QUOTA).forEach(function (cat) {
  pick(cat, QUOTA[cat]).forEach(function (d) { picked.push(d); });
});

function ser(d) {
  const parts = [];
  parts.push("id: '" + d.id + "'");
  parts.push("name: '" + d.name + "'");
  parts.push("emoji: '" + d.emoji + "'");
  parts.push("cuisine: '" + d.cuisine + "'");
  parts.push("category: '" + d.category + "'");
  parts.push('spicy: ' + d.spicy);
  parts.push('meal: ' + JSON.stringify(d.meal));
  parts.push('time: ' + d.time);
  parts.push('difficulty: ' + d.difficulty);
  parts.push('base: ' + (d.base || 2));
  parts.push("desc: '" + String(d.desc || '').replace(/'/g, "\\'") + "'");
  parts.push('ing: ' + JSON.stringify(d.ing));
  parts.push('sea: ' + JSON.stringify(d.sea || []));
  parts.push('steps: ' + JSON.stringify(d.steps));
  parts.push("tip: '" + String(d.tip || '').replace(/'/g, "\\'") + "'");
  return '  { ' + parts.join(', ') + ' }';
}

const head = [
  '// utils/dishes.js',
  '// 菜品库的「精简内置兜底」。',
  '//',
  '// 完整菜品库（' + lib.count + ' 道）已迁到 data/dishlib.json，由云函数 dishes 在运行时下发，',
  '// 小程序端不再内嵌完整库 —— 加菜 / 改菜不用改代码、不用发版。',
  '//',
  '// 这里只保留一份覆盖全部分类的小数据集，用于兜底：',
  '//   1) 首次打开且无网络时，仍能配出一桌合理的菜；',
  '//   2) 云函数与本地缓存都不可用时的最后一道防线。',
  '//',
  '// 运行时请优先使用 utils/dishStore.js（云端 → 本地缓存 → 本文件兜底）。',
  '',
  'const FALLBACK_DISHES = ['
].join('\n');

const body = picked.map(ser).join(',\n');

const tail = [
  '',
  '];',
  '',
  "const CATEGORY_ORDER = ['荤', '素', '汤', '主食', '凉菜', '轻食', '小吃', '火锅'];",
  '',
  'function getAll() {',
  '  return FALLBACK_DISHES;',
  '}',
  '',
  'function getById(id) {',
  '  for (let i = 0; i < FALLBACK_DISHES.length; i++) {',
  '    if (FALLBACK_DISHES[i].id === id) return FALLBACK_DISHES[i];',
  '  }',
  '  return null;',
  '}',
  '',
  'function getByCuisine(cuisine) {',
  '  return FALLBACK_DISHES.filter(function (d) { return d.cuisine === cuisine; });',
  '}',
  '',
  'module.exports = {',
  '  FALLBACK_DISHES: FALLBACK_DISHES,',
  '  CATEGORY_ORDER: CATEGORY_ORDER,',
  '  getById: getById,',
  '  getByCuisine: getByCuisine,',
  '  getAll: getAll',
  '};',
  ''
].join('\n');

fs.writeFileSync(path.join(ROOT, 'utils', 'dishes.js'), head + '\n' + body + '\n' + tail, 'utf8');

const byCat = {};
picked.forEach(function (d) { byCat[d.category] = (byCat[d.category] || 0) + 1; });
console.log('内置兜底写入 utils/dishes.js，共 ' + picked.length + ' 道');
console.log('分类：' + Object.keys(byCat).map(function (k) { return k + '=' + byCat[k]; }).join(' '));
console.log('字节：' + fs.statSync(path.join(ROOT, 'utils', 'dishes.js')).size);
