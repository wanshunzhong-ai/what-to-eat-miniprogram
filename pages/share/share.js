// pages/share/share.js
// 朋友分享过来的「点菜清单」页。
//
// 菜单内容直接编码在分享链接里（见 utils/menuShare.js 的 encode/decode），
// 所以打开即看，不需要登录、不依赖云端；链接失效或截断时给一个明确的空态。

const menuShare = require('../../utils/menuShare.js');
const wxapi = require('../../utils/wxapi.js');

function safeDecode(v) {
  if (!v) return '';
  try {
    return decodeURIComponent(v);
  } catch (e) {
    return v;
  }
}

Page({
  data: {
    menu: null,
    groups: [],
    // 朋友分享过来的标题（用于再转发）
    fromFriend: false
  },

  onLoad(options) {
    const raw = safeDecode(options && options.m);
    const menu = menuShare.decode(raw);
    if (menu) {
      this.setData({
        menu: menu,
        groups: menuShare.groupByCategory(menu.dishes),
        fromFriend: true
      });
      wx.setNavigationBarTitle({
        title: menu.people + '人' + menu.mealLabel + '的菜单'
      });
    } else {
      wx.setNavigationBarTitle({ title: '点菜清单' });
    }
  },

  /** 照这份菜单给「我」也配一桌 */
  onGoHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  /** 把菜名再复制一份，方便发到群里 */
  onCopy() {
    const menu = this.data.menu;
    if (!menu) return;
    const text = '【' + menu.people + '人' + menu.mealLabel + '】' +
      menu.dishes.map(function (d) { return d.name; }).join('、');
    wxapi.call('setClipboardData', {
      data: text,
      success() {
        wxapi.call('showToast', { title: '菜名已复制', icon: 'none' });
      },
      fail() {
        wxapi.call('showToast', { title: text, icon: 'none' });
      }
    });
  },

  onShareAppMessage() {
    const menu = this.data.menu;
    if (!menu) {
      return { title: '今天吃什么？我帮你决定', path: '/pages/index/index' };
    }
    const names = menu.dishes.slice(0, 8).map(function (d) { return d.name; });
    return {
      title: (menu.people + '人' + menu.mealLabel + '吃这些：' + names.join('、')).slice(0, 60),
      path: '/pages/share/share?m=' + encodeURIComponent(menuShare.encode(menu))
    };
  }
});
