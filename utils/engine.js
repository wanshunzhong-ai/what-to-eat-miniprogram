// utils/engine.js
// 数据获取统一入口。
//
// recommend：推荐一桌菜 —— 优先云函数 recommend，失败回退本地同一套逻辑。
// loadDishlib：拉取菜品库到本地（云端 → 缓存 → 内置兜底），并注入推荐引擎。
// nearbyPlaces：附近的店 —— 必须联网（走云函数 nearby 代理腾讯位置服务），失败时返回结构化错误而不抛异常。

const localRecommender = require('./recommender.js');
const dishStore = require('./dishStore.js');
const config = require('../config.js');

/** 确保菜品库已就绪（同步，立即可用） */
function ensureDishlib() {
  return dishStore.ensure();
}

/** 从云端刷新菜品库（异步，失败不清空已有数据） */
function loadDishlib(force) {
  return dishStore.load(force);
}

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

    // 带上偏好的本地改动时间：云端据此判断该不该更新它记住的口味，
    // 避免「新手机上刚改的」被别处的旧请求覆盖。
    let prefUpdatedAt = 0;
    try {
      const ts = app && typeof app.readSyncTs === 'function' ? app.readSyncTs() : null;
      if (ts && ts.pref) prefUpdatedAt = ts.pref;
    } catch (e) {}

    wx.cloud.callFunction({
      name: config.RECOMMEND_FN,
      data: {
        city: opts.city,
        people: opts.people,
        meal: opts.meal,
        pref: opts.pref,
        prefUpdatedAt: prefUpdatedAt
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

/** 本地兜底：用本地菜品库（缓存或内置兜底）跑同一套推荐逻辑 */
function fallback(opts) {
  const lib = dishStore.ensure();
  const r = localRecommender.recommend(Object.assign({}, opts, { dishes: lib }));
  r.source = 'local';
  r.dishLibSource = dishStore.meta().source;
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
        stage: 'cloud',
        message: '当前运行环境用不了云函数，拿不到附近的店',
        hint: '附近门店要经由云函数请求地图服务。若你在「预览面板」里看，它并不支持云调用；' +
              '请用微信开发者工具打开本项目（或在真机上体验）再试。',
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
            dataSource: r.source || '',   // tencent | osm
            note: r.note || '',
            count: r.count,
            list: r.list || [],
            page: r.page,
            radius: r.radius,
            keyword: r.keyword,
            exhausted: !!r.exhausted
          });
          return;
        }
        resolve({
          ok: false,
          source: 'cloud',
          stage: 'server',
          code: (r && r.code) || 'EMPTY',
          message: (r && r.message) || '没有获取到附近的店',
          errors: (r && r.errors) || [],
          list: []
        });
      },
      fail(err) {
        const errMsg = (err && (err.errMsg || err.message)) || '';
        console.warn('[engine] 附近店铺查询失败', errMsg || err);
        resolve({
          ok: false,
          source: 'cloud',
          stage: 'call',
          code: 'CALL_FAIL',
          message: '调用云函数失败' + (errMsg ? '：' + errMsg : ''),
          hint: '常见原因：预览面板不支持云调用、云环境未绑定到当前小程序、或网络不通。' +
                '建议用微信开发者工具打开本项目验证。',
          errMsg: errMsg,
          list: []
        });
      }
    });
  });
}

module.exports = {
  recommend: recommend,
  ensureDishlib: ensureDishlib,
  loadDishlib: loadDishlib,
  nearbyPlaces: nearbyPlaces
};
