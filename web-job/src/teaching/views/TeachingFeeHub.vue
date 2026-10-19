<template>
  <div class="tfh">
    <!--
      ★ 2026-10-19 域重组：原四个学段页签（初高缴费台账 / 大学催缴 / 实训催费单 / 教务缴费）
        收成两个业务页签——
        · 「催费」= TeachingFeeUrge：初高缴费台账催费侧 + 大学催缴 + 就业催费单 聚合，
          带部门列与部门筛选（就业=实训催费单，两部门共用 sms_job 库）；
        · 「缴费」= 教务缴费总记录（PaymentList 原样，需 edu:fee:view 权限才显示页签）。
        老页面与老路由（/class-jh/fee、/class/urge、/fee-call、/edu/fee）未删，可随时回退。
    -->
    <el-tabs v-model="tab" class="tfh-tabs">
      <el-tab-pane label="催费" name="urge">
        <TeachingFeeUrge v-if="tab === 'urge'" />
      </el-tab-pane>
      <el-tab-pane v-if="canPay" label="缴费" name="pay" lazy>
        <PaymentList />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { canAct } from '@/store/permission';
import TeachingFeeUrge from './TeachingFeeUrge.vue';
import PaymentList from '@/views/edu/PaymentList.vue';

const tab = ref('urge');

/** 缴费页签需要教务缴费查看权限（PaymentList 内部还有更细的操作权限控制） */
const canPay = canAct('edu:fee:view', true);
</script>

<style scoped>
.tfh {
  padding: 8px 12px;
}
.tfh-tabs :deep(.el-tabs__content) {
  padding-top: 4px;
}
</style>
