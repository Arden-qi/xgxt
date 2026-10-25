<script setup lang="ts">
/**
 * 账号详情弹窗（可复用）
 *
 * 【为什么抽成组件】
 *   「账号详情」有三处入口，原先只有账号管理里是对的，另外两处都只是 router.push
 *   跳回列表页、不打开详情：
 *     · 账号管理  · 列表 → 查看 / 点姓名
 *     · 部门管理  · 部门下账号弹窗 → 详情 / 编辑
 *     · 职位管理  · 查看职位下人员弹窗 → 账号详情
 *   抽出来之后三处共用同一个弹窗，内容一致（基本信息 + 所属职位 + 有效权限明细），
 *   以后再改「详情里该显示什么」只改这一处。
 *
 * 【自取数据】调用方只要给 userId（可选再给一行列表数据做首屏秒开）：
 *   detail + 权限模块树 + 各职位权限映射 全在本组件内拉取。
 *
 * ★ 2026-10-23 按用户要求：「所属职位」表格的「操作」列已**整列删除**
 *   （原为「查看权限 / 编辑权限」两个就地弹权限树的入口）。
 *   用户口径：账号详情里不要这两个操作，也不要「操作」这一列 —— 三处入口共用本组件，
 *   故账号管理 / 部门管理（部门下账号弹窗）/ 职位管理（职位下人员 → 账号详情）
 *   一次性全部去掉。要看 / 改职位权限，请走「职位权限分配」页。
 *
 * ★ 2026-10-19 起：底部「去编辑」按钮已**彻底删除**（用户最终要求：不要这个按钮）。
 *   删之前它是可关的，三处入口按三轮要求逐个关掉 ——
 *     · 账号管理：列表行操作里本来就有独立的「编辑」，底部再来一个是重复入口；
 *     · 职位管理：「职位下人员」弹窗也一并去掉；
 *     · 部门管理：最后一处，用户第三轮要求删除。
 *   三处都关了之后开关本身成了死代码，遂连同 prop / emit 一起删掉，
 *   底部只剩「关闭」。
 *
 *   ⚠️ 想改账号，走各页列表行操作的「编辑」：
 *     · 账号管理、部门管理（部门下账号弹窗）都有行级「编辑」；
 *     · 职位管理的「职位下人员」弹窗没有行级编辑，要改得回「账号管理」。
 */
import { computed, ref, watch } from 'vue';
import type { PermModule, PermRoleListItem, PermUserListItem, RolePermMap } from 'shared-types/perm';
import ProtoDialog from './ProtoDialog.vue';
import { roleApi, userApi, menuApi } from '@/perm/api/perm';
import { roleIconOf } from '@/perm/utils/roleIcon';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** 要展示的账号 id（'' 时不请求） */
    userId: string;
    /** 列表行数据：先渲染、再补最新（可选） */
    fallback?: PermUserListItem | null;
  }>(),
  { fallback: null },
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
}>();

/* ============================================================
 * 模块级缓存：职位清单 / 权限模块树 ── 同一会话内只拉一次
 * ============================================================ */

let rolesCache: PermRoleListItem[] | null = null;
let modulesCache: PermModule[] | null = null;

async function loadRoles(): Promise<PermRoleListItem[]> {
  if (rolesCache) return rolesCache;
  try {
    const page = await roleApi.list({ page: 1, size: 100 });
    rolesCache = page.list || [];
  } catch {
    rolesCache = [];
  }
  return rolesCache;
}

async function loadModules(): Promise<PermModule[]> {
  if (modulesCache) return modulesCache;
  try {
    modulesCache = await menuApi.tree();
  } catch {
    modulesCache = [];
  }
  return modulesCache;
}

/* ============================================================
 * 小工具
 * ============================================================ */

/** 极简 HTML 转义（标题走 v-html，姓名是用户输入） */
function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** 权限映射 key（与后端 perm.service.permKey 完全一致） */
const permKey = (moduleKey: string, itemName: string): string => `${moduleKey}||${itemName}`;

const roleIcon = roleIconOf;

/* ============================================================
 * 主状态
 * ============================================================ */

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const detail = ref<PermUserListItem | null>(null);
const detailLoading = ref(false);
const permLoading = ref(false);
const allRoles = ref<PermRoleListItem[]>([]);
const modules = ref<PermModule[]>([]);

