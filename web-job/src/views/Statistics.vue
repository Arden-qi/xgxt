<script setup lang="ts">
/**
 * 数据统计
 *
 * 脑图五个指标：就业人数 / 获得offer / 就业率 / 平均投简历数 / kpi
 *
 * ⚠️ 图表是手写 SVG + CSS，没有引入 echarts —— 交付包不用多装依赖也能跑。
 */

import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Refresh, EditPen } from '@element-plus/icons-vue';
import {
  fetchOverview,
  fetchTrend,
  fetchStatusDistribution,
  fetchClassTop,
  fetchKpiTarget,
  saveKpiTarget,
} from '@/api/statistics';

const loading = ref(false);
const router = useRouter();

/**
 * ★ 2026-10-02（斌哥反馈"offer 数没地方填"）：
 * offer 数不是单独录入的，而是「复盘填写」里把「面试结论」选成"已发 offer"累计出来的。
 * 这里给个直达入口，省得老师自己找。
 */
function goFillOffer(): void {
  router.push('/review-write');
}

const overview = ref<any>({});
const trend = ref<any[]>([]);
const statusData = ref<any[]>([]);
const classTop = ref<any[]>([]);

async function loadAll() {
  loading.value = true;
  try {
    const [o, t, s, c] = await Promise.all([
      fetchOverview(),
      fetchTrend(6),
      fetchStatusDistribution(),
      fetchClassTop(8),
    ]);
    overview.value = o;
    trend.value = t;
    statusData.value = s;
    classTop.value = c;
  } catch (e) {
    console.error('加载统计数据失败', e);
  } finally {
    loading.value = false;
  }
}

/* ============ KPI 目标设置 ============ */

const kpiDialogVisible = ref(false);
const kpiSubmitting = ref(false);
const kpiFormRef = ref<FormInstance>();

const kpiForm = reactive({
  targetRate: 85,
  targetOffer: 60,
  targetResume: 20,
});

const kpiRules: FormRules = {
  targetRate: [{ required: true, message: '请输入目标就业率', trigger: 'blur' }],
  targetOffer: [{ required: true, message: '请输入目标 offer 数', trigger: 'blur' }],
  targetResume: [{ required: true, message: '请输入目标人均投递数', trigger: 'blur' }],
};

async function openKpiDialog() {
  try {
    const data = await fetchKpiTarget();
    kpiForm.targetRate = data.targetRate;
    kpiForm.targetOffer = data.targetOffer;
    kpiForm.targetResume = data.targetResume;
    kpiDialogVisible.value = true;
  } catch (e) {
    // 统一处理
  }
}

async function submitKpi() {
  const valid = await kpiFormRef.value?.validate().catch(() => false);
  if (!valid) return;

  kpiSubmitting.value = true;
  try {
    await saveKpiTarget({ ...kpiForm });
    ElMessage.success('KPI 目标已保存');
    kpiDialogVisible.value = false;
    loadAll();
  } catch (e) {
    // 统一处理
  } finally {
    kpiSubmitting.value = false;
  }
}

/* ============ 环形图（学生状态分布） ============ */

const DONUT_R = 60;
const DONUT_STROKE = 22;
const DONUT_C = 2 * Math.PI * DONUT_R;

const donutTotal = computed(() => statusData.value.reduce((sum, i) => sum + i.value, 0));

const DONUT_COLORS = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399'];

/** 每个扇区的起止长度（stroke-dasharray / dashoffset 用） */
const donutSegments = computed(() => {
  const total = donutTotal.value;
  if (!total) return [];
  let acc = 0;
  return statusData.value.map((item, idx) => {
    const len = (item.value / total) * DONUT_C;
    const seg = {
      ...item,
      color: DONUT_COLORS[idx % DONUT_COLORS.length],
      dash: `${len} ${DONUT_C - len}`,
      offset: -acc,
      percent: Math.round((item.value / total) * 100),
    };
    acc += len;
    return seg;
  });
});

/* ============ 柱状 + 折线（月度趋势） ============ */

const CHART_W = 700;
const CHART_H = 260;
const CHART_PAD_L = 46;
const CHART_PAD_R = 16;
const CHART_PAD_T = 20;
const CHART_PAD_B = 34;

const maxResume = computed(() => Math.max(1, ...trend.value.map((i) => i.resume)));
const maxEmployed = computed(() => Math.max(1, ...trend.value.map((i) => i.employed)));

const plotW = CHART_W - CHART_PAD_L - CHART_PAD_R;
const plotH = CHART_H - CHART_PAD_T - CHART_PAD_B;

