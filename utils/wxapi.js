// utils/wxapi.js
// wx 接口安全调用层。
//
// 背景：不同运行环境（真机 / 开发者工具 / 小程序预览沙箱）实现的 wx 接口并不一致。
// 例如预览环境就没有实现 wx.getLocation，若直接调用会抛
// "wx.getLocation is not a function"，进而中断页面生命周期（onShow 等）。
//
// 本模块做两件事：
//   1) install()：启动时把缺失的 wx 接口补成安全兜底实现（真机上不会触发，行为不变）；
//   2) getLocation()：定位接口的 Promise 封装，目标是把「精确位置」拿到手，
//      环境不支持时优雅返回「不支持」，由页面提示手动选城市，而不是抛异常。

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

/* ------------------------------------------------------------------ 定位
 * 目标：拿到「精确位置」，而不是一个"够用"的粗略坐标。
 *
 * 微信定位分两档：
 *   · 默认（不传 isHighAccuracy）—— 网络 / 基站定位，偏差常常几百米到几公里；
 *   · 高精度（isHighAccuracy: true + highAccuracyExpireTime）—— 融合 GPS。
 *     官方说明：「高精度定位超时时间(ms)，指定时间内返回最高精度，
 *     该值 3000ms 以上高精度定位才有效果」。
 *     即：这段时间内持续收敛，窗口结束（或提前达标）时回调返回期间的最高精度。
 *
 * 所以有两条硬性约束，破坏任何一条都会悄悄退化成粗略定位：
 *   1) highAccuracyExpireTime 必须 ≥ 3000ms，否则高精度模式形同虚设；
 *   2) 我们自己的等待上限 **必须大于** highAccuracyExpireTime，
 *      否则会在系统交出高精度结果之前就自行判超时、把结果扔掉。
 *      —— 旧实现是 7000ms < 8000ms，属于典型的"白等一场"。
 *
 * 另：`wx.getLocation` 自基础库 2.17.0 起有调用频率限制，连续瞬发会被限流，
 * 因此补采之间留了间隔。
 */

const HIGH_ACCURACY_EXPIRE = 6000;                    // 高精度收敛窗口（官方要求 ≥3000）
const REQUEST_TIMEOUT = HIGH_ACCURACY_EXPIRE + 4000;  // 单次等待上限，必须 > 上面这个值
const RETRY_GAP = 600;      // 补采间隔：避开 2.17.0 起的接口调用频率限制
const GOOD_ENOUGH = 30;     // 精度 ≤30m 视为够准，不再补采
const CACHE_TTL = 60 * 1000; // 定位结果缓存时长；要精度就不能缓存太久

/**
 * 取「平面误差（米）」，越小越准。
 * accuracy 是官方给的「位置精确度」；个别机型缺失时退回 horizontalAccuracy（水平精度）。
 */
function pickAccuracy(res) {
  if (!res) return null;
  if (typeof res.accuracy === 'number' && res.accuracy > 0) return res.accuracy;
  if (typeof res.horizontalAccuracy === 'number' && res.horizontalAccuracy > 0) return res.horizontalAccuracy;
  return null;
}

/**
 * 发起一次高精度定位请求（绝不抛异常）
 * @param {number} timeoutMs 单次等待上限（必须大于高精度窗口，否则拿不到高精度结果）
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

    // 只认精确的 getLocation。
    // getFuzzyLocation 是 ~2km 精度的模糊定位，与本模块「要精确位置」的目标直接冲突，
    // 因此不再作为兜底——拿不到就如实上报 unsupported，由页面提示手动选城市。
    if (!can('getLocation')) {
      console.info('[wxapi] 当前环境未提供 wx.getLocation，跳过自动定位');
      finish({ ok: false, reason: 'unsupported' });
      return;
    }

    function onSuccess(res) {
      if (res && typeof res.latitude === 'number' && typeof res.longitude === 'number') {
        finish({
          ok: true,
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: pickAccuracy(res),
          api: 'getLocation'
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

    call('getLocation', {
      type: 'gcj02',                              // 与 wx.openLocation / 地图组件同一坐标系
      isHighAccuracy: true,                       // 开启 GPS 融合定位（否则只有基站级精度）
      highAccuracyExpireTime: HIGH_ACCURACY_EXPIRE,
      success: onSuccess,
      fail: onFail
    });
  });
}

/** 最近一次可用定位结果（短时间内复用，避免重复申请、也避免刚定位完又被降级成粗略值） */
let locationCache = null;

/**
 * 获取当前位置（Promise 版，绝不抛异常）
 * 策略：高精度定位 → 精度不足则间隔补采 → 取精度最好（accuracy 最小）的一次
 * @param {Object} [opts] { fresh: 跳过快照强制重新定位, attempts: 最多采样次数(1~4), timeout: 单次超时(ms) }
 * @returns {Promise<{ok:boolean, latitude?:number, longitude?:number, accuracy?:number,
 *                    precise?:boolean, source?:string, samples?:number, cached?:boolean,
 *                    reason?:string, errMsg?:string}>}
 *   reason: 'denied' 未授权 | 'unsupported' 环境不支持 | 'timeout' 超时 | 'fail' 其他失败 | 'nopos' 未取到坐标
 *   precise: accuracy ≤ 100m，够用来做「附近」判断
 */
function getLocation(opts) {
  const o = opts || {};

  if (!o.fresh && locationCache && (Date.now() - locationCache.at) < CACHE_TTL) {
    return Promise.resolve(Object.assign({}, locationCache.value, { cached: true }));
  }

  const attempts = Math.max(1, Math.min(4, o.attempts || 3));
  const timeout = o.timeout || REQUEST_TIMEOUT;

  return new Promise(function (resolve) {
    const readings = [];
    let lastFail = null;

    /** 从已拿到的采样里挑精度最好的一次 */
    function bestReading() {
      let b = readings[0];
      for (let i = 1; i < readings.length; i++) {
        const a = readings[i].accuracy;
        if (a != null && (b.accuracy == null || a < b.accuracy)) b = readings[i];
      }
      return b;
    }

    function finish() {
      if (!readings.length) {
        const f = lastFail || { ok: false, reason: 'fail' };
        resolve({ ok: false, reason: f.reason, errMsg: f.errMsg });
        return;
      }
      const best = bestReading();
      const acc = best.accuracy;
      const value = {
        ok: true,
        latitude: best.latitude,
        longitude: best.longitude,
        accuracy: acc,
        // 够不够用来算「附近」：≤100m 视为精确
        precise: acc != null && acc <= 100,
        source: best.api,
        samples: readings.length
      };
      locationCache = { at: Date.now(), value: value };
      resolve(value);
    }

    function step(i) {
      requestOnce(timeout).then(function (r) {
        if (r.ok) {
          readings.push(r);
          // 精度已经够用，没必要再采样（也避免白白触发频率限制）
          if (r.accuracy != null && r.accuracy <= GOOD_ENOUGH) return finish();
        } else {
          lastFail = r;
          // 未授权 / 环境不支持是确定性失败，重试没有意义
          if (r.reason === 'denied' || r.reason === 'unsupported') return finish();
        }
        if (i + 1 < attempts) {
          // 隔一下再补采：既避开调用频率限制，也给系统一点时间收敛
          setTimeout(function () { step(i + 1); }, RETRY_GAP);
          return;
        }
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