/**
 * 部门展示名：改成「教学部-初中部」这种带上级的完整路径
 *
 * 【为什么不用 detail.deptName】
 *   账号创建时选的是**具体学段**（初中部 / 高中部 / 大学部 / 实训管理 / 就业管理），
 *   但 deptName 只有自己那一级 ——「初中部」单看不出是教学部还是谁的。
 *   后端已在列表项里带出 deptPath（按部门树一路向上拼），这里优先用它，
 *   老接口 / 老缓存没这个字段时退回 deptName，不至于显示空白。
 */
const deptLabel = computed(() => {
  const d = detail.value;
  if (!d) return '—';
  return d.deptPath || d.deptName || '—';
});

/** 职位 id → 该职位权限映射（按需拉、拉过就缓存） */
const rolePerms = ref<Record<string, RolePermMap>>({});

/**
 * ★ 2026-10-25 账号是否处于停用状态。
 *
 *   「所属职位」表格的「状态」列原来直接摆职位自身的启用状态 —— 账号都停用了，
 *   职位行还挂着绿色「启用」，看起来像详情页状态没同步（用户截图指出的问题）。
 *   实际口径应该是【有效状态】：账号停用后，该账号名下所有职位都不可用，
 *   状态列一律按「停用（账号已停用）」展示；账号正常时才显示职位自身状态。
 *   这是展示逻辑修正，对所有账号（现有 + 以后新增）一律生效。
 */
const accountDisabled = computed(() => String(detail.value?.userStatus || '') === '已停用');

const detailTitle = computed(() => {
  const d = detail.value;
  if (!d) return '账号详情';
  return `账号详情 · <span class="em">${esc(d.userName)}</span> <span class="tag n">${esc(String(d.userStatus))}</span>`;
});

/** 所属职位：元数据优先取职位清单（含权限数 / 状态） */
interface DetailRole {
  id: string;
  roleName: string;
  permCount: number;
  roleStatus: string;
  icon: string;
}

const detailRoles = computed<DetailRole[]>(() => {
  const d = detail.value;
  if (!d) return [];
  return (d.roleIds || []).map((id, i) => {
    const r = allRoles.value.find((x) => x.id === id);
    if (r) {
      return {
        id,
        roleName: r.roleName,
        permCount: r.permCount,
        roleStatus: r.roleStatus,
        icon: roleIcon(r),
      };
    }
    return {
      id,
      roleName: (d.roleNames || [])[i] || '—',
      permCount: 0,
      roleStatus: '启用',
      icon: '👤',
    };
  });
});

/** 多职位权限并集 */
function mergedMap(ids: string[]): RolePermMap {
  const out: RolePermMap = {};
  (ids || []).forEach((id) => {
    const m = rolePerms.value[id];
    if (!m) return;
    Object.keys(m).forEach((k) => {
      out[k] = Array.from(new Set([...(out[k] || []), ...(m[k] || [])]));
    });
  });
  return out;
}

function actionCount(map: RolePermMap): number {
  return Object.values(map).reduce((a, b) => a + b.length, 0);
}

interface CardRow {
  name: string;
  actions: string[];
}
interface ModuleCard {
  key: string;
  icon: string;
  name: string;
  rows: CardRow[];
  total: number;
}

function moduleCards(map: RolePermMap): ModuleCard[] {
  return modules.value.map((m) => {
    const rows: CardRow[] = [];
    m.items.forEach((it) => {
      const codes = map[permKey(m.moduleKey, it.itemName)] || [];
      if (!codes.length) return;
      rows.push({
        name: it.itemName,
        actions: codes.map((c) => it.actions.find((a) => a.actionCode === c)?.actionName || c),
      });
    });
    return { key: m.moduleKey, icon: m.moduleIcon, name: m.moduleName, rows, total: m.items.length };
  });
}

/** 详情卡片上的「有效权限动作」总数（并集去重后的动作数） */
const effectivePermCount = computed(() => actionCount(mergedMap(detail.value?.roleIds || [])));

/**
 * ★ 2026-10-23：只列**真有动作**的板块。
 *
 *   原来把权限树的 5 个板块全铺出来，没有动作的显示「❌ 无权限」。
 *   用户因此以为「咨询经理的账号详情里还有财务管理」—— 明明写着 0/6，
 *   但那是因为动作行历史残留（已按 assignScope 过滤掉）。
 *   现在空板块不再渲染：「有效权限明细」只呈现这个人**实际拥有**的东西。
 */
