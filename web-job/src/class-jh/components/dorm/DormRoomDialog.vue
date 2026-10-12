<script setup lang="ts">
/**
 * 房间 新增 / 修改 弹窗
 *
 * 要点：
 *  - 创建时必须标明是「男宿舍」还是「女宿舍」（dorm_type 1/2）；
 *  - 床位不逐个维护，由「床位数」自动生成/同步（后端负责）。
 */

import { ref, reactive, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { DORM_TYPE_NAME } from 'shared-types/class-jh';
import type { DormRoom, DormBuilding, ClassInfo, DormRoomSavePayload } from 'shared-types/class-jh';
import { addRoom, updateRoom, fetchBuildingList } from '@/class-jh/api/dorm';
import { fetchClassOptions } from '@/class-jh/api/classInfo';
import { fetchAllPages } from '@/class-jh/utils/fetchAll';

const props = defineProps<{
  modelValue: boolean;
  record?: DormRoom | null;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'success'): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const submitting = ref(false);
const buildings = ref<DormBuilding[]>([]);
const classOptions = ref<ClassInfo[]>([]);

const form = reactive({
  buildingId: '' as string,
  roomNo: '',
  floorNo: undefined as number | undefined,
  dormType: 1 as number,
  bedCount: 4 as number,
  ownerName: '',
  roomStatus: '使用中' as string,
  classId: '' as string,
});

const isEdit = computed(() => !!props.record?.roomId);

const DORM_TYPE_OPTIONS = Object.entries(DORM_TYPE_NAME).map(([v, name]) => ({ value: Number(v), name }));

function reset() {
  Object.assign(form, {
    buildingId: '',
    roomNo: '',
    floorNo: undefined,
    dormType: 1,
    bedCount: 4,
    ownerName: '',
    roomStatus: '使用中',
    classId: '',
  });
}

async function loadBase() {
  try {
    const [bs, cls] = await Promise.all([
      fetchAllPages((page, size) => fetchBuildingList({ page, size })),
      fetchClassOptions(),
    ]);
    buildings.value = bs;
    classOptions.value = cls;
  } catch {
    /* 错误已统一处理 */
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    reset();
    await loadBase();
    const r = props.record;
    if (r) {
      Object.assign(form, {
        buildingId: r.buildingId ?? '',
        roomNo: r.roomNo ?? '',
        floorNo: r.floorNo ?? undefined,
        dormType: r.dormType ?? 1,
        bedCount: r.bedCount ?? 1,
        ownerName: r.ownerName ?? '',
        roomStatus: r.roomStatus ?? '使用中',
        classId: r.classId ?? '',
      });
    }
  },
);

async function handleSubmit() {
  if (!form.buildingId) {
    ElMessage.warning('请选择楼栋');
    return;
  }
  if (!form.roomNo.trim()) {
    ElMessage.warning('请填写房间号');
    return;
  }
  const cls = classOptions.value.find((c) => c.classId === form.classId);
  const payload: DormRoomSavePayload = {
    buildingId: form.buildingId,
    roomNo: form.roomNo.trim(),
    floorNo: form.floorNo,
    dormType: form.dormType,
    bedCount: form.bedCount,
    ownerName: form.ownerName.trim() || undefined,
    roomStatus: form.roomStatus || undefined,
    classId: form.classId || undefined,
    className: cls?.className || undefined,
  };
  submitting.value = true;
  try {
    if (isEdit.value && props.record) {
      await updateRoom({ ...payload, roomId: props.record.roomId });
      ElMessage.success('修改成功');
    } else {
      await addRoom(payload);
      ElMessage.success('新增成功');
    }
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
  <el-dialog v-model="visible" :title="isEdit ? '修改房间' : '新增房间'" width="560px" @closed="reset">
    <el-form :model="form" label-width="90px">
      <el-form-item label="楼栋" required>
        <el-select v-model="form.buildingId" filterable placeholder="请选择楼栋" style="width: 100%">
          <el-option v-for="b in buildings" :key="b.buildingId" :label="b.buildingName" :value="b.buildingId" />
        </el-select>
      </el-form-item>
      <el-form-item label="房间号" required>
        <el-input v-model="form.roomNo" maxlength="50" placeholder="如 3-201" />
      </el-form-item>
      <el-form-item label="楼层">
        <el-input-number v-model="form.floorNo" :min="0" :max="200" style="width: 100%" />
      </el-form-item>
      <el-form-item label="宿舍类型" required>
        <el-radio-group v-model="form.dormType">
          <el-radio v-for="t in DORM_TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.name }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="床位数" required>
        <el-input-number v-model="form.bedCount" :min="1" :max="50" style="width: 100%" />
        <el-text type="info" size="small">保存时按床位数自动生成 1~N 号床位</el-text>
      </el-form-item>
      <el-form-item label="负责人">
        <el-input v-model="form.ownerName" maxlength="50" />
      </el-form-item>
      <el-form-item label="所属班级">
        <el-select v-model="form.classId" filterable clearable placeholder="混班可留空" style="width: 100%">
          <el-option v-for="c in classOptions" :key="c.classId" :label="c.className" :value="c.classId" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="form.roomStatus" style="width: 100%">
          <el-option label="使用中" value="使用中" />
          <el-option label="空置" value="空置" />
          <el-option label="维修" value="维修" />
          <el-option label="停用" value="停用" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">保存</el-button>
    </template>
  </el-dialog>
</template>
