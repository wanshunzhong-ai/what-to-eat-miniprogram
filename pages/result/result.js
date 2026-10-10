const app = getApp();
const engine = require('../../utils/engine.js');
const menuShare = require('../../utils/menuShare.js');

const SPICY_TEXT = { 0: '不辣', 1: '微辣', 2: '中辣', 3: '重辣' };

// 分享链接里最多塞多少个字符。超了就退化成普通分享，避免 path 被截断。
const MAX_SHARE_PAYLOAD = 700;

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

  onReady() {
    // 先把清单图悄悄画好，分享时直接当封面用（标题栏里的「转发」也能立刻用）
    this.prepareShareImage();
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
      // 菜单换了，分享封面也跟着换
      that.prepareShareImage();
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

  // ---------------------------------------------------------- 导出与分享

  /** 把整桌菜单复制成文本，方便粘到群里 */
  onCopyMenu() {
    const r = app.globalData.lastResult;
    const text = menuShare.buildText(r);
    if (!text) {
      wx.showToast({ title: '还没有菜单', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: '清单已复制', icon: 'none' });
      },
      fail() {
        wx.showToast({ title: '复制失败，长按页面手动复制吧', icon: 'none' });
      }
    });
  },

  /** 生成一张清单图并存进相册 */
  onSaveMenuImage() {
    const r = app.globalData.lastResult;
    if (!r || !r.dishes || !r.dishes.length) {
      wx.showToast({ title: '还没有菜单', icon: 'none' });
      return;
    }
    if (this._exporting) return;
    this._exporting = true;

    const that = this;
    wx.showLoading({ title: '生成清单图…', mask: true });

    menuShare.exportCard(this, 'menuCanvas', r).then(function (path) {
      that._shareImage = path;
      return new Promise(function (resolve) {
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success() { resolve(true); },
          fail(err) { resolve((err && err.errMsg) || 'fail'); }
        });
      });
    }).then(function (res) {
      wx.hideLoading();
      that._exporting = false;

      if (res === true) {
        wx.showToast({ title: '已存到相册', icon: 'success' });
        return;
      }
      const msg = String(res);
      if (msg.indexOf('auth deny') >= 0 || msg.indexOf('authorize') >= 0) {
        wx.showModal({
          title: '需要相册权限',
          content: '保存清单图需要「保存到相册」权限，去设置里打开一下就可以存了。',
          confirmText: '去设置',
          success(m) {
            if (m.confirm) wx.openSetting();
          }
        });
        return;
      }
      wx.showToast({ title: '保存失败：' + msg, icon: 'none' });
    }).catch(function (e) {
      wx.hideLoading();
      that._exporting = false;
      wx.showToast({ title: '生成失败：' + ((e && e.message) || ''), icon: 'none' });
    });
  },

  /** 提前把清单图画好，分享时当封面 */
  prepareShareImage() {
    const r = app.globalData.lastResult;
    if (!r || !r.dishes || !r.dishes.length || !wx.createSelectorQuery) return;
    const that = this;
    menuShare.exportCard(this, 'menuCanvas', r).then(function (path) {
      that._shareImage = path;
    }).catch(function () {
      that._shareImage = '';
    });
  },

  onShareAppMessage() {
    const r = app.globalData.lastResult;
    if (!r || !r.dishes || !r.dishes.length) {
      return { title: '今天吃什么？我帮你决定', path: '/pages/index/index' };
    }

    // 菜名直接编进链接：朋友点开就能看到这一桌，不用登录、不用查库
    const payload = menuShare.encode(r);
    const out = { title: menuShare.buildShareTitle(r) };

    if (payload && payload.length <= MAX_SHARE_PAYLOAD) {
      out.path = '/pages/share/share?m=' + encodeURIComponent(payload);
    } else {
      out.path = '/pages/index/index';
    }
    if (this._shareImage) out.imageUrl = this._shareImage;

    return out;
  }
});
