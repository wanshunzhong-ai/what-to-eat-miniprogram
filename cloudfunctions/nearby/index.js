// cloudfunctions/nearby/index.js
// 「附近美食店」云函数：按「就近」拉取周边餐饮门店。
//
// 为什么放在云函数里：
//   1) 地图 Key 属于敏感凭证，放在云函数环境变量里不会下发到小程序前端；
//   2) 云函数出网不受小程序「request 合法域名」白名单限制，省去后台配置；
//   3) 上游错误码可以在服务端统一翻译成人话再给前端。
//
// 两路数据源（自动降级，保证「不配任何密钥也能用」）：
//   1) 腾讯位置服务「周边搜索」—— 配了环境变量 TENCENT_LBS_KEY 时优先走它。
//      数据最全：有分类、电话、精确距离。Key 需在 https://lbs.qq.com 申请并开通 WebServiceAPI。
//   2) OpenStreetMap Overpass —— 免密钥兜底。没配 Key（或腾讯侧失败）时自动启用，
//      门店名/坐标来自 OSM，距离由本函数按经纬度现算。
//      覆盖度以大城市为主，小城市可能偏少，但不至于「一个店都出不来」。
//
// 环境变量（可选）：
//   TENCENT_LBS_KEY  腾讯位置服务 Key（需开通 WebService API）；不配则走 OSM。
//   OSM_ENDPOINT     自定义 Overpass 镜像（默认用官方镜像 + 备用镜像）

const https = require('https');

const TENCENT_HOST = 'apis.map.qq.com';
const TENCENT_PATH = '/ws/place/v1/search';

// Overpass 镜像；前一个失败自动试下一个。
// 用官方分流端点打头：主站 overpass-api.de 在高频调用时容易 429/504。
const DEFAULT_OSM_ENDPOINTS = [
  'z.overpass-api.de',
  'lz4.overpass-api.de',
  'overpass-api.de'
];

// 腾讯位置服务常见状态码 → 可读提示
const ERR_HINT = {
  110: 'Key 的调用来源未获授权，请到腾讯位置服务控制台检查该 Key 是否勾选了「WebServiceAPI」',
  111: 'Key 签名校验失败，请确认 Key 配置',
  112: 'IP 未授权：请在 Key 设置里把云函数的出口 IP 加入白名单，或取消 IP 限制',
  113: '该 Key 未开通 WebService API 权限',
  120: '腾讯地图当日调用量已达上限',
  121: '腾讯地图并发量已达上限，稍后再试',
  190: '腾讯地图 Key 无效，请检查是否填错',
  199: '该 Key 未启用 WebService API',
  300: '请求参数有误',
  311: 'Key 格式不正确'
};

/** 发一次 HTTPS GET，返回响应体字符串 */
function httpsGet(hostname, rawPath, timeoutMs, headers) {
  return new Promise(function (resolve, reject) {
    const req = https.get(
      {
        hostname: hostname,
        path: rawPath,
        method: 'GET',
        timeout: timeoutMs || 8000,
        headers: headers || {}
      },
      function (res) {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { body += c; });
        res.on('end', function () { resolve({ status: res.statusCode, body: body }); });
      }
    );
    req.on('timeout', function () { req.destroy(new Error('上游超时')); });
    req.on('error', function (err) { reject(err); });
  });
}

/** 两点间距离（米），Haversine */
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
}

// ---------------------------------------------------------------- 腾讯位置服务

