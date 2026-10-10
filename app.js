const config = require('./config.js');
const wxapi = require('./utils/wxapi.js');
const dishStore = require('./utils/dishStore.js');
const userStore = require('./utils/userStore.js');

const STORAGE = {
  CITY: 'eat_city',
  PREF: 'eat_pref',
  HISTORY: 'eat_history',
  FAVORITES: 'eat_favorites',
  SHOP_FAVORITES: 'eat_shop_favorites',
  // 各集合「最后一次本地改动」的时间戳，用来和云端比对谁更新
  SYNC_TS: 'eat_sync_ts'
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
    // 上一次「点外卖」的查询条件 { people, meal, budget, cat }，供外卖页读取与历史重跑
    takeoutQuery: null,
    // 偏好 { spicy: -1不限 | 0不辣 | 1微辣 | 2中辣 | 3重辣, light: 是否清淡, exclude: [] }
    pref: { spicy: -1, light: false, exclude: [] },
    history: [],
    favorites: [],
    // 收藏的店（点外卖分支）
    shopFavorites: [],
    // 菜品库同步信息 { source: cloud|cache|builtin, version, count, lastSyncAt, lastError }
    dishLib: null
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
    this.initDishlib();
    // 本地数据先就位，再在后台跟云端合并一次（失败不影响启动）
    this.cloudSync();
  },

  /**
   * 菜品库初始化：先用「缓存 / 内置兜底」保证启动即有菜可推，再后台从云端刷新。
   * 菜品库不内嵌在小程序包里 —— 加菜 / 改菜只需更新云端数据，无需重新发版。
   */
  initDishlib() {
    const that = this;
    dishStore.ensure();
    this.globalData.dishLib = dishStore.meta();
    dishStore.load(false, this).then(function (meta) {
      that.globalData.dishLib = meta;
      console.info('[菜品库] 来源=' + meta.source + ' 版本=' + meta.version + ' 共' + meta.count + '道');
    });
  },

  /** 手动刷新菜品库（「我的」页按钮用） */
  refreshDishlib(force) {
    const that = this;
    return dishStore.load(force !== false, this).then(function (meta) {
      that.globalData.dishLib = meta;
      return meta;
    });
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
      const shopFavorites = wx.getStorageSync(STORAGE.SHOP_FAVORITES);
      if (Array.isArray(shopFavorites)) {
        this.globalData.shopFavorites = shopFavorites;
      }
    } catch (e) {
      console.warn('读取缓存失败', e);
    }
  },

  // ------------------------------------------------------------ 云端同步
  // 数据以「本地为准」立即生效，云端只做多设备之间的搬运。
  // 合并规则：每个集合比时间戳，谁改得晚用谁的（所以在 A 机取消收藏，B 机同步后也会取消）。

  /** 各集合最后一次本地改动时间 */
  readSyncTs() {
    try {
      const ts = wx.getStorageSync(STORAGE.SYNC_TS);
      if (ts && typeof ts === 'object') return ts;
    } catch (e) {}
    return {};
  },

  /** 打包本地状态发给云端（带时间戳，决定合并时谁赢） */
  exportState() {
    const ts = this.readSyncTs();
    const g = this.globalData;
    return {
      pref: g.pref,
      prefUpdatedAt: ts.pref || 0,
      favorites: g.favorites,
      favoritesUpdatedAt: ts.favorites || 0,
      shopFavorites: g.shopFavorites,
      shopFavoritesUpdatedAt: ts.shopFavorites || 0,
      history: g.history,
      historyUpdatedAt: ts.history || 0
    };
  },

  /** 把云端合并结果写回本地（内存 + 缓存 + 时间戳） */
  importState(state) {
    if (!state || typeof state !== 'object') return;
    const g = this.globalData;
    const ts = {};
    if (state.pref && typeof state.pref === 'object') {
      g.pref = Object.assign({ spicy: -1, light: false, exclude: [] }, state.pref);
    }
    ts.pref = state.prefUpdatedAt || 0;
    if (Array.isArray(state.favorites)) g.favorites = state.favorites;
    ts.favorites = state.favoritesUpdatedAt || 0;
    if (Array.isArray(state.shopFavorites)) g.shopFavorites = state.shopFavorites;
    ts.shopFavorites = state.shopFavoritesUpdatedAt || 0;
    if (Array.isArray(state.history)) g.history = state.history;
    ts.history = state.historyUpdatedAt || 0;
    try {
      wx.setStorageSync(STORAGE.PREF, g.pref);
      wx.setStorageSync(STORAGE.FAVORITES, g.favorites);
      wx.setStorageSync(STORAGE.SHOP_FAVORITES, g.shopFavorites);
      wx.setStorageSync(STORAGE.HISTORY, g.history);
      wx.setStorageSync(STORAGE.SYNC_TS, ts);
    } catch (e) {
      console.warn('保存同步结果失败', e);
    }
  },

  /** 标记某些集合「本地刚改过」，并排队推送到云端 */
  bumpSync(fields) {
    const ts = this.readSyncTs();
    const at = Date.now();
    for (let i = 0; i < fields.length; i++) {
      ts[fields[i]] = at;
    }
    try {
      wx.setStorageSync(STORAGE.SYNC_TS, ts);
    } catch (e) {}
    userStore.schedulePush(this);
  },

  /** 启动时后台同步一次 */
  cloudSync() {
    if (!userStore.enabled()) {
      return Promise.resolve({ ok: false, error: '云同步未开启' });
    }
    if (!this.globalData.cloudReady) {
      return Promise.resolve({ ok: false, error: '云开发未就绪' });
    }
    return userStore.sync(this).then(function (r) {
      if (r.ok) console.info('[云同步] 合并完成');
      else console.warn('[云同步] 未完成：' + r.error);
      return r;
    });
  },

  /** 「我的」页手动同步用 */
  syncNow() {
    return this.cloudSync();
  },

  /** 同步状态快照，供「我的」页展示 */
  syncMeta() {
    return userStore.meta();
  },

  /**
   * 保存当前城市
   * @param {Object} city 城市对象
   * @param {boolean} [persist=true] 是否落本地存储。
   *   低置信度的定位结果应传 false——只作用于本次会话，避免把大概率不对的城市记住。
   */
  setCity(city, persist) {
    this.globalData.city = city;
    if (persist === false) return;
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
    this.bumpSync(['pref']);
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
    this.bumpSync(['history']);
  },

  clearHistory() {
    this.globalData.history = [];
    try {
      wx.removeStorageSync(STORAGE.HISTORY);
    } catch (e) {}
    this.bumpSync(['history']);
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
    this.bumpSync(['favorites']);
    return added;
  },

  isFavorite(id) {
    return this.globalData.favorites.some(function (item) {
      return item.id === id;
    });
  },

  /** 收藏 / 取消收藏一家店，返回最新状态 */
  toggleShopFavorite(shop) {
    const list = this.globalData.shopFavorites.slice();
    const idx = list.findIndex(function (item) {
      return item.id === shop.id;
    });
    let added = false;
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.unshift({
        id: shop.id,
        name: shop.name,
        catLabel: shop.catLabel || '',
        catEmoji: shop.catEmoji || '🍴',
        address: shop.address || '',
        tel: shop.tel || '',
        perHeadText: shop.perHeadText || '',
        distanceText: shop.distanceText || '',
        // 配送信息（近似版）一并存下来，收藏列表里也能看到
        ratingText: shop.ratingText || '',
        minOrderText: shop.minOrderText || '',
        deliveryFeeText: shop.deliveryFeeText || '',
        etaText: shop.etaText || '',
        inRange: shop.inRange !== false,
        rangeText: shop.rangeText || '',
        lat: shop.lat,
        lng: shop.lng,
        savedAt: Date.now()
      });
      added = true;
    }
    this.globalData.shopFavorites = list;
    try {
      wx.setStorageSync(STORAGE.SHOP_FAVORITES, list);
    } catch (e) {
      console.warn('保存店铺收藏失败', e);
    }
    this.bumpSync(['shopFavorites']);
    return added;
  },

  isShopFavorite(id) {
    return this.globalData.shopFavorites.some(function (item) {
      return item.id === id;
    });
  }
});
