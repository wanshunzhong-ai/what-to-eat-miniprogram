const app = getApp();
const recommender = require('../../utils/recommender.js');

const SPICY_OPTIONS = [
  { value: -1, label: '随便' },
  { value: 0, label: '不吃辣' },
  { value: 1, label: '微辣' },
  { value: 2, label: '中辣' },
  { value: 3, label: '重辣' }
];

const TIME_OPTIONS = [
  { value: 0, label: '不限' },
  { value: 30, label: '30分钟内' },
  { value: 60, label: '1小时内' }
];

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function timeText(ts) {
  const d = new Date(ts || Date.now());
  const now = new Date();
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
  const y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
}

function formatHistory(h) {
  const city = h.city || {};
  return {
    id: h.id,
    people: h.people || 2,
    mealLabel: h.mealLabel || '一餐',
    timeText: timeText(h.createdAt),
    cityName: city.name || h.cityName || '',
    cuisine: city.cuisine || h.cuisine || '家常菜',
    dishText: (h.dishes || []).map(function (d) {
      return d.emoji + d.name;
    }).join('、')
  };
}

Page({
  data: {
    favList: [],
    historyList: [],
    pref: { spicy: -1, light: false, maxTime: 0 },
    spicyOptions: SPICY_OPTIONS,
    timeOptions: TIME_OPTIONS
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    this.setData({
      favList: app.globalData.favorites.slice(),
      historyList: app.globalData.history.map(formatHistory),
      pref: Object.assign({ spicy: -1, light: false, maxTime: 0 }, app.globalData.pref)
    });
  },

  onPickSpicy(e) {
    const value = Number(e.currentTarget.dataset.value);
    app.setPref({ spicy: value });
    this.setData({ 'pref.spicy': value });
  },

  onToggleLight(e) {
    const value = e.detail.value;
    app.setPref({ light: value });
    this.setData({ 'pref.light': value });
  },

  onPickTime(e) {
    const value = Number(e.currentTarget.dataset.value);
    app.setPref({ maxTime: value });
    this.setData({ 'pref.maxTime': value });
  },

  onFavTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id + '&people=2' });
  },

  onHistoryTap(e) {
    const idx = e.currentTarget.dataset.index;
    const h = app.globalData.history[idx];
    if (!h) return;
    const city = h.city || { name: h.cityName || '', province: '', cuisine: h.cuisine || '家常菜' };
    const result = recommender.recommend({
      city: city,
      people: h.people || 2,
      meal: h.meal || recommender.mealByTime(),
      pref: app.globalData.pref
    });
    app.globalData.lastResult = result;
    wx.navigateTo({ url: '/pages/result/result' });
  },

  onClearHistory() {
    const that = this;
    wx.showModal({
      title: '清空历史',
      content: '确定要清空所有推荐历史吗？',
      success(r) {
        if (r.confirm) {
          app.clearHistory();
          that.refresh();
        }
      }
    });
  }
});
