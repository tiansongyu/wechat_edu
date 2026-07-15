<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const form = reactive({ username: "admin", password: "Admin123456!" });

async function submit() {
  loading.value = true;
  try {
    await auth.login(form.username, form.password);
    await router.replace("/dashboard");
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "登录失败，请检查账号密码");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-visual">
      <div class="visual-badge">TUTOR LINK · 运营平台</div>
      <h1>让每一次教学匹配<br />更真实、更高效</h1>
      <p>统一管理教师认证、家教需求、报名处理与平台安全。</p>
      <div class="visual-stats"><span><strong>双角色</strong>微信小程序</span><span><strong>全链路</strong>审核留痕</span><span><strong>高并发</strong>事务保护</span></div>
    </div>
    <div class="login-panel">
      <div class="login-card">
        <div class="brand login-brand"><span class="brand-mark">家</span><div><strong>家教直聘</strong><small>ADMIN CONSOLE</small></div></div>
        <h2>欢迎回来</h2><p>请使用管理员账号继续</p>
        <el-form label-position="top" @submit.prevent="submit">
          <el-form-item label="管理员账号"><el-input v-model="form.username" size="large" /></el-form-item>
          <el-form-item label="密码"><el-input v-model="form.password" type="password" size="large" show-password @keyup.enter="submit" /></el-form-item>
          <el-button type="primary" size="large" :loading="loading" class="login-button" @click="submit">进入管理后台</el-button>
        </el-form>
        <small class="login-tip">首次启动可使用 .env 中配置的 ADMIN_USERNAME / ADMIN_PASSWORD</small>
      </div>
    </div>
  </div>
</template>
