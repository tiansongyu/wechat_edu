<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, getApiErrorMessage } from "../api/client";

type GovernanceTab = "reports" | "reviews";
type ReviewStatus = "PUBLISHED" | "HIDDEN" | "REMOVED";
type ReportStatus = "OPEN" | "ACTION_TAKEN" | "NO_VIOLATION";
type ReportCategory = "PRIVACY_LEAK" | "HARASSMENT" | "FALSE_INFORMATION" | "ADVERTISING" | "OTHER";
type ReportResolution = "ACTION_TAKEN" | "NO_VIOLATION";

interface AccountSummary {
  id: string;
  nickname: string;
}

interface ReviewItem {
  id: string;
  appointmentId: string;
  reviewerRole: string;
  revieweeRole: string;
  rating: number;
  tags: string[];
  content: string | null;
  status: ReviewStatus;
  version: number;
  statusChangedReason: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  reviewer: AccountSummary;
  reviewee: AccountSummary;
}

interface ReportReview {
  rating: number;
  tags: string[];
  content: string | null;
  status: ReviewStatus;
  version: number;
  revieweeRole: string;
  reviewer: Pick<AccountSummary, "nickname">;
  reviewee: Pick<AccountSummary, "nickname">;
}

interface ReviewReportItem {
  id: string;
  reviewId: string;
  reporterRole: string;
  category: ReportCategory;
  description: string;
  status: ReportStatus;
  version: number;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  reporter: AccountSummary;
  review: ReportReview;
}

interface PageQuery {
  keyword: string;
  status: string;
  page: number;
  pageSize: number;
}

const activeTab = ref<GovernanceTab>("reports");
const reports = ref<ReviewReportItem[]>([]);
const reviews = ref<ReviewItem[]>([]);
const reportTotal = ref(0);
const reviewTotal = ref(0);
const reportLoading = ref(false);
const reviewLoading = ref(false);
const reportLoaded = ref(false);
const reviewLoaded = ref(false);
const reportError = ref("");
const reviewError = ref("");
const reportRequest = ref(0);
const reviewRequest = ref(0);

const reportQuery = reactive<PageQuery & { category: string }>({
  keyword: "",
  status: "",
  category: "",
  page: 1,
  pageSize: 20
});
const reviewQuery = reactive<PageQuery & { rating: "" | number }>({
  keyword: "",
  status: "",
  rating: "",
  page: 1,
  pageSize: 20
});

const reviewDialog = reactive({
  visible: false,
  item: null as ReviewItem | null,
  action: "HIDE" as "HIDE" | "RESTORE",
  reason: "",
  submitting: false
});
const reportDialog = reactive({
  visible: false,
  item: null as ReviewReportItem | null,
  resolution: "" as "" | ReportResolution,
  note: "",
  submitting: false
});

const reviewStatusLabel: Record<ReviewStatus, string> = {
  PUBLISHED: "公开展示",
  HIDDEN: "已隐藏",
  REMOVED: "已移除"
};
const reviewStatusType: Record<ReviewStatus, string> = {
  PUBLISHED: "success",
  HIDDEN: "warning",
  REMOVED: "info"
};
const reportStatusLabel: Record<ReportStatus, string> = {
  OPEN: "待处理",
  ACTION_TAKEN: "已处置",
  NO_VIOLATION: "未违规"
};
const reportStatusType: Record<ReportStatus, string> = {
  OPEN: "danger",
  ACTION_TAKEN: "warning",
  NO_VIOLATION: "success"
};
const categoryLabel: Record<ReportCategory, string> = {
  PRIVACY_LEAK: "泄露隐私",
  HARASSMENT: "骚扰攻击",
  FALSE_INFORMATION: "虚假信息",
  ADVERTISING: "广告引流",
  OTHER: "其他问题"
};
const roleLabel: Record<string, string> = { PARENT: "家长", TEACHER: "老师", ADMIN: "管理员" };

