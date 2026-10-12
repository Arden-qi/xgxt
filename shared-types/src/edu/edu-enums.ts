/**
 * 教务模块专属枚举（edu 命名空间）
 *
 * ⚠️ 设计说明：
 *   教务原来有自己的 enums.ts，里面 Gender / StudentStatus / ApplyStatus 等
 *   与我们主包的**取值完全一致**。为了避免出现「两套同名枚举、类型不兼容」，
 *   这里直接 **re-export 主包的 enums**（`export * from '../enums.js'`），
 *   教务代码从 `shared-types/edu` 拿到的就是主包的那一份 —— 全局只有一套类型。
 *
 *   只有【教务独有】的枚举才在本文件里新定义（目前只有「学习阶段 Stage」）。
 */

// ---- 复用主包的全部枚举与中文名映射（Gender / StudentStatus / ApplyStatus / …）----
export * from '../enums.js';

// ============================================================
// 教务独有：学习阶段
//
// ⚠️ 1~6 是初高中部，7~10 是大学部，两边含义不同，不要混用
//    （取自教务管理原型：初高中部=预科/初中部一~三期/高中部一~二期；大学部=第一~第四阶段）
// ============================================================

export enum Stage {
  // ---- 初高部（1~6）----
  PREP = 1,             // 预科阶段
  JUNIOR_1 = 2,         // 初中部一期
  JUNIOR_2 = 3,         // 初中部二期
  JUNIOR_3 = 4,         // 初中部三期
  SENIOR_1 = 5,         // 高中部一期
  SENIOR_2 = 6,         // 高中部二期
  // ---- 大学部（7~13）★ 2026-10-03 斌哥：改成「第一~第六阶段 + 实训」----
  UNIV_1 = 7,           // 第一阶段
  UNIV_2 = 8,           // 第二阶段
  UNIV_3 = 9,           // 第三阶段
  UNIV_4 = 10,          // 第四阶段
  UNIV_5 = 11,          // 第五阶段（新增）
  UNIV_6 = 12,          // 第六阶段（新增）
  TRAINING = 13,        // 实训（新增）
}

export const STAGE_NAME: Record<number, string> = {
  [Stage.PREP]: '预科阶段',
  [Stage.JUNIOR_1]: '初中部一期',
  [Stage.JUNIOR_2]: '初中部二期',
  [Stage.JUNIOR_3]: '初中部三期',
  [Stage.SENIOR_1]: '高中部一期',
  [Stage.SENIOR_2]: '高中部二期',
  [Stage.UNIV_1]: '第一阶段',
  [Stage.UNIV_2]: '第二阶段',
  [Stage.UNIV_3]: '第三阶段',
  [Stage.UNIV_4]: '第四阶段',
  [Stage.UNIV_5]: '第五阶段',
  [Stage.UNIV_6]: '第六阶段',
  [Stage.TRAINING]: '实训',
};

/** 初高部的学习阶段（预科 / 初中一~三期 / 高中一~二期） */
export const STAGE_RANGE_HIGH = [1, 2, 3, 4, 5, 6];
/** 大学部的学习阶段（第一~第六阶段 + 实训） ★ 2026-10-03 扩展 */
export const STAGE_RANGE_UNIV = [7, 8, 9, 10, 11, 12, 13];
