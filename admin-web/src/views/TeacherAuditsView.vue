<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../api/client";

const loading = ref(false); const items = ref<any[]>([]);
async function load() { loading.value = true; try { items.value = (await api.get("/teachers/audits")).data.items; } finally { loading.value = false; } }
async function decide(item: any, status: "APPROVED" | "REJECTED") {
  let note = status === "APPROVED" ? "资料真实完整，认证通过" : "";
  if (status === "REJECTED") note = (await ElMessageBox.prompt("请输入需要补充或修改的内容", "拒绝认证", { inputPattern: /.+/, inputErrorMessage: "请输入原因" })).value;
  await api.patch(`/teachers/${item.accountId}/audit`, { status, note }); ElMessage.success("审核结果已保存"); await load();
}
onMounted(load);
</script>

<template>
  <section class="content-card table-card">
    <div class="card-head"><div><h3>待审核教师</h3><p>审核教育经历、授课能力与认证材料</p></div><el-button @click="load">刷新</el-button></div>
    <el-table :data="items" v-loading="loading">
      <el-table-column label="申请人" min-width="170"><template #default="{ row }"><div class="user-cell"><span>{{ row.realName?.slice(0, 1) || row.account.nickname.slice(0, 1) }}</span><div><strong>{{ row.realName || row.account.nickname }}</strong><small>{{ row.school || "学校待补充" }}</small></div></div></template></el-table-column>
      <el-table-column prop="education" label="学历" width="90" />
      <el-table-column prop="major" label="专业" min-width="130" />
      <el-table-column label="科目" min-width="150"><template #default="{ row }"><el-tag v-for="s in row.subjects" :key="s" effect="plain">{{ s }}</el-tag></template></el-table-column>
      <el-table-column prop="teachingYears" label="教龄" width="80" />
      <el-table-column label="材料" width="80"><template #default="{ row }">{{ row.certifications.length }} 份</template></el-table-column>
      <el-table-column label="操作" width="160" fixed="right"><template #default="{ row }"><el-button link type="success" @click="decide(row, 'APPROVED')">通过</el-button><el-button link type="danger" @click="decide(row, 'REJECTED')">拒绝</el-button></template></el-table-column>
    </el-table>
    <el-empty v-if="!loading && !items.length" description="没有待审核的教师资料" />
  </section>
</template>
