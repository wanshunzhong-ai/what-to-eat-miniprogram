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

  // 附近美食店云函数名（与 cloudfunctions/nearby 目录名一致）
  // 它代理腾讯位置服务的周边搜索；地图 Key 存在云函数环境变量 TENCENT_LBS_KEY 里，不下发到前端。
  NEARBY_FN: 'nearby',

  // 周边搜索半径（米）。结果太少时服务端会自动向外扩展，所以这里不必给太大。
  NEARBY_RADIUS: 3000
};
