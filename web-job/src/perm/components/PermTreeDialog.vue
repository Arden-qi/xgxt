<script setup lang="ts">
/**
 * 权限配置弹窗（包装 PermTreePanel）
 *
 * ⚠️ 取值走 panelRef.getPerms()，点击「确定」才把草稿交给父组件 ——
 *    用户点「取消」时，已勾的改动不应生效。
 */
import { computed, ref } from 'vue';
import { Search } from '@element-plus/icons-vue';
import type { PermModule, RolePermMap } from 'shared-types/perm';
import PermTreePanel from './PermTreePanel.vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title?: string;
    modules: PermModule[];
    perms?: RolePermMap;
    readonly?: boolean;
    /** 角色/账号名，用于副标题 */
    subtitle?: string;
  }>(),
  { title: '配置权限', readonly: false, subtitle: '' },
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'confirm', perms: RolePermMap): void;
}>();

const panelRef = ref<InstanceType<typeof PermTreePanel>>();
const keyword = ref('');

const stats = ref({ checkedActionCount: 0, coveredModuleCount: 0, totalActionCount: 0 });

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

function confirm() {
  const perms = panelRef.value?.getPerms() || {};
  emit('confirm', perms);
  visible.value = false;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="920px"
    top="5vh"
    class="perm-dialog"
    destroy-on-close
  >
    <div class="dlg-head">
      <div class="sub">
        <span v-if="subtitle" class="sub-name">{{ subtitle }}</span>
        <span class="sub-tip">
          勾选即授权；<b>未勾选即无权限</b>（系统不提供「拒绝」语义）。
        </span>
      </div>
      <el-input
        v-model="keyword"
        :prefix-icon="Search"
        placeholder="搜索功能点"
        clearable
        size="small"
        class="search"
      />
    </div>

    <div class="dlg-body">
      <PermTreePanel
        ref="panelRef"
        :modules="modules"
        :perms="perms"
        :readonly="readonly"
        :keyword="keyword"
        @change="(s) => (stats = s)"
      />
    </div>

    <template #footer>
      <div class="dlg-foot">
        <div class="stat">
          已选
          <b>{{ stats.checkedActionCount }}</b>
          / {{ stats.totalActionCount }} 个权限点 · 覆盖
          <b>{{ stats.coveredModuleCount }}</b>
          个模块
        </div>
        <div>
          <el-button @click="visible = false">{{ readonly ? '关闭' : '取消' }}</el-button>
          <el-button v-if="!readonly" type="primary" @click="confirm">确定</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.dlg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eef1f5;
  margin-bottom: 10px;
}

.sub {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.sub-name {
  font-size: 13px;
  font-weight: 600;
  color: #3a7afe;
  background: #eef4ff;
  border-radius: 6px;
  padding: 2px 8px;
  white-space: nowrap;
}

.sub-tip {
  font-size: 12px;
  color: #909399;
}

.search {
  width: 200px;
  flex: none;
}

.dlg-body {
  max-height: 58vh;
  overflow: auto;
  padding-right: 4px;
}

.dlg-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.stat {
  font-size: 13px;
  color: #606266;
}

.stat b {
  color: #3a7afe;
  font-size: 15px;
  margin: 0 2px;
}
</style>
