<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../api/client";

const loading = ref(false);
const items = ref<any[]>([]);
const total = ref(0);
const query = reactive({ keyword: "", page: 1, pageSize: 20 });

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get("/users", { params: query });
    items.value = data.items; total.value = data.total;
  } finally { loading.value = false; }
}

async function toggle(item: any) {
  const status = item.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  await ElMessageBox.confirm(`确认${status === "ACTIVE" ? "恢复" : "停用"}用户“${item.nickname}”吗？`, "账号状态");
  await api.patch(`/users/${item.id}/status`, { status, note: "管理员后台操作" });
  ElMessage.success("账号状态已更新"); await load();
}

onMounted(load);
</script>

<template>
  <section class="content-card table-card">
    <div class="card-head"><div><h3>平台用户</h3><p>管理家长、老师及账号状态</p></div><div class="table-actions"><el-input v-model="query.keyword" placeholder="搜索昵称或账号" clearable @keyup.enter="load" /><el-button type="primary" @click="load">查询</el-button></div></div>
    <el-table :data="items" v-loading="loading">
      <el-table-column label="用户" min-width="190"><template #default="{ row }"><div class="user-cell"><span>{{ row.nickname?.slice(0, 1) }}</span><div><strong>{{ row.nickname }}</strong><small>{{ row.username || row.id.slice(0, 8) }}</small></div></div></template></el-table-column>
      <el-table-column label="角色" min-width="150"><template #default="{ row }"><el-tag v-for="role in row.roles" :key="role.roleCode" effect="plain">{{ role.roleCode }}</el-tag></template></el-table-column>
      <el-table-column prop="teacherProfile.auditStatus" label="教师认证" width="120" />
      <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="row.status === 'ACTIVE' ? 'success' : 'danger'">{{ row.status }}</el-tag></template></el-table-column>
      <el-table-column label="注册时间" width="180"><template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template></el-table-column>
      <el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><el-button link :type="row.status === 'ACTIVE' ? 'danger' : 'primary'" @click="toggle(row)">{{ row.status === "ACTIVE" ? "停用" : "恢复" }}</el-button></template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" layout="total, prev, pager, next" @change="load" />
  </section>
</template>
