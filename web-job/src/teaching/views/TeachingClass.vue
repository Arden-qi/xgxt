<template>
  <div class="tcv">
    <!-- 说明条 -->
    <el-alert class="tcv-tip" type="info" :closable="false" show-icon>
      <template #title>
        本页合并了 <b>3 个部门</b>的班级信息（初高部 / 大学部 / 实训）。
        <span class="muted">
          班级状态码三套一致（1 开放 / 2 封班 / 3 待结业 / 4 已结业）；
          但「班级编号」「结业日期」只有实训有，「今日出勤率」只有初高有 —— 表单会按部门自动隐藏不适用的字段。
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
      <!-- 2026-10-16 按批注：原「学段」筛选改名「部门」（选项 = 初高部 / 大学部 / 实训）。
           原来紧挨着的那个 deptCode「部门」下拉是**没接上接口的死筛选**
           （query.deptCode 既没进查询参数、也没进 load），批注口径下两者重名，
           这里把死掉的那个删掉，只留一个真正生效的。 -->
      <el-form-item label="部门">
        <el-select v-model="query.stage" clearable placeholder="全部部门" style="width: 130px" @change="onStageChange">
          <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="phaseOptions.length" label="阶段">
        <el-select v-model="query.phaseCode" clearable placeholder="全部" style="width: 140px">
          <el-option v-for="p in phaseOptions" :key="p.value" :label="p.label" :value="p.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="query.classStatus" clearable placeholder="全部" style="width: 120px">
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
    <el-table v-loading="loading" :data="rows" border stripe size="small">
      <!-- 2026-10-16：原来「学段」与「部门」是两列（部门列取 row.deptName），
           批注口径下重名，合并成一列 —— 取部门名，没部门就退回学段名 -->
      <el-table-column v-if="!query.stage" label="部门" width="70" align="center">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ row.deptName || row.stageName }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="班级名称" min-width="130">
        <template #default="{ row }">
          <a class="link" @click="openDetail(row)">{{ row.className }}</a>
        </template>
      </el-table-column>
      <!-- ★ 只有实训有这一列 -->
      <el-table-column v-if="hasClassCodeCol" label="班级编号" width="130">
        <template #default="{ row }">{{ row.classCode || '—' }}</template>
      </el-table-column>
      <el-table-column label="阶段" width="110" align="center">
        <template #default="{ row }">{{ row.phaseName || '—' }}</template>
      </el-table-column>
      <el-table-column label="班主任" width="100">
        <template #default="{ row }">{{ row.headTeacherName || '—' }}</template>
      </el-table-column>
      <el-table-column label="教员" width="90">
        <template #default="{ row }">{{ row.teacherName || '—' }}</template>
      </el-table-column>
      <el-table-column label="助教" width="90">
        <template #default="{ row }">{{ row.assistantName || '—' }}</template>
      </el-table-column>
      <!-- ★ 只有大学/实训有交棒岗位（初高没有） -->
      <el-table-column v-if="!query.stage || query.stage !== 'jh'" label="项目经理" width="100">
        <template #default="{ row }">{{ row.projectManagerName || '—' }}</template>
      </el-table-column>
      <el-table-column v-if="!query.stage || query.stage !== 'jh'" label="就业老师" width="100">
        <template #default="{ row }">{{ row.employmentTeacherName || '—' }}</template>
      </el-table-column>
      <el-table-column label="人数" width="70" align="center">
        <template #default="{ row }">
          <b>{{ row.studentCount }}</b>
        </template>
      </el-table-column>
      <!-- ★ 列头按学段口径动态改字：初高是「今日」出勤率，别写成「出勤率」 -->
      <el-table-column :label="rateLabel" width="100" align="center">
        <template #default="{ row }">
          <span v-if="row.attendanceRate === null">—</span>
          <span v-else :class="rateClass(row)">{{ row.attendanceRate }}%</span>
        </template>
      </el-table-column>
      <el-table-column label="教室" width="130">
        <template #default="{ row }">{{ row.classroom || '—' }}</template>
      </el-table-column>
      <el-table-column label="开班日期" width="110" align="center">
        <template #default="{ row }">{{ row.openDate || '—' }}</template>
      </el-table-column>
      <!-- ★ 只有实训有结业日期 -->
      <el-table-column v-if="hasCloseDateCol" label="结业日期" width="110" align="center">
        <template #default="{ row }">{{ row.closeDate || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="tagType(row.classStatus)" size="small">{{ row.classStatusName }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">花名册</el-button>
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
          <el-descriptions-item label="部门">{{ detail.base.stageName }}</el-descriptions-item>
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
          <!-- 2026-10-15 按批注：删除「学段」选择器，学段由「部门」自动判定
               （初高部 → 初高；大学部 → 大学；实训从实训页签进入仍可新增） -->
          <el-col :span="8">
            <el-form-item label="班级名称">
              <el-input v-model="form.className" maxlength="50" placeholder="留空自动生成占位名" />
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
              <el-select v-model="form.deptCode" clearable style="width: 100%" @change="onFormDeptChange">
                <el-option v-for="d in DEPT_OPTIONS" :key="d.value" :label="d.label" :value="d.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <!-- ★ 2026-10-16 阶段方案：阶段下拉改成「先选方案，再选阶段」 -->
          <el-col v-if="formPlanOptions.length" :span="8">
            <el-form-item label="阶段方案">
              <el-select v-model="formPlanId" clearable placeholder="请选择" style="width: 100%">
                <el-option v-for="p in formPlanOptions" :key="p.id" :label="p.name" :value="p.id" />
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
          <!-- 2026-10-15 改版：删除「班主任/教员/助教」工号/ID 输入框，
               姓名字段直接接入权限管理的用户列表，下拉选择（选人自动带 ID） -->
          <el-col :span="8">
            <el-form-item label="班主任姓名">
              <el-select
                v-model="form.headTeacherId"
                clearable
                filterable
                placeholder="接入权限管理，请选择"
                :loading="staffLoading"
                style="width: 100%"
                @change="onStaffChange('headTeacher', $event)"
              >
                <el-option
                  v-for="u in withFallback(staffOptions, form.headTeacherId, form.headTeacherName)"
                  :key="u.id"
                  :label="u.userName"
                  :value="u.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="教员姓名">
              <el-select
                v-model="form.teacherId"
                clearable
                filterable
                placeholder="接入权限管理，请选择"
                :loading="staffLoading"
                style="width: 100%"
                @change="onStaffChange('teacher', $event)"
              >
                <el-option
                  v-for="u in withFallback(staffOptions, form.teacherId, form.teacherName)"
                  :key="u.id"
                  :label="u.userName"
                  :value="u.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="助教姓名">
              <el-select
                v-model="form.assistantId"
                clearable
                filterable
                placeholder="接入权限管理，请选择"
                :loading="staffLoading"
                style="width: 100%"
                @change="onStaffChange('assistant', $event)"
              >
                <el-option
                  v-for="u in withFallback(staffOptions, form.assistantId, form.assistantName)"
                  :key="u.id"
                  :label="u.userName"
                  :value="u.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <!-- 2026-10-16 按批注：加回「项目经理姓名 / 就业老师姓名」——不再是工号/ID 输入框，
               而是和 班主任/教员/助教 同一套规则：下拉取自「权限管理」用户列表，选人自动带 ID。
               ★ 只有「阶段 = 实训」时才必填（见 isTrainPhase / rules）。
               ⚠️ 初高部的表没有这几列，所以只对 大学部 / 实训 显示（与「大学学号」下线的口径一致）。 -->
          <template v-if="form.stage !== 'jh'">
            <el-col :span="8">
              <el-form-item label="项目经理姓名" prop="projectManagerName">
                <el-select
                  v-model="form.projectManagerId"
                  clearable
                  filterable
                  placeholder="接入权限管理，请选择"
                  :loading="staffLoading"
                  style="width: 100%"
                  @change="onStaffChange('projectManager', $event)"
                >
                  <el-option
                    v-for="u in withFallback(staffOptions, form.projectManagerId, form.projectManagerName)"
                    :key="u.id"
                    :label="u.userName"
                    :value="u.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="就业老师姓名" prop="employmentTeacherName">
                <el-select
                  v-model="form.employmentTeacherId"
                  clearable
                  filterable
                  placeholder="接入权限管理，请选择"
                  :loading="staffLoading"
                  style="width: 100%"
                  @change="onStaffChange('employmentTeacher', $event)"
                >
                  <el-option
                    v-for="u in withFallback(staffOptions, form.employmentTeacherId, form.employmentTeacherName)"
                    :key="u.id"
                    :label="u.userName"
                    :value="u.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
          </template>
          <!-- 2026-10-19 批注：教室按「楼栋-房间号」规定格式输出，例如 A-201。
               输入宽容（A栋-102 / 教学楼 A-102 / a102 都能写），失焦即归一；
               认不出来的格式保存时会被拦下并提示正确写法。 -->
          <el-col :span="8">
            <el-form-item :label="curMeta?.classroomLabel || '教室'" prop="classroom">
              <el-input
                v-model="form.classroom"
                :placeholder="`例如：${CLASSROOM_EXAMPLE}`"
                maxlength="20"
                clearable
                @blur="onClassroomBlur"
              />
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
          title="班主任 / 教员 / 助教 均为可选，姓名来自「权限管理」的用户列表；初高部的表没有「项目经理姓名 / 就业老师姓名 / 大学学号」这几列，所以这个学段不显示"
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
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { isReadOnlyUser } from '@/store/permission';
import { visibleStageOptions } from '@/teaching/access';
import { DeptCode } from 'shared-types';
import { userApi } from '@/perm/api/perm';
import type { PermUserListItem } from 'shared-types/perm';
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
  type StagePlanOption,
} from '@/teaching/api/class';
// 教室「楼栋-房间号」格式：归一 + 校验（前后端同一套规则，见文件头注释）
import {
  CLASSROOM_EXAMPLE,
  CLASSROOM_TIP,
  isClassroomValid,
  normalizeClassroom,
} from '@/teaching/classroom';

