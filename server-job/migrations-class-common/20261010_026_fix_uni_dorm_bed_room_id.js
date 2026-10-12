/**
 * 第 4 期 · 第 1 批（宿舍域）· 迁移 026
 * ============================================================
 * 修 `t_uni_dorm_bed` 的 `dorm_id` 与 `room_id` 指向不同房间
 *
 * 【★ 先查清事实再动手（本轮最大的教训）】
 *   最初以为「两列语义相同，统一即可」，直接 UPDATE 就撞了唯一索引：
 *     `Duplicate entry 's5ec78b9…-2-class' for key 'uk_dorm_bed'`
 *   实测分组才发现**方向搞反了**：
 *     按 dorm_id 分组：4 个房间（A101/A102/A201/A202）**共用同一个 dorm_id**
 *     按 room_id 分组：4 个房间**各有自己的 room_id**
 *   → `room_id` 才是真正的房间主键（对应 `t_uni_dorm_room.id`），
 *     `dorm_id` 在种子里被写成了「楼栋级」的粗粒度值。
 *
 * 【症状】
 *   仓储 `syncBeds(dormId)` / `beds(dormId)` 按房间 id 查床位，
 *   但床位行的 `dorm_id` 存的不是房间 id → 查出来的床位数不对、
 *   建床位时唯一索引冲突，报错完全不指向数据不一致。
 *
 * 【修法：以 room_id 为准，反向覆盖 dorm_id】
 *   room_id 已经是每房间唯一（实测 4 房间 4 个 id），
 *   直接把它同步到 dorm_id / dorm_no，仓储的老接口不用改。
 *
 * 【只动数据，不动结构】
 *   反向覆盖后 `uk_dorm_bed(room_id, bed_no, edu_stage)` 才真正成立：
 *   同一房间同一床位号在同一学段内只有一行。
 */

exports.up = async function up(knex) {
  // 反向同步：room_id → dorm_id（room_id 才是房间主键）
  await knex('t_uni_dorm_bed')
    .whereNotNull('room_id')
    .andWhere('room_id', '<>', '')
    .andWhere('dorm_id', '<>', knex.ref('room_id'))
    .update({ dorm_id: knex.ref('room_id') });

  await knex('t_uni_dorm_bed')
    .whereNotNull('room_no')
    .andWhere('room_no', '<>', '')
    .andWhere('dorm_no', '<>', knex.ref('room_no'))
    .update({ dorm_no: knex.ref('room_no') });

  // 兜底：room_id 为空的行（理论上不该有）反向从 dorm_id 补
  await knex('t_uni_dorm_bed')
    .whereNotNull('dorm_id')
    .andWhere('dorm_id', '<>', '')
    .andWhere((b) => b.whereNull('room_id').orWhere('room_id', ''))
    .update({ room_id: knex.ref('dorm_id') });

  await knex('t_uni_dorm_bed')
    .whereNotNull('dorm_no')
    .andWhere('dorm_no', '<>', '')
    .andWhere((b) => b.whereNull('room_no').orWhere('room_no', ''))
    .update({ room_no: knex.ref('dorm_no') });
};

exports.down = async function down() {
  // 不可逆：原值已被覆盖，且原值本身就是错的数据。
  // 演示数据直接重跑种子脚本即可恢复。
};
