import axios from "axios";

export const api = axios.create({
  baseURL: "/admin-api/v1",
  timeout: 15000
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("tutor_admin_access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !String(error.config?.url).includes("/auth/login")) {
      localStorage.removeItem("tutor_admin_access_token");
      localStorage.removeItem("tutor_admin_refresh_token");
      window.location.assign("/login");
    }
    return Promise.reject(error);
  }
);