/* ---------------- 学段可见性（第 3 期：判权不再依赖旧路由） ---------------- */
const STAGE_LABEL: Record<ClassStage, string> = { jh: '初高部', class: '大学部', job: '实训' };

const stageOptions = computed(() => visibleStageOptions('class', CLASS_STAGES, STAGE_LABEL));

/* ---------------- 列表 ---------------- */
const loading = ref(false);
const rows = ref<ClassRow[]>([]);
const total = ref(0);
const summary = ref<ClassSummary[]>([]);
const metaList = ref<ClassStageMeta[]>([]);

const query = reactive({
  // 「部门」筛选复用 stage：初高部 = jh、大学部 = class、实训 = job
  stage: undefined as ClassStage | undefined,
  classStatus: undefined as number | undefined,
  phaseCode: undefined as number | undefined,
  keyword: '',
  page: 1,
  size: 20,
});

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

/** 阶段码里的「实训」：班级/学生两边的阶段表都用 13 = 实训 */
const TRAIN_PHASE_CODE = 13;
/** 是否处于「实训」阶段 —— 决定「项目经理姓名 / 就业老师姓名」要不要必填 */
const isTrainPhase = computed(() => Number(form.phaseCode) === TRAIN_PHASE_CODE);

/**
 * 表单校验规则
 *   2026-10-15 改版：学段 / 班级名称 / 部门 / 班主任 / 教员 / 阶段 全部不再必填；
 *   2026-10-16 批注：「项目经理姓名 / 就业老师姓名」**只在阶段 = 实训时**必填。
 *   规则写成 computed，切换阶段后红星与校验会立刻跟着变。
 */
