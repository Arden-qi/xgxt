<script setup lang="ts">
/**
 * 学生详情抽屉（7 页签）
 *
 * 用法：<StudentDetailDrawer v-model="visible" :student-id="detailId" />
 * 页签：基础信息 / 校园网账号 / 缴费情况 / 宿舍 / 考试信息 / 市场信息 / 班级信息
 */

import { ref, watch, computed } from 'vue';
import type { StudentDetail } from 'shared-types/class-jh';
import { fetchStudentDetail } from '@/class-jh/api/student';
import {
  dash,
  formatDate,
  formatDateTime,
  formatRate,
  payStatusTagType,
  studentStatusTagType,
} from '@/class-jh/utils/format';

const props = defineProps<{
  modelValue: boolean;
  studentId?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const activeTab = ref('base');
const loading = ref(false);
const detail = ref<StudentDetail | null>(null);

watch(
  () => props.modelValue,
  async (open) => {
    if (!open || !props.studentId) return;
    activeTab.value = 'base';
    loading.value = true;
    try {
      detail.value = await fetchStudentDetail(props.studentId);
    } catch {
      detail.value = null;
    } finally {
      loading.value = false;
    }
  },
);
</script>

<template>
  <el-drawer v-model="visible" title="学生详情" size="62%">
    <div v-loading="loading">
      <template v-if="detail">
        <el-tabs v-model="activeTab">
          <!-- 1 基础信息 -->
          <el-tab-pane label="基础信息" name="base">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="学号">{{ dash(detail.studentNo) }}</el-descriptions-item>
              <el-descriptions-item label="姓名">{{ dash(detail.studentName) }}</el-descriptions-item>
              <el-descriptions-item label="性别">{{ dash(detail.genderName) }}</el-descriptions-item>
              <el-descriptions-item label="年龄">{{ dash(detail.age) }}</el-descriptions-item>
              <el-descriptions-item label="出生日期">{{ formatDate(detail.birthDate) }}</el-descriptions-item>
              <el-descriptions-item label="籍贯">{{ dash(detail.nativePlace) }}</el-descriptions-item>
              <el-descriptions-item label="部门">{{ dash(detail.deptName) }}</el-descriptions-item>
              <el-descriptions-item label="班级">{{ dash(detail.className) }}</el-descriptions-item>
              <el-descriptions-item label="学习阶段">{{ dash(detail.stageName) }}</el-descriptions-item>
              <el-descriptions-item label="学生状态">
                <el-tag :type="studentStatusTagType(detail.studentStatus)" size="small">
                  {{ detail.studentStatusName }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="学历">{{ dash(detail.education) }}</el-descriptions-item>
              <el-descriptions-item label="毕业院校">{{ dash(detail.graduateSchool) }}</el-descriptions-item>
              <el-descriptions-item label="入学时间">{{ formatDate(detail.enrollDate) }}</el-descriptions-item>
              <el-descriptions-item label="身份证号">{{ dash(detail.idCardNo) }}</el-descriptions-item>
              <el-descriptions-item label="手机号">{{ dash(detail.phone) }}</el-descriptions-item>
              <el-descriptions-item label="家长手机号">{{ dash(detail.parentPhone) }}</el-descriptions-item>
              <el-descriptions-item label="家庭住址" :span="2">{{ dash(detail.homeAddress) }}</el-descriptions-item>
              <el-descriptions-item label="出勤率">{{ formatRate(detail.attendanceRate) }}</el-descriptions-item>
              <el-descriptions-item label="末班次数">{{ dash(detail.repeatCount) }}</el-descriptions-item>
              <el-descriptions-item label="备注" :span="2">{{ dash(detail.remark) }}</el-descriptions-item>
              <el-descriptions-item label="综合素养" :span="2">{{ dash(detail.literacyDesc) }}</el-descriptions-item>
            </el-descriptions>
          </el-tab-pane>

          <!-- 2 校园网账号 -->
          <el-tab-pane label="校园网账号" name="net">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="校园网账号">{{ dash(detail.net?.netAccount) }}</el-descriptions-item>
              <el-descriptions-item label="初始密码">{{ dash(detail.net?.netInitPassword) }}</el-descriptions-item>
            </el-descriptions>
          </el-tab-pane>

          <!-- 3 缴费情况（★ 2026-10-06：与【财务管理·缴费管理】同步，实时为主 + 台账兜底） -->
          <el-tab-pane label="缴费情况" name="fee">
            <el-alert
              v-if="detail.feeMeta?.degraded"
              :title="detail.feeMeta?.message || '财务管理暂不可用，以下为最近一次同步的缴费记录'"
              type="warning"
              :closable="false"
              show-icon
              style="margin-bottom: 12px"
            />

            <div v-if="detail.feeMeta" class="fee-kpi">
              <div class="kpi">
                <span class="kpi-l">应缴合计</span>
                <span class="kpi-v">¥{{ detail.feeMeta.summary.totalAmountYuan }}</span>
              </div>
              <div class="kpi ok">
                <span class="kpi-l">已缴合计</span>
                <span class="kpi-v">¥{{ detail.feeMeta.summary.totalPaidYuan }}</span>
              </div>
              <div class="kpi" :class="Number(detail.feeMeta.summary.totalUnpaid) > 0 ? 'bad' : 'ok'">
                <span class="kpi-l">待缴合计</span>
                <span class="kpi-v">¥{{ detail.feeMeta.summary.totalUnpaidYuan }}</span>
              </div>
            </div>

            <el-table :data="detail.fee" border stripe size="small" empty-text="暂无缴费记录">
              <el-table-column type="index" label="序号" width="56" align="center" />
              <el-table-column prop="feeTypeName" label="缴费类型" width="96" />
              <el-table-column label="费用周期" width="96" align="center">
                <template #default="{ row }">{{ dash(row.period) }}</template>
              </el-table-column>
              <el-table-column prop="deptName" label="部门" width="86" align="center" />
              <el-table-column label="应缴（元）" width="106" align="right">
                <template #default="{ row }">{{ row.amountYuan }}</template>
              </el-table-column>
              <el-table-column label="已缴（元）" width="106" align="right">
                <template #default="{ row }">
                  <span :class="{ paid: Number(row.paidAmount) > 0 }">{{ row.paidAmountYuan }}</span>
                </template>
              </el-table-column>
              <el-table-column label="缴费状态" width="118" align="center">
                <template #default="{ row }">
                  <el-tag :type="payStatusTagType(row.payStatus)" size="small">
                    {{ row.payStatusName }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="缴费日期" width="120" align="center">
                <template #default="{ row }">{{ formatDate(row.payDate) }}</template>
              </el-table-column>
              <el-table-column label="到期日期" width="120" align="center">
                <template #default="{ row }">{{ formatDate(row.expireDate) }}</template>
              </el-table-column>
            </el-table>

            <div class="fee-tip">
              缴费数据来自 <b>财务管理 · 缴费管理</b>
              <template v-if="detail.feeMeta?.source === 'finance'">（实时同步；初高学部在财务侧对应「二三期」部门）</template>
              ，本模块只读；如需核对或补录请联系财务。
            </div>
          </el-tab-pane>

          <!-- 4 宿舍 -->
          <el-tab-pane label="宿舍" name="dorm">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="宿舍号">{{ dash(detail.dorm?.dormNo) }}</el-descriptions-item>
              <el-descriptions-item label="床位号">{{ dash(detail.dorm?.bedNo) }}</el-descriptions-item>
              <el-descriptions-item label="房间号">{{ dash(detail.dorm?.roomNo) }}</el-descriptions-item>
              <el-descriptions-item label="入住时间">{{ formatDate(detail.dorm?.checkInDate) }}</el-descriptions-item>
              <el-descriptions-item label="房间负责人">{{ dash(detail.dorm?.ownerName) }}</el-descriptions-item>
            </el-descriptions>
          </el-tab-pane>

          <!-- 5 考试信息 -->
          <el-tab-pane label="考试信息" name="exam">
            <el-table :data="detail.exam" border stripe size="small" empty-text="暂无考试记录">
              <el-table-column type="index" label="序号" width="60" align="center" />
              <el-table-column prop="examTypeName" label="考试类型" width="120" />
              <el-table-column label="考试日期" width="130">
                <template #default="{ row }">{{ formatDate(row.examDate) }}</template>
              </el-table-column>
              <el-table-column prop="scoreTotal" label="总分" width="90" align="center" />
              <el-table-column prop="examResultName" label="结果" width="100" align="center">
                <template #default="{ row }">{{ dash(row.examResultName) }}</template>
              </el-table-column>
              <el-table-column prop="scoreTeacherName" label="评分老师" />
            </el-table>
          </el-tab-pane>

          <!-- 6 市场信息 -->
          <el-tab-pane label="市场信息" name="mkt">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="招生老师">{{ dash(detail.mkt?.recruitTeacherName) }}</el-descriptions-item>
              <el-descriptions-item label="招生电话">{{ dash(detail.mkt?.recruitTeacherPhone) }}</el-descriptions-item>
              <el-descriptions-item label="咨询老师">{{ dash(detail.mkt?.consultTeacherName) }}</el-descriptions-item>
              <el-descriptions-item label="咨询电话">{{ dash(detail.mkt?.consultTeacherPhone) }}</el-descriptions-item>
              <el-descriptions-item label="入学时间">{{ formatDate(detail.mkt?.enrollDate) }}</el-descriptions-item>
            </el-descriptions>
          </el-tab-pane>

          <!-- 7 班级信息 -->
          <el-tab-pane label="班级信息" name="cls">
            <el-divider content-position="left">流程记录</el-divider>
            <el-table :data="detail.cls?.flows || []" border stripe size="small" empty-text="暂无流程记录">
              <el-table-column type="index" label="序号" width="60" align="center" />
              <el-table-column prop="flowTypeName" label="流程类型" width="120" />
              <el-table-column prop="flowStatus" label="状态" width="90" align="center">
                <template #default="{ row }">{{ dash(row.currentNodeName) }}</template>
              </el-table-column>
              <el-table-column label="申请时间" width="180">
                <template #default="{ row }">{{ formatDateTime(row.applyTime) }}</template>
              </el-table-column>
              <el-table-column prop="rejectReason" label="驳回原因">
                <template #default="{ row }">{{ dash(row.rejectReason) }}</template>
              </el-table-column>
            </el-table>

            <el-divider content-position="left">末班记录</el-divider>
            <el-table :data="detail.cls?.repeats || []" border stripe size="small" empty-text="暂无末班记录">
              <el-table-column type="index" label="序号" width="60" align="center" />
              <el-table-column prop="fromClassName" label="原班级" width="110" />
              <el-table-column prop="toClassName" label="转入班级" width="110" />
              <el-table-column prop="repeatReason" label="末班原因" />
              <el-table-column label="末班时间" width="180">
                <template #default="{ row }">{{ formatDateTime(row.repeatTime) }}</template>
              </el-table-column>
              <el-table-column prop="repeatCount" label="累计" width="70" align="center" />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </template>
      <el-empty v-else description="暂无数据" />
    </div>
  </el-drawer>
</template>

<style scoped>
/**
 * 缴费情况页签（★ 2026-10-06）
 * KPI 与「数据来源」提示的样式，尽量与大学部 / 实训两处详情保持一致。
 */
.fee-kpi {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}
.fee-kpi .kpi {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.fee-kpi .kpi-l {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.fee-kpi .kpi-v {
  font-weight: 600;
  font-size: 15px;
}
.fee-kpi .kpi.ok .kpi-v {
  color: var(--el-color-success);
}
.fee-kpi .kpi.bad .kpi-v {
  color: var(--el-color-danger);
}
.paid {
  color: var(--el-color-success);
  font-weight: 600;
}
.fee-tip {
  margin-top: 10px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
}
</style>