const bars = computed(() => {
  const n = trend.value.length;
  if (!n) return [];
  const slot = plotW / n;
  const barW = Math.min(28, slot * 0.5);
  return trend.value.map((item, i) => {
    const h = Math.max(2, (item.resume / maxResume.value) * plotH);
    return {
      ...item,
      x: CHART_PAD_L + slot * i + (slot - barW) / 2,
      y: CHART_PAD_T + plotH - h,
      w: barW,
      h,
      cx: CHART_PAD_L + slot * i + slot / 2,
      labelX: CHART_PAD_L + slot * i + slot / 2,
    };
  });
});

const linePoints = computed(() =>
  bars.value
    .map((b) => {
      const y = CHART_PAD_T + plotH - (b.employed / maxEmployed.value) * plotH;
      return `${b.cx},${y}`;
    })
    .join(' '),
);

const lineDots = computed(() =>
  bars.value.map((b) => {
    const y = CHART_PAD_T + plotH - (b.employed / maxEmployed.value) * plotH;
    return { x: b.cx, y, employed: b.employed };
  }),
);

const gridCount = 4;
const gridLines = computed(() =>
  Array.from({ length: gridCount + 1 }, (_, i) => {
    const y = CHART_PAD_T + (plotH / gridCount) * i;
    return {
      y,
      label: Math.round((maxResume.value / gridCount) * (gridCount - i)),
    };
  }),
);

/* ============ 横向条形（班级 TOP） ============ */

function maxOf(list: any[]) {
  return Math.max(1, ...list.map((i) => i.value));
}

const classMax = computed(() => maxOf(classTop.value));

function progressColor(p: number) {
  return p >= 100 ? '#67c23a' : p >= 60 ? '#409eff' : '#e6a23c';
}

onMounted(loadAll);
</script>

