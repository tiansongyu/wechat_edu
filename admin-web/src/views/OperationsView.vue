<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, getApiErrorMessage } from "../api/client";

type EntityType = "applications" | "appointments";

const activeTab = ref<EntityType>("applications");
const loading = ref(false);
const loaded = ref(false);
const loadError = ref("");
const requestSequence = ref(0);
const actionId = ref("");
const items = ref<any[]>([]);
const total = ref(0);
const query = reactive({ status: "", page: 1, pageSize: 20 });
const dialog = reactive({ visible: false, item: null as any, status: "", note: "" });

const applicationStatuses = ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"];
const appointmentStatuses = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "DISPUTED"];
const statuses = computed(() => activeTab.value === "applications" ? applicationStatuses : appointmentStatuses);
const hasFilters = computed(() => Boolean(query.status));
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
  if (nextStatus === "COMPLETED") return "恢复为已完成";
  if (nextStatus === "CANCELLED") return "取消预约";
  if (nextStatus === "DISPUTED") return "转入争议处理";
  return statusLabel[nextStatus] || "变更状态";
}

function hasCompleteAcknowledgements(item: any) {
  return Boolean(item.parentCompletedAt && item.teacherCompletedAt && item.completedAt);
}

function availableActions(item: any) {
  if (activeTab.value === "applications") {
    if (item.status === "PENDING") return ["ACCEPTED", "REJECTED", "CANCELLED"];
    if (item.status === "ACCEPTED") return item.appointment?.status === "COMPLETED" ? [] : ["CANCELLED"];
    return [];
  }

  // 管理员只做异常治理，正常确认和双方履约完成仍由业务参与人操作。
  if (["PENDING", "CONFIRMED"].includes(item.status)) return ["CANCELLED", "DISPUTED"];
  if (item.status === "COMPLETED") return ["DISPUTED"];
  if (item.status === "DISPUTED") return hasCompleteAcknowledgements(item) ? ["COMPLETED"] : ["CANCELLED"];
  return [];
}

function actionGuidance(item: any, nextStatus: string) {
  if (activeTab.value === "applications") {
    if (nextStatus === "ACCEPTED") return "录用会占用需求名额并创建预约，请记录人工介入依据。";
    if (nextStatus === "REJECTED") return "拒绝为终态，请写明审核或业务依据。";
    if (nextStatus === "CANCELLED" && item.status === "ACCEPTED") return "撤销录用会同步取消未完成预约，请确认已协调双方。";
    return "取消为终态，请写明用户申请或平台治理依据。";
  }
  if (nextStatus === "DISPUTED") return "仅在存在履约分歧或异常时转入争议处理，正常确认与完成应由双方自行操作。";
  if (nextStatus === "COMPLETED") return "系统已核验家长、老师双方完成时间及最终完成时间，本操作仅恢复被争议打断的已完成状态。";
  return item.status === "DISPUTED"
    ? "当前缺少完整的双方完成凭据，不能恢复完成；取消后预约将终止。"
    : "管理员取消仅用于异常治理，请确认已核实双方诉求。";
}

function formatDate(value?: string | null) {
  if (!value) return "未确认";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未确认" : date.toLocaleString("zh-CN", { hour12: false });
}

function isConflict(error: unknown) {
  return (error as any)?.response?.status === 409;
}

async function load() {
  const sequence = ++requestSequence.value;
  loading.value = true;
  loadError.value = "";
  try {
    const { data } = await api.get(`/${activeTab.value}`, {
      params: { ...query, status: query.status || undefined }
    });
    if (sequence !== requestSequence.value) return;
    if (!data || !Array.isArray(data.items) || typeof data.total !== "number") {
      throw new Error("服务器返回的数据格式不正确");
    }
    items.value = data.items;
    total.value = data.total;
    loaded.value = true;
  } catch (error) {
    if (sequence !== requestSequence.value) return;
    loadError.value = getApiErrorMessage(error, "业务数据加载失败，请稍后重试");
  } finally {
    if (sequence === requestSequence.value) loading.value = false;
  }
}

function switchTab(tab: EntityType) {
  if (tab === activeTab.value) return;
  activeTab.value = tab;
  query.status = "";
  query.page = 1;
  items.value = [];
  total.value = 0;
  loaded.value = false;
  loadError.value = "";
  load();
}

function applyStatusFilter() {
  query.page = 1;
  load();
}

