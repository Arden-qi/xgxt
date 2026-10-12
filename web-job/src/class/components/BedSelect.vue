<template>
  <div class="bed-select">
    <el-select
      v-model="local.dormId"
      filterable
      placeholder="选择宿舍"
      style="width: 100%"
      :loading="roomLoading"
      @change="onDormChange"
    >
      <el-option v-for="r in rooms" :key="r.id" :label="`${r.buildingName} ${r.dormNo}`" :value="r.id" />
    </el-select>

    <template v-if="local.dormId">
      <el-select
        v-model="local.bedNo"
        placeholder="选择床位"
        style="width: 100%; margin-top: 8px"
        :loading="bedLoading"
        :disabled="!beds.length"
        @change="onBedChange"
      >
        <el-option
          v-for="b in beds"
          :key="b.bedNo"
          :label="bedLabel(b)"
          :value="b.bedNo"
          :disabled="b.occupied && b.studentId !== excludeStudentId"
        />
      </el-select>
      <div v-if="preview" class="bed-preview">{{ preview }}</div>
    </template>
    <div v-else class="bed-hint">请先选择宿舍</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { dormRoomList, bedList } from '@/class/api';
import type { BedItem, DormRoomRow } from '@/class/api/types';
// ★ 床位号显示规则（奇上偶下：1→1上 / 2→1下），单一数据源在 shared-types
import { bedLabel as formatBedLabel } from 'shared-types/class';

/**
 * 宿舍 + 床位选择器（新增/修改学生、咨询接收 复用）
 *
 * - 先选宿舍（来自 /api/class/dorm/room/list），选项显示「楼栋 房号」
 * - 选完宿舍后调 /api/class/dorm/bed/list，列出该宿舍所有床位
 * - 已占用的床位 disabled；若占用者就是当前学员（excludeStudentId）则仍可选（编辑自己床位）
 * - 选中后预览「已选床位：301-1（将同步至宿舍管理）」
 * - 通过 v-model 把 { dormId, dormNo, bedNo } 回传父组件
 */
export interface BedPick {
  dormId: string | null;
  dormNo: string | null;
  bedNo: number | null;
}

const props = defineProps<{ modelValue: BedPick; excludeStudentId?: string | null }>();
const emit = defineEmits<{ 'update:modelValue': [BedPick] }>();

const rooms = ref<DormRoomRow[]>([]);
const beds = ref<BedItem[]>([]);
const roomLoading = ref(false);
const bedLoading = ref(false);

const local = reactive<BedPick>({ ...props.modelValue });

watch(
  () => props.modelValue,
  (v) => {
    local.dormId = v.dormId;
    local.dormNo = v.dormNo;
    local.bedNo = v.bedNo;
  },
  { deep: true },
);

function emitChange(): void {
  emit('update:modelValue', { dormId: local.dormId, dormNo: local.dormNo, bedNo: local.bedNo });
}

async function loadRooms(): Promise<void> {
  roomLoading.value = true;
  try {
    rooms.value = (await dormRoomList({ page: 1, size: 200 })).list ?? [];
  } finally {
    roomLoading.value = false;
  }
}

async function loadBeds(dormId: string): Promise<void> {
  bedLoading.value = true;
  try {
    const res = await bedList({ dormId });
    beds.value = res.beds ?? [];
    local.dormNo = res.dormNo ?? local.dormNo;
  } finally {
    bedLoading.value = false;
  }
}

async function onDormChange(dormId: string): Promise<void> {
  local.bedNo = null;
  local.dormNo = rooms.value.find((r) => r.id === dormId)?.dormNo ?? null;
  emitChange();
  await loadBeds(dormId);
}

function onBedChange(): void {
  emitChange();
}

const preview = computed(() => {
  // ★ 2026-10-04：床位按「奇上偶下」显示（301-1-上）
  // ⚠️ 别和下面那个局部 bedLabel 混淆 —— 那个是「床位+学生名」用的，不是房间号拼接
  if (local.dormNo && local.bedNo != null) {
    return `已选床位：${formatBedLabel(local.dormNo, local.bedNo)}（将同步至宿舍管理）`;
  }
  return '';
});

function bedLabel(b: BedItem): string {
  if (b.occupied && b.studentId !== props.excludeStudentId) return `${b.label}（${b.studentName}）`;
  return b.label;
}

onMounted(async () => {
  await loadRooms();
  if (local.dormId) await loadBeds(local.dormId);
});
</script>

<style scoped>
.bed-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-2);
}
.bed-preview {
  margin-top: 6px;
  font-size: 12px;
  color: var(--brand);
}
</style>
