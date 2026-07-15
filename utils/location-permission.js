const LOCATION_SCOPE = "scope.userLocation";

function errorText(error) {
  return String(error && (error.errMsg || error.message) || "").toLowerCase();
}

function isUserCancel(error) {
  return /\b(?:fail\s+)?cancel(?:led)?\b/.test(errorText(error));
}

function looksPermissionDenied(error) {
  return /auth\s*(?:deny|denied)|permission\s*(?:deny|denied)|unauthori[sz]ed|system permission/.test(errorText(error));
}

function getLocationPermissionState(error) {
  return new Promise((resolve) => {
    const fallbackDenied = looksPermissionDenied(error);
    if (!wx.getSetting) {
      resolve({ denied: fallbackDenied });
      return;
    }
    wx.getSetting({
      success(result = {}) {
        const authSetting = result.authSetting || {};
        resolve({ denied: authSetting[LOCATION_SCOPE] === false || fallbackDenied });
      },
      fail() {
        resolve({ denied: fallbackDenied });
      }
    });
  });
}

function openLocationSetting(onGranted) {
  if (!wx.openSetting) {
    wx.showToast({ title: "请在微信设置中开启位置权限", icon: "none" });
    return;
  }
  wx.openSetting({
    success(result = {}) {
      if (result.authSetting && result.authSetting[LOCATION_SCOPE]) {
        if (typeof onGranted === "function") onGranted();
        return;
      }
      wx.showToast({ title: "位置权限仍未开启，可继续使用地区筛选", icon: "none" });
    },
    fail() {
      wx.showToast({ title: "无法打开设置，请在微信中手动开启", icon: "none" });
    }
  });
}

async function handleChooseLocationFailure(error, retry) {
  if (isUserCancel(error)) return;
  const state = await getLocationPermissionState(error);
  if (!state.denied) {
    wx.showToast({ title: "暂时无法打开地图，请稍后重试", icon: "none" });
    return;
  }
  wx.showModal({
    title: "需要位置权限",
    content: "地图选点需要位置权限。省 / 市 / 区仍可用标准滚动控件选择；开启后可继续搜索并选择详细地点。",
    confirmText: "去设置",
    cancelText: "暂不开启",
    confirmColor: "#3478f6",
    success({ confirm }) {
      if (confirm) openLocationSetting(retry);
    }
  });
}

module.exports = {
  LOCATION_SCOPE,
  getLocationPermissionState,
  handleChooseLocationFailure,
  isUserCancel,
  openLocationSetting
};
