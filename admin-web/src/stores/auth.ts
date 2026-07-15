import { defineStore } from "pinia";
import { api, clearAdminSession } from "../api/client";

function readStoredAccount() {
  try {
    return JSON.parse(localStorage.getItem("tutor_admin_account") || "null");
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    accessToken: localStorage.getItem("tutor_admin_access_token") || "",
    account: readStoredAccount() as null | { nickname: string; username?: string }
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
      localStorage.setItem("tutor_admin_account", JSON.stringify(data.account));
    },
    logout() {
      this.accessToken = "";
      this.account = null;
      clearAdminSession();
      localStorage.removeItem("tutor_admin_account");
    }
  }
});
