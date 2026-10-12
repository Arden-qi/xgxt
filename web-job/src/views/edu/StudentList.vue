<template>
  <div class="page-container">
    <!-- ============ 统计卡（原型 renderStats）============ -->
    <div class="stat-row">
      <el-card v-for="s in statsCards" :key="s.label" shadow="never" class="stat-card">
        <div class="stat-icon" :style="{ background: s.bg, color: s.color }">{{ s.icon }}</div>
        <div class="stat-info">
          <span class="stat-num">{{ s.value }}</span>
          <span class="stat-label">{{ s.label }}</span>
        </div>
      </el-card>
    </div>

    <!-- ============ 部门 Tab（原型：初高中部 / 大学部）============ -->
    <el-card shadow="never" class="search-card">
      <el-tabs v-model="activeDept" class="dept-tabs" @tab-change="handleDeptChange">
        <el-tab-pane label="初高中部" name="1" />
        <el-tab-pane label="大学部" name="2" />
      </el-tabs>

      <el-form :model="query" inline>
        <el-form-item label="关键字">
          <el-input
            v-model="query.keyword"
            placeholder="搜索姓名 / 学号"
            clearable
            style="width: 180px"
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="学生状态">
          <el-select v-model="query.studentStatus" placeholder="全部" clearable style="width: 140px">
            <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="学习阶段">
          <el-select v-model="query.stage" placeholder="全部" clearable style="width: 140px">
            <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="班级">
          <el-select
            v-model="query.className"
            placeholder="全部"
            clearable
            filterable
            :loading="classOptionsLoading"
            style="width: 140px"
          >
            <el-option v-for="c in classOptions" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
          <el-button v-if="canAct('edu:student:add', true)" :icon="Upload" @click="importVisible = true">导入</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- ============ 表格区 ============ -->
    <el-card shadow="never" class="table-card">
      <!-- 工具栏 -->
      <div class="toolbar">
        <el-button v-if="canAct('edu:student:add', true)" type="primary" :icon="Plus" @click="handleAdd">新增学生</el-button>
      </div>

      <el-table
        v-loading="loading"
        :data="tableData"
        border
        stripe
        style="width: 100%"
        empty-text="暂无数据"
      >
        <!-- ★ 序号：与「班级信息管理」保持一致（2026-10-03） -->
        <el-table-column type="index" label="序号" width="58" align="center" fixed />
        <el-table-column prop="studentName" label="姓名" width="90" fixed />
        <el-table-column prop="studentNo" label="学号" width="120" />
        <el-table-column prop="genderName" label="性别" width="60" align="center" />
        <el-table-column prop="className" label="班级" width="100">
          <template #default="{ row }">{{ row.className || '—' }}</template>
        </el-table-column>
        <el-table-column prop="age" label="年龄" width="60" align="center">
          <template #default="{ row }">{{ row.age ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="phone" label="手机号" width="130">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </el-table-column>
        <el-table-column prop="parentPhone" label="家长手机号" width="130">
          <template #default="{ row }">{{ row.parentPhone || '—' }}</template>
        </el-table-column>
        <el-table-column prop="dormNo" label="宿舍号" width="90">
          <template #default="{ row }">{{ row.dormNo || '—' }}</template>
        </el-table-column>

        <!--
          初高中部：入学时间 → 学历 → 出勤率
          大学部  ：入学时间 → 学历  （末班次数挪到「学生状态」后面）
        -->
        <template v-if="isHigh">
          <el-table-column prop="enrollDate" label="入学时间" width="110">
            <template #default="{ row }">{{ row.enrollDate || '—' }}</template>
          </el-table-column>
          <el-table-column prop="education" label="学历" width="80">
            <template #default="{ row }">{{ row.education || '—' }}</template>
          </el-table-column>
          <el-table-column prop="attendanceRate" label="出勤率" width="80" align="center">
            <template #default="{ row }">
              {{ row.attendanceRate != null ? row.attendanceRate + '%' : '—' }}
            </template>
          </el-table-column>
        </template>
        <template v-else>
          <el-table-column prop="enrollDate" label="入学时间" width="110">
            <template #default="{ row }">{{ row.enrollDate || '—' }}</template>
          </el-table-column>
          <el-table-column prop="education" label="学历" width="80">
            <template #default="{ row }">{{ row.education || '—' }}</template>
          </el-table-column>
        </template>

        <el-table-column prop="studentStatusName" label="学生状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.studentStatus)" size="small">
              {{ row.studentStatusName }}
            </el-tag>
          </template>
        </el-table-column>

        <!-- ★ 大学部的「末班次数」：紧跟学生状态，与「班级信息管理」同序 -->
        <el-table-column
          v-if="!isHigh"
          prop="lastClassCount"
          label="末班次数"
          width="88"
          align="center"
        >
          <template #default="{ row }">{{ row.lastClassCount ?? 0 }}</template>
        </el-table-column>

        <el-table-column prop="stageName" label="学习阶段" width="100" align="center">
          <template #default="{ row }">{{ row.stageName || '—' }}</template>
        </el-table-column>

        <!-- ★ 欠费：与「班级信息管理」同一列
             后端口径：教务学生看 t_edu_payment 的「未缴」，实训学生看催费单未缴清 -->
        <el-table-column label="欠费" width="76" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.hasUnpaid" size="small" type="danger" effect="plain">欠费</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>

        <el-table-column prop="remark" label="备注" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '—' }}</template>
        </el-table-column>

        <!--
          「综合素质」只有初高中部还单列（大学部已按「班级信息管理」的口径并入备注）
          ⚠️ 班级信息管理那边 2026-09-30 就把综合素质并进备注了，这里大学部跟上
        -->
        <el-table-column
          v-if="isHigh"
          prop="quality"
          label="综合素养"
          width="160"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ row.quality || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleDetail(row)">查看</el-button>
            <!-- ★ 2026-10-03：实训同步来的学生**只读** —— 唯一数据源在就业模块，
                 要改请到「就业管理」里改，避免两边数据对不上 -->
            <el-button
              v-if="!row.readonly && canAct('edu:student:edit', true)"
              link
              type="primary"
              size="small"
              @click="handleEdit(row)"
            >
              编辑
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.size"
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        style="margin-top: 16px; justify-content: flex-end"
        @size-change="loadData"
        @current-change="loadData"
      />
    </el-card>

    <!-- ============ 查看弹窗 ============ -->
    <el-dialog v-model="detailVisible" title="学生详情" width="720px">
      <el-descriptions v-if="currentRow" :column="2" border size="small">
        <el-descriptions-item label="学号">{{ currentRow.studentNo }}</el-descriptions-item>
        <el-descriptions-item label="姓名">{{ currentRow.studentName }}</el-descriptions-item>
        <el-descriptions-item label="性别">{{ currentRow.genderName }}</el-descriptions-item>
        <el-descriptions-item label="年龄">{{ currentRow.age ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="班级">{{ currentRow.className || '—' }}</el-descriptions-item>
        <el-descriptions-item label="学习阶段">{{ currentRow.stageName || '—' }}</el-descriptions-item>
        <el-descriptions-item label="学生状态">
          <el-tag :type="statusTagType(currentRow.studentStatus)" size="small">
            {{ currentRow.studentStatusName }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="学历">{{ currentRow.education || '—' }}</el-descriptions-item>
        <el-descriptions-item label="手机号">{{ currentRow.phone || '—' }}</el-descriptions-item>
        <el-descriptions-item label="家长手机号">{{ currentRow.parentPhone || '—' }}</el-descriptions-item>
        <el-descriptions-item label="宿舍号">{{ currentRow.dormNo || '—' }}</el-descriptions-item>
        <el-descriptions-item label="入学时间">{{ currentRow.enrollDate || '—' }}</el-descriptions-item>
        <el-descriptions-item v-if="isHigh" label="出勤率">
          {{ currentRow.attendanceRate != null ? currentRow.attendanceRate + '%' : '—' }}
        </el-descriptions-item>
        <el-descriptions-item v-else label="末班次数">
          {{ currentRow.lastClassCount ?? '—' }}
        </el-descriptions-item>
        <!-- ★ 欠费：与列表列保持一致 -->
        <el-descriptions-item label="欠费">
          <el-tag v-if="currentRow.hasUnpaid" size="small" type="danger" effect="plain">
            欠费
          </el-tag>
          <span v-else>—</span>
        </el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ currentRow.remark || '—' }}</el-descriptions-item>
        <!-- 大学部不单列「综合素质」—— 已按「班级信息管理」的口径并进备注 -->
        <el-descriptions-item v-if="isHigh" label="综合素养" :span="2">
          {{ currentRow.quality || '—' }}
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 导入弹窗 ============ -->
    <el-dialog
      v-model="importVisible"
      title="导入学生"
      width="620px"
      :close-on-click-modal="false"
      @closed="resetImport"
    >
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
        <template #title>
          请先下载模板，按模板格式填写后再上传。<br />
          必填列：姓名、学号；学号重复的行会自动跳过，不会影响已有数据。
        </template>
      </el-alert>

      <el-button link type="primary" :icon="Download" style="margin-bottom: 12px" @click="downloadTemplate">
        下载导入模板
      </el-button>

      <el-upload
        ref="uploadRef"
        drag
        :auto-upload="false"
        :limit="1"
        accept=".xlsx,.xls,.csv"
        :on-change="handleFileChange"
        :on-exceed="handleFileExceed"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">支持 xlsx / xls / csv 文件，不超过 5MB</div>
        </template>
      </el-upload>

      <!-- 导入结果 -->
      <div v-if="importResult" class="import-result">
        <p class="import-summary">
          成功
          <b class="ok">{{ importResult.successCount }}</b>
          条，失败
          <b :class="importResult.failCount ? 'bad' : ''">{{ importResult.failCount }}</b>
          条
        </p>
        <el-table
          v-if="importResult.failures.length"
          :data="importResult.failures"
          size="small"
          border
          max-height="200"
        >
          <el-table-column prop="row" label="行号" width="70" align="center" />
          <el-table-column prop="studentNo" label="学号" width="130" />
          <el-table-column prop="reason" label="失败原因" show-overflow-tooltip />
        </el-table>
      </div>

      <template #footer>
        <el-button @click="importVisible = false">关闭</el-button>
        <el-button type="primary" :loading="importing" @click="handleImport">确认导入</el-button>
      </template>
    </el-dialog>

    <!-- ============ 新增/编辑弹窗 ============ -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑学生' : '新增学生'"
      width="600px"
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="学号" prop="studentNo">
          <el-input v-model="form.studentNo" placeholder="如 S20260001" :disabled="isEdit" />
        </el-form-item>
        <el-form-item label="姓名" prop="studentName">
          <el-input v-model="form.studentName" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="学生状态" prop="studentStatus">
          <el-select v-model="form.studentStatus" placeholder="留空则默认待咨询" style="width: 100%">
            <!-- ★ 表单用 statusFormOptions：不给选实训中/待就业/已就业（那些是实训模块写的，只读） -->
            <el-option v-for="s in statusFormOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
          <!-- 选到休学/退学就立刻把连带影响说清楚 -->
          <div v-if="form.studentStatus === 6 || form.studentStatus === 7" class="status-warn">
            {{ AUTO_FROZEN_TIP }}
          </div>
        </el-form-item>
        <el-form-item label="性别" prop="gender">
          <el-radio-group v-model="form.gender">
            <el-radio :value="1">男</el-radio>
            <el-radio :value="2">女</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="年龄" prop="age">
          <el-input-number v-model="form.age" :min="10" :max="60" />
        </el-form-item>
        <el-form-item label="部门" prop="deptCode">
          <el-radio-group v-model="form.deptCode">
            <el-radio :value="1">初高部</el-radio>
            <el-radio :value="2">大学部</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="班级" prop="className">
          <el-select
            v-model="form.className"
            :placeholder="isEdit ? '请选择班级' : '可不填'"
            :loading="classOptionsLoading"
            clearable
            filterable
            allow-create
            style="width: 100%"
          >
            <el-option v-for="c in classOptions" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="form.phone" placeholder="请输入手机号" />
        </el-form-item>
        <el-form-item label="家长手机号" prop="parentPhone">
          <el-input v-model="form.parentPhone" placeholder="请输入家长手机号" />
        </el-form-item>
        <el-form-item label="宿舍号" prop="dormNo">
          <el-input v-model="form.dormNo" placeholder="如 A栋301" />
        </el-form-item>
        <el-form-item label="入学时间" prop="enrollDate">
          <el-date-picker
            v-model="form.enrollDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="学历" prop="education">
          <el-input v-model="form.education" placeholder="如 初中 / 本科" />
        </el-form-item>
        <el-form-item label="学习阶段" prop="stage">
          <el-select v-model="form.stage" placeholder="请选择" clearable style="width: 100%">
            <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>

        <!-- 初高中部显示出勤率，大学部显示末班次数（与列表列保持一致） -->
        <el-form-item v-if="isHigh" label="出勤率" prop="attendanceRate">
          <el-input-number
            v-model="form.attendanceRate"
            :min="0"
            :max="100"
            :precision="1"
            :step="0.5"
          />
          <span class="form-unit">%</span>
        </el-form-item>
        <el-form-item v-else label="末班次数" prop="lastClassCount">
          <el-input-number v-model="form.lastClassCount" :min="0" :max="999" />
        </el-form-item>

        <!-- ★ 2026-10-03：大学部的「综合素质」已并进备注（与「班级信息管理」同一口径），
             所以这一栏两个部门都要能写综合素质；初高中部下面另有单独的综合素养栏 -->
        <el-form-item label="备注" prop="remark">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="3"
            placeholder="特殊心理问题、家庭变故等；综合素质（自律 / 学习能力 / 理解力 / 表达 / 交际）也记在这里"
          />
        </el-form-item>
        <el-form-item v-if="isHigh" label="综合素养" prop="quality">
          <el-input v-model="form.quality" type="textarea" :rows="2" placeholder="自律、学习能力、理解力、表达、交际等评价" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 学生档案页
 *
 * 内容取自「教务管理系统 - 学生档案」原型：
 *   - 初高中部 / 大学部 两个 Tab，两边的列略有不同
 *   - 关键字（姓名/学号）+ 学生状态 + 学习阶段 + 班级 四个筛选
 *   - 导入功能
 *   - 表格 16 列、操作「查看 | 编辑」、分页每页 10 条
 *
 * 视觉沿用本项目的 Element Plus 风格（卡片 + 表格 + 按钮），不照搬原型那套自定义配色
 */

import { ref, reactive, computed, onMounted } from 'vue';
import { canAct } from '@/store/permission';
import { ElMessage, type FormInstance, type FormRules, type UploadFile, type UploadInstance, type UploadRawFile } from 'element-plus';
import { Search, Refresh, Upload, UploadFilled, Plus, Download } from '@element-plus/icons-vue';
import {
  STUDENT_STATUS_NAME,
  STAGE_NAME,
  STAGE_RANGE_HIGH,
  STAGE_RANGE_UNIV,
  AUTO_FROZEN_TIP,
  type StudentListItem,
  type StudentQuery,
  type StudentStats,
} from 'shared-types/edu';
import {
  fetchStudentList,
  fetchStudentStats,
  fetchStudentClassOptions,
  addStudent,
  updateStudent,
  importStudents,
  IMPORT_TEMPLATE_URL,
  type ImportResult,
} from '@/api/edu/student';

/* ============ 统计卡（原型：总人数 / 在读 / 试学中 / 休学退学）============ */

const stats = ref<StudentStats>({ total: 0, active: 0, trial: 0, inactive: 0 });

const statsCards = computed(() => [
  {
    label: isHigh.value ? '初高中部总人数' : '大学部总人数',
    value: stats.value.total,
    icon: '👥',
    bg: isHigh.value ? '#e6f0ff' : '#ece9ff',
    color: isHigh.value ? '#409eff' : '#722ed1',
  },
  { label: '在读学生', value: stats.value.active, icon: '✓', bg: '#e8f8e8', color: '#67c23a' },
  { label: '试学中', value: stats.value.trial, icon: '⏳', bg: '#fff3e0', color: '#e6a23c' },
  { label: '休学/退学', value: stats.value.inactive, icon: '∅', bg: '#f0f0f0', color: '#909399' },
]);

async function loadStats() {
  try {
    stats.value = await fetchStudentStats(query.deptCode);
  } catch (e) {
    console.error('加载学生统计失败', e);
  }
}

/* ============ 部门 Tab ============ */

const activeDept = ref<string>('1');
/** true=初高中部，false=大学部 */
const isHigh = computed(() => activeDept.value === '1');

/**
 * 班级下拉选项（★ 2026-10-04 改为后端动态下发）
 *
 * 【为什么不能写死】原来这里是硬编码的
 *   初高部 ['预科1班','初一1班',…]、大学部 ['Q16'…'Q23']
 *   那是原型里的 mock 数据。真实班级已经改成 Q1~Q6，
 *   写死的结果是「下拉里选的班级在库里根本不存在」，筛不出任何东西。
 *
 * 【现在怎么拿】后端把三个来源的班级名合并去重后返回
 *   （教务 sms_edu + 大学 sms_class + 实训 sms_job）——
 *   新建班 / 推进阶段后刷新页面就能选到，不用改代码。
 */
const classOptions = ref<string[]>([]);
const classOptionsLoading = ref(false);

async function loadClassOptions(): Promise<void> {
  classOptionsLoading.value = true;
  try {
    classOptions.value = await fetchStudentClassOptions(Number(activeDept.value));
  } catch (e) {
    // 拉不到就保持空列表（下拉显示"无数据"），不写死兜底 —— 免得又出现
    // 「下拉里的班级库里不存在」这种错
    classOptions.value = [];
  } finally {
    classOptionsLoading.value = false;
  }
}

/**
 * 学习阶段（★ 2026-10-03 斌哥拍板）
 *   初高部：预科 / 初中部一~三期 / 高中部一~二期（1~6，不变）
 *   大学部：第一~第六阶段 + 实训（7~13，原来只到第四阶段）
 */
const stageOptions = computed(() => {
  const range = isHigh.value ? STAGE_RANGE_HIGH : STAGE_RANGE_UNIV;
  return range.map((v) => ({ value: v, label: STAGE_NAME[v] }));
});

/**
 * 学生状态选项（★ 2026-10-04 补齐）
 *
 * 【原来漏了什么】之前写死 `[3, 5, 6, 7]`（试学/在读/休学/退学），
 *   但库里**确实存在「待咨询(1)」**的学生 —— 下拉里没有这一项，
 *   就筛不出这部分人，页面看着像"数据丢了"。
 *
 * 【为什么要分两个】本页列表是三个来源合并的（见后端 /list）：
 *   教务 sms_edu        → 待咨询(1) 试学(3) 在读(5) 休学(6) 退学(7)
 *   大学 sms_class      → 试学(3) 在读(5) 休学(6) 退学(7)
 *   实训 sms_job        → 休学(6) 实训中(8) 待就业(9) 已就业(10)
 *   所以：
 *     · 筛选下拉 = 列表里**可能出现**的全部状态（否则筛不出来）
 *     · 新增/编辑表单 = 本模块**能写**的状态（8/9/10 由实训写、只读，不能在这里选）
 */
const STATUS_FILTER_VALUES = [1, 3, 4, 5, 6, 7, 8, 9, 10];
const STATUS_FORM_VALUES = [1, 2, 3, 4, 5, 6, 7];

const toStatusOptions = (values: number[]) =>
  values.map((v) => ({ value: v, label: STUDENT_STATUS_NAME[v] }));

/** 筛选下拉用的状态（比列表实际能出的多几个也无害，筛不到就是空） */
const statusOptions = computed(() => toStatusOptions(STATUS_FILTER_VALUES));

/** 新增/编辑表单用的状态：实训/就业三态不给选（那些记录的 readonly=true） */
const statusFormOptions = computed(() => toStatusOptions(STATUS_FORM_VALUES));

/* ============ 列表数据 ============ */

const loading = ref(false);
const tableData = ref<StudentListItem[]>([]);
const total = ref(0);

const query = reactive<StudentQuery>({
  page: 1,
  size: 10,          // 原型 pageSize = 10
  deptCode: 1,
  keyword: undefined,
  studentStatus: undefined,
  stage: undefined,
  className: undefined,
});

async function loadData() {
  loading.value = true;
  try {
    const data = await fetchStudentList(query);
    tableData.value = data.list;
    total.value = data.total;
  } catch (e) {
    console.error('加载学生列表失败', e);
  } finally {
    loading.value = false;
  }
}

/** 切换部门：条件要清掉，否则会拿上一个部门的阶段值去查 */
function handleDeptChange() {
  query.page = 1;
  query.deptCode = Number(activeDept.value);
  query.studentStatus = undefined;
  query.stage = undefined;
  query.className = undefined;
  loadData();
  loadStats();
  // ★ 2026-10-04：两个部门的班级不是一套（初高部是「预科1班」，大学部是「Q1」），要重新拉
  loadClassOptions();
}

function handleSearch() {
  query.page = 1;
  loadData();
}

function handleReset() {
  query.page = 1;
  query.size = 10;
  query.keyword = undefined;
  query.studentStatus = undefined;
  query.stage = undefined;
  query.className = undefined;
  loadData();
}

/* ============ 查看 ============ */

const detailVisible = ref(false);
const currentRow = ref<StudentListItem | null>(null);

function handleDetail(row: StudentListItem) {
  currentRow.value = row;
  detailVisible.value = true;
}

/* ============ 导入 ============ */

const importVisible = ref(false);
const importResult = ref<ImportResult | null>(null);
const importing = ref(false);
const uploadRef = ref<UploadInstance>();
/** 直接存原始 File，上传时塞进 FormData */
const pickedFile = ref<File | null>(null);

function handleFileChange(file: UploadFile) {
  importResult.value = null; // 换了文件就把上次的结果清掉
  pickedFile.value = file.raw ?? null;
}

/** 超出数量限制时，替换掉原来的文件而不是忽略新文件 */
function handleFileExceed(files: UploadFile[]) {
  uploadRef.value?.clearFiles();
  const raw = files[0] as unknown as UploadRawFile | undefined;
  if (raw) {
    uploadRef.value?.handleStart(raw);
    pickedFile.value = raw;
    importResult.value = null;
  }
}

/** 下载模板：直接用链接，走 Vite 代理到后端 */
function downloadTemplate() {
  window.location.href = IMPORT_TEMPLATE_URL;
}

async function handleImport() {
  if (!pickedFile.value) {
    ElMessage.warning('请先选择要导入的文件');
    return;
  }

  importing.value = true;
  try {
    const result = await importStudents(pickedFile.value);
    importResult.value = result;

    if (result.failCount === 0) {
      ElMessage.success(`导入成功，共 ${result.successCount} 条`);
    } else {
      ElMessage.warning(`导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`);
    }

    // 成了就刷新列表 + 统计卡
    if (result.successCount > 0) {
      loadData();
      loadStats();
    }
  } catch (e) {
    // 错误提示已在拦截器里统一处理
  } finally {
    importing.value = false;
  }
}

/** 关弹窗时清干净，下次打开是空状态 */
function resetImport() {
  importResult.value = null;
  pickedFile.value = null;
  uploadRef.value?.clearFiles();
}

/* ============ 新增 / 编辑 ============ */

const dialogVisible = ref(false);
const isEdit = ref(false);
const submitting = ref(false);
const formRef = ref<FormInstance>();

const defaultForm = {
  id: '',
  studentNo: '',
  studentName: '',
  gender: 1,
  age: 18,
  deptCode: 1,
  className: '',
  phone: '',
  parentPhone: '',
  dormNo: '',
  education: '',
  enrollDate: '',
  stage: undefined as number | undefined,
  attendanceRate: undefined as number | undefined,
  lastClassCount: 0,
  remark: '',
  quality: '',
  /** 不传则保持原值；新增时后端默认「待咨询」 */
  studentStatus: undefined as number | undefined,
};

const form = reactive({ ...defaultForm });

const rules: FormRules = {
  studentNo: [{ required: true, message: '请输入学号', trigger: 'blur' }],
  studentName: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  gender: [{ required: true, message: '请选择性别', trigger: 'change' }],
  deptCode: [{ required: true, message: '请选择部门', trigger: 'change' }],
  phone: [
    {
      pattern: /^1[3-9]\d{9}$/,
      message: '手机号格式不正确',
      trigger: 'blur',
    },
  ],
};

function handleAdd() {
  isEdit.value = false;
  Object.assign(form, defaultForm, { deptCode: Number(activeDept.value) });
  dialogVisible.value = true;
}

function handleEdit(row: StudentListItem) {
  isEdit.value = true;
  Object.assign(form, {
    id: row.studentId,
    studentNo: row.studentNo,
    studentName: row.studentName,
    gender: row.gender,
    age: row.age ?? 18,
    deptCode: row.deptCode ?? Number(activeDept.value),
    className: row.className || '',
    phone: row.phone || '',
    parentPhone: row.parentPhone || '',
    dormNo: row.dormNo || '',
    education: row.education || '',
    enrollDate: row.enrollDate || '',
    stage: row.stage ?? undefined,
    attendanceRate: row.attendanceRate ?? undefined,
    lastClassCount: row.lastClassCount ?? 0,
    remark: row.remark || '',
    quality: row.quality || '',
    studentStatus: row.studentStatus ?? undefined,
  });
  dialogVisible.value = true;
}

function resetForm() {
  formRef.value?.clearValidate();
  Object.assign(form, defaultForm);
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    if (isEdit.value) {
      // 提示语里可能带「已同步冻结 N 条缴费记录」，所以直接用后端返回的 message
      ElMessage.success(await updateStudent(form as any));
    } else {
      await addStudent(form as any);
      ElMessage.success('新增成功');
    }
    dialogVisible.value = false;
    loadData();
    loadStats();
  } catch (e) {
    // 错误提示已统一处理
  } finally {
    submitting.value = false;
  }
}

