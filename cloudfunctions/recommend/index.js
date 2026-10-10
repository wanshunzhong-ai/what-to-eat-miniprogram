// cloudfunctions/recommend/index.js
// 「今天吃什么」推荐云函数。
// 入参：{ city, people, meal, pref }
// 出参：与 utils/recommender.js 的 recommend() 完全一致的一桌菜结果。
//
// 菜品库不内嵌在本函数里：运行时从「云存储」读（或退一步调 dishes 云函数取），
// 容器内缓存 5 分钟。加菜 / 改菜只改云端数据，本函数不用重新部署。
//
// 取库顺序：
//   1) 用环境变量 DISHLIB_FILE_ID 直连云存储（最快，少一跳）
//   2) 调 dishes 云函数取（会自动播种 / 回退出厂数据集）
// 两者都拿不到时返回 NO_DISHLIB，由小程序端降级到本地推荐。

const cloud = require('wx-server-sdk');
const recommender = require('./recommender.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const CACHE_TTL = 5 * 60 * 1000;
const DISHLIB_FN = 'dishes';

let libCache = null;   // { version, updatedAt, list }
let libAt = 0;
let libFileId = process.env.DISHLIB_FILE_ID || '';

/** 读菜品库（容器缓存 → 云存储 → dishes 云函数） */
async function fetchLibrary() {
  if (libCache && (Date.now() - libAt) < CACHE_TTL) return libCache;

  // 1) 直连云存储
  if (libFileId) {
    try {
      const res = await cloud.downloadFile({ fileID: libFileId });
      const parsed = JSON.parse(res.fileContent.toString('utf8'));
      if (parsed && Array.isArray(parsed.list) && parsed.list.length) {
        libCache = parsed;
        libAt = Date.now();
        return libCache;
      }
    } catch (e) {
      console.warn('[recommend] 直连云存储取库失败，改走 dishes 云函数：', (e && e.errMsg) || e);
    }
  }

  // 2) 调 dishes 云函数
  try {
    const r = await cloud.callFunction({ name: DISHLIB_FN, data: { action: 'list' } });
    const res = r && r.result;
    if (res && res.ok && Array.isArray(res.list) && res.list.length) {
      if (res.fileID) libFileId = res.fileID;
      libCache = { version: res.version, updatedAt: res.updatedAt, list: res.list };
      libAt = Date.now();
      return libCache;
    }
    console.warn('[recommend] dishes 云函数未返回菜品库：', res && res.message);
  } catch (e) {
    console.warn('[recommend] 调用 dishes 云函数失败：', (e && e.errMsg) || e);
  }

  return null;
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();

  const city = event && event.city && event.city.name
    ? event.city
    : { name: '', province: '', cuisine: '家常菜' };
  const people = Math.max(1, Number(event && event.people) || 1);
  const meal = (event && event.meal) || recommender.mealByTime();
  const pref = (event && event.pref) || {};

  const lib = await fetchLibrary();
  if (lib) recommender.setLibrary(lib.list);

  const result = recommender.recommend({
    city: city,
    people: people,
    meal: meal,
    pref: pref
  });

  result.source = 'cloud';
  result.dishLibVersion = lib ? lib.version : '';
  result.dishLibCount = lib ? lib.list.length : 0;
  result.openid = wxContext.OPENID || '';
  return result;
};