const rules = computed<FormRules>(() => ({
  projectManagerName: isTrainPhase.value
    ? [{ required: true, message: '实训阶段必填', trigger: 'change' }]
    : [],
  employmentTeacherName: isTrainPhase.value
    ? [{ required: true, message: '实训阶段必填', trigger: 'change' }]
    : [],
  /**
   * 2026-10-19 批注：教室必须输出成「楼栋-房间号」，例如 A-201。
   * 校验看的是**归一后**的值 —— 输入 A栋-102 / 教学楼 A-102 也算合规（失焦时会自动改成 A-102），
   * 只有认不出来的写法（比如只写 102、带中文描述的一串）才会被拦。
   */
  classroom: [
    {
      validator: (_rule, value, callback) => {
        if (isClassroomValid(value)) callback();
        else callback(new Error(CLASSROOM_TIP));
      },
      trigger: 'blur',
    },
  ],
}));

/** 教室失焦即归一：A栋-102 / 教学楼 A-102 / a102 → A-102（不改变语义，只统一写法） */
function onClassroomBlur() {
  form.classroom = normalizeClassroom(form.classroom);
}

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

/** 表单里的阶段选项：★ 2026-10-16 改为「方案驱动」——
 *   选了方案 → 只给该方案下的阶段（新方案里的新阶段也能选到）；
 *   没选方案 → 回落到 meta 的阶段清单（此时初高仍按旧口径过滤掉预科）。 */
const JH_PHASE_CODES = [102, 103, 104, 105, 106, 107];

/** 全部阶段方案（来自后端 meta，两个部门的方案都在里面） */
const planOptionsAll = computed<StagePlanOption[]>(
  () => metaList.value.find((m) => m.planOptions?.length)?.planOptions || [],
);
/** 表单里可选的方案：按「部门」过滤 */
const formPlanOptions = computed(() => planOptionsAll.value.filter((p) => p.deptCode === form.deptCode));
/** 表单当前选中的方案 ID（只用于联动，不入库） */
const formPlanId = ref('');

const formPhaseOptions = computed(() => {
  const plan = planOptionsAll.value.find((p) => p.id === formPlanId.value);
  if (plan) return plan.phases;
  const list = metaList.value.find((m) => m.stage === form.stage)?.phaseOptions || [];
  if (form.stage === 'jh') return list.filter((p) => JH_PHASE_CODES.includes(p.value));
  return list;
});

