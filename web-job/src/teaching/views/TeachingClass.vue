<template>
  <div class="tcv">
    <!-- 说明条 -->
    <el-alert class="tcv-tip" type="info" :closable="false" show-icon>
      <template #title>
        本页合并了 <b>3 个学段</b>的班级信息（初高 / 大学 / 实训）。
        <span class="muted">
          班级状态码三套一致（1 开放 / 2 封班 / 3 待结业 / 4 已结业）；
          但「班级编号」「结业日期」只有实训有，「今日出勤率」只有初高有 —— 表单会按学段自动隐藏不适用的字段。
        </span>
      </template>
    </el-alert>

    <!-- 统计卡片（多学段时按学段分行） -->
    <div class="tcv-cards">
      <div v-for="s in summary" :key="s.stage" class="tcv-card">
        <div class="tcv-card__k">{{ s.stageName }}班级</div>
        <div class="tcv-card__v">{{ s.total }}</div>
        <div class="tcv-card__x">
          <span class="ok">开放 {{ s.openCount }}</span>
          <span>封班 {{ s.closedCount }}</span>
          <span class="warn">待结业 {{ s.graduatingCount }}</span>
          <span class="danger">已结业 {{ s.graduatedCount }}</span>
        </div>
        <div class="tcv-card__x">在班学生 {{ s.studentCount }} 人</div>
      </div>
      <div v-if="!summary.length" class="tcv-card">
        <div class="tcv-card__k">暂无数据</div>
        <div class="tcv-card__v">0</div>
      </div>
    </div>

    <!-- 筛选 -->
    <el-form class="tcv-filter" inline>
      <el-form-item label="学段">
        <el-select v-model="query.stage" clearable placeholder="全部学段" style="width: 130px" @change="onStageChange">
          <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="部门">
        <el-select v-model="query.deptCode" clearable placeholder="全部部门" style="width: 120px" @change="load(1)">
          <el-option v-for="d in DEPT_OPTIONS" :key="d.value" :label="d.label" :value="d.value" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="phaseOptions.length" label="阶段">
        <el-select v-model="query.phaseCode" clearable placeholder="全部" style="width: 140px" @change="load(1)">
          <el-option v-for="p in phaseOptions" :key="p.value" :label="p.label" :value="p.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="query.classStatus" clearable placeholder="全部" style="width: 120px" @change="load(1)">
          <el-option v-for="(n, v) in CLASS_STATUS_NAME" :key="v" :label="n" :value="Number(v)" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="query.keyword"
          placeholder="班级名 / 编号 / 班主任"
          clearable
          style="width: 180px"
          @keyup.enter="load(1)"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="load(1)">查询</el-button>
        <el-button @click="reset">重置</el-button>
        <el-button v-if="!isReadOnlyUser" type="success" @click="openCreate">新增班级</el-button>
      </el-form-item>
    </el-form>

    <!-- 列表 -->
    <!-- ★ 列宽纪律：内容大多只有 2~4 个字，一律用 min-width 让浏览器按需收缩/伸展，
         不要拍固定 width —— 之前 17 列固定宽度合计约 1800px，屏幕装不下，
         每列一大片空白（学生档案页 12 列约 1215px，是对照基准）。 -->
    <el-table v-loading="loading" :data="rows" border stripe size="small">
      <el-table-column v-if="!query.stage" label="学段" width="72" align="center">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ row.stageName }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="班级名称" min-width="110">
        <template #default="{ row }">
          <a class="link" @click="openDetail(row)">{{ row.className }}</a>
        </template>
      </el-table-column>
      <!-- ★ 只有实训有这一列 -->
      <el-table-column v-if="hasClassCodeCol" label="班级编号" min-width="105">
        <template #default="{ row }">{{ row.classCode || '—' }}</template>
      </el-table-column>
      <!-- 部门列已去掉：dept(1初高部/2大学部) 完全由学段决定，与「学段」标签重复 -->
      <el-table-column label="阶段" min-width="90" align="center">
        <template #default="{ row }">{{ row.phaseName || '—' }}</template>
      </el-table-column>
      <el-table-column label="班主任" min-width="70">
        <template #default="{ row }">{{ row.headTeacherName || '—' }}</template>
      </el-table-column>
      <el-table-column label="教员" min-width="70">
        <template #default="{ row }">{{ row.teacherName || '—' }}</template>
      </el-table-column>
      <el-table-column label="助教" min-width="70">
        <template #default="{ row }">{{ row.assistantName || '—' }}</template>
      </el-table-column>
      <!-- ★ 只有大学/实训有交棒岗位（初高没有） -->
      <el-table-column v-if="!query.stage || query.stage !== 'jh'" label="项目经理" min-width="80">
        <template #default="{ row }">{{ row.projectManagerName || '—' }}</template>
      </el-table-column>
      <el-table-column v-if="!query.stage || query.stage !== 'jh'" label="就业老师" min-width="80">
        <template #default="{ row }">{{ row.employmentTeacherName || '—' }}</template>
      </el-table-column>
      <el-table-column label="人数" width="55" align="center">
        <template #default="{ row }">
          <b>{{ row.studentCount }}</b>
        </template>
      </el-table-column>
      <!-- ★ 列头按学段口径动态改字：初高是「今日」出勤率，别写成「出勤率」 -->
      <el-table-column :label="rateLabel" min-width="92" align="center">
        <template #default="{ row }">
          <span v-if="row.attendanceRate === null">—</span>
          <span v-else :class="rateClass(row)">{{ row.attendanceRate }}%</span>
        </template>
      </el-table-column>
      <el-table-column label="教室" min-width="95">
        <template #default="{ row }">{{ row.classroom || '—' }}</template>
      </el-table-column>
      <el-table-column label="开班日期" min-width="100" align="center">
        <template #default="{ row }">{{ row.openDate || '—' }}</template>
      </el-table-column>
      <!-- ★ 只有实训有结业日期 -->
      <el-table-column v-if="hasCloseDateCol" label="结业日期" min-width="100" align="center">
        <template #default="{ row }">{{ row.closeDate || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="70" align="center">
        <template #default="{ row }">
          <el-tag :type="tagType(row.classStatus)" size="small">{{ row.classStatusName }}</el-tag>
        </template>
      </el-table-column>
      <!-- 「花名册」按钮已去掉：班级名称本身就是链接，点开就是花名册抽屉 -->
      <el-table-column label="操作" width="172" fixed="right" align="center">
        <template #default="{ row }">
          <el-button v-if="!isReadOnlyUser" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="!isReadOnlyUser && row.canChangeStatus" link type="warning" @click="openStatus(row)">
            改状态
          </el-button>
          <el-button v-if="!isReadOnlyUser" link type="danger" @click="doDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="tcv-page"
      layout="total, sizes, prev, pager, next"
      :total="total"
      :current-page="query.page"
      :page-size="query.size"
      :page-sizes="[10, 20, 50, 100]"
      @current-change="load"
      @size-change="load(1)"
    />

    <!-- ============ 详情 / 花名册 ============ -->
    <el-drawer v-model="detailVisible" :title="`${detail?.base.className || ''} · 花名册`" size="560px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="学段">{{ detail.base.stageName }}</el-descriptions-item>
          <el-descriptions-item label="班级名称">{{ detail.base.className }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.base.classCode" label="班级编号">
            {{ detail.base.classCode }}
          </el-descriptions-item>
          <el-descriptions-item label="阶段">{{ detail.base.phaseName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="班主任">{{ detail.base.headTeacherName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="教员">{{ detail.base.teacherName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="助教">{{ detail.base.assistantName || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.base.projectManagerName" label="项目经理">
            {{ detail.base.projectManagerName }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.base.employmentTeacherName" label="就业老师">
            {{ detail.base.employmentTeacherName }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.base.universityNo" label="大学学号">
            {{ detail.base.universityNo }}
          </el-descriptions-item>
          <el-descriptions-item :label="detail.base.stage === 'job' ? '教室地点' : '教室'">
            {{ detail.base.classroom || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="开班日期">{{ detail.base.openDate || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.base.closeDate" label="结业日期">
            {{ detail.base.closeDate }}
          </el-descriptions-item>
          <el-descriptions-item label="在班人数">{{ detail.base.studentCount }}</el-descriptions-item>
          <el-descriptions-item :label="detail.base.attendanceRateKind === 'today' ? '今日出勤率' : '累计出勤率'">
            {{ detail.base.attendanceRate === null ? '—' : `${detail.base.attendanceRate}%` }}
          </el-descriptions-item>
          <el-descriptions-item label="班级状态">
            <el-tag :type="tagType(detail.base.classStatus)" size="small">
              {{ detail.base.classStatusName }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">花名册（{{ detail.roster.length }} 人）</el-divider>
        <el-table :data="detail.roster" border size="small" max-height="420">
          <el-table-column label="学号" width="110">
            <template #default="{ row }">{{ row.studentNo || '—' }}</template>
          </el-table-column>
          <el-table-column label="姓名" width="100">
            <template #default="{ row }">{{ row.studentName || '—' }}</template>
          </el-table-column>
          <el-table-column label="性别" width="60" align="center">
            <template #default="{ row }">{{ row.genderName || '—' }}</template>
          </el-table-column>
          <!-- ★ 只有实训有独立花名册表，才有入班方式 -->
          <el-table-column v-if="detail.base.stage === 'job'" label="入班方式" width="100">
            <template #default="{ row }">{{ row.joinTypeName || '—' }}</template>
          </el-table-column>
          <el-table-column label="入班日期" width="110" align="center">
            <template #default="{ row }">{{ row.joinDate || '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">{{ row.inClassStatusName || '—' }}</template>
          </el-table-column>
        </el-table>
      </template>
    </el-drawer>

    <!-- ============ 新增 / 编辑 ============ -->
    <el-dialog
      v-model="editVisible"
      :title="form.id ? '编辑班级' : '新增班级'"
      width="820px"
      top="6vh"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="学段" required>
              <el-select v-model="form.stage" :disabled="!!form.id" style="width: 100%" @change="onFormStageChange">
                <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="班级名称" required>
              <el-input v-model="form.className" maxlength="50" />
            </el-form-item>
          </el-col>
          <!-- ★ 只有实训有班级编号（而且必填 + 唯一） -->
          <el-col v-if="curMeta?.hasClassCode" :span="8">
            <el-form-item label="班级编号" required>
              <el-input v-model="form.classCode" maxlength="32" placeholder="如 SX20260001">
                <template #append>
                  <el-link type="primary" @click="doGenCode">生成</el-link>
                </template>
              </el-input>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="部门">
              <el-select v-model="form.deptCode" style="width: 100%">
                <el-option v-for="d in DEPT_OPTIONS" :key="d.value" :label="d.label" :value="d.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col v-if="formPhaseOptions.length" :span="8">
            <el-form-item label="阶段">
              <el-select v-model="form.phaseCode" clearable placeholder="请选择" style="width: 100%">
                <el-option v-for="p in formPhaseOptions" :key="p.value" :label="p.label" :value="p.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <!-- ★ 初高班主任是 NOT NULL，必须填 -->
          <el-col :span="8">
            <el-form-item label="班主任" :required="form.stage === 'jh'">
              <el-input v-model="form.headTeacherId" placeholder="工号/ID" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="班主任姓名">
              <el-input v-model="form.headTeacherName" placeholder="列表显示用" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="教员">
              <el-input v-model="form.teacherId" placeholder="工号/ID" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="教员姓名">
              <el-input v-model="form.teacherName" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="助教">
              <el-input v-model="form.assistantId" placeholder="工号/ID" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="助教姓名">
              <el-input v-model="form.assistantName" />
            </el-form-item>
          </el-col>
          <!-- ★ 只有大学/实训有交棒岗位 -->
          <template v-if="form.stage !== 'jh'">
            <el-col :span="8">
              <el-form-item label="项目经理">
                <el-input v-model="form.projectManagerId" placeholder="工号/ID" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="项目经理姓名">
                <el-input v-model="form.projectManagerName" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="就业老师">
                <el-input v-model="form.employmentTeacherId" placeholder="工号/ID" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="就业老师姓名">
                <el-input v-model="form.employmentTeacherName" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="大学学号">
                <el-input v-model="form.universityNo" />
              </el-form-item>
            </el-col>
          </template>
          <el-col :span="8">
            <el-form-item :label="curMeta?.classroomLabel || '教室'">
              <el-input v-model="form.classroom" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="开班日期">
              <el-date-picker v-model="form.openDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <!-- ★ 只有实训有结业日期 -->
          <el-col v-if="curMeta?.hasCloseDate" :span="8">
            <el-form-item label="结业日期">
              <el-date-picker v-model="form.closeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <!-- ★ 大学那张表没有 remark 列 -->
          <el-col v-if="form.stage !== 'class'" :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" show-word-limit />
            </el-form-item>
          </el-col>
        </el-row>

        <el-alert
          v-if="form.stage === 'job'"
          type="info"
          :closable="false"
          show-icon
          title="实训班新建时默认「封班」状态 —— 能进实训/就业阶段的班级只会是封班，「开放」已废弃"
        />
        <el-alert
          v-if="form.stage === 'class'"
          type="info"
          :closable="false"
          show-icon
          title="大学班级没有「班级编号」也没有「备注」字段（那两张表里就没这两列），改动不会生效"
        />
        <el-alert
          v-if="form.stage === 'jh'"
          type="info"
          :closable="false"
          show-icon
          title="初高班级必须指定班主任；没有「项目经理 / 就业老师 / 大学学号」这些交棒字段"
        />
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 改状态 ============ -->
    <el-dialog v-model="statusVisible" title="变更班级状态" width="440px">
      <el-form label-width="90px">
        <el-form-item label="当前状态">
          <el-tag v-if="statusRow" :type="tagType(statusRow.classStatus)">{{ statusRow.classStatusName }}</el-tag>
        </el-form-item>
        <el-form-item label="变更为" required>
          <el-select v-model="statusTo" placeholder="请选择" style="width: 100%">
            <el-option
              v-for="s in allowedStatusList"
              :key="s.value"
              :label="s.label"
              :value="s.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <el-alert
        v-if="statusTo === 4"
        type="warning"
        :closable="false"
        show-icon
        title="结业是终态：改完不能再退回开放/封班。实训班还会自动写入结业日期。"
      />
      <template #footer>
        <el-button @click="statusVisible = false">取消</el-button>
        <el-button type="primary" :loading="statusSaving" @click="doChangeStatus">确定变更</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 统一班级信息页（第 2 期 · 第七个合并的业务域）
 * ============================================================
 * 合并了 3 个学段（初高 / 大学 / 实训）的班级管理：
 *   · 一个页面 + 学段筛选（不再 3 个页面各一套）
 *   · 「班级编号 / 结业日期 / 交棒岗位 / 备注」按学段自动显隐
 *     —— 由后端 /meta 下发的 hasClassCode / hasCloseDate 决定，**不写死学段判断**
 *   · 状态机统一（1 开放 / 2 封班 / 3 待结业 / 4 已结业），非法流转后端会拦
 *
 * 【★ 与学生档案页最大的不同：不按名字去重】
 *   「初高 G104」和「大学 G104」是两个不同的班，同名是常态。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useBreadcrumbStageKey } from '@/store/breadcrumb';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { isReadOnlyUser } from '@/store/permission';
import { visibleStageOptions } from '@/teaching/access';
import {
  listClasses,
  getClassDetail,
  saveClass,
  deleteClass,
  changeClassStatus,
  getClassMeta,
  getClassSummary,
  genClassCode,
  CLASS_STATUS_NAME,
  CLASS_STATUS_TAG,
  CLASS_STAGES,
  DEPT_OPTIONS,
  type ClassDetail,
  type ClassRow,
  type ClassSaveBody,
  type ClassStage,
  type ClassStageMeta,
  type ClassSummary,
} from '@/teaching/api/class';

/* ---------------- 学段可见性（第 3 期：判权不再依赖旧路由） ---------------- */
const STAGE_LABEL: Record<ClassStage, string> = { jh: '初高', class: '大学', job: '实训' };

const stageOptions = computed(() => visibleStageOptions('class', CLASS_STAGES, STAGE_LABEL));

/* ---------------- 列表 ---------------- */
const loading = ref(false);
const rows = ref<ClassRow[]>([]);
const total = ref(0);
const summary = ref<ClassSummary[]>([]);
const metaList = ref<ClassStageMeta[]>([]);

const query = reactive({

  stage: undefined as ClassStage | undefined,
  deptCode: undefined as number | undefined,
  classStatus: undefined as number | undefined,
  phaseCode: undefined as number | undefined,
  keyword: '',
  page: 1,
  size: 20,
});

/* 面包屑第 4 级：当前正在查看的学段（筛选器变化时自动同步，页面卸载自动清空） */
useBreadcrumbStageKey(() => query.stage || '');

/** 当前所选学段的 meta（列显隐/标签都靠它） */
const curMeta = computed(() => metaList.value.find((m) => m.stage === query.stage) || null);
const phaseOptions = computed(() => curMeta.value?.phaseOptions || []);

/** 未选学段时，只要任一可见学段有编号/结业日期就显示该列 */
const hasClassCodeCol = computed(() =>
  query.stage ? !!curMeta.value?.hasClassCode : metaList.value.some((m) => m.hasClassCode),
);
const hasCloseDateCol = computed(() =>
  query.stage ? !!curMeta.value?.hasCloseDate : metaList.value.some((m) => m.hasCloseDate),
);

/**
 * ★ 出勤率列头必须随口径变：初高是「今日出勤率」，大学/实训是「累计出勤率」。
 *   混着写会被读成同一种指标 —— 今日 92% 和累计 92% 完全不是一回事。
 *   （判断依据直接用初高这个固定事实，不去猜 meta 的其它标志位。）
 */
const rateLabel = computed(() => {
  if (!query.stage) return '出勤率';
  return query.stage === 'jh' ? '今日出勤率' : '累计出勤率';
});

function rateClass(row: ClassRow): string {
  if (row.attendanceRate === null) return '';
  if (row.attendanceRate < 90) return 'danger';
  if (row.attendanceRate < 95) return 'warn';
  return 'ok';
}

function tagType(s: number): string {
  return (CLASS_STATUS_TAG[s] || 'info') as never;
}

async function load(page?: number) {
  if (page) query.page = page;
  loading.value = true;
  try {
    const [r, s, m] = await Promise.all([
      listClasses({ ...query }),
      getClassSummary({ ...query }),
      metaList.value.length ? Promise.resolve(metaList.value) : getClassMeta(),
    ]);
    rows.value = r.list || [];
    total.value = r.total || 0;
    summary.value = s || [];
    metaList.value = m || [];
  } catch (e) {
    ElMessage.error((e as Error).message || '加载失败');
  } finally {
    loading.value = false;
  }
}

/** 切学段：阶段码和状态都是学段内的，必须清掉，否则会带着上一个学段的筛选去查 */
function onStageChange() {
  query.phaseCode = undefined;
  query.classStatus = undefined;
  load(1);
}

function reset() {
  query.stage = undefined;
  query.deptCode = undefined;
  query.classStatus = undefined;
  query.phaseCode = undefined;
  query.keyword = '';
  load(1);
}

/* ---------------- 详情 / 花名册 ---------------- */
const detailVisible = ref(false);
const detail = ref<ClassDetail | null>(null);

async function openDetail(row: ClassRow) {
  detail.value = await getClassDetail(row.stage, row.classId);
  detailVisible.value = true;
}

/* ---------------- 新增 / 编辑 ---------------- */
const editVisible = ref(false);
const saving = ref(false);
const formRef = ref<FormInstance>();

function emptyForm(stage: ClassStage): ClassSaveBody {
  return {
    stage,
    className: '',
    classCode: '',
    deptCode: stage === 'jh' ? 1 : 2,
    phaseCode: undefined,
    headTeacherId: '',
    headTeacherName: '',
    teacherId: '',
    teacherName: '',
    assistantId: '',
    assistantName: '',
    projectManagerId: '',
    projectManagerName: '',
    employmentTeacherId: '',
    employmentTeacherName: '',
    universityNo: '',
    classroom: '',
    openDate: '',
    closeDate: '',
    remark: '',
  };
}
const form = reactive<ClassSaveBody>(emptyForm('jh'));

/** 表单里的阶段选项（按表单当前学段取，不是筛选的） */
const formPhaseOptions = computed(() => metaList.value.find((m) => m.stage === form.stage)?.phaseOptions || []);

const rules: FormRules = {
  className: [{ required: true, message: '班级名称必填', trigger: 'blur' }],
};

function openCreate() {
  const stage = (query.stage || stageOptions.value[0]?.value || 'jh') as ClassStage;
  Object.assign(form, emptyForm(stage));
  editVisible.value = true;
}

function openEdit(row: ClassRow) {
  Object.assign(form, emptyForm(row.stage), {
    id: row.classId,
    className: row.className,
    classCode: row.classCode || '',
    deptCode: row.deptCode ?? undefined,
    phaseCode: row.phaseCode ?? undefined,
    headTeacherId: row.headTeacherId || '',
    headTeacherName: row.headTeacherName || '',
    teacherId: row.teacherId || '',
    teacherName: row.teacherName || '',
    assistantId: row.assistantId || '',
    assistantName: row.assistantName || '',
    projectManagerId: row.projectManagerId || '',
    projectManagerName: row.projectManagerName || '',
    employmentTeacherId: row.employmentTeacherId || '',
    employmentTeacherName: row.employmentTeacherName || '',
    universityNo: row.universityNo || '',
    classroom: row.classroom || '',
    openDate: row.openDate || '',
    closeDate: row.closeDate || '',
    remark: row.remark || '',
  });
  editVisible.value = true;
}

/** ★ 表单切学段：编号 / 交棒 / 备注字段要跟着清（否则会带着上一个学段的脏值提交） */
function onFormStageChange() {
  const keep = { id: form.id, className: form.className };
  Object.assign(form, emptyForm(form.stage), keep);
}

async function doGenCode() {
  const r = await genClassCode(form.stage);
  if (r?.classCode) form.classCode = r.classCode;
  else ElMessage.info('该学段没有班级编号（只有实训有）');
}

async function doSave() {
  await formRef.value?.validate();
  saving.value = true;
  try {
    await saveClass({ ...form });
    ElMessage.success(form.id ? '班级已更新' : '班级已创建');
    editVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function doDelete(row: ClassRow) {
  await ElMessageBox.confirm(
    `确定删除班级「${row.className}」吗？该班当前有 ${row.studentCount} 名学生，删除后不影响学生本人。`,
    '删除确认',
    { type: 'warning' },
  );
  await deleteClass(row.stage, row.classId);
  ElMessage.success('已删除');
  load();
}

/* ---------------- 改状态 ---------------- */
const statusVisible = ref(false);
const statusSaving = ref(false);
const statusRow = ref<ClassRow | null>(null);
const statusTo = ref<number | undefined>(undefined);

const allowedStatusList = computed(() =>
  Object.entries(CLASS_STATUS_NAME).map(([v, label]) => ({
    value: Number(v),
    label,
  })),
);

async function openStatus(row: ClassRow) {
  statusRow.value = row;
  statusTo.value = undefined;
  // 拉详情拿 allowedStatus（后端算的流转表，前端不自己推）
  const d = await getClassDetail(row.stage, row.classId);
  if (d && d.allowedStatus.length === 0) {
    ElMessage.warning('已结业是终态，不能再改状态');
    return;
  }
  statusVisible.value = true;
}

async function doChangeStatus() {
  if (!statusRow.value || statusTo.value === undefined) {
    ElMessage.warning('请选择目标状态');
    return;
  }
  statusSaving.value = true;
  try {
    await changeClassStatus(statusRow.value.stage, statusRow.value.classId, statusTo.value);
    ElMessage.success('状态已变更');
    statusVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error((e as Error).message || '变更失败');
  } finally {
    statusSaving.value = false;
  }
}

onMounted(() => load(1));
</script>

<style scoped>
.tcv {
  padding: 12px;
}
.tcv-tip {
  margin-bottom: 10px;
}
.muted {
  color: #A2938E;
  font-weight: normal;
}
.tcv-cards {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.tcv-card {
  background: #fff;
  border: 1px solid #F1EAE5;
  border-radius: 6px;
  padding: 10px 14px;
  min-width: 190px;
}
.tcv-card__k {
  font-size: 12px;
  color: #A2938E;
}
.tcv-card__v {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.4;
}
.tcv-card__x {
  font-size: 12px;
  color: #7A6C67;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.tcv-filter {
  background: #fff;
  padding: 10px 10px 0;
  border-radius: 6px;
}
.tcv-page {
  margin-top: 12px;
  justify-content: flex-end;
}
.link {
  color: #CD3A33;
  cursor: pointer;
}
.ok {
  color: #5FA36F;
}
.warn {
  color: #C9852E;
}
.danger {
  color: #CD3A33;
}
</style>