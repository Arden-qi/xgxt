<script setup lang="ts">
/**
 * 学生选择器
 *
 * ⚠️ 为什么单独抽一个组件：就业日志、复盘填写都要「选学生」，
 *    而且必须带学号校验（防止只记个名字，回头找不到人）。
 */

import { ref, watch } from 'vue';
import { searchStudents } from '@/api/student';

const props = defineProps<{
  /** 选中的学生 ID */
  modelValue?: string;
  /** 编辑回填时的学生姓名 */
  initialLabel?: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  /** 选中变化时把姓名也抛出去，方便父组件做联动提示 */
  change: [studentId: string, studentName: string];
}>();

const options = ref<{ studentId: string; studentName: string; studentNo: string }[]>([]);
const loading = ref(false);

/** 远程搜索 */
async function remoteSearch(keyword: string) {
  loading.value = true;
  try {
    const data = await searchStudents(keyword || '');
    options.value = data.list;
  } catch (e) {
    // request.ts 已统一提示
  } finally {
    loading.value = false;
  }
}

/** 编辑场景下，把当前选中的学生塞进选项里，避免显示成裸 ID */
watch(
  () => [props.initialLabel, props.modelValue] as const,
  ([label, id]) => {
    if (label && id && !options.value.some((o) => o.studentId === id)) {
      options.value = [{ studentId: id, studentName: label, studentNo: '' }];
    }
  },
  { immediate: true },
);

function onChange(value: string) {
  const hit = options.value.find((o) => o.studentId === value);
  emit('update:modelValue', value || '');
  emit('change', value || '', hit?.studentName || '');
}

remoteSearch('');
</script>

<template>
  <el-select
    :model-value="modelValue"
    filterable
    remote
    clearable
    reserve-keyword
    :remote-method="remoteSearch"
    :loading="loading"
    :placeholder="placeholder || '输入姓名搜索'"
    style="width: 100%"
    @change="onChange"
  >
    <el-option
      v-for="o in options"
      :key="o.studentId"
      :label="o.studentNo ? `${o.studentName}（${o.studentNo}）` : o.studentName"
      :value="o.studentId"
    />
  </el-select>
</template>