const hasReportFilters = computed(() => Boolean(reportQuery.keyword.trim() || reportQuery.status || reportQuery.category));
const hasReviewFilters = computed(() => Boolean(reviewQuery.keyword.trim() || reviewQuery.status || reviewQuery.rating !== ""));

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

function normalizePage<T>(data: any): { items: T[]; total: number } {
  if (!data || !Array.isArray(data.items) || typeof data.total !== "number") {
    throw new Error("服务器返回的数据格式不正确");
  }
  return { items: data.items, total: data.total };
}

function isConflict(error: unknown) {
  return (error as any)?.response?.status === 409;
}

async function loadReports() {
  const requestId = ++reportRequest.value;
  reportLoading.value = true;
  reportError.value = "";
  try {
    const { data } = await api.get("/review-reports", {
      params: {
        page: reportQuery.page,
        pageSize: reportQuery.pageSize,
        keyword: reportQuery.keyword.trim() || undefined,
        status: reportQuery.status || undefined,
        category: reportQuery.category || undefined
      }
    });
    if (requestId !== reportRequest.value) return;
    const page = normalizePage<ReviewReportItem>(data);
    reports.value = page.items;
    reportTotal.value = page.total;
    reportLoaded.value = true;
  } catch (error) {
    if (requestId !== reportRequest.value) return;
    reportError.value = getApiErrorMessage(error, "举报案件加载失败，请稍后重试");
  } finally {
    if (requestId === reportRequest.value) reportLoading.value = false;
  }
}

async function loadReviews() {
  const requestId = ++reviewRequest.value;
  reviewLoading.value = true;
  reviewError.value = "";
  try {
    const { data } = await api.get("/reviews", {
      params: {
        page: reviewQuery.page,
        pageSize: reviewQuery.pageSize,
        keyword: reviewQuery.keyword.trim() || undefined,
        status: reviewQuery.status || undefined,
        rating: reviewQuery.rating === "" ? undefined : reviewQuery.rating
      }
    });
    if (requestId !== reviewRequest.value) return;
    const page = normalizePage<ReviewItem>(data);
    reviews.value = page.items;
    reviewTotal.value = page.total;
    reviewLoaded.value = true;
  } catch (error) {
    if (requestId !== reviewRequest.value) return;
    reviewError.value = getApiErrorMessage(error, "评价记录加载失败，请稍后重试");
  } finally {
    if (requestId === reviewRequest.value) reviewLoading.value = false;
  }
}

function switchTab(tab: GovernanceTab) {
  activeTab.value = tab;
  if (tab === "reports" && !reportLoaded.value && !reportLoading.value) loadReports();
  if (tab === "reviews" && !reviewLoaded.value && !reviewLoading.value) loadReviews();
}

function applyReportFilters() {
  reportQuery.page = 1;
  loadReports();
}

function resetReportFilters() {
  Object.assign(reportQuery, { keyword: "", status: "", category: "", page: 1 });
  loadReports();
}

function applyReviewFilters() {
  reviewQuery.page = 1;
  loadReviews();
}

function resetReviewFilters() {
  Object.assign(reviewQuery, { keyword: "", status: "", rating: "", page: 1 });
  loadReviews();
}

function changeReportPageSize(size: number) {
  reportQuery.pageSize = size;
  reportQuery.page = 1;
  loadReports();
}

function changeReviewPageSize(size: number) {
  reviewQuery.pageSize = size;
  reviewQuery.page = 1;
  loadReviews();
}

function openReviewAction(item: ReviewItem, action: "HIDE" | "RESTORE") {
  if (reviewError.value) {
    ElMessage.warning("请先重新加载最新评价状态");
    return;
  }
  reviewDialog.item = item;
  reviewDialog.action = action;
  reviewDialog.reason = "";
  reviewDialog.visible = true;
}

