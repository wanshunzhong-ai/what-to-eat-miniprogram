// utils/dishStore.js
// 菜品库的「运行时数据源」。
//
// 三级来源，逐级降级，保证任何情况下都有菜可推：
//   1) cloud   调 dishes 云函数，从云存储取最新菜品库（带 version 比对，未变则不重传）
//   2) cache   上次成功取到的库，存在本地缓存里，离线也能用
//   3) builtin utils/dishes.js 里的精简内置兜底（首次无网时的最后防线）
//
// 取到库后会注入 utils/recommender.js，推荐引擎本身不再内嵌任何菜品数据。

const config = require('../config.js');
const fallbackData = require('./dishes.js');
const recommender = require('./recommender.js');

const STORAGE_KEY = 'eat_dishlib';

const state = {
  list: null,
  version: '',
  updatedAt: '',
  source: 'builtin', // cloud | cache | builtin
  loading: null,
  lastError: '',
  lastSyncAt: 0
};

function builtinList() {
  return fallbackData.getAll();
}

/** 换库：同时注入推荐引擎 */
function applyLibrary(list, meta) {
  state.list = list;
  state.version = (meta && meta.version) || state.version;
  state.updatedAt = (meta && meta.updatedAt) || state.updatedAt;
  state.source = (meta && meta.source) || state.source;
  recommender.setLibrary(list);
}

/** 从本地缓存恢复 */
function restoreFromCache() {
  try {
    const c = wx.getStorageSync(STORAGE_KEY);
    if (c && Array.isArray(c.list) && c.list.length) {
      applyLibrary(c.list, { version: c.version, updatedAt: c.updatedAt, source: 'cache' });
      state.lastSyncAt = c.at || 0;
      return true;
    }
  } catch (e) {
    console.warn('[dishStore] 读取本地缓存失败', e);
  }
  return false;
}

/** 写入本地缓存（整库较大，失败不影响功能） */
function saveCache(list, version, updatedAt) {
  try {
    wx.setStorageSync(STORAGE_KEY, {
      list: list,
      version: version || '',
      updatedAt: updatedAt || '',
      at: Date.now()
    });
    state.lastSyncAt = Date.now();
  } catch (e) {
    console.warn('[dishStore] 写入本地缓存失败（菜品库较大时可忽略）', e);
  }
}

/**
 * 同步保证「马上有数据可用」：内存 → 缓存 → 内置兜底。
 * 页面在调用 getById / 本地推荐前先调一下，避免拿到空库。
 */
function ensure() {
  if (state.list && state.list.length) return state.list;
  if (restoreFromCache()) return state.list;
  applyLibrary(builtinList(), { source: 'builtin', version: '' });
  return state.list;
}

function meta() {
  ensure();
  return {
    source: state.source,
    version: state.version,
    updatedAt: state.updatedAt,
    count: state.list ? state.list.length : 0,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError
  };
}

/**
 * 从云端拉取菜品库（幂等，可重复调用）
 * @param {Boolean} [force] 忽略本地版本比对，强制整库拉取
 * @param {Object}  [appRef] App 实例（在 App.onLaunch 里调用时必须显式传入，那时 getApp() 可能还拿不到）
 * @returns {Promise<Object>} meta()
 */
function load(force, appRef) {
  ensure();
  if (state.loading && !force) return state.loading;

  const app = appRef || (typeof getApp === 'function' ? getApp() : null);
  const cloudReady = !!(app && app.globalData && app.globalData.cloudReady);

  if (!config.ENABLE_CLOUD || !cloudReady || !wx.cloud || !wx.cloud.callFunction) {
    state.lastError = config.ENABLE_CLOUD ? 'cloud-not-ready' : 'cloud-disabled';
    return Promise.resolve(meta());
  }

  const p = new Promise(function (resolve) {
    wx.cloud.callFunction({
      name: config.DISHES_FN,
      data: {
        action: 'list',
        version: force ? '' : state.version
      },
      success(res) {
        const r = res && res.result;
        if (r && r.ok && r.unchanged) {
          // 云端版本没变，沿用本地这份
          state.source = state.source === 'builtin' ? 'builtin' : state.source;
          state.lastError = '';
          resolve(meta());
          return;
        }
        if (r && r.ok && Array.isArray(r.list) && r.list.length) {
          applyLibrary(r.list, { version: r.version, updatedAt: r.updatedAt, source: 'cloud' });
          saveCache(r.list, r.version, r.updatedAt);
          state.lastError = '';
          resolve(meta());
          return;
        }
        state.lastError = (r && r.message) || 'empty-lib';
        resolve(meta());
      },
      fail(err) {
        state.lastError = (err && err.errMsg) || 'call-fail';
        console.warn('[dishStore] 云端菜品库获取失败，沿用本地缓存/兜底', state.lastError);
        resolve(meta());
      }
    });
  });

  state.loading = p;
  p.then(function () { state.loading = null; });
  return p;
}

// ---------------- 查询接口 ----------------

function getAll() {
  return ensure();
}

function getById(id) {
  const list = ensure();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

function getByCuisine(cuisine) {
  return ensure().filter(function (d) { return d.cuisine === cuisine; });
}

/** 数据来源文案，给「我的」页展示 */
function sourceLabel() {
  if (state.source === 'cloud') return '云端菜品库';
  if (state.source === 'cache') return '本地缓存';
  return '内置兜底';
}

module.exports = {
  STORAGE_KEY: STORAGE_KEY,
  ensure: ensure,
  load: load,
  meta: meta,
  getAll: getAll,
  getById: getById,
  getByCuisine: getByCuisine,
  sourceLabel: sourceLabel
};
