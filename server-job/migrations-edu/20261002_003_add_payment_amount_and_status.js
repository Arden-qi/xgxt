/**
 * 缴费记录补「金额 / 缴费状态 / 凭证状态」三个字段
 *
 * 背景：即将到期页按缴费类别拆成四个子页（学费 / 住宿费 / 保险费 / 餐费），
 *       每行要展示 缴费金额、缴费状态（已缴/未缴）、凭证状态（已传/未传/被打回），
 *       原来 t_payment 只有「临期流转状态 exp_status」，没有这三个字段。
 *
 * 新增列：
 *   amount       decimal(10,2)  缴费金额
 *   pay_status   varchar(10)    已缴 / 未缴
 *   cert_status  varchar(10)    未传 / 已传 / 被打回
 *
 * 回填规则（保证四个类别子页都有各种状态，能看出按钮规则的效果）：
 *   金额   按类别给基准价（学费 5800 / 住宿费 1200 / 保险费 300 / 餐费 800）+ 小额浮动
 *   缴费   按 id 首字符散列，约 1/4 为「未缴」
 *   凭证   原 exp_status = 已上传 → 已传；其余 → 未传；再按比例挑一部分置为「被打回」，
 *          且每个类别至少保证 2 条被打回（否则某个子页永远看不到「重新上传」按钮）
 */

const TABLE = 't_payment';

/** 各类别基准金额 */
const BASE_AMOUNT = {
  学费: 5800,
  住宿费: 1200,
  保险费: 300,
  餐费: 800,
};

/** 按 id 取一个稳定的散列值，保证同一条记录每次回填结果一致 */
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h;
}

exports.up = async function up(knex) {
  const hasAmount = await knex.schema.hasColumn(TABLE, 'amount');
  if (!hasAmount) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.decimal('amount', 10, 2).nullable().comment('缴费金额');
    });
  }
  const hasPay = await knex.schema.hasColumn(TABLE, 'pay_status');
  if (!hasPay) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.string('pay_status', 10).nullable().comment('缴费状态：已缴 / 未缴');
    });
  }
  const hasCert = await knex.schema.hasColumn(TABLE, 'cert_status');
  if (!hasCert) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.string('cert_status', 10).nullable().comment('凭证状态：未传 / 已传 / 被打回');
    });
  }

  const rows = await knex(TABLE).select('id', 'category');

  // 先填金额和缴费状态（和凭证状态无关，逐条算即可）
  for (const r of rows) {
    const h = hash(String(r.id));
    const category = String(r.category || '');
    const base = BASE_AMOUNT[category] || 1000;
    // 浮动：学费 ±400，其余 ±5%，让金额看起来像真实收费
    const delta =
      category === '学费' ? ((h % 9) - 4) * 100 : Math.round((base * ((h % 11) - 5)) / 100);

    await knex(TABLE).where({ id: r.id }).update({
      amount: Number((base + delta).toFixed(2)),
      // 约 1/4 未缴
      pay_status: h % 4 === 0 ? '未缴' : '已缴',
    });
  }

  /**
   * 凭证状态按【类别】分配，而不是纯随机 ——
   * 随机容易让某个子页一条「被打回」都没有，页面上看不出按钮规则的效果。
   * 规则（每个类别内部按 id 排序，结果稳定可复现）：
   *   前 15%（至少 1 条）→ 已传
   *   接下来 20%（至少 2 条）→ 被打回（必须是已缴，没缴过的凭证谈不上被打回）
   *   其余 → 未传
   */
  const categories = [...new Set(rows.map((r) => String(r.category || '')))].filter(Boolean);
  for (const c of categories) {
    const ids = rows
      .filter((r) => String(r.category || '') === c)
      .map((r) => String(r.id))
      .sort();
    const n = ids.length;
    const nUploaded = Math.max(1, Math.round(n * 0.15));
    const nRejected = Math.max(2, Math.round(n * 0.2));

    for (let i = 0; i < n; i += 1) {
      let certStatus = '未传';
      if (i < nUploaded) certStatus = '已传';
      else if (i < nUploaded + nRejected) certStatus = '被打回';

      // 已传 / 被打回 都隐含「已经缴过」，这里把缴费状态对齐，避免出现矛盾数据
      const patch =
        certStatus === '未传' ? { cert_status: certStatus } : { cert_status: certStatus, pay_status: '已缴' };

      await knex(TABLE).where({ id: ids[i] }).update(patch);
    }
  }

  // exp_status 与 cert_status 保持一致，避免两套状态互相矛盾
  await knex(TABLE).where({ cert_status: '已传' }).update({ exp_status: '已上传' });
  await knex(TABLE).where({ cert_status: '被打回' }).update({ exp_status: '待上传' });
  await knex(TABLE).where({ cert_status: '未传' }).update({ exp_status: '待通知' });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable(TABLE, (t) => {
    t.dropColumn('amount');
    t.dropColumn('pay_status');
    t.dropColumn('cert_status');
  });
};
