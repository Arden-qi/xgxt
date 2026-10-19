<template>
  <div class="tfh">
    <!--
      ★ 2026-10-19 域重组（按用户二次要求调整）：页签只有两个——
        · 「催费」= 原「初高」页（FeeList：缴费台账 + 催费推送/催缴记录 + 导出）改的名，
          功能一行没动；中途试过跨部门聚合页（TeachingFeeUrge），因丢失初高功能已撤下删除；
        · 「缴费」= 教务缴费总记录（PaymentList 原样）。
        页签显隐沿用原学段页签的权限码（stageVisible('fee', 'jh' / 'edu')）。
        老页面/老路由（/class-jh/fee、/class/urge、/fee-call、/edu/fee）未删，可回退。
    -->
    <el-tabs v-model="tab" class="tfh-tabs">
      <el-tab-pane v-if="showUrge" label="催费" name="urge">
        <FeeList v-if="tab === 'urge'" />
      </el-tab-pane>
      <el-tab-pane v-if="showPay" label="缴费" name="pay" lazy>
        <PaymentList />
      </el-tab-pane>
    </el-tabs>
    <el-empty v-if="!showUrge && !showPay" description="当前账号没有催费/缴费相关权限" :image-size="60" />
  </div>
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue';
import { stageVisible } from '../access';

const tab = ref(stageVisible('fee', 'jh') ? 'urge' : 'pay');

const FeeList = defineAsyncComponent(() => import('@/class-jh/views/FeeList.vue'));
const PaymentList = defineAsyncComponent(() => import('@/views/edu/PaymentList.vue'));

/** 页签显隐沿用原学段页签的权限码（初高缴费台账 / 教务缴费总记录） */
const showUrge = stageVisible('fee', 'jh');
const showPay = stageVisible('fee', 'edu');
</script>

<style scoped>
.tfh {
  padding: 8px 12px;
}
.tfh-tabs :deep(.el-tabs__content) {
  padding-top: 4px;
}
</style>
