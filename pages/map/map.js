const { JOBS } = require("../../utils/data");
const api = require("../../utils/api");

Page({
  data: {
    query: "",
    districts: ["全部区域", "南山区", "福田区", "宝安区", "龙华区", "线上"],
    districtIndex: 0,
    jobs: JOBS,
    visibleJobs: JOBS,
    selectedJob: JOBS[0],
    showList: false
  },

  onShow() {
    this.loadRemoteJobs();
  },

  async loadRemoteJobs() {
    try {
      if (getApp().globalData.authReady) await getApp().globalData.authReady;
      const type = api.getActiveRole() === "TEACHER" ? "TEACHING_NEED" : "TEACHER_OFFER";
      const data = await api.listJobs({ type, limit: 50 });
      const jobs = (data.items || []).map(api.mapJob);
      this.setData({ jobs, visibleJobs: jobs, selectedJob: jobs[0] || null });
    } catch (error) {}
  },

  handleSearch(event) {
    this.setData({ query: event.detail.value }, () => this.filterJobs());
  },

  changeDistrict(event) {
    this.setData({ districtIndex: Number(event.detail.value) }, () => this.filterJobs());
  },

  filterJobs() {
    const keyword = this.data.query.trim().toLowerCase();
    const district = this.data.districts[this.data.districtIndex];
    const visibleJobs = this.data.jobs.filter((job) => {
      const keywordMatch = !keyword || `${job.title}${job.subject}${job.area}`.toLowerCase().includes(keyword);
      const districtMatch = district === "全部区域" || job.district === district;
      return keywordMatch && districtMatch;
    });
    const selectedJob = visibleJobs.some((job) => job.id === this.data.selectedJob.id)
      ? this.data.selectedJob
      : visibleJobs[0] || null;
    this.setData({ visibleJobs, selectedJob });
  },

  selectMarker(event) {
    const selectedJob = this.data.jobs.find((job) => job.id === event.currentTarget.dataset.id);
    if (selectedJob) this.setData({ selectedJob, showList: false });
  },

  selectFromList(event) {
    this.selectMarker(event);
  },

  toggleList() {
    this.setData({ showList: !this.data.showList });
  },

  resetLocation() {
    const nearby = this.data.visibleJobs[0] || this.data.jobs[0] || JOBS[0];
    this.setData({ selectedJob: nearby, showList: false });
    wx.showToast({ title: "已定位到深圳南山区", icon: "none" });
  },

  openDetail() {
    if (!this.data.selectedJob) return;
    wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${this.data.selectedJob.id}` });
  }
});
