<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? `修改学员信息 · ${form.studentName}` : '新增学员'"
    width="980px"
    top="5vh"
    destroy-on-close
    @open="onOpen"
  >
    <div v-loading="loading">
      <el-tabs v-model="tab">
        <!-- ================= 基础信息（唯一可填的一页）================= -->
        <el-tab-pane label="基础信息" name="base">
          <el-form ref="formRef" :model="form" label-width="120px" label-position="right">
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="姓名" prop="studentName" :rules="[{ required: true, message: '请输入姓名' }]">
                  <el-input v-model="form.studentName" placeholder="必填" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item
                  label="学号"
                  prop="studentNo"
                  :rules="isEdit ? [] : [{ required: true, message: '请输入学号' }]"
                >
                  <el-input v-model="form.studentNo" :disabled="isEdit" :placeholder="isEdit ? '' : '必填，如 S20260016'" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="性别" prop="gender" :rules="[{ required: true, message: '请选择性别' }]">
                  <el-select v-model="form.gender" :disabled="isEdit" style="width: 100%">
                    <el-option v-for="o in dict.options('gender')" :key="o.value" :label="o.label" :value="o.value" />
                  </el-select>
                </el-form-item>
              </el-col>

              <el-col :span="8">
                <el-form-item label="部门" prop="deptCode" :rules="[{ required: true, message: '请选择部门' }]">
                  <el-select v-model="form.deptCode" style="width: 100%" @change="onDeptChange">
                    <el-option v-for="o in deptOptions" :key="o.value" :label="o.label" :value="o.value" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="班级">
                  <el-select v-model="form.classId" clearable filterable style="width: 100%" placeholder="可留空，后续补充">
                    <el-option v-for="c in classList" :key="c.id" :label="c.className" :value="c.id" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="学习阶段">
                  <el-select v-model="form.stage" clearable style="width: 100%" placeholder="可留空">
                    <el-option v-for="o in stageOptions" :key="o.value" :label="o.label" :value="o.value" />
                  </el-select>
                </el-form-item>
              </el-col>

              <el-col :span="16">
                <el-form-item label="宿舍 / 床位">
                  <BedSelect v-model="dormPick" :exclude-student-id="isEdit ? form.studentId : null" />
                </el-form-item>
              </el-col>

              <el-col :span="8">
                <el-form-item label="年龄"><el-input-number v-model="form.age" :min="5" :max="60" controls-position="right" style="width: 100%" /></el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="学历">
                  <el-select v-model="form.education" clearable style="width: 100%" placeholder="可留空">
                    <el-option v-for="e in EDUCATIONS" :key="e" :label="e" :value="e" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="手机号"><el-input v-model="form.phone" /></el-form-item>
              </el-col>

              <el-col :span="8">
                <el-form-item label="家长手机号"><el-input v-model="form.parentPhone" /></el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="身份证号">
                  <el-input v-model="form.idCard" placeholder="休学 / 退学申请表会引用" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="入学时间">
                  <el-date-picker v-model="form.enrollDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
                </el-form-item>
              </el-col>

              <el-col :span="8">
                <el-form-item label="出生日期">
                  <el-date-picker v-model="form.birthDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="籍贯"><el-input v-model="form.origin" /></el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="毕业院校"><el-input v-model="form.graduateSchool" /></el-form-item>
              </el-col>

              <el-col :span="24">
                <el-form-item label="家庭住址"><el-input v-model="form.homeAddress" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="身份证照片"><el-input v-model="form.idPhotoUrl" placeholder="图片文件名 / 地址" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="户口本照片"><el-input v-model="form.householdPhotoUrl" placeholder="图片文件名 / 地址" /></el-form-item>
              </el-col>
            </el-row>
          </el-form>

          <!-- 修改时才有：这些字段列表里有，但详情 6 个标签里没有独立的编辑入口 -->
          <template v-if="isEdit">
            <div class="dl-title section-gap">学籍与综合素质</div>
            <el-form :model="form" label-width="120px">
              <el-row :gutter="16">
                <el-col :span="8">
                  <el-form-item label="学生状态">
                    <el-select v-model="form.studentStatus" style="width: 100%">
                      <el-option v-for="o in dict.options('studentStatus')" :key="o.value" :label="o.label" :value="o.value" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="末班次数">
                    <el-input-number v-model="form.repeatCount" :min="0" controls-position="right" style="width: 100%" />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="学习状况">
                    <el-select v-model="quality.studyStatus" clearable style="width: 100%">
                      <el-option v-for="v in QUALITY.study" :key="v" :label="v" :value="v" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="自律程度">
                    <el-select v-model="quality.discipline" clearable style="width: 100%">
                      <el-option v-for="v in QUALITY.discipline" :key="v" :label="v" :value="v" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="学习能力">
                    <el-select v-model="quality.ability" clearable style="width: 100%">
                      <el-option v-for="v in QUALITY.ability" :key="v" :label="v" :value="v" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="理解能力"><el-input v-model="quality.comprehension" /></el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="表达能力"><el-input v-model="quality.expression" /></el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="交际能力"><el-input v-model="quality.social" /></el-form-item>
                </el-col>
                <el-col :span="24">
                  <el-form-item label="备注">
                    <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="心理 / 违纪 / 家庭变故等，需重点关注的信息" />
                  </el-form-item>
                </el-col>
                <el-col :span="24">
                  <el-form-item label="能力说明">
                    <el-input v-model="quality.note" type="textarea" :rows="2" placeholder="对学习态度、自律、沟通等方面的综合说明" />
                  </el-form-item>
                </el-col>
              </el-row>
            </el-form>
          </template>

          <div class="note-box section-gap">
            <template v-if="isEdit">
              本页对应「详情 → 基础信息」；市场信息 / 末班 / 宿舍 / 考试信息 / 班级信息 为只读展示，
              如需维护请在「详情」对应标签内操作。
            </template>
            <template v-else>
              字段与「详情 → 基础信息」一致，<b>填写「姓名」「学号」即可创建</b>；
              性别与部门已按常用值预填。市场信息由咨询管理同步，
              末班 / 宿舍 / 考试 / 班级信息 创建后在「详情」中维护。
            </template>
          </div>
        </el-tab-pane>

        <!-- ================= 以下 5 页：与详情同序同名，创建时为空（只读展示）================= -->
        <el-tab-pane v-for="p in readonlyPanes" :key="p.name" :label="p.label" :name="p.name">
          <div class="note-box brand">{{ p.tip }}</div>
          <el-table class="section-gap" :data="[]" size="small" border :empty-text="p.empty">
            <el-table-column v-for="c in p.columns" :key="c" :label="c" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">
        {{ isEdit ? '保存修改' : '确认新增' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, type FormInstance } from 'element-plus';
import { classOptions, studentAdd, studentDetail, studentUpdate } from '@/class/api/student';
import type { ClassRow } from '@/class/api/types';
import { useDictStore } from '@/class/stores/dict';
import BedSelect, { type BedPick } from '@/class/components/BedSelect.vue';
import { useUserStore } from '@/class/stores/user';

/**
 * 新增 / 修改学员
 *
 * 与原型确认过的结构：**6 个标签页，与详情完全同序同名**
 *   基础信息 / 市场信息 / 末班 / 宿舍 / 考试信息 / 班级信息
 * 只有「基础信息」可填；后 5 页与详情表头一致但为空且无操作按钮
 * —— 这两类数据分别来自教务管理（末班 / 考试）与财务管理（缴费），
 * 由各自模块维护后同步过来，不在这里录入。
 *
 * 必填：姓名、学号（性别与部门已预填，实际"填姓名学号就能建"）。
 */
const props = defineProps<{ modelValue: boolean; mode: 'add' | 'edit'; studentId?: string }>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [] }>();

