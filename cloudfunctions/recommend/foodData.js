// utils/foodData.js
// 本地人气美食：按菜系给出该地区值得一吃的特色小吃 / 招牌菜。
// 定位到城市后，先按「城市」精确匹配，匹配不到再按「菜系」兜底。

const BY_CUISINE = {
  川菜: [
    { name: '四川火锅', emoji: '🍲', desc: '麻辣牛油锅底，涮毛肚黄喉最经典' },
    { name: '串串香', emoji: '🍢', desc: '一签一串，比火锅更随意' },
    { name: '龙抄手', emoji: '🥟', desc: '皮薄馅嫩，红油或清汤都好' },
    { name: '钵钵鸡', emoji: '🍡', desc: '冷串串，藤椒味清爽上瘾' },
    { name: '钟水饺', emoji: '🥟', desc: '红油水饺，甜辣口' },
    { name: '担担面', emoji: '🍜', desc: '干拌面，麻酱芽菜肉臊香' }
  ],
  粤菜: [
    { name: '广式早茶', emoji: '🫖', desc: '虾饺烧卖凤爪肠粉，一盅两件' },
    { name: '烧腊拼盘', emoji: '🍖', desc: '烧鹅叉烧白切鸡，镬气十足' },
    { name: '煲仔饭', emoji: '🍚', desc: '腊味饭配锅巴，冬日限定' },
    { name: '艇仔粥', emoji: '🥣', desc: '料足绵滑的广式生滚粥' },
    { name: '双皮奶', emoji: '🍮', desc: '顺德甜品，滑嫩奶香' },
    { name: '老火靓汤', emoji: '🍲', desc: '广东人的一日必备' }
  ],
  湘菜: [
    { name: '长沙臭豆腐', emoji: '🟫', desc: '闻着臭吃着香，浇蒜水辣油' },
    { name: '糖油粑粑', emoji: '🍡', desc: '外脆内糯，甜香的小吃' },
    { name: '口味虾', emoji: '🦐', desc: '长沙夜宵之王' },
    { name: '湖南米粉', emoji: '🍜', desc: '码子丰富，早餐一碗满足' },
    { name: '湘西腊味', emoji: '🥓', desc: '烟熏腊肉香肠，蒸炒皆宜' }
  ],
  鲁菜: [
    { name: '把子肉', emoji: '🍖', desc: '济南特色，配米饭浇肉汁' },
    { name: '甜沫', emoji: '🥣', desc: '济南咸味早点糊糊' },
    { name: '油旋', emoji: '🥐', desc: '外酥里嫩的济南名小吃' },
    { name: '海鲜烧烤', emoji: '🦪', desc: '青岛啤酒配烤海鲜' },
    { name: '煎饼卷大葱', emoji: '🌯', desc: '山东硬早点' }
  ],
  苏菜: [
    { name: '蟹黄汤包', emoji: '🥟', desc: '皮薄汁多，先开窗后喝汤' },
    { name: '鸭血粉丝汤', emoji: '🍲', desc: '南京人的日常一碗' },
    { name: '盐水鸭', emoji: '🦆', desc: '南京名产，皮白肉嫩' },
    { name: '糖芋苗', emoji: '🍠', desc: '桂花糖芋艿，甜糯解腻' },
    { name: '奥灶面', emoji: '🍜', desc: '昆山传统红油爆鱼面' }
  ],
  浙菜: [
    { name: '杭州小笼包', emoji: '🥟', desc: '薄皮多汁，蘸醋一绝' },
    { name: '生煎包', emoji: '🥟', desc: '底脆顶松，咬开会爆汁' },
    { name: '酱鸭', emoji: '🦆', desc: '杭州年味，咸甜回甘' },
    { name: '定胜糕', emoji: '🍰', desc: '软糯清甜的传统糕点' },
    { name: '片儿川', emoji: '🍜', desc: '雪菜笋片肉丝面' }
  ],
  闽菜: [
    { name: '沙茶面', emoji: '🍜', desc: '厦门名面，汤浓料足' },
    { name: '土笋冻', emoji: '🍮', desc: '厦门特色，Q弹爽口' },
    { name: '海蛎煎', emoji: '🦪', desc: '蚝仔煎，外酥内嫩' },
    { name: '福州鱼丸', emoji: '🍡', desc: '鱼丸包肉，弹牙鲜香' },
    { name: '佛跳墙', emoji: '🍲', desc: '闽菜之首，坛启荤香四溢' }
  ],
  徽菜: [
    { name: '臭鳜鱼', emoji: '🐟', desc: '闻臭吃香，徽菜头牌' },
    { name: '毛豆腐', emoji: '🧈', desc: '油煎后蘸辣酱，外焦里嫩' },
    { name: '黄山烧饼', emoji: '🥮', desc: '梅干菜扣肉馅，酥香' },
    { name: '徽州一品锅', emoji: '🍲', desc: '层层叠叠一锅炖' }
  ],
  东北菜: [
    { name: '东北烧烤', emoji: '🍢', desc: '大串烤肉配蒜，实诚' },
    { name: '杀猪菜', emoji: '🍲', desc: '酸菜血肠白肉一锅烩' },
    { name: '烤冷面', emoji: '🫓', desc: '街头小吃，酸甜辣' },
    { name: '铁锅炖', emoji: '🍲', desc: '大铁锅炖大鹅，配贴饼子' },
    { name: '大碴粥', emoji: '🥣', desc: '玉米碴子粥，暖胃' }
  ],
  西北菜: [
    { name: '肉夹馍', emoji: '🥙', desc: '西安名吃，馍酥肉烂' },
    { name: '凉皮', emoji: '🥗', desc: '筋道爽滑酸辣开胃' },
    { name: '羊肉串', emoji: '🍢', desc: '孜然飘香的夜宵之王' },
    { name: '馕坑烤包子', emoji: '🥟', desc: '新疆风味，外脆内香' },
    { name: '手抓饭', emoji: '🍚', desc: '羊肉胡萝卜焖饭' }
  ],
  云贵菜: [
    { name: '云南米线', emoji: '🍜', desc: '过桥米线/小锅米线都精彩' },
    { name: '丝娃娃', emoji: '🌯', desc: '贵阳特色，薄饼卷菜浇酸汤' },
    { name: '肠旺面', emoji: '🍜', desc: '贵阳名面，血旺脆哨香' },
    { name: '螺蛳粉', emoji: '🍜', desc: '柳州名吃，酸辣上头' },
    { name: '破酥包', emoji: '🥟', desc: '云南酥皮包子' }
  ],
  京菜: [
    { name: '北京烤鸭', emoji: '🦆', desc: '京城第一名片' },
    { name: '老北京涮羊肉', emoji: '🍲', desc: '铜锅清汤涮鲜羊' },
    { name: '炸酱面', emoji: '🍜', desc: '面码丰富，酱香浓郁' },
    { name: '卤煮火烧', emoji: '🍲', desc: '重口味老北京小吃' },
    { name: '豆汁焦圈', emoji: '🥯', desc: '北京人的早晨，爱恨两极' }
  ],
  本帮菜: [
    { name: '上海生煎', emoji: '🥟', desc: '底脆汁多，撒芝麻葱花' },
    { name: '南翔小笼', emoji: '🥟', desc: '皮薄馅嫩，汤鲜' },
    { name: '排骨年糕', emoji: '🍖', desc: '甜面酱配炸猪排' },
    { name: '蟹壳黄', emoji: '🥮', desc: '酥香小烧饼' }
  ],
  鄂菜: [
    { name: '武汉热干面', emoji: '🍜', desc: '过早标配，芝麻酱香' },
    { name: '三鲜豆皮', emoji: '🥟', desc: '外脆内糯的过早王者' },
    { name: '精武鸭脖', emoji: '🍗', desc: '麻辣卤味，越吃越辣' },
    { name: '糊汤粉', emoji: '🍜', desc: '鲜鱼糊汤配油条' },
    { name: '面窝', emoji: '🥯', desc: '中间薄脆的武汉小吃' }
  ],
  豫菜: [
    { name: '胡辣汤', emoji: '🍲', desc: '河南早餐之魂，配油条' },
    { name: '河南烩面', emoji: '🍜', desc: '羊肉汤烩面，暖身' },
    { name: '开封灌汤包', emoji: '🥟', desc: '先咬小口吸汤' },
    { name: '道口烧鸡', emoji: '🍗', desc: '五香脱骨，中华老字号' }
  ],
  家常菜: [
    { name: '家常小炒', emoji: '🍳', desc: '社区里的家常味道，实惠管饱' },
    { name: '便民快餐', emoji: '🍱', desc: '两荤一素，赶时间首选' },
    { name: '砂锅/麻辣烫', emoji: '🍲', desc: '自选食材，一份搞定' }
  ],
  日料: [
    { name: '日式拉面', emoji: '🍜', desc: '豚骨/酱油/味噌，汤浓面劲' },
    { name: '寿司刺身', emoji: '🍣', desc: '新鲜海味，简约本味' },
    { name: '居酒屋烧鸟', emoji: '🍢', desc: '撸串配清酒' }
  ],
  韩餐: [
    { name: '韩式烤肉', emoji: '🥓', desc: '生菜包肉，蘸酱解腻' },
    { name: '部队锅', emoji: '🍲', desc: '芝士辣汤一锅煮' },
    { name: '韩式炸鸡', emoji: '🍗', desc: '甜辣酱配啤酒' }
  ],
  西餐: [
    { name: '牛排', emoji: '🥩', desc: '几分熟由你定' },
    { name: '意面披萨', emoji: '🍝', desc: '碳水快乐，聚会首选' },
    { name: 'Brunch', emoji: '🍳', desc: '周末睡到自然醒的一顿' }
  ],
  轻食: [
    { name: '沙拉碗', emoji: '🥗', desc: '低卡高蛋白，减脂友好' },
    { name: '三明治', emoji: '🥪', desc: '快手便携' },
    { name: '轻食简餐', emoji: '🥣', desc: '藜麦鸡胸碗，饱腹不胖' }
  ],
  小吃: [
    { name: '夜市小吃', emoji: '🍢', desc: '边走边吃，快乐加倍' },
    { name: '早餐铺', emoji: '🥣', desc: '豆浆油条包子粥' },
    { name: '甜品店', emoji: '🍰', desc: '来点甜的治愈一下' }
  ]
};

