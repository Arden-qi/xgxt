<template>
  <div class="tsv">
    <!-- 说明条 -->
    <el-alert class="tsv-tip" type="info" :closable="false" show-icon>
      <template #title>
        本页合并了 <b>4 个学段</b>的学生档案（初高 / 大学 / 就业 / 教务）。
        「全部」= 当前账号可见学段合并后<b>按学号去重</b>
        <span class="muted">（同学号保留阶段更靠后的那条：就业 &gt; 大学 &gt; 初高 &gt; 教务）</span>
      </template>
    </el-alert>

    <!-- 统计卡片 -->
    <div class="tsv-cards">
      <div class="tsv-card">
        <div class="tsv-card__k">总人数</div>
        <div class="tsv-card__v">{{ summary.total }}</div>
      </div>
      <div class="tsv-card">
        <div class="tsv-card__k">正式在读</div>
        <div class="tsv-card__v ok">{{ summary.studying }}</div>
      </div>
      <div class="tsv-card">
        <div class="tsv-card__k">试学中</div>
        <div class="tsv-card__v">{{ summary.trial }}</div>
      </div>
      <div class="tsv-card">
        <div class="tsv-card__k">休学</div>
        <div class="tsv-card__v warn">{{ summary.suspended }}</div>
      </div>
      <div class="tsv-card">
        <div class="tsv-card__k">退学</div>
        <div class="tsv-card__v danger">{{ summary.quit }}</div>
      </div>
      <div class="tsv-card">
        <div class="tsv-card__k">未分配宿舍</div>
        <div class="tsv-card__v">{{ summary.unassigned }}</div>
      </div>
    </div>

    <!-- 筛选 -->
    <el-form class="tsv-filter" inline>
      <el-form-item label="学段">
        <el-select v-model="query.stage" clearable placeholder="全部学段" style="width: 130px" @change="onStageChange">
          <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="班级">
        <!-- ★ 选完即查：之前这里没有 @change，选了班级列表不动，
             用户会以为「按班级筛选」没实现（必须再点一次查询才生效） -->
        <el-select v-model="query.classId" clearable filterable placeholder="全部班级" style="width: 180px" @change="load(1)">
          <el-option
            v-for="c in classSelectOptions"
            :key="c.id"
            :label="c.stage ? `${c.name} · ${c.stageName}` : c.name"
            :value="c.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="phaseOptions.length" label="阶段">
        <el-select v-model="query.phaseCode" clearable placeholder="全部" style="width: 130px" @change="load(1)">
          <el-option v-for="p in phaseOptions" :key="p.value" :label="p.label" :value="p.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="query.studentStatus" clearable placeholder="全部" style="width: 130px" @change="load(1)">
          <el-option
            v-for="(n, v) in STUDENT_STATUS_NAME"
            :key="v"
            :label="n"
            :value="Number(v)"
            :disabled="query.stage ? !statusAllowed(query.stage, Number(v)) : false"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="query.keyword"
          placeholder="姓名 / 学号 / 手机"
          clearable
          style="width: 170px"
          @keyup.enter="load(1)"
          @clear="load(1)"
        />
      </el-form-item>
      <el-form-item>
        <el-checkbox v-model="query.unassigned" @change="load(1)">只看未分配宿舍</el-checkbox>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="load(1)">查询</el-button>
        <el-button @click="reset">重置</el-button>
        <el-button v-if="!isReadOnlyUser" type="success" @click="openCreate">新增学生</el-button>
      </el-form-item>
    </el-form>

    <!-- 列表 -->
    <el-table v-loading="loading" :data="rows" border stripe size="small">
      <el-table-column v-if="!query.stage" label="学段" width="70" align="center">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ row.stageName }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="学号" width="120">
        <template #default="{ row }">{{ row.studentNo }}</template>
      </el-table-column>
      <el-table-column label="姓名" width="100">
        <template #default="{ row }">{{ row.studentName }}</template>
      </el-table-column>
      <el-table-column label="性别" width="60" align="center">
        <template #default="{ row }">{{ row.genderName || '—' }}</template>
      </el-table-column>
      <el-table-column label="年龄" width="60" align="center">
        <template #default="{ row }">{{ row.age ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="班级" min-width="120">
        <template #default="{ row }">{{ row.className || '—' }}</template>
      </el-table-column>
      <el-table-column label="阶段" width="110">
        <template #default="{ row }">{{ row.phaseName || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="statusTag(row.studentStatus)" size="small">{{ row.studentStatusName }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="手机号" width="120">
        <template #default="{ row }">{{ row.phone || '—' }}</template>
      </el-table-column>
      <el-table-column label="宿舍" width="110">
        <template #default="{ row }">{{ row.bedLabel || row.dormNo || '—' }}</template>
      </el-table-column>
      <el-table-column label="入学时间" width="105" align="center">
        <template #default="{ row }">{{ row.enrollDate || '—' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right" align="center">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
          <el-button v-if="!isReadOnlyUser" link type="primary" size="small" @click="openEdit(row)">
            编辑
          </el-button>
          <el-button v-if="!isReadOnlyUser" link type="danger" size="small" @click="doDelete(row)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="tsv-page"
      :current-page="query.page"
      :page-size="query.size"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="(p: number) => load(p)"
    />

    <!-- 详情 -->
    <el-dialog v-model="detailVisible" title="学生档案详情" width="760px" top="6vh">
      <template v-if="detail">
        <el-descriptions :column="3" border size="small" title="基础信息">
          <el-descriptions-item label="学段">{{ detail.base.stageName }}</el-descriptions-item>
          <el-descriptions-item label="学号">{{ detail.base.studentNo }}</el-descriptions-item>
          <el-descriptions-item label="姓名">{{ detail.base.studentName }}</el-descriptions-item>
          <el-descriptions-item label="性别">{{ detail.base.genderName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="年龄">{{ detail.base.age ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="身份证">{{ detail.profile.idCard || '—' }}</el-descriptions-item>
          <el-descriptions-item label="部门">{{ detail.base.deptName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{ detail.base.className || '—' }}</el-descriptions-item>
          <el-descriptions-item label="阶段">{{ detail.base.phaseName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTag(detail.base.studentStatus)" size="small">
              {{ detail.base.studentStatusName }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="入学时间">{{ detail.base.enrollDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="出生日期">{{ detail.profile.birthDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="手机号">{{ detail.base.phone || '—' }}</el-descriptions-item>
          <el-descriptions-item label="家长手机">{{ detail.base.parentPhone || '—' }}</el-descriptions-item>
          <el-descriptions-item label="学历">{{ detail.base.education || '—' }}</el-descriptions-item>
          <el-descriptions-item label="籍贯">{{ detail.profile.nativePlace || '—' }}</el-descriptions-item>
          <el-descriptions-item label="毕业学校">{{ detail.profile.graduateSchool || '—' }}</el-descriptions-item>
          <el-descriptions-item label="家庭住址" :span="1">
            {{ detail.profile.homeAddress || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="班主任">{{ detail.base.headTeacherName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="教员">{{ detail.base.teacherName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="助教">{{ detail.base.assistantName || '—' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions :column="3" border size="small" title="市场信息" class="tsv-sec">
          <el-descriptions-item label="招生老师">{{ detail.market.recruitTeacherName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="招生电话">{{ detail.market.recruitTeacherPhone || '—' }}</el-descriptions-item>
          <el-descriptions-item label="咨询老师">{{ detail.market.consultTeacherName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="咨询电话" :span="3">{{ detail.market.consultTeacherPhone || '—' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions v-if="detail.dorm" :column="3" border size="small" title="宿舍" class="tsv-sec">
          <el-descriptions-item label="宿舍号">{{ detail.dorm.dormNo || '—' }}</el-descriptions-item>
          <el-descriptions-item label="床位">{{ detail.dorm.bedLabel || '—' }}</el-descriptions-item>
          <el-descriptions-item label="楼栋">{{ detail.dorm.building || '—' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions v-if="detail.net" :column="3" border size="small" title="校园网（初高）" class="tsv-sec">
          <el-descriptions-item label="上网账号">{{ detail.net.netAccount || '—' }}</el-descriptions-item>
          <el-descriptions-item label="初始密码" :span="2">{{ detail.net.netInitPassword || '—' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions v-if="detail.quality" :column="3" border size="small" title="综合素质（大学）" class="tsv-sec">
          <el-descriptions-item label="学习">{{ detail.quality.studyStatus || '—' }}</el-descriptions-item>
          <el-descriptions-item label="纪律">{{ detail.quality.discipline || '—' }}</el-descriptions-item>
          <el-descriptions-item label="能力">{{ detail.quality.ability || '—' }}</el-descriptions-item>
          <el-descriptions-item label="理解">{{ detail.quality.comprehension || '—' }}</el-descriptions-item>
          <el-descriptions-item label="表达">{{ detail.quality.expression || '—' }}</el-descriptions-item>
          <el-descriptions-item label="社交">{{ detail.quality.social || '—' }}</el-descriptions-item>
          <el-descriptions-item label="综合评语" :span="3">{{ detail.quality.note || '—' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions v-if="detail.resume" :column="1" border size="small" title="简历（就业）" class="tsv-sec">
          <el-descriptions-item label="简历文件">{{ detail.resume.resumeName || '（无）' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions v-if="flowRows.length" :column="1" border size="small" title="学籍异动记录" class="tsv-sec">
          <el-descriptions-item v-for="(f, i) in flowRows" :key="i" :label="String(f.flowTypeName || '异动')">
            {{ f.applyTime || '—' }} · {{ f.currentNodeName || '' }} {{ f.rejectReason || '' }}
          </el-descriptions-item>
        </el-descriptions>

        <el-descriptions v-if="repeatRows.length" :column="1" border size="small" title="末班 / 留级记录" class="tsv-sec">
          <el-descriptions-item v-for="(r, i) in repeatRows" :key="i" :label="String(r.repeatTime || '记录')">
            {{ r.fromClassName || '—' }} → {{ r.toClassName || '—' }}（{{ r.repeatReason || '无原因' }}）
          </el-descriptions-item>
        </el-descriptions>

        <el-descriptions :column="1" border size="small" title="备注" class="tsv-sec">
          <el-descriptions-item label="备注">{{ detail.base.remark || '—' }}</el-descriptions-item>
        </el-descriptions>
      </template>
    </el-dialog>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="editVisible" :title="form.id ? '编辑学生' : '新增学生'" width="720px" top="5vh">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="学段" required>
              <el-select v-model="form.stage" :disabled="!!form.id" style="width: 100%">
                <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="学号">
              <el-input v-model="form.studentNo" placeholder="留空则自动生成" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="姓名" prop="studentName">
              <el-input v-model="form.studentName" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="性别" prop="gender">
              <el-select v-model="form.gender" style="width: 100%">
                <el-option label="男" :value="1" />
                <el-option label="女" :value="2" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="出生日期">
              <el-date-picker v-model="form.birthDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="部门">
              <el-select v-model="form.deptCode" clearable placeholder="请选择" style="width: 100%">
                <el-option v-for="(n, v) in DEPT_NAME" :key="v" :label="n" :value="Number(v)" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="班级">
              <el-select
                v-model="form.classId"
                clearable
                filterable
                placeholder="请选择"
                style="width: 100%"
                @change="onFormClassChange"
              >
                <el-option
                  v-for="c in formClassOptions"
                  :key="c.id"
                  :label="c.name"
                  :value="c.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="阶段">
              <el-select v-model="form.phaseCode" clearable placeholder="请选择" style="width: 100%">
                <el-option v-for="p in formPhaseOptions" :key="p.value" :label="p.label" :value="p.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="状态">
              <el-select v-model="form.studentStatus" style="width: 100%">
                <el-option v-for="(n, v) in formStatusOptions" :key="v" :label="n" :value="Number(v)" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="手机号">
              <el-input v-model="form.phone" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="家长手机">
              <el-input v-model="form.parentPhone" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="身份证">
              <el-input v-model="form.idCard" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="籍贯">
              <el-input v-model="form.nativePlace" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="学历">
              <el-input v-model="form.education" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="毕业学校">
              <el-input v-model="form.graduateSchool" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="入学时间">
              <el-date-picker v-model="form.enrollDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="宿舍号">
              <el-input v-model="form.dormNo" />
            </el-form-item>
          </el-col>
          <el-col :span="8" v-if="showBed">
            <el-form-item label="床位号">
              <el-input v-model="form.bedNo" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="招生老师">
              <el-input v-model="form.recruitTeacherName" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="招生电话">
              <el-input v-model="form.recruitTeacherPhone" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="咨询老师">
              <el-input v-model="form.consultTeacherName" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="咨询电话">
              <el-input v-model="form.consultTeacherPhone" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="家庭住址">
              <el-input v-model="form.homeAddress" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" show-word-limit />
            </el-form-item>
          </el-col>
        </el-row>

        <el-alert
          v-if="form.stage === 'edu'"
          type="warning"
          :closable="false"
          show-icon
          title="教务学段：把状态改成「休学 / 退学」会自动冻结该生名下缴费记录；改回在读自动解冻（只解冻系统冻结的）"
        />
        <el-alert
          v-else
          type="info"
          :closable="false"
          show-icon
          title="学段特有字段（综合素质 / 校园网 / 简历）目前在详情页只读展示，编辑留待下一批"
        />
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 统一学生档案页（第 2 期）
 * ============================================================
 * 合并了 4 个学段（初高 / 大学 / 就业 / 教务）的学生档案：
 *   · 一个页面 + 学段筛选（不再 4 个页面各一套）
 *   · 4 个学段各自的特有区块（综合素质 / 校园网 / 简历 / 学籍异动）
 *     都按「后端有没有给」来决定显不显示 —— 不写死学段判断
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { DEPT_NAME, STUDENT_STATUS_NAME } from 'shared-types';
import { isReadOnlyUser } from '@/store/permission';
import { visibleStageOptions } from '@/teaching/access';
import {
  listStudents,
  getStudentDetail,
  saveStudent,
  deleteStudent,
  getStudentMeta,
  getStudentSummary,
  type StudentDetail,
  type StudentRow,
  type StudentStage,
  type StudentStageMeta,
  type StudentSummary,
} from '@/teaching/api/student';
import { http } from '@/api/request';

/* ---------------- 学段（第 3 期：判权不再依赖旧路由） ---------------- */
const STAGE_ORDER: StudentStage[] = ['jh', 'class', 'job', 'edu'];
const STAGE_LABEL: Record<StudentStage, string> = { jh: '初高', class: '大学', job: '就业', edu: '教务' };

const stageOptions = computed(() => visibleStageOptions('student', STAGE_ORDER, STAGE_LABEL));

/** 各学段可见的状态（与后端 repo 的口径一致，只是用于筛选下拉禁用） */
const STATUS_BY_STAGE: Record<StudentStage, number[]> = {
  jh: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  class: [3, 5, 6, 7, 8],
  job: [6, 7, 9, 10],
  edu: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
function statusAllowed(stage: StudentStage, s: number): boolean {
  return (STATUS_BY_STAGE[stage] || []).includes(s);
}

/* ---------------- 列表 ---------------- */
const loading = ref(false);
const rows = ref<StudentRow[]>([]);
const total = ref(0);
const summary = ref<StudentSummary>({
  total: 0,
  studying: 0,
  trial: 0,
  suspended: 0,
  quit: 0,
  unassigned: 0,
});

const query = reactive({
  stage: '' as '' | StudentStage,
  classId: '',
  phaseCode: undefined as number | undefined,
  studentStatus: undefined as number | undefined,
  keyword: '',
  unassigned: false,
  page: 1,
  size: 20,
});

const meta = ref<StudentStageMeta[]>([]);
const classOptions = ref<Array<{ stage: StudentStage; stageName: string; id: string; name: string }>>([]);

const classSelectOptions = computed(() =>
  query.stage ? classOptions.value.filter((c) => c.stage === query.stage) : classOptions.value,
);

/** 「阶段」筛选项：选了学段用该学段的；没选则取并集（去重） */
const phaseOptions = computed(() => {
  const list = query.stage
    ? meta.value.filter((m) => m.stage === query.stage)
    : meta.value;
  const seen = new Map<number, string>();
  for (const m of list) for (const p of m.phaseOptions) if (!seen.has(p.value)) seen.set(p.value, p.label);
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
});

function params() {
  return {
    stage: (query.stage || undefined) as StudentStage | undefined,
    classId: query.classId || undefined,
    phaseCode: query.phaseCode,
    studentStatus: query.studentStatus,
    keyword: query.keyword || undefined,
    unassigned: query.unassigned || undefined,
    page: query.page,
    size: query.size,
  };
}

async function load(p = query.page) {
  query.page = p;
  loading.value = true;
  try {
    const [page, sum] = await Promise.all([
      listStudents(params()),
      getStudentSummary(params()),
    ]);
    rows.value = page.list;
    total.value = page.total;
    summary.value = sum;
  } finally {
    loading.value = false;
  }
}

function onStageChange() {
  query.classId = '';
  query.phaseCode = undefined;
  query.studentStatus = undefined;
  load(1);
}

function reset() {
  query.stage = '';
  query.classId = '';
  query.phaseCode = undefined;
  query.studentStatus = undefined;
  query.keyword = '';
  query.unassigned = false;
  load(1);
}

function statusTag(s: number): 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  if (s === 5 || s === 4) return 'success';
  if (s === 6) return 'warning';
  if (s === 7 || s === 11) return 'danger';
  if (s === 8) return 'primary';
  return 'info';
}

/* ---------------- 详情 ---------------- */
const detailVisible = ref(false);
const detail = ref<StudentDetail | null>(null);
const flowRows = computed(() => (detail.value?.flows || []) as Array<Record<string, unknown>>);
const repeatRows = computed(() => (detail.value?.repeats || []) as Array<Record<string, unknown>>);

async function openDetail(row: StudentRow) {
  detail.value = await getStudentDetail(row.stage, row.studentId);
  detailVisible.value = true;
}

/* ---------------- 新增 / 编辑 ---------------- */
const editVisible = ref(false);
const saving = ref(false);
const formRef = ref<FormInstance>();

const emptyForm = () => ({
  stage: 'jh' as StudentStage,
  id: '' as string | undefined,
  studentNo: '',
  studentName: '',
  gender: 1,
  birthDate: '' as string | null,
  nativePlace: '',
  deptCode: undefined as number | undefined,
  classId: '',
  className: '',
  phaseCode: undefined as number | undefined,
  studentStatus: undefined as number | undefined,
  education: '',
  graduateSchool: '',
  enrollDate: '' as string | null,
  phone: '',
  parentPhone: '',
  homeAddress: '',
  idCard: '',
  recruitTeacherName: '',
  recruitTeacherPhone: '',
  consultTeacherName: '',
  consultTeacherPhone: '',
  dormNo: '',
  bedNo: '',
  remark: '',
});
const form = reactive(emptyForm());

const rules: FormRules = {
  studentName: [{ required: true, message: '姓名必填', trigger: 'blur' }],
  gender: [{ required: true, message: '性别必填', trigger: 'change' }],
};

/** 表单里班级下拉：按当前表单学段过滤 */
const formClassOptions = computed(() =>
  classOptions.value.filter((c) => c.stage === form.stage),
);
/** 表单里阶段下拉：按当前表单学段 */
const formPhaseOptions = computed(
  () => meta.value.find((m) => m.stage === form.stage)?.phaseOptions || [],
);
/** 表单里状态下拉：按该学段允许的状态 */
const formStatusOptions = computed(() => {
  const allow = STATUS_BY_STAGE[form.stage] || [];
  const out: Record<number, string> = {};
  for (const s of allow) out[s] = STUDENT_STATUS_NAME[s] || String(s);
  return out;
});
/** 是否显示床位号：就业/教务表没有 bed_no 列 */
const showBed = computed(() => form.stage === 'class' || form.stage === 'jh');

function openCreate() {
  Object.assign(form, emptyForm());
  form.stage = (query.stage || stageOptions.value[0]?.value || 'jh') as StudentStage;
  editVisible.value = true;
}

async function openEdit(row: StudentRow) {
  const d = await getStudentDetail(row.stage, row.studentId);
  const b = d.base;
  Object.assign(form, {
    ...emptyForm(),
    stage: b.stage,
    id: b.studentId,
    studentNo: b.studentNo,
    studentName: b.studentName,
    gender: b.gender || 1,
    birthDate: d.profile.birthDate || '',
    nativePlace: d.profile.nativePlace || '',
    deptCode: b.deptCode ?? undefined,
    classId: b.classId || '',
    className: b.className || '',
    phaseCode: b.phaseCode ?? undefined,
    studentStatus: b.studentStatus,
    education: b.education || '',
    graduateSchool: d.profile.graduateSchool || '',
    enrollDate: b.enrollDate || '',
    phone: b.phone || '',
    parentPhone: b.parentPhone || '',
    homeAddress: d.profile.homeAddress || '',
    idCard: d.profile.idCard || '',
    recruitTeacherName: d.market.recruitTeacherName || '',
    recruitTeacherPhone: d.market.recruitTeacherPhone || '',
    consultTeacherName: d.market.consultTeacherName || '',
    consultTeacherPhone: d.market.consultTeacherPhone || '',
    dormNo: b.dormNo || '',
    bedNo: b.bedNo || '',
    remark: b.remark || '',
  });
  editVisible.value = true;
}

function onFormClassChange(id: string) {
  const c = formClassOptions.value.find((x) => x.id === id);
  form.className = c?.name || '';
}

async function doSave() {
  if (!formRef.value) return;
  const ok = await formRef.value.validate().catch(() => false);
  if (!ok) return;
  if (form.stage !== 'jh' && !form.deptCode) {
    ElMessage.warning('该学段「部门」必填');
    return;
  }
  saving.value = true;
  try {
    const r = await saveStudent({
      stage: form.stage,
      id: form.id,
      studentNo: form.studentNo || undefined,
      studentName: form.studentName,
      gender: form.gender,
      birthDate: form.birthDate || null,
      nativePlace: form.nativePlace || null,
      deptCode: form.deptCode ?? null,
      classId: form.classId || null,
      className: form.className || null,
      phaseCode: form.phaseCode ?? null,
      studentStatus: form.studentStatus,
      education: form.education || null,
      graduateSchool: form.graduateSchool || null,
      enrollDate: form.enrollDate || null,
      phone: form.phone || null,
      parentPhone: form.parentPhone || null,
      homeAddress: form.homeAddress || null,
      idCard: form.idCard || null,
      recruitTeacherName: form.recruitTeacherName || null,
      recruitTeacherPhone: form.recruitTeacherPhone || null,
      consultTeacherName: form.consultTeacherName || null,
      consultTeacherPhone: form.consultTeacherPhone || null,
      dormNo: form.dormNo || null,
      bedNo: showBed.value ? form.bedNo || null : undefined,
      remark: form.remark || null,
    });
    let tip = form.id ? '已保存' : '已新增';
    if (r.frozenCount) tip += `，同步冻结 ${r.frozenCount} 条缴费记录`;
    else if (r.unfrozenCount) tip += `，同步解冻 ${r.unfrozenCount} 条缴费记录`;
    ElMessage.success(tip);
    editVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function doDelete(row: StudentRow) {
  try {
    await ElMessageBox.confirm(
      `确认删除「${row.stageName} · ${row.studentName}（${row.studentNo}）」？删除后为逻辑删除，可在数据库中找回。`,
      '删除确认',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  await deleteStudent(row.stage, row.studentId);
  ElMessage.success('已删除');
  load();
}

/* ---------------- 初始化 ---------------- */
async function loadAux() {
  meta.value = await getStudentMeta();
  try {
    classOptions.value = await http.get('/api/teaching/student/classes');
  } catch {
    classOptions.value = [];
  }
}

onMounted(async () => {
  await loadAux();
  await load(1);
});
</script>

<style scoped>
.tsv-tip {
  margin-bottom: 10px;
}
.tsv-cards {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.tsv-card {
  min-width: 120px;
  padding: 8px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
}
.tsv-card__k {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.tsv-card__v {
  font-size: 20px;
  font-weight: 600;
}
.tsv-card__v.ok {
  color: var(--el-color-success);
}
.tsv-card__v.warn {
  color: var(--el-color-warning);
}
.tsv-card__v.danger {
  color: var(--el-color-danger);
}
.tsv-filter {
  margin-bottom: 8px;
}
.tsv-page {
  margin-top: 10px;
  justify-content: flex-end;
}
.tsv-sec {
  margin-top: 12px;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
