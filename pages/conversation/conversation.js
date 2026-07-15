const api = require("../../utils/api");

function safeDecode(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return String(value);
  }
}

function getErrorMessage(error, fallback) {
  return error && error.message ? error.message : fallback;
}

function getTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function communicationRoleMeta(role) {
  return role === "TEACHER"
    ? { role: "TEACHER", label: "老师沟通", tone: "teacher" }
    : { role: "PARENT", label: "家长沟通", tone: "parent" };
}

function formatMessageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (isToday) return time;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function unwrapPage(response) {
  if (response && response.data) {
    if (Array.isArray(response.data) || Array.isArray(response.data.items)) return response.data;
  }
  return response;
}

function normalizePage(response) {
  const payload = unwrapPage(response);
  const items = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.items)
      ? payload.items
      : null;
  if (!items) throw new Error("消息数据格式异常，请重试");
  let nextCursor = payload && !Array.isArray(payload) ? payload.nextCursor : null;
  if (!nextCursor && payload && payload.hasMore && items.length) {
    nextCursor = items[items.length - 1].id;
  }
  return { items, nextCursor: nextCursor || "" };
}

function mapMessage(message, accountId, forceMine = false) {
  const sender = message.sender || {};
  const senderId = message.senderId || sender.id || "";
  const explicitMine = typeof message.isMine === "boolean"
    ? message.isMine
    : typeof message.mine === "boolean"
      ? message.mine
      : false;
  const isMine = forceMine || explicitMine || Boolean(accountId && senderId === accountId);
  const senderName = sender.nickname || message.senderName || (isMine ? "我" : "平台用户");

  return {
    id: message.id ? String(message.id) : "",
    content: typeof message.content === "string" ? message.content : "",
    createdAt: message.createdAt || "",
    sortTime: getTimestamp(message.createdAt),
    timeLabel: formatMessageTime(message.createdAt),
    senderName,
    avatarUrl: sender.avatarUrl || message.senderAvatarUrl || "",
    avatarText: senderName.slice(0, 1),
    isMine
  };
}

function sortAndDedupe(messages) {
  const byId = {};
  messages.forEach((message) => {
    if (message.id) byId[message.id] = message;
  });
  return Object.keys(byId)
    .map((id) => byId[id])
    .sort((left, right) => {
      if (left.sortTime !== right.sortTime) return left.sortTime - right.sortTime;
      return left.id.localeCompare(right.id);
    });
}

