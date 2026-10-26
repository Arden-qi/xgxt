import { db as portalDb } from '../src/portal/utils/db';
const a = await portalDb('t_sys_account').where('account', 'zhanght').first();
console.log(JSON.stringify({ account: a.account, password: a.password, pwd_algo: a.pwd_algo, title: a.title }, null, 1));
process.exit(0);
