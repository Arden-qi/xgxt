<script setup lang="ts">
/**
 * 「确认就业」弹窗（**待就业(9) → 已就业(10)**）
 *
 * ★ 2026-10-02 说明
 *   这个功能原本长在「学员档案」弹窗（StudentProfileDialog）的 footer 上。
 *   斌哥要求把它**挪到「信息档案」列表的操作列**（跟 详情/编辑/删除 并排），
 *   所以抽成独立组件给列表页用，档案弹窗里那份撤掉。
 *
 * 【为什么这个动作以前根本不存在】
 *   加这个接口之前，**全模块没有任何地方能写入"已就业"**（只有读），
 *   所以「数据统计」的就业人数 / 就业率**永远是 0**。
 *
 * 【谁能确认】就业老师 / 校长 / 学管主任
 *   ⚠️ 前端只负责显示，真正的角色校验在后端（POST /api/job/student/confirm-employment）
 *
 * 【副作用】后端会顺手写一条就业日志（单位 / 岗位 / 薪资 / 入职日期）
 */
import { ref, reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { confirmEmployment } from '@/api/student';

const props = defineProps<{
  /** 弹窗显隐（v-model:visible） */
  visible: boolean;
  studentId: string;
  studentName?: string;
  studentNo?: string;
}>();

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void;
  /** 确认成功 → 父页面刷新列表 */
  (e: 'done'): void;
}>();

const saving = ref(false);
const form = reactive({
  hireDate: '',
  company: '',
  position: '',
  salary: undefined as number | undefined,
  remark: '',
});

/** 每次打开都重置表单，入职日期默认今天 */
function resetForm(): void {
  const t = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  form.hireDate = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  form.company = '';
  form.position = '';
  form.salary = undefined;
  form.remark = '';
}

watch(
  () => props.visible,
  (v) => {
    if (v) resetForm();
  },
);

async function submit(): Promise<void> {
  if (!form.hireDate) {
    ElMessage.warning('请先选择入职日期');
    return;
  }
  saving.value = true;
  try {
    await confirmEmployment({
      studentId: props.studentId,
      hireDate: form.hireDate,
      company: form.company || undefined,
      position: form.position || undefined,
      salary: form.salary ?? undefined,
      remark: form.remark || undefined,
    });
    ElMessage.success('已标记为「已就业」');
    emit('update:visible', false);
    emit('done');
  } catch {
    // 错误提示由请求层统一弹（如"只有待就业的学生才能确认就业"）
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="确认就业"
    width="520px"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:visible', v)"
  >
    <el-alert type="info" :closable="false" show-icon class="emp-alert">
      <template #title>确认后该生状态将从「待就业」变为「已就业」</template>
      <div class="emp-alert-tip">
        同时会在「就业日志」里留一条入职记录（单位 / 岗位 / 薪资 / 入职日期）。
      </div>
    </el-alert>

    <el-form label-width="90px" class="emp-form">
      <el-form-item label="学生">
        <span>{{ studentName }}（{{ studentNo }}）</span>
      </el-form-item>
      <el-form-item label="入职日期" required>
        <el-date-picker
          v-model="form.hireDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择入职日期"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="就业单位">
        <el-input v-model="form.company" maxlength="100" placeholder="如 杭州数联科技有限公司" />
      </el-form-item>
      <el-form-item label="岗位">
        <el-input v-model="form.position" maxlength="100" placeholder="如 Java 开发工程师" />
      </el-form-item>
      <el-form-item label="薪资">
        <el-input-number
          v-model="form.salary"
          :min="0"
          :max="1000000"
          :step="500"
          controls-position="right"
          style="width: 100%"
        />
        <span class="emp-unit">元/月</span>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="success" :loading="saving" @click="submit">确认就业</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.emp-alert {
  margin-bottom: 14px;
}
.emp-alert-tip {
  font-size: 12.5px;
  line-height: 1.6;
  color: #9C8D88;
}
.emp-form {
  margin-top: 4px;
}
.emp-unit {
  margin-left: 8px;
  font-size: 13px;
  color: #9C8D88;
}
</style>