<template>
  <div class="page-container" v-loading="loading">
    <!-- ============ 五大指标卡片 ============ -->
    <el-row :gutter="12" class="metric-row">
      <el-col :span="4">
        <div class="metric-card">
          <div class="metric-label">就业人数</div>
          <div class="metric-value">{{ overview.employedCount ?? 0 }}</div>
          <div class="metric-sub">待就业 {{ overview.waitingCount ?? 0 }} 人</div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="metric-card">
          <div class="metric-label">获得 offer</div>
          <div class="metric-value">{{ overview.offerCount ?? 0 }}</div>
          <div class="metric-sub">覆盖 {{ overview.offerStudentCount ?? 0 }} 名学生</div>
          <!-- ★ 2026-10-02（斌哥反馈"offer 数没有地方填写"）：
               这个数的来源很隐蔽 —— 它 = 复盘记录里「面试结论」选了"已发 offer"的条数。
               这里直接把来源写在卡片上，并给一个能点过去的入口。 -->
          <el-button
            link
            type="primary"
            size="small"
            class="metric-link"
            @click="goFillOffer"
          >
            去填写 ›
          </el-button>
          <div class="metric-note">统计口径：复盘记录中「面试结论 = 已发 offer」的条数</div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="metric-card">
          <div class="metric-label">就业率</div>
          <div class="metric-value">{{ overview.employmentRate ?? 0 }}%</div>
          <el-progress
            :percentage="Math.min(100, overview.employmentRate ?? 0)"
            :stroke-width="6"
            :show-text="false"
            class="metric-bar"
          />
        </div>
      </el-col>
      <el-col :span="4">
        <div class="metric-card">
          <div class="metric-label">平均投简历数</div>
          <div class="metric-value">{{ overview.avgResumeCount ?? 0 }}</div>
          <div class="metric-sub">累计投递 {{ overview.totalResumeCount ?? 0 }} 份</div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="metric-card">
          <div class="metric-label">累计面试场次</div>
          <div class="metric-value">{{ overview.totalInterviewCount ?? 0 }}</div>
          <div class="metric-sub">近半年趋势见下方图表</div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="metric-card kpi-card">
          <div class="metric-label">KPI 综合完成率</div>
          <div class="metric-value kpi-value">{{ overview.kpi?.overallCompletion ?? 0 }}%</div>
          <el-progress
            :percentage="Math.min(100, overview.kpi?.overallCompletion ?? 0)"
            :stroke-width="6"
            :show-text="false"
            :color="progressColor(overview.kpi?.overallCompletion ?? 0)"
            class="metric-bar"
          />
        </div>
      </el-col>
    </el-row>

    <!-- ============ KPI 达成 ============ -->
    <el-card shadow="never" class="card">
      <template #header>
        <div class="card-header">
          <span class="card-title">KPI 达成情况</span>
          <div class="card-actions">
            <el-button type="primary" :icon="EditPen" size="small" @click="openKpiDialog">设置目标</el-button>
            <el-button :icon="Refresh" size="small" @click="loadAll">刷新</el-button>
          </div>
        </div>
      </template>

      <el-row :gutter="16">
        <el-col :span="8">
          <div class="kpi-item">
            <div class="kpi-head">
              <span>就业率</span>
              <span class="kpi-num">
                {{ overview.kpi?.actualRate ?? 0 }}% / 目标 {{ overview.kpi?.target?.targetRate ?? 0 }}%
              </span>
            </div>
            <el-progress
              :percentage="Math.min(100, overview.kpi?.rateCompletion ?? 0)"
              :color="progressColor(overview.kpi?.rateCompletion ?? 0)"
              :stroke-width="14"
            />
          </div>
        </el-col>
        <el-col :span="8">
          <div class="kpi-item">
            <div class="kpi-head">
              <span>获得 offer</span>
              <span class="kpi-num">
                {{ overview.kpi?.actualOffer ?? 0 }} / 目标 {{ overview.kpi?.target?.targetOffer ?? 0 }}
              </span>
            </div>
            <el-progress
              :percentage="Math.min(100, overview.kpi?.offerCompletion ?? 0)"
              :color="progressColor(overview.kpi?.offerCompletion ?? 0)"
              :stroke-width="14"
            />
            <div class="kpi-note">
              在「复盘填写」里把「面试结论」选为"已发 offer" 即计入
            </div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="kpi-item">
            <div class="kpi-head">
              <span>人均投递简历</span>
              <span class="kpi-num">
                {{ overview.kpi?.actualResume ?? 0 }} / 目标 {{ overview.kpi?.target?.targetResume ?? 0 }}
              </span>
            </div>
            <el-progress
              :percentage="Math.min(100, overview.kpi?.resumeCompletion ?? 0)"
              :color="progressColor(overview.kpi?.resumeCompletion ?? 0)"
              :stroke-width="14"
            />
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- ============ 月度趋势 ============ -->
    <el-card shadow="never" class="card">
      <template #header>
        <span class="card-title">近 6 个月就业趋势</span>
      </template>

      <div v-if="trend.length" class="legend">
        <span class="legend-item"><i class="legend-box" />投递简历数</span>
        <span class="legend-item"><i class="legend-line" />当月新增就业人数</span>
      </div>

      <svg v-if="trend.length" :viewBox="`0 0 ${CHART_W} ${CHART_H}`" class="chart">
        <!-- 网格与刻度 -->
        <g v-for="g in gridLines" :key="g.y">
          <line
            :x1="CHART_PAD_L"
            :y1="g.y"
            :x2="CHART_W - CHART_PAD_R"
            :y2="g.y"
            stroke="#ebeef5"
            stroke-width="1"
          />
          <text :x="CHART_PAD_L - 8" :y="g.y + 4" text-anchor="end" font-size="11" fill="#909399">
            {{ g.label }}
          </text>
        </g>

        <!-- 柱状：投递简历数 -->
        <g v-for="b in bars" :key="b.month">
          <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="3" fill="#409eff" />
          <text :x="b.labelX" :y="b.y - 6" text-anchor="middle" font-size="11" fill="#606266">
            {{ b.resume }}
          </text>
          <text :x="b.labelX" :y="CHART_H - 12" text-anchor="middle" font-size="11" fill="#909399">
            {{ b.month }}
          </text>
        </g>

        <!-- 折线：新增就业人数 -->
        <polyline :points="linePoints" fill="none" stroke="#67c23a" stroke-width="2" />
        <g v-for="d in lineDots" :key="d.x">
          <circle :cx="d.x" :cy="d.y" r="4" fill="#fff" stroke="#67c23a" stroke-width="2" />
        </g>
      </svg>
      <el-empty v-else description="暂无趋势数据" :image-size="80" />
    </el-card>

    <el-row :gutter="12">
      <!-- ============ 状态分布 ============ -->
      <el-col :span="10">
        <el-card shadow="never" class="card">
          <template #header>
            <span class="card-title">学生状态分布</span>
          </template>
          <div v-if="donutSegments.length" class="donut-wrap">
            <svg viewBox="0 0 200 200" class="donut">
              <circle cx="100" cy="100" :r="DONUT_R" fill="none" stroke="#f5f7fa" :stroke-width="DONUT_STROKE" />
              <g transform="rotate(-90 100 100)">
                <circle
                  v-for="s in donutSegments"
                  :key="s.name"
                  cx="100"
                  cy="100"
                  :r="DONUT_R"
                  fill="none"
                  :stroke="s.color"
                  :stroke-width="DONUT_STROKE"
                  :stroke-dasharray="s.dash"
                  :stroke-dashoffset="s.offset"
                />
              </g>
              <text x="100" y="95" text-anchor="middle" font-size="24" fill="#303133">{{ donutTotal }}</text>
              <text x="100" y="115" text-anchor="middle" font-size="12" fill="#909399">学生总数</text>
            </svg>
            <div class="donut-legend">
              <div v-for="s in donutSegments" :key="s.name" class="donut-legend-item">
                <i :style="{ background: s.color }" />
                <span class="dl-name">{{ s.name }}</span>
                <span class="dl-value">{{ s.value }}</span>
                <span class="dl-percent">{{ s.percent }}%</span>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无数据" :image-size="80" />
        </el-card>
      </el-col>

      <!-- ============ 班级就业人数 TOP ============ -->
      <el-col :span="14">
        <el-card shadow="never" class="card">
          <template #header>
            <span class="card-title">班级就业人数 TOP</span>
          </template>
          <div v-if="classTop.length" class="bar-list">
            <div v-for="c in classTop" :key="c.name" class="bar-item">
              <span class="bar-name">{{ c.name }}</span>
              <div class="bar-track">
                <div class="bar-fill green" :style="{ width: `${(c.value / classMax) * 100}%` }" />
              </div>
              <span class="bar-value">{{ c.value }} 人</span>
            </div>
          </div>
          <el-empty v-else description="暂无班级就业数据" :image-size="60" />
        </el-card>
      </el-col>
    </el-row>

    <!-- ============ KPI 目标设置 ============ -->
    <el-dialog v-model="kpiDialogVisible" title="设置 KPI 目标" width="440px">
      <el-form ref="kpiFormRef" :model="kpiForm" :rules="kpiRules" label-width="150px">
        <el-form-item label="目标就业率（%）">
          <el-input-number v-model="kpiForm.targetRate" :min="0" :max="100" :step="1" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="目标 offer 数">
          <el-input-number v-model="kpiForm.targetOffer" :min="0" :max="99999" :step="5" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="目标人均投递">
          <el-input-number v-model="kpiForm.targetResume" :min="0" :max="9999" :step="1" controls-position="right" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="kpiDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="kpiSubmitting" @click="submitKpi">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-container {
  padding: 16px;
}

