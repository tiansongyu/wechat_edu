const { API_BASE_URL } = require("./config");

const TOKEN_KEY = "tutor_link_access_token";
const REFRESH_KEY = "tutor_link_refresh_token";
const ROLE_KEY = "tutor_link_active_role";

function wxRequest(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      ...options,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        const error = new Error(response.data && response.data.message ? response.data.message : `请求失败（${response.statusCode}）`);
        error.statusCode = response.statusCode;
        error.data = response.data;
        reject(error);
      },
      fail(reason) {
        const error = new Error("暂时无法连接服务器");
        error.network = true;
        error.cause = reason;
        reject(error);
      }
    });
  });
}

async function refreshAccessToken() {
  const refreshToken = wx.getStorageSync(REFRESH_KEY);
  if (!refreshToken) throw new Error("没有刷新凭证");
  const data = await wxRequest({
    url: `${API_BASE_URL}/api/v1/auth/refresh`,
    method: "POST",
    data: { refreshToken, activeRole: getActiveRole() },
    header: { "content-type": "application/json" }
  });
  wx.setStorageSync(TOKEN_KEY, data.accessToken);
  wx.setStorageSync(REFRESH_KEY, data.refreshToken);
  return data.accessToken;
}

async function request(path, options = {}, canRetry = true) {
  const token = wx.getStorageSync(TOKEN_KEY);
  try {
    return await wxRequest({
      url: `${API_BASE_URL}${path}`,
      method: options.method || "GET",
      data: options.data,
      header: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.header || {})
      }
    });
  } catch (error) {
    if (error.statusCode === 401 && canRetry && wx.getStorageSync(REFRESH_KEY)) {
      await refreshAccessToken();
      return request(path, options, false);
    }
    throw error;
  }
}

function setSession(data) {
  wx.setStorageSync(TOKEN_KEY, data.accessToken);
  wx.setStorageSync(REFRESH_KEY, data.refreshToken);
  if (data.account && data.account.activeRole) wx.setStorageSync(ROLE_KEY, data.account.activeRole);
}

function getActiveRole() {
  return wx.getStorageSync(ROLE_KEY) || "PARENT";
}

module.exports = {
  API_BASE_URL,
  ROLE_KEY,
  TOKEN_KEY,
  REFRESH_KEY,
  getActiveRole,
  request,
  setSession
};