async function submitReviewAction() {
  const item = reviewDialog.item;
  const reason = reviewDialog.reason.trim();
  if (!item || reviewDialog.submitting) return;
  if (reviewError.value) {
    ElMessage.warning("请先重新加载最新评价状态");
    return;
  }
  if (reason.length < 10 || reason.length > 500) {
    ElMessage.warning("治理原因需填写 10–500 个字符");
    return;
  }
  reviewDialog.submitting = true;
  try {
    const endpoint = reviewDialog.action === "HIDE" ? "hide" : "restore";
    await api.post(`/reviews/${item.id}/${endpoint}`, { reason, version: item.version });
    ElMessage.success(reviewDialog.action === "HIDE" ? "评价已隐藏并记录审计" : "评价已恢复展示并记录审计");
    reviewDialog.visible = false;
    await loadReviews();
    if (reportLoaded.value) await loadReports();
  } catch (error) {
    if (isConflict(error)) {
      ElMessage.warning("评价已被其他管理员处理，已为你刷新最新状态");
      reviewDialog.visible = false;
      await loadReviews();
      if (reportLoaded.value) await loadReports();
    } else {
      ElMessage.error(getApiErrorMessage(error, "评价治理操作失败"));
    }
  } finally {
    reviewDialog.submitting = false;
  }
}

function openReportResolution(item: ReviewReportItem) {
  if (reportError.value) {
    ElMessage.warning("请先重新加载最新案件状态");
    return;
  }
  reportDialog.item = item;
  reportDialog.resolution = "";
  reportDialog.note = "";
  reportDialog.visible = true;
}

async function submitReportResolution() {
  const item = reportDialog.item;
  const note = reportDialog.note.trim();
  if (!item || reportDialog.submitting) return;
  if (reportError.value) {
    ElMessage.warning("请先重新加载最新案件状态");
    return;
  }
  if (!reportDialog.resolution) {
    ElMessage.warning("请选择案件处理结论");
    return;
  }
  if (note.length < 10 || note.length > 500) {
    ElMessage.warning("处理说明需填写 10–500 个字符");
    return;
  }
  reportDialog.submitting = true;
  try {
    await api.post(`/review-reports/${item.id}/resolve`, {
      resolution: reportDialog.resolution,
      note,
      version: item.version,
      reviewVersion: item.review.version
    });
    ElMessage.success(reportDialog.resolution === "ACTION_TAKEN" ? "违规评价已隐藏，举报案件已结案" : "案件已标记为未违规");
    reportDialog.visible = false;
    await loadReports();
    if (reviewLoaded.value) await loadReviews();
  } catch (error) {
    if (isConflict(error)) {
      ElMessage.warning("案件或评价已被其他管理员处理，已刷新最新状态");
      reportDialog.visible = false;
      await loadReports();
      if (reviewLoaded.value) await loadReviews();
    } else {
      ElMessage.error(getApiErrorMessage(error, "举报案件处理失败"));
    }
  } finally {
    reportDialog.submitting = false;
  }
}

onMounted(loadReports);
</script>

