/**
 * ★ 2026-10-05 排查：宿舍「同一个人被算成两次」到底怎么产生的
 *
 * 【背景】斌哥截图：宿舍总名单里「3号楼 301」显示两行，
 *   两行都有张子轩，且都是「1上/1-上」这张床 → 同一人同一床被算两次。
 *   已知方向：eduDorm.route.ts 的 merged = [...edu, ...job, ...class] **完全没去重**。
 *
 * 【三路的真实数据来源】（别猜表名，2026-10-05 踩过）
 *   · 教务sms_edu.t_edu_dorm_room + t_edu_dorm_bed   （有房间表+床位表）
 *   · 实训    sms_job.t_job_dorm    + t_job_dorm_bed（bed_no 存位置文本 1上/2下）
 *   · 大学部  **没有房间表**，从t_class_student 的
 *            dorm_building/dorm_no/bed_no 字段**动态聚合**出「间」
 *
 * 【本脚本回答三个问题】
 *   1. 三路各有多少「间」，同「楼栋+房号」重复的有几组？
 *   2. 重复的组里，**床位号写法是否一致**？（1上 vs 1-上 会影响合并口径）
 *   3. 同一个学号有没有**同时占多张床**（真·一人多床，是另一种 bug）
 *
 * 只读，不改任何数据。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const knex = require('knex')({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  },
});

/** 楼栋+房号 归一化：去空格、房号去前导 0（0301 与 301 视为同一间） */
const roomKey = (b, r) =>
  `${String(b || '').trim()}||${String(r || '').trim().replace(/^0+/, '')}`;
/** 床位号归一化：去掉 - _ 空格，1-上 与 1上 视为同一张床 */
const bedKey = (n) => String(n ?? '').replace(/[\s\-_]/g, '');

/** 与 eduDorm.route.ts 的 classBedNoOf 保持一致：纯数字 →「序号-上/下」 */
function classBedNoOf(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (!/^\d+$/.test(s)) return s;
  const n = Number(s);
  if (n <= 0) return s;
  return `${Math.ceil(n / 2)}-${n % 2 === 1 ? '上' : '下'}`;
}
/** 与 eduDorm.route.ts 的 jobBedNoOf 保持一致：纯数字 →「序号上/下」 */
function jobBedNoOf(v) {
  const s = String(v ?? '');
  if (/^\d+$/.test(s)) return `${Math.ceil(Number(s) / 2)}${Number(s) % 2 === 1 ? '上' : '下'}`;
  return s;
}

