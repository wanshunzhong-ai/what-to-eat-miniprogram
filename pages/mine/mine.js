const app = getApp();
const engine = require('../../utils/engine.js');
const wxapi = require('../../utils/wxapi.js');

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

/** 历史记录 → 视图对象；区分「自己做」与「点外卖」两种记录 */
function formatHistory(h) {
  const city = h.city || {};
  const kind = h.kind === 'takeout' ? 'takeout' : 'cook';
  const base = {
    id: h.id,
    kind: kind,
    kindLabel: kind === 'takeout' ? '点外卖' : '自己做',
    kindEmoji: kind === 'takeout' ? '🛵' : '🍳',
    people: h.people || 2,
    mealLabel: h.mealLabel || '一餐',
    timeText: timeText(h.createdAt),
    cityName: city.name || h.cityName || '',
    cuisine: city.cuisine || h.cuisine || '家常菜'
  };

  if (kind === 'takeout') {
    const shops = h.shops || [];
    base.shopCount = shops.length;
    base.shopText = shops.map(function (s) {
      return (s.catEmoji || '🍴') + s.name;
    }).join('、');
  } else {
    base.dishText = (h.dishes || []).map(function (d) {
      return d.emoji + d.name;
    }).join('、');
  }
  return base;
}

Page({
  data: {
    tab: 'dish',
    favList: [],
    shopList: [],
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
      shopList: app.globalData.shopFavorites.slice(),
      historyList: app.globalData.history.map(formatHistory),
      pref: Object.assign({ spicy: -1, light: false, maxTime: 0 }, app.globalData.pref)
    });
  },

  onSwitchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.value });
  },

  // ---------------------------------------------------------------- 偏好

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

  // ---------------------------------------------------------------- 菜品收藏

  onFavTap(e) {
    const id = e.currentTarget.dataset.id;
    wxapi.call('navigateTo', { url: '/pages/detail/detail?id=' + id + '&people=2' });
  },

  // ---------------------------------------------------------------- 店铺收藏

  onShopNav(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const s = this.data.shopList[idx];
    if (!s) return;
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') {
      this.copyShop(s);
      return;
    }
    const that = this;
    wxapi.call('openLocation', {
      latitude: s.lat,
      longitude: s.lng,
      name: s.name,
      address: s.address || '',
      scale: 18,
      fail() { that.copyShop(s); }
    });
  },

  copyShop(s) {
    const text = s.address ? (s.name + ' · ' + s.address) : s.name;
    wxapi.call('setClipboardData', {
      data: text,
      success() {
        wxapi.call('showToast', { title: '地址已复制，去地图 App 粘贴吧', icon: 'none' });
      },
      fail() {
        wxapi.call('showToast', { title: text, icon: 'none' });
      }
    });
  },

  onShopCopy(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const s = this.data.shopList[idx];
    if (s) this.copyShop(s);
  },

  onShopCall(e) {
    const tel = e.currentTarget.dataset.tel;
    if (!tel) return;
    wxapi.call('makePhoneCall', {
      phoneNumber: String(tel).replace(/[^0-9-]/g, ''),
      fail() {
        wxapi.call('showToast', { title: '拨号不可用：' + tel, icon: 'none' });
      }
    });
  },

  onUnfavShop(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const s = this.data.shopList[idx];
    if (!s) return;
    app.toggleShopFavorite(s);
    this.refresh();
    wxapi.call('showToast', { title: '已取消收藏', icon: 'none' });
  },

  // ---------------------------------------------------------------- 历史

  onHistoryTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const h = app.globalData.history[idx];
    if (!h) return;

    // 点外卖的历史：带着原来的条件回到外卖页重新查
    if (h.kind === 'takeout') {
      app.globalData.takeoutQuery = {
        people: h.people || 2,
        meal: h.meal || '',
        mealLabel: h.mealLabel || '一餐',
        budget: h.budget || 'any',
        cat: h.catKey || 'all'
      };
      wxapi.call('navigateTo', { url: '/pages/takeout/takeout' });
      return;
    }

    // 自己做：按同样条件再推荐一桌
    const city = h.city || { name: h.cityName || '', province: '', cuisine: h.cuisine || '家常菜' };
    wx.showLoading({ title: '重新搭配…', mask: true });
    engine.recommend({
      city: city,
      people: h.people || 2,
      meal: h.meal || 'dinner',
      pref: app.globalData.pref
    }).then(function (result) {
      wx.hideLoading();
      app.globalData.lastResult = result;
      wxapi.call('navigateTo', { url: '/pages/result/result' });
    });
  },

  onClearHistory() {
    const that = this;
    wxapi.call('showModal', {
      title: '清空历史',
      content: '确定要清空所有记录吗？（收藏不会受影响）',
      success(r) {
        if (r && r.confirm) {
          app.clearHistory();
          that.refresh();
        }
      }
    });
  }
});
