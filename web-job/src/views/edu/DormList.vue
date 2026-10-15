<template>
  <div class="page-container">
    <!-- ============ 主 Tab ============ -->
    <el-tabs v-model="mainTab" class="main-tabs" @tab-change="handleMainTabChange">
      <el-tab-pane label="宿舍总名单" name="list" />
      <el-tab-pane label="分派宿舍" name="assign" />
      <el-tab-pane label="申请审批" name="approval" />
      <el-tab-pane label="退宿名单" name="checkout" />
    </el-tabs>

    <!-- ============================================================
         Tab 1：宿舍总名单
         ============================================================ -->
    <template v-if="mainTab === 'list'">
      <!-- 统计卡片 -->
      <div class="stat-row">
        <el-card v-for="s in listStatsCards" :key="s.label" shadow="never" class="stat-card">
          <div class="stat-icon" :style="{ background: s.bg, color: s.color }">{{ s.icon }}</div>
          <div class="stat-info">
            <span class="stat-num">{{ s.value }}</span>
            <span class="stat-label">{{ s.label }}</span>
          </div>
        </el-card>
      </div>

      <!-- 筛选 -->
      <el-card shadow="never" class="search-card">
        <el-form :model="roomQuery" inline>
          <el-form-item label="类别">
            <el-select
              v-model="roomQuery.category"
              placeholder="全部"
              clearable
              style="width: 120px"
              @change="onCategoryChange"
            >
              <el-option :value="1" label="男寝" />
              <el-option :value="2" label="女寝" />
            </el-select>
          </el-form-item>
          <el-form-item label="宿舍楼">
            <el-select
              v-model="roomQuery.building"
              placeholder="全部"
              clearable
              style="width: 120px"
              @change="onBuildingChange"
            >
              <el-option v-for="b in buildingOptions" :key="b" :label="b" :value="b" />
            </el-select>
          </el-form-item>
          <el-form-item label="关键字">
            <el-input
              v-model="roomQuery.keyword"
              placeholder="楼栋 / 宿舍号 / 学生 / 班级"
              clearable
              style="width: 200px"
              @keyup.enter="loadRooms"
            />
          </el-form-item>
          <!-- ★ 2026-10-03 斌哥：按学生姓名 / 学号筛选 -->
          <el-form-item label="学生">
            <el-input
              v-model="roomQuery.studentKeyword"
              placeholder="姓名 / 学号"
              clearable
              style="width: 160px"
              @keyup.enter="loadRooms"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="loadRooms">查询</el-button>
            <el-button :icon="Refresh" @click="resetRoomQuery">重置</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 表格 -->
      <el-card shadow="never" class="table-card">
        <div class="toolbar">
          <el-button v-if="canAct('edu:dorm:add', true)" type="primary" :icon="Plus" @click="openAddRoom">新增宿舍</el-button>
          <el-button v-if="canAct('edu:dorm:edit', true)" :icon="EditPen" @click="openEditInfo">编辑宿舍信息</el-button>
          <el-button v-if="canAct('edu:dorm:add', true)" :icon="Upload" @click="importVisible = true">导入</el-button>
        </div>

        <el-table
          v-loading="roomLoading"
          :data="flatRows"
          border
          :span-method="roomSpanMethod"
          :cell-class-name="roomCellClass"
          row-key="_key"
        >
          <el-table-column label="类别" width="90" align="center">
            <template #default="{ row }">
              <!-- ★ 2026-10-05：category=0 = 寝别未知（大学部学生表没有这个字段），
                   用灰色 info 而不是红色 danger，避免被误读成「女寝」 -->
              <el-tag
                :type="row._room.category === 0 ? 'info' : row._room.category === 1 ? 'primary' : 'danger'"
                size="small"
              >
                {{ row._room.categoryName }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="_building" label="宿舍楼" width="130" align="center">
            <template #default="{ row }">
              {{ row._building }}
              <!-- ★ 2026-10-03：实训宿舍已并入总名单，打标签区分（只读）
                   ★ 2026-10-05：大学部（Q1~Q6）宿舍也并入，同样只读 -->
              <el-tag
                v-if="row._source === 'job'"
                size="small"
                type="warning"
                effect="plain"
                style="margin-left: 4px"
              >
                实训
              </el-tag>
              <el-tag
                v-else-if="row._source === 'class'"
                size="small"
                type="primary"
                effect="plain"
                style="margin-left: 4px"
              >
                大学部
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="_roomNo" label="宿舍号" width="90" align="center" />
          <el-table-column label="入住学生姓名" min-width="120">
            <template #default="{ row }">{{ row._bed.empty ? '空床位' : row._bed.studentName }}</template>
          </el-table-column>
          <el-table-column label="床位号" width="90" align="center">
            <template #default="{ row }">{{ row._bed.bedNo }}</template>
          </el-table-column>
          <el-table-column label="班级" width="110">
            <template #default="{ row }">{{ row._bed.empty ? '—' : row._bed.className || '—' }}</template>
          </el-table-column>
          <el-table-column label="班主任" width="100">
            <template #default="{ row }">
              {{ row._bed.empty ? '—' : row._bed.headTeacherName || '—' }}
            </template>
          </el-table-column>
          <el-table-column label="入住/额定" width="100" align="center">
            <template #default="{ row }">{{ row._room.occupied }}/{{ row._room.capacity }}</template>
          </el-table-column>
          <el-table-column label="操作" width="120" align="center">
            <template #default="{ row }">
              <!-- ★ 只读来源判断：实训(job)由就业模块维护、大学部(class)由班级模块维护，
                   教务这边不给编辑/删除。
                   ⚠️ 用 isReadOnlySource 统一判断，别写成 `!== 'job'` ——
                      那样加第三个来源时又会漏掉，按钮一试点就报错。 -->
              <template v-if="!isReadOnlySource(row._source)">
                <el-button v-if="canAct('edu:dorm:edit', true)" link type="primary" size="small" @click="openEditOccupants(row._room)">
                  编辑
                </el-button>
                <el-button
                  v-if="canAct('edu:dorm:delete', true)"
                  link
                  type="danger"
                  size="small"
                  :disabled="row._room.occupied > 0"
                  @click="handleDeleteRoom(row._room)"
                >
                  删除
                </el-button>
              </template>
              <el-tag v-else size="small" type="info" effect="plain">
                {{ row._source === 'job' ? '就业模块维护' : '班级模块维护' }}
              </el-tag>
            </template>
          </el-table-column>
          <template #empty>
            <span class="empty-text">暂无数据</span>
          </template>
        </el-table>

        <el-pagination
          v-model:current-page="roomQuery.page"
          v-model:page-size="roomQuery.size"
          :page-sizes="[5, 10, 20]"
          :total="roomTotal"
          layout="total, sizes, prev, pager, next, jumper"
          style="margin-top: 16px; justify-content: flex-end"
          @size-change="loadRooms"
          @current-change="loadRooms"
        />
      </el-card>
    </template>

    <!-- ============================================================
         Tab 2：分派宿舍
         ============================================================ -->
    <template v-else-if="mainTab === 'assign'">
      <div class="stat-row">
        <el-card v-for="s in assignStatsCards" :key="s.label" shadow="never" class="stat-card">
          <div class="stat-icon" :style="{ background: s.bg, color: s.color }">{{ s.icon }}</div>
          <div class="stat-info">
            <span class="stat-num">{{ s.value }}</span>
            <span class="stat-label">{{ s.label }}</span>
          </div>
        </el-card>
      </div>

      <el-card shadow="never" class="search-card">
        <el-form :model="assignQuery" inline>
          <el-form-item label="类别">
            <el-select
              v-model="assignQuery.category"
              placeholder="全部"
              clearable
              style="width: 120px"
            >
              <el-option :value="1" label="男寝" />
              <el-option :value="2" label="女寝" />
            </el-select>
          </el-form-item>
          <el-form-item label="宿舍楼">
            <el-select
              v-model="assignQuery.building"
              placeholder="全部"
              clearable
              style="width: 120px"
            >
              <el-option v-for="b in assignBuildingOptions" :key="b" :label="b" :value="b" />
            </el-select>
          </el-form-item>
          <el-form-item label="关键字">
            <el-input
              v-model="assignQuery.keyword"
              placeholder="班级 / 班主任 / 楼栋 / 宿舍号"
              clearable
              style="width: 220px"
              @keyup.enter="loadAssign"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="loadAssign">查询</el-button>
            <el-button :icon="Refresh" @click="resetAssignQuery">重置</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never" class="table-card">
        <div class="toolbar">
          <el-button v-if="canAct('edu:dorm:edit', true)" type="primary" :icon="Plus" @click="openAssign()">分派宿舍</el-button>
          <span class="form-tip">一个班级可分到多间宿舍；一间宿舍同一时间只归属一个班级</span>
        </div>

        <el-table
          v-loading="assignLoading"
          :data="assignRows"
          border
          stripe
          row-key="className"
          default-expand-all
        >
          <el-table-column type="expand">
            <template #default="{ row }">
              <el-table :data="row.rooms" border size="small" class="assign-sub-table">
                <el-table-column prop="building" label="宿舍楼" width="110" align="center" />
                <el-table-column prop="room" label="宿舍号" width="110" align="center" />
                <el-table-column label="类别" width="90" align="center">
                  <template #default="{ row: rm }">
                    <el-tag :type="rm.category === 1 ? 'primary' : 'danger'" size="small">
                      {{ rm.categoryName }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="capacity" label="床位" width="90" align="center" />
                <el-table-column label="已入住" width="100" align="center">
                  <template #default="{ row: rm }">{{ rm.occupied }} / {{ rm.capacity }}</template>
                </el-table-column>
                <el-table-column label="本班入住" width="100" align="center">
                  <template #default="{ row: rm }">
                    <span :class="rm.ownOccupied < rm.occupied ? 'mixed-count' : ''">
                      {{ rm.ownOccupied }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="120" align="center">
                  <template #default="{ row: rm }">
                    <el-button v-if="canAct('edu:dorm:edit', true)" link type="danger" size="small" @click="handleRemoveAssign(rm)">
                      取消分派
                    </el-button>
                  </template>
                </el-table-column>
                <template #empty><span class="empty-text">该班级暂未分派宿舍</span></template>
              </el-table>
            </template>
          </el-table-column>

          <el-table-column prop="className" label="班级" min-width="130" />
          <el-table-column prop="headTeacherName" label="班主任" width="110" />
          <el-table-column label="已分派宿舍" min-width="260">
            <template #default="{ row }">
              <template v-if="row.rooms.length">
                <el-tag v-for="rm in row.rooms" :key="rm.roomId" size="small" class="room-tag">
                  {{ rm.building }} {{ rm.room }}
                </el-tag>
              </template>
              <span v-else class="empty-text">暂未分派</span>
            </template>
          </el-table-column>
          <el-table-column prop="roomCount" label="宿舍数" width="90" align="center" />
          <el-table-column prop="capacity" label="床位总数" width="100" align="center" />
          <el-table-column prop="occupied" label="已入住" width="100" align="center" />
          <el-table-column prop="ownOccupied" label="本班入住" width="100" align="center" />
          <el-table-column label="操作" width="150" align="center" fixed="right">
            <template #default="{ row }">
              <!-- ★ 2026-10-07 分派/清空 = 写操作（后端总闸归 edu:dorm:edit），接权限树 -->
              <el-button v-if="canAct('edu:dorm:edit', true)" link type="primary" size="small" @click="openAssign(row)">分派</el-button>
              <el-button v-if="canAct('edu:dorm:edit', true)" link type="danger" size="small" @click="handleClearAssign(row)">清空</el-button>
            </template>
          </el-table-column>
          <template #empty><span class="empty-text">暂无分派数据</span></template>
        </el-table>
      </el-card>
    </template>

    <!-- ============================================================
         Tab 3：申请审批
         ============================================================ -->
    <template v-else-if="mainTab === 'approval'">
      <div class="stat-row">
        <el-card v-for="s in approvalStatsCards" :key="s.label" shadow="never" class="stat-card">
          <div class="stat-icon" :style="{ background: s.bg, color: s.color }">{{ s.icon }}</div>
          <div class="stat-info">
            <span class="stat-num">{{ s.value }}</span>
            <span class="stat-label">{{ s.label }}</span>
          </div>
        </el-card>
      </div>

      <el-card shadow="never" class="search-card">
        <el-tabs v-model="subTab" class="sub-tabs" @tab-change="handleSubTabChange">
          <el-tab-pane label="换宿申请" name="change" />
          <el-tab-pane label="退宿申请" name="quit" />
        </el-tabs>

        <el-form :model="applyQuery" inline>
          <el-form-item label="状态">
            <el-select v-model="applyQuery.status" placeholder="全部" clearable style="width: 130px">
              <el-option :value="1" label="待审核" />
              <el-option :value="2" label="已同意" />
              <el-option :value="3" label="已驳回" />
            </el-select>
          </el-form-item>
          <el-form-item label="班级">
            <el-select v-model="applyQuery.className" placeholder="全部" clearable filterable style="width: 150px">
              <el-option v-for="c in ALL_CLASSES" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="loadApplies">查询</el-button>
            <el-button :icon="Refresh" @click="resetApplyQuery">重置</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never" class="table-card">
        <!-- 换宿
             ★ 2026-10-04：列跟「就业管理 → 宿舍管理 → 调换/退宿申请」对齐
               （序号 / 学生 / 班级 / 宿舍变动 / 申请日期 / 班主任 / 审批状态）
               教务审批要看的「申请原因」「驳回原因」保留在后面 -->
        <el-table v-if="subTab === 'change'" v-loading="applyLoading" :data="changeList" border stripe>
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column label="学生" min-width="120">
            <template #default="{ row }">
              <div>
                {{ row.studentName }}
                <span class="sub-text">{{ row.genderName }}</span>
              </div>
              <div class="sub-text">{{ row.studentNo || '—' }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="className" label="班级" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ row.className || '—' }}</template>
          </el-table-column>
          <el-table-column label="宿舍变动" min-width="170" align="center">
            <template #default="{ row }">
              <span class="dorm-from">{{ row.oldDormNo || '—' }}</span>
              <span class="arrow">→</span>
              <span class="dorm-to">{{ row.newDormNo || '—' }}</span>
              <div class="sub-text">床位 {{ row.oldBedNo ?? '—' }} → {{ row.newBedNo ?? '—' }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="applyDate" label="申请日期" width="110" align="center" />
          <el-table-column prop="headTeacherName" label="班主任" width="95" align="center">
            <template #default="{ row }">{{ row.headTeacherName || '—' }}</template>
          </el-table-column>
          <el-table-column label="审批状态" width="130" align="center">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)" size="small">{{ row.statusName }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="申请原因" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.reason || '—' }}</template>
          </el-table-column>
          <el-table-column label="备注" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.rejectReason" class="reject-reason">{{ row.rejectReason }}</span>
              <span v-else class="empty-text">-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" align="center" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="canAct('edu:dorm:approve', true)"
                link
                type="success"
                size="small"
                :disabled="row.status !== 1"
                @click="handleApprove('change', row)"
              >
                通过
              </el-button>
              <el-button
                v-if="canAct('edu:dorm:approve', true)"
                link
                type="danger"
                size="small"
                :disabled="row.status !== 1"
                @click="openReject('change', row)"
              >
                驳回
              </el-button>
            </template>
          </el-table-column>
          <template #empty><span class="empty-text">暂无数据</span></template>
        </el-table>

        <!-- 退宿
             ★ 2026-10-04：同上，列跟就业侧对齐；退宿没有"新宿舍"，宿舍变动只显示现宿舍 -->
        <el-table v-else v-loading="applyLoading" :data="quitList" border stripe>
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column label="学生" min-width="120">
            <template #default="{ row }">
              <div>
                {{ row.studentName }}
                <span class="sub-text">{{ row.genderName }}</span>
              </div>
              <div class="sub-text">{{ row.studentNo || '—' }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="className" label="班级" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ row.className || '—' }}</template>
          </el-table-column>
          <el-table-column label="宿舍变动" min-width="170" align="center">
            <template #default="{ row }">
              <span class="dorm-from">{{ row.oldDormNo || '—' }}</span>
              <div class="sub-text">床位 {{ row.oldBedNo ?? '—' }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="applyDate" label="申请日期" width="110" align="center" />
          <el-table-column prop="headTeacherName" label="班主任" width="95" align="center">
            <template #default="{ row }">{{ row.headTeacherName || '—' }}</template>
          </el-table-column>
          <el-table-column label="审批状态" width="130" align="center">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)" size="small">{{ row.statusName }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="申请原因" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.reason || '—' }}</template>
          </el-table-column>
          <el-table-column prop="phone" label="联系电话" width="130">
            <template #default="{ row }">{{ row.phone || '—' }}</template>
          </el-table-column>
          <el-table-column label="备注" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.rejectReason" class="reject-reason">{{ row.rejectReason }}</span>
              <span v-else class="empty-text">-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" align="center" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="canAct('edu:dorm:approve', true)"
                link
                type="success"
                size="small"
                :disabled="row.status !== 1"
                @click="handleApprove('quit', row)"
              >
                通过
              </el-button>
              <el-button
                v-if="canAct('edu:dorm:approve', true)"
                link
                type="danger"
                size="small"
                :disabled="row.status !== 1"
                @click="openReject('quit', row)"
              >
                驳回
              </el-button>
            </template>
          </el-table-column>
          <template #empty><span class="empty-text">暂无数据</span></template>
        </el-table>

        <el-pagination
          v-model:current-page="applyQuery.page"
          v-model:page-size="applyQuery.size"
          :page-sizes="[10, 20, 50]"
          :total="applyTotal"
          layout="total, sizes, prev, pager, next, jumper"
          style="margin-top: 16px; justify-content: flex-end"
          @size-change="loadApplies"
          @current-change="loadApplies"
        />
      </el-card>
    </template>

    <!-- ============================================================
         Tab 3：退宿名单
         ============================================================ -->
    <template v-else>
      <el-card shadow="never" class="search-card">
        <el-form :model="checkoutQuery" inline>
          <el-form-item label="班级">
            <el-select v-model="checkoutQuery.className" placeholder="全部" clearable filterable style="width: 150px">
              <el-option v-for="c in ALL_CLASSES" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item>
          <el-form-item label="宿舍楼">
            <el-select v-model="checkoutQuery.building" placeholder="全部" clearable style="width: 130px">
              <el-option v-for="b in BUILDINGS" :key="b" :label="b" :value="b" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="loadCheckouts">查询</el-button>
            <el-button :icon="Refresh" @click="resetCheckoutQuery">重置</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never" class="table-card">
        <div class="toolbar">
          <el-button :icon="Download" :loading="exporting" @click="handleExport">导出</el-button>
        </div>

        <el-table v-loading="checkoutLoading" :data="checkoutList" border stripe>
          <el-table-column prop="studentName" label="申请人" width="110" />
          <el-table-column label="退宿宿舍" width="130">
            <template #default="{ row }">{{ dormLabel(row.quitBuilding, row.quitRoom) }}</template>
          </el-table-column>
          <el-table-column prop="quitBed" label="床位号" width="100" align="center" />
          <el-table-column prop="className" label="班级" width="130" />
          <el-table-column prop="checkoutDate" label="申请时间" width="130" />
          <el-table-column prop="phone" label="联系电话" width="140" />
          <template #empty><span class="empty-text">暂无数据</span></template>
        </el-table>

        <el-pagination
          v-model:current-page="checkoutQuery.page"
          v-model:page-size="checkoutQuery.size"
          :page-sizes="[10, 20, 50]"
          :total="checkoutTotal"
          layout="total, sizes, prev, pager, next, jumper"
          style="margin-top: 16px; justify-content: flex-end"
          @size-change="loadCheckouts"
          @current-change="loadCheckouts"
        />
      </el-card>
    </template>

    <!-- ============ 新增宿舍 ============ -->
    <el-dialog v-model="addVisible" title="新增宿舍" width="480px">
      <el-form :model="addForm" label-width="90px">
        <el-form-item label="类别">
          <el-radio-group v-model="addForm.category">
            <el-radio :value="1">男寝</el-radio>
            <el-radio :value="2">女寝</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="楼号">
          <el-input v-model="addForm.building" placeholder="如 A-1" />
        </el-form-item>
        <el-form-item label="宿舍号">
          <el-input v-model="addForm.room" placeholder="如 101" />
        </el-form-item>
        <el-form-item label="额定人数">
          <el-input-number v-model="addForm.capacity" :min="1" :max="8" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitAddRoom">确定</el-button>
      </template>
    </el-dialog>

    <!-- ============ 编辑宿舍信息 ============ -->
    <el-dialog v-model="infoVisible" title="编辑宿舍信息" width="520px">
      <el-form :model="infoForm" label-width="110px">
        <el-form-item label="选择楼栋">
          <el-select v-model="infoForm.pickedBuilding" style="width: 100%" @change="loadRoomsOfBuilding">
            <el-option v-for="b in allBuildings" :key="b" :label="b" :value="b" />
          </el-select>
        </el-form-item>
        <el-form-item label="选择宿舍号">
          <el-select v-model="infoForm.pickedRoomId" style="width: 100%" @change="fillInfoForm">
            <el-option v-for="r in roomsOfBuilding" :key="r.roomId" :label="r.room" :value="r.roomId" />
          </el-select>
        </el-form-item>
        <el-divider />
        <el-form-item label="类别">
          <el-radio-group v-model="infoForm.category">
            <el-radio :value="1">男寝</el-radio>
            <el-radio :value="2">女寝</el-radio>
          </el-radio-group>
          <div class="form-tip">修改类别时，整栋楼的类别会同步变更</div>
        </el-form-item>
        <el-form-item label="楼号">
          <el-input v-model="infoForm.building" />
          <div class="form-tip">修改楼号时，整栋楼的房间会一并迁移</div>
        </el-form-item>
        <el-form-item label="宿舍号">
          <el-input v-model="infoForm.room" />
          <div class="form-tip">宿舍号仅作用于当前选中的这一间</div>
        </el-form-item>
        <el-form-item label="额定人数">
          <el-input-number v-model="infoForm.capacity" :min="1" :max="8" />
          <div class="form-tip">
            额定人数 = 该宿舍的床位数量，仅作用于当前选中这一间；
            调小时只能删掉空床位，有人住的床位需先调走（当前已入住 {{ infoOccupied }} 人）
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="infoVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitInfo">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 编辑入住学生 ============ -->
    <el-dialog
      v-model="occVisible"
      :title="`编辑入住学生 · ${currentRoom?.building || ''} ${currentRoom?.room || ''}`"
      width="720px"
    >
      <div v-if="currentRoom" class="occ-header">
        <el-tag :type="currentRoom.category === 1 ? 'primary' : 'danger'" size="small">
          {{ currentRoom.categoryName }}
        </el-tag>
        <span class="occ-title">{{ currentRoom.building }} - {{ currentRoom.room }}</span>
        <span class="occ-count">额定 {{ currentRoom.capacity }} 人，当前 {{ currentRoom.occupied }} 人</span>
      </div>

      <div class="bed-note">{{ BED_NOTE }}</div>

      <el-table :data="occForm" border size="small" max-height="360">
        <el-table-column label="床位号" width="120">
          <template #default="{ row }">
            <el-select v-model="row.bedNo" size="small" style="width: 100%">
              <el-option v-for="b in availableBeds(row)" :key="b" :label="b" :value="b" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="学生姓名">
          <template #default="{ row }">
            <el-input v-model="row.studentName" size="small" placeholder="请输入姓名" />
          </template>
        </el-table-column>
        <el-table-column label="班级">
          <template #default="{ row }">
            <el-select v-model="row.className" size="small" filterable allow-create clearable style="width: 100%">
              <el-option v-for="c in ALL_CLASSES" :key="c" :label="c" :value="c" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="班主任" width="120">
          <template #default="{ row }">
            <el-input v-model="row.headTeacherName" size="small" placeholder="可留空" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" size="small" @click="occForm.splice($index, 1)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-button
        class="add-occ-btn"
        :icon="Plus"
        :disabled="!freeBedNos.length || occForm.length >= (currentRoom?.capacity || 8)"
        @click="addOccupantRow"
      >
        添加入住学生
      </el-button>

      <template #footer>
        <el-button @click="occVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitOccupants">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 分派宿舍 ============ -->
    <el-dialog v-model="assignVisible" title="分派宿舍" width="760px" top="6vh">
      <el-form :model="assignForm" label-width="80px">
        <el-form-item label="班级" required>
          <el-select
            v-model="assignForm.className"
            filterable
            placeholder="请选择班级"
            style="width: 180px"
            @change="onAssignClassChange"
          >
            <el-option v-for="c in ALL_CLASSES" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="班主任">
          <el-input v-model="assignForm.headTeacherName" placeholder="留空则不记录" style="width: 180px" />
        </el-form-item>
      </el-form>

      <el-divider content-position="left">选择宿舍</el-divider>

      <el-form :inline="true" class="assign-room-filter">
        <el-form-item label="宿舍楼">
          <el-select v-model="roomFilter.building" placeholder="全部" clearable style="width: 110px">
            <el-option v-for="b in filterBuildings" :key="b" :label="b" :value="b" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input
            v-model="roomFilter.keyword"
            placeholder="楼栋 / 宿舍号"
            clearable
            style="width: 140px"
          />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="roomFilter.onlyFree">只看未分派</el-checkbox>
        </el-form-item>
        <el-form-item>
          <span class="form-tip">已选 {{ checkedRoomIds.length }} 间</span>
        </el-form-item>
      </el-form>

      <div v-loading="candidateLoading" class="assign-room-box">
        <div v-for="g in groupedCandidates" :key="g.building">
          <div class="building-title">{{ g.building }}</div>
          <el-checkbox-group v-model="checkedRoomIds" class="room-check-grid">
            <el-checkbox
              v-for="rm in g.rooms"
              :key="rm.roomId"
              :value="rm.roomId"
              :disabled="rm.assigned && rm.assignedTo !== assignForm.className"
            >
              {{ rm.room }}
              <span class="room-meta">
                {{ rm.occupied }}/{{ rm.capacity }}
                <template v-if="rm.assigned && rm.assignedTo !== assignForm.className">
                  · {{ rm.assignedTo }}
                </template>
                <template v-else-if="rm.assigned"> · 本班</template>
              </span>
            </el-checkbox>
          </el-checkbox-group>
        </div>
        <el-empty v-if="!groupedCandidates.length" description="没有匹配的宿舍" :image-size="60" />
      </div>

      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitAssign">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 驳回原因 ============ -->
    <el-dialog v-model="rejectVisible" title="填写驳回原因" width="440px">
      <el-input
        v-model="rejectReason"
        type="textarea"
        :rows="3"
        placeholder="请说明驳回原因，学生会看到这段说明"
      />
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="saving" @click="submitReject">确认驳回</el-button>
      </template>
    </el-dialog>

    <!-- ============ 导入 ============ -->
    <el-dialog v-model="importVisible" title="导入入住明细" width="620px" @closed="resetImport">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
        <template #title>
          表头必须包含：宿舍楼、宿舍号、床位号、学生姓名（班级 / 班主任 / 类别可选）。<br />
          宿舍不存在会自动创建；床位已有学生的行会跳过。
        </template>
      </el-alert>
      <el-button link type="primary" :icon="Download" style="margin-bottom: 12px" @click="downloadTemplate">
        下载导入模板
      </el-button>
      <el-upload
        ref="uploadRef"
        drag
        :auto-upload="false"
        :limit="1"
        accept=".xlsx,.xls,.csv"
        :on-change="handleFileChange"
        :on-exceed="handleFileExceed"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">支持 xlsx / xls / csv，不超过 5MB</div>
        </template>
      </el-upload>
      <div v-if="importResult" class="import-result">
        <p class="import-summary">
          成功 <b class="ok">{{ importResult.successCount }}</b> 条，失败
          <b :class="importResult.failCount ? 'bad' : ''">{{ importResult.failCount }}</b> 条
        </p>
        <el-table v-if="importResult.failures.length" :data="importResult.failures" size="small" border max-height="180">
          <el-table-column prop="row" label="行号" width="70" align="center" />
          <el-table-column prop="reason" label="失败原因" show-overflow-tooltip />
        </el-table>
      </div>
      <template #footer>
        <el-button @click="importVisible = false">关闭</el-button>
        <el-button type="primary" :loading="importing" @click="handleImport">确认导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 宿舍管理页
 *
 * 内容取自原型 dorm.html，视觉沿用本项目的 Element Plus 风格：
 *   - 三个主 Tab：宿舍总名单 / 申请审批 / 退宿名单
 *   - 宿舍列表每间固定 8 行床位，前三列与「入住·额定」「操作」合并单元格（rowspan=8）
 *   - 空床位渲染成灰底斜体「空床位」，班级/班主任显示「—」
 *   - 申请审批下有换宿 / 退宿两个子 Tab，含通过 / 驳回（驳回要填原因）
 */

import { ref, reactive, computed, onMounted, watch } from 'vue';
import { canAct } from '@/store/permission';
import { ElMessage, ElMessageBox, type UploadFile, type UploadInstance, type UploadRawFile } from 'element-plus';
import { Search, Refresh, Plus, Upload, UploadFilled, Download, EditPen } from '@element-plus/icons-vue';
import {
  BUILDINGS,
  ALL_CLASSES,
  BED_OPTIONS,
  BED_NOTE,
  DORM_PAGE_SIZE,
  type DormRoomItem,
  type DormBed,
  type DormAssignClassRow,
  type DormAssignRoom,
  type DormAssignCandidate,
  type DormAssignStats,
} from 'shared-types/edu';
import { http } from '@/api/request';
import {
  fetchDormList,
  fetchDormBuildings,
  fetchDormStats,
  fetchApprovalStats,
  fetchChangeApplies,
  fetchQuitApplies,
  fetchCheckoutList,
  exportCheckoutList,
  addDormRoom,
  updateDormRoomInfo,
  updateDormOccupants,
  deleteDormRoom,
  approveChange,
  rejectChange,
  approveQuit,
  rejectQuit,
  fetchAssignList,
  fetchAssignRooms,
  fetchAssignStats,
  replaceAssign,
  removeAssign,
  clearAssign,
} from '@/api/edu/dorm';

/* ============ 原型常量 ============ */

const mainTab = ref('list');
const subTab = ref('change');

/** 全部楼栋（编辑宿舍信息弹窗用，从库里读，新增/导入了新楼也能自动出现） */
const allBuildings = ref<string[]>([...BUILDINGS]);
/** 楼栋 → 类别（1男寝 / 2女寝），选中楼栋时用来反查类别 */
const buildingCategoryMap = ref<Record<string, number>>({});

/* ============ Tab 1：宿舍总名单 ============ */

const roomLoading = ref(false);
const rooms = ref<DormRoomItem[]>([]);
const roomTotal = ref(0);

const listStats = reactive({ totalDorms: 0, maleDorms: 0, femaleDorms: 0, vacantBeds: 0 });
const listStatsCards = computed(() => [
  { label: '宿舍总数', value: listStats.totalDorms, icon: '🏠', bg: '#FDF4F2', color: '#CD3A33' },
  { label: '男寝', value: listStats.maleDorms, icon: '♂', bg: '#FDF4F2', color: '#CD3A33' },
  { label: '女寝', value: listStats.femaleDorms, icon: '♀', bg: '#F7E9EF', color: '#C2668C' },
  { label: '空余床位', value: listStats.vacantBeds, icon: '🛏', bg: '#EBF5EF', color: '#5FA36F' },
]);

const roomQuery = reactive({
  page: 1,
  size: DORM_PAGE_SIZE,   // 原型 dormPageSize = 5（单位是「间」）
  category: undefined as number | undefined,
  building: undefined as string | undefined,
  keyword: undefined as string | undefined,
  /** ★ 2026-10-03：按学生姓名 / 学号筛选 */
  studentKeyword: undefined as string | undefined,
});

/* ============================================================
 * 「类别」和「宿舍楼」联动
 *
 *   - 选了类别 → 宿舍楼下拉只剩该类别下的楼栋（男寝 → A-1/A-2，女寝 → B-1/B-2）
 *   - 原来选中的楼栋如果不属于新类别，自动清掉，避免出现查不到数据的组合
 *   - 选了楼栋 → 反查它所属类别自动填上，两边保持一致
 * ============================================================ */

/** 宿舍楼下拉的当前选项（随类别变化） */
const buildingOptions = ref<string[]>([...BUILDINGS]);

async function loadBuildingOptions() {
  try {
    const list = await fetchDormBuildings(roomQuery.category);
    buildingOptions.value = list.length ? list : [...BUILDINGS];
  } catch (e) {
    console.error('加载楼栋选项失败', e);
    buildingOptions.value = [...BUILDINGS];
  }
}

/** 类别变了：重拉楼栋选项，并清掉不匹配的楼栋 */
watch(
  () => roomQuery.category,
  async () => {
    await loadBuildingOptions();
    if (roomQuery.building && !buildingOptions.value.includes(roomQuery.building)) {
      roomQuery.building = undefined;
    }
  },
);

function onCategoryChange() {
  roomQuery.page = 1;
}

/** 楼栋变了：按库里真实的「楼栋→类别」关系反填类别，保证组合有效 */
function onBuildingChange(building: string) {
  roomQuery.page = 1;
  const category = building ? buildingCategoryMap.value[building] : undefined;
  if (roomQuery.category !== category) {
    roomQuery.category = category;
    loadBuildingOptions();
  }
}

/**
 * ★ 2026-10-05 只读来源
 *
 *   edu   → 教务自有，可编辑/删除
 *   job   → 实训宿舍，由「就业管理」维护，教务这边只读
 *   class → 大学部宿舍，由「班级模块」维护，教务这边只读
 *
 * ⚠️ 加新来源时只改这里，不要在模板里写 `!== 'job'` ——
 *    那种写法漏一个来源就等于给只读数据开了写入口。
 */
function isReadOnlySource(source?: string): boolean {
  return source === 'job' || source === 'class';
}

/**
 * 一次性把两个类别的楼栋都拉回来，顺手建好「楼栋→类别」映射
 *
 * ★ 2026-10-05：大学部的楼栋（2号楼/3号楼/4号楼）寝别未知，
 *   两个类别的接口都会返回它们，但 buildingCategoryMap 里没有它们的类别。
 *   → 「全部类别」下拉要靠 allBuildings 全集（后端已并入三路），
 *     选具体类别时它们会被后端过滤掉，这里不用特殊处理。
 */
async function loadAllBuildings() {
  try {
    const [male, female] = await Promise.all([fetchDormBuildings(1), fetchDormBuildings(2)]);
    const map: Record<string, number> = {};
    male.forEach((b) => (map[b] = 1));
    female.forEach((b) => (map[b] = 2));

    const all = [...male, ...female].sort();
    if (all.length) {
      allBuildings.value = all;
      buildingCategoryMap.value = map;
    }
  } catch (e) {
    console.error('加载楼栋列表失败', e);
  }
}

/**
 * 把「每间宿舍」展开成 8 行床位，交给 el-table 渲染
 * 每行都带上所属房间，方便合并单元格和取数
 */
const flatRows = computed(() =>
  rooms.value.flatMap((room) =>
    room.beds.map((bed, i) => ({
      _key: `${room.roomId}-${bed.bedNo}`,
      _room: room,
      _bed: bed,
      _building: room.building,
      _roomNo: room.room,
      _first: i === 0,
      // ⚠️ 床位数 = 额定人数，不是固定 8（额定可改，所以每间要各自记一份）
      _bedCount: room.beds.length,
      // ★ 2026-10-03：来源（edu=教务自有 / job=实训同步，只读）
      _source: room.source || 'edu',
      _sourceName: room.sourceName || '教务',
    })),
  ),
);

/**
 * 合并单元格：每间宿舍占 capacity 行（不是固定 8 行）
 * 只在「该间的第一行」上合并，其余行返回 rowspan:0
 */
function roomSpanMethod({ row, columnIndex }: { row: any; columnIndex: number }) {
  const spanCols = [0, 1, 2, 7, 8];
  if (spanCols.includes(columnIndex)) {
    return row._first ? { rowspan: row._bedCount, colspan: 1 } : { rowspan: 0, colspan: 0 };
  }
  return { rowspan: 1, colspan: 1 };
}

/** 空床位那几列加灰底斜体（对应原型 emptyStyle） */
function roomCellClass({ row, columnIndex }: { row: any; columnIndex: number }) {
  return row._bed?.empty && [3, 4, 5, 6].includes(columnIndex) ? 'empty-bed-cell' : '';
}

async function loadRooms() {
  roomLoading.value = true;
  try {
    const data = await fetchDormList(roomQuery);
    rooms.value = data.list;
    roomTotal.value = data.total;
  } catch (e) {
    console.error('加载宿舍列表失败', e);
  } finally {
    roomLoading.value = false;
  }
}

async function loadRoomStats() {
  try {
    Object.assign(listStats, await fetchDormStats());
  } catch (e) {
    console.error(e);
  }
}

function resetRoomQuery() {
  roomQuery.page = 1;
  roomQuery.category = undefined;
  roomQuery.building = undefined;
  roomQuery.keyword = undefined;
  roomQuery.studentKeyword = undefined;   // ★ 学生姓名/学号筛选也要一起清
  loadBuildingOptions();   // 类别清掉了，楼栋选项要恢复成全部
  loadRooms();
}

/* ============ 新增宿舍 ============ */

const addVisible = ref(false);
const saving = ref(false);
const addForm = reactive({ category: 1, building: '', room: '', capacity: 8 });

function openAddRoom() {
  Object.assign(addForm, { category: 1, building: '', room: '', capacity: 8 });
  addVisible.value = true;
}

async function submitAddRoom() {
  if (!addForm.building.trim() || !addForm.room.trim()) {
    ElMessage.warning('请填写楼号和宿舍号');
    return;
  }
  saving.value = true;
  try {
    await addDormRoom({
      category: addForm.category as 1 | 2,
      building: addForm.building.trim(),
      room: addForm.room.trim(),
      capacity: addForm.capacity,
    });
    ElMessage.success('宿舍创建成功');
    addVisible.value = false;
    loadRooms();
    loadRoomStats();
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

/* ============ 编辑宿舍信息 ============ */

const infoVisible = ref(false);
const roomsOfBuilding = ref<DormRoomItem[]>([]);
const infoForm = reactive({
  pickedBuilding: '',
  pickedRoomId: '',
  category: 1,
  building: '',
  room: '',
  capacity: 8,
});

/** 取全部宿舍用于「选择楼栋」，原型是靠 dormList 现算的，这里拉一次全量 */
async function loadAllRooms() {
  const data = await fetchDormList({ page: 1, size: 200 });
  return data.list;
}

async function openEditInfo() {
  try {
    const all = await loadAllRooms();
    const blds = [...new Set(all.map((r) => r.building))].sort();
    if (!blds.length) {
      ElMessage.warning('暂无宿舍数据，请先新建宿舍');
      return;
    }
    Object.assign(infoForm, {
      pickedBuilding: blds[0],
      pickedRoomId: '',
      category: 1,
      building: '',
      room: '',
      capacity: 8,
    });
    await loadRoomsOfBuilding();
    infoVisible.value = true;
  } catch (e) {
    console.error(e);
  }
}

async function loadRoomsOfBuilding() {
  const all = await loadAllRooms();
  roomsOfBuilding.value = all.filter((r) => r.building === infoForm.pickedBuilding);
  if (roomsOfBuilding.value.length) {
    infoForm.pickedRoomId = roomsOfBuilding.value[0].roomId;
    fillInfoForm();
  } else {
    infoForm.pickedRoomId = '';
  }
}

function fillInfoForm() {
  const r = roomsOfBuilding.value.find((x) => x.roomId === infoForm.pickedRoomId);
  if (!r) return;
  Object.assign(infoForm, {
    category: r.category,
    building: r.building,
    room: r.room,
    capacity: r.capacity,
  });
}

/** 当前选中宿舍已入住多少人（给额定人数做提示用） */
const infoOccupied = computed(
  () => roomsOfBuilding.value.find((x) => x.roomId === infoForm.pickedRoomId)?.occupied ?? 0,
);

async function submitInfo() {
  if (!infoForm.pickedRoomId) {
    ElMessage.warning('请选择宿舍');
    return;
  }
  const newBuilding = infoForm.building.trim();
  const newRoom = infoForm.room.trim();
  if (!newBuilding || !newRoom) {
    ElMessage.warning('请填写楼号和宿舍号');
    return;
  }

  const oldBuilding = infoForm.pickedBuilding;
  const target = roomsOfBuilding.value.find((x) => x.roomId === infoForm.pickedRoomId);
  if (!target) {
    ElMessage.warning('未找到目标宿舍');
    return;
  }
  const buildingRoomCount = roomsOfBuilding.value.length;

  // ---- 整栋楼级别的两处改动，改前要确认（跟原型 confirm 一致）----
  if (infoForm.category !== target.category) {
    const catName = infoForm.category === 1 ? '男寝' : '女寝';
    try {
      await ElMessageBox.confirm(
        `修改类别将应用于整栋宿舍楼「${oldBuilding}」共 ${buildingRoomCount} 间宿舍（改为${catName}），是否继续？`,
        '确认修改类别',
        { type: 'warning' },
      );
    } catch {
      return; // 取消
    }
  }

  if (newBuilding !== oldBuilding) {
    try {
      await ElMessageBox.confirm(
        `楼号「${oldBuilding}」→「${newBuilding}」将应用于整栋宿舍楼共 ${buildingRoomCount} 间宿舍，是否继续？`,
        '确认修改楼号',
        { type: 'warning' },
      );
    } catch {
      return; // 取消
    }
  }

  saving.value = true;
  try {
    await updateDormRoomInfo({
      id: infoForm.pickedRoomId,
      category: infoForm.category as 1 | 2,
      building: newBuilding,
      room: newRoom,
      capacity: infoForm.capacity,
    });
    ElMessage.success('宿舍信息已更新');
    infoVisible.value = false;
    loadRooms();
    loadRoomStats();
    // 楼号可能被动过，楼栋下拉要重新拉
    loadBuildingOptions();
    loadAllBuildings();
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

/* ============ 编辑入住学生 ============ */

const occVisible = ref(false);
const currentRoom = ref<DormRoomItem | null>(null);
const occForm = ref<{ bedNo: string; studentName: string; className: string; headTeacherName: string }[]>([]);

function openEditOccupants(room: DormRoomItem) {
  currentRoom.value = room;
  occForm.value = room.beds
    .filter((b: DormBed) => !b.empty)
    .map((b: DormBed) => ({
      bedNo: b.bedNo,
      studentName: b.studentName || '',
      className: b.className || '',
      headTeacherName: b.headTeacherName || '',
    }));
  occVisible.value = true;
}

/** 还没被占用的床位（只在本间宿舍的床位范围内选，床位数 = 额定人数） */
const freeBedNos = computed(() => {
  if (!currentRoom.value) return [];
  const used = new Set(occForm.value.map((o) => o.bedNo));
  return currentRoom.value.beds.map((b: DormBed) => b.bedNo).filter((b) => !used.has(b));
});

/** 每行可选的床位 = 自己占着的那个 + 所有空着的 */
function availableBeds(row: { bedNo: string }) {
  return [row.bedNo, ...freeBedNos.value].filter((v, i, arr) => arr.indexOf(v) === i);
}

function addOccupantRow() {
  const free = freeBedNos.value;
  if (!free.length) return;
  occForm.value.push({ bedNo: free[0], studentName: '', className: '', headTeacherName: '' });
}

async function submitOccupants() {
  if (!currentRoom.value) return;

  const bad = occForm.value.find((o) => !o.studentName.trim());
  if (bad) {
    ElMessage.warning('每位入住学生都要填姓名，不需要的行请点「移除」');
    return;
  }

  saving.value = true;
  try {
    await updateDormOccupants({
      id: currentRoom.value.roomId,
      occupants: occForm.value.map((o) => ({
        bedNo: o.bedNo,
        studentName: o.studentName.trim(),
        className: o.className || undefined,
        headTeacherName: o.headTeacherName || undefined,
      })),
    });
    ElMessage.success('入住信息已保存');
    occVisible.value = false;
    loadRooms();
    loadRoomStats();
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

/* ============ 删除宿舍 ============ */

async function handleDeleteRoom(room: DormRoomItem) {
  if (room.occupied > 0) {
    ElMessage.warning('该宿舍还有学生入住，不能删除');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认删除 ${room.building} ${room.room} 吗？删除后不可恢复。`,
      '删除宿舍',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  await deleteDormRoom(room.roomId);
  ElMessage.success('删除成功');
  loadRooms();
  loadRoomStats();
}

/* ============ Tab 2：申请审批 ============ */

const applyLoading = ref(false);
const changeList = ref<any[]>([]);
const quitList = ref<any[]>([]);
const applyTotal = ref(0);

const approvalStats = reactive({
  pendingChange: 0,
  pendingQuit: 0,
  approvedChange: 0,
  approvedQuit: 0,
});
const approvalStatsCards = computed(() => [
  { label: '换宿待审核', value: approvalStats.pendingChange, icon: '⏳', bg: '#FBF3E5', color: '#C9852E' },
  { label: '退宿待审核', value: approvalStats.pendingQuit, icon: '⏳', bg: '#FBF3E5', color: '#C9852E' },
  { label: '换宿已同意', value: approvalStats.approvedChange, icon: '✓', bg: '#EBF5EF', color: '#5FA36F' },
  { label: '退宿已同意', value: approvalStats.approvedQuit, icon: '✓', bg: '#EBF5EF', color: '#5FA36F' },
]);

const applyQuery = reactive({
  page: 1,
  size: 10,
  status: undefined as number | undefined,
  className: undefined as string | undefined,
});

async function loadApplies() {
  applyLoading.value = true;
  try {
    if (subTab.value === 'change') {
      const data = await fetchChangeApplies(applyQuery);
      changeList.value = data.list;
      applyTotal.value = data.total;
    } else {
      const data = await fetchQuitApplies(applyQuery);
      quitList.value = data.list;
      applyTotal.value = data.total;
    }
  } catch (e) {
    console.error(e);
  } finally {
    applyLoading.value = false;
  }
}

async function loadApprovalStats() {
  try {
    Object.assign(approvalStats, await fetchApprovalStats());
  } catch (e) {
    console.error(e);
  }
}

function handleSubTabChange() {
  applyQuery.page = 1;
  loadApplies();
}

function resetApplyQuery() {
  applyQuery.page = 1;
  applyQuery.status = undefined;
  applyQuery.className = undefined;
  loadApplies();
}

async function handleApprove(type: 'change' | 'quit', row: any) {
  try {
    await ElMessageBox.confirm(`确认同意 ${row.studentName} 的申请吗？`, '审核通过', {
      type: 'warning',
    });
  } catch {
    return;
  }
  saving.value = true;
  try {
    if (type === 'change') await approveChange(row.applyId);
    else await approveQuit(row.applyId);
    ElMessage.success('已同意');
    loadApplies();
    loadApprovalStats();
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

const rejectVisible = ref(false);
const rejectReason = ref('');
const rejectTarget = ref<{ type: 'change' | 'quit'; id: string } | null>(null);

function openReject(type: 'change' | 'quit', row: any) {
  rejectTarget.value = { type, id: row.applyId };
  rejectReason.value = '';
  rejectVisible.value = true;
}

async function submitReject() {
  if (!rejectReason.value.trim()) {
    ElMessage.warning('请填写驳回原因');
    return;
  }
  saving.value = true;
  try {
    if (rejectTarget.value?.type === 'change') {
      await rejectChange(rejectTarget.value.id, rejectReason.value.trim());
    } else if (rejectTarget.value) {
      await rejectQuit(rejectTarget.value.id, rejectReason.value.trim());
    }
    ElMessage.success('已驳回');
    rejectVisible.value = false;
    loadApplies();
    loadApprovalStats();
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

/* ============ Tab 3：退宿名单 ============ */

const checkoutLoading = ref(false);
const exporting = ref(false);
const checkoutList = ref<any[]>([]);
const checkoutTotal = ref(0);

const checkoutQuery = reactive({
  page: 1,
  size: 10,
  className: undefined as string | undefined,
  building: undefined as string | undefined,
});

async function loadCheckouts() {
  checkoutLoading.value = true;
  try {
    const data = await fetchCheckoutList(checkoutQuery);
    checkoutList.value = data.list;
    checkoutTotal.value = data.total;
  } catch (e) {
    console.error(e);
  } finally {
    checkoutLoading.value = false;
  }
}

function resetCheckoutQuery() {
  checkoutQuery.page = 1;
  checkoutQuery.className = undefined;
  checkoutQuery.building = undefined;
  loadCheckouts();
}

async function handleExport() {
  exporting.value = true;
  try {
    const list = await exportCheckoutList({
      className: checkoutQuery.className,
      building: checkoutQuery.building,
    });
    if (!list.length) {
      ElMessage.warning('当前条件下没有可导出的数据');
      return;
    }
    downloadCsv(list);
    ElMessage.success(`已导出 ${list.length} 条`);
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    exporting.value = false;
  }
}

function downloadCsv(list: any[]) {
  const headers = ['申请人', '退宿宿舍', '床位号', '班级', '申请时间', '联系电话'];
  const rows = list.map((r) => [
    r.studentName,
    dormLabel(r.quitBuilding, r.quitRoom),
    r.quitBed,
    r.className,
    r.checkoutDate,
    r.phone,
  ]);
  // BOM 保证 Excel 打开中文不乱码
  const csv = '﻿' + [headers, ...rows].map((r) => r.map((c) => `"${c ?? ''}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '退宿名单.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ============ 导入 ============ */

const importVisible = ref(false);
const importing = ref(false);
const uploadRef = ref<UploadInstance>();
const pickedFile = ref<File | null>(null);
const importResult = ref<{ successCount: number; failCount: number; failures: any[] } | null>(null);

function handleFileChange(file: UploadFile) {
  importResult.value = null;
  pickedFile.value = file.raw ?? null;
}

function handleFileExceed(files: UploadFile[]) {
  uploadRef.value?.clearFiles();
  const raw = files[0] as unknown as UploadRawFile | undefined;
  if (raw) {
    uploadRef.value?.handleStart(raw);
    pickedFile.value = raw;
    importResult.value = null;
  }
}

function downloadTemplate() {
  window.location.href = '/api/edu/dorm/import-template';
}

async function handleImport() {
  if (!pickedFile.value) {
    ElMessage.warning('请先选择要导入的文件');
    return;
  }
  const form = new FormData();
  form.append('file', pickedFile.value);
  importing.value = true;
  try {
    const result = await http.post<any>('/api/edu/dorm/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    importResult.value = result;
    if (result.failCount === 0) ElMessage.success(`导入成功，共 ${result.successCount} 条`);
    else ElMessage.warning(`导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`);
    if (result.successCount > 0) {
      loadRooms();
      loadRoomStats();
    }
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    importing.value = false;
  }
}

function resetImport() {
  importResult.value = null;
  pickedFile.value = null;
  uploadRef.value?.clearFiles();
}

/* ============================================================
 * Tab 2：分派宿舍
 * ============================================================ */

const assignQuery = reactive({
  building: undefined as string | undefined,
  category: undefined as number | undefined,
  keyword: undefined as string | undefined,
});

const assignRows = ref<DormAssignClassRow[]>([]);
const assignLoading = ref(false);
const assignStats = ref<DormAssignStats>({
  assignedClasses: 0,
  assignedRooms: 0,
  unassignedRooms: 0,
  capacity: 0,
  occupied: 0,
});

/** 宿舍楼下拉复用主 Tab 已经从库里读好的那份，避免每次开弹窗都查一遍 */
const assignBuildingOptions = computed(() => allBuildings.value);

const assignStatsCards = computed(() => [
  { label: '已分派班级', value: assignStats.value.assignedClasses, icon: '班', bg: '#FDF4F2', color: '#CD3A33' },
  { label: '已分派宿舍', value: assignStats.value.assignedRooms, icon: '舍', bg: '#EBF5EF', color: '#5FA36F' },
  { label: '未分派宿舍', value: assignStats.value.unassignedRooms, icon: '闲', bg: '#FBF3E5', color: '#C9852E' },
  { label: '已分派床位', value: assignStats.value.capacity, icon: '床', bg: '#FDF4F2', color: '#CD3A33' },
]);

async function loadAssign() {
  assignLoading.value = true;
  try {
    assignRows.value = await fetchAssignList({ ...assignQuery });
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    assignLoading.value = false;
  }
}

async function loadAssignStats() {
  try {
    assignStats.value = await fetchAssignStats();
  } catch (e) {
    /* 拦截器已提示 */
  }
}

function resetAssignQuery() {
  assignQuery.building = undefined;
  assignQuery.category = undefined;
  assignQuery.keyword = undefined;
  loadAssign();
}

async function handleRemoveAssign(room: DormAssignRoom) {
  try {
    await ElMessageBox.confirm(
      `确定取消「${room.building} ${room.room}」的分派吗？`,
      '取消分派',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await removeAssign(room.assignId);
    ElMessage.success('已取消分派');
    await Promise.all([loadAssign(), loadAssignStats()]);
  } catch (e) {
    /* 拦截器已提示 */
  }
}

async function handleClearAssign(row: DormAssignClassRow) {
  if (!row.roomCount) {
    ElMessage.warning('该班级还没有分派宿舍');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定清空「${row.className}」的全部 ${row.roomCount} 间宿舍吗？`,
      '清空分派',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    const res = await clearAssign(row.className);
    ElMessage.success(`已清空 ${res.removed} 间宿舍`);
    await Promise.all([loadAssign(), loadAssignStats()]);
  } catch (e) {
    /* 拦截器已提示 */
  }
}

/* ============ 分派弹窗 ============ */

const assignVisible = ref(false);
const candidateLoading = ref(false);
const candidates = ref<DormAssignCandidate[]>([]);
const checkedRoomIds = ref<string[]>([]);

const assignForm = reactive({
  className: '',
  headTeacherName: '' as string | undefined,
});

const roomFilter = reactive({
  building: '' as string,
  keyword: '' as string,
  onlyFree: false,
});

const filterBuildings = computed(() => [...new Set(candidates.value.map((c) => c.building))].sort());

/** 弹窗里的候选宿舍：过滤后按楼栋分组 */
const groupedCandidates = computed(() => {
  const kw = roomFilter.keyword.trim().toLowerCase();
  const list = candidates.value.filter((c) => {
    if (roomFilter.building && c.building !== roomFilter.building) return false;
    // 别的班已经占了的宿舍也列出来（禁用 + 显示归属），方便看清整栋楼的分配情况
    if (roomFilter.onlyFree && c.assigned && c.assignedTo !== assignForm.className) return false;
    if (kw && !`${c.building} ${c.room} ${c.categoryName}`.toLowerCase().includes(kw)) return false;
    return true;
  });

  const groups: { building: string; rooms: DormAssignCandidate[] }[] = [];
  for (const c of list) {
    const g = groups.find((x) => x.building === c.building);
    if (g) g.rooms.push(c);
    else groups.push({ building: c.building, rooms: [c] });
  }
  return groups;
});

async function openAssign(row?: DormAssignClassRow) {
  assignVisible.value = true;
  candidateLoading.value = true;
  try {
    if (row?.className) {
      assignForm.className = row.className;
      assignForm.headTeacherName = row.headTeacherName || '';
    }
    // 一次拉全部宿舍；选了班的把它已有的勾选上
    candidates.value = await fetchAssignRooms({});
    await loadAssign();
    const mine = assignForm.className
      ? assignRows.value.find((r) => r.className === assignForm.className)
      : undefined;
    checkedRoomIds.value = mine ? mine.rooms.map((r) => r.roomId) : [];
    if (mine?.headTeacherName) assignForm.headTeacherName = mine.headTeacherName;
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    candidateLoading.value = false;
  }
}

function onAssignClassChange(className: string) {
  if (!className) {
    assignForm.headTeacherName = '';
    checkedRoomIds.value = [];
    return;
  }
  // 班主任直接从页面已有的分派数据里带出来
  const mine = assignRows.value.find((r) => r.className === className);
  assignForm.headTeacherName = mine?.headTeacherName || '';
  checkedRoomIds.value = mine ? mine.rooms.map((r) => r.roomId) : [];
}

async function submitAssign() {
  if (!assignForm.className) {
    ElMessage.warning('请选择班级');
    return;
  }
  saving.value = true;
  try {
    await replaceAssign({
      className: assignForm.className,
      headTeacherName: assignForm.headTeacherName || undefined,
      roomIds: checkedRoomIds.value,
    });
    ElMessage.success('分派已保存');
    assignVisible.value = false;
    await Promise.all([loadAssign(), loadAssignStats()]);
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

/* ============ 公共 ============ */

function dormLabel(building?: string, room?: string) {
  if (!building && !room) return '—';
  return `${building || ''} ${room || ''}`.trim();
}

function statusTagType(status: number) {
  if (status === 1) return 'warning';  // 待审核 → 橙
  if (status === 2) return 'success';  // 已同意 → 绿
  return 'danger';                     // 已驳回 → 红
}

function handleMainTabChange() {
  if (mainTab.value === 'list') {
    loadRooms();
    loadRoomStats();
  } else if (mainTab.value === 'assign') {
    loadAssign();
    loadAssignStats();
  } else if (mainTab.value === 'approval') {
    loadApplies();
    loadApprovalStats();
  } else {
    loadCheckouts();
  }
}

onMounted(() => {
  loadRooms();
  loadRoomStats();
  loadBuildingOptions();
  loadAllBuildings();
});
</script>

<style scoped>
.page-container {
  padding: 16px;
}

.main-tabs {
  background: #fff;
  padding: 0 16px;
  border-radius: 4px;
  margin-bottom: 12px;
}

.main-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.sub-tabs {
  margin: -8px 0 4px;
}

.sub-tabs :deep(.el-tabs__header) {
  margin-bottom: 8px;
}

/* === 统计卡片 === */
.stat-row {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.stat-card {
  flex: 1;
  min-width: 180px;
}

.stat-card :deep(.el-card__body) {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}

.stat-icon {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.stat-info {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.stat-num {
  font-size: 22px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stat-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.search-card {
  margin-bottom: 12px;
}

.search-card :deep(.el-form-item) {
  margin-bottom: 0;
}

/* ★ 2026-10-04：申请审批列表对齐「就业管理 → 调换/退宿申请」后新增的样式
   副标题（学号 / 性别 / 床位）、宿舍变动的 旧→新 箭头配色 —— 与就业侧保持一致 */
.sub-text {
  font-size: 12px;
  color: #A2938E;
  margin-top: 2px;
}

.dorm-from {
  color: #A2938E;
}

.dorm-to {
  color: #CD3A33;
  font-weight: 600;
}

.arrow {
  margin: 0 6px;
  color: #C4B8B2;
}

.toolbar {
  margin-bottom: 12px;
}

.table-card :deep(.el-card__body) {
  padding: 16px;
}

/* 空床位：灰底 + 斜体 + 虚线上边框（对应原型 emptyStyle） */
.table-card :deep(.empty-bed-cell) {
  background: #F6F3EF;
  color: #aaa;
  font-style: italic;
}

.table-card :deep(.empty-bed-cell .cell) {
  color: #aaa;
}

.empty-text {
  color: #999;
}

.reject-reason {
  color: var(--el-color-danger);
}

/* ===== 分派宿舍 ===== */
.assign-sub-table {
  margin: 4px 8px;
}

.mixed-count {
  color: var(--el-color-warning);
}

.room-tag {
  margin: 2px 4px 2px 0;
}

.assign-room-filter {
  margin-bottom: 4px;
}

.assign-room-box {
  max-height: 340px;
  overflow-y: auto;
  padding-right: 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 8px 12px;
}

.building-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 8px 0 4px;
}

.room-check-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px 0;
}

.room-check-grid :deep(.el-checkbox) {
  margin-right: 0;
}

.room-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.occ-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  margin-bottom: 12px;
}

.occ-title {
  font-weight: 600;
}

.occ-count {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.bed-note {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  border-left: 3px solid var(--el-color-primary);
  padding: 6px 10px;
  margin-bottom: 12px;
  border-radius: 2px;
}

.add-occ-btn {
  margin-top: 12px;
}

.import-result {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background-color: var(--el-fill-color-lighter);
}

.import-summary {
  margin: 0 0 10px;
  font-size: 13px;
}

.import-summary .ok {
  color: var(--el-color-success);
}

.import-summary .bad {
  color: var(--el-color-danger);
}
</style>
