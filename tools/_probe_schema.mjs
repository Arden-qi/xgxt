/** 打印表结构 */
import mysql from '../server-job/node_modules/mysql2/promise.js';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../server-job/.env', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();

const conn = await mysql.createConnection({
  host: get('DB_HOST') || '127.0.0.1',
  port: Number(get('DB_PORT') || 3306),
  user: get('DB_USER'),
  password: get('DB_PASSWORD'),
});

const dbs = ['sms_perm', 'sms_portal'];
for (const d of dbs) {
  const [tables] = await conn.query(`show tables from ${d}`);
  console.log(`\n===== ${d} =====`);
  for (const t of tables) {
    const name = Object.values(t)[0];
    const [cols] = await conn.query(`show columns from ${d}.${name}`);
    console.log(`-- ${name}: ` + cols.map((c) => c.Field).join(', '));
  }
}
await conn.end();
