<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, getApiErrorMessage } from "../api/client";

type EntityType = "applications" | "appointments";

const activeTab = ref<EntityType>("applications");
const loading = ref(false);
const actionId = ref("");
const items = ref<any[]>([]);
const total = ref(0);
const query = reactive({ status: "", page: 1, pageSize: 20 });
const dialog = reactive({ visible: false, item: null as any, status: "", note: "" });

const applicationStatuses = ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"];
const appointmentStatuses = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "DISPUTED"];
const statuses = computed(() => activeTab.value === "applications" ? applicationStatuses : appointmentStatuses);
const statusLabel: Record<string, string> = {
  PENDING: "待处理", ACCEPTED: "已录用", REJECTED: "已拒绝", CANCELLED: "已取消",
  CONFIRMED: "已确认", COMPLETED: "已完成", DISPUTED: "争议中"
};
const statusType: Record<string, string> = {
  PENDING: "warning", ACCEPTED: "success", CONFIRMED: "success", COMPLETED: "success",
  REJECTED: "danger", CANCELLED: "info", DISPUTED: "danger"
};

function actionLabel(item: any, nextStatus: string) {
  if (activeTab.value === "applications") {
    if (nextStatus === "ACCEPTED") return "录用老师";
    if (nextStatus === "REJECTED") return "拒绝报名";
    if (nextStatus === "CANCELLED") return item.status === "ACCEPTED" ? "撤销录用" : "取消报名";
  }
  if (nextStatus === "CONFIRMED") return "确认预约";
  if (nextStatus === "COMPLETED") return item.status === "DISPUTED" ? "完成争议处理" : "标记完成";
  if (nextStatus === "CANCELLED") return "取消预约";
  if (nextStatus === "DISPUTED") return "发起争议";
  return statusLabel[nextStatus] || "变更状态";
}

function availableActions(item: any) {
  if (activeTab.value === "applications") {
    if (item.status === "PENDING") return ["ACCEPTED", "REJECTED", "CANCELLED"];
    if (item.status === "ACCEPTED") return item.appointment?.status === "COMPLETED" ? [] : ["CANCELLED"];
    return [];
  }
  if (item.status === "PENDING") return ["CONFIRMED", "CANCELLED", "DISPUTED"];
  if (item.status === "CONFIRMED") return ["COMPLETED", "CANCELLED", "DISPUTED"];
  if (item.status === "COMPLETED") return ["DISPUTED"];
  if (item.status === "DISPUTED") return ["COMPLETED", "CANCELLED"];
  return [];
}

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get(`/${activeTab.value}`, { params: { ...query, status: query.status || undefined } });
    items.value = data.items;
    total.value = data.total;
  } catch (error) {
    items.value = [];
    ElMessage.error(getApiErrorMessage(error, "业务数据加载失败"));
  } finally {
    loading.value = false;
  }
}

function switchTab(tab: EntityType) {
  activeTab.value = tab;
  query.status = "";
  query.page = 1;
  load();
}

function openAction(item: any, status: string) {
  dialog.item = item;
  dialog.status = status;
  dialog.note = "";
  dialog.visible = true;
}

async function submitAction() {
  if (!dialog.item || actionId.value) return;
  const reasonRequired = ["REJECTED", "CANCELLED", "DISPUTED"].includes(dialog.status);
  if (reasonRequired && !dialog.note.trim()) {
    ElMessage.warning("此操作必须填写原因");
    return;
  }
  actionId.value = dialog.item.id;
  try {
    await api.patch(`/${activeTab.value}/${dialog.item.id}/status`, {
      status: dialog.status,
      note: dialog.note.trim(),
      version: dialog.item.version
    });
    ElMessage.success(`状态已更新为“${statusLabel[dialog.status]}”`);
    dialog.visible = false;
    await load();
  } catch (error) {
    ElMessage.error(getApiErrorMessage(error));
  } finally {
    actionId.value = "";
  }
}

onMounted(load);
</script>

