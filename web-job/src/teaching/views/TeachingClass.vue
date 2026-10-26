<template>
  <div class="tcv">
    <!-- 说明条 -->
    <!-- ★ 2026-10-22 批注（红字）：「班级状态没有已结业，前后端以及上方的说明全都删除已结业」
         ① 已结业(4) 整体下线 —— 状态字典 / 流转表 / 统计卡 / 说明全部去掉，封班即终态；
         ② 部门从 4 个变 3 个：实训班与就业班在库里是同一张表、dept_code 都是 3，
            下拉里单列「实训」是重复，统一并入「就业部」查询；
         ③ 「班级编号」「结业日期」列只有就业部有（两张 meta 里 hasClassCode / hasCloseDate 都是 true），
            「出勤率」初高按当日、其余部门按累计。 -->
    <el-alert class="tcv-tip" type="info" :closable="false" show-icon>
      <template #title>
        本页合并了 <b>3 个部门</b>的班级信息（初高部 / 大学部 / 就业部，实训班归就业部）。
        <span class="muted">
          班级状态码（1 开放 / 2 封班 / 5 实训 / 6 待就业 / 7 已就业：升实训后自动为 5 实训、
          升就业后为 6 待就业（按钮变【待就业】并出现【已就业】）、
          【已就业】确认后为 7 已就业（班内还有非「已就业 / 退学」学生时不可操作）；封班即终态，可解封回开放）；
          「班级编号」「结业日期」只有就业部有，「出勤率」初高按当日、其余部门按累计 —— 表单会按部门自动隐藏不适用的字段。
        </span>
      </template>
    </el-alert>

    <!-- 统计卡片（多学段时按学段分行） -->
    <div class="tcv-cards">
      <div v-for="s in summary" :key="s.stage" class="tcv-card">
        <div class="tcv-card__k">{{ s.stageName }}班级</div>
        <div class="tcv-card__v">{{ s.total }}</div>
        <div class="tcv-card__x">
          <span class="ok">开放 {{ s.openCount }}</span>
          <span>封班 {{ s.closedCount }}</span>
        </div>
        <!-- ★ 2026-10-21 批注：升实训 / 升就业 / 已就业 会写入三个系统态，
             卡片不加这三项，数字就和「班级总数」对不上。没有时才不显示。 -->
        <div v-if="s.trainingCount || s.waitEmployCount || s.employedCount" class="tcv-card__x">
          <span class="warn">实训 {{ s.trainingCount || 0 }}</span>
          <span>待就业 {{ s.waitEmployCount || 0 }}</span>
          <span class="ok">已就业 {{ s.employedCount || 0 }}</span>
        </div>
        <div class="tcv-card__x">在班学生 {{ s.studentCount }} 人</div>
      </div>
      <div v-if="!summary.length" class="tcv-card">
        <div class="tcv-card__k">暂无数据</div>
        <div class="tcv-card__v">0</div>
      </div>
    </div>

    <!-- 筛选 -->
    <!-- ★ 2026-10-21 批注：「将教学管理的所有筛选选择完成后，点击查询才可以进行查询」
         → 部门 / 阶段 / 状态 三个下拉只改条件、不自动发请求，
           全部选完由用户点【查询】才查（之前选完即查，一改条件列表就跳）。
    ★ 2026-10-22 批注：「选择部门时不进行查询，点击查询，才可以按照所选内容进行查询」
         → 光不自动发请求还不够：列表的列显隐 / 出勤率列头 / 部门列都跟着 query.stage 走，
           选个部门列表当场就变样，看起来还是"选了就查"。
           现在拆成两套状态：query = 正在填的条件（草稿），applied = 已生效的条件
           （点【查询】/【重置】时快照过去）。列表、统计卡、列显隐一律只看 applied。 -->
    <el-form class="tcv-filter" inline>
      <!-- 2026-10-16 按批注：原「学段」筛选改名「部门」。
           ★ 2026-10-22：选项 = 初高部 / 大学部 / 就业部（「实训」并入就业部，
             见 api/class.ts#CLASS_DEPT_STAGES）。 -->
      <el-form-item label="部门">
        <el-select v-model="query.stage" clearable placeholder="全部部门" style="width: 130px" @change="onStageChange">
          <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="phaseOptions.length" label="阶段">
        <el-select v-model="query.phaseCode" clearable placeholder="全部" style="width: 140px">
          <el-option v-for="p in phaseOptions" :key="p.value" :label="p.label" :value="p.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="query.classStatus" clearable placeholder="全部" style="width: 120px">
          <!-- 2026-10-19 批注：删除「待结业」选项 -->
          <!-- 2026-10-21 批注：删除「已结业」选项 → 选项表见 api/class.ts#CLASS_STATUS_SELECTABLE -->
          <!-- 2026-10-22 批注：「已结业」状态整体下线（后端流转表里也没有 4 了） -->
          <el-option v-for="s in CLASS_STATUS_SELECTABLE" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="query.keyword"
          placeholder="班级名 / 编号 / 班主任"
          clearable
          style="width: 180px"
          @keyup.enter="applyQuery"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="applyQuery">查询</el-button>
        <el-button @click="reset">重置</el-button>
        <el-button v-if="!isReadOnlyUser" type="success" @click="openCreate">新增班级</el-button>
        <!-- ★ 2026-10-22：阶段方案设计从「系统设置」搬到这里，只给校长 / 学管主任 -->
        <el-button v-if="canDesignScheme" :icon="SetUp" @click="schemeVisible = true">阶段方案设计</el-button>
      </el-form-item>
    </el-form>

    <!-- 阶段方案设计（弹窗；组件与原来系统设置里的方案页是同一套逻辑） -->
    <el-dialog v-model="schemeVisible" title="阶段方案设计" width="900px" top="6vh" destroy-on-close>
      <StageSchemePanel @changed="onSchemeChanged" />
      <template #footer>
        <el-button @click="schemeVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 列表 -->
    <!-- ★ 列宽纪律：内容大多只有 2~4 个字，一律用 min-width 让浏览器按需收缩/伸展，
         不要拍固定 width —— 之前 17 列固定宽度合计约 1800px，屏幕装不下，
         每列一大片空白（学生档案页 12 列约 1215px，是对照基准）。 -->
    <el-table v-loading="loading" :data="rows" border stripe size="small">
      <!-- 2026-10-16：原来「学段」与「部门」是两列（部门列取 row.deptName），
           批注口径下重名，合并成一列 —— 取部门名，没部门就退回学段名 -->
      <el-table-column v-if="!applied.stage" label="部门" width="70" align="center">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ row.deptName || row.stageName }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="班级名称" min-width="110">
        <template #default="{ row }">
          <a class="link" @click="openDetail(row)">{{ row.className }}</a>
        </template>
      </el-table-column>
      <!-- ★ 只有实训有这一列 -->
      <el-table-column v-if="hasClassCodeCol" label="班级编号" min-width="105">
        <template #default="{ row }">{{ row.classCode || '—' }}</template>
      </el-table-column>
      <!-- ★ 阶段回显：优先「方案里的阶段名」，老班级退回阶段码名称（见 phaseTextOf） -->
      <el-table-column label="阶段" min-width="90" align="center">
        <template #default="{ row }">{{ phaseTextOf(row) }}</template>
      </el-table-column>
      <el-table-column label="班主任" min-width="70">
        <template #default="{ row }">{{ row.headTeacherName || '—' }}</template>
      </el-table-column>
      <el-table-column label="教员" min-width="70">
        <template #default="{ row }">{{ row.teacherName || '—' }}</template>
      </el-table-column>
      <el-table-column label="助教" min-width="70">
        <template #default="{ row }">{{ row.assistantName || '—' }}</template>
      </el-table-column>
      <!-- ★ 只有大学/实训有交棒岗位（初高没有） -->
      <el-table-column v-if="!applied.stage || applied.stage !== 'jh'" label="项目经理" min-width="80">
        <template #default="{ row }">{{ row.projectManagerName || '—' }}</template>
      </el-table-column>
      <el-table-column v-if="!applied.stage || applied.stage !== 'jh'" label="就业老师" min-width="80">
        <template #default="{ row }">{{ row.employmentTeacherName || '—' }}</template>
      </el-table-column>
      <el-table-column label="人数" width="55" align="center">
        <template #default="{ row }">
          <b>{{ row.studentCount }}</b>
        </template>
      </el-table-column>
      <!-- ★ 列头按学段口径动态改字：初高是「今日」出勤率，别写成「出勤率」 -->
      <el-table-column :label="rateLabel" min-width="92" align="center">
        <template #default="{ row }">
          <span v-if="row.attendanceRate === null">—</span>
          <span v-else :class="rateClass(row)">{{ row.attendanceRate }}%</span>
        </template>
      </el-table-column>
      <el-table-column label="教室" min-width="95">
        <template #default="{ row }">{{ row.classroom || '—' }}</template>
      </el-table-column>
      <el-table-column label="开班日期" min-width="100" align="center">
        <template #default="{ row }">{{ row.openDate || '—' }}</template>
      </el-table-column>
      <!-- ★ 只有实训有结业日期 -->
      <el-table-column v-if="hasCloseDateCol" label="结业日期" min-width="100" align="center">
        <template #default="{ row }">{{ row.closeDate || '—' }}</template>
      </el-table-column>
      <!-- ★ 2026-10-21 批注：状态列要能看见「实训 / 待就业 / 已就业」——
           列多表宽，不固定的话会被挤到可视区外（截图里只剩半个字）。
           固定在右侧、紧挨操作列，滚动时始终可见。 -->
      <el-table-column label="状态" width="82" align="center" fixed="right">
        <template #default="{ row }">
          <el-tag :type="tagType(row.classStatus)" size="small">{{ row.classStatusName }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="340" fixed="right" align="center">
        <template #default="{ row }">
          <!-- 2026-10-19 批注：按钮「花名册」改名「详情」（抽屉里不只有名单，还有班级信息与交接记录） -->
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          <el-button v-if="!isReadOnlyUser" link type="primary" @click="openEdit(row)">编辑</el-button>
          <!-- 2026-10-19 批注：操作列加【交接】；原来单独的【改状态】移进编辑弹窗 -->
          <el-button v-if="!isReadOnlyUser" link type="success" @click="openHandover(row)">交接</el-button>
          <!-- 2026-10-20 批注：交接后面加【升实训】（只对大学部班级开放） -->
          <el-button
            v-if="!isReadOnlyUser && row.stage === 'class'"
            link
            type="warning"
            @click="openTraining(row)"
          >
            升实训
          </el-button>
          <!-- ★ 2026-10-23 批注第 2 条：「**就业部**才有【升就业】」——
               就业部在库里是 job（实训班）/ emp（就业部自建班）两个学段，
               两个都要出现按钮（见 isEmploymentStage）。
               点一下弹确认，把该班学生状态改为「待就业」，班级状态也改「待就业」。
               升就业成功后这个按钮**变成【待就业】**（只表示当前态，不可再点），
               后面再出现【已就业】。已是待就业 / 已就业的班不再显示【升就业】。 -->
          <el-button
            v-if="!isReadOnlyUser && isEmploymentStage(row.stage) && canUpgradeEmployment(row)"
            link
            type="warning"
            :loading="employmentSaving === row.classId"
            @click="doEmploymentUpgrade(row)"
          >
            升就业
          </el-button>
          <!-- ★ 2026-10-23 补充批注：「状态变为待就业就**不显示**【待就业】这个按钮了」
               原来升就业成功后按钮变成灰的【待就业】占位，现在整块去掉 ——
               待就业状态只由「状态」列的标签体现，操作列只留可点的【已就业】。 -->
          <!-- ★ 2026-10-23 批注第 3 条：【待就业】之后才有【已就业】。
               点击 → 识别整班学生状态 →
                 全部「已就业 / 退学」→ 提示班级人数 / 就业人数 → 确认改「已就业」；
                 还有别的状态 → 只提示各状态人数及人员，**不可操作**。 -->
          <el-button
            v-if="!isReadOnlyUser && isEmploymentStage(row.stage) && Number(row.classStatus) === CLASS_STATUS_CODE.WAIT_EMPLOY"
            link
            type="success"
            :loading="employedSaving === row.classId"
            @click="doConfirmEmployed(row)"
          >
            已就业
          </el-button>
          <el-button v-if="!isReadOnlyUser" link type="danger" @click="doDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- ★ 2026-10-20 批注：固定每页 20 条，去掉条数下拉（10/50/100），剩余的翻页看 -->
    <el-pagination
      class="tcv-page"
      layout="total, prev, pager, next"
      :total="total"
      :current-page="applied.page"
      :page-size="applied.size"
      @current-change="load"
    />

    <!-- ============ 详情（原「花名册」，2026-10-19 改名） ============ -->
    <el-drawer v-model="detailVisible" :title="`${detail?.base.className || ''} · 详情`" size="560px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <!-- ★ 2026-10-21 批注：「同步班级管理的部门」—— 列表「部门」列取的是 deptName（就业部），
               详情原来取 stageName（实训），两边对不上；统一成 deptName 优先、无部门才退回学段名。 -->
          <el-descriptions-item label="部门">{{ detail.base.deptName || detail.base.stageName }}</el-descriptions-item>
          <el-descriptions-item label="班级名称">{{ detail.base.className }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.base.classCode" label="班级编号">
            {{ detail.base.classCode }}
          </el-descriptions-item>
          <el-descriptions-item label="阶段">{{ phaseTextOf(detail.base) }}</el-descriptions-item>
          <el-descriptions-item label="班主任">{{ detail.base.headTeacherName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="教员">{{ detail.base.teacherName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="助教">{{ detail.base.assistantName || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.base.projectManagerName" label="项目经理">
            {{ detail.base.projectManagerName }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.base.employmentTeacherName" label="就业老师">
            {{ detail.base.employmentTeacherName }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.base.universityNo" label="大学学号">
            {{ detail.base.universityNo }}
          </el-descriptions-item>
          <el-descriptions-item :label="detail.base.stage === 'job' ? '教室地点' : '教室'">
            {{ detail.base.classroom || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="开班日期">{{ detail.base.openDate || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.base.closeDate" label="结业日期">
            {{ detail.base.closeDate }}
          </el-descriptions-item>
          <el-descriptions-item label="在班人数">{{ detail.base.studentCount }}</el-descriptions-item>
          <el-descriptions-item :label="detail.base.attendanceRateKind === 'today' ? '今日出勤率' : '累计出勤率'">
            {{ detail.base.attendanceRate === null ? '—' : `${detail.base.attendanceRate}%` }}
          </el-descriptions-item>
          <el-descriptions-item label="班级状态">
            <el-tag :type="tagType(detail.base.classStatus)" size="small">
              {{ detail.base.classStatusName }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">花名册（{{ detail.roster.length }} 人）</el-divider>
        <el-table :data="detail.roster" border size="small" max-height="420">
          <el-table-column label="学号" width="110">
            <template #default="{ row }">{{ row.studentNo || '—' }}</template>
          </el-table-column>
          <el-table-column label="姓名" width="100">
            <template #default="{ row }">{{ row.studentName || '—' }}</template>
          </el-table-column>
          <el-table-column label="性别" width="60" align="center">
            <template #default="{ row }">{{ row.genderName || '—' }}</template>
          </el-table-column>
          <!-- ★ 只有实训有独立花名册表，才有入班方式 -->
          <el-table-column v-if="detail.base.stage === 'job'" label="入班方式" width="100">
            <template #default="{ row }">{{ row.joinTypeName || '—' }}</template>
          </el-table-column>
          <el-table-column label="入班日期" width="110" align="center">
            <template #default="{ row }">{{ row.joinDate || '—' }}</template>
          </el-table-column>
          <!-- ★ 2026-10-21 批注：「更改同步学生档案的该学生的状态」
               → 这一列显示**学生档案里的学生状态**（实训中 / 待就业 / 已就业…），
                 不再固定显示花名册的「在班 / 已离班」。数据由后端 roster 回读学生主档下发。 -->
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <!-- ★ 2026-10-21 批注（红框圈整列）：「学生状态为【退学】的，任何操作都不可更改该状态」
                   → 退学单独打灰标签 + 锁标记，把「这一条是终态、谁也不能改」显示出来
                     （写保护在后端 teaching/shared/statusLock.ts：编辑档案 / 升实训 / 升就业 / 末班 全拦）。 -->
              <el-tooltip
                v-if="isQuitStatus(row)"
                content="已退学：状态为终态，任何操作都不会更改该状态"
                placement="top"
              >
                <el-tag type="info" size="small" effect="plain">退学 · 锁定</el-tag>
              </el-tooltip>
              <template v-else>{{ row.studentStatusName || row.inClassStatusName || '—' }}</template>
            </template>
          </el-table-column>
        </el-table>

        <!-- 2026-10-19 批注：交接记录同步到班级详情（按时间倒序，只列真正换了人的岗位） -->
        <el-divider content-position="left">交接记录（{{ detailHandovers.length }}）</el-divider>
        <el-empty v-if="!detailHandovers.length" description="暂无交接记录" :image-size="56" />
        <el-table v-else :data="detailHandovers" border size="small">
          <el-table-column label="交接日期" width="95" align="center">
            <template #default="{ row }">{{ row.handoverDate || '—' }}</template>
          </el-table-column>
          <el-table-column label="岗位变更" min-width="230">
            <template #default="{ row }">
              <div v-for="c in handoverChanges(row)" :key="c.role" class="ho-line">
                <span class="ho-role">{{ c.role }}</span>
                <span class="ho-old">{{ c.from || '（空白）' }}</span>
                <span class="ho-arrow">→</span>
                <span class="ho-new">{{ c.to || '（空白）' }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="原因" width="130" show-overflow-tooltip>
            <template #default="{ row }">{{ row.reason || '—' }}</template>
          </el-table-column>
          <el-table-column label="操作人" width="70" align="center">
            <template #default="{ row }">{{ row.operatorName || '—' }}</template>
          </el-table-column>
        </el-table>
      </template>
    </el-drawer>

    <!-- ============ 新增 / 编辑 ============ -->
    <el-dialog
      v-model="editVisible"
      :title="form.id ? '编辑班级' : '新增班级'"
      width="900px"
      top="6vh"
      destroy-on-close
    >
      <!-- ★ 2026-10-26 批注：「进行部门的选择的时候，不显示必选项的文字提示」
           el-form 的 validate-on-rule-change 默认为 true —— rules 是 computed，
           切换部门会重算 rules（就业部放开班主任/教员、露出项目经理/就业老师），
           组件随即把**整张表单**校验一遍，于是红字在没点保存时就全冒出来了。
           关掉它：规则变化只影响后续的校验，不再立刻出提示。 -->
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="110px"
        :validate-on-rule-change="false"
      >
        <el-row :gutter="12">
          <!-- 2026-10-15 按批注：删除「学段」选择器，学段由「部门」自动判定
               （初高部 → 初高；大学部 → 大学；实训从实训页签进入仍可新增） -->
          <el-col :span="8">
            <el-form-item label="班级名称" prop="className">
              <el-input v-model="form.className" maxlength="50" placeholder="请填写班级名称" />
            </el-form-item>
          </el-col>
          <!-- ★ 2026-10-21 用户口径：班级编号三部门统一（初高部/大学部/就业部），必填 -->
          <!-- ★ 2026-10-22 用户口径：去掉「生成」按钮，一律由相关人员手工填写 -->
          <!-- ★ 2026-10-23 用户口径：「班级编号只能新建班级可创建，编辑班级里的班级编号不可更改」
               → 只有新增时能填，编辑时只读（后端 save 也会忽略编辑传上来的编号）。 -->
          <el-col :span="8">
            <el-form-item label="班级编号" prop="classCode">
              <el-input
                v-model="form.classCode"
                maxlength="32"
                :disabled="!!form.id"
                :placeholder="form.id ? '班级编号创建后不可修改' : 'Q17/J101/T101'"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="部门" prop="deptCode" required>
              <el-select v-model="form.deptCode" style="width: 100%" @change="onFormDeptChange">
                <el-option v-for="d in DEPT_OPTIONS" :key="d.value" :label="d.label" :value="d.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <!-- ★ 2026-10-16：阶段方案（选项按「部门」过滤；在 系统设置 · 阶段方案 页维护）
               ★ 2026-10-20：数据源统一成后端 meta 的 planOptions（t_class_stage_plan +
                 t_class_stage）。原「/api/teaching/class/scheme-options」读的
                 t_class_stage_scheme 两张表从未建过，那套实现已整体删除。 -->
          <el-col :span="8">
            <el-form-item label="阶段方案" required>
              <el-select
                v-model="formPlanId"
                clearable
                placeholder="请选择方案"
                style="width: 100%"
                @change="onPlanChange"
              >
                <el-option v-for="p in formPlanOptions" :key="p.id" :label="p.name" :value="p.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <!-- ★ 阶段选项 = 当前方案里的阶段；没选方案 → 退回该学段的阶段清单（历史数据仍可编辑） -->
          <el-col v-if="formPhaseOptions.length" :span="8">
            <el-form-item label="阶段" prop="phaseCode" required>
              <el-select v-model="form.phaseCode" clearable placeholder="请选择" style="width: 100%">
                <el-option v-for="p in formPhaseOptions" :key="p.value" :label="p.label" :value="p.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <!-- 2026-10-19 批注：原来的操作列【改状态】移到编辑弹窗里；
               「待结业」已删除。
               ★ 2026-10-21：实训 / 待就业 / 已就业 是系统态，只读
                 （只能由操作列的【升实训】【升就业】【已就业】写入）。
               ★ 2026-10-22：「已结业」整体下线 —— 状态只剩 开放 ⇄ 封班，
                 封班即终态（可解封回开放），下拉里不会再出现已结业。 -->
          <el-col v-if="form.id" :span="8">
            <el-form-item label="班级状态">
              <el-select v-model="form.classStatus" style="width: 100%" :disabled="editStatusLocked">
                <el-option v-for="s in editStatusOptions" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <!-- 2026-10-15 改版：删除「班主任/教员/助教」工号/ID 输入框，
               姓名字段直接接入权限管理的用户列表，下拉选择（选人自动带 ID）
               ★ 2026-10-23 批注：标签去掉「姓名」（班主任姓名 → 班主任），
                 下拉按「职位 + 部门」过滤 —— 部门选初高部就只显示初高部的班主任。
                 规则与兜底见 @/teaching/classStaff.ts（staffOf）。 -->
          <el-col :span="8">
            <el-form-item
              label="班主任"
              prop="headTeacherId"
              :required="form.deptCode !== DeptCode.EMPLOYMENT"
            >
              <el-select
                v-model="form.headTeacherId"
                clearable
                filterable
                placeholder="按职位选人，请选择"
                :loading="staffLoading"
                style="width: 100%"
                @change="onStaffChange('headTeacher', $event)"
              >
                <el-option v-for="u in formStaff('headTeacher')" :key="u.id" :label="u.userName" :value="u.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item
              label="教员"
              prop="teacherId"
              :required="form.deptCode !== DeptCode.EMPLOYMENT"
            >
              <el-select
                v-model="form.teacherId"
                clearable
                filterable
                placeholder="按职位选人，请选择"
                :loading="staffLoading"
                style="width: 100%"
                @change="onStaffChange('teacher', $event)"
              >
                <el-option v-for="u in formStaff('teacher')" :key="u.id" :label="u.userName" :value="u.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="助教">
              <el-select
                v-model="form.assistantId"
                clearable
                filterable
                placeholder="按职位选人，请选择"
                :loading="staffLoading"
                style="width: 100%"
                @change="onStaffChange('assistant', $event)"
              >
                <el-option v-for="u in formStaff('assistant')" :key="u.id" :label="u.userName" :value="u.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <!-- 2026-10-16 按批注：加回「项目经理 / 就业老师」——不再是工号/ID 输入框，
               而是和 班主任/教员/助教 同一套规则：下拉按「职位 + 部门」过滤，选人自动带 ID。
               ★ 2026-10-26 批注（红字）：「项目经理和就业老师，只在部门选择为就业部的时候显示」
                 → 显示条件由「学段 ≠ 初高」改成「部门 = 就业部(3)」：
                   大学部、初高部一律不显示（原来大学部也会露出来）。
                 → 就业部（含实训 job / 就业 emp 两个学段）新增时必填，见 rules。 -->
          <template v-if="form.deptCode === DeptCode.EMPLOYMENT">
            <el-col :span="8">
              <el-form-item label="项目经理" prop="projectManagerName">
                <el-select
                  v-model="form.projectManagerId"
                  clearable
                  filterable
                  placeholder="按职位选人，请选择"
                  :loading="staffLoading"
                  style="width: 100%"
                  @change="onStaffChange('projectManager', $event)"
                >
                  <el-option v-for="u in formStaff('projectManager')" :key="u.id" :label="u.userName" :value="u.id" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="就业老师" prop="employmentTeacherName">
                <el-select
                  v-model="form.employmentTeacherId"
                  clearable
                  filterable
                  placeholder="按职位选人，请选择"
                  :loading="staffLoading"
                  style="width: 100%"
                  @change="onStaffChange('employmentTeacher', $event)"
                >
                  <el-option v-for="u in formStaff('employmentTeacher')" :key="u.id" :label="u.userName" :value="u.id" />
                </el-select>
              </el-form-item>
            </el-col>
          </template>
          <!-- 2026-10-19 批注：教室按「楼栋-房间号」规定格式输出，例如 A-201。
               输入宽容（A栋-102 / 教学楼 A-102 / a102 都能写），失焦即归一；
               认不出来的格式保存时会被拦下并提示正确写法。 -->
          <el-col :span="8">
            <el-form-item :label="curMeta?.classroomLabel || '教室'" prop="classroom">
              <el-input
                v-model="form.classroom"
                :placeholder="`例如：${CLASSROOM_EXAMPLE}`"
                maxlength="20"
                clearable
                @blur="onClassroomBlur"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="开班日期">
              <el-date-picker v-model="form.openDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <!-- ★ 只有实训有结业日期 -->
          <el-col v-if="curMeta?.hasCloseDate" :span="8">
            <el-form-item label="结业日期">
              <el-date-picker v-model="form.closeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <!-- ★ 大学那张表没有 remark 列 -->
          <el-col v-if="form.stage !== 'class'" :span="24">
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
          title="实训班新建时默认「封班」状态 —— 能进实训/就业阶段的班级只会是封班，「开放」已废弃"
        />
        <el-alert
          v-if="form.stage === 'class'"
          type="info"
          :closable="false"
          show-icon
          title="大学班级没有「班级编号」也没有「备注」字段（那两张表里就没这两列），改动不会生效"
        />
        <!-- ★ 2026-10-26 批注：「新增班级，除备注、开班日期、教室、助教之外都是必选项」
             → 班主任 / 教员 现在是必填，只有助教仍为可选，提示语同步改口径 -->
        <el-alert
          v-if="form.stage === 'jh'"
          type="info"
          :closable="false"
          show-icon
          title="必填：班级名称/编号、部门、阶段方案、阶段、班主任、教员（就业部改为 项目经理/就业老师，无班主任/教员）；助教、教室、开班日期、备注为选填。人下拉按「职位 + 部门」过滤（如部门选初高部，班主任只列初高部的班主任；该部门没有该职位时退回只按职位列人）；初高部的表没有「项目经理 / 就业老师」这两列，所以这个学段不显示"
        />
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 班级交接（2026-10-19 批注） ============ -->
    <el-dialog v-model="handoverVisible" title="班级交接" width="860px" top="6vh" destroy-on-close>
      <el-form label-width="110px">
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="班级名称">
              <el-input :model-value="handoverForm.className" disabled />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="交接日期">
              <el-date-picker
                v-model="handoverForm.handoverDate"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 原负责人 = 班级当前值（没人的默认空白）；新负责人从「权限管理」用户列表选，
             留空 = 该岗位不换人。 -->
        <el-table :data="handoverRoles" border size="small">
          <el-table-column label="岗位" width="110" align="center">
            <template #default="{ row }">{{ row.label }}</template>
          </el-table-column>
          <el-table-column label="原负责人" width="180">
            <template #default="{ row }">
              <span :class="{ 'ho-empty': !row.oldName }">{{ row.oldName || '（空白）' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="新负责人">
            <template #default="{ row }">
              <el-select
                v-model="row.newId"
                clearable
                filterable
                placeholder="不换则留空"
                :loading="staffLoading"
                style="width: 100%"
                @change="onHandoverPick(row)"
              >
                <!-- ★ 2026-10-23：每个岗位只列「该职位 + 该部门」的人 -->
                <el-option v-for="u in row.options" :key="u.id" :label="u.userName" :value="u.id" />
              </el-select>
            </template>
          </el-table-column>
        </el-table>

        <el-form-item label="交接原因" class="ho-reason">
          <el-input
            v-model="handoverForm.reason"
            type="textarea"
            :rows="2"
            maxlength="255"
            show-word-limit
            placeholder="例如：原班主任调岗，由李老师接任"
          />
        </el-form-item>
      </el-form>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="提交后立即生效：班级负责人更新为「新负责人」，并在班级详情的「交接记录」里留一条快照。"
      />
      <template #footer>
        <el-button @click="handoverVisible = false">取消</el-button>
        <el-button type="primary" :loading="handoverSaving" @click="doHandover">确认交接</el-button>
      </template>
    </el-dialog>

    <!-- ============ 升实训（2026-10-20 批注：大学部 → 就业部） ============ -->
    <el-dialog v-model="trainingVisible" title="升实训（大学部 → 就业部）" width="720px" top="7vh" destroy-on-close>
      <el-alert class="tv-tip" type="warning" :closable="false" show-icon>
        <template #title>
          升实训会把这个班<b>连同学生</b>整体转到就业部：新班<b>不再有班主任 / 教员 / 助教</b>，
          只保留项目经理与就业老师；原班级从大学部移除。学生状态统一变为「实训中」。
          <br /><b>班级编号沿用原班级，不会重新生成</b>（编号只在新建班级时确定，之后任何操作都不改）。
        </template>
      </el-alert>
      <el-form label-width="100px" class="tv-form">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="原班级">
              <el-input :model-value="trainingForm.srcName" disabled />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="部门">
              <el-input model-value="就业部" disabled />
            </el-form-item>
          </el-col>
          <!-- ★ 2026-10-23 批注：「班级编号只有新建班级时创建更改，后续任何操作都不可更改」
               → 升实训**沿用原编号**，这里只读展示，不给编辑。 -->
          <el-col :span="12">
            <el-form-item label="班级编号">
              <el-input :model-value="trainingForm.srcClassCode" disabled placeholder="升实训后保持不变" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="班级名称">
              <el-input v-model="trainingForm.className" maxlength="50" placeholder="默认沿用原班级名称，可修改" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="阶段">
              <el-select v-model="trainingForm.phaseCode" placeholder="就业部阶段方案" style="width: 100%">
                <el-option v-for="p in trainingPhaseOptions" :key="p.value" :label="p.label" :value="p.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="项目经理">
              <el-select
                v-model="trainingForm.projectManagerId"
                filterable
                placeholder="请选择"
                :loading="staffLoading"
                style="width: 100%"
              >
                <el-option v-for="u in trainingStaff('projectManager')" :key="u.id" :label="u.userName" :value="u.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="就业老师">
              <el-select
                v-model="trainingForm.employmentTeacherId"
                filterable
                placeholder="请选择"
                :loading="staffLoading"
                style="width: 100%"
              >
                <el-option v-for="u in trainingStaff('employmentTeacher')" :key="u.id" :label="u.userName" :value="u.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input
                v-model="trainingForm.remark"
                type="textarea"
                :rows="2"
                maxlength="200"
                show-word-limit
                :placeholder="`默认记录：由大学部「${trainingForm.srcName}」升实训`"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        :title="`提交后：「${trainingForm.srcName}」的 ${trainingForm.studentCount} 名学生整体升入「${trainingForm.className || trainingForm.srcName}」，原班级从大学部移除。`"
      />
      <template #footer>
        <el-button @click="trainingVisible = false">取消</el-button>
        <el-button type="primary" :loading="trainingSaving" @click="doTrainingUpgrade">确认升实训</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 统一班级信息页（第 2 期 · 第七个合并的业务域）
 * ============================================================
 * 合并了 3 个学段（初高 / 大学 / 实训）的班级管理：
 *   · 一个页面 + 学段筛选（不再 3 个页面各一套）
 *   · 「班级编号 / 结业日期 / 交棒岗位 / 备注」按学段自动显隐
 *     —— 由后端 /meta 下发的 hasClassCode / hasCloseDate 决定，**不写死学段判断**
 *   · 状态机统一（1 开放 / 2 封班 / 5 实训 / 6 待就业 / 7 已就业；
 *     2026-10-19 起「待结业」下线、2026-10-22 起「已结业」整体下线），非法流转后端会拦
 *
 * 【★ 与学生档案页最大的不同：不按名字去重】
 *   「初高 G104」和「大学 G104」是两个不同的班，同名是常态。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useBreadcrumbStageKey } from '@/store/breadcrumb';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { SetUp } from '@element-plus/icons-vue';
import { isReadOnlyUser, myRoles } from '@/store/permission';
import { visibleStageOptions } from '@/teaching/access';
import { http } from '@/api/request';
// ★ 2026-10-22：阶段方案设计从「系统设置」搬进班级管理，以弹窗呈现
import StageSchemePanel from '@/teaching/components/StageSchemePanel.vue';
import { DeptCode, StudentStatus } from 'shared-types';
import {
  listClasses,
  getClassDetail,
  saveClass,
  deleteClass,
  getClassMeta,
  getClassSummary,
  listClassHandovers,
  doClassHandover,
  upgradeClassToTraining,
  upgradeClassToEmployment,
  getEmploymentProgress,
  confirmClassEmployed,
  getStaffOptions,
  isSystemClassStatus,
  CLASS_STATUS_TAG,
  CLASS_STATUS_SELECTABLE,
  classStatusOptions,
  CLASS_DEPT_STAGES,
  DEPT_OPTIONS,
  type ClassDetail,
  type ClassHandoverPayload,
  type ClassHandoverRow,
  type ClassRow,
  type ClassSaveBody,
  type ClassStage,
  type ClassStageMeta,
  type ClassSummary,
  type EmploymentProgress,
  type StaffOption,
  type StagePlanOption,
} from '@/teaching/api/class';
// ★ 2026-10-23：岗位选人 —— 按「职位 + 部门」过滤（见文件头注释）
import { staffOf, STAGE_DEPT_CODE, type StaffKind } from '@/teaching/classStaff';
// 教室「楼栋-房间号」格式：归一 + 校验（前后端同一套规则，见文件头注释）
import {
  CLASSROOM_EXAMPLE,
  CLASSROOM_TIP,
  isClassroomValid,
  normalizeClassroom,
} from '@/teaching/classroom';

/* ---------------- 学段可见性（第 3 期：判权不再依赖旧路由） ---------------- */
/**
 * 阶段方案设计：★ 2026-10-22 用户口径「只给校长 / 学管主任」
 *   后端 /api/class-jh/stage-scheme/* 也加了同样的角色限制，这里只管入口显隐。
 */
const canDesignScheme = computed(() =>
  ['RM_PRINCIPAL', 'TEACH_DEAN', 'SYS_ADMIN'].some((r) => myRoles.value.includes(r)),
);
const schemeVisible = ref(false);

// ★ 2026-10-22 部门口径统一：对外只有「初高中 / 大学部 / 就业部」三个部门。
//   「实训」是就业部下的一个阶段（班级 dept_code=3），不是并列部门。
const STAGE_LABEL: Record<ClassStage, string> = {
  jh: '初高部',
  class: '大学部',
  job: '就业部',
  // ★ 2026-10-19 批注：就业部（独立学段）
  emp: '就业部',
};

/**
 * ★ 2026-10-22：部门下拉用 CLASS_DEPT_STAGES（初高部 / 大学部 / 就业部），
 *   不用 CLASS_STAGES —— 后者含内部的 job（实训），只用于行排序与类型。
 */
const stageOptions = computed(() => visibleStageOptions('class', CLASS_DEPT_STAGES, STAGE_LABEL));

/* ---------------- 列表 ---------------- */
const loading = ref(false);
const rows = ref<ClassRow[]>([]);
const total = ref(0);
const summary = ref<ClassSummary[]>([]);
const metaList = ref<ClassStageMeta[]>([]);

/** 筛选条件（草稿）—— 只跟着下拉/输入框变，**不发请求** */
const query = reactive({
  // 「部门」筛选复用 stage：初高部 = jh、大学部 = class、就业部 = emp（实训 job 也归这一项）
  stage: undefined as ClassStage | undefined,
  classStatus: undefined as number | undefined,
  phaseCode: undefined as number | undefined,
  keyword: '',
});

/**
 * 已生效的查询条件 —— 只有点【查询】/【重置】才从 query 快照过来。
 * ★ 列表、统计卡、列显隐、出勤率列头全部只看这一份：
 *   否则用户选了部门（条件还没提交），表格列就已经跟着变，看着仍像"选了就查"。
 */
const applied = reactive({
  stage: undefined as ClassStage | undefined,
  classStatus: undefined as number | undefined,
  phaseCode: undefined as number | undefined,
  keyword: '',
  page: 1,
  size: 20,
});

/* 面包屑第 4 级：当前正在查看的学段（筛选器变化时自动同步，页面卸载自动清空） */
useBreadcrumbStageKey(() => query.stage || '');

/** 当前**已生效**学段的 meta（列显隐/标签都靠它） */
const curMeta = computed(() => metaList.value.find((m) => m.stage === applied.stage) || null);
/** 草稿学段的 meta —— 「阶段」下拉要跟着刚选的部门立刻换选项（但列表不动） */
const draftMeta = computed(() => metaList.value.find((m) => m.stage === query.stage) || null);
const phaseOptions = computed(() => draftMeta.value?.phaseOptions || []);

/** 未选学段时，只要任一可见学段有编号/结业日期就显示该列 */
const hasClassCodeCol = computed(() =>
  applied.stage ? !!curMeta.value?.hasClassCode : metaList.value.some((m) => m.hasClassCode),
);
const hasCloseDateCol = computed(() =>
  applied.stage ? !!curMeta.value?.hasCloseDate : metaList.value.some((m) => m.hasCloseDate),
);

/**
 * ★ 出勤率列头必须随口径变：初高是「今日出勤率」，大学/实训是「累计出勤率」。
 *   混着写会被读成同一种指标 —— 今日 92% 和累计 92% 完全不是一回事。
 *   （判断依据直接用初高这个固定事实，不去猜 meta 的其它标志位。）
 */
const rateLabel = computed(() => {
  if (!applied.stage) return '出勤率';
  return applied.stage === 'jh' ? '今日出勤率' : '累计出勤率';
});

function rateClass(row: ClassRow): string {
  if (row.attendanceRate === null) return '';
  if (row.attendanceRate < 90) return 'danger';
  if (row.attendanceRate < 95) return 'warn';
  return 'ok';
}

function tagType(s: number): string {
  return (CLASS_STATUS_TAG[s] || 'info') as never;
}

/**
 * ★ 2026-10-22：阶段方案改完之后要"同步"
 *
 * 方案名称 / 阶段名称 / 学制 改完，本页三处都依赖它：
 *   ① 班级列表的「阶段」列（读班级上的 scheme_stage_name 快照）
 *   ② 新增 / 编辑班级的「阶段方案 / 阶段」下拉（读 meta.planOptions）
 *   ③ 升实训弹窗的就业部阶段下拉（同上）
 * 班级快照由后端在保存方案时同步更新；前端只需把 meta 和列表重新拉一遍，
 * 否则要刷新整页才看得到新名字。
 */
async function onSchemeChanged() {
  try {
    metaList.value = (await getClassMeta()) || [];
  } catch {
    /* meta 拉取失败不阻塞列表刷新 */
  }
  await load();
}

/** ★ 2026-10-21 批注：花名册「状态」列——退学(7) 是终态，任何操作都不能改（后端写保护） */
function isQuitStatus(row: Record<string, any>): boolean {
  return Number(row?.studentStatus) === StudentStatus.QUIT;
}

/** 拉数据：只认 applied（分页也走这里，翻页不会把草稿条件带上） */
async function load(page?: number) {
  if (page) applied.page = page;
  loading.value = true;
  try {
    const params = { ...applied };
    const [r, s, m] = await Promise.all([
      listClasses(params),
      getClassSummary(params),
      metaList.value.length ? Promise.resolve(metaList.value) : getClassMeta(),
    ]);
    rows.value = r.list || [];
    total.value = r.total || 0;
    summary.value = s || [];
    metaList.value = m || [];
  } catch (e) {
    ElMessage.error((e as Error).message || '加载失败');
  } finally {
    loading.value = false;
  }
}

/**
 * ★ 2026-10-22 批注：「点击查询，才可以按照所选内容进行查询」
 *   → 把草稿条件提交成生效条件，再拉第一页。
 */
function applyQuery() {
  applied.stage = query.stage;
  applied.classStatus = query.classStatus;
  applied.phaseCode = query.phaseCode;
  applied.keyword = query.keyword;
  load(1);
}

/** 切学段：阶段码和状态都是学段内的，必须清掉，否则会带着上一个学段的筛选去查
 *  ★ 2026-10-21 批注：这里**不再自动查询** —— 筛选选完由用户点【查询】才查（见筛选区注释）。 */
function onStageChange() {
  query.phaseCode = undefined;
  query.classStatus = undefined;
}

function reset() {
  query.stage = undefined;
  query.classStatus = undefined;
  query.phaseCode = undefined;
  query.keyword = '';
  applyQuery();
}

/* ---------------- 详情 / 花名册 ---------------- */
const detailVisible = ref(false);
const detail = ref<ClassDetail | null>(null);
/** 2026-10-19 批注：详情抽屉里同步展示交接记录 */
const detailHandovers = ref<ClassHandoverRow[]>([]);

async function openDetail(row: ClassRow) {
  detail.value = await getClassDetail(row.stage, row.classId);
  // 交接记录失败不阻塞花名册（例如公共库暂时连不上）
  detailHandovers.value = await listClassHandovers(row.stage, row.classId).catch(() => []);
  detailVisible.value = true;
}

/** 一条交接记录 →「只列真正换了人的岗位」，详情抽屉太窄，没变的不占行 */
function handoverChanges(row: ClassHandoverRow): Array<{ role: string; from: string; to: string }> {
  const all = [
    { role: '班主任', slot: row.headTeacher },
    { role: '教员', slot: row.teacher },
    { role: '助教', slot: row.assistant },
    { role: '项目经理', slot: row.projectManager },
    { role: '就业老师', slot: row.employmentTeacher },
  ];
  return all
    .filter((x) => (x.slot.oldId || '') !== (x.slot.newId || '') || (x.slot.oldName || '') !== (x.slot.newName || ''))
    .map((x) => ({ role: x.role, from: x.slot.oldName || '', to: x.slot.newName || '' }));
}

/* ---------------- 新增 / 编辑 ---------------- */
const editVisible = ref(false);
const saving = ref(false);
const formRef = ref<FormInstance>();

/**
 * 表单校验规则
 *   2026-10-15 改版：学段 / 班级名称 / 部门 / 班主任 / 教员 / 阶段 全部不再必填；
 *   2026-10-16 批注：「项目经理姓名 / 就业老师姓名」**只在阶段 = 实训时**必填。
 *   ★ 2026-10-26 批注（红字）：「新增班级，除备注、开班日期、教室、助教之外都是必选项」
 *     → 必填 = 班级名称 / 班级编号 / 部门 / 阶段方案 / 阶段 / 班主任 / 教员
 *              （+ 只在就业部显示的 项目经理 / 就业老师）
 *     · 阶段方案 在 `formPlanId` 里（不在 form 上），el-form 的规则管不到 → 见 doSave 里单独校验；
 *     · ★ 2026-10-26 补充批注：「编辑学生和编辑班级同步新增学生和新增班级的必选项」
 *       → 必填**不再区分新增/编辑**，编辑时同样校验；
 *       唯一例外是「班级编号」：编辑时它是只读的（2026-10-23 口径），
 *       老班级编号为空也补不了，硬校验只会把人卡死 → 仍只在新增时校验。
 *   规则写成 computed，切换阶段/部门后红星与校验会立刻跟着变。
 */
const rules = computed<FormRules>(() => {
  /**
   * 通用必填规则（新增 / 编辑一致）。
   * ★ 2026-10-26 批注：「必选项前端只显示红星，只有点保存时没填才显示文字」
   *   → trigger 用 'submit'：交互（输入/失焦/切换下拉）**不弹红字**，
   *     只有点【保存】调用 validate() 时才校验并出提示。
   *     （同 classCode 第二条规则的既有写法，el-form 的 validate() 不看 trigger。）
   */
  const requiredRule = (msg: string) => [
    {
      validator: (_rule: unknown, value: unknown, callback: (e?: Error) => void) => {
        if (String(value ?? '').trim()) callback();
        else callback(new Error(msg));
      },
      trigger: 'submit',
    },
  ];
  /** 就业部（dept = 3）才有「项目经理 / 就业老师」两栏，也只有这时才必填 */
  const isEmploymentDept = form.deptCode === DeptCode.EMPLOYMENT;
  return {
    // ★ 2026-10-21：班级编号三部门统一必填（历史班级留空，首次编辑时补）
    // ★ 2026-10-23：编辑时编号只读、也不再校验必填（防止老数据编号为空时保存被卡）
    classCode: form.id
      ? []
      : [
          { required: true, message: '请填写班级编号，如 Q17 / J101 / T101', trigger: 'submit' },
          {
            validator: (_rule, value, callback) => {
              if (String(value ?? '').trim()) callback();
              else callback(new Error('请填写班级编号，如 Q17 / J101 / T101'));
            },
            trigger: 'submit',
          },
        ],
    // ★ 2026-10-26：以下均为必填（新增 / 编辑一致）
    className: [{ required: true, message: '请填写班级名称', trigger: 'submit' }],
    deptCode: requiredRule('请选择部门'),
    // 阶段下拉在没配方案列时不渲染（老数据），这时不校验，否则会报一个看不见的错
    phaseCode: !formPhaseOptions.value.length ? [] : requiredRule('请选择阶段'),
    /**
     * ★ 2026-10-26 批注（红字）：「就业部班主任、教员不是必选项」
     *   → 部门 = 就业部时这两项放开（其它部门仍是必填，新增/编辑一致）。
     */
    headTeacherId: isEmploymentDept ? [] : requiredRule('请选择班主任'),
    teacherId: isEmploymentDept ? [] : requiredRule('请选择教员'),
    // ★ 2026-10-26：就业部必填（新增/编辑一致）
    projectManagerName: isEmploymentDept
      ? [{ required: true, message: '就业部班级必填', trigger: 'submit' }]
      : [],
    employmentTeacherName: isEmploymentDept
      ? [{ required: true, message: '就业部班级必填', trigger: 'submit' }]
      : [],
    /**
     * 2026-10-19 批注：教室必须输出成「楼栋-房间号」，例如 A-201。
     * 校验看的是**归一后**的值 —— 输入 A栋-102 / 教学楼 A-102 也算合规（失焦时会自动改成 A-102），
     * 只有认不出来的写法（比如只写 102、带中文描述的一串）才会被拦。
     */
    classroom: [
      {
        validator: (_rule, value, callback) => {
          if (isClassroomValid(value)) callback();
          else callback(new Error(CLASSROOM_TIP));
        },
        trigger: 'blur',
      },
    ],
  };
});

/** 教室失焦即归一：A栋-102 / 教学楼 A-102 / a102 → A-102（不改变语义，只统一写法） */
function onClassroomBlur() {
  form.classroom = normalizeClassroom(form.classroom);
}

function emptyForm(stage: ClassStage): ClassSaveBody {
  return {
    /**
     * ★ 2026-10-23 修：这里必须显式带上 id / classStatus。
     *
     *   表单清空用的是 Object.assign(form, emptyForm(stage))：
     *   只有 emptyForm 里出现过的字段才会被重置，没出现的字段会**留在原值上**。
     *   之前这里漏了 id，后果是：
     *     先点过任意班级的「编辑」→ form.id 有值 → 再点「新增班级」
     *     → 弹窗标题变成「编辑班级」、还带着上一个班的数据，
     *       保存时按"编辑"去更新那个旧 id，后端查不到就报「班级不存在」。
     */
    id: undefined,
    classStatus: undefined,
    stage,
    className: '',
    classCode: '',
    // 2026-10-19：实训与就业部都归「就业部」(3)，两者只靠学段区分
    deptCode: stage === 'jh' ? 1 : stage === 'class' ? 2 : 3,
    phaseCode: undefined,
    schemeId: null,
    schemeStageId: null,
    schemeStageName: null,
    headTeacherId: '',
    headTeacherName: '',
    teacherId: '',
    teacherName: '',
    assistantId: '',
    assistantName: '',
    projectManagerId: '',
    projectManagerName: '',
    employmentTeacherId: '',
    employmentTeacherName: '',
    universityNo: '',
    classroom: '',
    openDate: '',
    closeDate: '',
    remark: '',
  };
}
const form = reactive<ClassSaveBody>(emptyForm('jh'));

/**
 * ★ 2026-10-26：必填校验改成「只在保存时提示」之后带来的副作用 ——
 *   trigger 不再含 change，所以**红字一旦出现就不会自己消失**：用户把班级名称补上，
 *   「请填写班级名称」还挂在下面，看着像没生效。
 *   这里监听整个 form：用户一动手（任意字段变化）就把当前红字全收起，
 *   等下次点保存重新校验。既满足「平时不提示」，又不会让旧提示赖在屏幕上。
 *   ⚠️ 必须放在 `form` 之后：watch 注册时会**立即跑一次 getter** 收集依赖，
 *      放前面会踩 const 的 TDZ。
 */
watch(
  () => JSON.stringify(form),
  () => {
    formRef.value?.clearValidate();
  },
);

/** 表单里的阶段选项：★ 2026-10-16 改为「方案驱动」——
 *   选了方案 → 只给该方案下的阶段（新方案里的新阶段也能选到）；
 *   没选方案 → 回落到 meta 的阶段清单（此时初高仍按旧口径过滤掉预科）。 */
const JH_PHASE_CODES = [102, 103, 104, 105, 106, 107];

/** 全部阶段方案（来自后端 meta，两个部门的方案都在里面） */
const planOptionsAll = computed<StagePlanOption[]>(
  () => metaList.value.find((m) => m.planOptions?.length)?.planOptions || [],
);
/** 表单里可选的方案：按「部门」过滤 */
const formPlanOptions = computed(() => planOptionsAll.value.filter((p) => p.deptCode === form.deptCode));
/** 表单当前选中的方案 ID（只用于联动，不入库） */
const formPlanId = ref('');

/** 打开编辑弹窗时的原始状态 —— 状态下拉的可选项按它算，选完不会越点越多 */
const editStatusFrom = ref<number | null>(null);
const editStatusOptions = computed(() => classStatusOptions(editStatusFrom.value));
/**
 * 状态是否只读：
 *   实训(5) / 待就业(6) / 已就业(7) 是系统态 —— 不能在编辑弹窗里手工改
 *   （只能由操作列三个按钮写入）。
 *   ★ 2026-10-22：已结业(4) 已下线，不再有"终态只读"这条判断。
 */
const editStatusLocked = computed(() => isSystemClassStatus(editStatusFrom.value));

const formPhaseOptions = computed(() => {
  const plan = planOptionsAll.value.find((p) => p.id === formPlanId.value);
  if (plan) return plan.phases;
  const list = metaList.value.find((m) => m.stage === form.stage)?.phaseOptions || [];
  if (form.stage === 'jh') return list.filter((p) => JH_PHASE_CODES.includes(p.value));
  return list;
});

/** 阶段码 → 方案 ID（编辑回显时反查） */
function planIdOfPhase(phaseCode: number | null | undefined): string {
  if (!phaseCode) return '';
  return planOptionsAll.value.find((p) => p.phases.some((x) => x.value === Number(phaseCode)))?.id || '';
}

/* ============ 2026-10-15 改版：删除「学段」选择器，学段由部门判定 ============ */

/** 部门变化 → 自动判定学段（初高部 → 初高；大学部 → 大学）；实训学段不选部门时保持原值 */
function onFormDeptChange(v: number | undefined) {
  if (v === DeptCode.JUNIOR_SENIOR) form.stage = 'jh';
  else if (v === DeptCode.UNIVERSITY) form.stage = 'class';
  // 就业部同时覆盖「实训」和「就业」两个学段：已在 job/emp 时不要强行改学段
  else if (v === DeptCode.EMPLOYMENT && form.stage !== 'job' && form.stage !== 'emp') {
    form.stage = 'emp';
  }
  // ★ 2026-10-16 部门变了 → 原来选的「阶段方案」可能不属于新部门，先清掉
  if (!formPlanOptions.value.some((p) => p.id === formPlanId.value)) formPlanId.value = '';
  // 2026-10-19 批注：清掉之后默认选中新部门的方案（不允许空着）
  if (!formPlanId.value) formPlanId.value = formPlanOptions.value[0]?.id || '';
  // 学段变了：阶段按新学段重选（onFormStageChange 会清编号/交棒/备注等学段特有字段）
  if (!formPhaseOptions.value.some((p) => p.value === form.phaseCode)) form.phaseCode = undefined;
  onFormStageChange();
  /**
   * ★ 2026-10-26 批注：「进行部门的选择的时候，不显示必选项的文字提示」
   *   ① el-form 已关掉 validate-on-rule-change（见模板上的说明），切部门不会再立刻全校验；
   *   ② 但如果用户**先点过保存**（此时已经有红字），再切部门，
   *      「班主任 / 教员 / 项目经理 / 就业老师」这四项的必填状态会变 ——
   *      旧的报错得跟着清掉，否则会出现「就业部了、班主任还挂着『请选择班主任』」。
   *      只清这四项，其余既有报错保留（用户还得去补）。
   */
  formRef.value?.clearValidate([
    'headTeacherId',
    'teacherId',
    'projectManagerName',
    'employmentTeacherName',
  ]);
}

/* ============ 2026-10-15 改版：班主任/教员/助教接入「权限管理」用户列表 ============
 * ★ 2026-10-23 批注：下拉不再是「全部账号」，改成**按职位 + 部门**过滤 ——
 *   班主任只列「职位 = 班主任」的人，且部门是当前班级部门的人；
 *   该部门下没这个职位（典型：项目经理只在实训教学部）→ 退回只按职位筛。
 *   规则与兜底集中在 @/teaching/classStaff.ts（staffOf），这里只负责喂数据。
 */

const staffLoading = ref(false);
/** 全量人员（含职位 / 部门码），三处下拉共用一份，部门一改即时重算 */
const staffOptions = ref<StaffOption[]>([]);

async function loadStaff() {
  staffLoading.value = true;
  try {
    /* ★ 2026-10-22：改走教学侧接口 /api/teaching/class/staff-options
     *
     * 【为什么换】原来直连 /api/perm/user/list（挂 permAuth，要求账号 modules 含 perm）——
     *   初高 / 大学 / 就业账号一进班级管理就 403：
     *   ① 拦截器弹「您没有该操作的权限」（用户报障：每个账号登录都弹没有权限）；
     *   ② 更实际的问题：staffOptions 被清空 → 新建班级选不了班主任/教员/助教。
     *   新接口跟着班级页面权限走，只返回 id + 姓名（★ 10-23 起再加职位 / 部门码），够下拉用。
     *   拉取仍带 silent：万一以后某个账号连班级页面权限都没有，也只是下拉空着，不弹窗。 */
    staffOptions.value = (await getStaffOptions()) || [];
  } catch {
    staffOptions.value = [];
  } finally {
    staffLoading.value = false;
  }
}

/** 班级表单里某个岗位的可选人（按表单当前部门过滤；已选的人不在候选里也补一条） */
function formStaff(kind: StaffKind): StaffOption[] {
  const picked: Record<StaffKind, [string | null | undefined, string | null | undefined]> = {
    headTeacher: [form.headTeacherId, form.headTeacherName],
    teacher: [form.teacherId, form.teacherName],
    assistant: [form.assistantId, form.assistantName],
    projectManager: [form.projectManagerId, form.projectManagerName],
    employmentTeacher: [form.employmentTeacherId, form.employmentTeacherName],
  };
  const [id, name] = picked[kind];
  return staffOf(staffOptions.value, kind, form.deptCode, id, name);
}

/** 升实训弹窗两个岗位：部门固定按「就业部(3)」过滤 */
function trainingStaff(kind: 'projectManager' | 'employmentTeacher'): StaffOption[] {
  const id = kind === 'projectManager' ? trainingForm.projectManagerId : trainingForm.employmentTeacherId;
  return staffOf(staffOptions.value, kind, DeptCode.EMPLOYMENT, id, null);
}

/** 选人自动带姓名；清空时姓名一并清掉 */
function onStaffChange(kind: StaffKind, id: string) {
  const name = staffOptions.value.find((x) => x.id === id)?.userName || '';
  if (kind === 'headTeacher') form.headTeacherName = name;
  else if (kind === 'teacher') form.teacherName = name;
  else if (kind === 'assistant') form.assistantName = name;
  else if (kind === 'projectManager') form.projectManagerName = name;
  else form.employmentTeacherName = name;
}

/* ---------------- ★ 2026-10-16：阶段方案（方案 + 方案里的阶段） ---------------- */

/** 切换方案：上一个方案里选的阶段码，在新方案里未必还存在 → 清掉重选 */
function onPlanChange() {
  if (!formPhaseOptions.value.some((p) => p.value === form.phaseCode)) form.phaseCode = undefined;
}

/** 列表/详情里「阶段」列的回显（阶段名由后端按阶段码解析下发） */
function phaseTextOf(row: Pick<ClassRow, 'phaseName' | 'phaseCode'>): string {
  /* ★ 2026-10-23：阶段码在字典里没有中文名时（跨部门号段 / 方案新增阶段），
     原来显示「—」→ 用户以为编辑没生效；现在兜底显示「阶段 321」。 */
  return row.phaseName || (row.phaseCode != null ? `阶段 ${row.phaseCode}` : '—');
}

async function openCreate() {
  const stage = (query.stage || stageOptions.value[0]?.value || 'jh') as ClassStage;
  Object.assign(form, emptyForm(stage));
  // 2026-10-19 批注：阶段方案要默认选中（该部门的那套方案），不用每次手点
  formPlanId.value = formPlanOptions.value[0]?.id || '';
  editStatusFrom.value = null;
  editVisible.value = true;
}

async function openEdit(row: ClassRow) {
  // ★ 2026-10-22：编辑弹窗也必须刷新方案选项 ——
  //   原来只有「新增班级」会刷新，方案里改了阶段名/加了阶段后，
  //   打开编辑还是旧选项（阶段列显示旧名字，甚至显示 uuid）。
  // ★ 2026-10-23：方案选项已统一由 meta.planOptions 下发（旧 scheme-options 接口已删除），
  //   所以这里刷新 meta 即可；拉取失败不阻塞编辑弹窗打开。
  try {
    metaList.value = (await getClassMeta()) || [];
  } catch {
    /* 忽略：沿用上一次的 meta */
  }
  /**
   * ★ 2026-10-23：编辑回填方案 —— 优先级：班级已存方案 → 按阶段码反查方案 → 该部门第一个。
   *   原来不回填，阶段下拉按「默认第一个方案」过滤，用户看到的阶段选不中原来的值，
   *   改完保存后表格里阶段看起来「没变」（前端下拉与库里阶段码对不上）。
   */
  formPlanId.value =
    (row.schemeId as string | null) || planIdOfPhase(row.phaseCode) || formPlanOptions.value[0]?.id || '';
  Object.assign(form, emptyForm(row.stage), {
    id: row.classId,
    className: row.className,
    classCode: row.classCode || '',
    deptCode: row.deptCode ?? undefined,
    phaseCode: row.phaseCode ?? undefined,
    classStatus: row.classStatus,
    headTeacherId: row.headTeacherId || '',
    headTeacherName: row.headTeacherName || '',
    teacherId: row.teacherId || '',
    teacherName: row.teacherName || '',
    assistantId: row.assistantId || '',
    assistantName: row.assistantName || '',
    projectManagerId: row.projectManagerId || '',
    projectManagerName: row.projectManagerName || '',
    employmentTeacherId: row.employmentTeacherId || '',
    employmentTeacherName: row.employmentTeacherName || '',
    universityNo: row.universityNo || '',
    classroom: row.classroom || '',
    openDate: row.openDate || '',
    closeDate: row.closeDate || '',
    remark: row.remark || '',
  });
  // ★ 2026-10-23：原「历史脏绑定兜底」已移除。
  //   它依赖旧 scheme-options 机制（schemeOptions / form.schemeId / form.schemeStageId），
  //   而该机制已整套删除（旧接口 /scheme-options 后端也没了）。
  //   新机制存的是数字阶段码 phaseCode，不存在「指向已删除 uuid」的脏绑定问题，
  //   方案回显改由下面的 planIdOfPhase(row.phaseCode) 负责。

  // ★ 2026-10-16 反查这个阶段属于哪个方案，让「阶段方案」下拉回显；
  //   2026-10-19 批注：查不到也要默认选中本部门的方案，不能空着
  formPlanId.value = planIdOfPhase(row.phaseCode) || formPlanOptions.value[0]?.id || '';
  // 「班级状态」可选项按**打开时的原始状态**算（否则选完一项选项会跟着变）
  editStatusFrom.value = row.classStatus;
  editVisible.value = true;
}

/** ★ 表单切学段：编号 / 交棒 / 备注字段要跟着清（否则会带着上一个学段的脏值提交）
 *
 * ⚠️ 2026-10-22 修：这里原来只保住 id / className，
 *    结果用户「先填班级编号、再选部门」时，onFormDeptChange → 本函数
 *    → Object.assign(form, emptyForm(...)) 把刚填的 classCode 一起抹掉了
 *    （用户反馈：填完班级编号去选部门，编号自动清空）。
 *    班级编号是三个部门通用、与学段无关的字段，必须原样保留。
 */
function onFormStageChange() {
  const keep = { id: form.id, className: form.className, classCode: form.classCode };
  Object.assign(form, emptyForm(form.stage), keep);
}

async function doSave() {
  // 教室在提交前再归一一次：只用键盘 Enter 提交时不一定触发过 blur
  form.classroom = normalizeClassroom(form.classroom);
  // 校验不通过就别往下走：原来直接 await validate() 会把 reject 抛成未捕获异常，
  // 界面上只有字段下面那行红字，看不到任何提示（加了「实训必填」规则后更容易踩到）
  if (formRef.value) {
    const ok = await formRef.value.validate().catch(() => false);
    if (!ok) return;
  }
  /**
   * ★ 2026-10-26：「阶段方案」必填（新增 / 编辑一致）。
   *   它绑的是 `formPlanId`（联动用的 ref），不在 form 上，el-form 的规则管不到 → 这里单独校验。
   *   该部门一个方案都没配时（formPlanOptions 为空）放行，否则会变成永远存不了。
   */
  if (formPlanOptions.value.length && !formPlanId.value) {
    ElMessage.warning('请选择「阶段方案」');
    return;
  }
  saving.value = true;
  try {
    /**
     * ★ 2026-10-23：方案三字段要跟着保存（formPlanId 只是联动用的 ref，不在 form 里）。
     *   方案阶段名按当前选中的阶段选项取 label —— 阶段码在字典里查不到名（如就业部
     *   号段的 321 配在初高班）时，列表用它兜底显示，不再是一片空白。
     */
    const phaseOpt = formPhaseOptions.value.find((p) => p.value === form.phaseCode);
    await saveClass({
      ...form,
      schemeId: formPlanId.value || null,
      schemeStageName: phaseOpt?.label ?? null,
    });
    ElMessage.success(form.id ? '班级已更新' : '班级已创建');
    editVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function doDelete(row: ClassRow) {
  /**
   * ★ 2026-10-22 批注：**不可删除有人的班级**
   *   原文（红字 + 红框）：「不可删除有人的班级」
   *
   * 【原实现的问题】
   *   不管班里有没有学生，一律弹「确定删除班级吗…该班当前有 N 名学生」，
   *   点【确定】班就删了 —— 提示语写着"有 3 名学生"却又让删，前后矛盾。
   *
   * 【改法】
   *   有人（studentCount > 0，与列表「人数」列同口径 = 在读学生）→ 只给提示，不给删；
   *   没人 → 才走原来的二次确认。
   *   ⚠️ 后端 `service.removeClass` 也加了同一道拦截，这里只是提前给友好提示。
   */
  if (Number(row.studentCount || 0) > 0) {
    await ElMessageBox.alert(
      `「${row.className}」当前有 ${row.studentCount} 名学生，请先将学生转出或结业后再删除。`,
      '不可删除有人的班级',
      { type: 'warning', confirmButtonText: '我知道了' },
    ).catch(() => {});
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定删除班级「${row.className}」吗？删除后不可恢复。`,
      '删除确认',
      { type: 'warning' },
    );
  } catch {
    return; // 点了取消 / 关闭
  }
  try {
    await deleteClass(row.stage, row.classId);
    ElMessage.success('已删除');
    load();
  } catch {
    // 失败提示由请求层统一弹出（后端还会兜底拦一次「有人的班级」）
  }
}

/* ---------------- 班级交接（2026-10-19 批注） ---------------- */
type HandoverRoleKey = 'headTeacher' | 'teacher' | 'assistant' | 'projectManager' | 'employmentTeacher';

interface HandoverRoleItem {
  key: HandoverRoleKey;
  label: string;
  oldId: string;
  oldName: string;
  /** 留空 = 该岗位不换人 */
  newId: string;
  newName: string;
  /** ★ 2026-10-23：该岗位的可选人（按职位 + 部门过滤，打开弹窗时算好） */
  options: StaffOption[];
}

const handoverVisible = ref(false);
const handoverSaving = ref(false);
const handoverRoles = ref<HandoverRoleItem[]>([]);
const handoverForm = reactive({
  stage: 'jh' as ClassStage,
  classId: '',
  className: '',
  handoverDate: '',
  reason: '',
});

/** 今天的 YYYY-MM-DD（交接日期默认值） */
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function openHandover(row: ClassRow) {
  Object.assign(handoverForm, {
    stage: row.stage,
    classId: row.classId,
    className: row.className,
    handoverDate: todayStr(),
    reason: '',
  });
  const seeds: Array<Omit<HandoverRoleItem, 'options'>> = [
    { key: 'headTeacher', label: '班主任', oldId: row.headTeacherId || '', oldName: row.headTeacherName || '', newId: '', newName: '' },
    { key: 'teacher', label: '教员', oldId: row.teacherId || '', oldName: row.teacherName || '', newId: '', newName: '' },
    { key: 'assistant', label: '助教', oldId: row.assistantId || '', oldName: row.assistantName || '', newId: '', newName: '' },
    { key: 'projectManager', label: '项目经理', oldId: row.projectManagerId || '', oldName: row.projectManagerName || '', newId: '', newName: '' },
    { key: 'employmentTeacher', label: '就业老师', oldId: row.employmentTeacherId || '', oldName: row.employmentTeacherName || '', newId: '', newName: '' },
  ];
  const all: HandoverRoleItem[] = seeds.map((r) => ({
    ...r,
    // ★ 2026-10-23：每个岗位的下拉按「该职位 + 该班部门」过滤，原负责人兜底保留
    options: staffOf(staffOptions.value, r.key, STAGE_DEPT_CODE[row.stage], r.oldId, r.oldName),
  }));
  // 初高没有后两个岗位（那两张表没这两列），不展示
  handoverRoles.value = row.stage === 'jh' ? all.slice(0, 3) : all;
  handoverVisible.value = true;
}

/** 选新人 → 自动带姓名（与编辑班级的选人规则一致） */
function onHandoverPick(row: HandoverRoleItem) {
  row.newName = staffOptions.value.find((u) => u.id === row.newId)?.userName || '';
}

async function doHandover() {
  const changed = handoverRoles.value.filter((r) => r.newId);
  if (!changed.length) {
    ElMessage.warning('请至少选择一个「新负责人」');
    return;
  }
  const payload: ClassHandoverPayload = {
    stage: handoverForm.stage,
    classId: handoverForm.classId,
    handoverDate: handoverForm.handoverDate || todayStr(),
    reason: handoverForm.reason || null,
  };
  for (const r of changed) {
    payload[`${r.key}Id`] = r.newId;
    payload[`${r.key}Name`] = r.newName;
  }
  handoverSaving.value = true;
  try {
    await doClassHandover(payload);
    ElMessage.success('交接已生效，已记入交接记录');
    handoverVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error((e as Error).message || '交接失败');
  } finally {
    handoverSaving.value = false;
  }
}

/* ---------------- ★ 升实训（2026-10-20 批注：大学部 → 就业部） ----------------
 * 批注①（班级管理页红框 + 红字）：「【升实训】：部门选择为就业部，不再有班主任，教员，
 *   助教，选择项目经理，就业老师，班级名称可以进行修改，选择就业部的阶段方案」
 * 追问确认：整班全部转入；升实训=改变部门，班级名称可改也可保持原样。
 *
 * 只对**大学部（class）**班级显示入口 —— 初高部学生要先「升云」到大学部再走这一步。
 * 数据搬迁（建实训班 + 迁学生 + 写花名册 + 原班逻辑删除）全在后端一个事务里。
 */
const trainingVisible = ref(false);
const trainingSaving = ref(false);
const trainingForm = reactive({
  classId: '',
  srcName: '',
  /** ★ 2026-10-23：源班编号 —— 升实训**沿用**它，弹窗里只读展示 */
  srcClassCode: '',
  studentCount: 0,
  className: '',
  phaseCode: undefined as number | undefined,
  projectManagerId: '',
  employmentTeacherId: '',
  remark: '',
});

/** 就业部阶段方案里的阶段（deptCode = 3，只取这一套，不要混进初高/大学的阶段码）
 *
 * ★ 2026-10-22：加兜底。原来只读 planOptions 里 dept=3 的 phases，
 *   而方案阶段以前没有编码、靠名字反查字典，就业部「实训」查不到 →
 *   phases 为空 → 升实训弹窗的阶段下拉显示「无数据」。
 *   方案明细现在自带 stage_code，正常情况第一段就有值；
 *   万一方案还没配阶段，再回落到 meta.phaseOptions 里的 3xx 段位。
 */
const trainingPhaseOptions = computed(() => {
  const plans = metaList.value.flatMap((m) => m.planOptions || []);
  const seen = new Map<number, string>();
  for (const pl of plans) {
    if (pl.deptCode !== 3) continue;
    for (const p of pl.phases) if (!seen.has(p.value)) seen.set(p.value, p.label);
  }
  if (seen.size) return [...seen].map(([value, label]) => ({ value, label }));

  // 兜底：就业部（emp / job 学段）meta 里 3xx 段的阶段选项
  const fallback = new Map<number, string>();
  for (const m of metaList.value) {
    if (m.stage !== 'emp' && m.stage !== 'job') continue;
    for (const p of m.phaseOptions || []) {
      if (p.value >= 300 && p.value < 400 && !fallback.has(p.value)) fallback.set(p.value, p.label);
    }
  }
  return [...fallback].map(([value, label]) => ({ value, label }));
});

function openTraining(row: ClassRow) {
  Object.assign(trainingForm, {
    classId: row.classId,
    srcName: row.className,
    srcClassCode: row.classCode || '—',
    studentCount: row.studentCount ?? 0,
    // 批注：班级名称可以修改，也可以保持原班级名称不变
    className: row.className,
    phaseCode: trainingPhaseOptions.value[0]?.value,
    projectManagerId: '',
    employmentTeacherId: '',
    remark: '',
  });
  trainingVisible.value = true;
}

async function doTrainingUpgrade() {
  const name = trainingForm.className.trim() || trainingForm.srcName;
  if (!trainingForm.phaseCode) {
    ElMessage.warning('请选择就业部阶段');
    return;
  }
  if (!trainingForm.projectManagerId) {
    ElMessage.warning('请选择「项目经理」');
    return;
  }
  if (!trainingForm.employmentTeacherId) {
    ElMessage.warning('请选择「就业老师」');
    return;
  }
  if (!trainingForm.studentCount) {
    ElMessage.warning('该班级没有学生，无法升实训');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认把「${trainingForm.srcName}」整班（${trainingForm.studentCount} 人）升实训为「${name}」？原班级将从大学部移除，学生状态变为「实训中」。`,
      '升实训确认',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  const pm = staffOptions.value.find((u) => u.id === trainingForm.projectManagerId);
  const et = staffOptions.value.find((u) => u.id === trainingForm.employmentTeacherId);
  trainingSaving.value = true;
  try {
    const r = await upgradeClassToTraining({
      classId: trainingForm.classId,
      className: name,
      phaseCode: trainingForm.phaseCode,
      projectManagerId: trainingForm.projectManagerId,
      projectManagerName: pm?.userName || '',
      employmentTeacherId: trainingForm.employmentTeacherId,
      employmentTeacherName: et?.userName || '',
      remark: trainingForm.remark || null,
    });
    ElMessage.success(`已升实训：${r.targetClassName}（${r.classCode}），转入 ${r.moved} 人`);
    trainingVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error((e as Error).message || '升实训失败');
  } finally {
    trainingSaving.value = false;
  }
}

/* ---------------- ★ 升就业 / 已就业（2026-10-21 批注第 2、3 条，2026-10-23 改口径） ----------------
 * 批注原文（2026-10-23）：
 *   「2. 点击【升就业】，并且升就业成功之后，则班级状态改为【待就业】，
 *     【升就业】按钮改为【待就业】」
 *   「3. 点击【已就业】系统识别整个班级的学生状态，若状态都已经变为已就业、退学，
 *     则提示整班都已就业并显示班级人数和就业人数，确认要将班级状态改为已就业吗，
 *     确认之后班级状态改为【已就业】；若识别班级内仍存在其他状态的学生，
 *     则进行提示班级各个状态的人数及人员，**不可进行【已就业】操作**」
 *
 * 落地：
 *   · 升就业 → 学生状态 实训中(8) → 待就业(9)，班级状态 原状态 → 待就业(6)；
 *     操作列按钮从【升就业】变【待就业】（灰、不可点），并出现【已就业】。
 *     ★ 2026-10-23：入口放开到整个「就业部」（job 实训班 + emp 就业部自建班）。
 *   · 已就业 → 先查整班学生状态分布：
 *       settled（全班都是已就业/退学）→ 提示班级人数 / 就业人数 → 一次确认 → 班级状态改 已就业(7)；
 *       否则 → 只弹提示，逐条列出「状态 人数：姓名、姓名…」+ 明确「不可操作」，
 *              **不再有强制确认 / 再次确认**（2026-10-23 批注推翻了 10-21 那版口径）。
 *   · 已就业只改**班级状态**，学生状态一个不动（学生档案里逐个点【已就业】才写 10）。
 */
const CLASS_STATUS_CODE = { TRAINING: 5, WAIT_EMPLOY: 6, EMPLOYED: 7 } as const;

const employmentSaving = ref('');
const employedSaving = ref('');

/**
 * ★ 2026-10-23 批注第 2 条：「**就业部**才有【升就业】」
 *
 *   界面上「就业部」是一张卡，但行的 stage 有两个内部值（同一张表分开存）：
 *     job —— 升实训造出来的实训班
 *     emp —— 直接在就业部建的班
 *   三个按钮（升就业 / 灰【待就业】/ 已就业）都只对这两个学段出现；
 *   初高部、大学部一个都不出现。原来只判断 'job'，就业部里 emp 的班
 *   （如 SX2601 / SX2602）操作列没有任何按钮。
 */
function isEmploymentStage(stage: string): boolean {
  return stage === 'job' || stage === 'emp';
}

/** 就业部班级还没到「待就业 / 已就业」→ 才显示【升就业】 */
function canUpgradeEmployment(row: ClassRow): boolean {
  const s = Number(row.classStatus);
  return s !== CLASS_STATUS_CODE.WAIT_EMPLOY && s !== CLASS_STATUS_CODE.EMPLOYED;
}

/** 「已就业 10 人、退学 2 人」这种一句话摘要（settled 弹窗用） */
function progressSummary(p: EmploymentProgress): string {
  return `已就业 <b>${p.employed}</b> 人、退学 <b>${p.quit}</b> 人`;
}

/** 某个状态下的学生姓名串（太多时截断，避免弹窗撑爆） */
function namesOf(item: { count: number; students: Array<{ studentName: string | null; studentNo: string | null }> }): string {
  const MAX = 30;
  const names = item.students
    .slice(0, MAX)
    .map((s) => escText(s.studentName || s.studentNo || '未命名'))
    .join('、');
  return item.count > MAX ? `${names} …等 ${item.count} 人` : names;
}

/**
 * 未结清的状态块：一行一个状态，「待就业 3 人：甲、乙、丙」
 *   已就业 / 退学 是允许的两态，不在这里重复列（弹窗正文会单独给出人数）。
 */
function unsettledHtml(p: EmploymentProgress): string {
  const rows = p.items.filter(
    (i) => i.status !== StudentStatus.EMPLOYED && i.status !== StudentStatus.QUIT,
  );
  return rows
    .map(
      (i) =>
        `<div class="ec-row"><span class="ec-st">${escText(i.statusName)}</span>` +
        `<span class="ec-ct">${i.count} 人</span>` +
        `<span class="ec-nm">${namesOf(i)}</span></div>`,
    )
    .join('');
}

async function doEmploymentUpgrade(row: ClassRow) {
  try {
    await ElMessageBox.confirm(
      `是否将该班级（${escText(row.className)}，${row.studentCount ?? 0} 人）的<b>学生状态改为「待就业」</b>？` +
        '<br/><br/><span>班级本身不搬动、不改名；已是「已就业」的学生不会被改动。<br/>' +
        '确认后班级状态也会变为「待就业」，按钮变为【待就业】。</span>',
      '升就业确认',
      {
        type: 'warning',
        confirmButtonText: '确认升就业',
        cancelButtonText: '取消',
        dangerouslyUseHTMLString: true,
      },
    );
  } catch {
    return;
  }
  employmentSaving.value = row.classId;
  try {
    const r = await upgradeClassToEmployment({ classId: row.classId });
    if (r.updated) ElMessage.success(`已将 ${r.updated} 名学生状态改为「待就业」，班级状态：${r.classStatusName}`);
    else ElMessage.info(`该班学生都已是待就业 / 已就业，班级状态：${r.classStatusName}`);
    load();
  } catch (e) {
    ElMessage.error((e as Error).message || '升就业失败');
  } finally {
    employmentSaving.value = '';
  }
}

/**
 * 【已就业】：识别整班学生状态
 *   全部「已就业 / 退学」→ 确认 → 班级状态改「已就业」
 *   还有别的状态       → 只提示（人数 + 人员），**不可操作**
 */
async function doConfirmEmployed(row: ClassRow) {
  let p: EmploymentProgress;
  try {
    p = await getEmploymentProgress(row.classId);
  } catch (e) {
    ElMessage.error((e as Error).message || '识别班级学生状态失败');
    return;
  }

  if (!p.settled) {
    /* ★ 2026-10-23 批注：仍有学生不是「已就业 / 退学」→ 提示各状态人数及人员，
     *   不可进行【已就业】操作。这里只弹一个「我知道了」，没有任何确认按钮。
     *   （后端 confirmClassEmployed 也做了同样的拦截，双保险） */
    await ElMessageBox.alert(
      `<div class="ec-tip">本班共 <b>${p.total}</b> 人，其中 ${progressSummary(p)}，` +
        `还有 <b>${p.pending}</b> 人未到「已就业 / 退学」，<b>不可改为「已就业」</b>：</div>` +
        `<div class="ec-box">${unsettledHtml(p)}</div>` +
        `<div class="ec-tip2">请先在【教学管理 → 学生档案】里把这 ${p.pending} 人确认为「已就业」` +
        `（或办理退学），再回来点【已就业】。</div>`,
      '不可改为已就业',
      {
        type: 'warning',
        confirmButtonText: '我知道了',
        dangerouslyUseHTMLString: true,
        customClass: 'ec-msgbox',
      },
    ).catch(() => undefined);
    return;
  }

  // 全班都已是「已就业 / 退学」→ 提示班级人数 / 就业人数，一次确认
  try {
    const headline = p.employed
      ? `整班都已就业：本班 <b>${p.total}</b> 人，其中 ${progressSummary(p)}。`
      : `本班 <b>${p.total}</b> 人已全部退学（已就业 0 人）。`;
    await ElMessageBox.confirm(
      `${headline}<br/><br/>确认要将班级状态改为「已就业」吗？`,
      '已就业确认',
      {
        type: 'success',
        confirmButtonText: '确认改为已就业',
        cancelButtonText: '取消',
        dangerouslyUseHTMLString: true,
      },
    );
  } catch {
    return;
  }
  employedSaving.value = row.classId;
  try {
    const r = await confirmClassEmployed({ classId: row.classId });
    ElMessage.success(
      r.changed ? `「${r.className}」的班级状态已改为「已就业」` : `「${r.className}」已经是「已就业」状态`,
    );
    load();
  } catch (e) {
    ElMessage.error((e as Error).message || '改为已就业失败');
  } finally {
    employedSaving.value = '';
  }
}

/** 弹窗里拼班级名用的极小转义（班级名是用户输入，直接拼 HTML 有注入风险） */
function escText(v: unknown): string {
  return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

onMounted(() => {
  load(1);
  loadStaff();
});
</script>

<style scoped>
.tcv {
  padding: 12px;
}
.tcv-tip {
  margin-bottom: 10px;
}
.muted {
  color: #A2938E;
  font-weight: normal;
}
.tcv-cards {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.tcv-card {
  background: #fff;
  border: 1px solid #F1EAE5;
  border-radius: 6px;
  padding: 10px 14px;
  min-width: 190px;
}
.tcv-card__k {
  font-size: 12px;
  color: #A2938E;
}
.tcv-card__v {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.4;
}
.tcv-card__x {
  font-size: 12px;
  color: #7A6C67;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.tcv-filter {
  background: #fff;
  padding: 10px 10px 0;
  border-radius: 6px;
}
.tcv-page {
  margin-top: 12px;
  justify-content: flex-end;
}

/* ---- 交接记录（详情抽屉）---- */
.ho-line {
  line-height: 1.6;
  font-size: 12px;
}
.ho-role {
  display: inline-block;
  width: 52px;
  color: #909399;
}
.ho-old {
  color: #606266;
}
.ho-arrow {
  margin: 0 4px;
  color: #c0c4cc;
}
.ho-new {
  color: #409eff;
  font-weight: 600;
}
.ho-empty {
  color: #c0c4cc;
}
.ho-reason {
  margin-top: 12px;
}
.link {
  color: #CD3A33;
  cursor: pointer;
}
.ok {
  color: #5FA36F;
}
.warn {
  color: #C9852E;
}
.danger {
  color: #CD3A33;
}
</style>

<!--
  ★ 2026-10-23：【已就业】的「不可操作」提示框
     ElMessageBox 渲染在 body 上（teleport），scoped 样式够不到，
     所以这段必须是**非 scoped** 的全局样式；class 前缀 ec- 避免污染。
-->
<style>
.ec-msgbox {
  max-width: 560px;
}
.ec-msgbox .el-message-box__message {
  max-height: 52vh;
  overflow: auto;
}
.ec-msgbox .ec-tip {
  line-height: 1.7;
  color: #303133;
}
.ec-msgbox .ec-tip2 {
  margin-top: 10px;
  line-height: 1.7;
  font-size: 12px;
  color: #909399;
}
.ec-msgbox .ec-box {
  margin-top: 10px;
  padding: 8px 10px;
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}
.ec-msgbox .ec-row {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  line-height: 1.6;
  border-bottom: 1px dashed #ebeef5;
}
.ec-msgbox .ec-row:last-child {
  border-bottom: none;
}
.ec-msgbox .ec-st {
  flex: 0 0 auto;
  min-width: 56px;
  color: #C9852E;
  font-weight: 600;
}
.ec-msgbox .ec-ct {
  flex: 0 0 auto;
  min-width: 34px;
  color: #303133;
}
.ec-msgbox .ec-nm {
  flex: 1 1 auto;
  color: #606266;
  word-break: break-all;
}
</style>
