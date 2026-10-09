// utils/wxapi.js
// wx 接口安全调用层。
//
// 背景：不同运行环境（真机 / 开发者工具 / 小程序预览沙箱）实现的 wx 接口并不一致。
// 例如预览环境就没有实现 wx.getLocation，若直接调用会抛
// "wx.getLocation is not a function"，进而中断页面生命周期（onShow 等）。
//
// 本模块做两件事：
//   1) install()：启动时把缺失的 wx 接口补成安全兜底实现（真机上不会触发，行为不变）；
//   2) getLocation()：定位接口的 Promise 封装，优先 getLocation，其次 getFuzzyLocation，
//      都没有时优雅返回「不支持」，由页面提示手动选城市，而不是抛异常。

// 极端情况下运行环境可能完全没有 wx，这里补一个空对象，避免裸引用报错
if (typeof wx === 'undefined') {
  try { globalThis.wx = {}; } catch (e) { /* 忽略 */ }
}

/** 取 wx 对象（可能为 null） */
function W() {
  return (typeof wx !== 'undefined' && wx) ? wx : null;
}

/** 接口是否可用 */
function can(name) {
  const w = W();
  return !!(w && typeof w[name] === 'function');
}

/** 内存版存储（仅在环境未提供同步存储接口时启用） */
const MEM_STORE = {};

/**
 * 安全调用：接口不存在时不抛异常，而是走 fail / complete 回调
 * @returns {boolean} 是否真正调到了原生接口
 */
function call(name, options) {
  const opt = options || {};
  if (!can(name)) {
    console.info('[wxapi] 当前环境未实现 wx.' + name + '，已跳过');
    const info = { errMsg: name + ':fail 当前环境未实现该接口' };
    if (typeof opt.fail === 'function') { try { opt.fail(info); } catch (e) {} }
    if (typeof opt.complete === 'function') { try { opt.complete(info); } catch (e) {} }
    return false;
  }
  try {
    W()[name](opt);
    return true;
  } catch (e) {
    console.warn('[wxapi] wx.' + name + ' 调用异常，已兜底', e);
    if (typeof opt.fail === 'function') { try { opt.fail(e); } catch (e2) {} }
    if (typeof opt.complete === 'function') { try { opt.complete(e); } catch (e3) {} }
    return false;
  }
}

/** 生成某个缺失接口的兜底实现 */
function makeStub(name) {
  return function (options) {
    const opt = options || {};
    console.info('[wxapi] 兜底跳过：wx.' + name);
    // 交互类接口没有 UI 时，按「用户取消」处理，避免业务分支卡死
    if (name === 'showModal' || name === 'showActionSheet' || name === 'getSetting') {
      if (typeof opt.success === 'function') {
        try { opt.success({ confirm: false, cancel: true, tapIndex: -1, authSetting: {} }); } catch (e) {}
      }
    }
    if (typeof opt.fail === 'function') {
      try { opt.fail({ errMsg: name + ':fail 当前环境未实现该接口' }); } catch (e) {}
    }
    if (typeof opt.complete === 'function') {
      try { opt.complete({}); } catch (e) {}
    }
  };
}

// 允许被兜底的非关键接口（真机上这些接口都存在，不会被替换）
const STUB_APIS = [
  'showToast', 'showLoading', 'hideLoading', 'hideToast', 'showModal', 'showActionSheet',
  'pageScrollTo', 'vibrateShort', 'vibrateLong',
  'setNavigationBarTitle', 'setNavigationBarColor', 'showNavigationBarLoading', 'hideNavigationBarLoading',
  'openSetting', 'getSetting', 'setClipboardData', 'makePhoneCall', 'previewImage',
  'openLocation',
  'navigateTo', 'redirectTo', 'navigateBack', 'reLaunch', 'switchTab', 'setTabBarBadge'
];

/**
 * 注入兜底实现（幂等，只在接口缺失时生效）
 * @returns {Array<string>} 被兜底的接口名列表
 */
function install() {
  const w = W();
  if (!w) return [];

  const stubbed = [];
  STUB_APIS.forEach(function (name) {
    if (typeof w[name] !== 'function') {
      w[name] = makeStub(name);
      stubbed.push(name);
    }
  });

  // 同步存储：用内存实现兜底，让预览环境里「历史 / 收藏 / 偏好」依然可用
  if (typeof w.getStorageSync !== 'function') {
    w.getStorageSync = function (key) {
      return Object.prototype.hasOwnProperty.call(MEM_STORE, key) ? MEM_STORE[key] : '';
    };
    stubbed.push('getStorageSync');
  }
  if (typeof w.setStorageSync !== 'function') {
    w.setStorageSync = function (key, value) { MEM_STORE[key] = value; };
    stubbed.push('setStorageSync');
  }
  if (typeof w.removeStorageSync !== 'function') {
    w.removeStorageSync = function (key) { delete MEM_STORE[key]; };
    stubbed.push('removeStorageSync');
  }
  if (typeof w.clearStorageSync !== 'function') {
    w.clearStorageSync = function () {
      Object.keys(MEM_STORE).forEach(function (k) { delete MEM_STORE[k]; });
    };
    stubbed.push('clearStorageSync');
  }
  if (typeof w.getStorageInfoSync !== 'function') {
    w.getStorageInfoSync = function () {
      return { keys: Object.keys(MEM_STORE), currentSize: 0, limitSize: 10240 };
    };
    stubbed.push('getStorageInfoSync');
  }

  if (stubbed.length) {
    console.info('[wxapi] 当前环境缺少 ' + stubbed.length + ' 个接口，已注入安全兜底：' + stubbed.join(', '));
  }
  return stubbed;
}

