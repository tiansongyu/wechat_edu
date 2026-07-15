<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, getApiErrorMessage } from "../api/client";

const loading = ref(true);
const metrics = ref<Record<string, number>>({});
const distribution = ref<Array<{ status: string; count: number }>>([]);
const cards = [
  ["users", "平台用户", "◎", "blue"],
  ["approvedTeachers", "认证教师", "✓", "green"],
  ["publishedJobs", "公开需求", "▤", "purple"],
  ["pendingApplications", "待处理报名", "⌁", "orange"]
];

onMounted(async () => {
  try {
    const { data } = await api.get("/dashboard");
    metrics.value = data.metrics;
    distribution.value = data.jobStatusDistribution;
  } catch (error) {
    ElMessage.error(getApiErrorMessage(error, "看板数据加载失败"));
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-loading="loading">
    <div class="metric-grid">
      <article v-for="card in cards" :key="card[0]" class="metric-card">
        <span :class="['metric-icon', `metric-icon--${card[3]}`]">{{ card[2] }}</span>
        <div><p>{{ card[1] }}</p><strong>{{ metrics[card[0]] ?? 0 }}</strong></div>
      </article>
    </div>
    <div class="dashboard-grid">
      <section class="content-card">
        <div class="card-head"><div><h3>待办事项</h3><p>需要运营团队及时处理</p></div></div>
        <div class="todo-list">
          <router-link to="/teacher-audits"><span class="todo-dot todo-dot--blue"></span><div><strong>教师认证审核</strong><small>核验身份、学校与资质材料</small></div><b>{{ metrics.pendingTeachers || 0 }}</b></router-link>
          <router-link to="/job-audits"><span class="todo-dot todo-dot--orange"></span><div><strong>家教发布审核</strong><small>检查内容、价格与联系方式</small></div><b>{{ metrics.pendingJobs || 0 }}</b></router-link>
        </div>
      </section>
      <section class="content-card">
        <div class="card-head"><div><h3>需求状态分布</h3><p>平台当前全部家教信息</p></div></div>
        <div class="status-bars">
          <div v-for="item in distribution" :key="item.status"><span>{{ item.status }}</span><div><i :style="{ width: `${Math.max(8, item.count * 12)}%` }"></i></div><b>{{ item.count }}</b></div>
          <el-empty v-if="!distribution.length" description="暂无数据" :image-size="72" />
        </div>
      </section>
    </div>
  </div>
</template>
