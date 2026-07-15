function read(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === "" || value === undefined || value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    wx.showToast({ title: "保存失败，请稍后重试", icon: "none" });
    return false;
  }
}

function toggleInList(key, id) {
  const current = read(key, []);
  const safeList = Array.isArray(current) ? current : [];
  const next = safeList.includes(id)
    ? safeList.filter((item) => item !== id)
    : [id].concat(safeList);
  write(key, next);
  return next;
}

function appendUnique(key, id) {
  const current = read(key, []);
  const safeList = Array.isArray(current) ? current : [];
  if (safeList.includes(id)) return safeList;
  const next = [id].concat(safeList);
  write(key, next);
  return next;
}

module.exports = {
  appendUnique,
  read,
  toggleInList,
  write
};