const detailCards = computed<ModuleCard[]>(() =>
  detail.value
    ? moduleCards(mergedMap(detail.value.roleIds)).filter((m) => m.rows.length > 0)
    : [],
);

/** 确保这些职位的权限映射已在本地 */
async function ensureRolePerms(ids: string[]): Promise<void> {
  const missing = (ids || []).filter((id) => !rolePerms.value[id]);
  if (!missing.length) return;
  await Promise.all(
    missing.map(async (id) => {
      try {
        const d = await roleApi.detail(id);
        rolePerms.value[id] = d.perms || {};
      } catch {
        rolePerms.value[id] = {};
      }
    }),
  );
}

/** 拉详情（userId 变化 / 弹窗打开时） */
async function loadDetail(id: string): Promise<void> {
  if (!id) return;
  detailLoading.value = true;
  permLoading.value = true;
  try {
    let cur: PermUserListItem | null = props.fallback && props.fallback.id === id ? props.fallback : null;
    detail.value = cur;

    const [d, rs, ms] = await Promise.all([userApi.detail(id), loadRoles(), loadModules()]);
    allRoles.value = rs;
    modules.value = ms;
    // ⚠️ /user/detail 实际返回「列表项形态」（带 avatarText / effectivePermCount 等），
    //    但契约只声明了 PermUser + roleIds/roleNames —— 与列表行合并，两边都不丢。
    cur = { ...(cur || {}), ...d } as PermUserListItem;
    detail.value = cur;

    await ensureRolePerms(cur.roleIds || []);
  } catch {
    /* 已提示，沿用 fallback */
  } finally {
    detailLoading.value = false;
    permLoading.value = false;
  }
}

watch(
  () => [props.modelValue, props.userId] as const,
  ([on, id]) => {
    if (!on) return;
    detail.value = props.fallback && props.fallback.id === id ? props.fallback : null;
    void loadDetail(String(id || ''));
  },
  { immediate: true },
);

/* ★ 2026-10-23 按用户要求：本组件内「查看权限 / 编辑权限」入口（连同就地叠的
 *   PermTreeDialog 弹窗、openRolePerm / onTreeConfirm 及 tree* 状态）**全部删除**。
 *   用户口径：账号详情里不要这两个操作，连「操作」这一整列都不要。
 *   要看 / 改某职位权限，走「职位权限分配」页，不要在账号详情里再开一个口子。 */
</script>

