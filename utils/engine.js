// utils/engine.js
// 数据获取统一入口。
//
// recommend：推荐一桌菜 —— 优先云函数 recommend，失败回退本地同一套逻辑。
// nearbyPlaces：附近的店 —— 必须联网（走云函数 nearby 代理腾讯位置服务），失败时返回结构化错误而不抛异常。

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

/**
 * 查询附近的店（外卖分支）
 *
 * 与 recommend 不同，这里没有一个「本地等价实现」——附近的店必须实时获取。
 * 因此失败时不抛异常，而是返回 { ok:false, code, message, list:[] }，由页面展示对应提示。
 *
 * @param {Object} opts { lat, lng, keyword, radius, page, pageSize }
 * @returns {Promise<Object>} { ok, list, count?, page?, radius?, code?, message? }
 */
function nearbyPlaces(opts) {
  return new Promise(function (resolve) {
    const app = typeof getApp === 'function' ? getApp() : null;
    const cloudReady = !!(app && app.globalData && app.globalData.cloudReady);

    if (!config.ENABLE_CLOUD || !cloudReady || !wx.cloud || !wx.cloud.callFunction) {
      resolve({
        ok: false,
        code: 'NO_CLOUD',
        message: '附近店铺需要联网获取，请检查网络或云开发配置',
        list: []
      });
      return;
    }

    wx.cloud.callFunction({
      name: config.NEARBY_FN,
      data: opts,
      success(res) {
        const r = res && res.result;
        if (r && r.ok) {
          resolve({
            ok: true,
            source: 'cloud',
            count: r.count,
            list: r.list || [],
            page: r.page,
            radius: r.radius,
            keyword: r.keyword
          });
          return;
        }
        resolve({
          ok: false,
          source: 'cloud',
          code: (r && r.code) || 'EMPTY',
          message: (r && r.message) || '没有获取到附近的店',
          list: []
        });
      },
      fail(err) {
        console.warn('[engine] 附近店铺查询失败', err && err.errMsg ? err.errMsg : err);
        resolve({
          ok: false,
          source: 'cloud',
          code: 'CALL_FAIL',
          message: '网络请求失败，请稍后重试',
          errMsg: err && err.errMsg,
          list: []
        });
      }
    });
  });
}

module.exports = {
  recommend: recommend,
  nearbyPlaces: nearbyPlaces
};
