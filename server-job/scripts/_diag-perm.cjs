const mysql=require('mysql2/promise');
(async()=>{
 const c=await mysql.createConnection({host:'localhost',user:'root',password:'123456'});
 const [v]=await c.query(`SELECT VERSION() v`);
 console.log('MySQL/MariaDB 版本:', v[0].v);
 const [dbs]=await c.query(`SHOW DATABASES`);
 console.log('\n所有库:', dbs.map(r=>Object.values(r)[0]).join(', '));
 for(const db of ['sms_perm','sms_common','sms_class','sms_job','sms_class_jh']){
   try{
     const [t]=await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=? ORDER BY table_name`,[db]);
     console.log(`\n${db}: ${t.length} 张表`);
     if(t.length && t.length<=15) console.log('  '+t.map(r=>r.table_name||r.TABLE_NAME).join(', '));
   }catch(e){ console.log(`\n${db}: 查询失败 ${e.message}`); }
 }
 await c.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
