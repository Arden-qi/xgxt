/* 备份：把将被迁移的表原样导出成 INSERT 语句（纯 JS，不依赖 mysqldump） */
const knex = require('knex');
const fs = require('fs');
const path = require('path');
const env = fs.readFileSync('.env','utf8');
const get = (k) => { const m = env.match(new RegExp('^'+k+'=(.*)$','m')); return m? m[1].trim() : undefined; };
const conf = (database) => ({client:'mysql2',connection:{host:get('DB_HOST'),port:+(get('DB_PORT')||3306),user:get('DB_USER'),password:get('DB_PASSWORD'),database,multipleStatements:false}});

// 需要备份的表（按扫描结果）
const TARGETS = {
  sms_job: ['t_job_approval','t_job_approval_log','t_job_class','t_job_dorm_change','t_job_notice','t_job_refund','t_job_student_leave','t_job_training_handoff','t_student_base'],
  sms_class: ['t_class_dorm_apply','t_class_info','t_class_stage_log','t_class_student','t_class_training_handoff'],
  sms_common: ['t_class_urge_sync'],
};
const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return `'${v.toISOString().slice(0,19).replace('T',' ')}'`;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
  return `'${String(v).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r')}'`;
};
(async()=>{
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'');
  const dir = path.join('..','数据库备份', `迁移前-${stamp}`);
  fs.mkdirSync(dir, {recursive:true});
  let total = 0;
  for (const [d, tabs] of Object.entries(TARGETS)) {
    const db = knex(conf(d));
    const out = [`-- 迁移前备份 ${d}  ${new Date().toISOString()}`];
    for (const t of tabs) {
      let rows;
      try { rows = await db(t); } catch(e){ out.push(`-- ${t}: SKIP (${e.message})`); continue; }
      if (!rows.length) { out.push(`-- ${t}: 0 行`); continue; }
      const cols = Object.keys(rows[0]);
      out.push(`\n-- ${t}: ${rows.length} 行`);
      out.push(`DELETE FROM \`${t}\`;`);
      for (const r of rows) {
        out.push(`INSERT INTO \`${t}\` (${cols.map(c=>'`'+c+'`').join(',')}) VALUES (${cols.map(c=>esc(r[c])).join(',')});`);
      }
      total += rows.length;
    }
    fs.writeFileSync(path.join(dir, `${d}.sql`), out.join('\n'), 'utf8');
    console.log(`${d}: ${tabs.length} 表已导出`);
    await db.destroy();
  }
  console.log(`\n总行数=${total}\n备份目录=${path.resolve(dir)}`);
})().catch(e=>{console.error('FATAL',e.message);process.exit(0)});
