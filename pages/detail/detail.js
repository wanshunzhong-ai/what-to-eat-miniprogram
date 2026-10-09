const app = getApp();
const dishesData = require('../../utils/dishes.js');
const recommender = require('../../utils/recommender.js');

const SPICY_TEXT = { 0: '不辣', 1: '微辣', 2: '中辣', 3: '重辣' };
const DIFF_TEXT = { 1: '简单', 2: '适中', 3: '有点挑战' };

Page({
  data: {
    dish: null,
    people: 2,
    isFav: false,
    spicyText: '不辣',
    difficultyText: '简单',
    seasoningText: ''
  },

  onLoad(query) {
    const id = query.id;
    const people = Number(query.people) || 2;
    const raw = dishesData.getById(id);
    if (!raw) {
      this.setData({ dish: null });
      return;
    }
    const d = recommender.materialize(raw, people);
    this.setData({
      dish: d,
      people: people,
      isFav: app.isFavorite(d.id),
      spicyText: SPICY_TEXT[d.spicy] || '不辣',
      difficultyText: DIFF_TEXT[d.difficulty] || '简单',
      seasoningText: (d.seasonings || []).join('、')
    });
    wx.setNavigationBarTitle({ title: raw.name });
  },

  onFav() {
    const d = this.data.dish;
    if (!d) return;
    const added = app.toggleFavorite({
      id: d.id,
      name: d.name,
      emoji: d.emoji,
      cuisine: d.cuisine,
      category: d.category
    });
    this.setData({ isFav: added });
    wx.showToast({ title: added ? '已收藏 ⭐' : '已取消收藏', icon: 'none' });
  },

  onShareAppMessage() {
    const d = this.data.dish;
    return {
      title: d ? ('试试这道菜：' + d.name + ' ' + d.emoji) : '今天吃什么？',
      path: '/pages/index/index'
    };
  }
});