// 少数城市的精确覆盖（更有本地味）
const BY_CITY = {
  成都: ['四川火锅', '串串香', '龙抄手', '钵钵鸡', '蛋烘糕'],
  重庆: ['重庆火锅', '小面', '酸辣粉', '毛血旺', '烤鱼'],
  西安: ['肉夹馍', '凉皮', '羊肉泡馍', 'biangbiang面', '烤肉'],
  广州: ['早茶', '肠粉', '烧腊', '艇仔粥', '双皮奶'],
  长沙: ['臭豆腐', '糖油粑粑', '口味虾', '米粉', '湘西腊味'],
  武汉: ['热干面', '三鲜豆皮', '鸭脖', '糊汤粉', '面窝'],
  杭州: ['西湖醋鱼', '龙井虾仁', '片儿川', '知味观小笼', '定胜糕'],
  北京: ['北京烤鸭', '涮羊肉', '炸酱面', '卤煮', '豆汁焦圈'],
  南京: ['盐水鸭', '鸭血粉丝汤', '汤包', '糖芋苗', '皮肚面'],
  上海: ['生煎', '小笼', '排骨年糕', '蟹壳黄', '本帮红烧肉'],
  兰州: ['牛肉面', '酿皮', '灰豆子', '甜醅子'],
  贵阳: ['肠旺面', '丝娃娃', '酸汤鱼', '恋爱豆腐果'],
  昆明: ['过桥米线', '汽锅鸡', '破酥包', '烧饵块'],
  哈尔滨: ['锅包肉', '红肠', '烤冷面', '杀猪菜', '马迭尔冰棍'],
  厦门: ['沙茶面', '海蛎煎', '土笋冻', '花生汤', '姜母鸭']
};

/** 获取某城市/菜系的本地人气美食 */
function getLocalFoods(city) {
  if (!city) return [];
  if (BY_CITY[city.name]) {
    return BY_CITY[city.name].map(function (n) {
      return { name: n, emoji: '📍', desc: '当地人气之选' };
    });
  }
  const list = BY_CUISINE[city.cuisine];
  if (list) return list;
  return BY_CUISINE['家常菜'];
}

module.exports = {
  BY_CUISINE: BY_CUISINE,
  BY_CITY: BY_CITY,
  getLocalFoods: getLocalFoods
};
