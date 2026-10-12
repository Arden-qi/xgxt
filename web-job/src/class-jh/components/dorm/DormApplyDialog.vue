<script setup lang="ts">
/**
 * 调宿申请弹窗
 *
 * 选择学生 → 原房间/床位 → 目标房间/床位 → 填写换宿原因 → 提交。
 */

import { ref, reactive, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import type { StudentListItem, DormRoom, DormBed } from 'shared-types/class-jh';
import { fetchRoomList, fetchRoomDetail, addDormApply } from '@/class-jh/api/dorm';
import { fetchStudentList } from '@/class-jh/api/student';
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
const rooms = ref<DormRoom[]>([]);
const fromBeds = ref<DormBed[]>([]);
const toBeds = ref<DormBed[]>([]);

const form = reactive({
  studentId: '' as string,
  fromRoomId: '' as string,
  fromBedId: '' as string,
  toRoomId: '' as string,
  toBedId: '' as string,
  applyReason: '',
});

const toFreeBeds = computed(() => toBeds.value.filter((b) => b.bedStatus === '空闲'));

function reset() {
  Object.assign(form, {
    studentId: '',
    fromRoomId: '',
    fromBedId: '',
    toRoomId: '',
    toBedId: '',
    applyReason: '',
  });
  fromBeds.value = [];
  toBeds.value = [];
}

async function loadBase() {
  try {
    const [studentsAll, roomsAll] = await Promise.all([
      fetchAllPages((page, size) => fetchStudentList({ page, size })),
      fetchAllPages((page, size) => fetchRoomList({ page, size })),
    ]);
    students.value = studentsAll;
    rooms.value = roomsAll;
  } catch {
    /* 错误已统一处理 */
  }
}

async function loadFromBeds() {
  form.fromBedId = '';
  fromBeds.value = [];
  if (!form.fromRoomId) return;
  try {
    const detail = await fetchRoomDetail(form.fromRoomId);
    fromBeds.value = detail.beds || [];
  } catch {
    fromBeds.value = [];
  }
}

async function loadToBeds() {
  form.toBedId = '';
  toBeds.value = [];
  if (!form.toRoomId) return;
  try {
    const detail = await fetchRoomDetail(form.toRoomId);
    toBeds.value = detail.beds || [];
  } catch {
    toBeds.value = [];
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      reset();
      loadBase();
    }
  },
);
watch(() => form.fromRoomId, loadFromBeds);
watch(() => form.toRoomId, loadToBeds);

async function handleSubmit() {
  if (!form.studentId || !form.fromRoomId || !form.toRoomId || !form.toBedId || !form.applyReason) {
    ElMessage.warning('请完整填写学生、原房间、目标房间/床位与原因');
    return;
  }
  submitting.value = true;
  try {
    await addDormApply({
      studentId: form.studentId,
      fromRoomId: form.fromRoomId,
      fromBedId: form.fromBedId || undefined,
      toRoomId: form.toRoomId,
      toBedId: form.toBedId,
      applyReason: form.applyReason,
    });
    ElMessage.success('调宿申请已提交');
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
  <el-dialog v-model="visible" title="新增调宿申请" width="580px" @closed="reset">
    <el-form :model="form" label-width="100px">
      <el-form-item label="学生" required>
        <el-select v-model="form.studentId" filterable placeholder="请选择学生" style="width: 100%">
          <el-option
            v-for="s in students"
            :key="s.studentId"
            :label="`${s.studentNo} ${s.studentName}（${s.className || '无班级'}）`"
            :value="s.studentId"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="原房间" required>
        <el-select v-model="form.fromRoomId" filterable placeholder="请选择原房间" style="width: 100%">
          <el-option
            v-for="r in rooms"
            :key="r.roomId"
            :label="`${r.buildingName} ${r.roomNo}`"
            :value="r.roomId"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="原床位">
        <el-select v-model="form.fromBedId" placeholder="请先选择原房间" style="width: 100%" :disabled="!form.fromRoomId">
          <el-option v-for="b in fromBeds" :key="b.bedId" :label="`${b.bedNo}（${b.bedStatus || '—'}）`" :value="b.bedId" />
        </el-select>
      </el-form-item>
      <el-form-item label="目标房间" required>
        <el-select v-model="form.toRoomId" filterable placeholder="请选择目标房间" style="width: 100%">
          <el-option
            v-for="r in rooms"
            :key="r.roomId"
            :label="`${r.buildingName} ${r.roomNo}（${r.occupiedCount ?? 0}/${r.bedCount}）`"
            :value="r.roomId"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="目标床位" required>
        <el-select v-model="form.toBedId" placeholder="请先选择目标房间" style="width: 100%" :disabled="!form.toRoomId">
          <el-option v-for="b in toFreeBeds" :key="b.bedId" :label="b.bedNo" :value="b.bedId" />
        </el-select>
      </el-form-item>
      <el-form-item label="换宿原因" required>
        <el-input v-model="form.applyReason" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">提交申请</el-button>
    </template>
  </el-dialog>
</template>
