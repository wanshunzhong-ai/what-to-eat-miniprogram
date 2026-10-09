// utils/cities.js
// 城市数据：用于「定位 → 最近城市 → 当地菜系」的识别
// 坐标采用 GCJ-02（火星坐标，与 wx.getLocation 返回一致），仅用于就近匹配

// 有专属菜系的代表性城市
const CITIES = [
  // 华北 / 京菜
  { name: '北京', province: '北京', lng: 116.4074, lat: 39.9042, cuisine: '京菜',
    anchors: [[39.75, 116.14], [40.14, 117.11], [40.46, 115.97], [40.38, 116.84]] },
  { name: '天津', province: '天津', lng: 117.2010, lat: 39.0842, cuisine: '京菜',
    anchors: [[40.04, 117.40], [38.98, 117.70]] },
  { name: '石家庄', province: '河北', lng: 114.5149, lat: 38.0428, cuisine: '家常菜' },
  { name: '唐山', province: '河北', lng: 118.1802, lat: 39.6304, cuisine: '家常菜' },
  { name: '保定', province: '河北', lng: 115.4646, lat: 38.8739, cuisine: '家常菜' },
  { name: '廊坊', province: '河北', lng: 116.6837, lat: 39.5384, cuisine: '家常菜' },
  { name: '秦皇岛', province: '河北', lng: 119.6005, lat: 39.9354, cuisine: '家常菜' },
  { name: '邯郸', province: '河北', lng: 114.5391, lat: 36.6256, cuisine: '家常菜' },
  { name: '沧州', province: '河北', lng: 116.8387, lat: 38.3045, cuisine: '家常菜' },
  { name: '张家口', province: '河北', lng: 114.8866, lat: 40.7686, cuisine: '家常菜' },
  { name: '太原', province: '山西', lng: 112.5489, lat: 37.8706, cuisine: '西北菜' },
  { name: '大同', province: '山西', lng: 113.2951, lat: 40.0903, cuisine: '西北菜' },
  { name: '临汾', province: '山西', lng: 111.5190, lat: 36.0880, cuisine: '西北菜' },
  { name: '呼和浩特', province: '内蒙古', lng: 111.7519, lat: 40.8414, cuisine: '西北菜' },
  { name: '包头', province: '内蒙古', lng: 109.8404, lat: 40.6581, cuisine: '西北菜' },

  // 东北菜
  { name: '沈阳', province: '辽宁', lng: 123.4315, lat: 41.8057, cuisine: '东北菜' },
  { name: '大连', province: '辽宁', lng: 121.6147, lat: 38.9140, cuisine: '东北菜' },
  { name: '鞍山', province: '辽宁', lng: 122.9947, lat: 41.1087, cuisine: '东北菜' },
  { name: '锦州', province: '辽宁', lng: 121.1270, lat: 41.0952, cuisine: '东北菜' },
  { name: '长春', province: '吉林', lng: 125.3245, lat: 43.8868, cuisine: '东北菜' },
  { name: '吉林', province: '吉林', lng: 126.5530, lat: 43.8438, cuisine: '东北菜' },
  { name: '哈尔滨', province: '黑龙江', lng: 126.5350, lat: 45.8038, cuisine: '东北菜' },
  { name: '齐齐哈尔', province: '黑龙江', lng: 123.9180, lat: 47.3543, cuisine: '东北菜' },
  { name: '大庆', province: '黑龙江', lng: 125.1034, lat: 46.5895, cuisine: '东北菜' },

  // 本帮 / 江浙
  { name: '上海', province: '上海', lng: 121.4737, lat: 31.2304, cuisine: '本帮菜',
    anchors: [[30.74, 121.34], [31.62, 121.40], [30.90, 121.90]] },
  { name: '南京', province: '江苏', lng: 118.7969, lat: 32.0603, cuisine: '苏菜' },
  { name: '苏州', province: '江苏', lng: 120.5954, lat: 31.2989, cuisine: '苏菜' },
  { name: '无锡', province: '江苏', lng: 120.3119, lat: 31.4912, cuisine: '苏菜' },
  { name: '常州', province: '江苏', lng: 119.9741, lat: 31.8112, cuisine: '苏菜' },
  { name: '扬州', province: '江苏', lng: 119.4215, lat: 32.3932, cuisine: '苏菜' },
  { name: '南通', province: '江苏', lng: 120.8943, lat: 31.9802, cuisine: '苏菜' },
  { name: '徐州', province: '江苏', lng: 117.1848, lat: 34.2617, cuisine: '苏菜' },
  { name: '镇江', province: '江苏', lng: 119.4250, lat: 32.1942, cuisine: '苏菜' },
  { name: '泰州', province: '江苏', lng: 119.9227, lat: 32.4558, cuisine: '苏菜' },
  { name: '盐城', province: '江苏', lng: 120.1631, lat: 33.3496, cuisine: '苏菜' },
  { name: '淮安', province: '江苏', lng: 119.0153, lat: 33.6104, cuisine: '苏菜' },
  { name: '连云港', province: '江苏', lng: 119.1630, lat: 34.6010, cuisine: '苏菜' },
  { name: '杭州', province: '浙江', lng: 120.1551, lat: 30.2741, cuisine: '浙菜' },
  { name: '宁波', province: '浙江', lng: 121.5440, lat: 29.8683, cuisine: '浙菜' },
  { name: '温州', province: '浙江', lng: 120.6994, lat: 27.9944, cuisine: '浙菜' },
  { name: '绍兴', province: '浙江', lng: 120.5820, lat: 29.9970, cuisine: '浙菜' },
  { name: '嘉兴', province: '浙江', lng: 120.7555, lat: 30.7460, cuisine: '浙菜' },
  { name: '金华', province: '浙江', lng: 119.6496, lat: 29.0895, cuisine: '浙菜' },
  { name: '湖州', province: '浙江', lng: 120.0860, lat: 30.8942, cuisine: '浙菜' },
  { name: '台州', province: '浙江', lng: 121.4287, lat: 28.6614, cuisine: '浙菜' },
  { name: '舟山', province: '浙江', lng: 122.2072, lat: 29.9853, cuisine: '浙菜' },

  // 徽菜
  { name: '合肥', province: '安徽', lng: 117.2272, lat: 31.8206, cuisine: '徽菜' },
  { name: '芜湖', province: '安徽', lng: 118.3764, lat: 31.3263, cuisine: '徽菜' },
  { name: '黄山', province: '安徽', lng: 118.3376, lat: 29.7147, cuisine: '徽菜' },
  { name: '马鞍山', province: '安徽', lng: 118.5063, lat: 31.6704, cuisine: '徽菜' },
  { name: '蚌埠', province: '安徽', lng: 117.3893, lat: 32.9166, cuisine: '徽菜' },
  { name: '安庆', province: '安徽', lng: 117.0635, lat: 30.5228, cuisine: '徽菜' },

  // 闽菜
  { name: '福州', province: '福建', lng: 119.2965, lat: 26.0745, cuisine: '闽菜' },
  { name: '厦门', province: '福建', lng: 118.0894, lat: 24.4798, cuisine: '闽菜' },
  { name: '泉州', province: '福建', lng: 118.6757, lat: 24.8741, cuisine: '闽菜' },
  { name: '莆田', province: '福建', lng: 119.0078, lat: 25.4310, cuisine: '闽菜' },
  { name: '漳州', province: '福建', lng: 117.6471, lat: 24.5130, cuisine: '闽菜' },
  { name: '龙岩', province: '福建', lng: 117.0175, lat: 25.0751, cuisine: '闽菜' },

  // 鲁菜
  { name: '济南', province: '山东', lng: 117.1205, lat: 36.6510, cuisine: '鲁菜' },
  { name: '青岛', province: '山东', lng: 120.3826, lat: 36.0671, cuisine: '鲁菜' },
  { name: '烟台', province: '山东', lng: 121.4479, lat: 37.4638, cuisine: '鲁菜' },
  { name: '潍坊', province: '山东', lng: 119.1618, lat: 36.7069, cuisine: '鲁菜' },
  { name: '淄博', province: '山东', lng: 118.0479, lat: 36.8149, cuisine: '鲁菜' },
  { name: '济宁', province: '山东', lng: 116.5871, lat: 35.4149, cuisine: '鲁菜' },
  { name: '临沂', province: '山东', lng: 118.3563, lat: 35.1045, cuisine: '鲁菜' },
  { name: '威海', province: '山东', lng: 122.1201, lat: 37.5133, cuisine: '鲁菜' },

  // 豫菜 / 鄂菜 / 湘菜 / 赣菜
  { name: '郑州', province: '河南', lng: 113.6254, lat: 34.7466, cuisine: '豫菜' },
  { name: '洛阳', province: '河南', lng: 112.4540, lat: 34.6197, cuisine: '豫菜' },
  { name: '开封', province: '河南', lng: 114.3076, lat: 34.7972, cuisine: '豫菜' },
  { name: '新乡', province: '河南', lng: 113.9268, lat: 35.3030, cuisine: '豫菜' },
  { name: '安阳', province: '河南', lng: 114.3931, lat: 36.0977, cuisine: '豫菜' },
  { name: '南阳', province: '河南', lng: 112.5286, lat: 32.9908, cuisine: '豫菜' },
  { name: '武汉', province: '湖北', lng: 114.3055, lat: 30.5928, cuisine: '鄂菜' },
  { name: '宜昌', province: '湖北', lng: 111.2865, lat: 30.6919, cuisine: '鄂菜' },
  { name: '襄阳', province: '湖北', lng: 112.1220, lat: 32.0090, cuisine: '鄂菜' },
  { name: '十堰', province: '湖北', lng: 110.7873, lat: 32.6469, cuisine: '鄂菜' },
  { name: '荆州', province: '湖北', lng: 112.2410, lat: 30.3350, cuisine: '鄂菜' },
  { name: '恩施', province: '湖北', lng: 109.4868, lat: 30.2745, cuisine: '鄂菜' },
  { name: '长沙', province: '湖南', lng: 112.9388, lat: 28.2282, cuisine: '湘菜' },
  { name: '株洲', province: '湖南', lng: 113.1340, lat: 27.8274, cuisine: '湘菜' },
  { name: '湘潭', province: '湖南', lng: 112.9441, lat: 27.8296, cuisine: '湘菜' },
  { name: '衡阳', province: '湖南', lng: 112.5719, lat: 26.8934, cuisine: '湘菜' },
  { name: '岳阳', province: '湖南', lng: 113.1291, lat: 29.3573, cuisine: '湘菜' },
  { name: '常德', province: '湖南', lng: 111.6913, lat: 29.0402, cuisine: '湘菜' },
  { name: '南昌', province: '江西', lng: 115.8581, lat: 28.6820, cuisine: '家常菜' },
  { name: '九江', province: '江西', lng: 115.9928, lat: 29.7120, cuisine: '家常菜' },
  { name: '赣州', province: '江西', lng: 114.9350, lat: 25.8310, cuisine: '家常菜' },
  { name: '上饶', province: '江西', lng: 117.9434, lat: 28.4548, cuisine: '家常菜' },

  // 粤菜 / 华南
  { name: '广州', province: '广东', lng: 113.2644, lat: 23.1291, cuisine: '粤菜' },
  { name: '深圳', province: '广东', lng: 114.0579, lat: 22.5431, cuisine: '粤菜' },
  { name: '佛山', province: '广东', lng: 113.1220, lat: 23.0288, cuisine: '粤菜' },
  { name: '东莞', province: '广东', lng: 113.7518, lat: 23.0207, cuisine: '粤菜' },
  { name: '珠海', province: '广东', lng: 113.5767, lat: 22.2707, cuisine: '粤菜' },
  { name: '中山', province: '广东', lng: 113.3926, lat: 22.5170, cuisine: '粤菜' },
  { name: '汕头', province: '广东', lng: 116.6822, lat: 23.3535, cuisine: '粤菜' },
  { name: '惠州', province: '广东', lng: 114.4161, lat: 23.1114, cuisine: '粤菜' },
  { name: '江门', province: '广东', lng: 113.0819, lat: 22.5787, cuisine: '粤菜' },
  { name: '湛江', province: '广东', lng: 110.3594, lat: 21.2707, cuisine: '粤菜' },
  { name: '海口', province: '海南', lng: 110.1999, lat: 20.0444, cuisine: '粤菜' },
  { name: '三亚', province: '海南', lng: 109.5082, lat: 18.2479, cuisine: '粤菜' },
  { name: '香港', province: '中国香港', lng: 114.1694, lat: 22.3193, cuisine: '粤菜' },
  { name: '澳门', province: '中国澳门', lng: 113.5439, lat: 22.1987, cuisine: '粤菜' },

  // 川渝 / 云贵
  { name: '成都', province: '四川', lng: 104.0665, lat: 30.5723, cuisine: '川菜' },
  { name: '重庆', province: '重庆', lng: 106.5516, lat: 29.5630, cuisine: '川菜',
    anchors: [[30.81, 108.41], [29.70, 107.39], [29.53, 108.77], [29.97, 106.27]] },
  { name: '绵阳', province: '四川', lng: 104.6796, lat: 31.4675, cuisine: '川菜' },
  { name: '乐山', province: '四川', lng: 103.7656, lat: 29.5521, cuisine: '川菜' },
  { name: '宜宾', province: '四川', lng: 104.6308, lat: 28.7602, cuisine: '川菜' },
  { name: '德阳', province: '四川', lng: 104.3980, lat: 31.1280, cuisine: '川菜' },
  { name: '南充', province: '四川', lng: 106.1106, lat: 30.8373, cuisine: '川菜' },
  { name: '泸州', province: '四川', lng: 105.4433, lat: 28.8715, cuisine: '川菜' },
  { name: '昆明', province: '云南', lng: 102.8330, lat: 24.8801, cuisine: '云贵菜' },
  { name: '大理', province: '云南', lng: 100.2676, lat: 25.6065, cuisine: '云贵菜' },
  { name: '丽江', province: '云南', lng: 100.2330, lat: 26.8721, cuisine: '云贵菜' },
  { name: '曲靖', province: '云南', lng: 103.7963, lat: 25.4901, cuisine: '云贵菜' },
  { name: '贵阳', province: '贵州', lng: 106.6302, lat: 26.6477, cuisine: '云贵菜' },
  { name: '遵义', province: '贵州', lng: 106.9272, lat: 27.7256, cuisine: '云贵菜' },
  { name: '六盘水', province: '贵州', lng: 104.8333, lat: 26.5933, cuisine: '云贵菜' },
  { name: '南宁', province: '广西', lng: 108.3200, lat: 22.8240, cuisine: '云贵菜' },
  { name: '桂林', province: '广西', lng: 110.2900, lat: 25.2740, cuisine: '云贵菜' },
  { name: '柳州', province: '广西', lng: 109.4155, lat: 24.3255, cuisine: '云贵菜' },
  { name: '北海', province: '广西', lng: 109.1194, lat: 21.4733, cuisine: '云贵菜' },

  // 西北
  { name: '西安', province: '陕西', lng: 108.9398, lat: 34.3416, cuisine: '西北菜' },
  { name: '宝鸡', province: '陕西', lng: 107.1447, lat: 34.3613, cuisine: '西北菜' },
  { name: '咸阳', province: '陕西', lng: 108.7051, lat: 34.3330, cuisine: '西北菜' },
  { name: '兰州', province: '甘肃', lng: 103.8343, lat: 36.0611, cuisine: '西北菜' },
  { name: '天水', province: '甘肃', lng: 105.7249, lat: 34.5809, cuisine: '西北菜' },
  { name: '西宁', province: '青海', lng: 101.7782, lat: 36.6171, cuisine: '西北菜' },
  { name: '银川', province: '宁夏', lng: 106.2309, lat: 38.4872, cuisine: '西北菜' },
  { name: '乌鲁木齐', province: '新疆', lng: 87.6168, lat: 43.8256, cuisine: '西北菜' },
  { name: '喀什', province: '新疆', lng: 75.9898, lat: 39.4704, cuisine: '西北菜' },
  { name: '拉萨', province: '西藏', lng: 91.1409, lat: 29.6456, cuisine: '西北菜' }
];

