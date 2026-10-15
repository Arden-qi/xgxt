<template>
  <div class="tlv">
    <el-alert class="tlv-chain" type="info" :closable="false" show-icon>
      <template #title>
        本模块审批链（三学段统一）：
        <b>休学 1 步（学管）· 复学 1 步（学管）· 退学 2 步（学管 → 校长）</b>
      </template>
    </el-alert>

    <!-- 汇总 -->
    <div class="tlv-cards">
      <div v-for="s in summaries" :key="s.stage" class="tlv-card">
        <div class="tlv-card__head">{{ s.stageName }}</div>
        <div class="tlv-card__row">
          <span>共 <b>{{ s.total }}</b> 单</span>
          <span>休学 <b>{{ s.suspendCount }}</b></span>
          <span>退学 <b>{{ s.quitCount }}</b></span>
          <span v-if="bizAllowed(s.stage, 3)">复学 <b>{{ s.resumeCount }}</b></span>
        </div>
        <div class="tlv-card__row">
          <span class="warn">审批中 <b>{{ s.pendingCount }}</b></span>
          <span class="ok">已通过 <b>{{ s.approvedCount }}</b></span>
        </div>
      </div>
      <el-empty v-if="!summaries.length" description="当前账号没有可访问的学段" :image-size="60" />
    </div>

    <!-- 筛选 -->
    <!--
      ★ 所有筛选项都是「选完即查」（@change → load(1)），不用再点一次「查询」。
        本项目其它列表页确实有「选完必须点查询」的惯例，但用户在这个模块
        明确要求「所有筛选要生效」——选完不动、必须再点按钮，在用户视角
        就是「筛选没生效」。改下拉一定带上 load(1)，新加筛选项也一样。
    -->
    <el-form class="tlv-filter" inline>
      <el-form-item label="学段">
        <el-select
          v-model="query.stage"
          clearable
          placeholder="全部学段"
          style="width: 130px"
          @change="onFilterStageChange"
        >
          <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="类型">
        <el-select
          v-model="query.bizType"
          clearable
          placeholder="全部"
          style="width: 110px"
          @change="load(1)"
        >
          <el-option
            v-for="(n, v) in LEAVE_BIZ_NAME"
            :key="v"
            :label="n"
            :value="Number(v)"
            :disabled="query.stage ? !bizAllowed(query.stage, Number(v)) : false"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select
          v-model="query.status"
          clearable
          placeholder="全部"
          style="width: 140px"
          @change="load(1)"
        >
          <el-option v-for="(n, v) in LEAVE_STATUS_NAME" :key="v" :label="n" :value="Number(v)" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="query.keyword"
          placeholder="学生姓名 / 学号"
          clearable
          style="width: 170px"
          @keyup.enter="load(1)"
          @clear="load(1)"
        />
      </el-form-item>
      <el-form-item>
        <el-checkbox v-model="query.onlyMine" @change="load(1)">只看待我审批</el-checkbox>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="load(1)">查询</el-button>
        <el-button @click="reset">重置</el-button>
        <el-button type="success" @click="openCreate">发起申请</el-button>
      </el-form-item>
    </el-form>

    <!-- 列表 -->
    <el-table v-loading="loading" :data="rows" border stripe size="small">
      <el-table-column v-if="!query.stage" label="学段" width="70" align="center">
        <template #default="{ row }">{{ row.stageName }}</template>
      </el-table-column>
      <el-table-column label="类型" width="80" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.bizType === 2 ? 'danger' : row.bizType === 3 ? 'success' : 'warning'">
            {{ row.bizTypeName }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="学生" min-width="130">
        <template #default="{ row }">
          {{ row.studentName }}
          <span class="muted">{{ row.studentNo }}</span>
        </template>
      </el-table-column>
      <el-table-column label="班级" min-width="120">
        <template #default="{ row }">{{ row.className || '—' }}</template>
      </el-table-column>
      <el-table-column label="异动日期" width="105" align="center">
        <template #default="{ row }">{{ row.leaveDate || '—' }}</template>
      </el-table-column>
      <el-table-column label="复学班" min-width="110">
        <template #default="{ row }">{{ row.newClassName || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="105" align="center">
        <template #default="{ row }">
          <el-tag :type="tagType(row.approvalStatus)" size="small">{{ row.approvalStatusName }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="当前处理" width="110" align="center">
        <template #default="{ row }">
          <span class="muted">{{ row.currentHandlerHint || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right" align="center">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
          <el-button v-if="row.canSubmit" link type="primary" size="small" @click="doSubmit(row)">提交</el-button>
          <el-button v-if="row.canApprove" link type="success" size="small" @click="openApprove(row)">
            审批
          </el-button>
          <el-button v-if="row.canApprove" link type="danger" size="small" @click="doReject(row)">驳回</el-button>
          <el-button v-if="row.canCancel" link type="warning" size="small" @click="doCancel(row)">撤回</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="tlv-page"
      :current-page="query.page"
      :page-size="query.size"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="(p: number) => load(p)"
    />

    <!-- 新建 -->
    <el-dialog v-model="createVisible" title="发起学籍异动申请" width="600px">
      <el-form label-width="100px">
        <el-form-item label="部门" required>
          <el-select v-model="form.dept" style="width: 160px" @change="onDeptChange">
            <el-option v-for="d in departments" :key="d.code" :label="d.name" :value="d.code" />
          </el-select>
          <div v-if="deptUnsupported" class="muted muted--block warn">
            「{{ currentDept?.name }}」部门暂不办理学籍异动
          </div>
        </el-form-item>
        <el-form-item label="类型" required>
          <el-radio-group v-model="form.bizType" :disabled="!form.stage" @change="onBizTypeChange">
            <el-radio-button
              v-for="b in allowedBiz(form.stage)"
              :key="b"
              :value="b"
            >
              {{ LEAVE_BIZ_NAME[b] }}
              <span class="muted">（{{ LEAVE_CHAIN_STEPS[b] }} 步）</span>
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="学生" required>
          <el-select
            v-model="form.studentId"
            filterable
            remote
            reserve-keyword
            :disabled="!form.stage"
            :placeholder="
              !form.stage
                ? '该部门暂不可选学生'
                : form.bizType === 3
                  ? '仅可搜索「休学中」的学生（姓名 / 学号）'
                  : '输入姓名 / 学号搜索'
            "
            :remote-method="searchStudents"
            :loading="stuLoading"
            style="width: 100%"
            @visible-change="(v: boolean) => v && searchStudents('')"
          >
            <el-option
              v-for="s in students"
              :key="s.id"
              :label="`${s.name}（${s.no}）${s.className ? ' · ' + s.className : ''}`"
              :value="s.id"
            />
          </el-select>
          <div v-if="form.bizType === 3 && form.stage" class="muted muted--block">
            复学只能从「当前处于休学」的学生里选（名单已按此过滤）
          </div>
          <!--
            空名单提示：复学的候选人是「**学生状态 = 休学**」的人，而
            「休学单已通过、但之后又办过复学」的学生其实已经回到在读，
            「休学单还没批准」的学生也还不是休学 —— 这两种情况都会让下拉是空的。
            没有这句提示时，用户看到「列表里有休学单、这里却一个学生都没有」，
            会直接判定成 bug（2026-10-15 用户就是这么报上来的）。
          -->
          <div
            v-if="form.bizType === 3 && form.stage && !stuLoading && !students.length"
            class="muted muted--block warn"
          >
            当前没有「休学中」的学生：休学单还没批准、或休学后又已办过复学的学生，都不算休学中
          </div>
        </el-form-item>
        <el-form-item :label="form.bizType === 3 ? '复学日期' : '异动日期'">
          <el-date-picker
            v-model="form.leaveDate"
            type="date"
            value-format="YYYY-MM-DD"
            :disabled-date="disabledLeaveDate"
            :placeholder="`只能选今天前后 ${leaveDateWindowDays} 天`"
            style="width: 220px"
          />
          <div class="muted muted--block">
            可选范围：{{ dateWindowHint }}
          </div>
        </el-form-item>
        <!-- ⚠️ 「预计复学」是**未来计划**（可能几个月后），不受上面的 10 天窗口限制 -->
        <el-form-item v-if="form.bizType === 1" label="预计复学">
          <el-date-picker
            v-model="form.expectResumeDate"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 180px"
          />
        </el-form-item>
        <el-form-item :label="form.bizType === 3 ? '复学原因' : '异动原因'" required>
          <el-input v-model="form.leaveReason" type="textarea" :rows="3" maxlength="500" show-word-limit />
        </el-form-item>
        <el-alert
          v-if="form.bizType === 3"
          type="info"
          :closable="false"
          show-icon
          title="复学班级在【学管审批通过时】选定（与实训口径一致）"
        />
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button :loading="saving" :disabled="deptUnsupported" @click="doCreate(false)">保存草稿</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="deptUnsupported"
          @click="doCreate(true)"
        >
          保存并提交
        </el-button>
      </template>
    </el-dialog>

    <!-- 审批 -->
    <el-dialog v-model="approveVisible" title="审批" width="520px">
      <el-form label-width="100px">
        <el-form-item label="申请">
          <span>
            {{ current?.studentName }} ·
            <el-tag size="small">{{ current?.bizTypeName }}</el-tag>
            <span class="muted">{{ current?.className || '' }}</span>
          </span>
        </el-form-item>
        <el-form-item v-if="current?.bizType === 3" label="复学班级" required>
          <el-select v-model="approveForm.newClassId" filterable placeholder="请选择复学后进入的班级" style="width: 100%">
            <el-option
              v-for="c in classOptsOfStage"
              :key="c.id"
              :label="`${c.name} · ${c.stageName || ''}`"
              :value="c.id"
            />
          </el-select>
          <div class="muted">复学必须选定班级，未选不允许通过</div>
        </el-form-item>
        <el-form-item label="审批意见">
          <el-input v-model="approveForm.comment" type="textarea" :rows="3" maxlength="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approveVisible = false">取消</el-button>
        <el-button type="primary" :loading="approving" @click="doApprove">确认通过</el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <el-dialog v-model="detailVisible" title="申请单详情" width="680px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="学段">{{ detail.record.stageName }}</el-descriptions-item>
          <el-descriptions-item label="类型">
            <el-tag size="small">{{ detail.record.bizTypeName }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="学生">
            {{ detail.record.studentName }}（{{ detail.record.studentNo }}）
          </el-descriptions-item>
          <el-descriptions-item label="班级">{{ detail.record.className || '—' }}</el-descriptions-item>
          <el-descriptions-item label="异动日期">{{ detail.record.leaveDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="预计复学">{{ detail.record.expectResumeDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="复学班">{{ detail.record.newClassName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="已上课时">
            {{ detail.record.attendedHours ?? '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="tagType(detail.record.approvalStatus)" size="small">
              {{ detail.record.approvalStatusName }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="当前处理">
            {{ detail.record.currentHandlerHint || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="原因" :span="2">
            {{ detail.record.leaveReason || '—' }}
          </el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">审批轨迹</el-divider>
        <el-empty v-if="!detail.logs.length" description="暂无审批轨迹" :image-size="50" />
        <el-timeline v-else>
          <el-timeline-item v-for="(l, i) in detail.logs" :key="i" :timestamp="l.time || ''" placement="top">
            <b>{{ l.operatorName }}</b> · {{ l.actionName }}（{{ l.nodeName }}）
            <div v-if="l.comment" class="muted">{{ l.comment }}</div>
          </el-timeline-item>
        </el-timeline>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 休学 / 退学 / 复学审批 · 统一页（第 2 期第 5 个域）
 *
 * ★ 一个页面取代原来三套（初高「通用流程引擎」/ 大学「休学退学」/ 实训「学籍异动」）
 * ★ 审批链统一采用实训那套（休学/复学 1 步；退学 2 步）—— 与后端 service.ts 口径一致
 * ★ 复学：审批通过时必须选「复学班」（对话框里有班级下拉，未选不允许通过）
 * ★ 复学：**发起时的学生下拉只列「当前处于休学的学生」**（后端按 bizType=3 过滤），
 *   切换类型会清空已选并重搜；后端 create 另有一道同样的校验（下拉可被绕过）
 * ★ 发起申请第一项是「**部门**」（初高中 / 大学 / 实训 / 就业），取代原来的「学段」：
 *   部门 → 学段（jh/class/job）由 `/meta` 的 departments 下发，页面不另抄一份。
 *   「就业」暂无学籍异动业务 → 选中即提示 + 置灰（类型/学生/保存全禁用），
 *   而不是让它填完再在提交时报错。
 * ★ 异动日期（复学时叫「复学日期」）**只能选今天 ± 10 天**：picker 用 disabled-date
 *   禁掉窗口外的日期，天数由 `/meta.leaveDateWindowDays` 下发（与后端校验同源）。
 *   ⚠️ 「预计复学」是未来计划（可能几个月后），**不受**这个窗口限制。
 * ★ 列表筛选（学段/类型/状态/关键字/只看待我审批）**全部选完即查**，不需要点「查询」；
 *   学段切换时若类型不兼容（大学的复学）会自动清掉类型，避免「静默空列表」。
 * ⚠️ 大学没有「复学」—— 类型选项按 `/meta` 的 stageBizTypes 过滤
 * ⚠️ 列表的「学段」筛选/列保留不动：那是查看维度（跨学段合并后的筛选项）
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  LEAVE_BIZ_NAME,
  LEAVE_CHAIN_STEPS,
  LEAVE_DATE_WINDOW_DAYS_DEFAULT,
  LEAVE_DEPARTMENTS_DEFAULT,
  LEAVE_STAGE_BIZ_DEFAULT,
  LEAVE_STATUS_NAME,
  approveLeave,
  cancelLeave,
  createLeave,
  getLeaveDetail,
  getLeaveMeta,
  getLeaveSummary,
  listClasses,
  listLeaves,
  listStudentOptions,
  rejectLeave,
  submitLeave,
  type LeaveDepartment,
  type LeaveDetail,
  type LeaveRow,
  type LeaveSummary,
  type StudentOption,
  type TeachingStage,
} from '../api/leave';

const loading = ref(false);
const saving = ref(false);
const approving = ref(false);
const rows = ref<LeaveRow[]>([]);
const total = ref(0);
const summaries = ref<LeaveSummary[]>([]);
const stageOptions = ref<Array<{ value: TeachingStage; label: string }>>([]);
const stageBiz = ref<Record<string, number[]>>({ ...LEAVE_STAGE_BIZ_DEFAULT });
/** 部门下拉（以后端 `/meta` 为准，取不到时用本地默认值，页面不至于空白） */
const departments = ref<LeaveDepartment[]>([...LEAVE_DEPARTMENTS_DEFAULT]);
/**
 * 异动日期的可选窗口：**今天 ± N 天**（业务要求）
 * ★ N 由后端 `/meta.leaveDateWindowDays` 下发（与后端 create 的校验同源），
 *   这里只是兜底默认值。改窗口天数请改后端 `LEAVE_DATE_WINDOW_DAYS`。
 */
const leaveDateWindowDays = ref(LEAVE_DATE_WINDOW_DAYS_DEFAULT);
const allClasses = ref<Array<{ stage: TeachingStage; stageName: string; id: string; name: string }>>([]);

const query = reactive({
  stage: undefined as TeachingStage | undefined,
  bizType: undefined as number | undefined,
  status: undefined as number | undefined,
  keyword: '',
  onlyMine: false,
  page: 1,
  size: 20,
});

function tagType(s: number) {
  if (s === 4) return 'success';
  if (s === 5) return 'danger';
  if (s === 2 || s === 3) return 'warning';
  return 'info';
}

/** 某学段是否支持某类型（大学没有复学） */
function bizAllowed(stage: TeachingStage | undefined, biz: number) {
  if (!stage) return true;
  return (stageBiz.value[stage] || []).includes(biz);
}

function allowedBiz(stage: TeachingStage | undefined): number[] {
  if (!stage) return [1, 2, 3];
  return stageBiz.value[stage] || [];
}

const classOptsOfStage = computed(() => allClasses.value);

/* ---------------- 加载 ---------------- */

async function load(p = query.page) {
  query.page = p;
  loading.value = true;
  try {
    const res = await listLeaves({
      stage: query.stage,
      bizType: query.bizType,
      status: query.status,
      keyword: query.keyword || undefined,
      onlyMine: query.onlyMine || undefined,
      page: query.page,
      size: query.size,
    });
    rows.value = res.list || [];
    total.value = res.total || 0;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadSummary() {
  try {
    const list = await getLeaveSummary();
    summaries.value = list || [];
    stageOptions.value = (list || []).map((s) => ({ value: s.stage, label: s.stageName }));
  } catch {
    /* 忽略 */
  }
}

async function loadMeta() {
  try {
    const meta = await getLeaveMeta();
    if (meta?.stageBizTypes) stageBiz.value = meta.stageBizTypes;
    // 部门列表以后端为准（「就业」的 stage 是否为 null 也由后端说了算）
    if (meta?.departments?.length) departments.value = meta.departments;
    // 异动日期窗口同理：后端校验多少天，前端就禁多少天（两处不同步就成了「能选不能交」）
    if (meta?.leaveDateWindowDays) leaveDateWindowDays.value = meta.leaveDateWindowDays;
  } catch {
    /* 用默认值 */
  }
  try {
    allClasses.value = (await listClasses()) || [];
  } catch {
    allClasses.value = [];
  }
}

/**
 * 学段筛选变了：顺手把「与学段不兼容的类型」清掉，再查
 *
 * 例：类型选了「复学」→ 学段切到「大学」（大学没有复学）。
 * 不清的话会出现两种坏结果：
 *   · 前端：类型下拉显示「复学」，但选项被置灰、用户以为还在筛复学
 *   · 后端：不兼容的组合会被明确拒绝（40000），页面直接弹错
 * 清掉 = 回到「全部类型」，这是用户在这一步唯一能预期的行为。
 */
function onFilterStageChange() {
  if (query.bizType && query.stage && !bizAllowed(query.stage, query.bizType)) {
    query.bizType = undefined;
  }
  load(1);
}

function reset() {
  query.stage = undefined;
  query.bizType = undefined;
  query.status = undefined;
  query.keyword = '';
  query.onlyMine = false;
  load(1);
}

onMounted(async () => {
  await Promise.all([loadSummary(), loadMeta()]);
  await load(1);
});

/* ---------------- 新建 ---------------- */

const createVisible = ref(false);
const students = ref<StudentOption[]>([]);
const stuLoading = ref(false);

/**
 * 表单状态
 *
 * `dept` 是用户选的**部门**（初高中/大学/实训/就业）；
 * `stage` 是它对应的**技术学段**（jh/class/job）—— 建单时要提交给后端（按学段分库）。
 * 两者由 `/meta` 的 departments 关联，页面不再让用户看到「学段」这个词。
 * 「就业」的对应 stage 是 null → 这一单做不了（见 deptUnsupported）。
 */
const form = reactive<{
  dept: string;
  stage?: TeachingStage;
  bizType: number;
  studentId: string;
  leaveDate: string;
  expectResumeDate: string;
  leaveReason: string;
}>({
  dept: 'jh',
  stage: 'jh',
  bizType: 1,
  studentId: '',
  leaveDate: '',
  expectResumeDate: '',
  leaveReason: '',
});

/** 当前选中的部门 */
const currentDept = computed(() => departments.value.find((d) => d.code === form.dept));
/** 该部门暂不办理学籍异动（如「就业」）→ 类型/学生/保存全禁用 */
const deptUnsupported = computed(() => !form.stage);

/** 按部门码取学段（部门列表里没有的码 → undefined，等同于不可用） */
function stageOfDept(code: string): TeachingStage | undefined {
  return departments.value.find((d) => d.code === code)?.stage ?? undefined;
}

/* -------- 异动日期窗口：今天 ± N 天 -------- */

const fmtDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 窗口起止（本地时间的当天零点 / 末日 23:59:59，两端都含） */
function dateWindowBounds() {
  const n = leaveDateWindowDays.value;
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - n),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 23, 59, 59, 999),
  };
}

/**
 * el-date-picker 的 disabled-date：窗口外的日期**不可选**
 * ⚠️ 只禁前端是不够的（表单可绕过）——后端 create 有同一套校验，
 *    两边的天数都来自 `/meta.leaveDateWindowDays`，不会各说各话。
 */
function disabledLeaveDate(d: Date): boolean {
  const { start, end } = dateWindowBounds();
  return d.getTime() < start.getTime() || d.getTime() > end.getTime();
}

/** 给用户看的具体范围（例：2026-10-05 ～ 2026-10-25） */
const dateWindowHint = computed(() => {
  const { start, end } = dateWindowBounds();
  return `${fmtDay(start)} ～ ${fmtDay(end)}`;
});

/** 打开对话框：默认停在「列表筛选的学段」对应部门，否则第一个可用部门 */
function openCreate() {
  const prefer = query.stage
    ? departments.value.find((d) => d.stage === query.stage)?.code
    : undefined;
  const firstUsable = departments.value.find((d) => d.stage)?.code;
  form.dept = prefer || firstUsable || departments.value[0]?.code || 'jh';
  form.stage = stageOfDept(form.dept);
  form.bizType = allowedBiz(form.stage)[0] || 1;
  form.studentId = '';
  form.leaveDate = '';
  form.expectResumeDate = '';
  form.leaveReason = '';
  students.value = [];
  createVisible.value = true;
  if (form.stage) searchStudents('');
}

/**
 * 换部门 = 换学段：候选学生整体换了一批，所以
 * ① 学段重算；② 类型收敛到该学段支持的（大学没有复学）；③ 清空已选并重搜
 * 「就业」（stage = null）→ 不搜学生，页面提示「暂不办理学籍异动」并禁用保存。
 */
function onDeptChange() {
  form.stage = stageOfDept(form.dept);
  if (!form.stage) {
    form.studentId = '';
    students.value = [];
    return;
  }
  if (!bizAllowed(form.stage, form.bizType)) form.bizType = allowedBiz(form.stage)[0] || 1;
  form.studentId = '';
  students.value = [];
  searchStudents('');
}

/**
 * ★ 切换异动类型必须重搜学生
 *
 * 复学（3）的候选名单和休学/退学**不是同一批人**：
 * 复学只能挑「当前处于休学」的学生（后端按 bizType 过滤）。
 * 不重搜的话，切到复学后列表里还留着刚才搜出来的在读生 →
 * 用户选中 → 后端直接报错，体验上就是「点了没反应/莫名报错」。
 */
function onBizTypeChange() {
  form.studentId = '';
  students.value = [];
  searchStudents('');
}

async function searchStudents(kw: string) {
  if (!form.stage) return;
  stuLoading.value = true;
  try {
    students.value = (await listStudentOptions(form.stage, kw, form.bizType)) || [];
  } catch {
    students.value = [];
  } finally {
    stuLoading.value = false;
  }
}

async function doCreate(submit: boolean) {
  if (deptUnsupported.value) {
    return ElMessage.warning(`「${currentDept.value?.name || '该部门'}」部门暂不办理学籍异动`);
  }
  if (!form.studentId) return ElMessage.warning('请选择学生');
  if (!form.leaveReason.trim()) return ElMessage.warning('请填写原因');
  saving.value = true;
  try {
    await createLeave({
      stage: form.stage!,
      studentId: form.studentId,
      bizType: form.bizType,
      leaveDate: form.leaveDate || undefined,
      expectResumeDate: form.expectResumeDate || undefined,
      leaveReason: form.leaveReason,
      submit,
    });
    ElMessage.success(submit ? '已创建并提交，等待学管审批' : '已保存草稿');
    createVisible.value = false;
    await Promise.all([load(1), loadSummary()]);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '创建失败');
  } finally {
    saving.value = false;
  }
}

/* ---------------- 详情 ---------------- */

const detailVisible = ref(false);
const detail = ref<LeaveDetail | null>(null);

async function openDetail(row: LeaveRow) {
  try {
    detail.value = await getLeaveDetail(row.id);
    detailVisible.value = true;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载详情失败');
  }
}

/* ---------------- 审批 ---------------- */

const approveVisible = ref(false);
const current = ref<LeaveRow | null>(null);
const approveForm = reactive({ comment: '', newClassId: '' });

function openApprove(row: LeaveRow) {
  current.value = row;
  approveForm.comment = '';
  approveForm.newClassId = '';
  approveVisible.value = true;
}

async function doApprove() {
  if (!current.value) return;
  const row = current.value;
  if (row.bizType === 3 && !approveForm.newClassId) {
    return ElMessage.warning('复学必须选定复学班级');
  }
  approving.value = true;
  try {
    const r = await approveLeave(row.stage, row.id, {
      comment: approveForm.comment || undefined,
      newClassId: row.bizType === 3 ? approveForm.newClassId : undefined,
    });
    ElMessage.success(r.finished ? '审批通过' : '本环节已通过，流转到下一节点');
    approveVisible.value = false;
    await Promise.all([load(), loadSummary()]);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '审批失败');
  } finally {
    approving.value = false;
  }
}

/* ---------------- 其它动作 ---------------- */

async function doSubmit(row: LeaveRow) {
  try {
    await submitLeave(row.stage, row.id);
    ElMessage.success('已提交');
    await Promise.all([load(), loadSummary()]);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '提交失败');
  }
}

async function doReject(row: LeaveRow) {
  try {
    const { value } = await ElMessageBox.prompt('请填写驳回原因（必填）', '驳回申请', {
      inputPlaceholder: '驳回原因会通知到发起人',
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputValidator: (v: string) => (v && v.trim() ? true : '驳回原因必填'),
    });
    await rejectLeave(row.stage, row.id, value);
    ElMessage.success('已驳回');
    await Promise.all([load(), loadSummary()]);
  } catch (e: any) {
    if (e === 'cancel' || e?.message === 'cancel') return;
    ElMessage.error(e?.response?.data?.message || e?.message || '驳回失败');
  }
}

async function doCancel(row: LeaveRow) {
  try {
    const { value } = await ElMessageBox.prompt('撤回原因（可空）', '撤回申请', {
      confirmButtonText: '确认撤回',
      cancelButtonText: '取消',
      inputValue: '',
    });
    await cancelLeave(row.stage, row.id, value || undefined);
    ElMessage.success('已撤回');
    await Promise.all([load(), loadSummary()]);
  } catch (e: any) {
    if (e === 'cancel' || e?.message === 'cancel') return;
    ElMessage.error(e?.response?.data?.message || e?.message || '撤回失败');
  }
}
</script>

<style scoped>
.tlv {
  padding: 12px;
}
.tlv-chain {
  margin-bottom: 12px;
}
.tlv-cards {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.tlv-card {
  flex: 1 1 240px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px 12px;
}
.tlv-card__head {
  font-weight: 600;
  margin-bottom: 6px;
}
.tlv-card__row {
  display: flex;
  gap: 12px;
  font-size: 13px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.warn {
  color: var(--el-color-warning);
}
.ok {
  color: var(--el-color-success);
}
.tlv-filter {
  margin-bottom: 8px;
}
.tlv-page {
  margin-top: 10px;
  justify-content: flex-end;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-left: 4px;
}
.muted--block {
  display: block;
  margin-left: 0;
  margin-top: 4px;
  line-height: 1.4;
  width: 100%;
}
</style>