Page({
  data: {
    conversationId: "",
    conversationTitle: "在线沟通",
    activeRole: "PARENT",
    roleLabel: "家长沟通",
    roleTone: "parent",
    loadedRole: "",
    accountId: "",
    messages: [],
    nextCursor: "",
    hasMore: false,
    loaded: false,
    loading: true,
    refreshing: false,
    loadingOlder: false,
    pagingReady: false,
    loadError: "",
    olderError: "",
    readSyncing: false,
    readSyncError: "",
    inputValue: "",
    sending: false,
    scrollIntoView: "",
    scrollAnimated: false
  },

  onLoad(options = {}) {
    const conversationId = String(options.id || "").trim();
    const conversationTitle = safeDecode(options.title).trim() || "在线沟通";
    const roleMeta = communicationRoleMeta(api.getActiveRole());
    this.setData({
      conversationId,
      conversationTitle,
      activeRole: roleMeta.role,
      roleLabel: roleMeta.label,
      roleTone: roleMeta.tone
    });
    wx.setNavigationBarTitle({ title: conversationTitle.slice(0, 12) });

    if (!conversationId) {
      this.setData({
        loading: false,
        loadError: "缺少会话编号，无法读取聊天记录"
      });
      return;
    }
    this.initialize();
  },

  onShow() {
    const roleMeta = communicationRoleMeta(api.getActiveRole());
    const roleChanged = Boolean(this.data.loadedRole && this.data.loadedRole !== roleMeta.role);
    this.setData({ activeRole: roleMeta.role, roleLabel: roleMeta.label, roleTone: roleMeta.tone });
    if (roleChanged && this.data.conversationId) {
      this._hasLoadedOnce = false;
      this._pendingMessage = null;
      this.setData({
        messages: [],
        nextCursor: "",
        hasMore: false,
        loaded: false,
        loadedRole: "",
        loadError: "",
        olderError: "",
        readSyncError: "",
        inputValue: ""
      });
      this.initialize();
      return;
    }
    if (!this._hasLoadedOnce || !this.data.conversationId) return;
    this.loadInitialMessages({ quiet: true, force: true });
    this.syncReadStatus();
  },

  onUnload() {
    if (this._pagingTimer) clearTimeout(this._pagingTimer);
    if (this._scrollTimer) clearTimeout(this._scrollTimer);
  },

  async initialize() {
    try {
      const app = getApp();
      const account = await app.ensureAuth();
      this.setData({ accountId: account.id || "" });
    } catch (error) {
      this.setData({
        loading: false,
        loadError: getErrorMessage(error, "登录状态校验失败，请重新进入会话")
      });
      return;
    }

    await Promise.all([
      this.loadInitialMessages({ quiet: false, force: true }),
      this.syncReadStatus()
    ]);
  },

  retryLoad() {
    this.loadInitialMessages({ quiet: false, force: true });
  },

  async loadInitialMessages(options = {}) {
    if (!this.data.conversationId) return false;
    if (this._initialLoadPending) return false;
    if ((this.data.loading || this.data.refreshing) && !options.force) return false;

    this._initialLoadPending = true;
    const keepVisible = Boolean(options.quiet && this.data.loaded);
    this.setData({
      loading: !keepVisible,
      refreshing: keepVisible,
      loadError: "",
      pagingReady: false
    });

    try {
      const response = await api.listConversationMessages(this.data.conversationId);
      const page = normalizePage(response);
      const messages = sortAndDedupe(
        page.items.map((item) => mapMessage(item, this.data.accountId)).filter((item) => item.id)
      );
      this._hasLoadedOnce = true;
      this.setData({
        messages,
        nextCursor: page.nextCursor,
        hasMore: Boolean(page.nextCursor),
        loaded: true,
        loadedRole: this.data.activeRole,
        loadError: "",
        olderError: "",
        scrollIntoView: ""
      }, () => {
        this.scrollToBottom(false);
        this.schedulePagingReady();
      });
      return true;
    } catch (error) {
      this.setData({
        loadError: getErrorMessage(error, "聊天记录加载失败，请稍后重试")
      });
      return false;
    } finally {
      this._initialLoadPending = false;
      this.setData({ loading: false, refreshing: false });
    }
  },

  schedulePagingReady() {
    if (this._pagingTimer) clearTimeout(this._pagingTimer);
    this._pagingTimer = setTimeout(() => {
      this.setData({ pagingReady: true });
    }, 350);
  },

  scrollToBottom(animated = true) {
    if (this._scrollTimer) clearTimeout(this._scrollTimer);
    const last = this.data.messages[this.data.messages.length - 1];
    if (!last) return;
    this._scrollTimer = setTimeout(() => {
      this.setData({ scrollIntoView: "" }, () => {
        this.setData({
          scrollIntoView: `message-${last.id}`,
          scrollAnimated: animated
        });
      });
    }, 30);
  },

  async loadOlder() {
    if (!this.data.pagingReady || !this.data.hasMore || !this.data.nextCursor || this.data.loadingOlder) return;
    const anchor = this.data.messages[0];
    this.setData({
      loadingOlder: true,
      olderError: "",
      pagingReady: false
    });

    try {
      const response = await api.listConversationMessages(this.data.conversationId, this.data.nextCursor);
      const page = normalizePage(response);
      const olderMessages = page.items
        .map((item) => mapMessage(item, this.data.accountId))
        .filter((item) => item.id);
      const messages = sortAndDedupe(olderMessages.concat(this.data.messages));
      this.setData({
        messages,
        nextCursor: page.nextCursor,
        hasMore: Boolean(page.nextCursor),
        olderError: "",
        scrollIntoView: ""
      }, () => {
        if (anchor) this.setData({ scrollIntoView: `message-${anchor.id}` });
        this.schedulePagingReady();
      });
    } catch (error) {
      const message = getErrorMessage(error, "更早的消息加载失败");
      this.setData({ olderError: message, pagingReady: true });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ loadingOlder: false });
    }
  },

  async syncReadStatus() {
    if (!this.data.conversationId || this.data.readSyncing) return false;
    this.setData({ readSyncing: true, readSyncError: "" });
    try {
      await api.markConversationRead(this.data.conversationId);
      this.setData({ readSyncError: "" });
      return true;
    } catch (error) {
      this.setData({
        readSyncError: getErrorMessage(error, "已读状态同步失败")
      });
      return false;
    } finally {
      this.setData({ readSyncing: false });
    }
  },

  retryReadSync() {
    this.syncReadStatus();
  },

  handleInput(event) {
    const inputValue = event.detail.value;
    const signature = `${this.data.conversationId}\n${String(inputValue || "").trim()}`;
    if (this._pendingMessage && this._pendingMessage.signature !== signature) this._pendingMessage = null;
    this.setData({ inputValue });
  },

  handleInputFocus() {
    this.scrollToBottom(false);
  },

  async sendMessage() {
    if (this._sendPending || this.data.sending) return;
    if (!this.data.loaded) {
      wx.showToast({ title: "请先加载会话", icon: "none" });
      return;
    }

    const content = String(this.data.inputValue || "").trim();
    if (!content) {
      wx.showToast({ title: "请输入消息内容", icon: "none" });
      return;
    }

    this._sendPending = true;
    this.setData({ sending: true });
    try {
      const signature = `${this.data.conversationId}\n${content}`;
      if (!this._pendingMessage || this._pendingMessage.signature !== signature) {
        this._pendingMessage = { signature, clientMessageId: api.createClientMessageId() };
      }
      const response = await api.sendConversationMessage(
        this.data.conversationId,
        content,
        this._pendingMessage.clientMessageId
      );
      this._pendingMessage = null;
      const payload = response && (response.message || response.data) ? (response.message || response.data) : response;
      const sentMessage = payload && payload.id
        ? mapMessage(payload, this.data.accountId, true)
        : null;

      this.setData({ inputValue: "" });
      if (sentMessage && sentMessage.id) {
        const messages = sortAndDedupe(this.data.messages.concat(sentMessage));
        this.setData({ messages, loadError: "" }, () => this.scrollToBottom(true));
      } else {
        const refreshed = await this.loadInitialMessages({ quiet: true, force: true });
        if (!refreshed) {
          wx.showToast({ title: "消息已发送，列表同步失败", icon: "none" });
          return;
        }
      }
    } catch (error) {
      wx.showToast({
        title: getErrorMessage(error, "发送失败，请重试"),
        icon: "none"
      });
    } finally {
      this._sendPending = false;
      this.setData({ sending: false });
    }
  }
});
