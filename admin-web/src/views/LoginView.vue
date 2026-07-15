<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "../stores/auth";
import { getApiErrorMessage } from "../api/client";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const loading = ref(false);
const form = reactive({ username: "", password: "" });
if (route.query.expired) ElMessage.warning("登录已过期，请重新登录");

async function submit() {
  if (!form.username.trim() || !form.password) {
    ElMessage.warning("请输入管理员账号和密码");
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.username, form.password);
    await router.replace("/dashboard");
  } catch (error: unknown) {
    ElMessage.error(getApiErrorMessage(error, "登录失败，请检查账号密码"));
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
          <el-form-item label="管理员账号"><el-input v-model="form.username" size="large" autocomplete="username" placeholder="请输入管理员账号" /></el-form-item>
          <el-form-item label="密码"><el-input v-model="form.password" type="password" size="large" autocomplete="current-password" placeholder="请输入密码" show-password @keyup.enter="submit" /></el-form-item>
          <el-button type="primary" size="large" :loading="loading" class="login-button" @click="submit">进入管理后台</el-button>
        </el-form>
        <small class="login-tip">账号由部署环境安全配置；请勿在共享设备保存密码</small>
      </div>
    </div>
  </div>
</template>
