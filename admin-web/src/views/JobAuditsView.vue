<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../api/client";

const loading = ref(false); const items = ref<any[]>([]);
async function load() { loading.value = true; try { items.value = (await api.get("/jobs/audits")).data.items; } finally { loading.value = false; } }
async function decide(item: any, status: "APPROVED" | "REJECTED") {
  let note = status === "APPROVED" ? "内容符合平台发布规范" : "";
  if (status === "REJECTED") note = (await ElMessageBox.prompt("请输入拒绝原因", "发布审核", { inputPattern: /.+/, inputErrorMessage: "请输入原因" })).value;
  await api.patch(`/jobs/${item.id}/audit`, { status, note }); ElMessage.success("审核结果已保存"); await load();
}
onMounted(load);
</script>

<template>
  <section class="content-card table-card">
    <div class="card-head"><div><h3>待审核发布</h3><p>检查内容真实性、隐私与平台规范</p></div><el-button @click="load">刷新</el-button></div>
    <el-table :data="items" v-loading="loading">
      <el-table-column label="发布内容" min-width="260"><template #default="{ row }"><div class="title-cell"><strong>{{ row.title }}</strong><small>{{ row.description }}</small></div></template></el-table-column>
      <el-table-column prop="type" label="类型" width="130" />
      <el-table-column label="年级/科目" width="130"><template #default="{ row }">{{ row.grade }} · {{ row.subject }}</template></el-table-column>
      <el-table-column label="价格" width="110"><template #default="{ row }">¥{{ row.priceCents / 100 }}/{{ row.priceUnit }}</template></el-table-column>
      <el-table-column label="区域" width="120"><template #default="{ row }">{{ row.district }} {{ row.area }}</template></el-table-column>
      <el-table-column label="发布人" width="110"><template #default="{ row }">{{ row.owner.nickname }}</template></el-table-column>
      <el-table-column label="操作" width="160" fixed="right"><template #default="{ row }"><el-button link type="success" @click="decide(row, 'APPROVED')">发布</el-button><el-button link type="danger" @click="decide(row, 'REJECTED')">拒绝</el-button></template></el-table-column>
    </el-table>
    <el-empty v-if="!loading && !items.length" description="没有待审核的发布" />
  </section>
</template>
