const api = require("../../utils/api");
const locationPermission = require("../../utils/location-permission");

Page({
  data: {
    loading: true,
    error: "",
    fallbackMode: false,
    fallbackReason: "",
    locationPermissionDenied: false,
    query: "",
    districts: ["全部区域", "南山区", "福田区", "宝安区", "龙华区", "罗湖区"],
    districtIndex: 0,
    latitude: 0,
    longitude: 0,
    jobs: [],
    visibleJobs: [],
    markers: [],
    selectedJob: null,
    showList: false
  },

  onShow() {
    this.loadNearby();
  },

  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({ type: "gcj02", isHighAccuracy: true, success: resolve, fail: reject });
    });
  },

  async loadNearby() {
    const requestId = (this._nearbyLoadRequestId || 0) + 1;
    this._nearbyLoadRequestId = requestId;
    const activeRole = api.getActiveRole();
    const isCurrentRequest = () => this._nearbyLoadRequestId === requestId && api.getActiveRole() === activeRole;
    this.setData({ loading: true, error: "", showList: false });
    try {
      await getApp().ensureAuth();
      const type = activeRole === "TEACHER" ? "TEACHING_NEED" : "TEACHER_OFFER";
      let location = null;
      try {
        location = await this.getLocation();
      } catch (locationError) {
        const permissionState = await locationPermission.getLocationPermissionState(locationError);
        const result = await api.listAllJobs({ type });
        const jobs = this.normalizeJobs(result);
        const districts = this.buildDistricts(jobs);
        if (!isCurrentRequest()) return false;
        this.setData({
          fallbackMode: true,
          fallbackReason: permissionState.denied
            ? "定位权限尚未开启，已切换为地区筛选与关键词搜索；不会使用虚拟坐标。"
            : "暂时无法取得当前位置，已切换为地区筛选与关键词搜索；不会使用虚拟坐标。",
          locationPermissionDenied: permissionState.denied,
          districts,
          districtIndex: 0,
          jobs,
          visibleJobs: jobs,
          selectedJob: jobs[0] || null,
          markers: [],
          loading: false
        });
        return true;
      }
      const result = await api.nearbyJobs({ latitude: location.latitude, longitude: location.longitude, radiusKm: 50, type });
      const jobs = this.normalizeJobs(result);
      const districts = this.buildDistricts(jobs);
      if (!isCurrentRequest()) return false;
      this.setData({
        fallbackMode: false,
        fallbackReason: "",
        locationPermissionDenied: false,
        districts,
        districtIndex: 0,
        latitude: location.latitude,
        longitude: location.longitude,
        jobs,
        visibleJobs: jobs,
        selectedJob: jobs[0] || null,
        markers: this.buildMarkers(jobs),
        loading: false
      });
      return true;
    } catch (error) {
      if (!isCurrentRequest()) return false;
      this.setData({ loading: false, error: error.message || "地图数据加载失败", jobs: [], visibleJobs: [], markers: [], selectedJob: null });
      return false;
    }
  },

  buildMarkers(jobs) {
    return jobs.filter((job) => Number.isFinite(Number(job.latitude)) && Number.isFinite(Number(job.longitude))).map((job, index) => ({
      id: index + 1,
      jobId: job.id,
      latitude: Number(job.latitude),
      longitude: Number(job.longitude),
      width: 28,
      height: 36,
      callout: {
        content: `¥${job.price}${job.unit}`,
        color: "#1f58b4",
        fontSize: 13,
        borderRadius: 8,
        bgColor: "#ffffff",
        padding: 7,
        display: "ALWAYS"
      }
    }));
  },

  normalizeJobs(response) {
    const payload = response && response.data !== undefined ? response.data : response;
    const items = Array.isArray(payload)
      ? payload
      : payload && Array.isArray(payload.items)
        ? payload.items
        : null;
    if (!items) throw new Error("附近信息数据格式异常，请重新加载");
    return items.map(api.normalizeJob).filter(Boolean);
  },

  buildDistricts(jobs) {
    const values = (jobs || [])
      .map((job) => String(job && job.district || "").trim())
      .filter(Boolean);
    return ["全部区域"].concat(Array.from(new Set(values)));
  },

  retry() { this.loadNearby(); },

  handleSearch(event) {
    this.setData({ query: event.detail.value }, () => this.filterJobs());
  },

  clearSearch() {
    this.setData({ query: "" }, () => this.filterJobs());
  },

  resetFilters() {
    this.setData({ query: "", districtIndex: 0 }, () => this.filterJobs());
  },

  changeDistrict(event) {
    this.setData({ districtIndex: Number(event.detail.value) }, () => this.filterJobs());
  },

  filterJobs() {
    const keyword = this.data.query.trim().toLowerCase();
    const district = this.data.districts[this.data.districtIndex];
    const visibleJobs = this.data.jobs.filter((job) => {
      const search = [job.title, job.subject, job.area, job.district].filter(Boolean).join("").toLowerCase();
      return (!keyword || search.includes(keyword)) && (district === "全部区域" || job.district === district);
    });
    const selectedJob = this.data.selectedJob && visibleJobs.some((job) => job.id === this.data.selectedJob.id)
      ? this.data.selectedJob
      : visibleJobs[0] || null;
    this.setData({ visibleJobs, selectedJob, markers: this.data.fallbackMode ? [] : this.buildMarkers(visibleJobs) });
  },

  selectMarker(event) {
    const markerId = event.detail && event.detail.markerId !== undefined
      ? Number(event.detail.markerId)
      : Number(event.currentTarget.dataset.markerId);
    const marker = this.data.markers.find((item) => item.id === markerId);
    const selectedJob = marker && this.data.jobs.find((job) => job.id === marker.jobId);
    if (selectedJob) this.setData({ selectedJob, showList: false });
  },

  selectFromList(event) {
    const selectedJob = this.data.jobs.find((job) => job.id === event.currentTarget.dataset.id);
    if (selectedJob) this.setData({ selectedJob, showList: false });
  },

  toggleList() { this.setData({ showList: !this.data.showList }); },
  resetLocation() { this.loadNearby(); },
  openLocationSetting() {
    locationPermission.openLocationSetting(() => this.loadNearby());
  },
  openDetail(event) {
    const id = event && event.currentTarget.dataset.id ? event.currentTarget.dataset.id : this.data.selectedJob && this.data.selectedJob.id;
    if (id) wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${id}` });
  }
});
