const app = getApp();
const engine = require('../../utils/engine.js');
const takeoutData = require('../../utils/takeout.js');
const wxapi = require('../../utils/wxapi.js');
const foodData = require('../../utils/foodData.js');
const config = require('../../config.js');

const RADIUS = config.NEARBY_RADIUS || 3000;
const PAGE_SIZE = 20;
const LOCATION_TTL = 10 * 60 * 1000;

Page({
  data: {
    query: null,
    cityName: '',
    catKey: 'all',
    categories: takeoutData.CATEGORIES,
    budgetKey: 'any',
    budgets: takeoutData.BUDGETS,
    list: [],
    // loading 首次加载中 | ok 有结果 | empty 没结果 | nokey 未配置地图 Key | error 其他失败
    state: 'loading',
    message: '',
    loading: false,
    page: 1,
    hasMore: false,
    radiusText: '',
    fallbackFoods: [],
    catLabel: '全部'
  },

  onLoad() {
    const q = app.globalData.takeoutQuery || {};
    const city = app.globalData.city;
    const catKey = q.cat || 'all';
    this.setData({
      query: q,
      cityName: city ? city.name : '',
      catKey: catKey,
      catLabel: takeoutData.catInfo(catKey).label,
      budgetKey: q.budget || 'any'
    });
    if (city) {
      wxapi.call('setNavigationBarTitle', { title: '附近的店 · ' + city.name });
    }
    this.fetch(true);
  },

  onPullDownRefresh() {
    this.fetch(true).then(function () {
      wxapi.call('stopPullDownRefresh', {});
      wxapi.call('pageScrollTo', { scrollTop: 0, duration: 200 });
    });
  },

  // ------------------------------------------------------------ 定位

  /** 取当前坐标：优先用首页刚定位的结果，过期再重新定位 */
  resolveLocation() {
    const cached = app.globalData.lastLocation;
    if (cached && cached.latitude && cached.longitude &&
        (Date.now() - (cached.at || 0)) < LOCATION_TTL) {
      return Promise.resolve({ latitude: cached.latitude, longitude: cached.longitude });
    }
    return wxapi.getLocation({ fresh: true }).then(function (res) {
      if (res && res.ok) {
        app.globalData.lastLocation = {
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: res.accuracy,
          at: Date.now()
        };
        return { latitude: res.latitude, longitude: res.longitude };
      }
      return null;
    });
  },

  // ------------------------------------------------------------ 取数

  /** 当前品类对应的搜索关键词；「全部」时早餐时段优先推早餐店 */
  currentKeyword() {
    const cat = takeoutData.catInfo(this.data.catKey);
    if (cat && cat.keyword) return cat.keyword;
    const meal = (this.data.query && this.data.query.meal) || '';
    if (meal === 'breakfast') return '早餐';
    return '';
  },

  /**
   * 拉取附近的店
   * @param {boolean} reset true=从第一页重新取（换品类/下拉刷新），false=取下一页
   */
  fetch(reset) {
    if (this._loading) return Promise.resolve();
    this._loading = true;

    const that = this;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, state: reset ? 'loading' : this.data.state });

    return this.resolveLocation().then(function (loc) {
      if (!loc) {
        that._loading = false;
        that.setData({
          loading: false,
          state: 'error',
          message: '拿不到你的位置，无法查询附近的店。请在设置里允许定位后重试。'
        });
        return;
      }
      return engine.nearbyPlaces({
        lat: loc.latitude,
        lng: loc.longitude,
        keyword: that.currentKeyword(),
        radius: RADIUS,
        page: page,
        pageSize: PAGE_SIZE
      }).then(function (res) {
        that._loading = false;
        that.applyResult(res, page);
      });
    });
  },

  applyResult(res, page) {
    if (!res || !res.ok) {
      const code = (res && res.code) || 'ERROR';
      const isNoKey = code === 'NO_KEY' || code === 'LBS_199' || code === 'LBS_113' || code === 'LBS_110';
      const that = this;
      this.setData({
        loading: false,
        state: isNoKey ? 'nokey' : 'error',
        message: (res && res.message) || '获取附近的店失败',
        list: page === 1 ? [] : this.data.list,
        hasMore: false,
        fallbackFoods: isNoKey ? that.buildFallback() : []
      });
      return;
    }

    const raw = res.list || [];
    this._raw = page === 1 ? raw : (this._raw || []).concat(raw);
    const list = this.decorate(this._raw);

    this.setData({
      loading: false,
      state: list.length ? 'ok' : 'empty',
      message: list.length ? '' : '这一片没找到符合条件的店，换个品类或加大范围试试',
      list: list,
      page: page,
      hasMore: raw.length >= PAGE_SIZE,
      radiusText: res.radius
        ? (res.radius >= 1000 ? (res.radius / 1000) + ' 公里内' : res.radius + ' 米内')
        : ''
    });

    if (!this._recorded && list.length) {
      this._recorded = true;
      this.recordHistory(list);
    }
  },

  /** 把原始店铺列表按当前「人数 + 预算」排序并转成视图对象 */
  decorate(rawList) {
    const q = {
      people: (this.data.query && this.data.query.people) || 2,
      budget: this.data.budgetKey
    };
    return takeoutData.rankAndDecorate(rawList, q, function (id) {
      return app.isShopFavorite(id);
    }).list;
  },

  /** 未配置地图 Key 时，用内置的本地人气美食给点方向 */
  buildFallback() {
    const city = app.globalData.city;
    if (!city) return [];
    return (foodData.getLocalFoods(city) || []).slice(0, 6);
  },

  recordHistory(list) {
    const q = this.data.query || {};
    const city = app.globalData.city || {};
    app.addHistory({
      id: 'tk_' + Date.now(),
      kind: 'takeout',
      createdAt: Date.now(),
      city: { name: city.name, province: city.province, cuisine: city.cuisine },
      people: q.people || 2,
      meal: q.meal || '',
      mealLabel: q.mealLabel || '一餐',
      budget: this.data.budgetKey,
      catKey: this.data.catKey,
      catLabel: this.data.catLabel,
      shops: list.slice(0, 5).map(function (s) {
        return { id: s.id, name: s.name, catEmoji: s.catEmoji, catLabel: s.catLabel, distanceText: s.distanceText };
      })
    });
  },

  // ------------------------------------------------------------ 交互

  onPickCat(e) {
    const key = e.currentTarget.dataset.value;
    if (key === this.data.catKey) return;
    this._raw = [];
    this._recorded = true; // 换品类不重复记历史
    this.setData({ catKey: key, catLabel: takeoutData.catInfo(key).label, list: [] });
    this.fetch(true);
  },

  /** 预算只影响排序，不需要重新请求 */
  onPickBudget(e) {
    const key = e.currentTarget.dataset.value;
    if (key === this.data.budgetKey) return;
    this.setData({ budgetKey: key, list: this.decorate(this._raw || []) });
  },

  onMore() {
    if (!this.data.hasMore) {
      wxapi.call('showToast', { title: '附近的店都看完啦', icon: 'none' });
      return;
    }
    this.fetch(false);
  },

  onRetry() {
    this._raw = [];
    this.fetch(true);
  },

  onFav(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.filter(function (x) { return x.id === id; })[0];
    if (!item) return;
    const added = app.toggleShopFavorite(item);
    const list = this.data.list.map(function (x) {
      if (x.id !== id) return x;
      return Object.assign({}, x, { faved: added });
    });
    this.setData({ list: list });
    wxapi.call('showToast', { title: added ? '已收藏这家店' : '已取消收藏', icon: 'none' });
    wxapi.call('vibrateShort', { type: 'light' });
  },

  onNavigate(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const s = this.data.list[idx];
    if (!s) return;
    const that = this;
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') {
      that.copyAddress(s);
      return;
    }
    wxapi.call('openLocation', {
      latitude: s.lat,
      longitude: s.lng,
      name: s.name,
      address: s.address || '',
      scale: 18,
      fail() {
        // 打不开地图（未授权 / 环境不支持）时退化成复制地址
        that.copyAddress(s);
      }
    });
  },

  copyAddress(s) {
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

  onCopy(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const s = this.data.list[idx];
    if (s) this.copyAddress(s);
  },

  onCall(e) {
    const tel = e.currentTarget.dataset.tel;
    if (!tel) return;
    wxapi.call('makePhoneCall', {
      phoneNumber: String(tel).replace(/[^0-9-]/g, ''),
      fail() {
        wxapi.call('showToast', { title: '拨号不可用：' + tel, icon: 'none' });
      }
    });
  },

  onPickFallback(e) {
    // 未配置 Key 时的人气推荐：复制关键词，引导去微信搜一搜
    const name = e.currentTarget.dataset.name;
    wxapi.call('setClipboardData', {
      data: name,
      success() {
        wxapi.call('showToast', { title: '已复制「' + name + '」，去微信搜一搜吧', icon: 'none' });
      }
    });
  },

  goHome() {
    wxapi.call('navigateBack', {
      fail() {
        wxapi.call('reLaunch', { url: '/pages/index/index' });
      }
    });
  },

  onShareAppMessage() {
    return {
      title: this.data.cityName ? ('附近吃什么？看' + this.data.cityName + '这几家') : '附近吃什么？',
      path: '/pages/index/index'
    };
  }
});