(async () => {
  // ---- 三路都归一成「间 → 床位数组」----
  const rooms = { edu: new Map(), job: new Map(), class: new Map() };

  // 教务：房间表 + 床位表
  const eduRooms = await knex('sms_edu.t_edu_dorm_room').where('is_deleted', false).select('*');
  const eduBeds = await knex('sms_edu.t_edu_dorm_bed').where('is_deleted', false).select('*');
  console.log(`教务: ${eduRooms.length} 间 / ${eduBeds.length} 床`);
  for (const r of eduRooms) {
    rooms.edu.set(r.id, {
      key: roomKey(r.building, r.room_no || r.room),
      id: r.id, cap: Number(r.capacity || r.bed_count), cat: r.category,
      beds: eduBeds.filter((b) => b.room_id === r.id).map((b) => ({
        raw: String(b.bed_no ?? ''), key: bedKey(b.bed_no),
        no: b.student_no || null, name: b.student_name || null,
      })),
    });
  }

  // 实训：房间表 + 床位表
  const jobRooms = await knex('t_job_dorm').where('is_deleted', false).select('*');
  const jobBeds = await knex('t_job_dorm_bed').where('is_deleted', false).select('*');
  console.log(`实训: ${jobRooms.length} 间 / ${jobBeds.length} 床`);
  for (const r of jobRooms) {
    rooms.job.set(r.id, {
      key: roomKey(r.building, r.room_no),
      id: r.id, cap: Number(r.bed_count), cat: r.dorm_gender,
      beds: jobBeds.filter((b) => b.dorm_id === r.id).map((b) => ({
        raw: String(b.bed_no ?? ''), key: bedKey(jobBedNoOf(b.bed_no)),
        no: b.student_no || null, name: b.student_name || null,
      })),
    });
  }

  // 大学部：从学生表动态聚合
  const clsStus = await knex('sms_class.t_class_student')
    .where('is_deleted', false).whereNotNull('dorm_no').whereNot('dorm_no', '').select('*');
  console.log(`大学部: ${clsStus.length} 名住宿舍的学生（无房间表，动态聚合）`);
  for (const s of clsStus) {
    const k = roomKey(s.dorm_building, s.dorm_no);
    if (!rooms.class.has(k)) rooms.class.set(k, { key: k, id: `class-${k}`, cap: 0, cat: 0, beds: [] });
    const text = classBedNoOf(s.bed_no);
    const r = rooms.class.get(k);
    r.cap = Math.max(r.cap, Number(s.bed_no) || 0, r.beds.length + 1);
    if (text && !r.beds.some((b) => b.key === bedKey(text))) {
      r.beds.push({ raw: String(s.bed_no), key: bedKey(text), no: s.student_no, name: s.student_name });
    }
  }

  // ---- 结论 1：同「楼栋+房号」跨库重复 ----
  const byRoomKey = new Map();
  for (const src of ['edu', 'job', 'class']) {
    for (const r of rooms[src].values()) {
      if (!byRoomKey.has(r.key)) byRoomKey.set(r.key, []);
      byRoomKey.get(r.key).push({ src, ...r });
    }
  }
  const dups = [...byRoomKey.entries()].filter(([, v]) => v.length > 1);
  const totalRooms = [...byRoomKey.keys()].length;
  const shownRows = [...byRoomKey.values()].reduce((a, v) => a + v.length, 0);
  console.log(`\n\n########## 结论 1 ##########`);
  console.log(`去重后应为 ${totalRooms} 间；现在实际渲染 ${shownRows} 行→ 多出 ${shownRows - totalRooms} 行`);
  console.log(`跨库重复的「楼栋+房号」= ${dups.length} 组`);
  dups.forEach(([k, v]) => {
    console.log(`\n【${k.replace('||', ' / ')}】来源: ${v.map((x) => x.src).join(' + ')}`);
    v.forEach(({ src, cap, beds }) => {
      console.log(`   [${src}] 容量=${cap} 床=[${beds.map((b) => `${b.raw}${b.name ? '(' + b.name + ')' : '(空)'}`).join(' ')}]`);
    });
  });

  // ---- 结论 2：床位号写法差异（决定合并能不能自动对齐）----
  console.log(`\n\n########## 结论 2：床位号写法 ##########`);
  const samples = new Set();
  for (const src of ['edu', 'job', 'class']) {
    for (const r of rooms[src].values()) for (const b of r.beds) samples.add(b.raw);
  }
  console.log(`全部原始写法: ${[...samples].sort().join(' | ')}`);

  // ---- 结论 3：同一学号占多床 ----
  console.log(`\n\n########## 结论 3：同一学号的床位记录 ##########`);
  const byNo = new Map();
  for (const src of ['edu', 'job', 'class']) {
    for (const r of rooms[src].values()) {
      for (const b of r.beds) {
        if (!b.no) continue;
        if (!byNo.has(b.no)) byNo.set(b.no, []);
        byNo.get(b.no).push({ src, room: r.key, bed: b.key, name: b.name });
      }
    }
  }
  const multi = [...byNo.entries()].filter(([, v]) => v.length > 1);
  console.log(`有多条记录的学号 = ${multi.length}`);
  multi.forEach(([no, v]) => {
    const uniq = new Set(v.map((x) => x.bed));
    const rooms2 = new Set(v.map((x) => x.room));
    const tag = uniq.size === 1 && rooms2.size === 1 ? '★同间同床重复 → 去重即可' : '⚠️跨间/跨床 → 需人工看';
    console.log(`  ${no} ${v[0].name}: [${v.map((x) => `${x.src}:${x.room.replace('||', '/')}/${x.bed}`).join(', ')}]  ${tag}`);
  });

  await knex.destroy();
})().catch(async (e) => { console.error(e); await knex.destroy(); process.exit(1); });
