<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, getApiErrorMessage } from "../api/client";

const loading = ref(false);
const actionId = ref("");
const items = ref<any[]>([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 20 });
const dialog = reactive({ visible: false, item: null as any, status: "APPROVED" as "APPROVED" | "REJECTED", note: "" });

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get("/teachers/audits", { params: query });
    items.value = data.items;
    total.value = data.total;
  } catch (error) {
    ElMessage.error(getApiErrorMessage(error, "教师审核列表加载失败"));
  } finally {
    loading.value = false;
  }
}

function openDecision(item: any, status: "APPROVED" | "REJECTED") {
  dialog.item = item;
  dialog.status = status;
  dialog.note = status === "APPROVED" ? "资料真实完整，认证通过" : "";
  dialog.visible = true;
}

async function submitDecision() {
  if (!dialog.item || actionId.value) return;
  if (dialog.status === "REJECTED" && !dialog.note.trim()) {
    ElMessage.warning("拒绝时必须填写需要补充或修改的内容");
    return;
  }
  actionId.value = dialog.item.accountId;
  try {
    await api.patch(`/teachers/${dialog.item.accountId}/audit`, {
      status: dialog.status,
      note: dialog.note.trim(),
      version: dialog.item.version
    });
    ElMessage.success(dialog.status === "APPROVED" ? "教师认证已通过" : "认证已拒绝并通知教师");
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
      <div><h3>待审核教师</h3><p>核验教育经历、授课能力与认证材料；审核结果全程留痕</p></div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>
    <el-table :data="items" v-loading="loading" row-key="accountId">
      <el-table-column label="申请人" min-width="180"><template #default="{ row }"><div class="user-cell"><span>{{ row.realName?.slice(0, 1) || row.account.nickname.slice(0, 1) }}</span><div><strong>{{ row.realName || row.account.nickname }}</strong><small>{{ row.school || '学校待补充' }}</small></div></div></template></el-table-column>
      <el-table-column prop="education" label="学历" width="90" />
      <el-table-column prop="major" label="专业" min-width="130" />
      <el-table-column label="科目" min-width="150"><template #default="{ row }"><el-tag v-for="s in row.subjects" :key="s" effect="plain">{{ s }}</el-tag><span v-if="!row.subjects?.length" class="muted">未填写</span></template></el-table-column>
      <el-table-column label="教龄" width="85"><template #default="{ row }">{{ row.teachingYears }} 年</template></el-table-column>
      <el-table-column label="材料" width="90"><template #default="{ row }"><el-tag :type="row.certifications.length ? 'success' : 'warning'">{{ row.certifications.length }} 份</el-tag></template></el-table-column>
      <el-table-column label="操作" width="180" fixed="right"><template #default="{ row }"><el-button link type="success" :loading="actionId === row.accountId" :disabled="Boolean(actionId)" @click="openDecision(row, 'APPROVED')">通过</el-button><el-button link type="danger" :disabled="Boolean(actionId)" @click="openDecision(row, 'REJECTED')">拒绝</el-button></template></el-table-column>
    </el-table>
    <el-empty v-if="!loading && !items.length" description="没有待审核的教师资料" />
    <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
  </section>

  <el-dialog v-model="dialog.visible" :title="dialog.status === 'APPROVED' ? '通过教师认证' : '拒绝教师认证'" width="min(560px, 92vw)" destroy-on-close>
    <div class="decision-summary" v-if="dialog.item"><strong>{{ dialog.item.realName || dialog.item.account.nickname }}</strong><span>{{ dialog.item.school || '学校未填写' }} · {{ dialog.item.major || '专业未填写' }} · {{ dialog.item.certifications.length }} 份材料</span></div>
    <el-form label-position="top"><el-form-item :label="dialog.status === 'REJECTED' ? '修改要求（必填）' : '审核说明'"><el-input v-model="dialog.note" type="textarea" :rows="4" maxlength="500" show-word-limit :placeholder="dialog.status === 'REJECTED' ? '请具体说明资料或材料存在的问题' : '可补充审核说明'" /></el-form-item></el-form>
    <template #footer><el-button :disabled="Boolean(actionId)" @click="dialog.visible = false">取消</el-button><el-button :type="dialog.status === 'APPROVED' ? 'success' : 'danger'" :loading="Boolean(actionId)" @click="submitDecision">确认{{ dialog.status === 'APPROVED' ? '通过' : '拒绝' }}</el-button></template>
  </el-dialog>
</template>
