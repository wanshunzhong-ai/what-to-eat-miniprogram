const app = getApp();
const recommender = require('../../utils/recommender.js');
const engine = require('../../utils/engine.js');
const citiesData = require('../../utils/cities.js');
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

/** 把定位精度转成好读的文案 */
function formatAccuracy(acc) {
  if (typeof acc !== 'number' || acc <= 0) return '';
  if (acc <= 100) return '精度约 ±' + Math.round(acc) + ' 米';
  if (acc <= 1000) return '精度约 ±' + (Math.round(acc / 100) / 10) + ' 公里';
  return '精度约 ±' + Math.round(acc / 1000) + ' 公里（较粗略）';
}

/** 拼一句「定位结果说明」，把识别依据透明地告诉用户 */
function buildStatus(c, res) {
  const acc = formatAccuracy(res && res.accuracy);
  if (c.lowConfidence) {
    return '附近没有收录的城市，已按最近的「' + c.name + '」推荐（相距约 ' + c.distanceKm + ' 公里），点上方可切换';
  }
  let s;
  if (c.ambiguous && c.alternatives && c.alternatives[1]) {
    s = '你在「' + c.name + '」和「' + c.alternatives[1].name + '」之间，已选「' + c.name + '」';
  } else {
    s = '已定位到「' + c.name + '」';
  }
  return acc ? (s + ' · ' + acc) : s;
}

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

  /**
   * 自动定位
   * 走 wxapi.getLocation()：开启高精度 + 精度不足时重复采样取最优；环境不支持则优雅降级
   * @param {boolean} [fresh] 是否强制重新定位（重新定位按钮用，跳过快照）
   */
  autoLocate(fresh) {
    if (this.data.locating) return;
    const that = this;
    this.setData({ locating: true, cityStatus: '' });

    wxapi.getLocation({ fresh: !!fresh }).then(function (res) {
      that.setData({ locating: false });

      if (res.ok) {
        // 记住坐标：城市选择页据此列出「离你最近的城市」，方便手动纠正识别结果
        app.globalData.lastLocation = {
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: res.accuracy,
          at: Date.now()
        };

        const c = recommender.locateCity(res.latitude, res.longitude);
        if (!c) {
          that.setData({ cityStatus: '没能识别出城市，请手动选择' });
          return;
        }
        app.setCity(c);
        that.setData({ city: c, cityStatus: buildStatus(c, res) });
        // 落在两城交界、且两地菜系不同时，让用户点一下就确认
        if (c.ambiguous) that.confirmAmbiguous(c);
        return;
      }

      if (res.reason === 'denied') {
        that.setData({ cityStatus: '未授权定位，可手动选择城市' });
        wxapi.call('showModal', {
          title: '需要定位权限',
          content: '开启定位可自动识别你所在的城市，也可以直接手动选择。',
          confirmText: '去设置',
          cancelText: '手动选',
          success(r) {
            if (r && r.confirm) {
              wxapi.call('openSetting', {});
            } else {
              that.onChooseCity();
            }
          }
        });
        return;
      }

      if (res.reason === 'unsupported') {
        // 环境不提供定位接口（如预览沙箱）：默认取一个人气城市保证功能可用。
        // 只写入当前会话、不落缓存，避免在真机上残留一个错误的城市。
        const name = (citiesData.HOT_CITIES && citiesData.HOT_CITIES[0]) || '北京';
        const c = citiesData.getByName(name) || { name: name, province: '', cuisine: '家常菜' };
        app.globalData.city = c;
        that.setData({ city: c, cityStatus: '当前环境无法自动定位，已默认「' + c.name + '」，点上方可切换' });
        return;
      }

      if (res.reason === 'timeout') {
        that.setData({ cityStatus: '定位超时（可能是信号弱），可重试或手动选择' });
        return;
      }

      console.warn('定位失败', res.errMsg || '');
      that.setData({ cityStatus: '定位失败，可手动选择城市' });
    });
  },

  /** 定位落在两座城市交界时，让用户点选确认（只为纠正菜系，点取消则沿用最近的） */
  confirmAmbiguous(c) {
    const that = this;
    const alts = c.alternatives || [];
    if (alts.length < 2) return;
    wxapi.call('showActionSheet', {
      itemList: alts.map(function (x) {
        return x.name + '（' + x.cuisine + ' · 约 ' + x.distanceKm + ' 公里）';
      }),
      success(r) {
        const idx = (r && typeof r.tapIndex === 'number') ? r.tapIndex : -1;
        if (idx < 0 || !alts[idx]) return;
        const pick = citiesData.getByName(alts[idx].name);
        if (!pick) return;
        app.setCity(pick);
        that.setData({ city: pick, cityStatus: '已按你确认的「' + pick.name + '」推荐' });
      }
    });
  },

  onRelocate() {
    this.autoLocate(true);
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
