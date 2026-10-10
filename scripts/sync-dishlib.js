#!/usr/bin/env node
// scripts/sync-dishlib.js
// 菜品库维护脚本：校验 data/dishlib.json，并同步到 dishes 云函数（作为出厂数据集 / 播种源）。
//
// 用法：
//   node scripts/sync-dishlib.js            校验 + 同步
//   node scripts/sync-dishlib.js --bump     校验 + 自动升级版本号（末尾 +1）后同步
//
// 说明：data/dishlib.json 是菜品库的「唯一数据源」，小程序端不再内嵌完整菜品库。
// 改菜 / 加菜的日常流程：改 data/dishlib.json → 跑本脚本 → 重新部署 dishes 云函数；
// 或者不改代码，直接调 dishes 云函数的 publish 动作热更新云存储里的库（无需发版）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'dishlib.json');
const DST_DIR = path.join(ROOT, 'cloudfunctions', 'dishes');
const DST = path.join(DST_DIR, 'dishlib.json');

const CATEGORIES = ['荤', '素', '汤', '主食', '凉菜', '轻食', '小吃', '火锅'];

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

function bumpVersion(v) {
  const parts = String(v || '0.0.0').split('.');
  const last = parts.length - 1;
  parts[last] = String((Number(parts[last]) || 0) + 1);
  return parts.join('.');
}

function main() {
  if (!fs.existsSync(SRC)) fail('找不到数据源：' + SRC);

  let lib;
  try {
    lib = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  } catch (e) {
    fail('data/dishlib.json 不是合法 JSON：' + e.message);
  }

  if (!Array.isArray(lib.list) || !lib.list.length) fail('data/dishlib.json 缺少 list 数组');

  // ---- 校验 ----
  const ids = Object.create(null);
  const names = Object.create(null);
  const bad = [];
  const dupId = [];
  const dupName = [];

  lib.list.forEach(function (d, i) {
    if (!d || typeof d !== 'object') { bad.push('#' + i + ' 不是对象'); return; }
    if (!d.id || !d.name || !d.emoji || !d.cuisine || !d.category) bad.push((d.id || '#' + i) + ' 缺必填字段');
    if (typeof d.spicy !== 'number') bad.push(d.id + ' spicy 不是数字');
    if (!Array.isArray(d.meal) || !d.meal.length) bad.push(d.id + ' meal 为空');
    if (typeof d.time !== 'number') bad.push(d.id + ' time 不是数字');
    if (!Array.isArray(d.ing) || !d.ing.length) bad.push(d.id + ' ing 为空');
    if (!Array.isArray(d.steps) || !d.steps.length) bad.push(d.id + ' steps 为空');
    if (CATEGORIES.indexOf(d.category) < 0) bad.push(d.id + ' 未知分类：' + d.category);
    if (ids[d.id]) dupId.push(d.id);
    ids[d.id] = 1;
    if (names[d.name]) dupName.push(d.name);
    names[d.name] = 1;
  });

  if (bad.length) fail('字段校验失败：\n  - ' + bad.slice(0, 20).join('\n  - '));
  if (dupId.length) fail('重复 id：' + dupId.join(', '));
  if (dupName.length) fail('重复菜名：' + dupName.join(', '));

  const byCat = {};
  const byCuisine = {};
  lib.list.forEach(function (d) {
    byCat[d.category] = (byCat[d.category] || 0) + 1;
    byCuisine[d.cuisine] = (byCuisine[d.cuisine] || 0) + 1;
  });

  // ---- 版本 ----
  if (process.argv.indexOf('--bump') >= 0) {
    lib.version = bumpVersion(lib.version);
  }
  lib.count = lib.list.length;
  lib.updatedAt = new Date().toISOString();

  fs.writeFileSync(SRC, JSON.stringify(lib, null, 0), 'utf8');

  if (!fs.existsSync(DST_DIR)) fs.mkdirSync(DST_DIR, { recursive: true });
  fs.writeFileSync(DST, JSON.stringify(lib, null, 0), 'utf8');

  console.log('✓ 菜品库校验通过并已同步');
  console.log('  版本：' + lib.version + '　共 ' + lib.count + ' 道');
  console.log('  分类：' + Object.keys(byCat).map(function (k) { return k + '=' + byCat[k]; }).join(' '));
  console.log('  菜系：' + Object.keys(byCuisine).length + ' 个');
  console.log('  数据源：' + path.relative(ROOT, SRC));
  console.log('  已同步：' + path.relative(ROOT, DST));
}

main();
