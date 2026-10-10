const app = getApp();
const engine = require('../../utils/engine.js');
const takeoutData = require('../../utils/takeout.js');
const wxapi = require('../../utils/wxapi.js');
const foodData = require('../../utils/foodData.js');
const config = require('../../config.js');

const RADIUS = config.NEARBY_RADIUS || 3000;
const PAGE_SIZE = 20;
// 位置快照的复用时长。原来是 10 分钟——边走边找店时距离全是按旧位置算的，
// 与「定位要精确」直接冲突，因此收到 90 秒；下拉刷新 / 重试一律强制重新定位。
const LOCATION_TTL = 90 * 1000;

Page({
  data: {
    query: null,
    cityName: '',
    catKey: 'all',
    categories: takeoutData.CATEGORIES,
    budgetKey: 'any',
    budgets: takeoutData.BUDGETS,
    list: [],
    // loading 首次加载中 | ok 有结果 | empty 没结果 | notice 拿不到线上数据（可诊断，附人气美食兜底）
    state: 'loading',
    message: '',
    // notice 状态的卡片内容
    noticeEmoji: '😵',
    noticeTitle: '没拿到附近的店',
    noticeHint: '',
    noticeCode: '',
    // 数据来源说明（腾讯地图 / OpenStreetMap）
    dataSourceText: '',
    note: '',
    loading: false,
    page: 1,
    hasMore: false,
    radiusText: '',
    // 定位精度说明（距离都是按这个位置算的，精度差要让人看得见）
    locText: '',
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
    // 下拉刷新是「我可能换地方了」的明确信号 → 强制重新定位
    this.fetch(true, true).then(function () {
      wxapi.call('stopPullDownRefresh', {});
      wxapi.call('pageScrollTo', { scrollTop: 0, duration: 200 });
    });
  },

  // ------------------------------------------------------------ 定位

  /** 取当前坐标：优先用刚才定位的结果，过期或强制刷新时重新定位 */
  resolveLocation(forceFresh) {
    const cached = app.globalData.lastLocation;
    if (!forceFresh && cached && cached.latitude && cached.longitude &&
        (Date.now() - (cached.at || 0)) < LOCATION_TTL) {
      return Promise.resolve({
        latitude: cached.latitude,
        longitude: cached.longitude,
        accuracy: cached.accuracy,
        cached: true
      });
    }
    return wxapi.getLocation({ fresh: true, attempts: 3 }).then(function (res) {
      if (res && res.ok) {
        app.globalData.lastLocation = {
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: res.accuracy,
          at: Date.now()
        };
        return {
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: res.accuracy,
          cached: false
        };
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
   * @param {boolean} forceLocate true=忽略位置快照，强制重新定位。
   *   只在用户明确要求刷新（下拉刷新 / 重试）时给 true；换品类、翻页沿用快照，
   *   否则每次点 chip 都发一次 getLocation，会撞上 2.17.0 起的调用频率限制。
   */
  fetch(reset, forceLocate) {
    if (this._loading) return Promise.resolve();
    this._loading = true;

    const that = this;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, state: reset ? 'loading' : this.data.state });

    return this.resolveLocation(!!forceLocate).then(function (loc) {
      if (!loc) {
        that._loc = null;
        that._loading = false;
        that.setData({
          loading: false,
          state: 'notice',
          noticeEmoji: '📍',
          noticeTitle: '拿不到你的位置',
          message: '没有定位就拿不到附近的店',
          noticeHint: '请在微信的「设置 → 隐私 → 位置信息」里允许本小程序使用位置，然后重试。',
          noticeCode: 'LOCATION_DENIED',
          locText: '',
          fallbackFoods: []
        });
        return;
      }
      that._loc = loc;
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

  /** 把失败原因翻译成「说清是什么问题 + 该怎么办」的卡片文案 */
  failureKind(res) {
    const code = (res && res.code) || '';
    const stage = (res && res.stage) || '';

    // 云函数这一步就没调通（预览面板不支持云调用 / 云环境未绑定 / 网络不通）
    if (stage === 'call' || code === 'CALL_FAIL' || code === 'NO_CLOUD') {
      return {
        emoji: '📡',
        title: '云函数没调通',
        hint: '附近门店要经云函数去请求地图服务，这一步失败了。若你在「预览面板」里看，它不支持云调用；' +
              '请用微信开发者工具打开本项目（或真机体验）再试。'
      };
    }
    // 地图数据源的问题
    if (code === 'NO_KEY' || code === 'LBS_199' || code === 'LBS_113' || code === 'LBS_110' || code === 'LBS_190' || code === 'LBS_311') {
      return {
        emoji: '🔑',
        title: '地图 Key 没生效',
        hint: '给云函数 nearby 配置环境变量 TENCENT_LBS_KEY（腾讯位置服务 Key，需开通 WebServiceAPI）后即可拿到真实门店。'
      };
    }
    if (code === 'LBS_120' || code === 'LBS_121') {
      return {
        emoji: '⏳',
        title: '地图服务额度用完了',
        hint: '腾讯位置服务的调用量或并发已达上限，稍后再试，或在控制台提升配额。'
      };
    }
    if (/^OSM_/.test(code)) {
      return {
        emoji: '🌐',
        title: '开源地图暂时不可用',
        hint: '免密钥数据源（OpenStreetMap）这一会儿请求失败了，通常是限流，稍后重试即可。'
      };
    }
    return {
      emoji: '😵',
      title: '没拿到附近的店',
      hint: '可以点「重试」；如果一直不行，先看看下面的人气美食，或改用「自己做」模式。'
    };
  },

  /** 把定位精度说清楚：门店距离都是按这个位置算的，精度差必须让人看得见 */
  locationText(loc) {
    const l = loc || this._loc;
    if (!l || typeof l.accuracy !== 'number' || l.accuracy <= 0) return '';
    const acc = l.accuracy;
    const t = acc <= 1000
      ? ('±' + Math.round(acc) + ' 米')
      : ('±' + (Math.round(acc / 100) / 10) + ' 公里');
    return '定位精度 ' + t + (l.cached ? '（90 秒内的位置）' : '');
  },

  applyResult(res, page) {
    if (!res || !res.ok) {
      const kind = this.failureKind(res);
      const code = (res && res.code) || 'ERROR';
      const debug = code + (res && res.errMsg ? ' · ' + res.errMsg : '');
      this.setData({
        loading: false,
        state: 'notice',
        noticeEmoji: kind.emoji,
        noticeTitle: kind.title,
        message: (res && res.message) || '获取附近的店失败',
        noticeHint: (res && res.hint) || kind.hint,
        noticeCode: debug,
        locText: this.locationText(),
        list: page === 1 ? [] : this.data.list,
        hasMore: false,
        // 任何失败都给「人气美食」兜底，不让页面变成死路
        fallbackFoods: this.buildFallback()
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
      hasMore: raw.length >= PAGE_SIZE && res.exhausted !== true,
      dataSourceText: res.dataSource === 'osm' ? '数据来自 OpenStreetMap' : (res.dataSource === 'tencent' ? '数据来自腾讯地图' : ''),
      note: res.note || '',
      locText: this.locationText(),
      // 线上没找到时，也拿人气美食垫一下
      fallbackFoods: list.length ? [] : this.buildFallback(),
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
    // 手动重试往往正是因为位置不对，强制重新定位
    this.fetch(true, true);
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
