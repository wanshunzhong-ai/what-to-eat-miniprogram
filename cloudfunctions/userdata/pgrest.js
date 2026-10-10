// cloudfunctions/userdata/pgrest.js
// CloudBase PostgreSQL 的最小 REST 客户端（服务端专用）。
//
// 访问路径：https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/<table>
// 鉴权：Authorization: Bearer <API Key>（service_role，绕过 RLS）
//
// ⚠️ 凭证只存在于云函数环境变量 CLOUDBASE_APIKEY 里，绝不下发到小程序前端。
// 表名直接写（不带 schema 前缀），网关默认落在 public schema。

const https = require('https');

const ENV_ID = process.env.SCF_NAMESPACE || process.env.TCB_ENV || '';
const API_KEY = process.env.CLOUDBASE_APIKEY || '';
const TABLE = 'eat_user_data';

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
      timeout: 10000
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
        const msg = (json && (json.message || json.code)) || String(b).slice(0, 200);
        reject(new Error('PG_HTTP_' + res.statusCode + ': ' + msg));
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(new Error('PG_TIMEOUT')); });
    if (payload) req.write(payload);
    req.end();
  });
}

/** 读一个用户的整份数据（不存在返回 null） */
async function getRow(openid) {
  const rows = await request(
    'GET',
    '/' + TABLE + '?select=data&openid=eq.' + encodeURIComponent(openid) + '&limit=1'
  );
  if (Array.isArray(rows) && rows.length && rows[0] && rows[0].data) return rows[0].data;
  return null;
}

/** 写入/覆盖一个用户的整份数据（openid 冲突则合并更新） */
async function upsertRow(openid, data) {
  return request(
    'POST',
    '/' + TABLE + '?on_conflict=openid',
    [{ openid: openid, data: data, updated_at: new Date().toISOString() }],
    { Prefer: 'resolution=merge-duplicates,return=minimal' }
  );
}

module.exports = {
  configured: configured,
  getRow: getRow,
  upsertRow: upsertRow
};