const dict = useDictStore();
const user = useUserStore();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});
const isEdit = computed(() => props.mode === 'edit');

const formRef = ref<FormInstance>();
const loading = ref(false);
const saving = ref(false);
const tab = ref('base');
const classList = ref<ClassRow[]>([]);

/** 宿舍 + 床位选择（新增 / 修改复用 BedSelect） */
const dormPick = ref<BedPick>({ dormId: null, dormNo: null, bedNo: null });

const EDUCATIONS = ['初中', '高中', '中专', '大专', '本科在读', '本科', '硕士'];

const QUALITY = {
  study: ['优秀', '良好', '中等', '一般'],
  discipline: ['自律程度高', '自律性强', '自律程度中等', '自律程度较弱'],
  ability: ['强', '较强', '中等', '偏弱'],
};

const form = reactive({
  studentId: '',
  studentName: '',
  studentNo: '',
  gender: 1 as number,
  deptCode: 2 as number,
  classId: null as string | null,
  stage: null as number | null,
  age: null as number | null,
  education: null as string | null,
  phone: '',
  parentPhone: '',
  idCard: '',
  enrollDate: null as string | null,
  birthDate: null as string | null,
  origin: '',
  graduateSchool: '',
  homeAddress: '',
  idPhotoUrl: '',
  householdPhotoUrl: '',
  studentStatus: null as number | null,
  repeatCount: 0,
  remark: '',
});

