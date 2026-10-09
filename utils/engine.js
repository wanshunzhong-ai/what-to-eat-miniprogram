// utils/engine.js
// 推荐引擎统一入口。
// 优先调用云函数 recommend（逻辑与数据在云端，可随时更新）；
// 云开发未启用、未初始化或调用失败时，无缝回退到本地同一套逻辑，保证离线可用。

const localRecommender = require('./recommender.js');
const config = require('../config.js');

/**
 * 生成一份推荐结果
 * @param {Object} opts { city, people, meal, pref }
 * @returns {Promise<Object>} 与本地 recommender.recommend 返回结构一致
 */
function recommend(opts) {
  return new Promise(function (resolve) {
    const app = typeof getApp === 'function' ? getApp() : null;
    const cloudReady = !!(app && app.globalData && app.globalData.cloudReady);

    if (!config.ENABLE_CLOUD || !cloudReady || !wx.cloud || !wx.cloud.callFunction) {
      resolve(fallback(opts));
      return;
    }

    wx.cloud.callFunction({
      name: config.RECOMMEND_FN,
      data: {
        city: opts.city,
        people: opts.people,
        meal: opts.meal,
        pref: opts.pref
      },
      success(res) {
        const r = res && res.result;
        if (r && r.dishes && r.dishes.length) {
          r.source = 'cloud';
          resolve(r);
        } else {
          resolve(fallback(opts));
        }
      },
      fail(err) {
        console.warn('[engine] 云端推荐失败，已回退本地逻辑', err && err.errMsg ? err.errMsg : err);
        resolve(fallback(opts));
      }
    });
  });
}

/** 本地兜底 */
function fallback(opts) {
  const r = localRecommender.recommend(opts);
  r.source = 'local';
  return r;
}

module.exports = {
  recommend: recommend
};
