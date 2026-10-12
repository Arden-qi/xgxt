<script setup lang="ts">
/**
 * 床位分派弹窗
 *
 * 选择学生 → 选择房间 → 选择空闲床位 → 提交分派。
 * ⚠️ 床位已占用会由后端返回 40012，本页只在选择时过滤「空闲」床位。
 */

import { ref, reactive, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import type { ClassInfo, StudentListItem, DormRoom, DormBed, DormBuilding } from 'shared-types/class-jh';
import { fetchRoomList, fetchRoomDetail, fetchBuildingList, dispatchDorm } from '@/class-jh/api/dorm';
import { fetchStudentList } from '@/class-jh/api/student';
import { fetchClassOptions } from '@/class-jh/api/classInfo';
import { fetchAllPages } from '@/class-jh/utils/fetchAll';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'success'): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const submitting = ref(false);
const students = ref<StudentListItem[]>([]);
const buildings = ref<DormBuilding[]>([]);
const rooms = ref<DormRoom[]>([]);
const beds = ref<DormBed[]>([]);
const classOptions = ref<ClassInfo[]>([]);

const form = reactive({
  classId: '' as string,
  studentId: '' as string,
  /** 楼栋（必填）：先选楼栋，再在楼栋下选房间 */
  buildingId: '' as string,
  roomId: '' as string,
  bedId: '' as string,
  checkInDate: new Date().toISOString().slice(0, 10),
});

/** 当前选中的学生（用于按性别过滤房间） */
const currentStudent = computed(() => students.value.find((s) => s.studentId === form.studentId));

/**
 * 房间候选：先按所选楼栋过滤，再按学生性别过滤。
 *
 * ⚠️ 楼栋不分男女，但**房间分男女**：房间 dormType（1 男宿舍 / 2 女宿舍）必须与学生 gender 一致，
 *    否则提交会被后端以 40010 拒绝。这里提前过滤掉，避免用户白选。
 *    未选楼栋时为空（强制先选楼栋）；未选学生时不按性别过滤。
 */
const filteredRooms = computed(() => {
  if (!form.buildingId) return [];
  const g = currentStudent.value?.gender;
  // DormType 与 Gender 虽都是 1/2，但属不同枚举 → 用数值比较
  return rooms.value.filter(
    (r) => r.buildingId === form.buildingId && (g === undefined || Number(r.dormType) === Number(g)),
  );
});

/** 只显示空闲床位 */
const freeBeds = computed(() => beds.value.filter((b) => b.bedStatus === '空闲'));

function reset() {
  Object.assign(form, {
    classId: '',
    studentId: '',
    buildingId: '',
    roomId: '',
    bedId: '',
    checkInDate: new Date().toISOString().slice(0, 10),
  });
  beds.value = [];
}

async function loadBase() {
  try {
    const [buildingsAll, roomsAll, cls] = await Promise.all([
      fetchAllPages((page, size) => fetchBuildingList({ page, size })),
      fetchAllPages((page, size) => fetchRoomList({ page, size })),
      fetchClassOptions(),
    ]);
    buildings.value = buildingsAll;
    rooms.value = roomsAll;
    classOptions.value = cls;
  } catch {
    /* 错误已统一处理 */
  }
}

async function loadStudents() {
  try {
    students.value = await fetchAllPages((page, size) =>
      fetchStudentList({ classId: form.classId || undefined, page, size }),
    );
  } catch {
    students.value = [];
  }
}

async function loadBeds() {
  form.bedId = '';
  beds.value = [];
  if (!form.roomId) return;
  try {
    const detail = await fetchRoomDetail(form.roomId);
    beds.value = detail.beds || [];
  } catch {
    beds.value = [];
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    reset();
    loadBase();
    loadStudents();
  },
);

watch(() => form.classId, loadStudents);
watch(() => form.roomId, loadBeds);
/** 换楼栋 → 清空房间与床位（房间列表已按楼栋过滤） */
watch(() => form.buildingId, () => {
  form.roomId = '';
  form.bedId = '';
  beds.value = [];
});
/** 换学生 → 房间候选随性别变化，清空已选房间与床位 */
watch(() => form.studentId, () => {
  form.roomId = '';
  form.bedId = '';
  beds.value = [];
});

async function handleSubmit() {
  if (!form.buildingId) {
    ElMessage.warning('请选择楼栋');
    return;
  }
  if (!form.studentId || !form.roomId || !form.bedId) {
    ElMessage.warning('请选择学生、房间与床位');
    return;
  }
  submitting.value = true;
  try {
    await dispatchDorm({
      studentId: form.studentId,
      roomId: form.roomId,
      bedId: form.bedId,
      checkInDate: form.checkInDate || undefined,
    });
    ElMessage.success('分派成功');
    visible.value = false;
    emit('success');
  } catch {
    /* 错误已统一处理 */
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="床位分派" width="560px" @closed="reset">
    <el-form :model="form" label-width="90px">
      <el-form-item label="班级">
        <el-select v-model="form.classId" placeholder="全部班级" clearable style="width: 100%">
          <el-option v-for="c in classOptions" :key="c.classId" :label="c.className" :value="c.classId" />
        </el-select>
      </el-form-item>
      <el-form-item label="学生" required>
        <el-select v-model="form.studentId" filterable placeholder="请选择学生" style="width: 100%">
          <el-option
            v-for="s in students"
            :key="s.studentId"
            :label="`${s.studentNo} ${s.studentName}（${s.className || '无班级'} · ${s.genderName}）`"
            :value="s.studentId"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="楼栋" required>
        <el-select v-model="form.buildingId" placeholder="请选择楼栋" style="width: 100%">
          <el-option
            v-for="b in buildings"
            :key="b.buildingId"
            :label="b.buildingName"
            :value="b.buildingId"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="房间" required>
        <el-select
          v-model="form.roomId"
          filterable
          :placeholder="form.buildingId ? '请选择房间' : '请先选择楼栋'"
          :disabled="!form.buildingId"
          style="width: 100%"
        >
          <el-option
            v-for="r in filteredRooms"
            :key="r.roomId"
            :label="`${r.roomNo}（${r.occupiedCount ?? 0}/${r.bedCount}）`"
            :value="r.roomId"
          />
        </el-select>
        <el-text v-if="form.buildingId && !filteredRooms.length" type="info" size="small">
          该楼栋下没有{{ currentStudent ? `「${currentStudent.genderName}」` : '' }}学生可住的房间
        </el-text>
        <el-text v-else-if="form.buildingId && currentStudent" type="info" size="small">
          仅显示与「{{ currentStudent.studentName }}（{{ currentStudent.genderName }}）」性别一致的房间
        </el-text>
      </el-form-item>
      <el-form-item label="床位" required>
        <el-select v-model="form.bedId" placeholder="请先选择房间" style="width: 100%" :disabled="!form.roomId">
          <el-option v-for="b in freeBeds" :key="b.bedId" :label="b.bedNo" :value="b.bedId" />
        </el-select>
        <el-text v-if="form.roomId && !freeBeds.length" type="warning" size="small">该房间暂无空闲床位</el-text>
      </el-form-item>
      <el-form-item label="入住日期">
        <el-date-picker v-model="form.checkInDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">确定分派</el-button>
    </template>
  </el-dialog>
</template>
