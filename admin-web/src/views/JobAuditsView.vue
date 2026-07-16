<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, getApiErrorMessage } from "../api/client";

const loading = ref(false);
const actionId = ref("");
const items = ref<any[]>([]);
const total = ref(0);
const revisions = ref<any[]>([]);
const revisionTotal = ref(0);
const query = reactive({ page: 1, pageSize: 20 });
const revisionQuery = reactive({ page: 1, pageSize: 20 });
const dialog = reactive({ visible: false, item: null as any, kind: "job" as "job" | "revision", status: "APPROVED" as "APPROVED" | "REJECTED", note: "" });

async function load() {
  loading.value = true;
  try {
    const [jobsResponse, revisionsResponse] = await Promise.all([
      api.get("/jobs/audits", { params: query }),
      api.get("/job-revisions/audits", { params: revisionQuery })
    ]);
    items.value = jobsResponse.data.items;
    total.value = jobsResponse.data.total;
    revisions.value = revisionsResponse.data.items;
    revisionTotal.value = revisionsResponse.data.total;
  } catch (error) {
    ElMessage.error(getApiErrorMessage(error, "发布审核列表加载失败"));
  } finally {
    loading.value = false;
  }
}

function openDecision(item: any, status: "APPROVED" | "REJECTED", kind: "job" | "revision" = "job") {
  dialog.item = item;
  dialog.kind = kind;
  dialog.status = status;
  dialog.note = status === "APPROVED" ? "内容符合平台发布规范" : "";
  dialog.visible = true;
}

async function submitDecision() {
  if (!dialog.item || actionId.value) return;
  if (dialog.status === "REJECTED" && !dialog.note.trim()) {
    ElMessage.warning("拒绝时必须填写具体原因");
    return;
  }
  actionId.value = dialog.item.id;
  try {
    const url = dialog.kind === "revision"
      ? `/job-revisions/${dialog.item.id}/audit`
      : `/jobs/${dialog.item.id}/audit`;
    await api.patch(url, {
      status: dialog.status,
      note: dialog.note.trim(),
      version: dialog.item.version
    });
    ElMessage.success(dialog.status === "APPROVED"
      ? (dialog.kind === "revision" ? "修改已审核通过并生效" : "发布已通过审核")
      : (dialog.kind === "revision" ? "修改已拒绝并通知用户" : "发布已拒绝并通知用户"));
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
    <div class="card-head">
      <div><h3>待审核发布</h3><p>审核结果会写入数据库、通知发布人并记录操作日志</p></div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>
    <el-table :data="items" v-loading="loading" row-key="id">
      <el-table-column label="发布内容" min-width="280">
        <template #default="{ row }"><div class="title-cell"><strong>{{ row.title }}</strong><small>{{ row.description }}</small></div></template>
      </el-table-column>
      <el-table-column label="类型" width="120"><template #default="{ row }"><el-tag effect="plain">{{ row.type === 'TEACHING_NEED' ? '家教需求' : '老师求带' }}</el-tag></template></el-table-column>
      <el-table-column label="年级 / 科目" width="130"><template #default="{ row }">{{ row.grade }} · {{ row.subject }}</template></el-table-column>
      <el-table-column label="价格" width="115"><template #default="{ row }">¥{{ row.priceCents / 100 }}/{{ row.priceUnit }}</template></el-table-column>
      <el-table-column label="区域" min-width="180"><template #default="{ row }">{{ [row.province, row.city, row.district, row.area].filter(Boolean).join(' · ') }}</template></el-table-column>
      <el-table-column label="发布人" width="110"><template #default="{ row }">{{ row.owner.nickname }}</template></el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="success" :loading="actionId === row.id" :disabled="Boolean(actionId)" @click="openDecision(row, 'APPROVED')">通过</el-button>
          <el-button link type="danger" :disabled="Boolean(actionId)" @click="openDecision(row, 'REJECTED')">拒绝</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !items.length" description="没有待审核的发布" />
    <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
  </section>

  <section class="content-card table-card" style="margin-top: 20px">
    <div class="card-head">
      <div><h3>待审核修改</h3><p>原发布保持在线；只有审核通过后，新内容才会原子替换并写入操作日志</p></div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>
    <el-table :data="revisions" v-loading="loading" row-key="id">
      <el-table-column label="原发布" min-width="220">
        <template #default="{ row }"><div class="title-cell"><strong>{{ row.job.title }}</strong><small>{{ row.job.description }}</small></div></template>
      </el-table-column>
      <el-table-column label="拟修改为" min-width="300">
        <template #default="{ row }"><div class="title-cell"><strong>{{ row.proposedData.title }}</strong><small>{{ row.proposedData.description }}</small></div></template>
      </el-table-column>
      <el-table-column label="年级 / 科目" width="150"><template #default="{ row }">{{ row.proposedData.grade }} · {{ row.proposedData.subject }}</template></el-table-column>
      <el-table-column label="价格" width="120"><template #default="{ row }">¥{{ row.proposedData.priceCents / 100 }}/{{ row.proposedData.priceUnit }}</template></el-table-column>
      <el-table-column label="申请人" width="110"><template #default="{ row }">{{ row.requester.nickname }}</template></el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="success" :loading="actionId === row.id" :disabled="Boolean(actionId)" @click="openDecision(row, 'APPROVED', 'revision')">通过</el-button>
          <el-button link type="danger" :disabled="Boolean(actionId)" @click="openDecision(row, 'REJECTED', 'revision')">拒绝</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !revisions.length" description="没有待审核的修改申请" />
    <el-pagination v-model:current-page="revisionQuery.page" v-model:page-size="revisionQuery.pageSize" :total="revisionTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
  </section>

  <el-dialog v-model="dialog.visible" :title="dialog.status === 'APPROVED' ? '通过发布审核' : '拒绝发布'" width="min(520px, 92vw)" destroy-on-close>
    <div class="decision-summary" v-if="dialog.item && dialog.kind === 'job'"><strong>{{ dialog.item.title }}</strong><span>{{ dialog.item.owner.nickname }} · {{ dialog.item.district }} · {{ dialog.item.subject }}</span></div>
    <div class="decision-summary" v-else-if="dialog.item"><strong>{{ dialog.item.proposedData.title }}</strong><span>{{ dialog.item.requester.nickname }} · {{ dialog.item.proposedData.district }} · {{ dialog.item.proposedData.subject }}</span></div>
    <el-form label-position="top">
      <el-form-item :label="dialog.status === 'REJECTED' ? '拒绝原因（必填）' : '审核说明'">
        <el-input v-model="dialog.note" type="textarea" :rows="4" maxlength="500" show-word-limit :placeholder="dialog.status === 'REJECTED' ? '请明确指出需要修改的内容' : '可补充审核说明'" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="Boolean(actionId)" @click="dialog.visible = false">取消</el-button>
      <el-button :type="dialog.status === 'APPROVED' ? 'success' : 'danger'" :loading="Boolean(actionId)" @click="submitDecision">确认{{ dialog.status === 'APPROVED' ? '通过' : '拒绝' }}</el-button>
    </template>
  </el-dialog>
</template>
