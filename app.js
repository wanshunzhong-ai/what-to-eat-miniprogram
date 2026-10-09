const config = require('./config.js');
const wxapi = require('./utils/wxapi.js');

const STORAGE = {
  CITY: 'eat_city',
  PREF: 'eat_pref',
  HISTORY: 'eat_history',
  FAVORITES: 'eat_favorites'
};

App({
  globalData: {
    // 云开发是否初始化成功（成功则推荐走云函数，否则用本地逻辑）
    cloudReady: false,
    // 当前城市 { name, province, cuisine, lat, lng }
    city: null,
    // 上次推荐结果，供结果页读取
    lastResult: null,
    // 最近一次定位坐标 { latitude, longitude, accuracy, at }，供城市选择页列出「离你最近的城市」
    lastLocation: null,
    // 偏好 { spicy: -1不限 | 0不辣 | 1微辣 | 2中辣 | 3重辣, light: 是否清淡, maxTime: 最长烹饪时间(分钟), exclude: [] }
    pref: { spicy: -1, light: false, maxTime: 0, exclude: [] },
    history: [],
    favorites: []
  },

  onLaunch() {
    // 先给运行环境缺失的 wx 接口补上兜底实现，避免页面生命周期被异常中断
    try {
      wxapi.install();
    } catch (e) {
      console.warn('[wxapi] 接口兜底失败，忽略', e);
    }
    this.initCloud();
    this.restore();
  },

  /** 初始化云开发（失败不阻断，自动降级到本地推荐逻辑） */
  initCloud() {
    this.globalData.cloudReady = false;
    if (!config.ENABLE_CLOUD || !config.ENV_ID) {
      console.info('[云开发] 未启用，使用本地推荐逻辑');
      return;
    }
    if (!wx.cloud) {
      console.warn('[云开发] 当前基础库不支持云开发，使用本地推荐逻辑');
      return;
    }
    try {
      wx.cloud.init({
        env: config.ENV_ID,
        traceUser: true
      });
      this.globalData.cloudReady = true;
      console.info('[云开发] 初始化完成，环境：' + config.ENV_ID);
    } catch (e) {
      console.warn('[云开发] 初始化失败，使用本地推荐逻辑', e);
    }
  },

  /** 读取本地缓存 */
  restore() {
    try {
      const city = wx.getStorageSync(STORAGE.CITY);
      if (city && city.name) {
        this.globalData.city = city;
      }
      const pref = wx.getStorageSync(STORAGE.PREF);
      if (pref && typeof pref === 'object') {
        this.globalData.pref = Object.assign(this.globalData.pref, pref);
      }
      const history = wx.getStorageSync(STORAGE.HISTORY);
      if (Array.isArray(history)) {
        this.globalData.history = history;
      }
      const favorites = wx.getStorageSync(STORAGE.FAVORITES);
      if (Array.isArray(favorites)) {
        this.globalData.favorites = favorites;
      }
    } catch (e) {
      console.warn('读取缓存失败', e);
    }
  },

  /** 保存当前城市 */
  setCity(city) {
    this.globalData.city = city;
    try {
      wx.setStorageSync(STORAGE.CITY, city);
    } catch (e) {
      console.warn('保存城市失败', e);
    }
  },

  /** 保存偏好 */
  setPref(pref) {
    this.globalData.pref = Object.assign({}, this.globalData.pref, pref);
    try {
      wx.setStorageSync(STORAGE.PREF, this.globalData.pref);
    } catch (e) {
      console.warn('保存偏好失败', e);
    }
  },

  /** 写入一条推荐历史 */
  addHistory(record) {
    const list = this.globalData.history.filter(function (item) {
      return item.id !== record.id;
    });
    list.unshift(record);
    this.globalData.history = list.slice(0, 30);
    try {
      wx.setStorageSync(STORAGE.HISTORY, this.globalData.history);
    } catch (e) {
      console.warn('保存历史失败', e);
    }
  },

  clearHistory() {
    this.globalData.history = [];
    try {
      wx.removeStorageSync(STORAGE.HISTORY);
    } catch (e) {}
  },

  /** 收藏 / 取消收藏，返回最新状态 */
  toggleFavorite(dish) {
    const favorites = this.globalData.favorites.slice();
    const idx = favorites.findIndex(function (item) {
      return item.id === dish.id;
    });
    let added = false;
    if (idx >= 0) {
      favorites.splice(idx, 1);
    } else {
      favorites.unshift({
        id: dish.id,
        name: dish.name,
        emoji: dish.emoji,
        cuisine: dish.cuisine,
        category: dish.category
      });
      added = true;
    }
    this.globalData.favorites = favorites;
    try {
      wx.setStorageSync(STORAGE.FAVORITES, favorites);
    } catch (e) {
      console.warn('保存收藏失败', e);
    }
    return added;
  },

  isFavorite(id) {
    return this.globalData.favorites.some(function (item) {
      return item.id === id;
    });
  }
});
