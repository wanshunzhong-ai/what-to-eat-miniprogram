// cloudfunctions/dishes/index.js
// 菜品库云函数 —— 菜品数据的唯一入口。
//
// 设计要点：
//   · 权威数据放在「云存储」的 dishlib/dishlib.json，本函数负责读取下发；
//   · 容器内做 5 分钟缓存，避免每次调用都读存储；
//   · 客户端带 version 请求时，版本未变直接回 unchanged，省流量；
//   · 云存储不可用时，回退到函数内自带的「出厂数据集」（dishlib.json），保证服务不中断。
//
// 支持的 action：
//   list    （默认）取菜品库。入参 { version? }；版本一致返回 { ok, unchanged:true }，否则返回完整 list。
//   get     取单道菜。入参 { id }
//   meta    取版本 / 数量 / 分类与菜系分布（轻量，客户端校验用）
//   publish 热更新：入参 { list, version? }，把数据写入云存储。改菜加菜不用重新发版。
//   seed    把函数内自带的出厂数据集写入云存储（首次播种 / 恢复出厂）
//
// 注意：publish / seed 属于管理动作，生产环境建议加白名单校验（见下方 ADMIN_OPENIDS）。

const cloud = require('wx-server-sdk');
const SEED = require('./dishlib.json');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const CLOUD_PATH = 'dishlib/dishlib.json';
const CACHE_TTL = 5 * 60 * 1000; // 容器内缓存 5 分钟

// 允许执行 publish / seed 的 openid 白名单；留空表示不限制（开发期）。
// 上线前请把管理员 openid 填进来，避免菜品库被随意改写。
const ADMIN_OPENIDS = [];

let cache = null;     // { version, updatedAt, count, list }
let cacheAt = 0;
let cachedFileId = process.env.DISHLIB_FILE_ID || '';

/** 读云存储里的菜品库（带容器缓存） */
async function readFromStorage(force) {
  if (!force && cache && (Date.now() - cacheAt) < CACHE_TTL) return cache;

  const res = await cloud.downloadFile({ fileID: await resolveFileId() });
  const text = res.fileContent.toString('utf8');
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.list)) throw new Error('云端菜品库格式不正确');

  cache = parsed;
  cacheAt = Date.now();
  return cache;
}

/**
 * 拿到云存储文件 ID。
 * 优先用环境变量 DISHLIB_FILE_ID；没有时按「首次播种」处理：
 * 直接把出厂数据集写上去，再记下返回的 fileID。
 */
async function resolveFileId() {
  if (cachedFileId) return cachedFileId;
  const up = await cloud.uploadFile({
    cloudPath: CLOUD_PATH,
    fileContent: Buffer.from(JSON.stringify(SEED), 'utf8')
  });
  cachedFileId = up.fileID;
  return cachedFileId;
}

/** 出厂数据集（云存储不可用时的兜底） */
function fallbackLibrary() {
  return {
    version: (SEED && SEED.version) || 'seed',
    updatedAt: (SEED && SEED.updatedAt) || '',
    count: (SEED && SEED.count) || (SEED && SEED.list ? SEED.list.length : 0),
    list: (SEED && SEED.list) || []
  };
}

/** 轻量信息：不含 list，用于客户端/管理端快速比对 */
function metaOf(lib) {
  const byCategory = {};
  const byCuisine = {};
  const cuisineSet = {};
  (lib.list || []).forEach(function (d) {
    byCategory[d.category] = (byCategory[d.category] || 0) + 1;
    if (!cuisineSet[d.cuisine]) { cuisineSet[d.cuisine] = 1; byCuisine[d.cuisine] = 0; }
    byCuisine[d.cuisine] += 1;
  });
  return {
    version: lib.version || '',
    updatedAt: lib.updatedAt || '',
    count: (lib.list || []).length,
    categories: Object.keys(byCategory).sort(),
    cuisineCount: Object.keys(byCuisine).length,
    byCategory: byCategory,
    byCuisine: byCuisine
  };
}

/** 取库：优先云存储，失败回退出厂数据集 */
async function loadLibrary(force) {
  try {
    const lib = await readFromStorage(force);
    return { lib: lib, source: 'storage' };
  } catch (e) {
    console.warn('[dishes] 读取云存储失败，回退出厂数据集：', (e && e.errMsg) || e);
    return { lib: fallbackLibrary(), source: 'seed' };
  }
}

function canAdmin(openid) {
  if (!ADMIN_OPENIDS.length) return true;
  return ADMIN_OPENIDS.indexOf(openid) >= 0;
}

exports.main = async (event) => {
  const e = event || {};
  const action = e.action || 'list';
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';

  // ---------------- 管理动作：写入云存储 ----------------
  if (action === 'publish' || action === 'seed') {
    if (!canAdmin(openid)) {
      return { ok: false, code: 'FORBIDDEN', message: '没有权限修改菜品库' };
    }

    let payload;
    if (action === 'seed') {
      payload = SEED;
    } else {
      if (!e.list || !Array.isArray(e.list) || !e.list.length) {
        return { ok: false, code: 'BAD_INPUT', message: 'publish 需要传入非空的 list' };
      }
      payload = {
        name: e.name || (SEED && SEED.name) || 'eat-what-today-dishlib',
        version: e.version || String(Date.now()),
        updatedAt: new Date().toISOString(),
        count: e.list.length,
        list: e.list
      };
    }

    try {
      const up = await cloud.uploadFile({
        cloudPath: CLOUD_PATH,
        fileContent: Buffer.from(JSON.stringify(payload), 'utf8')
      });
      cachedFileId = up.fileID;
      cache = payload;
      cacheAt = Date.now();
      return { ok: true, action: action, fileID: up.fileID, version: payload.version, count: payload.count };
    } catch (err) {
      return { ok: false, code: 'UPLOAD_FAIL', message: (err && err.errMsg) || String(err) };
    }
  }

  // ---------------- 读取动作 ----------------
  if (action === 'meta') {
    const r = await loadLibrary(false);
    const m = metaOf(r.lib);
    m.ok = true;
    m.source = r.source;
    return m;
  }

  if (action === 'get') {
    const r = await loadLibrary(false);
    const id = e.id;
    const found = (r.lib.list || []).filter(function (d) { return d.id === id; })[0] || null;
    return { ok: !!found, source: r.source, version: r.lib.version, dish: found };
  }

  // 默认 list
  const r = await loadLibrary(!!e.force);
  const lib = r.lib;

  // 版本一致就不必重传整库
  if (e.version && lib.version && e.version === lib.version) {
    return { ok: true, unchanged: true, source: r.source, version: lib.version, count: lib.list.length };
  }

  return {
    ok: true,
    unchanged: false,
    source: r.source,
    fileID: cachedFileId || '',
    version: lib.version || '',
    updatedAt: lib.updatedAt || '',
    count: lib.list.length,
    list: lib.list
  };
};