const quality = reactive({
  studyStatus: '',
  discipline: '',
  ability: '',
  comprehension: '',
  expression: '',
  social: '',
  note: '',
});

const deptOptions = computed(() =>
  dict.options('deptCode').length
    ? dict.options('deptCode')
    : [
        { label: '大学部', value: 2 },
      ],
);
const stageOptions = computed(() => dict.stagesOf(form.deptCode));

/** 后 5 个只读页：表头与详情一致，创建时为空、无操作按钮 */
const readonlyPanes = [
  {
    name: 'market',
    label: '市场信息',
    tip: '需求一之 1：市场信息由「咨询管理」同步，本页只读。创建后在详情中查看同步结果。',
    empty: '市场信息由咨询管理同步，创建后自动出现',
    columns: ['姓名', '学号', '招生老师', '招生老师电话号', '咨询老师', '咨询老师电话号'],
  },
  {
    name: 'repeat',
    label: '末班',
    tip: '末班是"考试不合格 → 转班重修"的事件记录，由成绩判定后在详情中新增。',
    empty: '该学员暂无末班记录',
    columns: ['姓名', '学号', '末班时间', '末班原因', '原班级', '转入班级', '末班次数'],
  },
  {
    name: 'dorm',
    label: '宿舍',
    tip: '需求四：宿舍信息同步「教务管理」的宿舍信息，本模块只读。',
    empty: '尚未分配宿舍（由宿舍管理同步）',
    columns: ['姓名', '学号', '宿舍号', '入住日期'],
  },
  {
    name: 'exam',
    label: '考试信息',
    tip: '技术考试只显示最近 3 次；综合成绩 = 笔试 × 50% + 面试 × 50%，由系统自动计算。',
    empty: '暂无考试成绩',
    columns: ['姓名学号', '考试名称', '综合成绩', '笔试分数', '面试分数', '素质分析'],
  },
  {
    name: 'cls',
    label: '班级信息',
    tip: '班级、班主任、教员、助教与「班级管理」实时同步，交接后自动更新并留存历史。',
    empty: '尚未分班（创建后可在「修改」中指定班级）',
    columns: ['姓名', '学号', '班级', '班主任名称', '教员', '助教'],
  },
];

function resetForm(): void {
  formRef.value?.clearValidate();
  tab.value = 'base';
  Object.assign(form, {
    studentId: '',
    studentName: '',
    studentNo: '',
    gender: 1,
    deptCode: user.deptCode || 2,
    classId: null,
    stage: null,
    age: null,
    education: null,
    phone: '',
    parentPhone: '',
    idCard: '',
    enrollDate: null,
    birthDate: null,
    origin: '',
    graduateSchool: '',
    homeAddress: '',
    idPhotoUrl: '',
    householdPhotoUrl: '',
    studentStatus: null,
    repeatCount: 0,
    remark: '',
  });
  dormPick.value = { dormId: null, dormNo: null, bedNo: null };
  Object.assign(quality, {
    studyStatus: '',
    discipline: '',
    ability: '',
    comprehension: '',
    expression: '',
    social: '',
    note: '',
  });
}

