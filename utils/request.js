const { API_BASE_URL } = require("./config");

const TOKEN_KEY = "tutor_link_access_token";
const ACCESS_EXPIRES_KEY = "tutor_link_access_expires_at";
const REFRESH_KEY = "tutor_link_refresh_token";
const ROLE_KEY = "tutor_link_active_role";
const DEVICE_KEY = "tutor_link_device_id";

let refreshPromise = null;
let loginPromise = null;

function messageFrom(data, fallback) {
  if (!data) return fallback;
  if (Array.isArray(data.message)) return data.message.join("；");
  return data.message || data.error || fallback;
}

function wxRequest(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      timeout: 15000,
      ...options,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        const error = new Error(messageFrom(response.data, `请求失败（${response.statusCode}）`));
        error.statusCode = response.statusCode;
        error.data = response.data;
        reject(error);
      },
      fail(reason) {
        const error = new Error("暂时无法连接服务器，请检查网络后重试");
        error.network = true;
        error.cause = reason;
        reject(error);
      }
    });
  });
}

function getDeviceId() {
  let deviceId = wx.getStorageSync(DEVICE_KEY);
  if (!deviceId) {
    deviceId = `wx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    wx.setStorageSync(DEVICE_KEY, deviceId);
  }
  return deviceId;
}

function getActiveRole() {
  return wx.getStorageSync(ROLE_KEY) || "PARENT";
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(ACCESS_EXPIRES_KEY);
  wx.removeStorageSync(REFRESH_KEY);
}

function setSession(data) {
  if (data && data.accessToken) {
    wx.setStorageSync(TOKEN_KEY, data.accessToken);
    wx.setStorageSync(ACCESS_EXPIRES_KEY, Date.now() + Number(data.expiresIn || 900) * 1000);
  }
  if (data && data.refreshToken) wx.setStorageSync(REFRESH_KEY, data.refreshToken);
  const role = data && data.account && data.account.activeRole
    ? data.account.activeRole
    : data && data.activeRole;
  if (role) wx.setStorageSync(ROLE_KEY, role);
}

function loginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success({ code }) {
        if (code) resolve(code);
        else reject(new Error("微信登录未返回有效凭证"));
      },
      fail() {
        reject(new Error("微信登录失败，请稍后重试"));
      }
    });
  });
}

function loginSession() {
  if (!loginPromise) {
    loginPromise = (async () => {
      const code = await loginCode();
      const deviceId = getDeviceId();
      const data = await wxRequest({
        url: `${API_BASE_URL}/api/v1/auth/wechat-login`,
        method: "POST",
        data: { code, deviceId, activeRole: getActiveRole() },
        header: {
          "content-type": "application/json",
          "X-Device-Id": deviceId
        }
      });
      setSession(data);
      return data;
    })().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
}

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = wx.getStorageSync(REFRESH_KEY);
      if (!refreshToken) throw new Error("登录状态已失效");
      const data = await wxRequest({
        url: `${API_BASE_URL}/api/v1/auth/refresh`,
        method: "POST",
        data: { refreshToken, activeRole: getActiveRole() },
        header: {
          "content-type": "application/json",
          "X-Device-Id": getDeviceId()
        }
      });
      setSession(data);
      return data.accessToken;
    })().catch((error) => {
      // A temporary network/server failure must not destroy an otherwise valid
      // refresh session. Only an explicit client-side auth rejection means the
      // stored credentials are no longer usable.
      if (!error.network && error.statusCode >= 400 && error.statusCode < 500) clearSession();
      throw error;
    }).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request(path, options = {}, retry = { refresh: true, login: true }) {
  let token = wx.getStorageSync(TOKEN_KEY);
  const accessExpiresAt = Number(wx.getStorageSync(ACCESS_EXPIRES_KEY) || 0);
  const canPreemptivelyRefresh = token
    && retry.refresh
    && wx.getStorageSync(REFRESH_KEY)
    && !path.includes("/auth/")
    && accessExpiresAt <= Date.now() + 30 * 1000;
  if (canPreemptivelyRefresh) {
    try {
      token = await refreshAccessToken();
    } catch (refreshError) {
      if (refreshError.network || !refreshError.statusCode || refreshError.statusCode >= 500) throw refreshError;
      if (!retry.login) throw refreshError;
      await loginSession();
      token = wx.getStorageSync(TOKEN_KEY);
    }
  }
  try {
    return await wxRequest({
      url: `${API_BASE_URL}${path}`,
      method: options.method || "GET",
      data: options.data,
      header: {
        "content-type": "application/json",
        "X-Device-Id": getDeviceId(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.header || {})
      }
    });
  } catch (error) {
    if (error.statusCode !== 401) throw error;

    if (retry.refresh && wx.getStorageSync(REFRESH_KEY)) {
      try {
        await refreshAccessToken();
        return request(path, options, { refresh: false, login: retry.login });
      } catch (refreshError) {
        if (refreshError.network || !refreshError.statusCode || refreshError.statusCode >= 500) throw refreshError;
      }
    }

    if (retry.login) {
      clearSession();
      await loginSession();
      return request(path, options, { refresh: false, login: false });
    }
    throw error;
  }
}

async function ensureAuthenticated() {
  if (!wx.getStorageSync(TOKEN_KEY) && !wx.getStorageSync(REFRESH_KEY)) {
    const session = await loginSession();
    return session.account;
  }
  return request("/api/v1/auth/me");
}

module.exports = {
  ACCESS_EXPIRES_KEY,
  API_BASE_URL,
  DEVICE_KEY,
  REFRESH_KEY,
  ROLE_KEY,
  TOKEN_KEY,
  clearSession,
  ensureAuthenticated,
  getActiveRole,
  getDeviceId,
  loginSession,
  request,
  setSession
};
