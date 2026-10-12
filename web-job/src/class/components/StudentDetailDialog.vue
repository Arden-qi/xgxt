<template>
  <el-dialog
    v-model="visible"
    :title="`学员详情 · ${d?.student.studentName || ''}`"
    width="980px"
    top="5vh"
    destroy-on-close
    @open="load"
  >
    <div v-loading="loading">
      <el-tabs v-model="tab">
        <!-- ================= 1 基础信息 ================= -->
        <el-tab-pane label="基础信息" name="base">
          <div class="dl-title">基础信息</div>
          <div class="dl-grid">
            <div v-for="it in baseItems" :key="it[0]" class="dl-item">
              <dt>{{ it[0] }}</dt>
              <dd>{{ it[1] === null || it[1] === undefined || it[1] === '' ? '—' : it[1] }}</dd>
            </div>
          </div>

          <div class="dl-title section-gap">身份证 / 户口本照片</div>
          <div class="grid-2">
            <div class="photo-box"><b>🪪</b><span>{{ d?.profile.idPhotoUrl || '未上传' }}</span></div>
            <div class="photo-box"><b>📕</b><span>{{ d?.profile.householdPhotoUrl || '未上传' }}</span></div>
          </div>

          <div class="dl-title section-gap">学籍与综合素质</div>
          <div class="dl-grid">
            <div class="dl-item"><dt>学生状态</dt><dd>{{ d?.student.studentStatusName || '—' }}</dd></div>
            <div class="dl-item"><dt>学习阶段</dt><dd>{{ d?.student.stageName || '—' }}</dd></div>
            <div class="dl-item"><dt>末班次数</dt><dd>{{ d?.student.repeatCount ?? 0 }} 次</dd></div>
            <div class="dl-item"><dt>备注</dt><dd>{{ d?.student.remark || '—' }}</dd></div>
            <div class="dl-item"><dt>学习状况</dt><dd>{{ d?.quality.studyStatus || '—' }}</dd></div>
            <div class="dl-item"><dt>自律程度</dt><dd>{{ d?.quality.discipline || '—' }}</dd></div>
            <div class="dl-item"><dt>学习能力</dt><dd>{{ d?.quality.ability || '—' }}</dd></div>
            <div class="dl-item"><dt>理解能力</dt><dd>{{ d?.quality.comprehension || '—' }}</dd></div>
            <div class="dl-item"><dt>表达能力</dt><dd>{{ d?.quality.expression || '—' }}</dd></div>
            <div class="dl-item"><dt>交际能力</dt><dd>{{ d?.quality.social || '—' }}</dd></div>
            <div class="dl-item"><dt>能力说明</dt><dd>{{ d?.quality.note || '—' }}</dd></div>
          </div>
          <div class="note-box section-gap">
            本页对应需求的「班主任补充剩余信息」：班级、档案、综合素质只更新传入字段，未传字段保持原值。
          </div>
        </el-tab-pane>

        <!-- ================= 2 市场信息 ================= -->
        <el-tab-pane label="市场信息" name="market">
          <div class="note-box brand">
            需求一之 1：学生信息<b>部分由咨询管理同步</b>，本页为同步过来的只读副本。
          </div>
          <el-table :data="marketRows" class="section-gap" size="small" border>
            <el-table-column prop="label" label="项" width="220" />
            <el-table-column prop="value" label="内容" />
          </el-table>
        </el-tab-pane>

        <!-- ================= 3 末班 ================= -->
        <el-tab-pane :label="`末班 (${d?.repeats.length ?? 0})`" name="repeat">
          <div class="note-box brand">
            末班记录同步「成绩管理」末班判定时的<b>成绩</b>，并留存<b>由哪个班级末到哪个班级</b>的转班记录。
          </div>
          <div class="dl-title">末班记录</div>
          <el-table :data="d?.repeats ?? []" size="small" border empty-text="该学员暂无末班记录">
            <el-table-column prop="studentNo" label="学号" width="120" />
            <el-table-column prop="repeatTime" label="末班时间" width="160" />
            <el-table-column prop="examName" label="考试名称" min-width="140">
              <template #default="{ row }">{{ row.examName || '—' }}</template>
            </el-table-column>
            <el-table-column prop="writtenScore" label="笔试" width="70" align="right">
              <template #default="{ row }">{{ row.writtenScore ?? '—' }}</template>
            </el-table-column>
            <el-table-column prop="interviewScore" label="面试" width="70" align="right">
              <template #default="{ row }">{{ row.interviewScore ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="综合成绩" width="90" align="right">
              <template #default="{ row }"><b class="comp-score">{{ row.compScore ?? '—' }}</b></template>
            </el-table-column>
            <el-table-column prop="fromClassName" label="原班级" width="90" />
            <el-table-column prop="toClassName" label="转入班级" width="90" />
            <el-table-column prop="repeatReason" label="末班原因" min-width="160" show-overflow-tooltip />
          </el-table>

          <div class="dl-title section-gap">转班记录（换班 / 末班流转）</div>
          <el-table :data="d?.studentTransfers ?? []" size="small" border empty-text="暂无换班记录">
            <el-table-column prop="transferTime" label="换班时间" width="160" />
            <el-table-column prop="fromClassName" label="原班级" width="100" />
            <el-table-column label="转入班级" width="100">
              <template #default="{ row }"><b>{{ row.toClassName || '—' }}</b></template>
            </el-table-column>
            <el-table-column prop="transferReason" label="换班原因" min-width="180" show-overflow-tooltip />
            <el-table-column prop="consultNo" label="关联单号" width="150">
              <template #default="{ row }"><span class="mono">{{ row.consultNo || '—' }}</span></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- ================= 4 宿舍 ================= -->
        <el-tab-pane label="宿舍" name="dorm">
          <div class="dl-grid">
            <div class="dl-item"><dt>姓名</dt><dd>{{ d?.student.studentName }}</dd></div>
            <div class="dl-item"><dt>学号</dt><dd>{{ d?.student.studentNo }}</dd></div>
            <div class="dl-item"><dt>宿舍号</dt><dd>{{ d?.dorm?.dormNo || d?.student.dormNo || '未分配' }}</dd></div>
            <div class="dl-item"><dt>入住日期</dt><dd>{{ d?.dorm?.checkInDate || '—' }}</dd></div>
          </div>
          <div class="note-box section-gap">
            需求四：宿舍信息<b>同步教务管理的宿舍信息</b>，本模块只读展示；换宿 / 退宿请走「宿舍管理」的申请流程。
          </div>
        </el-tab-pane>

        <!-- ================= 5 考试信息 ================= -->
        <el-tab-pane label="考试信息" name="exam">
          <div class="note-box brand">
            技术考试只显示最近 <b>3 次</b>；<b>综合成绩 = 笔试 × 50% + 面试 × 50%</b>，由系统自动计算。
            学员初高中升学时，升学成绩随档案一并保存。
          </div>
          <el-table :data="grades" class="section-gap" size="small" border empty-text="暂无考试成绩">
            <el-table-column label="姓名学号" width="170">
              <template #default="{ row }">{{ row.studentName }} / {{ row.studentNo }}</template>
            </el-table-column>
            <el-table-column prop="examName" label="考试名称" min-width="150" />
            <el-table-column prop="writtenScore" label="笔试" width="70" />
            <el-table-column prop="machineScore" label="机试" width="70" />
            <el-table-column prop="interviewScore" label="面试" width="70" />
            <el-table-column label="综合成绩" width="90">
              <template #default="{ row }"><b class="comp-score">{{ row.compScore ?? '—' }}</b></template>
            </el-table-column>
            <el-table-column prop="examResultName" label="判定" width="90" />
            <el-table-column prop="analysis" label="素质分析（非必填）" min-width="160" show-overflow-tooltip />
          </el-table>
        </el-tab-pane>

        <!-- ================= 6 班级信息 ================= -->
        <el-tab-pane label="班级信息" name="cls">
          <div class="dl-grid">
            <div class="dl-item"><dt>班级</dt><dd>{{ d?.classInfo?.className || d?.student.className || '—' }}</dd></div>
            <div class="dl-item"><dt>班主任名称</dt><dd>{{ d?.classInfo?.headTeacherName || '—' }}</dd></div>
            <div class="dl-item"><dt>教员</dt><dd>{{ d?.classInfo?.teacherName || '—' }}</dd></div>
            <div class="dl-item"><dt>助教</dt><dd>{{ d?.classInfo?.assistantName || '—' }}</dd></div>
            <div class="dl-item"><dt>教室</dt><dd>{{ d?.classInfo?.room || '—' }}</dd></div>
          </div>
          <div class="dl-title section-gap">历史信息（班级交接记录）</div>
          <el-table :data="d?.classTransfers ?? []" size="small" border empty-text="暂无交接记录">
            <el-table-column prop="transferTime" label="时间" width="170" />
            <el-table-column label="交接类型" width="100">
              <template #default="{ row }">{{ transferTypeName(row.transferType) }}</template>
            </el-table-column>
            <el-table-column prop="fromUserName" label="原负责人" width="120" />
            <el-table-column prop="toUserName" label="现负责人" width="120" />
            <el-table-column prop="reason" label="原因" min-width="160" show-overflow-tooltip />
          </el-table>
          <div class="note-box section-gap">
            班级、班主任、教员、助教信息与「班级管理」实时同步；班级交接后此处自动更新并留存历史。
          </div>
        </el-tab-pane>

        <!-- ================= 7 缴费信息 ================= -->
        <el-tab-pane :label="`缴费信息 (${fees.length})`" name="fee">
          <div class="note-box brand">
            记录该学员<b>从入学到结束</b>缴纳的各类费用（试学费用 / 学费 / 住宿费 / 餐费 / 保险费），
            含<b>金额、缴纳时间、到期时间</b>。缴费数据同步自财务管理，本模块只读展示。
          </div>
          <div class="dl-title section-gap">按费用类型汇总</div>
          <div class="dl-grid">
            <div v-for="t in feeTypeOptions" :key="t.value" class="dl-item">
              <dt>{{ t.label }}</dt>
              <dd>
                应缴 ¥{{ typeSummary(t.value).amount }} · 已缴 ¥{{ typeSummary(t.value).paid }}
                <span class="dim">（{{ typeSummary(t.value).count }} 笔）</span>
              </dd>
            </div>
          </div>

          <div class="dl-title section-gap">缴费明细</div>
          <el-table :data="fees" size="small" border empty-text="该学员暂无缴费记录">
            <el-table-column prop="feeTypeName" label="费用类型" width="120" />
            <el-table-column label="金额（元）" width="120" align="right">
              <template #default="{ row }">¥{{ row.amountYuan }}</template>
            </el-table-column>
            <el-table-column label="已缴（元）" width="120" align="right">
              <template #default="{ row }">¥{{ row.paidAmountYuan }}</template>
            </el-table-column>
            <el-table-column label="缴纳时间" width="140">
              <template #default="{ row }">{{ row.payDate || '—' }}</template>
            </el-table-column>
            <el-table-column label="到期时间" width="140">
              <template #default="{ row }">{{ row.expireDate || '—' }}</template>
            </el-table-column>
            <el-table-column label="缴费状态" width="110">
              <template #default="{ row }">
                <el-tag :type="dict.tagTypeOf('payStatus', row.payStatus)" size="small" effect="light">
                  {{ row.payStatusName || dict.label('payStatus', row.payStatus) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="支付方式" min-width="110">
              <template #default="{ row }">{{ row.payMethod || '—' }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { feeList, studentDetail, type ClassDetail } from '@/class/api/student';
import type { FeeRow, StudentDetail } from '@/class/api/types';
import { useDictStore } from '@/class/stores/dict';

/**
 * 学员详情（原型 6 个标签页 + 缴费信息）
 *
 * 结构与新增 / 修改弹窗**同序同名**，三处保持一致，避免"详情里有、编辑里没有"的字段断层。
 * 缴费信息为新增页签，数据来自财务管理同步的缴费记录（只读）。
 */
const props = defineProps<{ modelValue: boolean; studentId: string }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

const dict = useDictStore();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const loading = ref(false);
const tab = ref('base');
const d = ref<(StudentDetail & { classInfo: ClassDetail['classInfo'] | null }) | null>(null);

const baseItems = computed<Array<[string, unknown]>>(() => {
  const s = d.value?.student;
  const p = d.value?.profile;
  if (!s) return [];
  return [
    ['姓名', s.studentName],
    ['学号', s.studentNo],
    ['性别', s.genderName],
    ['年龄', s.age],
    ['班级', s.className],
    ['学历', s.education],
    ['手机号', s.phone],
    ['家长手机号', s.parentPhone],
    ['身份证号', s.idCard],
    ['入学时间', s.enrollDate],
    ['出生日期', p?.birthDate],
    ['籍贯', p?.origin],
    ['毕业院校', p?.graduateSchool],
    ['家庭住址', p?.homeAddress],
  ];
});

const marketRows = computed(() => {
  const m = d.value?.market;
  return [
    { label: '招生老师', value: m?.recruitTeacherName || '—' },
    { label: '招生老师电话号', value: m?.recruitPhone || '—' },
    { label: '咨询老师', value: m?.consultTeacherName || '—' },
    { label: '咨询老师电话号', value: m?.consultPhone || '—' },
  ];
});

/** 详情里的考试信息对应原型的「技术考试（最近三次）」 */
const grades = computed(() => (d.value?.grades ?? []).slice(-3).reverse());

/* ---------------- 缴费信息（财务管理同步，只读） ---------------- */
const fees = ref<FeeRow[]>([]);
const feeTypeOptions = computed(() => dict.options('feeType'));

/** 某费用类型的汇总：应缴 / 已缴（元）+ 笔数 */
function typeSummary(feeType: number): { amount: string; paid: string; count: number } {
  const rows = fees.value.filter((f) => f.feeType === feeType);
  const amount = rows.reduce((a, r) => a + Number(r.amount ?? 0), 0) / 100;
  const paid = rows.reduce((a, r) => a + Number(r.paidAmount ?? 0), 0) / 100;
  return { amount: amount.toFixed(2), paid: paid.toFixed(2), count: rows.length };
}

const TRANSFER_TYPE: Record<string, string> = {
  headTeacher: '班主任',
  teacher: '教员',
  assistant: '助教',
};
function transferTypeName(t: unknown): string {
  return TRANSFER_TYPE[String(t)] || String(t ?? '—');
}

async function load(): Promise<void> {
  if (!props.studentId) return;
  loading.value = true;
  tab.value = 'base';
  try {
    await dict.ensure();
    d.value = await studentDetail(props.studentId);
    fees.value = (await feeList({ studentId: props.studentId, size: 200 })).list ?? [];
  } finally {
    loading.value = false;
  }
}
</script>
