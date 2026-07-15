import { createRouter, createWebHistory } from "vue-router";

const AdminLayout = () => import("../layouts/AdminLayout.vue");
const LoginView = () => import("../views/LoginView.vue");
const DashboardView = () => import("../views/DashboardView.vue");
const UsersView = () => import("../views/UsersView.vue");
const TeacherAuditsView = () => import("../views/TeacherAuditsView.vue");
const JobAuditsView = () => import("../views/JobAuditsView.vue");
const AuditLogsView = () => import("../views/AuditLogsView.vue");

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: LoginView, meta: { public: true } },
    {
      path: "/",
      component: AdminLayout,
      redirect: "/dashboard",
      children: [
        { path: "dashboard", component: DashboardView, meta: { title: "数据看板" } },
        { path: "users", component: UsersView, meta: { title: "用户管理" } },
        { path: "teacher-audits", component: TeacherAuditsView, meta: { title: "教师认证" } },
        { path: "job-audits", component: JobAuditsView, meta: { title: "发布审核" } },
        { path: "audit-logs", component: AuditLogsView, meta: { title: "操作审计" } }
      ]
    }
  ]
});

router.beforeEach((to) => {
  const token = localStorage.getItem("tutor_admin_access_token");
  if (!to.meta.public && !token) return "/login";
  if (to.path === "/login" && token) return "/dashboard";
});

export default router;