// 所有菜系（用于展示与兜底）
const CUISINES = [
  '川菜', '粤菜', '湘菜', '鲁菜', '苏菜', '浙菜', '闽菜', '徽菜',
  '东北菜', '西北菜', '云贵菜', '京菜', '本帮菜', '鄂菜', '豫菜',
  '家常菜', '日料', '韩餐', '西餐', '轻食', '小吃'
];

function toRad(d) {
  return (d * Math.PI) / 180;
}

/** 计算两点球面距离（km） */
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * 到某座城市的距离：取「市中心 + 各辖域锚点」中的最小值
 * 直辖市（北京/上海/天津/重庆）辖区跨度可达数百公里，只用一个中心点会
 * 把远郊区县识别成隔壁城市，因此这些城市额外配置了 anchors。
 */
function cityDistance(c, lat, lng) {
  let best = distanceKm(lat, lng, c.lat, c.lng);
  const anchors = c.anchors;
  if (anchors && anchors.length) {
    for (let i = 0; i < anchors.length; i++) {
      const d = distanceKm(lat, lng, anchors[i][0], anchors[i][1]);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * 按距离升序返回候选城市（含距离，单位 km）
 * 用于「离你最近的城市」列表，让用户能自己纠正识别结果
 */
function findCandidates(lat, lng, limit) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return [];
  const scored = [];
  for (let i = 0; i < CITIES.length; i++) {
    const c = CITIES[i];
    scored.push({ city: c, d: cityDistance(c, lat, lng) });
  }
  scored.sort(function (a, b) { return a.d - b.d; });
  const n = (limit && limit > 0) ? limit : scored.length;
  return scored.slice(0, n).map(function (x) {
    return Object.assign({}, x.city, { distanceKm: Math.round(x.d) });
  });
}

/**
 * 根据经纬度找最近的城市，并附带置信度信息（供页面决定是否需要让用户确认）
 * - distanceKm    到该城市中心的大致距离
 * - lowConfidence 距离过远，说明附近没有收录的城市，结果只是兜底
 * - ambiguous     最近的另一座城市距离很近且菜系不同 → 建议让用户确认
 * - alternatives  候选城市列表（ambiguous 时用于让用户手动确认）
 */
function findNearest(lat, lng) {
  const list = findCandidates(lat, lng, 3);
  if (!list.length) return null;

  const best = list[0];
  const second = list[1];
  const gap = second ? (second.distanceKm - best.distanceKm) : Infinity;

  // 两座城市都很近（最近的在 80km 内）、彼此相差不到 25km，且菜系不同 → 定位落在地界附近
  const ambiguous = !!(second && best.distanceKm <= 80 && gap < 25 && second.cuisine !== best.cuisine);

  return Object.assign({}, best, {
    lowConfidence: best.distanceKm > 150,
    ambiguous: ambiguous,
    alternatives: ambiguous ? list.map(function (c) {
      return { name: c.name, province: c.province, cuisine: c.cuisine, distanceKm: c.distanceKm };
    }) : []
  });
}

/** 热门城市（首页快捷选择） */
const HOT_CITIES = ['北京', '上海', '广州', '深圳', '成都', '重庆', '杭州', '武汉', '西安', '长沙'];

/** 按名称/省份/拼音首字母模糊搜索 */
function search(keyword) {
  const kw = (keyword || '').trim().toLowerCase();
  if (!kw) return CITIES;
  return CITIES.filter(function (c) {
    return (
      c.name.indexOf(kw) >= 0 ||
      c.province.indexOf(kw) >= 0
    );
  });
}

/** 按名称精确获取城市 */
function getByName(name) {
  for (let i = 0; i < CITIES.length; i++) {
    if (CITIES[i].name === name) return Object.assign({}, CITIES[i]);
  }
  return null;
}

module.exports = {
  CITIES: CITIES,
  CUISINES: CUISINES,
  HOT_CITIES: HOT_CITIES,
  findNearest: findNearest,
  findCandidates: findCandidates,
  search: search,
  getByName: getByName,
  distanceKm: distanceKm
};
