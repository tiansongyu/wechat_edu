Component({
  properties: {
    current: {
      type: String,
      value: "home"
    }
  },

  data: {
    items: [
      { key: "home", label: "首页", icon: "⌂", url: "/pages/index/index" },
      { key: "map", label: "地图寻单", icon: "◇", url: "/pages/map/map" },
      { key: "publish", label: "发布", icon: "+", url: "/pages/publish/publish", primary: true },
      { key: "messages", label: "消息", icon: "◌", url: "/pages/messages/messages" },
      { key: "profile", label: "我的", icon: "◎", url: "/pages/profile/profile" }
    ]
  },

  methods: {
    navigate(event) {
      const { key, url } = event.currentTarget.dataset;
      if (!url || key === this.data.current) return;
      wx.redirectTo({ url });
    }
  }
});
