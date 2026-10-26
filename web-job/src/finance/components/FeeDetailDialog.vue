<!--
  缴费单详情弹窗 · 共用组件（2026-10-26）

  【为什么抽出来】
    缴费管理的「详情」和账单明细里点某一笔的「详情」，用户要求是**同一个东西、
    同样的样式**（截图对比过）。原来是各写一份，账单明细那边字段少一大截、
    缴费类型也没同步（只显示第一条学费）。抽成一个组件后两边天然一致。

  【用法】
    <FeeDetailDialog v-model="visible" :fee-id="xxx" />
    传 feeId 就会自己拉 /api/finance/fee/detail。
-->
<template>
    <el-dialog v-model="visible" title="缴费单详情" width="720px" top="6vh">
      <el-descriptions v-if="detail" :column="2" border size="small">
        <el-descriptions-item label="学号">{{ dash(detail.studentNo) }}</el-descriptions-item>
        <el-descriptions-item label="姓名">{{ detail.studentName }}</el-descriptions-item>
        <el-descriptions-item label="班级">{{ dash(detail.className) }}</el-descriptions-item>
        <el-descriptions-item label="部门">{{ dash(detail.deptName) }}</el-descriptions-item>
        <!-- ★ 2026-10-26 合并单要列全所有费用类型（用户要求） -->
        <el-descriptions-item label="缴费类型">
          {{ detail.feeTypeNames?.length ? detail.feeTypeNames.join('、') : detail.feeTypeName }}
        </el-descriptions-item>
        <!-- ★ 2026-10-26 应缴 / 实缴 / 优惠 三个数分开列 -->
        <el-descriptions-item label="应缴 / 实缴">
          <div class="detail-money">
            <div class="dm-line">
              <span class="dm-k">应缴</span>
              <span class="amount">{{ formatAmount(detail.standardAmount ?? detail.amount) }}</span>
            </div>
            <div class="dm-line">
              <span class="dm-k">实缴</span>
              <span class="amount">{{ formatAmount(detail.amount) }}</span>
            </div>
            <div v-if="detail.discount" class="dm-line">
              <span class="dm-k">优惠</span>
              <span class="dm-discount">-{{ formatAmount(detail.discount) }}</span>
            </div>
          </div>
          <!-- ★ 2026-10-19 一张凭证覆盖多张单据时，本单只是其中一项 -->
          <div v-if="(detail.voucherGroupCount || 1) > 1" class="voucher-group">
            本单为其中一项，该凭证合计 {{ formatAmount(detail.voucherGroupAmount) }}
            （共 {{ detail.voucherGroupCount }} 笔）
          </div>
        </el-descriptions-item>
        <el-descriptions-item label="缴费状态">
          <el-tag :type="payStatusTagType(detail.payStatus)" size="small">
            {{ detail.payStatusName }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="费用周期">{{ dash(detail.period) }}</el-descriptions-item>
        <el-descriptions-item label="缴费日期">{{ dash(detail.payDate) }}</el-descriptions-item>
        <el-descriptions-item label="到期日期">{{ dash(detail.expireDate) }}</el-descriptions-item>
        <el-descriptions-item label="是否已核对">
          <el-tag :type="detail.isVerified ? 'success' : 'info'" size="small">
            {{ detail.isVerified ? '已核对' : '未核对' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="核对人">{{ dash(detail.verifiedByName) }}</el-descriptions-item>
        <el-descriptions-item label="是否入账">
          <el-tag :type="detail.isInBill ? 'success' : 'info'" size="small">
            {{ detail.isInBill ? '已入账单' : '未入账' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="核对时间">{{ dash(detail.verifiedTime) }}</el-descriptions-item>
        <el-descriptions-item v-if="detail.isRejected" label="打回原因" :span="2">
          <span class="reject-text">{{ dash(detail.rejectReason) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ dash(detail.remark) }}</el-descriptions-item>
      </el-descriptions>

      <!--
        ============ 这笔钱包含什么（总金额下面列的小列）============

        ★ 2026-10-19 用户口径：
          一张凭证 = 交的总金额，总金额下面列出包含的费用项。
          合计单（家长一次转一笔钱交多类费用）才有明细；
          单项单的物品就是「缴费类型」那一行，不重复列。
      -->
      <div v-if="detail && (detail.items?.length || 0) > 1" class="items-block">
        <div class="items-head">
          <span class="items-title">这笔钱包含</span>
          <span class="items-total">
            共 {{ detail.items?.length }} 项 · 合计 {{ formatAmount(detail.amount) }}
          </span>
        </div>
        <el-table :data="detail.items" size="small" border>
          <el-table-column prop="feeTypeName" label="费用项" min-width="140" />
          <el-table-column label="应缴" width="120" align="right">
            <template #default="{ row }">¥{{ row.standardAmountYuan }}</template>
          </el-table-column>
          <el-table-column label="实缴" width="120" align="right">
            <template #default="{ row }">
              <span class="items-amount">¥{{ row.amountYuan }}</span>
            </template>
          </el-table-column>
          <el-table-column label="优惠" width="120" align="right">
            <template #default="{ row }">
              <span v-if="row.discount > 0" class="items-discount">
                -¥{{ row.discountYuan }}
              </span>
              <span v-else class="dash">—</span>
            </template>
          </el-table-column>
        </el-table>
        <div class="items-note">
          实缴合计 = 本单金额 = 缴费凭证上的金额，财务按整单核对一次即可。
        </div>
      </div>

      <!-- ============ 缴费凭证（截图 + 转账单号）============ -->
      <div v-if="detail" class="voucher-block">
        <div class="voucher-head">
          <span class="voucher-title">缴费凭证</span>
          <el-tag v-if="detail.hasVoucher" type="success" size="small" effect="plain">已上传</el-tag>
          <el-tag v-else type="info" size="small" effect="plain">未上传</el-tag>
        </div>

        <!-- 有凭证：左右布局，左边截图右边信息 -->
        <div v-if="detail.hasVoucher" class="voucher-body">
          <!-- 截图 -->
          <div class="voucher-thumb-wrap">
            <el-image
              :src="voucherFullUrl(detail.voucherUrl)"
              :preview-src-list="[voucherFullUrl(detail.voucherUrl)]"
              :initial-index="0"
              fit="cover"
              class="voucher-thumb"
              :preview-teleported="true"
              hide-on-click-modal
            >
              <template #placeholder>
                <div class="thumb-loading">
                  <el-icon class="is-loading"><Loading /></el-icon>
                </div>
              </template>
              <template #error>
                <div class="thumb-error">
                  <el-icon><PictureFilled /></el-icon>
                  <span>截图加载失败</span>
                </div>
              </template>
            </el-image>
            <div class="thumb-tip">点击查看原图</div>
          </div>

          <!-- 转账信息 -->
          <div class="voucher-info">
            <div class="info-row">
              <span class="info-label">转账单号</span>
              <span class="info-value mono">{{ dash(detail.voucherNo) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">上传时间</span>
              <span class="info-value">{{ dash(detail.voucherTime) }}</span>
            </div>
            <!--
              ★ 2026-10-19 一次缴清多项费用：一张转账截图覆盖多张单据，
                截图金额是合计，本单只是其中一项 —— 这里明确写出来。
            -->
            <div v-if="(detail.voucherGroupCount || 1) > 1" class="info-row">
              <span class="info-label">凭证覆盖</span>
              <span class="info-value">
                共 {{ detail.voucherGroupCount }} 笔 · 合计
                <b>{{ formatAmount(detail.voucherGroupAmount) }}</b>
                <span class="voucher-group-inline">（本单 {{ formatAmount(detail.amount) }}）</span>
              </span>
            </div>
            <div class="info-row">
              <span class="info-label">凭证规则</span>
              <span class="info-value">
                <el-tag
                  :type="detail.voucherReusable ? 'warning' : 'info'"
                  size="small"
                  effect="plain"
                >
                  {{ detail.voucherReusable ? '可多人共用' : '一人一张' }}
                </el-tag>
              </span>
            </div>
            <div class="info-row">
              <span class="info-label">凭证截图</span>
              <span class="info-value">
                <el-button link type="primary" size="small" @click="openPreview(detail.voucherUrl)">
                  查看大图
                </el-button>
                <el-button link type="primary" size="small" @click="openInNewTab(detail.voucherUrl)">
                  新窗口打开
                </el-button>
              </span>
            </div>

            <!-- 餐费场景：同一张凭证还被谁用了 -->
            <div v-if="detail.sharedVoucherBy?.length" class="info-row shared-row">
              <span class="info-label">共用此凭证</span>
              <span class="info-value">
                <el-tag
                  v-for="s in detail.sharedVoucherBy"
                  :key="s.id"
                  size="small"
                  type="warning"
                  effect="plain"
                  class="shared-tag"
                >
                  {{ s.studentName }}（{{ s.studentNo || '—' }}）· {{ s.feeTypeName }}
                </el-tag>
              </span>
            </div>
          </div>
        </div>

        <!--
          无凭证（★ 2026-10-23：已收款但现金/线下收款没有转账截图）
          这种单也进核对台，所以提示语不能再说「尚未上传凭证」——
          那会让人以为班主任漏传了，实际是这笔本来就没有截图。
        -->
        <el-empty
          v-else
          :image-size="70"
          description="无电子凭证（现金 / 线下收款，可直接核对入账）"
        />
      </div>

      <template #footer>
        <!-- 父组件可以塞自己的操作按钮（缴费管理塞「核对这笔」，账单明细不塞） -->
        <slot name="footer-actions" :detail="detail" />
        <el-button @click="visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 凭证大图预览 -->
    <el-image-viewer
      v-if="previewVisible"
      :url-list="previewList"
      @close="previewVisible = false"
    />
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ElImageViewer } from 'element-plus';
import { Loading, PictureFilled } from '@element-plus/icons-vue';
import { fetchFeeDetail } from '@/finance/api/finance';
import { formatAmount, payStatusTagType, dash } from '@/finance/utils/finance';
import type { FeeDetail } from 'shared-types/finance';

const props = defineProps<{
  modelValue: boolean;
  /** 缴费单 id；为空且没传 fee 时不请求 */
  feeId?: string;
  /** 外部已经加载好的详情（缴费管理页自带 detail，传进来省一次请求） */
  fee?: FeeDetail | null;
}>();

const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const detail = ref<FeeDetail | null>(null);

watch(
  () => [props.modelValue, props.feeId, props.fee] as const,
  async ([open, id, fee]) => {
    if (!open) return;
    if (fee) {
      detail.value = fee;
      return;
    }
    if (!id) return;
    detail.value = null;
    try {
      detail.value = await fetchFeeDetail(String(id));
    } catch (e) {
      console.error('加载缴费单详情失败', e);
    }
  },
  { immediate: true },
);

/* ---------- 凭证查看 ---------- */
function voucherFullUrl(url?: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith('/') ? url : '/' + url;
}

const previewVisible = ref(false);
const previewList = ref<string[]>([]);

function openPreview(url?: string) {
  if (!url) return;
  previewList.value = [voucherFullUrl(url)];
  previewVisible.value = true;
}

function openInNewTab(url?: string) {
  if (!url) return;
  window.open(voucherFullUrl(url), '_blank');
}
</script>

<style scoped>
.detail-money {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dm-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.dm-k {
  font-size: 11.5px;
  color: #A2938E;
  min-width: 28px;
}

.dm-discount {
  font-weight: 600;
  color: #B8741A;
}

/* 一张凭证覆盖多张单据时的小字说明（共 N 笔 · 合计 ¥X） */
/* ★ 2026-10-26 合并单「等 N 项」标记 */
.item-more {
  font-size: 11.5px;
  color: #B8741A;
  font-weight: 600;
}

.voucher-group {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.3;
  color: #A2938E;
  white-space: nowrap;
}

/* 详情弹窗里「凭证覆盖」那一行的括号说明 */
.voucher-group-inline {
  color: #A2938E;
  font-size: 12px;
}

/* ---------- 「这笔钱包含」子表（合计单的分项） ---------- */

.items-block {
  margin-top: 16px;
}

.items-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 6px;
}

.items-title {
  font-weight: 600;
  color: #443432;
  font-size: 13px;
}

.items-total {
  font-size: 12px;
  color: #A2938E;
}

.items-amount {
  font-weight: 600;
  color: #443432;
}

.items-discount {
  color: #C06B2A;
}

.items-note {
  margin-top: 6px;
  font-size: 12px;
  color: #A2938E;
}

.dash {
  color: #C4B8B4;
}

.reject-text {
  color: #B22A23;
}

/* ---------- 缴费凭证区块 ---------- */

.voucher-block {
  margin-top: 16px;
  border: 1px solid #F1EAE5;
  border-radius: 6px;
  overflow: hidden;
}

.voucher-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #FAF7F4;
  border-bottom: 1px solid #F1EAE5;
}

.voucher-title {
  font-size: 14px;
  font-weight: 600;
  color: #443432;
}

.voucher-body {
  display: flex;
  gap: 18px;
  padding: 14px;
}

.voucher-thumb-wrap {
  flex-shrink: 0;
  width: 150px;
  text-align: center;
}

.voucher-thumb {
  width: 150px;
  height: 200px;
  border: 1px solid #F1EAE5;
  border-radius: 6px;
  cursor: zoom-in;
  background: #F6F3EF;
  transition: border-color 0.2s;
}

.voucher-thumb:hover {
  border-color: #CD3A33;
}

.thumb-tip {
  margin-top: 6px;
  font-size: 12px;
  color: #A2938E;
}

.thumb-loading,
.thumb-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  color: #C4B8B2;
  font-size: 12px;
}

.voucher-info {
  flex: 1;
  min-width: 0;
}

.info-row {
  display: flex;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed #F1EBE7;
  font-size: 13px;
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  flex-shrink: 0;
  width: 76px;
  color: #A2938E;
}

.info-value {
  flex: 1;
  min-width: 0;
  color: #443432;
  word-break: break-all;
}

.info-value.mono {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  letter-spacing: 0.3px;
}

.shared-row {
  align-items: flex-start;
}

.shared-tag {
  margin: 0 6px 6px 0;
}
</style>