function clearStatusFilter() {
  query.status = "";
  query.page = 1;
  load();
}

function changePageSize(size: number) {
  query.pageSize = size;
  query.page = 1;
  load();
}

function openAction(item: any, status: string) {
  if (loadError.value) {
    ElMessage.warning("请先重新加载最新业务状态");
    return;
  }
  dialog.item = item;
  dialog.status = status;
  dialog.note = "";
  dialog.visible = true;
}

async function submitAction() {
  if (!dialog.item || actionId.value) return;
  if (loadError.value) {
    ElMessage.warning("请先重新加载最新业务状态");
    return;
  }
  const reason = dialog.note.trim();
  if (!reason) {
    ElMessage.warning("所有状态变更都必须填写原因");
    return;
  }
  actionId.value = dialog.item.id;
  try {
    await api.patch(`/${activeTab.value}/${dialog.item.id}/status`, {
      status: dialog.status,
      note: reason,
      version: dialog.item.version
    });
    ElMessage.success(`状态已更新为“${statusLabel[dialog.status]}”`);
    dialog.visible = false;
    await load();
  } catch (error) {
    if (isConflict(error)) {
      ElMessage.warning("记录已被其他管理员或用户更新，已刷新最新状态");
      dialog.visible = false;
      await load();
    } else {
      ElMessage.error(getApiErrorMessage(error));
    }
  } finally {
    actionId.value = "";
  }
}

onMounted(load);
</script>

