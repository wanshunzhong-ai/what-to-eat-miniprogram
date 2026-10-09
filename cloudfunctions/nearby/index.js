// cloudfunctions/nearby/index.js
// 「附近美食店」云函数：代理腾讯位置服务的「周边搜索」。
//
// 为什么放在云函数里：
//   1) 地图 Key 属于敏感凭证，放在云函数环境变量里不会下发到小程序前端；
//   2) 云函数出网不受小程序「request 合法域名」白名单限制，省去后台配置；
//   3) 腾讯侧返回的错误码可以在服务端统一翻译成人话再给前端。
//
// 环境变量：
//   TENCENT_LBS_KEY  腾讯位置服务 Key（需开通 WebService API）

const https = require('https');

const LBS_HOST = 'apis.map.qq.com';
const LBS_PATH = '/ws/place/v1/search';

// 腾讯位置服务常见状态码 → 可读提示
const ERR_HINT = {
  110: 'Key 的调用来源未获授权，请到腾讯位置服务控制台检查该 Key 是否勾选了「WebServiceAPI」',
  111: 'Key 签名校验失败，请确认 Key 配置',
  112: 'IP 未授权：请在 Key 设置里把云函数的出口 IP 加入白名单，或取消 IP 限制',
  113: '该 Key 未开通 WebService API 权限',
  120: '当日调用量已达上限',
  121: '并发量已达上限，稍后再试',
  190: 'Key 无效，请检查是否填错',
  199: '该 Key 未启用 WebService API',
  300: '请求参数有误',
  311: 'Key 格式不正确'
};

/** 发起一次周边搜索，返回原始响应字符串 */
function request(rawPath) {
  return new Promise(function (resolve, reject) {
    const req = https.get(
      {
        hostname: LBS_HOST,
        path: rawPath,
        method: 'GET',
        timeout: 6000
      },
      function (res) {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { body += c; });
        res.on('end', function () { resolve(body); });
      }
    );
    req.on('timeout', function () {
      req.destroy(new Error('地图服务响应超时'));
    });
    req.on('error', function (err) { reject(err); });
  });
}

/** 把腾讯返回的一条 POI 归一化成前端好用的结构 */
function normalize(d) {
  const loc = d.location || {};
  return {
    id: String(d.id || ''),
    name: d.title || '',
    address: d.address || '',
    tel: d.tel || '',
    category: d.category || '',
    distanceM: typeof d._distance === 'number' ? d._distance : null,
    lat: typeof loc.lat === 'number' ? loc.lat : null,
    lng: typeof loc.lng === 'number' ? loc.lng : null,
    adname: (d.ad_info && d.ad_info.name) || ''
  };
}

exports.main = async function (event) {
  const e = event || {};

  const key = process.env.TENCENT_LBS_KEY || '';
  if (!key) {
    return {
      ok: false,
      code: 'NO_KEY',
      message: '还没配置腾讯位置服务 Key，附近店铺暂时无法获取',
      list: []
    };
  }

  const lat = Number(e.lat);
  const lng = Number(e.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat === 0 || lng === 0) {
    return { ok: false, code: 'BAD_PARAM', message: '缺少有效的定位坐标', list: [] };
  }

  // 半径 500m ~ 10km；末位 1 表示结果不足时自动向外扩展
  const radius = Math.min(Math.max(Math.round(Number(e.radius) || 3000), 500), 10000);
  const page = Math.min(Math.max(Math.round(Number(e.page) || 1), 1), 10);
  const pageSize = Math.min(Math.max(Math.round(Number(e.pageSize) || 20), 1), 20);
  const keyword = typeof e.keyword === 'string' ? e.keyword.trim() : '';

  const qs = [];
  qs.push('boundary=' + encodeURIComponent('nearby(' + lat + ',' + lng + ',' + radius + ',1)'));
  if (keyword) qs.push('keyword=' + encodeURIComponent(keyword));
  else qs.push('filter=' + encodeURIComponent('category=美食'));
  qs.push('page_size=' + pageSize);
  qs.push('page_index=' + page);
  qs.push('orderby=' + encodeURIComponent('_distance'));
  qs.push('key=' + encodeURIComponent(key));

  try {
    const body = await request(LBS_PATH + '?' + qs.join('&'));
    let json;
    try {
      json = JSON.parse(body);
    } catch (parseErr) {
      return { ok: false, code: 'BAD_RESPONSE', message: '地图服务返回内容无法解析', list: [] };
    }

    if (json.status !== 0) {
      return {
        ok: false,
        code: 'LBS_' + json.status,
        message: ERR_HINT[json.status] || json.message || '地图服务返回异常',
        list: []
      };
    }

    const list = (json.data || [])
      .map(normalize)
      .filter(function (x) { return !!x.name && typeof x.lat === 'number'; });

    return {
      ok: true,
      source: 'tencent',
      count: typeof json.count === 'number' ? json.count : list.length,
      list: list,
      page: page,
      radius: radius,
      keyword: keyword
    };
  } catch (err) {
    return {
      ok: false,
      code: 'REQUEST_FAIL',
      message: '地图服务请求失败：' + (err && err.message ? err.message : String(err)),
      list: []
    };
  }
};