<template>
  <section class="content-card table-card">
    <div class="card-head operations-head">
      <div><h3>业务履约管理</h3><p>查看报名与预约的数据库状态，异常操作将写入审计日志</p></div>
      <div class="table-actions compact-actions">
        <el-select v-model="query.status" placeholder="全部状态" clearable @change="query.page = 1; load()">
          <el-option v-for="status in statuses" :key="status" :label="statusLabel[status]" :value="status" />
        </el-select>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>
    <div class="section-tabs">
      <button :class="{ active: activeTab === 'applications' }" @click="switchTab('applications')">报名申请</button>
      <button :class="{ active: activeTab === 'appointments' }" @click="switchTab('appointments')">合作预约</button>
    </div>

    <el-table :data="items" v-loading="loading" row-key="id">
      <template v-if="activeTab === 'applications'">
        <el-table-column label="需求" min-width="240"><template #default="{ row }"><div class="title-cell"><strong>{{ row.job?.title || '需求已不可见' }}</strong><small>{{ row.job?.district }} · {{ row.job?.subject }}</small></div></template></el-table-column>
        <el-table-column label="报名老师" min-width="150"><template #default="{ row }">{{ row.teacher?.nickname || row.teacherId }}</template></el-table-column>
        <el-table-column label="申请说明" min-width="220"><template #default="{ row }">{{ row.coverLetter || '未填写' }}</template></el-table-column>
      </template>
      <template v-else>
        <el-table-column label="需求" min-width="240"><template #default="{ row }"><div class="title-cell"><strong>{{ row.job?.title || row.application?.job?.title || '需求已不可见' }}</strong><small>{{ row.job?.district || row.application?.job?.district }} · {{ row.job?.subject || row.application?.job?.subject }}</small></div></template></el-table-column>
        <el-table-column label="合作老师" min-width="150"><template #default="{ row }">{{ row.application?.teacher?.nickname || row.application?.teacherId }}</template></el-table-column>
        <el-table-column label="预约说明" min-width="220"><template #default="{ row }">{{ row.note || '未填写' }}</template></el-table-column>
      </template>
      <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType[row.status] as any">{{ statusLabel[row.status] || row.status }}</el-tag></template></el-table-column>
      <el-table-column label="更新时间" width="180"><template #default="{ row }">{{ new Date(row.updatedAt).toLocaleString() }}</template></el-table-column>
      <el-table-column label="操作" min-width="260" fixed="right"><template #default="{ row }"><template v-if="availableActions(row).length"><el-button v-for="status in availableActions(row)" :key="status" link :type="['REJECTED', 'CANCELLED', 'DISPUTED'].includes(status) ? 'danger' : 'primary'" :loading="actionId === row.id" :disabled="Boolean(actionId)" @click="openAction(row, status)">{{ actionLabel(row, status) }}</el-button></template><span v-else class="muted">已终态</span></template></el-table-column>
    </el-table>
    <el-empty v-if="!loading && !items.length" :description="activeTab === 'applications' ? '暂无报名记录' : '暂无合作预约'" />
    <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
  </section>

  <el-dialog v-model="dialog.visible" :title="dialog.item ? `确认${actionLabel(dialog.item, dialog.status)}` : '确认变更状态'" width="min(520px, 92vw)" destroy-on-close>
    <div class="decision-summary" v-if="dialog.item"><strong>{{ dialog.item.job?.title || dialog.item.application?.job?.title || '业务记录' }}</strong><span>当前状态：{{ statusLabel[dialog.item.status] || dialog.item.status }} → {{ statusLabel[dialog.status] }}</span></div>
    <el-form label-position="top"><el-form-item :label="['REJECTED', 'CANCELLED', 'DISPUTED'].includes(dialog.status) ? '操作原因（必填）' : '操作说明'"><el-input v-model="dialog.note" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="请记录本次状态变更的依据" /></el-form-item></el-form>
    <template #footer><el-button :disabled="Boolean(actionId)" @click="dialog.visible = false">返回</el-button><el-button :type="['REJECTED', 'CANCELLED', 'DISPUTED'].includes(dialog.status) ? 'danger' : 'primary'" :loading="Boolean(actionId)" @click="submitAction">确认提交</el-button></template>
  </el-dialog>
</template>
