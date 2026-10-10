// cloudfunctions/userdata/index.js
// 用户数据云函数：按微信 OPENID 存取「口味偏好 / 菜品收藏 / 店铺收藏 / 使用历史」。
//
// 身份完全来自微信上下文（cloud.getWXContext().OPENID），**不接受客户端传入的 openid**，
// 因此不同用户之间天然隔离。
//
// 合并策略：按「集合级时间戳」取更新的一方（last-write-wins）。
// 这样在手机上取消了收藏，另一台设备同步后也会跟着取消。

const cloud = require('wx-server-sdk');
const pg = require('./pgrest.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_HISTORY = 30;

/** 空状态：客户端与服务端共用的形状 */
function emptyState() {
  return {
    pref: null,
    prefUpdatedAt: 0,
    favorites: [],
    favoritesUpdatedAt: 0,
    shopFavorites: [],
    shopFavoritesUpdatedAt: 0,
    history: [],
    historyUpdatedAt: 0
  };
}

function asNum(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
}

function asArr(v) {
  return Array.isArray(v) ? v : [];
}

/** 归一化客户端/服务端任一侧的状态，避免脏数据入表 */
function normalize(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  s.pref = (raw.pref && typeof raw.pref === 'object') ? raw.pref : null;
  s.prefUpdatedAt = asNum(raw.prefUpdatedAt);
  s.favorites = asArr(raw.favorites);
  s.favoritesUpdatedAt = asNum(raw.favoritesUpdatedAt);
  s.shopFavorites = asArr(raw.shopFavorites);
  s.shopFavoritesUpdatedAt = asNum(raw.shopFavoritesUpdatedAt);
  s.history = asArr(raw.history).slice(0, MAX_HISTORY);
  s.historyUpdatedAt = asNum(raw.historyUpdatedAt);
  return s;
}

/**
 * 合并两端状态：每个集合取 updatedAt 更新的一方。
 * 时间戳相同（例如两端都没动过）时，取条目更多的一方，避免把已有数据清空。
 */
function mergeState(serverRaw, clientRaw) {
  const server = normalize(serverRaw);
  const client = normalize(clientRaw);
  const out = emptyState();

  const pairs = [
    ['pref', 'prefUpdatedAt'],
    ['favorites', 'favoritesUpdatedAt'],
    ['shopFavorites', 'shopFavoritesUpdatedAt'],
    ['history', 'historyUpdatedAt']
  ];

  for (let i = 0; i < pairs.length; i++) {
    const field = pairs[i][0];
    const tsField = pairs[i][1];
    const st = server[tsField];
    const ct = client[tsField];
    let useClient;
    if (ct > st) useClient = true;
    else if (ct < st) useClient = false;
    else useClient = false; // 时间戳相同：以服务端为准（首次同步时服务端会是空，故下面再加兜底）
    if (ct === st && st === 0) {
      // 从未记录过时间戳：谁有数据用谁
      const sv = server[field];
      const cv = client[field];
      const svEmpty = sv === null || (Array.isArray(sv) && sv.length === 0);
      const cvEmpty = cv === null || (Array.isArray(cv) && cv.length === 0);
      if (svEmpty && !cvEmpty) useClient = true;
    }
    if (useClient) {
      out[field] = client[field];
      out[tsField] = ct;
    } else {
      out[field] = server[field];
      out[tsField] = st;
    }
  }

  if (Array.isArray(out.history)) out.history = out.history.slice(0, MAX_HISTORY);
  return out;
}

exports.main = async function (event) {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;

  if (!openid) {
    return {
      ok: false,
      code: 'NO_OPENID',
      message: '拿不到微信身份。请在微信开发者工具或真机上运行（直接调用云函数时没有小程序上下文）。'
    };
  }

  if (!pg.configured()) {
    return {
      ok: false,
      code: 'PG_NOT_CONFIGURED',
      message: '云函数缺少 CLOUDBASE_APIKEY 环境变量，无法访问数据库。'
    };
  }

  const action = event && event.action ? event.action : 'sync';

  try {
    if (action === 'pull') {
      const stored = await pg.getRow(openid);
      return { ok: true, state: normalize(stored) };
    }

    if (action === 'clear') {
      // 只清某个集合，不动其它（清空历史不该影响收藏）
      const field = event.field;
      if (['history', 'favorites', 'shopFavorites'].indexOf(field) < 0) {
        return { ok: false, code: 'BAD_FIELD', message: '只能清 history / favorites / shopFavorites' };
      }
      const stored = normalize(await pg.getRow(openid));
      stored[field] = [];
      stored[field + 'UpdatedAt'] = Date.now();
      await pg.upsertRow(openid, stored);
      return { ok: true, state: stored };
    }

    if (action === 'sync') {
      const stored = await pg.getRow(openid);
      const merged = mergeState(stored, event.state);
      await pg.upsertRow(openid, merged);
      return { ok: true, state: merged, serverTime: Date.now() };
    }

    return { ok: false, code: 'BAD_ACTION', message: '不支持的操作：' + action };
  } catch (e) {
    console.warn('[userdata] 失败', action, e && e.message);
    return { ok: false, code: 'PG_ERROR', message: (e && e.message) || '数据库访问失败' };
  }
};
