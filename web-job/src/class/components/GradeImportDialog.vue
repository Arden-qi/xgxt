<template>
  <el-dialog
    :model-value="modelValue"
    title="表格导入成绩"
    width="860px"
    top="5vh"
    destroy-on-close
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="gid-note">
      支持 <b>Excel 导出的 CSV / TSV</b>，或直接把表格<b>粘贴</b>进来。表头须含
      <b>「学号」</b>，其余列（姓名 / 笔试 / 面试 / 机试 / 判定(升或末) / 备注）按名称自动识别。
      综合成绩 = 笔试 × 50% + 面试 × 50%，由系统自动计算。
      <span v-if="examName" class="gid-exam">当前考试：<b>{{ examName }}</b></span>
    </div>

    <div class="gid-actions">
      <el-button type="primary" plain :icon="Upload" @click="pickFile">选择表格文件</el-button>
      <span class="gid-dim">支持 .csv / .tsv / .txt（UTF-8）</span>
      <input ref="fileInput" type="file" accept=".csv,.tsv,.txt" style="display: none" @change="onFile" />
    </div>

    <el-input
      v-model="raw"
      type="textarea"
      :rows="7"
      class="gid-paste"
      placeholder="或直接粘贴表格（从 Excel 复制后粘贴到这里，制表符分隔）……"
    />

    <div class="gid-actions">
      <el-button type="primary" :icon="View" :disabled="!raw.trim()" @click="parse">识别表格</el-button>
      <el-button link @click="loadSample">填入示例</el-button>
      <span v-if="parsed" class="gid-dim">已识别 {{ items.length }} 行 · {{ badCount }} 行无效</span>
    </div>

    <!-- 预览 -->
    <el-table
      v-if="parsed"
      :data="items"
      size="small"
      border
      max-height="300"
      class="gid-table"
      :row-class-name="rowClass"
    >
      <el-table-column type="index" label="#" width="44" />
      <el-table-column label="学号" width="130">
        <template #default="{ row }"><span class="mono">{{ row.studentNo }}</span></template>
      </el-table-column>
      <el-table-column prop="studentName" label="姓名" width="110">
        <template #default="{ row }">{{ row.studentName || '—' }}</template>
      </el-table-column>
      <el-table-column prop="writtenScore" label="笔试" width="70" align="right" />
      <el-table-column prop="interviewScore" label="面试" width="70" align="right" />
      <el-table-column prop="machineScore" label="机试" width="70" align="right" />
      <el-table-column label="判定" width="70">
        <template #default="{ row }">
          <el-tag :type="row.examResult === 2 ? 'danger' : 'success'" size="small" effect="dark">
            {{ row.examResult === 2 ? '末' : '升' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
      <el-table-column label="问题" min-width="120">
        <template #default="{ row }">
          <span v-if="row._err" class="gid-err">{{ row._err }}</span>
          <span v-else class="gid-ok">✓</span>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button
        type="primary"
        :loading="saving"
        :disabled="!validCount"
        @click="submit"
      >
        确认导入 {{ validCount ? `（${validCount} 条）` : '' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Upload, View } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { gradeImport } from '@/class/api/student';

/**
 * 表格导入成绩（需求 v1.5）
 *
 * 前端把 Excel 导出的 CSV / TSV、或粘贴的制表符数据解析成 items，
 * 交给后端 /api/class/grade/import 按学号匹配入库（综合成绩后端重算）。
 * 本组件不做任何第三方库依赖，纯字符串解析。
 */

export interface GradeImportItem {
  studentNo: string;
  studentName?: string | null;
  writtenScore?: number | null;
  machineScore?: number | null;
  interviewScore?: number | null;
  examResult?: number | null;
  analysis?: string | null;
  remark?: string | null;
  _err?: string;
}

const props = defineProps<{ modelValue: boolean; examId?: string | null; examName?: string | null }>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [] }>();

const fileInput = ref<HTMLInputElement>();
const raw = ref('');
const items = ref<GradeImportItem[]>([]);
const parsed = ref(false);
const saving = ref(false);

const validCount = computed(() => items.value.filter((it) => !it._err).length);
const badCount = computed(() => items.value.filter((it) => it._err).length);

function pickFile(): void {
  fileInput.value?.click();
}

function onFile(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    raw.value = String(reader.result ?? '');
    (e.target as HTMLInputElement).value = '';
  };
  reader.readAsText(f, 'utf-8');
}

/* ---------------- 解析 ---------------- */

/** 表头别名 → 字段名 */
const FIELD_ALIAS: Record<string, keyof GradeImportItem> = {
  学号: 'studentNo', 学生学号: 'studentNo', 编号: 'studentNo', studentno: 'studentNo', no: 'studentNo',
  姓名: 'studentName', 学生姓名: 'studentName', 名字: 'studentName', name: 'studentName',
  笔试: 'writtenScore', 笔试成绩: 'writtenScore', 笔试分数: 'writtenScore', written: 'writtenScore',
  面试: 'interviewScore', 面试成绩: 'interviewScore', 面试分数: 'interviewScore', interview: 'interviewScore',
  机试: 'machineScore', 机试成绩: 'machineScore', 机试分数: 'machineScore', machine: 'machineScore',
  判定: 'examResult', 结果: 'examResult', 考试结果: 'examResult', 状态: 'examResult', result: 'examResult',
  备注: 'remark', remark: 'remark', 说明: 'remark',
  分析: 'analysis', 素质分析: 'analysis',
};

function normHeader(s: string): string {
  return s.replace(/[\s*：:（）()]/g, '').toLowerCase();
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[，,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseResult(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^(升|通过|及格|合格|1|是|pass|y)$/i.test(s)) return 1;
  if (/^(末|未通过|不及格|不合格|2|否|fail|n)$/i.test(s)) return 2;
  return null;
}

/** 切分一行，兼容带引号的 CSV 单元格 */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function detectDelim(text: string): string {
  const first = text.split('\n')[0] ?? '';
  if (first.includes('\t')) return '\t';
  if (first.includes(',')) return ',';
  return '\t';
}

/** 默认列序（无表头时的兜底顺序） */
const DEFAULT_ORDER: Array<keyof GradeImportItem> = [
  'studentNo', 'studentName', 'writtenScore', 'interviewScore', 'machineScore', 'examResult', 'remark',
];

function parse(): void {
  items.value = [];
  parsed.value = false;
  const text = raw.value.replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    ElMessage.warning('没有可识别的内容');
    return;
  }
  const delim = detectDelim(text);
  const grid = lines.map((l) => splitLine(l, delim));

  // 判断第一行是不是表头
  const headCells = grid[0].map((c) => FIELD_ALIAS[normHeader(c)]).filter(Boolean);
  const hasHeader = headCells.length > 0 && (grid[0].some((c) => /学号|姓名|studentno|name/i.test(c)) || headCells.length >= 2);

  let fieldIdx: Array<keyof GradeImportItem | null>;
  let dataRows: string[][];
  if (hasHeader) {
    fieldIdx = grid[0].map((c) => FIELD_ALIAS[normHeader(c)] ?? null);
    dataRows = grid.slice(1);
  } else {
    fieldIdx = DEFAULT_ORDER.map((f, i) => (i < grid[0].length ? f : null));
    dataRows = grid;
  }

  if (!fieldIdx.includes('studentNo')) {
    ElMessage.error('未识别到「学号」列，请在表头加入「学号」');
    return;
  }

  for (const cells of dataRows) {
    if (!cells.some((c) => c !== '')) continue;
    const it: GradeImportItem = { studentNo: '' };
    fieldIdx.forEach((f, i) => {
      if (!f) return;
      const rawCell = cells[i] ?? '';
      if (f === 'studentNo') it.studentNo = rawCell;
      else if (f === 'studentName') it.studentName = rawCell || null;
      else if (f === 'writtenScore') it.writtenScore = parseNum(rawCell);
      else if (f === 'machineScore') it.machineScore = parseNum(rawCell);
      else if (f === 'interviewScore') it.interviewScore = parseNum(rawCell);
      else if (f === 'examResult') it.examResult = parseResult(rawCell);
      else if (f === 'remark') it.remark = rawCell || null;
      else if (f === 'analysis') it.analysis = rawCell || null;
    });

    // 校验
    if (!it.studentNo) it._err = '缺学号';
    else if (
      it.writtenScore == null && it.interviewScore == null && it.machineScore == null
    ) it._err = '缺分数';
    items.value.push(it);
  }

  parsed.value = true;
  if (!items.value.length) ElMessage.warning('没有识别到数据行');
}

function rowClass({ row }: { row: GradeImportItem }): string {
  return row._err ? 'gid-bad-row' : '';
}

/* ---------------- 提交 ---------------- */
async function submit(): Promise<void> {
  const valid = items.value.filter((it) => !it._err);
  if (!valid.length) {
    ElMessage.warning('没有可导入的有效行');
    return;
  }
  saving.value = true;
  try {
    const res = await gradeImport({
      examId: props.examId ?? null,
      items: valid.map((it) => ({
        studentNo: it.studentNo,
        studentName: it.studentName ?? null,
        writtenScore: it.writtenScore ?? null,
        machineScore: it.machineScore ?? null,
        interviewScore: it.interviewScore ?? null,
        examResult: it.examResult ?? 1,
        analysis: it.analysis ?? null,
        remark: it.remark ?? null,
      })),
    });
    const failed = res?.failed ?? 0;
    ElMessage.success(
      `导入完成：新增 ${res?.inserted ?? 0} 条，更新 ${res?.updated ?? 0} 条` +
        (failed ? `，失败 ${failed} 条（见下方提示）` : ''),
    );
    if (failed && res?.errors?.length) {
      // 逐条提示前 5 条失败原因
      res.errors.slice(0, 5).forEach((er) => ElMessage.warning(`${er.studentNo}：${er.reason}`));
    }
    emit('update:modelValue', false);
    emit('saved');
  } catch {
    // request 层已弹提示
  } finally {
    saving.value = false;
  }
}

function loadSample(): void {
  raw.value = [
    '学号\t姓名\t笔试\t面试\t机试\t判定\t备注',
    'S20260001\t张三\t86\t90\t88\t升\t',
    'S20260002\t李四\t55\t58\t60\t末\t阶段考核未通过',
  ].join('\n');
}
</script>

<style scoped>
.gid-note {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-2);
  margin-bottom: 10px;
}
.gid-exam {
  margin-left: 8px;
  color: var(--brand, #CD3A33);
}
.gid-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
}
.gid-dim {
  font-size: 12px;
  color: var(--text-2);
}
.gid-paste {
  margin-bottom: 4px;
}
.gid-table {
  margin-top: 6px;
}
.gid-ok {
  color: var(--green, #4E9A6C);
}
.gid-err {
  color: var(--red, #CD3A33);
  font-size: 12px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
:deep(.gid-bad-row) {
  background: #FDF4F2;
}
</style>
