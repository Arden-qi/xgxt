-- MySQL dump 10.13  Distrib 8.4.9, for Win64 (x86_64)
--
-- Host: localhost    Database: sms_portal
-- ------------------------------------------------------
-- Server version	8.4.9

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `sms_portal`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `sms_portal` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `sms_portal`;

--
-- Table structure for table `knex_migrations`
--

DROP TABLE IF EXISTS `knex_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `knex_migrations` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) DEFAULT NULL,
  `batch` int DEFAULT NULL,
  `migration_time` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `knex_migrations`
--

LOCK TABLES `knex_migrations` WRITE;
/*!40000 ALTER TABLE `knex_migrations` DISABLE KEYS */;
INSERT INTO `knex_migrations` VALUES (1,'20261002_001_create_sys_account.js',1,'2026-10-02 12:40:36'),(2,'20261002_002_seed_sys_account.js',1,'2026-10-02 12:40:36'),(3,'20261003_003_grant_perm_module.js',2,'2026-10-03 10:51:22'),(4,'20261003_004_restore_seed_accounts.js',3,'2026-10-03 12:17:09');
/*!40000 ALTER TABLE `knex_migrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `knex_migrations_lock`
--

DROP TABLE IF EXISTS `knex_migrations_lock`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `knex_migrations_lock` (
  `index` int unsigned NOT NULL AUTO_INCREMENT,
  `is_locked` int DEFAULT NULL,
  PRIMARY KEY (`index`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `knex_migrations_lock`
--

LOCK TABLES `knex_migrations_lock` WRITE;
/*!40000 ALTER TABLE `knex_migrations_lock` DISABLE KEYS */;
INSERT INTO `knex_migrations_lock` VALUES (1,0);
/*!40000 ALTER TABLE `knex_migrations_lock` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `t_sys_account`
--

DROP TABLE IF EXISTS `t_sys_account`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `t_sys_account` (
  `id` varchar(36) NOT NULL COMMENT '主键UUID',
  `create_time` datetime NOT NULL COMMENT '创建时间',
  `create_by` varchar(36) DEFAULT NULL COMMENT '创建人ID',
  `create_by_name` varchar(50) DEFAULT NULL COMMENT '创建人姓名',
  `update_time` datetime DEFAULT NULL COMMENT '修改时间',
  `update_by` varchar(36) DEFAULT NULL COMMENT '修改人ID',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '逻辑删除',
  `account` varchar(50) NOT NULL COMMENT '登录账号',
  `password` varchar(100) NOT NULL COMMENT '密码（演示环境明文）',
  `user_name` varchar(50) NOT NULL COMMENT '姓名',
  `kind` varchar(20) NOT NULL DEFAULT 'module_owner' COMMENT '主身份',
  `title` varchar(50) DEFAULT NULL COMMENT '头衔（展示用）',
  `dept` varchar(50) DEFAULT NULL COMMENT '所属部门',
  `phone` varchar(20) DEFAULT NULL COMMENT '联系电话',
  `modules` varchar(500) NOT NULL DEFAULT '[]' COMMENT '可访问模块key列表(JSON)',
  `active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `last_login` datetime DEFAULT NULL COMMENT '最近登录时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sa_account` (`account`),
  KEY `idx_sa_kind` (`kind`),
  KEY `idx_sa_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='全系统统一账号表（门户登录用）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `t_sys_account`
--

LOCK TABLES `t_sys_account` WRITE;
/*!40000 ALTER TABLE `t_sys_account` DISABLE KEYS */;
INSERT INTO `t_sys_account` VALUES ('0e3fc0db-b0de-7bdc-0194-a3a7f126df0d','2026-09-02 10:16:00','seed','系统种子',NULL,NULL,0,'zhangls','123456','张老师','module_owner','咨询师','市场咨询部','13800000033','[\"consult\"]',1,'2026-10-06 22:22:34'),('1d20dc8b-825f-e496-35c4-82585029ef8a','2026-09-02 10:20:00','seed','系统种子',NULL,NULL,0,'liukj','123456','刘会计','module_owner','财务专员','财务部','13800000055','[\"finance\"]',1,'2026-10-06 22:22:34'),('247ac904-bfa3-4d73-bb63-744a56b94bd1','2026-10-06 20:07:42','seed','门户账号种子',NULL,NULL,0,'sunmin','123456','孙敏','module_owner','班主任','初高中部','13800000132','[\"class-jh\"]',1,'2026-10-06 23:26:41'),('31405408-2041-e9b3-9844-427a5df70a49','2026-09-02 10:10:00','seed','系统种子',NULL,NULL,0,'lilx','123456','李老师','module_owner','咨询师','市场咨询部','13800000022','[\"consult\"]',1,'2026-10-06 22:22:34'),('3ac048b5-3866-47cb-b23a-b01fcd3d2b12','2026-10-06 20:07:42','seed','门户账号种子',NULL,NULL,0,'zhouj','123456','周杰','module_owner','就业老师','就业部','13800000121','[\"job\"]',1,'2026-10-06 22:43:45'),('43575dc6-50ef-05ec-b6b3-dee3cace36e2','2026-10-03 09:00:00','seed','系统种子',NULL,NULL,0,'linx','123456','林晓','module_owner','权限管理员','信息中心','13800000066','[\"perm\"]',1,'2026-10-07 00:08:07'),('580b3414-8b48-99b0-1f30-dde66d9ca8fe','2026-09-01 09:10:00','seed','系统种子',NULL,NULL,0,'wangjl','123456','王经理','module_owner','市场咨询经理','市场咨询部','13800000011','[\"consult\"]',1,'2026-10-06 22:22:34'),('85a47f05-6f96-4602-944e-d5c29b0154ae','2026-10-06 20:07:42','seed','门户账号种子',NULL,NULL,0,'zhanght','123456','张海涛','module_owner','班主任','大学部','13800000099','[\"class\"]',1,'2026-10-06 22:43:44'),('8a26837d-34af-4387-8afe-59dd32cfe8cf','2026-10-06 20:07:42','seed','门户账号种子',NULL,NULL,0,'chenxf','123456','陈晓峰','module_owner','教员','大学部','13800000141','[\"class\"]',1,'2026-10-06 22:43:44'),('9155ddf7-0c39-4b7c-a4cf-f0d007dcc773','2026-10-06 20:07:42','seed','门户账号种子',NULL,NULL,0,'sunjl','123456','孙建龙','module_owner','项目经理','实训教学部','13800000143','[\"job\"]',1,'2026-10-06 22:43:44'),('9250cefd-565a-4094-93c2-f185f0857e5a','2026-10-06 20:07:42','seed','门户账号种子',NULL,NULL,0,'qiansy','123456','钱守义','module_owner','校长','校长办公室','13800000077','[\"consult\",\"finance\",\"perm\",\"job\",\"edu\",\"class\",\"class-jh\"]',1,'2026-10-06 22:43:44'),('9e73138b-d35e-de46-9873-3836bed7cd60','2026-09-01 09:20:00','seed','系统种子','2026-10-03 19:57:30',NULL,0,'zhoum','123456','周铭','module_owner','财务负责人','财务部','13800000044','[\"finance\"]',1,'2026-10-07 00:08:08'),('c60aa8d6-43b6-4c67-b5ce-9a4f23029c34','2026-10-06 20:07:42','seed','门户账号种子',NULL,NULL,0,'zhengym','123456','郑一鸣','module_owner','教务老师','教务部','13800000110','[\"edu\",\"class-jh\"]',1,'2026-10-06 22:43:45'),('f602a3e4-cd91-46d9-a399-50f70b4f3026','2026-10-06 20:07:42','seed','门户账号种子',NULL,NULL,0,'zhaomx','123456','赵梦雪','module_owner','助教','大学部','13800000142','[\"class\"]',1,'2026-10-06 22:22:34'),('f67aa1f0-cbeb-3f59-2bb9-355e8530cf57','2026-09-01 09:00:00','seed','系统种子',NULL,NULL,0,'admin','123456','系统管理员','sys_admin','系统管理员','信息中心','13800000000','[\"consult\",\"finance\",\"perm\",\"job\",\"edu\",\"class\",\"class-jh\"]',1,'2026-10-06 22:43:44'),('fee4256c-1de5-4c3e-9a3e-3d02ac01c3ea','2026-10-06 20:07:42','seed','门户账号种子',NULL,NULL,0,'congym','123456','丛玉梅','module_owner','学管主任','学管部','13800000088','[\"job\",\"class\",\"class-jh\"]',1,'2026-10-06 22:45:36');
/*!40000 ALTER TABLE `t_sys_account` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-07  0:08:24
