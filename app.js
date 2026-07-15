const api = require("./utils/api");

App({
  _roleSwitchPromise: null,
  _roleSwitchTarget: "",

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
  },

  switchActiveRole(role) {
    if (!["PARENT", "TEACHER"].includes(role)) {
      return Promise.reject(new Error("不支持的身份类型"));
    }
    if (this._roleSwitchPromise) {
      if (this._roleSwitchTarget === role) return this._roleSwitchPromise;
      return this._roleSwitchPromise.then(() => this.switchActiveRole(role));
    }
    if (this.globalData.activeRole === role && this.globalData.account && this.globalData.account.activeRole === role) {
      return Promise.resolve({ activeRole: role, account: this.globalData.account, profileRefreshError: null });
    }

    const previousAccount = this.globalData.account;
    this._roleSwitchTarget = role;
    this._roleSwitchPromise = (async () => {
      await api.switchRole(role);

      // The switch API has already issued a role-scoped access token. Establish
      // the new role immediately; a later profile refresh failure must never
      // make the UI claim that the role switch itself failed.
      this.globalData.activeRole = role;
      this.globalData.account = previousAccount ? { ...previousAccount, activeRole: role } : null;
      this.globalData.authReady = null;
      this.globalData.authError = "";

      try {
        const account = await api.getAccount();
        this.globalData.account = account;
        this.globalData.activeRole = account.activeRole || role;
        return { activeRole: role, account, profileRefreshError: null };
      } catch (profileRefreshError) {
        const account = this.globalData.account;
        // Keep the already-confirmed role, but leave authentication refreshable
        // so the next page retry can request the complete role-specific profile.
        this.globalData.account = null;
        this.globalData.authReady = null;
        return { activeRole: role, account, profileRefreshError };
      }
    })().finally(() => {
      this._roleSwitchPromise = null;
      this._roleSwitchTarget = "";
    });
    return this._roleSwitchPromise;
  }
});
