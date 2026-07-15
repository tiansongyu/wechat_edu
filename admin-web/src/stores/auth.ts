import { defineStore } from "pinia";
import { api } from "../api/client";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    accessToken: localStorage.getItem("tutor_admin_access_token") || "",
    account: null as null | { nickname: string; username?: string }
  }),
  getters: {
    loggedIn: (state) => Boolean(state.accessToken)
  },
  actions: {
    async login(username: string, password: string) {
      const { data } = await api.post("/auth/login", { username, password });
      this.accessToken = data.accessToken;
      this.account = data.account;
      localStorage.setItem("tutor_admin_access_token", data.accessToken);
      localStorage.setItem("tutor_admin_refresh_token", data.refreshToken);
    },
    logout() {
      this.accessToken = "";
      this.account = null;
      localStorage.removeItem("tutor_admin_access_token");
      localStorage.removeItem("tutor_admin_refresh_token");
    }
  }
});
