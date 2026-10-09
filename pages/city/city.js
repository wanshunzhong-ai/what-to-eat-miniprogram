const app = getApp();
const citiesData = require('../../utils/cities.js');
const recommender = require('../../utils/recommender.js');

Page({
  data: {
    keyword: '',
    list: [],
    hotList: [],
    locating: false,
    cityName: ''
  },

  onLoad() {
    const hot = citiesData.HOT_CITIES.map(function (n) {
      return citiesData.getByName(n);
    }).filter(function (c) {
      return !!c;
    });
    this.setData({
      list: citiesData.CITIES,
      hotList: hot,
      cityName: app.globalData.city ? app.globalData.city.name : ''
    });
  },

  onInput(e) {
    const kw = e.detail.value;
    this.setData({ keyword: kw, list: citiesData.search(kw) });
  },

  onPickCity(e) {
    const name = e.currentTarget.dataset.name;
    const c = citiesData.getByName(name);
    if (!c) return;
    app.setCity(c);
    wx.showToast({ title: '已切换到 ' + c.name, icon: 'none' });
    setTimeout(function () {
      wx.navigateBack();
    }, 350);
  },

  onUseLocation() {
    if (this.data.locating) return;
    const that = this;
    this.setData({ locating: true });
    wx.getLocation({
      type: 'gcj02',
      success(res) {
        const c = recommender.locateCity(res.latitude, res.longitude);
        if (c) {
          app.setCity(c);
          wx.showToast({ title: '定位到 ' + c.name, icon: 'none' });
          setTimeout(function () { wx.navigateBack(); }, 500);
        } else {
          wx.showToast({ title: '未能识别城市', icon: 'none' });
        }
      },
      fail(err) {
        console.warn('定位失败', err);
        wx.showToast({ title: '定位失败，请手动选择', icon: 'none' });
      },
      complete() {
        that.setData({ locating: false });
      }
    });
  }
});
