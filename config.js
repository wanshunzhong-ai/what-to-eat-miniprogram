// config.js
// 云开发（CloudBase / 微信云开发）配置。
// 环境 ID 与云函数名集中在这里，切换环境时只改这一个文件。

module.exports = {
  // 是否启用云开发：开启后推荐计算优先在云函数里执行；关闭或云端不可用时自动回退到本地逻辑。
  ENABLE_CLOUD: true,

  // CloudBase 环境 ID（来自云开发控制台 / 环境列表）
  ENV_ID: 'zws-04161130-l-d6gd7g8f0c8c7fb17',

  // 推荐云函数名（与 cloudfunctions/recommend 目录名一致）
  RECOMMEND_FN: 'recommend',

  // 菜品库云函数名（与 cloudfunctions/dishes 目录名一致）
  // 菜品库不内嵌在小程序里：由它从云存储读取后下发，加菜改菜无需发版。
  DISHES_FN: 'dishes',

  // 附近美食店云函数名（与 cloudfunctions/nearby 目录名一致）
  // 它代理腾讯位置服务的周边搜索；地图 Key 存在云函数环境变量 TENCENT_LBS_KEY 里，不下发到前端。
  NEARBY_FN: 'nearby',

  // 用户数据云同步开关。开启后收藏 / 店铺收藏 / 历史 / 口味偏好会按微信身份存到云端，
  // 换手机登录同一个微信即可自动恢复。断网时自动退化为纯本地，不影响使用。
  ENABLE_SYNC: true,

  // 用户数据云函数名（与 cloudfunctions/userdata 目录名一致）
  // 身份取自云函数里的微信上下文（OPENID），前端不传 openid，用户之间天然隔离。
  USERDATA_FN: 'userdata',

  // 周边搜索半径（米）。结果太少时服务端会自动向外扩展，所以这里不必给太大。
  NEARBY_RADIUS: 3000
};
