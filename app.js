const api = require("./utils/api");

App({
  globalData: {
    apiReady: false,
    activeRole: "PARENT",
    storageKeys: {
      applications: "tutor_link_applications",
      favorites: "tutor_link_favorites",
      messages: "tutor_link_messages",
      posts: "tutor_link_posts",
      settings: "tutor_link_settings"
    }
  },

  onLaunch() {
    const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null;
    this.globalData.isTourist = !accountInfo || accountInfo.miniProgram.appId === "touristappid";
    this.globalData.activeRole = api.getActiveRole();
    this.globalData.authReady = api.ensureLogin()
      .then((data) => {
        this.globalData.apiReady = true;
        this.globalData.activeRole = data.account.activeRole;
        this.globalData.account = data.account;
        return data;
      })
      .catch(() => {
        this.globalData.apiReady = false;
        return null;
      });
  }
});
