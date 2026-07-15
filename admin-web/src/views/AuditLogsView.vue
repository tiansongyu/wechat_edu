<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api } from "../api/client";
const loading = ref(false); const items = ref<any[]>([]); const total = ref(0); const query = reactive({ page: 1, pageSize: 20 });
async function load() { loading.value = true; try { const { data } = await api.get("/audit-logs", { params: query }); items.value = data.items; total.value = data.total; } finally { loading.value = false; } }
onMounted(load);
</script>

<template>
  <section class="content-card table-card">
    <div class="card-head"><div><h3>操作审计日志</h3><p>管理员关键操作永久留痕</p></div><el-button @click="load">刷新</el-button></div>
    <el-table :data="items" v-loading="loading">
      <el-table-column label="操作时间" width="180"><template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template></el-table-column>
      <el-table-column label="管理员" width="130"><template #default="{ row }">{{ row.actor?.nickname || row.actor?.username || "系统" }}</template></el-table-column>
      <el-table-column prop="action" label="动作" min-width="170" />
      <el-table-column prop="targetType" label="对象类型" width="140" />
      <el-table-column prop="targetId" label="对象 ID" min-width="220" />
      <el-table-column label="结果" min-width="220"><template #default="{ row }"><code>{{ JSON.stringify(row.after) }}</code></template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="query.page" :page-size="query.pageSize" :total="total" layout="total, prev, pager, next" @change="load" />
  </section>
</template>
