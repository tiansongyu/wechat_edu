const api = require("../../utils/api");

function normalizeCollection(response, label) {
  const payload = response && response.data !== undefined ? response.data : response;
  const items = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.items)
      ? payload.items
      : null;
  if (!items) throw new Error(`${label}数据格式异常，请重新加载`);
  return items;
}

function settleCollection(promise, label) {
  return promise
    .then((response) => ({ items: normalizeCollection(response, label), error: null }))
    .catch((error) => ({ items: [], error }));
}

function formatListTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDate) / 86400000);
  const pad = (number) => String(number).padStart(2, "0");
  if (dayDiff === 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (dayDiff === 1) return "昨天";
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function unreadLabel(count) {
  const number = Number(count || 0);
  const value = Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  return value > 99 ? "99+" : value ? String(value) : "";
}

function unreadValue(count) {
  const number = Number(count || 0);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function communicationRoleMeta(role) {
  return role === "TEACHER"
    ? { role: "TEACHER", label: "老师沟通", tone: "teacher" }
    : { role: "PARENT", label: "家长沟通", tone: "parent" };
}

Page({
  data: {
    loading: true,
    error: "",
    warning: "",
    markingAll: false,
    currentTab: "all",
    tabs: [{ key: "all", label: "全部" }, { key: "chat", label: "沟通" }, { key: "notice", label: "通知" }],
    messages: [],
    visibleMessages: [],
    unreadCount: 0,
    unreadLabel: "",
    chatCount: 0,
    noticeCount: 0,
    activeRole: "PARENT",
    loadedRole: "",
    roleLabel: "家长沟通",
    roleTone: "parent",
    emptyTitle: "这里还没有消息",
    emptyCopy: "申请进度和沟通会显示在这里"
  },

  onShow() {
    this.loadMessages();
  },

  async loadMessages(showLoading = true) {
    const requestId = (this._messageLoadRequestId || 0) + 1;
    this._messageLoadRequestId = requestId;
    const requestedRole = communicationRoleMeta(api.getActiveRole()).role;
    if (showLoading) this.setData({ loading: true, error: "", warning: "" });
    try {
      const activeRoleMeta = communicationRoleMeta(requestedRole);
      const roleChanged = Boolean(this.data.loadedRole && this.data.loadedRole !== activeRoleMeta.role);
      this.setData({
        activeRole: activeRoleMeta.role,
        roleLabel: activeRoleMeta.label,
        roleTone: activeRoleMeta.tone,
        ...(roleChanged ? {
          messages: [],
          visibleMessages: [],
          unreadCount: 0,
          unreadLabel: "",
          chatCount: 0,
          noticeCount: 0,
          loadedRole: ""
        } : {})
      });
      await getApp().ensureAuth();
      const [notificationResult, conversationResult] = await Promise.all([
        settleCollection(api.listNotifications(), "平台通知"),
        settleCollection(api.listConversations(), "沟通会话")
      ]);
      if (this._messageLoadRequestId !== requestId || communicationRoleMeta(api.getActiveRole()).role !== activeRoleMeta.role) return false;
      if (notificationResult.error && conversationResult.error) {
        throw new Error(notificationResult.error.message || conversationResult.error.message || "消息加载失败");
      }
      const notifications = notificationResult.items.filter((item) => item && typeof item === "object" && item.id);
      const conversations = conversationResult.items.filter((item) => item && typeof item === "object" && item.id);
      const partialWarning = notificationResult.error
        ? "平台通知暂未同步，沟通会话仍可正常使用"
        : conversationResult.error
          ? "沟通会话暂未同步，平台通知仍可正常查看"
          : "";
      const notices = notifications.map((item) => ({
        id: item.id,
        type: "notice",
        title: String(item.title || "平台通知"),
        content: String(item.content || "暂无详情"),
        time: formatListTime(item.createdAt),
        sortTime: new Date(item.createdAt || 0).getTime() || 0,
        unread: !item.readAt,
        unreadNumber: item.readAt ? 0 : 1,
        unreadLabel: item.readAt ? "" : "1",
        icon: item.type === "APPLICATION" ? "申" : item.type === "AUDIT" ? "审" : "通",
        tone: item.type === "APPLICATION" ? "blue" : item.type === "AUDIT" ? "orange" : "green"
      }));
      const chats = conversations.map((item) => {
        const peer = item.members && item.members[0] && item.members[0].account;
        const last = item.messages && item.messages[0];
        const roleMeta = communicationRoleMeta(item.viewerRole || item.activeRole || activeRoleMeta.role);
        return {
          id: item.id,
          type: "chat",
          title: peer && peer.nickname ? peer.nickname : "平台用户",
          content: String(last && last.content || "会话已建立，可以开始沟通"),
          time: formatListTime(last ? last.createdAt : item.updatedAt),
          sortTime: new Date(last && last.createdAt || item.updatedAt || 0).getTime() || 0,
          unread: unreadValue(item.unreadCount) > 0,
          unreadNumber: unreadValue(item.unreadCount),
          unreadLabel: unreadLabel(item.unreadCount),
          icon: peer && peer.nickname ? peer.nickname.slice(0, 1) : "聊",
          avatarUrl: peer && peer.avatarUrl ? peer.avatarUrl : "",
          tone: "purple",
          roleLabel: roleMeta.label,
          roleTone: roleMeta.tone
        };
      });
      const messages = notices.concat(chats).sort((a, b) => b.sortTime - a.sortTime);
      const totalUnread = messages.reduce((count, item) => count + Number(item.unreadNumber || 0), 0);
      this.setData({
        loading: false,
        error: "",
        warning: partialWarning,
        messages,
        unreadCount: totalUnread,
        unreadLabel: unreadLabel(totalUnread),
        chatCount: chats.length,
        noticeCount: notices.length,
        activeRole: activeRoleMeta.role,
        roleLabel: activeRoleMeta.label,
        roleTone: activeRoleMeta.tone,
        loadedRole: activeRoleMeta.role
      }, () => this.applyTab());
      return true;
    } catch (error) {
      if (this._messageLoadRequestId !== requestId || communicationRoleMeta(api.getActiveRole()).role !== requestedRole) return false;
      const message = error.message || "消息加载失败";
      if (this.data.messages.length && this.data.loadedRole === this.data.activeRole) {
        this.setData({ loading: false, error: "", warning: `${message}，当前展示上次成功加载的内容` });
      } else {
        this.setData({
          loading: false,
          error: message,
          warning: "",
          messages: [],
          visibleMessages: [],
          unreadCount: 0,
          unreadLabel: "",
          chatCount: 0,
          noticeCount: 0
        });
      }
      return false;
    }
  },

  async onPullDownRefresh() {
    await this.loadMessages(false);
    wx.stopPullDownRefresh();
  },

  retry() { this.loadMessages(); },

  switchTab(event) {
    this.setData({ currentTab: event.currentTarget.dataset.key }, () => this.applyTab());
  },

  applyTab() {
    const { currentTab, messages } = this.data;
    const visibleMessages = currentTab === "all" ? messages : messages.filter((item) => item.type === currentTab);
    const emptyMeta = currentTab === "chat"
      ? { emptyTitle: "还没有沟通会话", emptyCopy: "匹配成功后，可以在这里安心沟通上课安排" }
      : currentTab === "notice"
        ? { emptyTitle: "暂时没有平台通知", emptyCopy: "审核、报名和预约进度会及时出现在这里" }
        : { emptyTitle: "这里还没有消息", emptyCopy: "申请进度和沟通会显示在这里" };
    this.setData({ visibleMessages, ...emptyMeta });
  },

  async openMessage(event) {
    const message = this.data.messages.find((item) => item.id === event.currentTarget.dataset.id);
    if (!message) return;
    if (message.type === "chat") {
      wx.navigateTo({ url: `/pages/conversation/conversation?id=${message.id}&title=${encodeURIComponent(message.title)}` });
      return;
    }
    wx.showModal({ title: message.title, content: message.content, showCancel: false, confirmText: "知道了", confirmColor: "#3478f6" });
    if (!message.unread) return;
    try {
      await api.markNotificationRead(message.id);
      await this.loadMessages(false);
    } catch (error) {
      wx.showToast({ title: error.message || "通知已打开，已读状态稍后重试", icon: "none" });
    }
  },

  async markAllRead() {
    if (!this.data.unreadCount || this.data.markingAll) {
      if (!this.data.unreadCount) wx.showToast({ title: "没有未读消息", icon: "none" });
      return;
    }
    this.setData({ markingAll: true });
    try {
      const chatIds = this.data.messages.filter((item) => item.type === "chat" && item.unread).map((item) => item.id);
      const commands = [api.markAllNotificationsRead()].concat(chatIds.map((id) => api.markConversationRead(id)));
      const results = await Promise.all(commands.map((command) => command.then(() => null).catch((error) => error)));
      await this.loadMessages(false);
      const failed = results.filter(Boolean);
      wx.showToast({
        title: failed.length ? "部分状态未同步，请重试" : "消息已全部读完",
        icon: failed.length ? "none" : "success"
      });
    } catch (error) {
      wx.showToast({ title: error.message || "操作失败", icon: "none" });
    } finally {
      this.setData({ markingAll: false });
    }
  }
});
