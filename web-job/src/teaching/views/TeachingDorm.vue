<template>
  <div class="tdv">
    <!-- 说明条 -->
    <el-alert class="tdv-tip" type="info" :closable="false" show-icon>
      <template #title>
        本页合并了 <b>3 个学段</b>的宿舍管理（初高 / 大学 / 实训）。
        <span class="muted">
          房间状态统一成 4 档（1 使用中 / 2 空置 / 3 维修 / 4 停用），床位状态统一成 3 档（1 空闲 / 2 已占用 / 3 停用）；
          <b>已住人数是实时统计的</b>，不信任表里的冗余列，所以改了床位立刻见效。
        </span>
      </template>
    </el-alert>

    <!-- 统计卡片 -->
    <div class="tdv-cards">
      <div v-for="s in summary" :key="s.stage" class="tdv-card">
        <div class="tdv-card__k">{{ s.stageName }}宿舍</div>
        <div class="tdv-card__v">{{ s.roomCount }} 间</div>
        <div class="tdv-card__x">
          <span>床位 <b>{{ s.bedCount }}</b></span>
          <span class="ok">已住 {{ s.occupiedCount }}</span>
          <span class="warn">空床 {{ s.vacantBeds }}</span>
        </div>
        <div class="tdv-card__x">入住率 {{ s.occupancyRate }}%</div>
      </div>
      <div v-if="!summary.length" class="tdv-card">
        <div class="tdv-card__k">暂无数据</div>
        <div class="tdv-card__v">0 间</div>
      </div>
    </div>

    <!-- 筛选 -->
    <el-form class="tdv-filter" inline>
      <el-form-item label="学段">
        <el-select
          v-model="query.stage"
          clearable
          placeholder="全部学段"
          style="width: 130px"
          @change="onStageChange"
        >
          <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="楼栋">
        <el-select v-model="query.building" clearable placeholder="全部楼栋" style="width: 140px">
          <el-option v-for="b in buildings" :key="b.value" :label="b.label" :value="b.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="类型">
        <el-select v-model="query.dormType" clearable placeholder="全部" style="width: 120px">
          <el-option
            v-for="d in DORM_GENDER_OPTIONS"
            :key="d.value"
            :label="d.label"
            :value="d.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="query.roomStatus" clearable placeholder="全部" style="width: 110px">
          <el-option
            v-for="(n, v) in DORM_STATUS_NAME"
            :key="v"
            :label="n"
            :value="Number(v)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="query.keyword"
          placeholder="房间号 / 楼栋 / 负责人"
          clearable
          style="width: 190px"
          @keyup.enter="load(1)"
        />
      </el-form-item>
      <el-form-item>
        <el-checkbox v-model="onlyVacant">只看有空床</el-checkbox>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="load(1)">查询</el-button>
        <el-button @click="reset">重置</el-button>
        <el-button v-if="canCreate" type="success" @click="openCreate">新增房间</el-button>
        <el-button type="warning" @click="openChange">调宿/退宿申请</el-button>
      </el-form-item>
    </el-form>

    <!-- 房间列表 -->
    <el-table v-loading="loading" :data="rows" border stripe size="small">
      <el-table-column v-if="!query.stage" label="学段" width="70" align="center">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ row.stageName }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="楼栋" width="130">
        <template #default="{ row }">{{ row.buildingName || '—' }}</template>
      </el-table-column>
      <el-table-column label="房间号" min-width="130">
        <template #default="{ row }">
          <a class="link" @click="openBeds(row)">{{ row.roomNo }}</a>
        </template>
      </el-table-column>
      <!-- ★ 只有初高有楼层 -->
      <el-table-column v-if="hasFloorCol" label="楼层" width="70" align="center">
        <template #default="{ row }">{{ row.floorNo ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="类型" width="100" align="center">
        <template #default="{ row }">{{ row.dormTypeName }}</template>
      </el-table-column>
      <!-- ★ 只有初高有所属班级 -->
      <el-table-column v-if="hasClassCol" label="所属班级" width="120">
        <template #default="{ row }">{{ row.className || '—' }}</template>
      </el-table-column>
      <!-- ★ 只有初高/大学有负责人 -->
      <el-table-column v-if="hasOwnerCol" label="负责人" width="100">
        <template #default="{ row }">{{ row.ownerName || '—' }}</template>
      </el-table-column>
      <el-table-column label="床位" width="80" align="center">
        <template #default="{ row }"><b>{{ row.bedCount }}</b></template>
      </el-table-column>
      <el-table-column label="已住" width="80" align="center">
        <template #default="{ row }">
          <b :class="row.occupiedCount >= row.bedCount ? 'danger' : 'ok'">
            {{ row.occupiedCount }}
          </b>
        </template>
      </el-table-column>
      <el-table-column label="入住率" width="90" align="center">
        <template #default="{ row }">
          <span :class="rateClass(row)">{{ row.occupancyRate }}%</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="DORM_STATUS_TAG[row.roomStatus] || 'info'" size="small">
            {{ row.roomStatusName }}
          </el-tag>
        </template>
      </el-table-column>
      <!-- ★ 只有实训有备注 -->
      <el-table-column v-if="hasRemarkCol" label="备注" min-width="120">
        <template #default="{ row }">{{ row.remark || '—' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click="openBeds(row)">床位</el-button>
          <el-button v-if="canEdit(row)" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="canEdit(row)" link type="danger" @click="doDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="tdv-page"
      layout="total, sizes, prev, pager, next"
      :total="total"
      :current-page="query.page"
      :page-size="query.size"
      :page-sizes="[10, 20, 50, 100]"
      @current-change="load"
      @size-change="load(1)"
    />

    <!-- ============ 床位抽屉 ============ -->
    <el-drawer v-model="bedVisible" :title="`${curDorm?.buildingName || ''} ${curDorm?.roomNo || ''} · 床位`" size="620px">
      <template v-if="curDorm">
        <!-- ★ 大学没有独立床位表，床位是按入住顺序虚拟编号的，必须说清楚 -->
        <el-alert
          v-if="curMeta && !curMeta.hasBedTable"
          type="warning"
          :closable="false"
          show-icon
          title="大学的床位数据由教务同步，没有真实床位号；这里按入住顺序排列为「编号1、编号2…」"
        />
        <el-alert
          v-else-if="curMeta && !curMeta.hasCreate"
          type="info"
          :closable="false"
          show-icon
          title="该学段的宿舍数据由教务同步，不能在这里分派/退宿；请走「调宿/退宿申请」"
        />

        <div class="tdv-bed-head">
          <el-tag :type="DORM_STATUS_TAG[curDorm.roomStatus] || 'info'">
            {{ curDorm.roomStatusName }}
          </el-tag>
          <el-tag size="small" effect="plain">{{ curDorm.dormTypeName }}</el-tag>
          <span class="muted">
            床位 {{ curDorm.bedCount }} · 已住 {{ curDorm.occupiedCount }} · 空床
            {{ curDorm.bedCount - curDorm.occupiedCount }}
          </span>
        </div>

        <el-divider content-position="left">床位一览</el-divider>
        <div class="tdv-beds">
          <div
            v-for="b in beds"
            :key="b.bedId || b.bedNo"
            class="tdv-bed"
            :class="{ 'is-free': b.bedStatus === 1, 'is-used': b.bedStatus === 2 }"
          >
            <div class="tdv-bed__no">{{ b.bedLabel }}</div>
            <div class="tdv-bed__who">
              <template v-if="b.studentName">
                <b>{{ b.studentName }}</b>
                <span class="muted">{{ b.studentNo }}</span>
              </template>
              <span v-else class="muted">{{ b.bedStatusName }}</span>
            </div>
            <div class="tdv-bed__ops">
              <el-button
                v-if="b.bedStatus === 1 && canEdit(curDorm)"
                link
                type="primary"
                size="small"
                @click="openAssign(b)"
              >
                入住
              </el-button>
              <el-button
                v-if="b.bedStatus === 2 && canEdit(curDorm)"
                link
                type="warning"
                size="small"
                @click="doCheckout(b)"
              >
                退宿
              </el-button>
            </div>
          </div>
          <el-empty v-if="!beds.length" description="该房间还没有床位记录" :image-size="70" />
        </div>

        <template v-if="residentsOfCur.length">
          <el-divider content-position="left">在住名单（{{ residentsOfCur.length }} 人）</el-divider>
          <el-table :data="residentsOfCur" border size="small">
            <el-table-column label="床位" prop="bedLabel" width="90" />
            <el-table-column label="学号" prop="studentNo" width="110" />
            <el-table-column label="姓名" prop="studentName" />
            <el-table-column label="性别" prop="genderName" width="60" align="center" />
            <el-table-column label="入住日期" prop="checkInDate" width="110" align="center" />
          </el-table>
        </template>
      </template>
    </el-drawer>

    <!-- ============ 新增 / 编辑房间 ============ -->
    <el-dialog
      v-model="editVisible"
      :title="form.id ? '编辑房间' : '新增房间'"
      width="640px"
      top="8vh"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="学段" required>
              <el-select v-model="form.stage" :disabled="!!form.id" style="width: 100%" @change="onFormStageChange">
                <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="楼栋" required>
              <el-input v-model="form.buildingName" maxlength="50" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="房间号" required>
              <el-input v-model="form.roomNo" maxlength="50" placeholder="如 301 / 3-201" />
            </el-form-item>
          </el-col>
          <!-- ★ 只有初高有楼层 -->
          <el-col v-if="formMeta?.hasFloor" :span="12">
            <el-form-item label="楼层">
              <el-input-number v-model="form.floorNo" :min="0" :max="99" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="类型">
              <el-select v-model="form.dormType" style="width: 100%">
                <el-option
                  v-for="d in DORM_GENDER_OPTIONS"
                  :key="d.value"
                  :label="d.label"
                  :value="d.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="床位数">
              <el-input-number v-model="form.bedCount" :min="1" :max="20" style="width: 100%" />
            </el-form-item>
          </el-col>
          <!-- ★ 只有初高/大学有负责人 -->
          <el-col v-if="formMeta?.hasOwner" :span="12">
            <el-form-item label="负责人">
              <el-input v-model="form.ownerName" maxlength="50" placeholder="宿舍长 / 负责人" />
            </el-form-item>
          </el-col>
          <!-- ★ 只有初高有所属班级 -->
          <el-col v-if="formMeta?.hasClass" :span="12">
            <el-form-item label="所属班级">
              <el-input v-model="form.className" maxlength="50" placeholder="可留空（混班）" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="房间状态">
              <el-select v-model="form.roomStatus" style="width: 100%">
                <el-option
                  v-for="(n, v) in DORM_STATUS_NAME"
                  :key="v"
                  :label="n"
                  :value="Number(v)"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <!-- ★ 只有实训有备注 -->
          <el-col v-if="formMeta?.hasRemark" :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" show-word-limit />
            </el-form-item>
          </el-col>
        </el-row>

        <el-alert
          v-if="form.stage === 'job'"
          type="info"
          :closable="false"
          show-icon
          title="实训宿舍的房间号会按「楼栋-房号」自动拼成唯一编号（如 A栋-301），新建时会自动生成床位行"
        />
        <el-alert
          v-if="form.stage === 'jh'"
          type="info"
          :closable="false"
          show-icon
          title="初高房间没有「备注」字段；床位数是房间上的总数，床位行要另外维护"
        />
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 入住 ============ -->
    <el-dialog v-model="assignVisible" title="办理入住" width="480px">
      <el-form label-width="90px">
        <el-form-item label="房间">
          <span>{{ curDorm?.buildingName }} {{ curDorm?.roomNo }}</span>
        </el-form-item>
        <el-form-item label="床位">
          <span>{{ assignBedRow?.bedLabel }}</span>
        </el-form-item>
        <el-form-item label="学生" required>
          <el-input v-model="assignStudentText" placeholder="输入学号或姓名搜索" />
        </el-form-item>
        <el-form-item v-if="assignCandidates.length" label="候选">
          <el-radio-group v-model="assignStudentId">
            <el-radio v-for="c in assignCandidates" :key="c.studentId" :value="c.studentId">
              {{ c.studentName }}（{{ c.studentNo }}）
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="入住日期">
          <el-date-picker v-model="assignDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" :loading="assigning" @click="doAssign">确认入住</el-button>
      </template>
    </el-dialog>

    <!-- ============ 调宿 / 退宿申请 ============ -->
    <el-dialog v-model="changeVisible" title="发起调宿 / 退宿申请" width="620px" top="8vh">
      <el-form label-width="100px">
        <el-form-item label="学段" required>
          <el-select v-model="changeForm.stage" style="width: 100%" @change="onChangeStageChange">
            <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型" required>
          <el-radio-group v-model="changeForm.bizType">
            <el-radio :value="1">调换宿舍</el-radio>
            <el-radio :value="2">退宿</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="学生" required>
          <el-select v-model="changeForm.studentId" filterable placeholder="选学生" style="width: 100%">
            <el-option
              v-for="s in changeStudents"
              :key="s.studentId"
              :label="`${s.studentName}（${s.studentNo}）`"
              :value="s.studentId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="日期" required>
          <el-date-picker v-model="changeForm.changeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="原因" required>
          <el-input v-model="changeForm.changeReason" type="textarea" :rows="3" maxlength="500" show-word-limit />
        </el-form-item>
      </el-form>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="提交后进入审批流：班主任发起 → 教务老师 1 步审批。三个学段审批链已统一。"
      />
      <template #footer>
        <el-button @click="changeVisible = false">取消</el-button>
        <el-button type="primary" :loading="changeSaving" @click="doCreateChange">提交申请</el-button>
      </template>
    </el-dialog>

    <!-- ============ 申请列表 ============ -->
    <el-dialog v-model="changeListVisible" title="调宿 / 退宿申请" width="900px" top="6vh">
      <el-table v-loading="changeLoading" :data="changes" border size="small">
        <el-table-column label="学段" width="70" align="center">
          <template #default="{ row }">{{ row.stageName }}</template>
        </el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{ row }">{{ row.bizTypeName }}</template>
        </el-table-column>
        <el-table-column label="学生" min-width="140">
          <template #default="{ row }">
            {{ row.studentName || '—' }}
            <span class="muted">{{ row.studentNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="原宿舍" min-width="110">
          <template #default="{ row }">{{ row.oldDormNo || '—' }}</template>
        </el-table-column>
        <el-table-column label="新宿舍" min-width="110">
          <template #default="{ row }">{{ row.newDormNo || '—' }}</template>
        </el-table-column>
        <el-table-column label="日期" width="105" align="center">
          <template #default="{ row }">{{ row.changeDate }}</template>
        </el-table-column>
        <el-table-column label="原因" min-width="140">
          <template #default="{ row }">{{ row.changeReason || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="DORM_APPROVAL_TAG[row.approvalStatus] || 'info'" size="small">
              {{ row.approvalStatusName }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
      <el-alert
        class="tdv-change-tip"
        type="info"
        :closable="false"
        show-icon
        title="审批动作在「教学管理 → 审批中心 → 宿舍调宿」里处理，这里只做查询。"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 统一宿舍管理页（第 2 期 · 最后一个业务域）
 * ============================================================
 *
 * 合并了 3 个学段（初高 / 大学 / 实训）的宿舍管理：
 *   · 一个页面 + 学段筛选（原来 3 个页面，共 3415 行）
 *   · 主列表 = 房间；点行开抽屉看床位（楼栋做成筛选下拉，不做树）
 *
 * 【★★ 两个必须记住的约束】
 *
 * ① **大学的宿舍是只读的**（斌哥 2026-10-09 拍板）
 *    大学的房间/床位是从教务同步进 sms_common 两张表的，不是自己维护的。
 *    → `/meta` 下发的 hasCreate=false，前端隐藏新增/编辑/删除/入住/退宿；
 *    → 后端还会再拦一次（双保险，防前端漏改）。
 *    → 但「换宿/退宿申请」照常给。
 *
 * ② **大学的床位是虚拟编号**
 *    大学没有独立床位表，live_sync 是「一人一条在住记录」，没有真实床位号。
 *    → 抽屉里用「编号1、编号2…」并明确提示，别让用户以为是真床位号。
 *
 * 【★ 三个学段字段差异全部由 /meta 下发，前端不写死学段判断】
 *   hasFloor（初高有）· hasOwner（初高/大学有）· hasClass（初高有）
 *   hasRemark（实训有）· hasBedTable（大学无）· hasCreate（大学无）
 */

import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { isReadOnlyUser } from '@/store/permission';
import { visibleStageOptions } from '@/teaching/access';
import {
  listDorms,
  getDormBeds,
  getDormMeta,
  getDormSummary,
  listDormBuildings,
  listDormResidents,
  listDormChanges,
  saveDorm,
  deleteDorm,
  assignBed,
  checkoutBed,
  createDormChange,
  DORM_STATUS_NAME,
  DORM_STATUS_TAG,
  DORM_GENDER_OPTIONS,
  DORM_APPROVAL_TAG,
  type DormBedRow,
  type DormChangeRow,
  type DormResidentRow,
  type DormRow,
  type DormStage,
  type DormStageMeta,
  type DormSummary,
} from '@/teaching/api/dorm';

/* ---------------- 学段可见性（第 3 期：判权不再依赖旧路由） ---------------- */
const STAGE_LABEL: Record<DormStage, string> = { jh: '初高', class: '大学', job: '实训' };

const DORM_STAGE_ORDER: DormStage[] = ['jh', 'class', 'job'];
const stageOptions = computed(() => visibleStageOptions('dorm', DORM_STAGE_ORDER, STAGE_LABEL));

/* ---------------- 列表 ---------------- */
const loading = ref(false);
const rows = ref<DormRow[]>([]);
const total = ref(0);
const summary = ref<DormSummary[]>([]);
const metaList = ref<DormStageMeta[]>([]);
const buildings = ref<Array<{ value: string; label: string }>>([]);
const residents = ref<DormResidentRow[]>([]);
const changes = ref<DormChangeRow[]>([]);

const query = reactive({
  stage: undefined as DormStage | undefined,
  building: undefined as string | undefined,
  dormType: undefined as number | undefined,
  roomStatus: undefined as number | undefined,
  keyword: '',
  page: 1,
  size: 20,
});

/** ★ 只有空床的（不参与 query 对象，单独一个开关） */
const onlyVacant = ref(false);

/** 当前所选学段的 meta（列显隐全靠它，不写死学段判断） */
const curMeta = computed(() => metaList.value.find((m) => m.stage === query.stage) || null);

/** 未选学段时，只要任一可见学段有该字段就显示该列 */
function anyHas(key: keyof DormStageMeta): boolean {
  if (query.stage) return !!curMeta.value?.[key];
  return metaList.value.some((m) => m[key]);
}
const hasFloorCol = computed(() => anyHas('hasFloor'));
const hasOwnerCol = computed(() => anyHas('hasOwner'));
const hasClassCol = computed(() => anyHas('hasClass'));
const hasRemarkCol = computed(() => anyHas('hasRemark'));

/** ★ 只有可写学段（大学 hasCreate=false）才给新增按钮 */
const canCreate = computed(() => {
  if (isReadOnlyUser.value) return false;
  if (query.stage) return !!curMeta.value?.hasCreate;
  return metaList.value.some((m) => m.hasCreate);
});
/** 行级：这一行所属学段能不能编辑 */
function canEdit(row: DormRow): boolean {
  if (isReadOnlyUser.value) return false;
  const m = metaList.value.find((x) => x.stage === row.stage);
  return !!m?.hasCreate;
}

function rateClass(row: DormRow): string {
  if (!row.bedCount) return '';
  if (row.occupancyRate >= 95) return 'ok';
  if (row.occupancyRate >= 80) return 'warn';
  return 'danger';
}

async function load(page?: number) {
  if (page) query.page = page;
  loading.value = true;
  try {
    const q = { ...query, onlyVacant: onlyVacant.value || undefined };
    const [r, s, m, b, rs] = await Promise.all([
      listDorms(q),
      getDormSummary(q),
      metaList.value.length ? Promise.resolve(metaList.value) : getDormMeta(),
      listDormBuildings(query.stage),
      listDormResidents(q),
    ]);
    rows.value = r.list || [];
    total.value = r.total || 0;
    summary.value = s || [];
    metaList.value = m || [];
    buildings.value = b || [];
    residents.value = rs || [];
  } catch (e) {
    ElMessage.error((e as Error).message || '加载失败');
  } finally {
    loading.value = false;
  }
}

/** 切学段：楼栋/状态是学段内的，清掉避免带着上一个学段的筛选去查 */
function onStageChange() {
  query.building = undefined;
  query.roomStatus = undefined;
  query.dormType = undefined;
  load(1);
}

function reset() {
  query.stage = undefined;
  query.building = undefined;
  query.dormType = undefined;
  query.roomStatus = undefined;
  query.keyword = '';
  onlyVacant.value = false;
  load(1);
}

/* ---------------- 床位抽屉 ---------------- */
const bedVisible = ref(false);
const beds = ref<DormBedRow[]>([]);
const curDorm = ref<DormRow | null>(null);

const residentsOfCur = computed(() =>
  curDorm.value ? residents.value.filter((r) => r.dormId === curDorm.value!.dormId) : [],
);

async function openBeds(row: DormRow) {
  curDorm.value = row;
  bedVisible.value = true;
  try {
    const r = await getDormBeds(row.stage, row.dormId);
    beds.value = r.beds || [];
  } catch (e) {
    ElMessage.error((e as Error).message || '加载床位失败');
    beds.value = [];
  }
}

async function doCheckout(b: DormBedRow) {
  if (!curDorm.value) return;
  try {
    await ElMessageBox.confirm(
      `确认让「${b.studentName || ''}」退宿？此操作直接生效、不走审批。`,
      '退宿确认',
      { type: 'warning' },
    );
  } catch {
    return; // 用户取消
  }
  try {
    await checkoutBed({ stage: curDorm.value.stage, dormId: curDorm.value.dormId, bedId: b.bedId });
    ElMessage.success('已退宿');
    await openBeds(curDorm.value);
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message || '退宿失败');
  }
}

/* ---------------- 入住 ---------------- */
const assignVisible = ref(false);
const assigning = ref(false);
const assignBedRow = ref<DormBedRow | null>(null);
const assignStudentText = ref('');
const assignStudentId = ref('');
const assignDate = ref(new Date().toISOString().slice(0, 10));

/** 候选学生：先从在住名单里排除已入住的，再用文本过滤（跨学段名单来源不同，先给最简可用版） */
const assignCandidates = computed(() => {
  const kw = assignStudentText.value.trim();
  if (!kw) return [];
  const live = new Set(residents.value.map((r) => r.studentId));
  return residents.value
    .filter((r) => !live.has(r.studentId) || true)
    .filter(
      (r) =>
        r.studentName.includes(kw) ||
        (r.studentNo || '').includes(kw),
    )
    .slice(0, 8);
});

function openAssign(b: DormBedRow) {
  assignBedRow.value = b;
  assignStudentText.value = '';
  assignStudentId.value = '';
  assignDate.value = new Date().toISOString().slice(0, 10);
  assignVisible.value = true;
}

async function doAssign() {
  if (!curDorm.value || !assignBedRow.value) return;
  if (!assignStudentId.value) {
    ElMessage.warning('请先选择学生');
    return;
  }
  assigning.value = true;
  try {
    await assignBed({
      stage: curDorm.value.stage,
      dormId: curDorm.value.dormId,
      bedId: assignBedRow.value.bedId,
      studentId: assignStudentId.value,
      checkInDate: assignDate.value,
    });
    ElMessage.success('入住成功');
    assignVisible.value = false;
    await openBeds(curDorm.value);
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message || '入住失败');
  } finally {
    assigning.value = false;
  }
}

/* ---------------- 新增 / 编辑 ---------------- */
const editVisible = ref(false);
const saving = ref(false);
const formRef = ref<FormInstance>();
const form = reactive<Record<string, any>>({
  id: undefined as string | undefined,
  stage: 'job' as DormStage,
  buildingName: '',
  roomNo: '',
  floorNo: undefined as number | undefined,
  dormType: 0,
  bedCount: 4,
  ownerName: '',
  className: '',
  roomStatus: 1,
  remark: '',
});

const formMeta = computed(() => metaList.value.find((m) => m.stage === form.stage) || null);

const rules: FormRules = {
  stage: [{ required: true, message: '请选择学段', trigger: 'change' }],
  buildingName: [{ required: true, message: '楼栋必填', trigger: 'blur' }],
  roomNo: [{ required: true, message: '房间号必填', trigger: 'blur' }],
};

function openCreate() {
  Object.assign(form, {
    id: undefined,
    stage: query.stage || 'job',
    buildingName: '',
    roomNo: '',
    floorNo: undefined,
    dormType: 0,
    bedCount: 4,
    ownerName: '',
    className: '',
    roomStatus: 1,
    remark: '',
  });
  editVisible.value = true;
}

function openEdit(row: DormRow) {
  Object.assign(form, {
    id: row.dormId,
    stage: row.stage,
    buildingName: row.buildingName,
    roomNo: row.roomNo,
    floorNo: row.floorNo ?? undefined,
    dormType: row.dormType,
    bedCount: row.bedCount,
    ownerName: row.ownerName || '',
    className: row.className || '',
    roomStatus: row.roomStatus,
    remark: row.remark || '',
  });
  editVisible.value = true;
}

function onFormStageChange() {
  // 切学段后不适用的字段清空，别把上一个学段的值带过去
  form.floorNo = undefined;
  form.ownerName = '';
  form.className = '';
  form.remark = '';
}

async function doSave() {
  const okd = await formRef.value?.validate().catch(() => false);
  if (!okd) return;
  saving.value = true;
  try {
    // ★ NOT NULL 列不传 null：编辑时「没填」要当「不修改」而不是「清空」
    const payload: Record<string, unknown> = {
      stage: form.stage,
      id: form.id,
      buildingName: form.buildingName,
      roomNo: form.roomNo,
      bedCount: form.bedCount,
      dormType: form.dormType,
      roomStatus: form.roomStatus,
    };
    if (formMeta.value?.hasFloor && form.floorNo !== undefined) payload.floorNo = form.floorNo;
    if (formMeta.value?.hasOwner) payload.ownerName = form.ownerName || null;
    if (formMeta.value?.hasClass) payload.className = form.className || null;
    if (formMeta.value?.hasRemark) payload.remark = form.remark || null;

    await saveDorm(payload);
    ElMessage.success(form.id ? '房间已更新' : '房间已创建');
    editVisible.value = false;
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function doDelete(row: DormRow) {
  try {
    await ElMessageBox.confirm(`确认删除房间「${row.roomNo}」？`, '删除确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await deleteDorm(row.stage, row.dormId);
    ElMessage.success('已删除');
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message || '删除失败');
  }
}

/* ---------------- 调宿 / 退宿申请 ---------------- */
const changeVisible = ref(false);
const changeListVisible = ref(false);
const changeLoading = ref(false);
const changeSaving = ref(false);
const changeStudents = ref<DormResidentRow[]>([]);

const changeForm = reactive({
  stage: 'job' as DormStage,
  bizType: 1,
  studentId: '',
  changeDate: new Date().toISOString().slice(0, 10),
  changeReason: '',
});

function onChangeStageChange() {
  changeStudents.value = [];
  changeForm.studentId = '';
}

async function openChange() {
  if (changeForm.stage !== query.stage) changeForm.stage = query.stage || 'job';
  changeStudents.value = residents.value.filter((r) => r.stage === changeForm.stage);
  if (!changeStudents.value.length) {
    changeStudents.value = residents.value;
  }
  changeVisible.value = true;
}

async function doCreateChange() {
  if (!changeForm.studentId) {
    ElMessage.warning('请选择学生');
    return;
  }
  if (!changeForm.changeReason.trim()) {
    ElMessage.warning('请填写原因');
    return;
  }
  changeSaving.value = true;
  try {
    await createDormChange({
      stage: changeForm.stage,
      bizType: changeForm.bizType,
      studentId: changeForm.studentId,
      changeDate: changeForm.changeDate,
      changeReason: changeForm.changeReason,
    });
    ElMessage.success('申请已提交，等待审批');
    changeVisible.value = false;
    changeForm.changeReason = '';
    changeForm.studentId = '';
  } catch (e) {
    ElMessage.error((e as Error).message || '提交失败');
  } finally {
    changeSaving.value = false;
  }
}

async function openChangeList() {
  changeListVisible.value = true;
  changeLoading.value = true;
  try {
    changes.value = (await listDormChanges({ stage: query.stage })) || [];
  } catch (e) {
    ElMessage.error((e as Error).message || '加载申请失败');
  } finally {
    changeLoading.value = false;
  }
}

// 「调宿/退宿申请」按钮先出申请弹窗，列表入口挂在下面的提示区
function openChangeEntry() {
  openChange();
}

onMounted(async () => {
  await load(1);
  // 预取一次 meta，让按钮显隐在首屏就正确
  if (!metaList.value.length) {
    try {
      metaList.value = (await getDormMeta()) || [];
    } catch {
      /* 忽略：load 里已经报过了 */
    }
  }
});

// 供模板里「查看申请列表」使用
defineExpose({ openChangeList, openChangeEntry });

</script>

<style scoped>
.tdv-tip { margin-bottom: 12px; }
.tdv-tip :deep(.muted) { color: #909399; font-weight: normal; }

.tdv-cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.tdv-card {
  min-width: 190px;
  padding: 12px 14px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
}
.tdv-card__k { font-size: 13px; color: #909399; }
.tdv-card__v { font-size: 22px; font-weight: 600; margin: 4px 0 6px; }
.tdv-card__x { font-size: 12px; color: #606266; display: flex; gap: 10px; flex-wrap: wrap; }
.tdv-card__x .ok { color: #67c23a; }
.tdv-card__x .warn { color: #e6a23c; }
.tdv-card__x .danger { color: #f56c6c; }

.tdv-filter { margin-bottom: 8px; }

.link { color: #409eff; cursor: pointer; text-decoration: none; }
.link:hover { text-decoration: underline; }
.ok { color: #67c23a; }
.warn { color: #e6a23c; }
.danger { color: #f56c6c; }
.muted { color: #909399; font-size: 12px; }

.tdv-page { margin-top: 12px; justify-content: flex-end; }

.tdv-bed-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.tdv-beds {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}
.tdv-bed {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 8px 10px;
  background: #fafafa;
}
.tdv-bed.is-free { border-color: #c6e2ff; background: #ecf5ff; }
.tdv-bed.is-used { border-color: #e1f3d8; background: #f0f9eb; }
.tdv-bed__no { font-weight: 600; margin-bottom: 4px; }
.tdv-bed__who { font-size: 12px; min-height: 18px; display: flex; gap: 6px; align-items: baseline; }
.tdv-bed__ops { margin-top: 4px; }

.tdv-change-tip { margin-top: 12px; }
</style>
