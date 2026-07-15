const { DEFAULT_MESSAGES } = require("../../utils/data");
const store = require("../../utils/store");
const api = require("../../utils/api");

Page({
  data: {
    currentTab: "all",
    tabs: [
      { key: "all", label: "全部" },
      { key: "chat", label: "沟通" },
      { key: "notice", label: "通知" }
    ],
    messages: [],
    visibleMessages: [],
    unreadCount: 0
  },

  onShow() {
    const key = getApp().globalData.storageKeys.messages;
    const stored = store.read(key, null);
    const messages = Array.isArray(stored) ? stored : DEFAULT_MESSAGES;
    if (!Array.isArray(stored)) store.write(key, messages);
    this.setMessages(messages);
    this.loadRemoteMessages();
  },

  async loadRemoteMessages() {
    try {
      if (getApp().globalData.authReady) await getApp().globalData.authReady;
      const [notifications, conversations] = await Promise.all([
        api.request("/api/v1/notifications"),
        api.request("/api/v1/conversations")
      ]);
      const notices = notifications.map((item) => ({
        id: item.id,
        type: "notice",
        title: item.title,
        content: item.content,
        time: new Date(item.createdAt).toLocaleDateString(),
        unread: !item.readAt,
        icon: "✓",
        tone: item.type === "APPLICATION" ? "blue" : "green",
        remote: true
      }));
      const chats = conversations.map((item) => {
        const peer = item.members[0] && item.members[0].account;
        const last = item.messages[0];
        return {
          id: item.id,
          type: "chat",
          title: peer ? peer.nickname : "平台用户",
          content: last ? last.content : "会话已建立，可以开始沟通",
          time: last ? new Date(last.createdAt).toLocaleDateString() : "刚刚",
          unread: false,
          icon: peer ? peer.nickname.slice(0, 1) : "聊",
          tone: "purple",
          remote: true
        };
      });
      if (notices.length || chats.length) {
        const messages = notices.concat(chats);
        store.write(getApp().globalData.storageKeys.messages, messages);
        this.setMessages(messages);
      }
    } catch (error) {}
  },

  switchTab(event) {
    this.setData({ currentTab: event.currentTarget.dataset.key }, () => this.applyTab());
  },

  setMessages(messages) {
    this.setData({
      messages,
      unreadCount: messages.filter((message) => message.unread).length
    }, () => this.applyTab());
  },

  applyTab() {
    const { currentTab, messages } = this.data;
    this.setData({
      visibleMessages: currentTab === "all" ? messages : messages.filter((message) => message.type === currentTab)
    });
  },

  openMessage(event) {
    const id = event.currentTarget.dataset.id;
    const message = this.data.messages.find((item) => item.id === id);
    if (!message) return;
    const messages = this.data.messages.map((item) => item.id === id ? { ...item, unread: false } : item);
    store.write(getApp().globalData.storageKeys.messages, messages);
    this.setMessages(messages);
    if (message.remote && message.type === "notice") api.request(`/api/v1/notifications/${message.id}/read`, { method: "POST" }).catch(() => {});

    wx.showModal({
      title: message.title,
      content: message.content,
      showCancel: message.type === "chat",
      cancelText: "稍后回复",
      confirmText: message.type === "chat" ? "快捷回复" : "知道了",
      confirmColor: "#3478f6",
      success: ({ confirm }) => {
        if (confirm && message.type === "chat") {
          wx.showToast({ title: "已发送：好的，谢谢", icon: "success" });
        }
      }
    });
  },

  markAllRead() {
    if (!this.data.unreadCount) {
      wx.showToast({ title: "没有未读消息", icon: "none" });
      return;
    }
    const messages = this.data.messages.map((item) => ({ ...item, unread: false }));
    store.write(getApp().globalData.storageKeys.messages, messages);
    this.setMessages(messages);
    api.request("/api/v1/notifications/read-all", { method: "POST" }).catch(() => {});
    wx.showToast({ title: "已全部读完", icon: "success" });
  }
});