<template>
  <ProtoDialog v-model="visible" :title="detailTitle" size="lg">
    <template v-if="detail">
      <!-- 头部 -->
      <div class="flex" style="gap: 13px; align-items: flex-start; margin-bottom: 14px">
        <div
          style="
            width: 54px;
            height: 54px;
            border-radius: 13px;
            background: linear-gradient(135deg, #E6A99C, #CD3A33);
            color: #fff;
            display: grid;
            place-items: center;
            font-size: 22px;
            font-weight: 600;
            flex: 0 0 auto;
          "
        >
          {{ detail.avatarText || (detail.userName || '').slice(0, 1) }}
        </div>
        <div style="flex: 1">
          <div style="font-size: 16px; font-weight: 600">
            {{ detail.userName }}
            <span v-if="detail.userStatus === '正常'" class="tag g">正常</span>
            <span v-else-if="detail.userStatus === '已停用'" class="tag gy">已停用</span>
            <span v-else class="tag d">{{ detail.userStatus }}</span>
            <span v-if="detail.needChangePwd" class="tag w">需首次改密</span>
          </div>
          <div class="desc" style="margin-top: 3px">
            {{ deptLabel }} · {{ (detail.roleNames || []).join('、') || '无职位' }}
          </div>
        </div>
        <div style="text-align: right; flex: 0 0 auto">
          <div style="font-size: 20px; font-weight: 700; color: var(--brand)">
            {{ effectivePermCount }}
          </div>
          <div class="desc">有效权限动作</div>
        </div>
      </div>

      <!-- 基本信息 -->
      <div class="sec-t"><span class="bar"></span>基本信息</div>
      <div class="fm" style="grid-template-columns: repeat(3, 1fr)">
        <div class="f"><label>姓名</label><div>{{ detail.userName }}</div></div>
        <div class="f"><label>性别</label><div>{{ detail.genderName || '—' }}</div></div>
        <div class="f"><label>年龄</label><div class="num">{{ detail.age || '—' }}</div></div>
        <div class="f">
          <label>登录账号</label>
          <div>
            <code style="background: #FBF7F4; padding: 2px 7px; border-radius: 4px">{{ detail.account }}</code>
          </div>
        </div>
        <div class="f"><label>手机号</label><div class="num">{{ detail.phone }}</div></div>
        <div class="f"><label>所属部门</label><div>{{ deptLabel }}</div></div>
        <div class="f"><label>账号状态</label><div>{{ detail.userStatus }}</div></div>
        <!-- ★ 2026-10-23 按用户要求删除「创建人」字段（原型遗留，业务上无用） -->
        <div class="f"><label>创建时间</label><div class="desc num">{{ detail.createTime }}</div></div>
        <div class="f"><label>最后登录</label><div class="desc num">{{ detail.lastLoginTime || '—' }}</div></div>
        <div class="f">
          <label>需首次改密</label>
          <div>{{ detail.needChangePwd ? '是' : '否' }}</div>
        </div>
      </div>

      <!-- 所属职位 -->
      <div class="divider"></div>
      <div class="sec-t">
        <span class="bar"></span>所属职位 <span class="desc">（可多职位，权限取并集）</span>
      </div>
      <!-- ★ 2026-10-23：「操作」整列删除（原「查看权限 / 编辑权限」） -->
      <table v-if="detailRoles.length" class="tb">
        <thead>
          <tr>
            <th>职位</th>
            <th>权限数</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in detailRoles" :key="r.id">
            <td><b>{{ r.icon }} {{ r.roleName }}</b></td>
            <td class="num">{{ r.permCount }} 项</td>
            <td>
              <!-- ★ 2026-10-25：账号已停用时按「有效状态」展示 —— 职位行统一「停用（账号已停用）」，
                   不再原样摆职位自身的启用状态（账号停用后职位实际不可用） -->
              <template v-if="accountDisabled">
                <span class="tag gy">停用</span>
                <div class="desc" style="font-size: 11px; margin-top: 2px">账号已停用</div>
              </template>
              <template v-else>
                <span v-if="r.roleStatus === '启用'" class="tag g">启用</span>
                <span v-else class="tag gy">停用</span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="notice d">✕<div>该账号未分配任何职位，无法登录系统。</div></div>

      <!-- 有效权限明细 -->
      <div class="divider"></div>
      <div class="sec-t"><span class="bar"></span>有效权限明细（合并结果）</div>
      <div v-if="permLoading || detailLoading" class="empty"><div class="ic">⏳</div>正在计算权限并集…</div>
      <div v-else-if="!detailCards.length" class="notice d">
        ✕<div>该账号所属职位还没有任何有效权限动作，请到「页面管理 → 职位」授权页面，再到「职位权限分配」勾动作。</div>
      </div>
      <div
        v-else
        style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px"
      >
        <div
          v-for="m in detailCards"
          :key="m.key"
          style="border: 1px solid var(--line); border-radius: 8px; padding: 9px 11px"
        >
          <div style="font-size: 12.5px; font-weight: 600; margin-bottom: 4px">
            {{ m.icon }} {{ m.name }} <span class="desc">{{ m.rows.length }}/{{ m.total }}</span>
          </div>
          <template v-if="m.rows.length">
            <div
              v-for="r in m.rows"
              :key="r.name"
              style="font-size: 11.5px; color: var(--tx2); margin-bottom: 3px"
            >
              <b style="color: var(--tx)">{{ r.name }}</b>：<span
                v-for="a in r.actions"
                :key="a"
                class="tag b"
                style="margin-right: 2px"
              >{{ a }}</span>
            </div>
          </template>
          <div v-else class="desc">❌ 无权限</div>
        </div>
      </div>
    </template>

    <div v-else class="empty"><div class="ic">⏳</div>加载中…</div>

    <template #footer>
      <div class="lft">账号 ID：{{ detail?.id || '—' }}</div>
      <!-- ★ 2026-10-19：底部「去编辑」按钮已彻底删除（三处入口全部要求去掉），
           只剩「关闭」。改账号请走列表行操作里的「编辑」。 -->
      <button class="btn pri" type="button" @click="visible = false">关闭</button>
    </template>
  </ProtoDialog>
</template>