/** 阶段码 → 方案 ID（编辑回显时反查） */
function planIdOfPhase(phaseCode: number | null | undefined): string {
  if (!phaseCode) return '';
  return planOptionsAll.value.find((p) => p.phases.some((x) => x.value === Number(phaseCode)))?.id || '';
}

/* ============ 2026-10-15 改版：删除「学段」选择器，学段由部门判定 ============ */

/** 部门变化 → 自动判定学段（初高部 → 初高；大学部 → 大学）；实训学段不选部门时保持原值 */
function onFormDeptChange(v: number | undefined) {
  if (v === DeptCode.JUNIOR_SENIOR) form.stage = 'jh';
  else if (v === DeptCode.UNIVERSITY) form.stage = 'class';
  // ★ 2026-10-16 部门变了 → 原来选的「阶段方案」可能不属于新部门，先清掉
  if (!formPlanOptions.value.some((p) => p.id === formPlanId.value)) formPlanId.value = '';
  // 学段变了：阶段按新学段重选（onFormStageChange 会清编号/交棒/备注等学段特有字段）
  if (!formPhaseOptions.value.some((p) => p.value === form.phaseCode)) form.phaseCode = undefined;
  onFormStageChange();
}

/* ============ 2026-10-15 改版：班主任/教员/助教接入「权限管理」用户列表 ============ */

const staffLoading = ref(false);
const staffOptions = ref<PermUserListItem[]>([]);

async function loadStaff() {
  staffLoading.value = true;
  try {
    // ⚠️ /api/perm/user/list 的 size 上限 100 —— 按 100/页自动翻页拉全量（≤5 页封顶）
    const out: PermUserListItem[] = [];
    const size = 100;
    const first = await userApi.list({ page: 1, size });
    out.push(...(first.list || []));
    const pages = Math.ceil((first.total || 0) / size);
    for (let p = 2; p <= Math.min(pages, 5); p++) {
      const d = await userApi.list({ page: p, size });
      out.push(...(d.list || []));
    }
    staffOptions.value = out;
  } catch {
    staffOptions.value = [];
  } finally {
    staffLoading.value = false;
  }
}

/** 编辑老班级时，原工号/ID 可能不在权限用户列表里 —— 兜底补一个选项，避免显示成裸 ID */
function withFallback(
  list: PermUserListItem[],
  id: string | null | undefined,
  name: string | null | undefined,
): PermUserListItem[] {
  if (!id || list.some((u) => u.id === id)) return list;
  return [{ id, userName: name || id } as PermUserListItem, ...list];
}

/** 岗位种类：前三个是建班岗位，后两个是交棒岗位（阶段=实训时必填） */
type StaffKind = 'headTeacher' | 'teacher' | 'assistant' | 'projectManager' | 'employmentTeacher';

/** 选人自动带姓名；清空时姓名一并清掉 */
function onStaffChange(kind: StaffKind, id: string) {
  const name = staffOptions.value.find((x) => x.id === id)?.userName || '';
  if (kind === 'headTeacher') form.headTeacherName = name;
  else if (kind === 'teacher') form.teacherName = name;
  else if (kind === 'assistant') form.assistantName = name;
  else if (kind === 'projectManager') form.projectManagerName = name;
  else form.employmentTeacherName = name;
}

function openCreate() {
  const stage = (query.stage || stageOptions.value[0]?.value || 'jh') as ClassStage;
  Object.assign(form, emptyForm(stage));
  formPlanId.value = '';
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
  // ★ 2026-10-16 反查这个阶段属于哪个方案，让「阶段方案」下拉回显
  formPlanId.value = planIdOfPhase(row.phaseCode);
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
  else ElMessage.info('该部门没有班级编号（只有实训有）');
}

async function doSave() {
  // 教室在提交前再归一一次：只用键盘 Enter 提交时不一定触发过 blur
  form.classroom = normalizeClassroom(form.classroom);
  // 校验不通过就别往下走：原来直接 await validate() 会把 reject 抛成未捕获异常，
  // 界面上只有字段下面那行红字，看不到任何提示（加了「实训必填」规则后更容易踩到）
  if (formRef.value) {
    const ok = await formRef.value.validate().catch(() => false);
    if (!ok) return;
  }
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

onMounted(() => {
  load(1);
  loadStaff();
});
</script>

<style scoped>
.tcv {
  padding: 12px;
}
.tcv-tip {
  margin-bottom: 10px;
}
.muted {
  color: #909399;
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
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 10px 14px;
  min-width: 190px;
}
.tcv-card__k {
  font-size: 12px;
  color: #909399;
}
.tcv-card__v {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.4;
}
.tcv-card__x {
  font-size: 12px;
  color: #606266;
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
  color: #409eff;
  cursor: pointer;
}
.ok {
  color: #67c23a;
}
.warn {
  color: #e6a23c;
}
.danger {
  color: #f56c6c;
}
</style>