.metric-row {
  margin-bottom: 12px;
}

.metric-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 14px 16px;
  height: 100%;
}

.kpi-card {
  border-color: #409eff;
}

.metric-label {
  font-size: 13px;
  color: #909399;
}

.metric-value {
  font-size: 26px;
  font-weight: 600;
  color: #303133;
  margin: 6px 0;
  line-height: 1.2;
}

.kpi-value {
  color: #409eff;
}

.metric-sub {
  font-size: 12px;
  color: #a8abb2;
}

/* 「获得 offer」卡片的「去填写」入口与口径说明（2026-10-02 新增） */
.metric-link {
  margin-top: 4px;
  padding: 0;
  height: auto;
  font-size: 12px;
}
.metric-note {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.5;
  color: #b6bac2;
}

/* KPI 达成情况里的小字说明 */
.kpi-note {
  margin-top: 6px;
  font-size: 11.5px;
  color: #a8abb2;
}

.metric-bar {
  margin-top: 6px;
}

.card {
  margin-bottom: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
}

.legend {
  display: flex;
  gap: 20px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #606266;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-box {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: #409eff;
  display: inline-block;
}

.legend-line {
  width: 16px;
  height: 3px;
  background: #67c23a;
  display: inline-block;
}

.chart {
  width: 100%;
  height: auto;
}

.kpi-item {
  padding: 4px 0;
}

.kpi-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #606266;
  margin-bottom: 8px;
}

.kpi-num {
  color: #303133;
}

.donut-wrap {
  display: flex;
  align-items: center;
  gap: 20px;
}

.donut {
  width: 190px;
  height: 190px;
  flex-shrink: 0;
}

.donut-legend {
  flex: 1;
}

.donut-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 13px;
}

.donut-legend-item i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
}

.dl-name {
  color: #606266;
  min-width: 60px;
}

.dl-value {
  color: #303133;
  font-weight: 600;
}

.dl-percent {
  color: #a8abb2;
  margin-left: auto;
}

.bar-list {
  padding: 4px 0;
}

.bar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
}

.bar-name {
  width: 90px;
  font-size: 13px;
  color: #606266;
  flex-shrink: 0;
}

.bar-track {
  flex: 1;
  height: 12px;
  background: #f5f7fa;
  border-radius: 6px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: #409eff;
  border-radius: 6px;
  transition: width 0.3s;
}

.bar-fill.green {
  background: #67c23a;
}

.bar-value {
  width: 60px;
  text-align: right;
  font-size: 13px;
  color: #303133;
  flex-shrink: 0;
}
</style>