/* ============ 状态标签颜色（沿用 Element Plus 自带 type）============ */

function statusTagType(status: number): 'success' | 'warning' | 'info' | 'danger' | 'primary' {
  if (status === 5) return 'success';                 // 正式在读 → 绿
  if (status === 3 || status === 4) return 'warning'; // 试学中 / 预在读 → 橙
  if (status === 6) return 'info';                    // 休学 → 灰
  if (status === 7 || status === 11) return 'danger'; // 退学 / 流失 → 红
  return 'info';
}

onMounted(() => {
  loadData();
  loadStats();
  loadClassOptions();
});
</script>

<style scoped>
.page-container {
  padding: 16px;
}

/* === 统计卡（与宿舍/缴费页保持同一套样式）=== */
.stat-row {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.stat-card {
  flex: 1;
  min-width: 180px;
}

.stat-card :deep(.el-card__body) {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}

.stat-icon {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.stat-info {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.stat-num {
  font-size: 22px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stat-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.search-card {
  margin-bottom: 12px;
}

/* Tab 和搜索表单之间留点距离 */
.dept-tabs {
  margin: -8px 0 4px;
}

.dept-tabs :deep(.el-tabs__header) {
  margin-bottom: 8px;
}

.search-card :deep(.el-form-item) {
  margin-bottom: 0;
}

.toolbar {
  margin-bottom: 12px;
}

.table-card :deep(.el-card__body) {
  padding: 16px;
}

/* === 导入结果区 === */
.import-result {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background-color: var(--el-fill-color-lighter);
}

.import-summary {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.import-summary .ok {
  color: var(--el-color-success);
}

.import-summary .bad {
  color: var(--el-color-danger);
}

/* 选休学/退学时的连带影响提示 */
.status-warn {
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 4px;
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
  font-size: 12px;
  line-height: 1.6;
}
</style>