<template>
  <section class="content-card table-card governance-card">
    <div class="card-head governance-head">
      <div>
        <h3>评价与举报治理</h3>
        <p>只处理展示状态与举报结论；星级、标签及正文均保留原始记录且不可编辑</p>
      </div>
      <el-button
        :loading="activeTab === 'reports' ? reportLoading : reviewLoading"
        @click="activeTab === 'reports' ? loadReports() : loadReviews()"
      >刷新当前列表</el-button>
    </div>

    <div class="section-tabs governance-tabs" role="tablist" aria-label="评价治理列表">
      <button :class="{ active: activeTab === 'reports' }" role="tab" :aria-selected="activeTab === 'reports'" @click="switchTab('reports')">
        举报案件<span v-if="reportLoaded" class="tab-count">{{ reportTotal }}</span>
      </button>
      <button :class="{ active: activeTab === 'reviews' }" role="tab" :aria-selected="activeTab === 'reviews'" @click="switchTab('reviews')">
        评价记录<span v-if="reviewLoaded" class="tab-count">{{ reviewTotal }}</span>
      </button>
    </div>

    <template v-if="activeTab === 'reports'">
      <div class="governance-filters">
        <el-input v-model="reportQuery.keyword" clearable placeholder="搜索评价内容或用户昵称" @keyup.enter="applyReportFilters" />
        <el-select v-model="reportQuery.status" clearable placeholder="全部处理状态">
          <el-option v-for="(label, value) in reportStatusLabel" :key="value" :label="label" :value="value" />
        </el-select>
        <el-select v-model="reportQuery.category" clearable placeholder="全部举报类型">
          <el-option v-for="(label, value) in categoryLabel" :key="value" :label="label" :value="value" />
        </el-select>
        <el-button type="primary" :loading="reportLoading" @click="applyReportFilters">查询</el-button>
        <el-button :disabled="reportLoading || !hasReportFilters" @click="resetReportFilters">重置</el-button>
      </div>

      <el-alert v-if="reportError" class="load-error" type="error" :title="reportError" :closable="false" show-icon>
        <template #default>
          <span>{{ reports.length ? "下方保留上次成功加载的数据，请刷新后再处理。" : "当前无法读取举报案件。" }}</span>
          <el-button link type="primary" :loading="reportLoading" @click="loadReports">重新加载</el-button>
        </template>
      </el-alert>

      <el-table :data="reports" v-loading="reportLoading" row-key="id" empty-text=" ">
        <el-table-column label="举报案件" min-width="250">
          <template #default="{ row }">
            <div class="governance-primary">
              <div><el-tag size="small" effect="light">{{ categoryLabel[row.category as ReportCategory] || row.category }}</el-tag><strong>{{ row.reporter?.nickname || "未知用户" }} 举报</strong></div>
              <p>{{ row.description || "未填写补充说明" }}</p>
              <small>{{ formatDate(row.createdAt) }} · 举报身份 {{ roleLabel[row.reporterRole] || row.reporterRole }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="被举报评价" min-width="330">
          <template #default="{ row }">
            <div class="review-evidence">
              <div class="review-evidence__head">
                <el-rate :model-value="row.review?.rating || 0" disabled size="small" />
                <span>{{ row.review?.reviewer?.nickname || "未知用户" }} → {{ row.review?.reviewee?.nickname || "未知用户" }}</span>
              </div>
              <p>{{ row.review?.content || "该评价未填写文字内容" }}</p>
              <div v-if="row.review?.tags?.length" class="tag-row"><el-tag v-for="tag in row.review.tags" :key="tag" size="small" type="info">{{ tag }}</el-tag></div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="案件状态" width="130">
          <template #default="{ row }"><el-tag :type="reportStatusType[row.status as ReportStatus] as any">{{ reportStatusLabel[row.status as ReportStatus] || row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column label="处理记录" min-width="220">
          <template #default="{ row }">
            <div v-if="row.status !== 'OPEN'" class="governance-note"><span>{{ row.resolutionNote || "无处理说明" }}</span><small>{{ formatDate(row.resolvedAt) }}</small></div>
            <span v-else class="muted">等待管理员研判</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'OPEN'" type="primary" link :disabled="Boolean(reportError) || reportDialog.submitting || reviewDialog.submitting" @click="openReportResolution(row)">处理案件</el-button>
            <span v-else class="muted">已结案</span>
          </template>
        </el-table-column>
      </el-table>

      <el-empty
        v-if="reportLoaded && !reportLoading && !reportError && !reports.length"
        :description="hasReportFilters ? '没有符合当前筛选条件的举报案件' : '当前没有举报案件'"
      >
        <el-button v-if="hasReportFilters" type="primary" plain @click="resetReportFilters">清除筛选</el-button>
      </el-empty>
      <el-pagination
        v-if="reportLoaded && (reportTotal > 0 || hasReportFilters)"
        :current-page="reportQuery.page"
        :page-size="reportQuery.pageSize"
        :total="reportTotal"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        @current-change="(page: number) => { reportQuery.page = page; loadReports(); }"
        @size-change="changeReportPageSize"
      />
    </template>

    <template v-else>
      <div class="governance-filters">
        <el-input v-model="reviewQuery.keyword" clearable placeholder="搜索评价内容或用户昵称" @keyup.enter="applyReviewFilters" />
        <el-select v-model="reviewQuery.status" clearable placeholder="全部展示状态">
          <el-option v-for="(label, value) in reviewStatusLabel" :key="value" :label="label" :value="value" />
        </el-select>
        <el-select v-model="reviewQuery.rating" clearable placeholder="全部星级">
          <el-option v-for="rating in [5, 4, 3, 2, 1]" :key="rating" :label="`${rating} 星`" :value="rating" />
        </el-select>
        <el-button type="primary" :loading="reviewLoading" @click="applyReviewFilters">查询</el-button>
        <el-button :disabled="reviewLoading || !hasReviewFilters" @click="resetReviewFilters">重置</el-button>
      </div>

      <el-alert v-if="reviewError" class="load-error" type="error" :title="reviewError" :closable="false" show-icon>
        <template #default>
          <span>{{ reviews.length ? "下方保留上次成功加载的数据，请刷新后再操作。" : "当前无法读取评价记录。" }}</span>
          <el-button link type="primary" :loading="reviewLoading" @click="loadReviews">重新加载</el-button>
        </template>
      </el-alert>

      <el-table :data="reviews" v-loading="reviewLoading" row-key="id" empty-text=" ">
        <el-table-column label="评价关系" min-width="230">
          <template #default="{ row }">
            <div class="governance-primary compact">
              <strong>{{ row.reviewer?.nickname || "未知用户" }} → {{ row.reviewee?.nickname || "未知用户" }}</strong>
              <small>{{ roleLabel[row.reviewerRole] || row.reviewerRole }} 评价 {{ roleLabel[row.revieweeRole] || row.revieweeRole }}</small>
              <small>{{ formatDate(row.createdAt) }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="原始评价（只读）" min-width="390">
          <template #default="{ row }">
            <div class="review-evidence">
              <div class="review-evidence__head"><el-rate :model-value="row.rating" disabled size="small" /><strong>{{ row.rating }}.0</strong></div>
              <p>{{ row.content || "该评价未填写文字内容" }}</p>
              <div v-if="row.tags?.length" class="tag-row"><el-tag v-for="tag in row.tags" :key="tag" size="small" type="info">{{ tag }}</el-tag></div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="展示状态" width="130">
          <template #default="{ row }"><el-tag :type="reviewStatusType[row.status as ReviewStatus] as any">{{ reviewStatusLabel[row.status as ReviewStatus] || row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column label="最近治理记录" min-width="230">
          <template #default="{ row }">
            <div v-if="row.statusChangedAt" class="governance-note"><span>{{ row.statusChangedReason || "无治理说明" }}</span><small>{{ formatDate(row.statusChangedAt) }}</small></div>
            <span v-else class="muted">尚无治理操作</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'PUBLISHED'" type="danger" link :disabled="Boolean(reviewError) || reportDialog.submitting || reviewDialog.submitting" @click="openReviewAction(row, 'HIDE')">隐藏评价</el-button>
            <el-button v-else-if="row.status === 'HIDDEN'" type="primary" link :disabled="Boolean(reviewError) || reportDialog.submitting || reviewDialog.submitting" @click="openReviewAction(row, 'RESTORE')">恢复展示</el-button>
            <span v-else class="muted">不可恢复</span>
          </template>
        </el-table-column>
      </el-table>

      <el-empty
        v-if="reviewLoaded && !reviewLoading && !reviewError && !reviews.length"
        :description="hasReviewFilters ? '没有符合当前筛选条件的评价' : '当前没有评价记录'"
      >
        <el-button v-if="hasReviewFilters" type="primary" plain @click="resetReviewFilters">清除筛选</el-button>
      </el-empty>
      <el-pagination
        v-if="reviewLoaded && (reviewTotal > 0 || hasReviewFilters)"
        :current-page="reviewQuery.page"
        :page-size="reviewQuery.pageSize"
        :total="reviewTotal"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        @current-change="(page: number) => { reviewQuery.page = page; loadReviews(); }"
        @size-change="changeReviewPageSize"
      />
    </template>
  </section>

  <el-dialog
    v-model="reviewDialog.visible"
    :title="reviewDialog.action === 'HIDE' ? '隐藏这条评价' : '恢复这条评价'"
    width="min(540px, 94vw)"
    :close-on-click-modal="!reviewDialog.submitting"
    :close-on-press-escape="!reviewDialog.submitting"
    :show-close="!reviewDialog.submitting"
    destroy-on-close
  >
    <div v-if="reviewDialog.item" class="decision-summary">
      <strong>{{ reviewDialog.item.reviewer.nickname }} → {{ reviewDialog.item.reviewee.nickname }} · {{ reviewDialog.item.rating }} 星</strong>
      <span>{{ reviewDialog.item.content || "该评价未填写文字内容" }}</span>
    </div>
    <el-alert
      :type="reviewDialog.action === 'HIDE' ? 'warning' : 'info'"
      :title="reviewDialog.action === 'HIDE' ? '隐藏后该评价不再参与公开汇总，但原始数据与审计记录仍会保留。' : '请确认问题已消除，恢复后评价会重新公开并参与汇总。'"
      :closable="false"
      show-icon
    />
    <el-form class="dialog-form" label-position="top" @submit.prevent="submitReviewAction">
      <el-form-item label="治理原因（必填，10–500 字）">
        <el-input v-model="reviewDialog.reason" type="textarea" :rows="4" maxlength="500" show-word-limit :disabled="reviewDialog.submitting" placeholder="请写明判断依据，供后续审计与申诉核对" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="reviewDialog.submitting" @click="reviewDialog.visible = false">取消</el-button>
      <el-button :type="reviewDialog.action === 'HIDE' ? 'danger' : 'primary'" :loading="reviewDialog.submitting" @click="submitReviewAction">确认提交</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="reportDialog.visible"
    title="处理举报案件"
    width="min(620px, 94vw)"
    :close-on-click-modal="!reportDialog.submitting"
    :close-on-press-escape="!reportDialog.submitting"
    :show-close="!reportDialog.submitting"
    destroy-on-close
  >
    <div v-if="reportDialog.item" class="report-dialog-evidence">
      <strong>{{ categoryLabel[reportDialog.item.category] }} · {{ reportDialog.item.reporter.nickname }} 举报</strong>
      <p>举报说明：{{ reportDialog.item.description || "未填写补充说明" }}</p>
      <blockquote>{{ reportDialog.item.review.content || "该评价未填写文字内容" }}</blockquote>
    </div>
    <el-form class="dialog-form" label-position="top" @submit.prevent="submitReportResolution">
      <el-form-item label="处理结论（必选）">
        <el-radio-group v-model="reportDialog.resolution" :disabled="reportDialog.submitting" class="resolution-options">
          <el-radio-button value="ACTION_TAKEN">确认违规：隐藏评价并结案</el-radio-button>
          <el-radio-button value="NO_VIOLATION">未发现违规：直接结案</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-alert
        v-if="reportDialog.resolution === 'ACTION_TAKEN'"
        class="resolution-alert"
        type="warning"
        title="提交后会在同一事务中隐藏评价并关闭举报案件。"
        :closable="false"
        show-icon
      />
      <el-form-item label="处理说明（必填，10–500 字）">
        <el-input v-model="reportDialog.note" type="textarea" :rows="4" maxlength="500" show-word-limit :disabled="reportDialog.submitting" placeholder="请写明核查过程与处理依据" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="reportDialog.submitting" @click="reportDialog.visible = false">取消</el-button>
      <el-button :type="reportDialog.resolution === 'ACTION_TAKEN' ? 'danger' : 'primary'" :loading="reportDialog.submitting" @click="submitReportResolution">确认结案</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.governance-head { gap: 20px; }
.governance-tabs { padding-top: 16px; border-bottom: 1px solid #edf0f4; }
.governance-tabs button { display: inline-flex; align-items: center; gap: 7px; border-radius: 9px 9px 0 0; }
.tab-count { min-width: 22px; padding: 2px 7px; color: #6f7a90; font-size: 10px; background: #eef1f6; border-radius: 12px; }
.governance-tabs button.active .tab-count { color: #286fe5; background: #dceaff; }
.governance-filters { display: grid; grid-template-columns: minmax(220px, 1.4fr) minmax(150px, .7fr) minmax(150px, .7fr) auto auto; gap: 10px; padding: 18px 22px; border-bottom: 1px solid #edf0f4; }
.load-error { margin: 14px 22px 4px; }
.load-error :deep(.el-alert__description) { display: flex; align-items: center; gap: 8px; }
.governance-primary { display: flex; flex-direction: column; gap: 7px; padding: 6px 0; }
.governance-primary > div { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.governance-primary strong { color: #30394d; font-size: 13px; }
.governance-primary p, .review-evidence p { overflow: hidden; display: -webkit-box; margin: 0; color: #606a7e; font-size: 12px; line-height: 1.6; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.governance-primary small { color: #9ca4b3; font-size: 10px; }
.governance-primary.compact { gap: 5px; }
.review-evidence { display: flex; flex-direction: column; gap: 7px; padding: 5px 0; }
.review-evidence__head { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; color: #697389; font-size: 11px; }
.review-evidence__head :deep(.el-rate) { height: 20px; }
.review-evidence__head strong { color: #d88720; }
.tag-row { display: flex; flex-wrap: wrap; gap: 5px; }
.tag-row :deep(.el-tag + .el-tag) { margin-left: 0; }
.governance-note { display: flex; flex-direction: column; gap: 6px; padding: 4px 0; }
.governance-note span { color: #606a7e; font-size: 12px; line-height: 1.55; }
.governance-note small { color: #a0a7b4; font-size: 10px; }
.dialog-form { margin-top: 18px; }
.resolution-options { display: grid; width: 100%; grid-template-columns: 1fr 1fr; }
.resolution-options :deep(.el-radio-button__inner) { width: 100%; min-height: 42px; padding: 12px 10px; white-space: normal; }
.resolution-alert { margin: -3px 0 18px; }
.report-dialog-evidence { margin-bottom: 18px; padding: 16px 18px; color: #3d475b; background: #f7f9fc; border: 1px solid #e8edf5; border-radius: 12px; }
.report-dialog-evidence p { margin: 9px 0; color: #697389; font-size: 12px; line-height: 1.6; }
.report-dialog-evidence blockquote { margin: 0; padding: 10px 13px; color: #596378; font-size: 12px; line-height: 1.6; background: #fff; border-left: 3px solid #99b8ee; border-radius: 5px; }

@media (max-width: 980px) {
  .governance-filters { grid-template-columns: 1fr 1fr; }
  .governance-filters > :first-child { grid-column: 1 / -1; }
}

@media (max-width: 620px) {
  .governance-head { align-items: flex-start; flex-direction: column; }
  .governance-filters { grid-template-columns: 1fr; padding: 14px; }
  .governance-filters > :first-child { grid-column: auto; }
  .load-error { margin: 12px 14px 2px; }
  .resolution-options { grid-template-columns: 1fr; }
}
</style>
