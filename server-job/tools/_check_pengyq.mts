/* pengyq portal active 复查 */
import mysql from 'mysql2/promise';
const c = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'xueguan123' });
const [r] = await c.query("SELECT account, active, user_name FROM sms_portal.t_sys_account WHERE account='pengyq'");
console.log('portal 复查:', JSON.stringify(r));
await c.end();
