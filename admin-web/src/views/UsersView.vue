<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, getApiErrorMessage, isDialogCanceled } from "../api/client";

const loading = ref(false);
const items = ref<any[]>([]);
const total = ref(0);
const actionId = ref("");
const query = reactive({ keyword: "", page: 1, pageSize: 20 });

function isAdmin(item: any) {
  return Boolean(item.roles?.some((role: any) => role.roleCode === "ADMIN"));
}

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get("/users", { params: query });
    items.value = data.items; total.value = data.total;
  } catch (error) {
    ElMessage.error(getApiErrorMessage(error, "用户列表加载失败"));
  } finally { loading.value = false; }
}

async function toggle(item: any) {
  if (isAdmin(item)) {
    ElMessage.warning("管理员账号请通过安全配置流程变更");
    return;
  }
  const status = item.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  try {
    await ElMessageBox.confirm(`确认${status === "ACTIVE" ? "恢复" : "停用"}用户“${item.nickname}”吗？`, "账号状态", {
      confirmButtonText: status === "ACTIVE" ? "确认恢复" : "确认停用",
      cancelButtonText: "取消",
      type: status === "ACTIVE" ? "info" : "warning"
    });
    actionId.value = item.id;
    await api.patch(`/users/${item.id}/status`, { status, note: "管理员后台操作" });
    ElMessage.success("账号状态已更新");
    await load();
  } catch (error) {
    if (!isDialogCanceled(error)) ElMessage.error(getApiErrorMessage(error));
  } finally {
    actionId.value = "";
  }
}

function search() { query.page = 1; load(); }

onMounted(load);
</script>

<template>
  <section class="content-card table-card">
    <div class="card-head"><div><h3>平台用户</h3><p>管理家长、老师及账号状态；停用会立即撤销登录会话</p></div><div class="table-actions"><el-input v-model="query.keyword" placeholder="搜索昵称或账号" clearable @clear="search" @keyup.enter="search" /><el-button type="primary" :loading="loading" @click="search">查询</el-button></div></div>
    <el-table :data="items" v-loading="loading">
      <el-table-column label="用户" min-width="190"><template #default="{ row }"><div class="user-cell"><span>{{ row.nickname?.slice(0, 1) }}</span><div><strong>{{ row.nickname }}</strong><small>{{ row.username || row.id.slice(0, 8) }}</small></div></div></template></el-table-column>
      <el-table-column label="角色" min-width="150"><template #default="{ row }"><el-tag v-for="role in row.roles" :key="role.roleCode" effect="plain">{{ role.roleCode }}</el-tag></template></el-table-column>
      <el-table-column label="登录方式" width="110"><template #default="{ row }"><el-tag :type="row.loginProvider === 'WECHAT' ? 'success' : 'info'" effect="plain">{{ row.loginProvider === 'WECHAT' ? '微信' : '后台' }}</el-tag></template></el-table-column>
      <el-table-column prop="teacherProfile.auditStatus" label="教师认证" width="120" />
      <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="row.status === 'ACTIVE' ? 'success' : 'danger'">{{ row.status }}</el-tag></template></el-table-column>
      <el-table-column label="最近登录" width="180"><template #default="{ row }">{{ row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : '尚未登录' }}</template></el-table-column>
      <el-table-column label="登录次数" width="90"><template #default="{ row }">{{ row.loginCount || 0 }}</template></el-table-column>
      <el-table-column label="操作" width="120" fixed="right"><template #default="{ row }"><el-button link :type="row.status === 'ACTIVE' ? 'danger' : 'primary'" :loading="actionId === row.id" :disabled="Boolean(actionId) || isAdmin(row)" @click="toggle(row)">{{ isAdmin(row) ? "受保护" : row.status === "ACTIVE" ? "停用" : "恢复" }}</el-button></template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" layout="total, prev, pager, next" @change="load" />
  </section>
</template>
