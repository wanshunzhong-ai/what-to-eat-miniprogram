// cloudfunctions/recommend/index.js
// 「今天吃什么」推荐云函数。
// 入参：{ city, people, meal, pref }
// 出参：与 utils/recommender.js 的 recommend() 完全一致的一桌菜结果。
//
// 说明：本目录内的 recommender.js / cities.js / dishes.js / foodData.js 是
// 与小程序端 utils 下同一套文件（部署时复制过来），因此云端与本地结果一致。

const cloud = require('wx-server-sdk');
const recommender = require('./recommender.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();

  const city = event && event.city && event.city.name
    ? event.city
    : { name: '', province: '', cuisine: '家常菜' };
  const people = Math.max(1, Number(event && event.people) || 1);
  const meal = (event && event.meal) || recommender.mealByTime();
  const pref = (event && event.pref) || {};

  const result = recommender.recommend({
    city: city,
    people: people,
    meal: meal,
    pref: pref
  });

  result.source = 'cloud';
  result.openid = wxContext.OPENID || '';
  return result;
};
