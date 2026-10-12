/* ============================================================
 * 假人员 ID → 真门户账号 UUID 全量迁移
 * 斌哥 2026-10-08 拍板：
 *   · 实训阶段班主任由项目经理担任 → T001~T004 与 P001~P004 都归 sunjl
 *   · 教员 T101/T102 → chenxf；助教 T103/T104 → zhaomx
 *   · 就业老师 J001~J004 → zhouj
 *   · sms_common.t_class_urge_sync（只读副本）不动
 * ============================================================ */
const knex = require('knex');
const fs = require('fs');
const DRY = process.argv.includes('--dry');   // 干跑模式：只统计不写库
const env = fs.readFileSync('.env','utf8');
const get = (k) => { const m = env.match(new RegExp('^'+k+'=(.*)$','m')); return m? m[1].trim() : undefined; };
const conf = (database) => ({client:'mysql2',connection:{host:get('DB_HOST'),port:+(get('DB_PORT')||3306),user:get('DB_USER'),password:get('DB_PASSWORD'),database}});

const SUNJL = '9155ddf7-0c39-4b7c-a4cf-f0d007dcc773';  // 孙建龙 项目经理/班主任
const CHENXF = '8a26837d-34af-4387-8afe-59dd32cfe8cf';  // 陈晓峰 教员
const ZHAOMX = 'f602a3e4-cd91-46d9-a399-50f70b4f3026';  // 赵梦雪 助教
const ZHOUJ  = '3ac048b5-3866-47cb-b23a-b01fcd3d2b12';  // 周杰  就业老师

/** 值映射：旧ID → {id, name} */
const VALUE_MAP = {
  P001: {id:SUNJL, name:'孙建龙'}, P002: {id:SUNJL, name:'孙建龙'},
  P003: {id:SUNJL, name:'孙建龙'}, P004: {id:SUNJL, name:'孙建龙'},
  T001: {id:SUNJL, name:'孙建龙'}, T002: {id:SUNJL, name:'孙建龙'},
  T003: {id:SUNJL, name:'孙建龙'}, T004: {id:SUNJL, name:'孙建龙'},
  T101: {id:CHENXF, name:'陈晓峰'}, T102: {id:CHENXF, name:'陈晓峰'},
  T103: {id:ZHAOMX, name:'赵梦雪'}, T104: {id:ZHAOMX, name:'赵梦雪'},
  J001: {id:ZHOUJ, name:'周杰'}, J002: {id:ZHOUJ, name:'周杰'},
  J003: {id:ZHOUJ, name:'周杰'}, J004: {id:ZHOUJ, name:'周杰'},
};

/** 要迁移的表.列（列名以 _id 结尾，配对列 = 去掉 _id 加 _name） */
const TARGETS = {
  sms_job: [
    ['t_job_approval', ['applicant_id']],
    ['t_job_class', ['head_teacher_id','project_manager_id','employment_teacher_id','teacher_id','assistant_id']],
    ['t_job_dorm_change', ['head_teacher_id']],
    ['t_job_notice', ['receiver_id','sender_id']],
    ['t_job_refund', ['head_teacher_id']],
    ['t_job_student_leave', ['head_teacher_id']],
    ['t_job_training_handoff', ['source_head_teacher_id','head_teacher_id','operator_id']],
    ['t_student_base', ['head_teacher_id']],
  ],
  sms_class: [
    ['t_class_dorm_apply', ['applicant_id']],
    ['t_class_info', ['head_teacher_id','project_manager_id','employment_teacher_id','teacher_id','assistant_id']],
    ['t_class_stage_log', ['operator_id']],
    ['t_class_student', ['head_teacher_id','teacher_id','assistant_id','recruit_teacher_id','consult_teacher_id']],
    ['t_class_training_handoff', ['head_teacher_id','teacher_id','operator_id']],
  ],
};
// ⚠️ t_job_approval_log.operator_id / t_job_training_handoff.operator_id 里混着 U_SUPER_TEST，不在映射表里 → 自动跳过

let grand = 0;
(async()=>{
  for (const [d, tabs] of Object.entries(TARGETS)) {
    const db = knex(conf(d));
    console.log(`\n########## ${d} ##########`);
    for (const [t, cols] of tabs) {
      let allCols;
      try { allCols = (await db.raw(`SHOW COLUMNS FROM \`${t}\``))[0].map(c=>c.Field); } catch(e){ console.log(`  ${t}: 表不存在，跳过`); continue; }
      for (const col of cols) {
        if (!allCols.includes(col)) { console.log(`  ${t}.${col}: 列不存在，跳过`); continue; }
        const nameCol = col.replace(/_id$/,'_name');
        const hasName = allCols.includes(nameCol);
        for (const [oldId, m] of Object.entries(VALUE_MAP)) {
          const cntRow = await db(t).where('is_deleted',0).where(col, oldId).count('* as n').first();
          const n = Number(cntRow.n);
          if (!n) continue;
          grand += n;
          console.log(`  ${t}.${col}: ${oldId} → ${m.name}(${m.id.slice(0,8)}…)  ${n} 行${DRY?'  [DRY]':''}`);
          if (!DRY) {
            const upd = { [col]: m.id };
            if (hasName) upd[nameCol] = m.name;
            await db(t).where(col, oldId).update(upd);
          }
        }
      }
    }
    await db.destroy();
  }
  console.log(`\n===== 合计 ${grand} 行${DRY?'（干跑，未写库）':'已迁移'} =====`);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)});
