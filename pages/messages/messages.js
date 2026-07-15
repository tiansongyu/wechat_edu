const api = require("../../utils/api");

Page({
  data: {
    loading: true,
    error: "",
    markingAll: false,
    currentTab: "all",
    tabs: [{ key: "all", label: "全部" }, { key: "chat", label: "沟通" }, { key: "notice", label: "通知" }],
    messages: [],
    visibleMessages: [],
    unreadCount: 0,
    chatCount: 0,
    noticeCount: 0
  },

  onShow() {
    this.loadMessages();
  },

  async loadMessages(showLoading = true) {
    if (showLoading) this.setData({ loading: true, error: "" });
    try {
      await getApp().ensureAuth();
      const [notifications, conversations] = await Promise.all([api.listNotifications(), api.listConversations()]);
      const notices = notifications.map((item) => ({
        id: item.id,
        type: "notice",
        title: item.title,
        content: item.content,
        time: api.formatDate(item.createdAt),
        unread: !item.readAt,
        icon: item.type === "APPLICATION" ? "申" : item.type === "AUDIT" ? "审" : "通",
        tone: item.type === "APPLICATION" ? "blue" : item.type === "AUDIT" ? "orange" : "green",
        raw: item
      }));
      const chats = conversations.map((item) => {
        const peer = item.members && item.members[0] && item.members[0].account;
        const last = item.messages && item.messages[0];
        return {
          id: item.id,
          type: "chat",
          title: peer && peer.nickname ? peer.nickname : "平台用户",
          content: last ? last.content : "会话已建立，可以开始沟通",
          time: api.formatDate(last ? last.createdAt : item.updatedAt),
          unread: Number(item.unreadCount || 0) > 0,
          unreadNumber: Number(item.unreadCount || 0),
          icon: peer && peer.nickname ? peer.nickname.slice(0, 1) : "聊",
          avatarUrl: peer && peer.avatarUrl ? peer.avatarUrl : "",
          tone: "purple"
        };
      });
      const messages = notices.concat(chats).sort((a, b) => {
        const left = a.raw ? a.raw.createdAt : conversations.find((item) => item.id === a.id)?.updatedAt;
        const right = b.raw ? b.raw.createdAt : conversations.find((item) => item.id === b.id)?.updatedAt;
        return new Date(right || 0).getTime() - new Date(left || 0).getTime();
      });
      this.setData({
        loading: false,
        error: "",
        messages,
        unreadCount: messages.reduce((count, item) => count + (item.unreadNumber || (item.unread ? 1 : 0)), 0),
        chatCount: chats.length,
        noticeCount: notices.length
      }, () => this.applyTab());
    } catch (error) {
      this.setData({ loading: false, error: error.message || "消息加载失败", messages: [], visibleMessages: [], unreadCount: 0 });
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
    this.setData({ visibleMessages: currentTab === "all" ? messages : messages.filter((item) => item.type === currentTab) });
  },

  async openMessage(event) {
    const message = this.data.messages.find((item) => item.id === event.currentTarget.dataset.id);
    if (!message) return;
    if (message.type === "chat") {
      wx.navigateTo({ url: `/pages/conversation/conversation?id=${message.id}&title=${encodeURIComponent(message.title)}` });
      return;
    }
    try {
      if (message.unread) await api.markNotificationRead(message.id);
      await this.loadMessages(false);
      wx.showModal({ title: message.title, content: message.content, showCancel: false, confirmText: "知道了", confirmColor: "#3478f6" });
    } catch (error) {
      wx.showToast({ title: error.message || "无法更新通知状态", icon: "none" });
    }
  },

  async markAllRead() {
    if (!this.data.unreadCount || this.data.markingAll) {
      if (!this.data.unreadCount) wx.showToast({ title: "没有未读消息", icon: "none" });
      return;
    }
    this.setData({ markingAll: true });
    try {
      const chatIds = this.data.messages.filter((item) => item.type === "chat").map((item) => item.id);
      await Promise.all([api.markAllNotificationsRead()].concat(chatIds.map((id) => api.markConversationRead(id))));
      await this.loadMessages(false);
      wx.showToast({ title: "消息已全部读完", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "操作失败", icon: "none" });
    } finally {
      this.setData({ markingAll: false });
    }
  }
});
