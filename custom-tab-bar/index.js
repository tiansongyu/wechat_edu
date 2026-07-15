const ITEMS = [
  { key: "home", label: "首页", icon: "⌂", path: "/pages/index/index" },
  { key: "map", label: "地图寻单", icon: "◇", path: "/pages/map/map" },
  { key: "publish", label: "发布", icon: "+", path: "/pages/publish/publish", primary: true },
  { key: "messages", label: "消息", icon: "◌", path: "/pages/messages/messages" },
  { key: "profile", label: "我的", icon: "◎", path: "/pages/profile/profile" }
];

const ROUTE_INDEX = ITEMS.reduce((result, item, index) => {
  result[item.path.slice(1)] = index;
  return result;
}, {});

Component({
  data: {
    selected: 0,
    items: ITEMS
  },

  lifetimes: {
    attached() {
      this.syncSelected();
    }
  },

  pageLifetimes: {
    show() {
      this.syncSelected();
    }
  },

  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const selected = page && ROUTE_INDEX[page.route];
      if (Number.isInteger(selected) && selected !== this.data.selected) {
        this.setData({ selected });
      }
    },

    switchTab(event) {
      const { index, path } = event.currentTarget.dataset;
      if (!path) return;
      this.setData({ selected: Number(index) });
      wx.switchTab({ url: path });
    }
  }
});
