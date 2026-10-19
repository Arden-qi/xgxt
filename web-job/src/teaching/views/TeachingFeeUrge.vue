<template>
  <div class="tfu">
    <!-- 筛选：选完即查（与教学域其它统一页同一纪律） -->
    <el-form class="tfu-filter" inline>
      <el-form-item label="部门">
        <el-select v-model="query.dept" clearable placeholder="全部部门" style="width: 130px" @change="applyFilter">
          <el-option v-for="d in deptOptions" :key="d.code" :label="d.name" :value="d.code" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="query.keyword"
          placeholder="学生姓名 / 学号"
          clearable
          style="width: 180px"
          @keyup.enter="applyFilter"
          @clear="applyFilter"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="applyFilter">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </el-form-item>
    </el-form>

    <div v-if="skipped.length" class="tfu-skip muted">
      以下部门无权限或加载失败，未包含在本列表：{{ skipped.join('、') }}
    </div>

    <el-table v-loading="loading" :data="paged" border stripe size="small" empty-text="暂无催费数据">
      <el-table-column label="部门" width="80" align="center">
        <template #default="{ row }">{{ row.dept }}</template>
      </el-table-column>
      <el-table-column label="学生" min-width="150">
        <template #default="{ row }">
          {{ row.studentName }} <span class="muted">{{ row.studentNo }}</span>
        </template>
      </el-table-column>
      <el-table-column label="班级" min-width="110">
        <template #default="{ row }">{{ row.className || '—' }}</template>
      </el-table-column>
      <el-table-column label="费用类型" min-width="100">
        <template #default="{ row }">{{ row.feeTypeName || '—' }}</template>
      </el-table-column>
      <el-table-column label="金额" width="110" align="right">
        <template #default="{ row }">
          <b>¥{{ row.amountText }}</b>
        </template>
      </el-table-column>
      <el-table-column label="应缴日期" width="105" align="center">
        <template #default="{ row }">{{ row.dueDate || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">{{ row.statusName || '—' }}</template>
      </el-table-column>
      <el-table-column label="催缴" min-width="160">
        <template #default="{ row }">
          <span class="muted">{{ row.urgeHint || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" align="center" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openLogs(row)">催缴记录</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="tfu-page"
      :current-page="page"
      :page-size="pageSize"
      :total="filtered.length"
      layout="total, prev, pager, next"
      @current-change="(p: number) => (page = p)"
    />

    <!-- 催缴记录弹窗：三个部门的记录形态不同，按 dept 分别渲染 -->
    <el-dialog v-model="logVisible" :title="logTitle" width="680px">
      <template v-if="logRow">
        <!-- 初高：催费推送/记录列表 -->
        <el-table
          v-if="logRow.deptCode === 'jh'"
          v-loading="logLoading"
          :data="logRows"
          size="small"
          border
          empty-text="暂无催费记录"
        >
          <el-table-column label="渠道" width="110">
            <template #default="{ row }">{{ row.shareChannelName || '—' }}</template>
          </el-table-column>
          <el-table-column label="经办人" width="110">
            <template #default="{ row }">{{ row.notifyUserName || '—' }}</template>
          </el-table-column>
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ row.notifyTime || '—' }}</template>
          </el-table-column>
          <el-table-column label="备注" min-width="140">
            <template #default="{ row }">{{ row.remark || '—' }}</template>
          </el-table-column>
        </el-table>

        <!-- 大学：催缴日志列表 -->
        <el-table
          v-else-if="logRow.deptCode === 'class'"
          v-loading="logLoading"
          :data="logRows"
          size="small"
          border
          empty-text="暂无催缴记录"
        >
          <el-table-column label="渠道" width="110">
            <template #default="{ row }">{{ row.channelName || row.channel || '—' }}</template>
          </el-table-column>
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ row.urgeTime || row.createTime || '—' }}</template>
          </el-table-column>
          <el-table-column label="备注" min-width="140">
            <template #default="{ row }">{{ row.remark || '—' }}</template>
          </el-table-column>
        </el-table>

        <!-- 就业（实训催费单）：单据上的回填信息 -->
        <el-descriptions v-else :column="1" border size="small">
          <el-descriptions-item label="费用说明">{{ logRow.raw?.callReason || '—' }}</el-descriptions-item>
          <el-descriptions-item label="催缴状态">{{ logRow.raw?.callStatusName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="回填时间">{{ logRow.raw?.handleTime || '—' }}</el-descriptions-item>
          <el-descriptions-item label="回填备注">{{ logRow.raw?.handleRemark || '—' }}</el-descriptions-item>
          <el-descriptions-item label="班主任">{{ logRow.raw?.headTeacherName || '—' }}</el-descriptions-item>
        </el-descriptions>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 催费 · 跨部门聚合页（2026-10-19 域重组新增）
 * ============================================================
 * 【背景】原「催费/缴费」域是四个学段页签（初高缴费台账 / 大学催缴 /
 *   实训催费单 / 教务缴费总记录）。重组后：
 *     · 「催费」= 本页：聚合 初高缴费台账催费侧 + 大学催缴记录 + 就业催费单
 *       （实训与就业共用 sms_job 库，催费单即就业部门的催费数据），带部门列与部门筛选；
 *     · 「缴费」= 教务缴费总记录（PaymentList 原样，见 TeachingFeeHub）。
 *
 * 【聚合口径】
 *   · 直接复用三个部门的**现有接口**（/api/class-jh/fee/list、/api/class/urge/list、
 *     /api/job/fee-call/page），前端映射成统一行后合并——后端零改动；
 *   · 每部门取前 100 条（初高接口 size 上限更小，100 实测可用）（催费单量级远小于此），合并后前端分页；
 *   · 某部门接口 403/失败 → 该部门跳过并提示，不出现在部门筛选里
 *     （与 TeachingRefund 多学段「没权限的学段跳过」同一口径）；
 *   · 排序：应缴日期倒序（空日期排最后）。
 *
 * 【公共核心列】部门 / 学生 / 班级 / 费用类型 / 金额 / 应缴日期 / 状态 / 催缴 / 操作。
 *   部门内特有字段（初高紧急度、大学逾期天数、就业回填备注）在「催缴」列与记录弹窗里。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { http } from '@/api/request';
import { ElMessage } from 'element-plus';

interface UrgeUnifiedRow {
  key: string;
  dept: string;
  deptCode: 'jh' | 'class' | 'employ';
  studentName: string;
  studentNo: string;
  className: string | null;
  feeTypeName: string;
  amountText: string;
  dueDate: string;
  statusName: string;
  urgeHint: string;
  raw: any;
}

const loading = ref(false);
const allRows = ref<UrgeUnifiedRow[]>([]);
/** 加载失败/无权限的部门名（提示用） */
const skipped = ref<string[]>([]);
const page = ref(1);
const pageSize = 20;

const query = reactive({
  dept: undefined as string | undefined,
  keyword: '' as string,
});

/** 部门口径（与学籍异动 LEAVE_DEPARTMENTS 一致：就业映射 job 库催费单） */
const DEPTS = [
  { code: 'jh', name: '初高' },
  { code: 'class', name: '大学' },
  { code: 'employ', name: '就业' },
] as const;

/** 加载成功（有权限）的部门 → 部门筛选选项 */
const deptOptions = computed(() => DEPTS.filter((d) => !skipped.value.includes(d.name)));

const filtered = computed(() => {
  let rows = allRows.value;
  if (query.dept) rows = rows.filter((r) => r.deptCode === query.dept);
  return rows;
});

const paged = computed(() => {
  const start = (page.value - 1) * pageSize;
  return filtered.value.slice(start, start + pageSize);
});

/** 金额（分）→ 1,234.00 */
function fenToText(fen: number | null | undefined): string {
  const n = Number(fen || 0) / 100;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
}

/** 只保留日期部分 */
function datePart(s: string | null | undefined): string {
  return s ? String(s).slice(0, 10) : '';
}

async function fetchDept(dept: (typeof DEPTS)[number], keyword: string): Promise<UrgeUnifiedRow[]> {
  const kw = keyword || undefined;
  if (dept.code === 'jh') {
    const res = await http.get<any>('/api/class-jh/fee/list', { page: 1, size: 100, keyword: kw });
    return (res?.list || []).map((r: any) => ({
      key: `jh:${r.feeId}`,
      dept: dept.name,
      deptCode: dept.code,
      studentName: r.studentName || '',
      studentNo: r.studentNo || '',
      className: r.className || null,
      feeTypeName: r.feeTypeName || '',
      amountText: fenToText(r.feeAmount),
      dueDate: datePart(r.expireDate),
      statusName: r.payStatusName || '',
      urgeHint:
        [r.isUrgent ? '紧急' : null, r.remainDays != null ? `剩余 ${r.remainDays} 天` : null]
          .filter(Boolean)
          .join(' · ') || '',
      raw: r,
    }));
  }
  if (dept.code === 'class') {
    const res = await http.get<any>('/api/class/urge/list', { page: 1, size: 100, keyword: kw });
    return (res?.list || []).map((r: any) => ({
      key: `class:${r.id}`,
      dept: dept.name,
      deptCode: dept.code,
      studentName: r.studentName || '',
      studentNo: r.studentNo || '',
      className: r.className || null,
      feeTypeName: r.feeTypeName || '',
      amountText: r.amountYuan || fenToText(r.amount),
      dueDate: datePart(r.expireDate),
      statusName: r.payStatusName || '',
      urgeHint:
        [
          r.isOverdue ? '已逾期' : null,
          r.urgeCount ? `已催 ${r.urgeCount} 次` : null,
          r.lastUrgeTime ? `最近 ${datePart(r.lastUrgeTime)}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || '',
      raw: r,
    }));
  }
  const res = await http.get<any>('/api/job/fee-call/page', { page: 1, size: 100, keyword: kw });
  return (res?.list || []).map((r: any) => ({
    key: `employ:${r.id}`,
    dept: dept.name,
    deptCode: dept.code,
    studentName: r.studentName || '',
    studentNo: r.studentNo || '',
    className: r.className || null,
    feeTypeName: r.feeTypeName || '',
    amountText: r.feeAmountText || fenToText(r.feeAmount),
    dueDate: datePart(r.dueDate),
    statusName: r.callStatusName || '',
    urgeHint:
      [
        r.overdue ? '已逾期' : null,
        r.handleTime ? `回填 ${datePart(r.handleTime)}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || '',
    raw: r,
  }));
}

async function load() {
  loading.value = true;
  skipped.value = [];
  try {
    const results = await Promise.allSettled(
      DEPTS.map((d) => fetchDept(d, query.keyword)),
    );
    const rows: UrgeUnifiedRow[] = [];
    const fail: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') rows.push(...r.value);
      else fail.push(DEPTS[i].name);
    });
    // 应缴日期倒序；空日期排最后
    rows.sort((a, b) => (b.dueDate || '0000').localeCompare(a.dueDate || '0000'));
    allRows.value = rows;
    skipped.value = fail;
    page.value = 1;
  } finally {
    loading.value = false;
  }
}

function applyFilter() {
  // 关键字变了要重新拉三个源（后端各自过滤）；仅切部门时本地过滤即可，但统一重查口径最简单
  load();
}

function reset() {
  query.dept = undefined;
  query.keyword = '';
  load();
}

/* ---------------- 催缴记录弹窗 ---------------- */

const logVisible = ref(false);
const logLoading = ref(false);
const logRow = ref<UrgeUnifiedRow | null>(null);
const logRows = ref<any[]>([]);
const logTitle = computed(() => `催缴记录 · ${logRow.value?.dept || ''} ${logRow.value?.studentName || ''}`);

async function openLogs(row: UrgeUnifiedRow) {
  logRow.value = row;
  logVisible.value = true;
  logRows.value = [];
  if (row.deptCode === 'employ') return; // 就业：回填信息就在单据上，无需另查
  logLoading.value = true;
  try {
    if (row.deptCode === 'jh') {
      const res = await http.get<any>('/api/class-jh/fee/notify/list', {
        page: 1,
        size: 50,
        studentId: row.raw?.studentId,
      });
      logRows.value = res?.list || [];
    } else {
      const res = await http.get<any>('/api/class/urge/log/list', {
        page: 1,
        size: 50,
        studentId: row.raw?.studentId,
      });
      logRows.value = res?.list || [];
    }
  } catch {
    ElMessage.error('催缴记录加载失败');
  } finally {
    logLoading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.tfu {
  padding: 12px;
}
.tfu-filter {
  margin-bottom: 8px;
}
.tfu-skip {
  margin-bottom: 8px;
}
.tfu-page {
  margin-top: 10px;
  justify-content: flex-end;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
