// cloudfunctions/recommend/userpref.js
// 按微信 OPENID 读写「口味偏好」，让推荐在**服务端**也认人。
//
// 只碰 eat_user_data.data 里的 pref / prefUpdatedAt 两个键，
// 收藏、店铺收藏、历史等其它键原样保留（读-改-写，不整份覆盖）。
//
// 为什么要读云端：换手机后本地没有任何偏好，此时云端记住的口味就成了个性化依据；
// 为什么要写云端：客户端偶尔没带偏好（老版本、第三方调用）时，也能把口味补记下来。

const https = require('https');

const ENV_ID = process.env.SCF_NAMESPACE || process.env.TCB_ENV || '';
const API_KEY = process.env.CLOUDBASE_APIKEY || '';
const TABLE = 'eat_user_data';

// 同容器内的短缓存：一次推荐一次查询，连推几桌时不必反复打数据库
const CACHE_TTL = 60 * 1000;
const prefCache = {};

function configured() {
  return !!(ENV_ID && API_KEY);
}

function request(method, path, body, extraHeaders) {
  return new Promise(function (resolve, reject) {
    if (!configured()) {
      reject(new Error('PG_NOT_CONFIGURED'));
      return;
    }
    const payload = body === undefined ? '' : JSON.stringify(body);
    const headers = Object.assign({
      Authorization: 'Bearer ' + API_KEY,
      'Content-Type': 'application/json'
    }, extraHeaders || {});
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request({
      hostname: ENV_ID + '.api.tcloudbasegateway.com',
      path: '/v1/rdb/rest' + path,
      method: method,
      headers: headers,
      timeout: 6000
    }, function (res) {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { b += c; });
      res.on('end', function () {
        let json = null;
        try { json = b ? JSON.parse(b) : null; } catch (e) { json = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json);
          return;
        }
        const msg = (json && (json.message || json.code)) || String(b).slice(0, 160);
        reject(new Error('PG_HTTP_' + res.statusCode + ': ' + msg));
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(new Error('PG_TIMEOUT')); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function getData(openid) {
  const rows = await request(
    'GET',
    '/' + TABLE + '?select=data&openid=eq.' + encodeURIComponent(openid) + '&limit=1'
  );
  if (Array.isArray(rows) && rows.length && rows[0] && rows[0].data) return rows[0].data;
  return null;
}

async function saveData(openid, data) {
  return request(
    'POST',
    '/' + TABLE + '?on_conflict=openid',
    [{ openid: openid, data: data, updated_at: new Date().toISOString() }],
    { Prefer: 'resolution=merge-duplicates,return=minimal' }
  );
}

/** 这份偏好算不算「用户真的设过」—— 全默认值等于没设 */
function isSet(p) {
  if (!p || typeof p !== 'object') return false;
  const spicy = Number(p.spicy);
  if (isFinite(spicy) && spicy > -1) return true;
  if (p.light) return true;
  if (Array.isArray(p.exclude) && p.exclude.length) return true;
  return false;
}

/** 读该用户保存的口味偏好；没设过 / 读不到都返回 null */
async function readPref(openid) {
  if (!configured() || !openid) return null;

  const hit = prefCache[openid];
  if (hit && (Date.now() - hit.at) < CACHE_TTL) return hit.pref;

  const data = await getData(openid);
  const pref = data && isSet(data.pref) ? data.pref : null;
  prefCache[openid] = { pref: pref, at: Date.now() };
  return pref;
}

/**
 * 记录口味偏好。读-改-写，且只在时间戳更新时才落库，
 * 避免「新手机上刚改的口味」被另一台机器的旧请求覆盖。
 */
async function writePref(openid, pref, updatedAt) {
  if (!configured() || !openid || !isSet(pref)) return false;

  const at = Number(updatedAt) > 0 ? Number(updatedAt) : Date.now();
  const data = (await getData(openid)) || {};
  const oldAt = Number(data.prefUpdatedAt) || 0;

  // 云端已有更新的口味，不覆盖
  if (oldAt > at) return false;

  data.pref = { spicy: pref.spicy, light: !!pref.light, exclude: Array.isArray(pref.exclude) ? pref.exclude : [] };
  data.prefUpdatedAt = at;
  await saveData(openid, data);

  prefCache[openid] = { pref: data.pref, at: Date.now() };
  return true;
}

module.exports = {
  configured: configured,
  isSet: isSet,
  readPref: readPref,
  writePref: writePref
};
