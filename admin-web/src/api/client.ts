import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const ACCESS_TOKEN_KEY = "tutor_admin_access_token";
const REFRESH_TOKEN_KEY = "tutor_admin_refresh_token";

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let refreshPromise: Promise<string> | null = null;

export function clearAdminSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function getApiErrorMessage(error: unknown, fallback = "操作失败，请稍后重试") {
  if (axios.isCancel(error)) return "";
  const payload = (error as AxiosError<any>)?.response?.data;
  const message = payload?.message;
  if (Array.isArray(message)) return message.join("；");
  if (typeof message === "string" && message.trim()) return message;
  if (error instanceof Error && error.message && error.message !== "canceled") return error.message;
  return fallback;
}

export function isDialogCanceled(error: unknown) {
  return error === "cancel" || error === "close" || (error instanceof Error && ["cancel", "close"].includes(error.message));
}

export const api = axios.create({
  baseURL: "/admin-api/v1",
  timeout: 15000
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) throw new Error("登录已过期");

  refreshPromise = axios.post("/admin-api/v1/auth/refresh", {
    refreshToken,
    activeRole: "ADMIN"
  }, { timeout: 15000 }).then(({ data }) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    return data.accessToken as string;
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    const url = String(config?.url || "");
    const isAuthRequest = url.includes("/auth/login") || url.includes("/auth/refresh");

    if (error.response?.status === 401 && config && !config._retry && !isAuthRequest) {
      config._retry = true;
      try {
        const accessToken = await refreshAccessToken();
        config.headers.Authorization = `Bearer ${accessToken}`;
        return api(config);
      } catch (refreshError) {
        const refreshStatus = (refreshError as AxiosError)?.response?.status;
        const credentialsRejected = !localStorage.getItem(REFRESH_TOKEN_KEY)
          || (Boolean(refreshStatus) && refreshStatus! >= 400 && refreshStatus! < 500);
        if (credentialsRejected) {
          clearAdminSession();
          if (window.location.pathname !== "/login") window.location.assign("/login?expired=1");
        }
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);
