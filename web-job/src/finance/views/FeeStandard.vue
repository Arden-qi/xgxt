<template>
  <div class="page-container">
    <!-- ============ 说明 ============ -->
    <el-alert type="info" :closable="false" show-icon class="tip">
      <template #title>
        这里是各类费用的<b>唯一金额标准</b>，咨询、教务模块建费用单时都从这里取金额。
      </template>
      <div class="tip-body">
        改了标准只影响<b>之后新建</b>的费用单，历史单据金额不变（财务留痕）。
      </div>
    </el-alert>

    <!-- ============ 筛选 + 表格（单卡片通栏）============ -->
    <el-card shadow="never" class="table-card card-flush">
      <!-- 条件行 -->
      <div class="filter-row">
        <el-select v-model="query.deptCode" placeholder="适用部门" clearable style="width: 140px">
          <el-option v-for="(name, v) in DEPT_NAME" :key="v" :label="name" :value="Number(v)" />
        </el-select>
        <el-select v-model="query.feeType" placeholder="费用类型" clearable style="width: 140px">
          <el-option v-for="(name, v) in FEE_TYPE_NAME" :key="v" :label="name" :value="Number(v)" />
        </el-select>
        <el-checkbox v-model="onlyEnabled">只看启用</el-checkbox>
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>

      <!-- 工具条：左主按钮，右统计 -->
      <div class="table-toolbar">
        <div class="tools">
          <el-button type="primary" @click="handleAdd">新增标准</el-button>
        </div>
        <div class="tools">
          <span class="stat-line">
            共 <b>{{ total }}</b> 条标准 · 启用 <b>{{ enabledCount }}</b> 条
          </span>
        </div>
      </div>

      <el-table
        v-loading="loading"
        :data="tableData"
        stripe
        style="width: 100%"
        empty-text="暂无匹配数据"
      >
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="deptName" label="适用部门" width="110" align="center" />
        <el-table-column prop="feeTypeName" label="费用类型" width="110" align="center" />
        <el-table-column label="标准金额" width="160" align="right">
          <template #default="{ row }">
            <span class="money">{{ formatAmount(row.amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="发起模块" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="sourceTagType(row.feeType)" size="small" effect="plain">
              {{ sourceNameOf(row.feeType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="凭证规则" width="150" align="center">
          <template #default="{ row }">
            <el-tooltip
              :content="
                isReusable(row.feeType)
                  ? '餐费允许多人共用同一张凭证'
                  : '该费用要求一人一张凭证'
              "
              placement="top"
            >
              <el-tag :type="isReusable(row.feeType) ? 'warning' : 'info'" size="small" effect="plain">
                {{ isReusable(row.feeType) ? '可多人共用' : '一人一张' }}
              </el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ dash(row.remark) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.isEnabled ? 'success' : 'danger'" size="small">
              {{ row.isEnabled ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleEdit(row)">修改金额</el-button>
            <el-button
              link
              :type="row.isEnabled ? 'warning' : 'success'"
              size="small"
              @click="handleToggle(row)"
            >
              {{ row.isEnabled ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页文案条（原型 pager：左文案 + 右页码） -->
      <div class="pager-bar">
        <span>共 {{ total }} 条记录，第 {{ query.page }}/{{ totalPages }} 页</span>
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.size"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="sizes, prev, pager, next"
          @size-change="loadData"
          @current-change="loadData"
        />
      </div>
    </el-card>

    <!-- ============ 新增/修改弹窗 ============ -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '修改费用标准' : '新增费用标准'"
      width="520px"
      @closed="resetForm"
    >
      <el-alert
        v-if="isEdit && editingOldAmount != null"
        type="warning"
        :closable="false"
        show-icon
        :title="`当前标准 ${formatAmount(editingOldAmount)}，修改后仅对之后新建的费用单生效`"
        style="margin-bottom: 14px"
      />

      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="适用部门" prop="deptCode">
          <el-select v-model="form.deptCode" :disabled="isEdit" style="width: 100%">
            <el-option v-for="(name, v) in DEPT_NAME" :key="v" :label="name" :value="Number(v)" />
          </el-select>
        </el-form-item>
        <el-form-item label="费用类型" prop="feeType">
          <el-select v-model="form.feeType" :disabled="isEdit" style="width: 100%">
            <el-option v-for="(name, v) in FEE_TYPE_NAME" :key="v" :label="name" :value="Number(v)" />
          </el-select>
        </el-form-item>
        <el-form-item label="标准金额" prop="amountYuan">
          <el-input-number
            v-model="form.amountYuan"
            :min="0"
            :precision="2"
            :step="100"
            style="width: 200px"
          />
          <span class="unit">元</span>
          <div class="field-tip">
            = {{ formatAmount(Math.round((form.amountYuan || 0) * 100)) }}（后端存「分」）
          </div>
        </el-form-item>
        <el-form-item label="是否启用">
          <el-switch v-model="form.isEnabled" />
          <span class="field-tip" style="margin-left: 10px">停用后上游取不到该标准</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="2"
            maxlength="500"
            show-word-limit
            placeholder="如：2026 秋季调价，原 ¥12,000"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 费用标准配置
 *
 * 规则2的落地页面：各类费用多少钱，只在这里维护一份。
 * 咨询、教务模块建费用单时调 /api/finance/standard/get 取金额。
 *
 * ⚠️ 两个约束在界面上要明确告诉用户：
 *   ① 改了只影响之后新建的单据（历史单据金额冻结）
 *   ② 每个 「费用类型 + 部门」 只能有一条标准（重复会被后端拦）
 */

import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';

import {
  DEPT_NAME,
  FEE_TYPE_NAME,
  FEE_SOURCE_MODULE,
  SOURCE_MODULE_NAME,
  VOUCHER_REUSABLE_FEE_TYPES,
  type FeeStandardItem,
  type FeeStandardListQuery,
} from 'shared-types/finance';
import { fetchStandardList, saveStandard, deleteStandard } from '@/finance/api/finance';
import { formatAmount, dash } from '@/finance/utils/finance';

/* ---------- 列表 ---------- */

const loading = ref(false);
const tableData = ref<FeeStandardItem[]>([]);
const total = ref(0);
const onlyEnabled = ref(false);

/** 当前页里处于启用状态的标准条数（工具栏统计） */
const enabledCount = computed(() => tableData.value.filter((r) => r.isEnabled).length);

/** 分页总页数（原型 pager 里的「第 N/M 页」） */
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / (query.size || 20))));

const query = reactive<FeeStandardListQuery>({
  page: 1,
  size: 20,
  deptCode: undefined,
  feeType: undefined,
  onlyEnabled: undefined,
});

/** 该费用类型由哪个模块发起 */
function sourceNameOf(feeType: number): string {
  const m = FEE_SOURCE_MODULE[feeType];
  return m ? SOURCE_MODULE_NAME[m] : '财务自建';
}

function sourceTagType(feeType: number): 'primary' | 'success' | 'info' {
  const m = FEE_SOURCE_MODULE[feeType];
  if (m === 1) return 'primary';
  if (m === 2) return 'success';
  return 'info';
}

/** 该费用类型是否允许多人共用一张凭证（餐费为 true） */
function isReusable(feeType: number): boolean {
  return VOUCHER_REUSABLE_FEE_TYPES.includes(Number(feeType));
}

async function loadData() {
  loading.value = true;
  try {
    const data = await fetchStandardList({
      ...query,
      onlyEnabled: onlyEnabled.value || undefined,
    });
    tableData.value = data.list;
    total.value = data.total;
  } catch (e) {
    console.error('加载费用标准失败', e);
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  query.page = 1;
  loadData();
}

function handleReset() {
  query.page = 1;
  query.size = 20;
  query.deptCode = undefined;
  query.feeType = undefined;
  onlyEnabled.value = false;
  loadData();
}

/* ---------- 新增 / 修改 ---------- */

const dialogVisible = ref(false);
const isEdit = ref(false);
const submitting = ref(false);
const formRef = ref<FormInstance>();
const editingId = ref<string | undefined>(undefined);
const editingOldAmount = ref<number | null>(null);

/** 表单里金额用「元」给用户填，提交时转「分」 */
const defaultForm = {
  deptCode: 1 as number,
  feeType: 1 as number,
  amountYuan: 0,
  isEnabled: true,
  remark: '',
};

const form = reactive({ ...defaultForm });

const rules: FormRules = {
  deptCode: [{ required: true, message: '请选择部门', trigger: 'change' }],
  feeType: [{ required: true, message: '请选择费用类型', trigger: 'change' }],
  amountYuan: [{ required: true, message: '请填写标准金额', trigger: 'blur' }],
};

function handleAdd() {
  isEdit.value = false;
  editingId.value = undefined;
  editingOldAmount.value = null;
  Object.assign(form, defaultForm);
  dialogVisible.value = true;
}

function handleEdit(row: FeeStandardItem) {
  isEdit.value = true;
  editingId.value = row.id;
  editingOldAmount.value = row.amount;
  Object.assign(form, {
    deptCode: row.deptCode,
    feeType: row.feeType,
    amountYuan: row.amount / 100,  // 分 → 元
    isEnabled: row.isEnabled,
    remark: row.remark ?? '',
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
    // ⚠️ 元 → 分：先四舍五入再转整数，避免 12.345 * 100 = 1234.4999 这类浮点误差
    const amount = Math.round((form.amountYuan || 0) * 100);

    const r = await saveStandard({
      id: editingId.value,
      feeType: form.feeType,
      deptCode: form.deptCode,
      amount,
      isEnabled: form.isEnabled,
      remark: form.remark || undefined,
    });

    ElMessage.success(
      r.created
        ? '新增成功'
        : `已更新标准金额${r.oldAmount != null ? `（原 ${formatAmount(r.oldAmount)}）` : ''}，仅对之后新建的费用单生效`,
    );
    dialogVisible.value = false;
    loadData();
  } catch (e) {
    // 错误提示已由 request.ts 统一处理
  } finally {
    submitting.value = false;
  }
}

/* ---------- 启用 / 停用 ---------- */

async function handleToggle(row: FeeStandardItem) {
  const next = !row.isEnabled;
  try {
    await ElMessageBox.confirm(
      next
        ? `确定启用「${row.deptName} · ${row.feeTypeName}」的费用标准吗？`
        : `停用后，上游模块将取不到「${row.deptName} · ${row.feeTypeName}」的标准金额，确定停用吗？`,
      next ? '启用确认' : '停用确认',
      { type: 'warning', confirmButtonText: next ? '确定启用' : '确定停用' },
    );
  } catch {
    return;
  }

  try {
    await saveStandard({
      id: row.id,
      feeType: row.feeType,
      deptCode: row.deptCode,
      amount: row.amount,
      isEnabled: next,
      remark: row.remark,
    });
    ElMessage.success(next ? '已启用' : '已停用');
    loadData();
  } catch (e) {
    // 已统一处理
  }
}

onMounted(loadData);
</script>

<style scoped>
.page-container {
  padding: 16px;
}

.tip {
  margin-bottom: 12px;
}

.tip-body {
  margin-top: 4px;
  font-size: 12px;
  color: #8a94a6;
}

/* 卡片内通栏版式（.filter-row / .table-toolbar / .pager-bar）由 element-theme.css 统一提供 */

.unit {
  margin-left: 8px;
  color: #8a94a6;
}

.field-tip {
  font-size: 12px;
  color: #8a94a6;
}
</style>
