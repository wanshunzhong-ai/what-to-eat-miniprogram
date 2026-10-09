const app = getApp();
const recommender = require('../../utils/recommender.js');
const engine = require('../../utils/engine.js');

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

Page({
  data: {
    greeting: '今天吃点啥？',
    city: null,
    locating: false,
    cityStatus: '',
    people: 2,
    peopleOptions: [1, 2, 3, 4, 5, 6, 7, 8],
    meal: 'dinner',
    mealLabel: '晚餐',
    mealOptions: [
      { key: 'breakfast', label: '早餐' },
      { key: 'lunch', label: '午餐' },
      { key: 'dinner', label: '晚餐' }
    ],
    spicyOptions: SPICY_OPTIONS,
    timeOptions: TIME_OPTIONS,
    pref: { spicy: -1, light: false, maxTime: 0 }
  },

  onLoad() {
    this.setGreeting();
    const meal = recommender.mealByTime();
    this.setData({
      meal: meal,
      mealLabel: recommender.MEAL_LABEL[meal] || '一餐',
      pref: Object.assign({ spicy: -1, light: false, maxTime: 0 }, app.globalData.pref || {}),
      people: app.globalData.people || 2
    });
  },

  onShow() {
    const city = app.globalData.city;
    this.setData({ city: city || null });
    // 同步「我的」页里可能修改过的偏好
    if (app.globalData.pref) {
      this.setData({ pref: Object.assign({ spicy: -1, light: false, maxTime: 0 }, app.globalData.pref) });
    }
    if (!city) {
      this.autoLocate();
    }
  },

  setGreeting() {
    const h = new Date().getHours();
    let g = '今天吃点啥？';
    if (h >= 5 && h < 10) g = '早上好，早餐吃啥？';
    else if (h >= 10 && h < 14) g = '中午了，午饭吃啥？';
    else if (h >= 14 && h < 18) g = '下午好，晚饭吃啥？';
    else if (h >= 18 && h < 23) g = '晚上好，晚饭吃啥？';
    else g = '夜宵时间，吃点啥？';
    this.setData({ greeting: g });
  },

  /** 自动定位 */
  autoLocate() {
    if (this.data.locating) return;
    const that = this;
    this.setData({ locating: true, cityStatus: '' });
    wx.getLocation({
      type: 'gcj02',
      success(res) {
        const c = recommender.locateCity(res.latitude, res.longitude);
        if (c) {
          app.setCity(c);
          that.setData({ city: c, cityStatus: '' });
        } else {
          that.setData({ cityStatus: '没能识别出城市，请手动选择' });
        }
      },
      fail(err) {
        const msg = (err && err.errMsg) ? err.errMsg : '';
        console.warn('定位失败', msg);
        if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) {
          that.setData({ cityStatus: '未授权定位，可手动选择城市' });
          wx.showModal({
            title: '需要定位权限',
            content: '开启定位可自动识别你所在的城市，也可以直接手动选择。',
            confirmText: '去设置',
            cancelText: '手动选',
            success(r) {
              if (r.confirm) {
                wx.openSetting({});
              } else {
                that.onChooseCity();
              }
            }
          });
        } else {
          that.setData({ cityStatus: '定位失败，可手动选择城市' });
        }
      },
      complete() {
        that.setData({ locating: false });
      }
    });
  },

  onRelocate() {
    this.autoLocate();
  },

  onChooseCity() {
    wx.navigateTo({ url: '/pages/city/city' });
  },

  goMine() {
    wx.navigateTo({ url: '/pages/mine/mine' });
  },

  onPickPeople(e) {
    const value = Number(e.currentTarget.dataset.value);
    this.setData({ people: value });
    app.globalData.people = value;
  },

  onPickMeal(e) {
    const key = e.currentTarget.dataset.value;
    this.setData({ meal: key, mealLabel: recommender.MEAL_LABEL[key] || '一餐' });
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

  onStart() {
    const d = this.data;
    if (!d.city) {
      wx.showToast({ title: '请先选择城市', icon: 'none' });
      const that = this;
      setTimeout(function () { that.onChooseCity(); }, 700);
      return;
    }
    wx.showLoading({ title: '正在搭配…', mask: true });
    engine.recommend({
      city: d.city,
      people: d.people,
      meal: d.meal,
      pref: d.pref
    }).then(function (result) {
      wx.hideLoading();
      app.globalData.lastResult = result;
      app.addHistory({
        id: result.id,
        createdAt: result.createdAt,
        city: { name: d.city.name, province: d.city.province, cuisine: d.city.cuisine },
        people: d.people,
        meal: d.meal,
        mealLabel: result.mealLabel,
        dishes: result.dishes.map(function (x) {
          return { id: x.id, name: x.name, emoji: x.emoji };
        })
      });
      wx.navigateTo({ url: '/pages/result/result' });
    });
  }
});
