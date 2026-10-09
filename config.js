// config.js
// 云开发（CloudBase / 微信云开发）配置。
// 环境 ID 与云函数名集中在这里，切换环境时只改这一个文件。

module.exports = {
  // 是否启用云开发：开启后推荐计算优先在云函数里执行；关闭或云端不可用时自动回退到本地逻辑。
  ENABLE_CLOUD: true,

  // CloudBase 环境 ID（来自云开发控制台 / 环境列表）
  ENV_ID: 'zws-04161130-l-d6gd7g8f0c8c7fb17',

  // 推荐云函数名（与 cloudfunctions/recommend 目录名一致）
  RECOMMEND_FN: 'recommend'
};
