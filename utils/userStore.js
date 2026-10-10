// utils/userStore.js
// 用户数据的云端同步：收藏 / 店铺收藏 / 使用历史 / 口味偏好。
// 换手机、换设备后登录同一个微信，数据自动跟着走。
//
// 定位：**纯传输层**。
//   - 不碰本地缓存键（那是 app.js 的职责），只负责「跟云函数说话」+「防抖排队」；
//   - 由 app.js 提供 exportState() / importState()，即本地状态的读与写。
//
// 策略：**offline-first**。
//   本地写入永远立即生效、立刻落盘；云端同步在后台异步进行。
//   断网、未配环境、云函数报错都不影响正常使用，只会在「我的」页显示一句状态。

const config = require('../config.js');

const FN = (config && config.USERDATA_FN) || 'userdata';
const META_KEY = 'eat_sync_meta';

// 本地改动后延迟多久推送。翻收藏、连点几下只会合并成一次请求。
const PUSH_DELAY = 900;
// 冲突重推的间隔（上一次请求还没回来时又发生了改动）
const RETRY_DELAY = 300;

let timer = null;
let running = false;
let queued = false;

// ---------------------------------------------------------------- 同步元信息

function readMeta() {
  try {
    const m = wx.getStorageSync(META_KEY);
    if (m && typeof m === 'object') return m;
  } catch (e) {}
  return { lastSyncAt: 0, lastPushAt: 0, lastError: '', online: false };
}

function writeMeta(patch) {
  const m = Object.assign(readMeta(), patch || {});
  try {
    wx.setStorageSync(META_KEY, m);
  } catch (e) {}
  return m;
}

/** 同步状态快照，供「我的」页展示 */
function meta() {
  return readMeta();
}

/** 云同步是否可用（配置层面） */
function enabled() {
  return !!(config && config.ENABLE_CLOUD && config.ENABLE_SYNC && config.USERDATA_FN);
}

// ---------------------------------------------------------------- 传输

function call(app, data) {
  return new Promise(function (resolve, reject) {
    if (!enabled()) {
      reject(new Error('SYNC_DISABLED'));
      return;
    }
    if (!app || !app.globalData || !app.globalData.cloudReady) {
      reject(new Error('CLOUD_NOT_READY'));
      return;
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      reject(new Error('NO_CLOUD_API'));
      return;
    }
    wx.cloud.callFunction({
      name: FN,
      data: data,
      success: function (res) {
        resolve(res ? res.result : null);
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || 'CALL_FAILED'));
      }
    });
  });
}

/** 云函数业务错误码 → 人话 */
function explain(res, fallback) {
  if (res && res.ok) return '';
  if (!res) return fallback || '云端没有返回内容';
  if (res.code === 'NO_OPENID') return '未识别到微信身份，请在小程序里运行';
  if (res.code === 'PG_NOT_CONFIGURED') return '云端数据库未配置';
  if (res.code === 'BAD_ACTION' || res.code === 'BAD_FIELD') return '云端接口版本不匹配';
  return res.message || res.code || fallback || '同步失败';
}

/** 网络层异常 → 人话 */
function friendly(err) {
  const c = (err && err.message) || '';
  if (c === 'SYNC_DISABLED') return '云同步未开启';
  if (c === 'CLOUD_NOT_READY') return '云开发未就绪';
  if (c === 'NO_CLOUD_API') return '当前环境不支持云函数';
  if (/timeout|fail|network|ERR_|socket/i.test(c)) return '网络不可用';
  return c || '同步失败';
}

// ---------------------------------------------------------------- 对外

/**
 * 全量同步：本地推上去 + 云端拉回来，两侧按「集合级时间戳」合并。
 * 结果会写回 app（importState），返回是否成功。
 */
function sync(app) {
  return call(app, { action: 'sync', state: app.exportState() }).then(function (res) {
    if (!res || !res.ok) {
      const msg = explain(res, '同步失败');
      writeMeta({ lastError: msg, online: false });
      return { ok: false, error: msg };
    }
    app.importState(res.state);
    const m = writeMeta({ lastSyncAt: Date.now(), lastError: '', online: true });
    return { ok: true, state: res.state, meta: m };
  }, function (err) {
    const msg = friendly(err);
    writeMeta({ lastError: msg, online: false });
    return { ok: false, error: msg };
  });
}

/**
 * 本地改动后延迟推送。短时间内多次改动只推最后一次。
 * 不返回 Promise —— 调用方（app.js）不该等待同步。
 */
function schedulePush(app, delay) {
  if (!enabled()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(function () {
    timer = null;
    push(app);
  }, typeof delay === 'number' ? delay : PUSH_DELAY);
}

/** 立刻推送一份完整状态 */
function push(app) {
  if (running) {
    // 上一次还没回来：记个标记，回来后补推一次，保证最后一次改动不被丢掉
    queued = true;
    return Promise.resolve({ ok: false, error: 'BUSY' });
  }
  running = true;
  const done = function (result) {
    running = false;
    if (queued) {
      queued = false;
      schedulePush(app, RETRY_DELAY);
    }
    return result;
  };

  return call(app, { action: 'sync', state: app.exportState() }).then(function (res) {
    if (!res || !res.ok) {
      const msg = explain(res, '同步失败');
      writeMeta({ lastError: msg, online: false });
      return done({ ok: false, error: msg });
    }
    app.importState(res.state);
    const m = writeMeta({ lastSyncAt: Date.now(), lastPushAt: Date.now(), lastError: '', online: true });
    return done({ ok: true, meta: m });
  }, function (err) {
    const msg = friendly(err);
    writeMeta({ lastError: msg, online: false });
    return done({ ok: false, error: msg });
  });
}

/** 把待推送的内容立刻发出去（例如退出「我的」页时） */
function flush(app) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  return push(app);
}

module.exports = {
  meta: meta,
  enabled: enabled,
  sync: sync,
  push: push,
  flush: flush,
  schedulePush: schedulePush
};