async function onOpen(): Promise<void> {
  loading.value = true;
  try {
    if (!classList.value.length) {
      classList.value = (await classOptions()).list ?? [];
    }
    // ★ 2026-10-04 修 bug：新增学员默认选第一个班（原来可留空 → 多班班主任新增成孤儿）
    if (!isEdit.value && !form.classId && classList.value.length) {
      form.classId = classList.value[0].id;
    }
    if (isEdit.value && props.studentId) {
      const d = await studentDetail(props.studentId);
      const s = d.student;
      Object.assign(form, {
        studentId: s.studentId,
        studentName: s.studentName,
        studentNo: s.studentNo,
        gender: s.gender,
        deptCode: (d.classInfo?.deptCode as number) ?? user.deptCode ?? 2,
        classId: (d.classInfo?.id as string) ?? null,
        stage: s.stage,
        age: s.age,
        education: s.education,
        phone: s.phone ?? '',
        parentPhone: s.parentPhone ?? '',
        idCard: s.idCard ?? '',
        enrollDate: s.enrollDate ?? null,
        birthDate: d.profile.birthDate ?? null,
        origin: d.profile.origin ?? '',
        graduateSchool: d.profile.graduateSchool ?? '',
        homeAddress: d.profile.homeAddress ?? '',
        idPhotoUrl: d.profile.idPhotoUrl ?? '',
        householdPhotoUrl: d.profile.householdPhotoUrl ?? '',
        studentStatus: s.studentStatus,
        repeatCount: s.repeatCount ?? 0,
        remark: s.remark ?? '',
      });
      dormPick.value = {
        dormId: (d.dorm?.dormId as string) ?? null,
        dormNo: s.dormNo ?? null,
        bedNo: s.bedNo ?? null,
      };
      Object.assign(quality, {
        studyStatus: d.quality.studyStatus ?? '',
        discipline: d.quality.discipline ?? '',
        ability: d.quality.ability ?? '',
        comprehension: d.quality.comprehension ?? '',
        expression: d.quality.expression ?? '',
        social: d.quality.social ?? '',
        note: d.quality.note ?? '',
      });
      tab.value = 'base';
    } else {
      resetForm();
    }
  } finally {
    loading.value = false;
  }
}

/** 换部门后原来的学习阶段可能不属于该部门，清掉避免脏值 */
function onDeptChange(): void {
  const ok = stageOptions.value.some((o) => o.value === form.stage);
  if (!ok) form.stage = null;
}

watch(
  () => props.modelValue,
  (v) => {
    if (!v) resetForm();
  },
);

async function submit(): Promise<void> {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;

  const profile = {
    birthDate: form.birthDate || null,
    origin: form.origin || null,
    graduateSchool: form.graduateSchool || null,
    homeAddress: form.homeAddress || null,
    idPhotoUrl: form.idPhotoUrl || null,
    householdPhotoUrl: form.householdPhotoUrl || null,
  };

  saving.value = true;
  try {
    if (isEdit.value) {
      await studentUpdate({
        studentId: form.studentId,
        classId: form.classId,
        stage: form.stage,
        education: form.education,
        enrollDate: form.enrollDate,
        idCard: form.idCard || null,
        phone: form.phone || null,
        parentPhone: form.parentPhone || null,
        age: form.age,
        studentStatus: form.studentStatus,
        repeatCount: form.repeatCount,
        remark: form.remark || null,
        dormId: dormPick.value.dormId,
        dormNo: dormPick.value.dormNo,
        bedNo: dormPick.value.bedNo,
        profile,
        quality: { ...quality },
      });
      ElMessage.success('学员信息已保存');
    } else {
      const res = await studentAdd({
        studentName: form.studentName.trim(),
        studentNo: form.studentNo.trim(),
        gender: form.gender,
        deptCode: form.deptCode,
        age: form.age,
        classId: form.classId,
        stage: form.stage,
        phone: form.phone || null,
        parentPhone: form.parentPhone || null,
        education: form.education,
        enrollDate: form.enrollDate,
        idCard: form.idCard || null,
        dormId: dormPick.value.dormId,
        dormNo: dormPick.value.dormNo,
        bedNo: dormPick.value.bedNo,
        profile,
      });
      ElMessage.success(`学员已创建，学号 ${res.studentNo}`);
    }
    visible.value = false;
    emit('saved');
  } catch {
    // request 层已弹提示
  } finally {
    saving.value = false;
  }
}
</script>
