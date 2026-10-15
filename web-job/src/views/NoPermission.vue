<template>
  <div class="no-perm">
    <el-result icon="warning" title="没有访问权限" sub-title="当前账号无权访问该页面">
      <template #extra>
        <div class="tips">
          <p>可能的原因：</p>
          <p>· 你的角色没有这个页面的访问权限</p>
          <p>· 权限由「权限管理」模块统一配置</p>
          <p v-if="roles.length" class="roles">当前角色：{{ roles.join('、') }}</p>
        </div>
        <div class="btns">
          <el-button type="primary" @click="goHome">回到有权限的页面</el-button>
        </div>
      </template>
    </el-result>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { myPages, myRoles } from '@/store/permission';

const router = useRouter();
const roles = ref<string[]>(myRoles.value);

function goHome() {
  // 跳到自己有权限的第一个页面；一个都没有就待在原地（显示提示）
  const first = myPages.value[0];
  if (first) {
    // 动态路由（含 :id）没法直接跳，退到父级
    const path = first.path.includes('/:') ? first.path.split('/:')[0] : first.path;
    router.replace(path);
  }
}
</script>

<style scoped>
.no-perm {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 60px 0;
}
.tips {
  color: #A2938E;
  font-size: 13px;
  line-height: 1.9;
  margin-bottom: 16px;
}
.tips p {
  margin: 0;
}
.roles {
  margin-top: 8px !important;
  color: #7A6C67;
}
.btns {
  margin-top: 8px;
}
</style>