/** 把腾讯返回的一条 POI 归一化成前端好用的结构 */
function normalizeTencent(d) {
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

/** 走腾讯位置服务周边搜索；失败返回 { error } */
async function searchTencent(opts) {
  const qs = [];
  qs.push('boundary=' + encodeURIComponent('nearby(' + opts.lat + ',' + opts.lng + ',' + opts.radius + ',1)'));
  if (opts.keyword) qs.push('keyword=' + encodeURIComponent(opts.keyword));
  else qs.push('filter=' + encodeURIComponent('category=美食'));
  qs.push('page_size=' + opts.pageSize);
  qs.push('page_index=' + opts.page);
  qs.push('orderby=' + encodeURIComponent('_distance'));
  qs.push('key=' + encodeURIComponent(opts.key));

  const res = await httpsGet(TENCENT_HOST, TENCENT_PATH + '?' + qs.join('&'), 6000);

  let json;
  try {
    json = JSON.parse(res.body);
  } catch (e) {
    return { error: { code: 'BAD_RESPONSE', message: '腾讯地图返回内容无法解析' } };
  }

  if (json.status !== 0) {
    return {
      error: {
        code: 'LBS_' + json.status,
        message: ERR_HINT[json.status] || json.message || '腾讯地图返回异常'
      }
    };
  }

  const list = (json.data || [])
    .map(normalizeTencent)
    .filter(function (x) { return !!x.name && typeof x.lat === 'number'; });

  return {
    ok: true,
    source: 'tencent',
    count: typeof json.count === 'number' ? json.count : list.length,
    list: list
  };
}

// ---------------------------------------------------------------- OpenStreetMap

const AMENITY_LABEL = {
  restaurant: '餐厅',
  fast_food: '快餐',
  cafe: '咖啡'
};

/**
 * Overpass 查询语句：半径内的餐饮 POI（node + way，way 取中心点）
 * 取 120 条以便本地排序、分页、按关键词筛选。
 */
function overpassQuery(lat, lng, radius) {
  const around = '(around:' + radius + ',' + lat + ',' + lng + ')';
  const kinds = '["amenity"~"^(restaurant|fast_food|cafe)$"]';
  return (
    '[out:json][timeout:10];' +
    '(' +
    'node' + kinds + around + ';' +
    'way' + kinds + around + ';' +
    ');' +
    'out center 120;'
  );
}

function normalizeOsm(el, fromLat, fromLng) {
  const t = el.tags || {};
  const lat = typeof el.lat === 'number' ? el.lat : (el.center && el.center.lat);
  const lng = typeof el.lon === 'number' ? el.lon : (el.center && el.center.lon);
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const addr = [t['addr:city'], t['addr:district'], t['addr:street'], t['addr:housenumber']]
    .filter(function (x) { return !!x; })
    .join('');

  return {
    id: 'osm_' + (el.type || 'n') + '_' + el.id,
    name: t.name || t['name:zh'] || '',
    address: addr || t['addr:full'] || '',
    tel: t.phone || t['contact:phone'] || '',
    category: AMENITY_LABEL[t.amenity] || t.amenity || '餐厅',
    distanceM: distanceM(fromLat, fromLng, lat, lng),
    lat: lat,
    lng: lng,
    adname: t['addr:district'] || t['addr:city'] || ''
  };
}

/** 把 Overpass 的原始响应整理成前端结构（含分页与软关键词筛选） */
function buildOsmResult(json, opts) {
  let list = (json.elements || [])
    .map(function (el) { return normalizeOsm(el, opts.lat, opts.lng); })
    .filter(function (x) { return !!x && !!x.name; })
    .sort(function (a, b) { return a.distanceM - b.distanceM; });

  // 软关键词筛选：筛出来的太少就退回全量，避免一选品类就空
  if (opts.keyword) {
    const kw = opts.keyword;
    const hit = list.filter(function (x) {
      return x.name.indexOf(kw) >= 0 || (x.category && x.category.indexOf(kw) >= 0);
    });
    if (hit.length >= 3) list = hit;
  }

  const start = (opts.page - 1) * opts.pageSize;
  return {
    ok: true,
    source: 'osm',
    count: list.length,
    list: list.slice(start, start + opts.pageSize),
    exhausted: start + opts.pageSize >= list.length
  };
}

/**
 * 走 Overpass 拉周边餐饮；失败返回 { error }。
 *
 * 多个镜像**并行**发起、先到先得：官方镜像单个大约 5~15s，串行等最慢的会很拖；
 * 并行后整体耗时约等于最快那个。若命中「有数据」的结果立刻返回；
 * 都返回空数据时，才退而用第一份空结果（说明这一带 OSM 确实没收录）。
 */
function searchOsm(opts) {
  const override = process.env.OSM_ENDPOINT || '';
  const endpoints = override ? [override] : DEFAULT_OSM_ENDPOINTS;
  const path = '/api/interpreter?data=' + encodeURIComponent(overpassQuery(opts.lat, opts.lng, opts.radius));
  const headers = { 'User-Agent': 'eat-what-today/1.0 (wechat mini program)' };

  return new Promise(function (resolve) {
    let remaining = endpoints.length;
    let emptyResult = null;
    const errs = [];

    function settle() {
      remaining--;
      if (remaining > 0) return;
      if (emptyResult) resolve(emptyResult);
      else resolve({ error: errs[0] || { code: 'OSM_EMPTY', message: 'OpenStreetMap 暂时不可用' } });
    }

    endpoints.forEach(function (host) {
      httpsGet(host, path, 12000, headers)
        .then(function (res) {
          if (res.status !== 200) throw new Error('HTTP ' + res.status);
          const r = buildOsmResult(JSON.parse(res.body), opts);
          if (r.list.length) {
            resolve(r);            // 有数据，先到先得（promise 只会被兑现一次）
            return;
          }
          if (!emptyResult) emptyResult = r;
        })
        .then(function () { settle(); })
        .catch(function (e) {
          errs.push({
            code: 'OSM_REQUEST_FAIL',
            message: 'OpenStreetMap(' + host + ')：' + (e && e.message ? e.message : String(e))
          });
          settle();
        });
    });
  });
}

// ---------------------------------------------------------------- 入口

exports.main = async function (event) {
  const e = event || {};

  const lat = Number(e.lat);
  const lng = Number(e.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat === 0 || lng === 0) {
    return { ok: false, code: 'BAD_PARAM', message: '缺少有效的定位坐标', list: [] };
  }

  const radius = Math.min(Math.max(Math.round(Number(e.radius) || 3000), 500), 10000);
  const page = Math.min(Math.max(Math.round(Number(e.page) || 1), 1), 10);
  const pageSize = Math.min(Math.max(Math.round(Number(e.pageSize) || 20), 1), 20);
  const keyword = typeof e.keyword === 'string' ? e.keyword.trim() : '';

  const opts = { lat: lat, lng: lng, radius: radius, page: page, pageSize: pageSize, keyword: keyword };

  const key = process.env.TENCENT_LBS_KEY || '';
  const errors = [];

  // 1) 有 Key 就先走腾讯，数据质量最好
  if (key) {
    opts.key = key;
    try {
      const r = await searchTencent(opts);
      if (r.ok && r.list.length) {
        return {
          ok: true,
          source: 'tencent',
          count: r.count,
          list: r.list,
          page: page,
          radius: radius,
          keyword: keyword,
          exhausted: r.list.length < pageSize && page * pageSize >= r.count
        };
      }
      errors.push(r.error || { code: 'LBS_EMPTY', message: '腾讯地图没有返回门店' });
    } catch (err) {
      errors.push({ code: 'LBS_REQUEST_FAIL', message: '腾讯地图请求失败：' + (err && err.message ? err.message : String(err)) });
    }
  }

  // 2) 免密钥兜底：Overpass（没配 Key 时这是主路径）
  try {
    const o = await searchOsm(opts);
    if (o.ok) {
      let note = '';
      if (!key) {
        note = o.count
          ? '数据来自 OpenStreetMap；配置腾讯地图 Key 后可获得更精准的门店与电话号码'
          : 'OpenStreetMap 在这一带收录的餐厅很少（中小城市覆盖有限），建议配置腾讯地图 Key 获得完整门店';
      }
      return {
        ok: true,
        source: 'osm',
        count: o.count,
        list: o.list,
        page: page,
        radius: radius,
        keyword: keyword,
        exhausted: !!o.exhausted,
        note: note
      };
    }
    errors.push(o.error);
  } catch (err) {
    errors.push({ code: 'OSM_REQUEST_FAIL', message: 'OpenStreetMap 请求失败：' + (err && err.message ? err.message : String(err)) });
  }

  // 3) 两路都不通：把最可行动的那条错误给前端
  const first = errors[0] || { code: 'UNKNOWN', message: '暂时拿不到附近的店' };
  return {
    ok: false,
    code: first.code,
    message: first.message,
    errors: errors,
    list: []
  };
};
