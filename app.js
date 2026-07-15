const api = require("./utils/api");

App({
  globalData: {
    authReady: null,
    account: null,
    activeRole: "PARENT",
    authError: ""
  },

  onLaunch() {
    this.globalData.activeRole = api.getActiveRole();
    this.globalData.authReady = this.ensureAuth();
  },

  ensureAuth(force = false) {
    if (this.globalData.account && !force) return Promise.resolve(this.globalData.account);
    if (this.globalData.authReady && !force) return this.globalData.authReady;
    this.globalData.authReady = api.ensureLogin()
      .then((account) => {
        this.globalData.account = account;
        this.globalData.activeRole = account.activeRole;
        this.globalData.authError = "";
        return account;
      })
      .catch((error) => {
        this.globalData.authError = error.message || "登录失败";
        this.globalData.authReady = null;
        throw error;
      });
    return this.globalData.authReady;
  }
});
