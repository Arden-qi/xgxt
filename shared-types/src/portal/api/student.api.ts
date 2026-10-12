/**
 * 示例接口契约：学生管理
 *
 * ⚠️ 这是「接口契约」的写法示范，各模块照这个格式写自己的 xxx.api.ts
 */

import { ApiResponse, PageResponse, PageQuery } from '../common';
import { StudentListItem, StudentQuery, StudentSavePayload, Student } from '../student';

/* ============================================================
 * 接口 1：查询学生列表
 * 提供方：市场咨询（王寒逸）
 * 路径：  GET /api/consult/student/list
 * ============================================================ */

/** 响应用类型 */
export type StudentListResponse = PageResponse<StudentListItem>;

/* ============================================================
 * 接口 2：查询学生详情
 * 路径：  GET /api/consult/student/detail?id=xxx
 * ============================================================ */

export type StudentDetailResponse = ApiResponse<Student>;

/* ============================================================
 * 接口 3：新增学生
 * 路径：  POST /api/consult/student/add
 * ============================================================ */

export type StudentAddResponse = ApiResponse<{ id: string }>;

/* ============================================================
 * 接口 4：修改学生
 * 路径：  PUT /api/consult/student/update
 * ============================================================ */

export type StudentUpdateResponse = ApiResponse<null>;

/* ============================================================
 * 接口 5：删除学生（逻辑删除）
 * 路径：  DELETE /api/consult/student/delete/:id
 * ============================================================ */

export type StudentDeleteResponse = ApiResponse<null>;