<template>
  <section class="content-card table-card">
    <div class="card-head operations-head">
      <div><h3>业务履约管理</h3><p>正常预约确认与完成由参与双方操作；管理员仅处理异常并完整留痕</p></div>
      <div class="table-actions compact-actions">
        <el-select v-model="query.status" placeholder="全部状态" clearable @change="applyStatusFilter">
          <el-option v-for="status in statuses" :key="status" :label="statusLabel[status]" :value="status" />
        </el-select>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>
    <div class="section-tabs">
      <button :class="{ active: activeTab === 'applications' }" @click="switchTab('applications')">报名申请</button>
      <button :class="{ active: activeTab === 'appointments' }" @click="switchTab('appointments')">合作预约</button>
    </div>

    <el-alert v-if="loadError" class="operations-load-error" type="error" :title="loadError" :closable="false" show-icon>
      <template #default>
        <span>{{ items.length ? "已保留上次成功加载的数据，请刷新后再执行状态操作。" : "当前无法读取业务数据。" }}</span>
        <el-button link type="primary" :loading="loading" @click="load">重新加载</el-button>
      </template>
    </el-alert>

    <el-alert v-if="activeTab === 'appointments'" class="operations-policy" type="info" :closable="false" show-icon title="安全治理边界">
      管理员不能代替用户确认预约或直接标记完成；争议预约只有在三项完成凭据齐全时才能恢复为已完成。
    </el-alert>

    <el-table :data="items" v-loading="loading" row-key="id" empty-text=" ">
      <template v-if="activeTab === 'applications'">
        <el-table-column label="需求" min-width="240"><template #default="{ row }"><div class="title-cell"><strong>{{ row.job?.title || '需求已不可见' }}</strong><small>{{ row.job?.district }} · {{ row.job?.subject }}</small></div></template></el-table-column>
        <el-table-column label="报名老师" min-width="150"><template #default="{ row }">{{ row.teacher?.nickname || row.teacherId }}</template></el-table-column>
        <el-table-column label="申请说明" min-width="220"><template #default="{ row }">{{ row.coverLetter || '未填写' }}</template></el-table-column>
      </template>
      <template v-else>
        <el-table-column label="需求" min-width="240"><template #default="{ row }"><div class="title-cell"><strong>{{ row.job?.title || row.application?.job?.title || '需求已不可见' }}</strong><small>{{ row.job?.district || row.application?.job?.district }} · {{ row.job?.subject || row.application?.job?.subject }}</small></div></template></el-table-column>
        <el-table-column label="合作老师" min-width="150"><template #default="{ row }">{{ row.application?.teacher?.nickname || row.application?.teacherId }}</template></el-table-column>
        <el-table-column label="双方完成凭据" min-width="250">
          <template #default="{ row }">
            <div class="completion-proof">
              <span :class="{ complete: row.parentCompletedAt }">家长：{{ formatDate(row.parentCompletedAt) }}</span>
              <span :class="{ complete: row.teacherCompletedAt }">老师：{{ formatDate(row.teacherCompletedAt) }}</span>
              <span :class="{ complete: row.completedAt }">最终：{{ formatDate(row.completedAt) }}</span>
            </div>
          </template>
        </el-table-column>
      </template>
      <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType[row.status] as any">{{ statusLabel[row.status] || row.status }}</el-tag></template></el-table-column>
      <el-table-column label="最近说明" min-width="190"><template #default="{ row }"><span class="status-note">{{ row.statusNote || '暂无状态说明' }}</span></template></el-table-column>
      <el-table-column label="更新时间" width="180"><template #default="{ row }">{{ formatDate(row.updatedAt) }}</template></el-table-column>
      <el-table-column label="安全操作" min-width="260" fixed="right">
        <template #default="{ row }">
          <template v-if="availableActions(row).length">
            <el-button
              v-for="status in availableActions(row)"
              :key="status"
              link
              :type="['REJECTED', 'CANCELLED', 'DISPUTED'].includes(status) ? 'danger' : 'primary'"
              :loading="actionId === row.id"
              :disabled="Boolean(loadError) || Boolean(actionId)"
              @click="openAction(row, status)"
            >{{ actionLabel(row, status) }}</el-button>
          </template>
          <span v-else class="muted">无可用治理动作</span>
        </template>
      </el-table-column>
    </el-table>

    <el-empty
      v-if="loaded && !loading && !loadError && !items.length"
      :description="hasFilters ? '没有符合当前状态筛选的记录' : activeTab === 'applications' ? '暂无报名记录' : '暂无合作预约'"
    >
      <el-button v-if="hasFilters" type="primary" plain @click="clearStatusFilter">清除筛选</el-button>
    </el-empty>
    <el-pagination
      v-if="loaded && (total > 0 || hasFilters)"
      :current-page="query.page"
      :page-size="query.pageSize"
      :total="total"
      :page-sizes="[10, 20, 50]"
      layout="total, sizes, prev, pager, next"
      @current-change="(page: number) => { query.page = page; load(); }"
      @size-change="changePageSize"
    />
  </section>

  <el-dialog
    v-model="dialog.visible"
    :title="dialog.item ? `确认${actionLabel(dialog.item, dialog.status)}` : '确认变更状态'"
    width="min(540px, 92vw)"
    :close-on-click-modal="!actionId"
    :close-on-press-escape="!actionId"
    :show-close="!actionId"
    destroy-on-close
  >
    <div class="decision-summary" v-if="dialog.item">
      <strong>{{ dialog.item.job?.title || dialog.item.application?.job?.title || '业务记录' }}</strong>
      <span>当前状态：{{ statusLabel[dialog.item.status] || dialog.item.status }} → {{ statusLabel[dialog.status] }}</span>
    </div>
    <el-alert v-if="dialog.item" :type="['REJECTED', 'CANCELLED', 'DISPUTED'].includes(dialog.status) ? 'warning' : 'info'" :title="actionGuidance(dialog.item, dialog.status)" :closable="false" show-icon />
    <el-form class="operations-dialog-form" label-position="top" @submit.prevent="submitAction">
      <el-form-item label="状态变更原因（必填）">
        <el-input v-model="dialog.note" type="textarea" :rows="4" maxlength="500" show-word-limit :disabled="Boolean(actionId)" placeholder="请记录核实过程、用户诉求与处理依据" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="Boolean(actionId)" @click="dialog.visible = false">返回</el-button>
      <el-button :type="['REJECTED', 'CANCELLED', 'DISPUTED'].includes(dialog.status) ? 'danger' : 'primary'" :loading="Boolean(actionId)" @click="submitAction">确认提交</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.operations-load-error, .operations-policy { margin: 14px 22px 2px; }
.operations-load-error :deep(.el-alert__description) { display: flex; align-items: center; gap: 8px; }
.completion-proof { display: flex; flex-direction: column; gap: 5px; color: #a0a7b4; font-size: 10px; }
.completion-proof span.complete { color: #31885e; }
.status-note { overflow: hidden; display: -webkit-box; color: #737d90; font-size: 11px; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.operations-dialog-form { margin-top: 18px; }

@media (max-width: 620px) {
  .operations-load-error, .operations-policy { margin: 12px 14px 2px; }
}
</style>