/**
 * 发起一次定位请求
 * 关键点：必须开启 isHighAccuracy，否则微信只返回「网络/基站」级别的粗略位置，
 * 常见偏差几百米到几公里，跨区县时就会把城市识别成隔壁那座。
 */
function requestOnce(timeoutMs) {
  return new Promise(function (resolve) {
    let settled = false;
    const timer = setTimeout(function () { finish({ ok: false, reason: 'timeout' }); }, timeoutMs);

    function finish(v) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    }

    const api = can('getLocation') ? 'getLocation' : (can('getFuzzyLocation') ? 'getFuzzyLocation' : null);
    if (!api) {
      console.info('[wxapi] 当前环境未提供定位接口，跳过自动定位');
      finish({ ok: false, reason: 'unsupported' });
      return;
    }

    function onSuccess(res) {
      if (res && typeof res.latitude === 'number' && typeof res.longitude === 'number') {
        const acc = (typeof res.accuracy === 'number' && res.accuracy > 0) ? res.accuracy : null;
        finish({
          ok: true,
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: acc,
          api: api
        });
      } else {
        finish({ ok: false, reason: 'nopos' });
      }
    }

    function onFail(err) {
      const msg = (err && err.errMsg) ? String(err.errMsg) : '';
      let reason = 'fail';
      if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) reason = 'denied';
      else if (msg.indexOf('未实现') >= 0 || msg.indexOf('not a function') >= 0 || msg.indexOf('unsupported') >= 0) reason = 'unsupported';
      finish({ ok: false, reason: reason, errMsg: msg });
    }

    const params = api === 'getLocation'
      ? {
          type: 'gcj02',
          isHighAccuracy: true,        // 高精度定位（GPS / 融合定位）
          highAccuracyExpireTime: 8000, // 最多花 8s 争取更好的精度
          success: onSuccess,
          fail: onFail
        }
      : { type: 'wgs84', success: onSuccess, fail: onFail }; // 模糊定位，约 2km 精度

    call(api, params);
  });
}

/** 最近一次可用定位结果（短时间内复用，避免重复申请、也避免刚定位完又被降级成粗略值） */
let locationCache = null;
const LOCATION_CACHE_TTL = 2 * 60 * 1000;

/**
 * 获取当前位置（Promise 版，绝不抛异常）
 * 策略：高精度定位 → 精度不足则重复采样 → 取精度最好（accuracy 最小）的一次
 * @param {Object} [opts] { fresh: 跳过快照强制重新定位, attempts: 最多采样次数, timeout: 单次超时(ms) }
 * @returns {Promise<{ok:boolean, latitude?:number, longitude?:number, accuracy?:number,
 *                    source?:string, samples?:number, cached?:boolean, reason?:string, errMsg?:string}>}
 *   reason: 'denied' 未授权 | 'unsupported' 环境不支持 | 'timeout' 超时 | 'fail' 其他失败 | 'nopos' 未取到坐标
 */
function getLocation(opts) {
  const o = opts || {};

  if (!o.fresh && locationCache && (Date.now() - locationCache.at) < LOCATION_CACHE_TTL) {
    return Promise.resolve(Object.assign({}, locationCache.value, { cached: true }));
  }

  const attempts = Math.max(1, o.attempts || 2);
  const timeout = o.timeout || 7000;

  return new Promise(function (resolve) {
    const readings = [];
    let lastFail = null;

    function finish() {
      if (readings.length) {
        let best = readings[0];
        for (let i = 1; i < readings.length; i++) {
          const a = readings[i].accuracy;
          const b = best.accuracy;
          if (a != null && (b == null || a < b)) best = readings[i];
        }
        const value = {
          ok: true,
          latitude: best.latitude,
          longitude: best.longitude,
          accuracy: best.accuracy,
          source: best.api,
          samples: readings.length
        };
        locationCache = { at: Date.now(), value: value };
        resolve(value);
        return;
      }
      const fail = lastFail || { ok: false, reason: 'fail' };
      resolve({ ok: false, reason: fail.reason, errMsg: fail.errMsg });
    }

    function step(i) {
      requestOnce(timeout).then(function (r) {
        if (r.ok) {
          readings.push(r);
          // 精度已经够用（≤50 米），没必要再采样
          if (r.accuracy != null && r.accuracy <= 50) return finish();
        } else {
          lastFail = r;
          // 未授权 / 环境不支持是确定性失败，重试没有意义
          if (r.reason === 'denied' || r.reason === 'unsupported') return finish();
        }
        if (i + 1 < attempts) return step(i + 1);
        finish();
      });
    }

    step(0);
  });
}

module.exports = {
  can: can,
  call: call,
  install: install,
  getLocation: getLocation
};
