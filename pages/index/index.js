const app = getApp();
const recommender = require('../../utils/recommender.js');
const engine = require('../../utils/engine.js');
const citiesData = require('../../utils/cities.js');
const wxapi = require('../../utils/wxapi.js');
const takeoutData = require('../../utils/takeout.js');

const SPICY_OPTIONS = [
  { value: -1, label: '随便' },
  { value: 0, label: '不吃辣' },
  { value: 1, label: '微辣' },
  { value: 2, label: '中辣' },
  { value: 3, label: '重辣' }
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
    // 吃饭方式：cook=自己做（推荐一桌菜） | takeout=点外卖（推荐附近的店）
    mode: 'cook',
    people: 2,
    // 常用人数快捷选项；更多人数用下面的步进器微调（上限 15，再多人就该分桌了）
    peopleOptions: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15],
    peopleMax: 15,
    meal: 'dinner',
    mealLabel: '晚餐',
    mealOptions: [
      { key: 'breakfast', label: '早餐' },
      { key: 'lunch', label: '午餐' },
      { key: 'dinner', label: '晚餐' }
    ],
    // 一桌菜的结构建议（选了人数/餐次后实时更新）
    menu: null,
    menuTotal: 0,
    menuTags: [],
    menuText: '',
    menuTip: '',
    spicyOptions: SPICY_OPTIONS,
    pref: { spicy: -1, light: false },
    budget: 'any',
    budgetOptions: takeoutData.BUDGETS,
    startHint: ''
  },

  onLoad() {
    this.setGreeting();
    const meal = recommender.mealByTime();
    const people = this.clampPeople(app.globalData.people || 2);
    this.setData({
      meal: meal,
      mealLabel: recommender.MEAL_LABEL[meal] || '一餐',
      pref: Object.assign({ spicy: -1, light: false }, app.globalData.pref || {}),
      people: people
    });
    this.refreshMenu();
    this.refreshHint();
  },

  onShow() {
    const city = app.globalData.city;
    this.setData({ city: city || null });
    // 同步「我的」页里可能修改过的偏好
    if (app.globalData.pref) {
      this.setData({ pref: Object.assign({ spicy: -1, light: false }, app.globalData.pref) });
    }
    if (!city) {
      this.autoLocate();
    }
    this.refreshMenu();
    this.refreshHint();
  },

  /** 人数上下限保护（1 ~ peopleMax） */
  clampPeople(n) {
    const v = Math.round(Number(n) || 1);
    return Math.max(1, Math.min(this.data.peopleMax, v));
  },

  /**
   * 刷新「这一桌建议怎么配」
   * 按中式用餐习惯把人数换算成：凉菜（冷盘）+ 热菜（荤/素）+ 汤 + 主食
   */
  refreshMenu() {
    const d = this.data;
    const plan = recommender.planMenu(d.people, d.meal);
    const tags = [];
    if (d.meal === 'breakfast') {
      if (plan.staple) tags.push({ key: 'staple', label: '主食 ' + plan.staple });
      if (plan.snack) tags.push({ key: 'snack', label: '小吃 ' + plan.snack });
      if (plan.light) tags.push({ key: 'light', label: '轻食 ' + plan.light });
    } else {
      if (plan.cold) tags.push({ key: 'cold', label: '凉菜 ' + plan.cold });
      if (plan.meat) tags.push({ key: 'meat', label: '荤菜 ' + plan.meat });
      if (plan.veg) tags.push({ key: 'veg', label: '素菜 ' + plan.veg });
    }
    if (plan.soup) tags.push({ key: 'soup', label: '汤 ' + plan.soup });
    if (d.meal !== 'breakfast' && plan.staple) tags.push({ key: 'staple', label: '主食 ' + plan.staple });

    this.setData({
      menu: plan,
      menuTags: tags,
      menuTotal: recommender.planTotal(plan),
      menuText: recommender.describeMenu(plan, d.meal),
      menuTip: recommender.menuTip(d.people, d.meal)
    });
  },

  /** 主按钮下方那行说明，随模式/城市/人数/餐次/预算变化 */
  refreshHint() {
    const d = this.data;
    let hint;
    if (!d.city) {
      hint = '先选择城市';
    } else if (d.mode === 'takeout') {
      const b = d.budgetOptions.filter(function (x) { return x.key === d.budget; })[0];
      hint = '找 ' + d.people + ' 人的' + d.mealLabel + ' · ' + (b ? b.label : '不限预算') + ' · 按距离排序';
    } else {
      hint = '为 ' + d.people + ' 人推荐一顿' + d.mealLabel + ' · ' + (d.city.cuisine || '家常菜') + '为主';
    }
    this.setData({ startHint: hint });
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
        that.refreshHint();
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
        that.refreshHint();
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
        that.refreshHint();
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
    const value = this.clampPeople(e.currentTarget.dataset.value);
    this.setData({ people: value });
    app.globalData.people = value;
    this.refreshMenu();
    this.refreshHint();
  },

  /** 步进器：人多时快速加减（不受快捷选项限制） */
  onPeopleStep(e) {
    const delta = Number(e.currentTarget.dataset.delta) || 0;
    const value = this.clampPeople(this.data.people + delta);
    if (value === this.data.people) return;
    this.setData({ people: value });
    app.globalData.people = value;
    this.refreshMenu();
    this.refreshHint();
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
  },

  onPickMeal(e) {
    const key = e.currentTarget.dataset.value;
    this.setData({ meal: key, mealLabel: recommender.MEAL_LABEL[key] || '一餐' });
    this.refreshMenu();
    this.refreshHint();
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

  onPickMode(e) {
    const mode = e.currentTarget.dataset.value;
    if (mode !== 'cook' && mode !== 'takeout') return;
    this.setData({ mode: mode });
    this.refreshHint();
  },

  onPickBudget(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ budget: value });
    this.refreshHint();
  },

  onStart() {
    const d = this.data;
    if (!d.city) {
      wx.showToast({ title: '请先选择城市', icon: 'none' });
      const that = this;
      setTimeout(function () { that.onChooseCity(); }, 700);
      return;
    }
    if (d.mode === 'takeout') {
      this.startTakeout();
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
        kind: 'cook',
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
  },

  /** 进入「点外卖」分支：条件交给外卖页，由它负责定位与请求 */
  startTakeout() {
    const d = this.data;
    app.globalData.takeoutQuery = {
      people: d.people,
      meal: d.meal,
      mealLabel: d.mealLabel,
      budget: d.budget
    };
    wx.navigateTo({ url: '/pages/takeout/takeout' });
  }
});
