const app = getApp();
const engine = require('../../utils/engine.js');

const SPICY_TEXT = { 0: '不辣', 1: '微辣', 2: '中辣', 3: '重辣' };

/** 给菜品补充展示字段 */
function decorate(d) {
  const ingPreview = (d.ingredients || []).map(function (i) {
    return i.name + ' ' + i.amount;
  }).join(' · ');
  return Object.assign({}, d, {
    spicyText: SPICY_TEXT[d.spicy] || '不辣',
    ingPreview: ingPreview
  });
}

function buildView(r) {
  return Object.assign({}, r, {
    dishes: (r.dishes || []).map(decorate)
  });
}

Page({
  data: {
    result: null
  },

  onLoad() {
    this.load();
  },

  load() {
    const r = app.globalData.lastResult;
    if (!r) {
      this.setData({ result: null });
      return;
    }
    this.setData({ result: buildView(r) });
  },

  onChange() {
    const r = app.globalData.lastResult;
    if (!r || this._loading) return;
    this._loading = true;
    const that = this;
    wx.showLoading({ title: '换一批…', mask: true });
    engine.recommend({
      city: r.city,
      people: r.people,
      meal: r.meal,
      pref: app.globalData.pref
    }).then(function (next) {
      wx.hideLoading();
      that._loading = false;
      app.globalData.lastResult = next;
      that.setData({ result: buildView(next) });
      wx.pageScrollTo({ scrollTop: 0, duration: 200 });
      wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    });
  },

  onDish(e) {
    const id = e.currentTarget.dataset.id;
    const r = app.globalData.lastResult;
    const people = r ? r.people : 2;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id + '&people=' + people });
  },

  backHome() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: '/pages/index/index' });
      }
    });
  },

  onShareAppMessage() {
    const r = app.globalData.lastResult;
    let title = '今天吃什么？我帮你决定';
    if (r && r.dishes && r.dishes.length) {
      title = '今天吃这些：' + r.dishes.map(function (d) { return d.name; }).join('、');
    }
    return {
      title: title,
      path: '/pages/index/index'
    };
  }
});
