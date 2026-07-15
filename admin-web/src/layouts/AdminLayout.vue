<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { useAuthStore } from "../stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const mobileMenuOpen = ref(false);
const title = computed(() => route.meta.title || "管理后台");
const menu = [
  ["/dashboard", "数据看板", "▦"],
  ["/users", "用户管理", "◎"],
  ["/teacher-audits", "教师认证", "✓"],
  ["/job-audits", "发布审核", "▤"],
  ["/operations", "业务履约", "⇄"],
  ["/review-governance", "评价治理", "☆"],
  ["/audit-logs", "操作审计", "⌁"]
];

async function logout() {
  try {
    await ElMessageBox.confirm("确认退出管理后台吗？", "退出登录", { confirmButtonText: "退出", cancelButtonText: "取消" });
  } catch {
    return;
  }
  auth.logout();
  await router.replace("/login");
}
</script>

<template>
  <div class="admin-shell">
    <aside :class="['sidebar', { 'sidebar--open': mobileMenuOpen }]">
      <div class="brand"><span class="brand-mark">家</span><div><strong>家教直聘</strong><small>TUTOR LINK</small></div></div>
      <nav>
        <router-link v-for="item in menu" :key="item[0]" :to="item[0]" class="nav-item" @click="mobileMenuOpen = false">
          <span>{{ item[2] }}</span>{{ item[1] }}
        </router-link>
      </nav>
      <div class="sidebar-foot">安全运营中心<br /><small>Docker production</small></div>
    </aside>
    <main class="main-panel">
      <header class="topbar">
        <button class="mobile-menu-button" aria-label="打开菜单" @click="mobileMenuOpen = !mobileMenuOpen">☰</button>
        <div class="topbar-title"><p>运营管理后台</p><h1>{{ title }}</h1></div>
        <div class="admin-profile"><span class="status-dot"></span><span>{{ auth.account?.nickname || '系统管理员' }}</span><button @click="logout">退出</button></div>
      </header>
      <section class="page-content"><router-view /></section>
    </main>
  </div>
</template>
