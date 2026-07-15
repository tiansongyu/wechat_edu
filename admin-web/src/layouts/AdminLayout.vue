<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const title = computed(() => route.meta.title || "管理后台");
const menu = [
  ["/dashboard", "数据看板", "▦"],
  ["/users", "用户管理", "◎"],
  ["/teacher-audits", "教师认证", "✓"],
  ["/job-audits", "发布审核", "▤"],
  ["/audit-logs", "操作审计", "⌁"]
];

function logout() {
  auth.logout();
  router.replace("/login");
}
</script>

<template>
  <div class="admin-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">家</span><div><strong>家教直聘</strong><small>TUTOR LINK</small></div></div>
      <nav>
        <router-link v-for="item in menu" :key="item[0]" :to="item[0]" class="nav-item">
          <span>{{ item[2] }}</span>{{ item[1] }}
        </router-link>
      </nav>
      <div class="sidebar-foot">安全运营中心<br /><small>Docker production</small></div>
    </aside>
    <main class="main-panel">
      <header class="topbar">
        <div><p>运营管理后台</p><h1>{{ title }}</h1></div>
        <div class="admin-profile"><span class="status-dot"></span><span>系统管理员</span><button @click="logout">退出</button></div>
      </header>
      <section class="page-content"><router-view /></section>
    </main>
  </div>
</template>
