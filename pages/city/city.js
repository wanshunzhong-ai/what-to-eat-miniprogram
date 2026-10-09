const app = getApp();
const citiesData = require('../../utils/cities.js');
const recommender = require('../../utils/recommender.js');
const wxapi = require('../../utils/wxapi.js');

Page({
  data: {
    keyword: '',
    list: [],
    hotList: [],
    // 离你最近的城市（定位后按距离排序）
    nearList: [],
    nearHint: '',
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
    // 如果之前定位过，直接把「离你最近的城市」列出来（最精准的纠正入口）
    this.renderNear();
  },

  /** 根据最近一次定位坐标，列出距离最近的几个城市 */
  renderNear() {
    const loc = app.globalData.lastLocation;
    if (!loc || typeof loc.latitude !== 'number') {
      this.setData({ nearList: [], nearHint: '' });
      return;
    }
    const list = citiesData.findCandidates(loc.latitude, loc.longitude, 6);
    const accText = (typeof loc.accuracy === 'number' && loc.accuracy > 0)
      ? '（定位精度约 ±' + Math.round(loc.accuracy) + ' 米）'
      : '';
    this.setData({
      nearList: list,
      nearHint: '按定位距离从近到远' + accText + '，识别不准可直接点选'
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
    wxapi.call('showToast', { title: '已切换到 ' + c.name, icon: 'none' });
    setTimeout(function () {
      wxapi.call('navigateBack', {});
    }, 350);
  },

  /**
   * 使用当前位置自动识别
   * 识别明确 → 直接切换并返回；落在两城交界（菜系不同）→ 留在本页列出最近的城市让用户点选
   */
  onUseLocation() {
    if (this.data.locating) return;
    const that = this;
    this.setData({ locating: true });

    wxapi.getLocation({ fresh: true }).then(function (res) {
      that.setData({ locating: false });

      if (res.ok) {
        app.globalData.lastLocation = {
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: res.accuracy,
          at: Date.now()
        };
        that.renderNear();

        const c = recommender.locateCity(res.latitude, res.longitude);
        if (!c) {
          wxapi.call('showToast', { title: '未能识别城市', icon: 'none' });
          return;
        }
        app.setCity(c);
        that.setData({ cityName: c.name });

        // 交界地带或附近没有收录的城市：不自动返回，让用户从上方列表里点一下更准
        if (c.ambiguous || c.lowConfidence) {
          that.setData({
            nearHint: c.ambiguous
              ? '你在「' + c.name + '」和「' + c.alternatives[1].name + '」之间，已按最近的「' + c.name + '」处理，可点上方更正'
              : '附近没有收录的城市，已按最近的「' + c.name + '」处理，可点上方更正'
          });
          wxapi.call('showToast', { title: '已定位到 ' + c.name + '，可确认', icon: 'none' });
          return;
        }

        wxapi.call('showToast', { title: '定位到 ' + c.name, icon: 'none' });
        setTimeout(function () { wxapi.call('navigateBack', {}); }, 500);
        return;
      }

      if (res.reason === 'unsupported') {
        wxapi.call('showToast', { title: '当前环境不支持定位，请手动选择', icon: 'none' });
        return;
      }
      if (res.reason === 'denied') {
        wxapi.call('showToast', { title: '未授权定位，请手动选择', icon: 'none' });
        return;
      }
      if (res.reason === 'timeout') {
        wxapi.call('showToast', { title: '定位超时，请重试或手动选择', icon: 'none' });
        return;
      }
      console.warn('定位失败', res.errMsg || '');
      wxapi.call('showToast', { title: '定位失败，请手动选择', icon: 'none' });
    });
  }
});
