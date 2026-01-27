# 前端缓存系统

## 概述

本目录包含基于 IndexedDB 和 Web Workers 的前端缓存系统实现。该系统用于持久化存储 API 响应，减少网络请求，提升应用性能，并支持离线浏览功能。

## 架构设计

### 核心组件

1. **schema.ts** - IndexedDB 架构定义和类型接口
2. **cacheWorker.ts** - Web Worker 实现（已实现）
3. **CacheManager.ts** - 主线程缓存管理器（已实现）
4. **RequestDeduplicator.ts** - 请求去重器（已实现）
5. **InvalidationService.ts** - 缓存失效服务（已实现）

### 数据流

```
React 组件
    ↓
API 客户端
    ↓
缓存管理器 ←→ Web Worker ←→ IndexedDB
    ↓
网络请求
```

## IndexedDB 架构

### 数据库信息

- **数据库名称**: `douyin-cache`
- **版本**: `1`
- **对象存储**: `api-cache`

### 缓存记录结构

```typescript
interface CacheRecord {
  key: string;           // 主键：缓存键
  endpoint: string;      // API 端点（索引）
  data: any;            // 缓存数据
  timestamp: number;    // 时间戳（索引）
  version: number;      // 缓存版本（索引）
  size: number;         // 数据大小
  params?: object;      // 请求参数
}
```

### 索引

1. **endpoint** - 按 API 端点查询，用于批量失效
2. **timestamp** - 按时间排序，用于 LRU 清理
3. **version** - 按版本过滤，用于版本迁移

## 过期策略

不同端点有不同的缓存过期时间：

| 端点 | 过期时间 | 说明 |
|------|---------|------|
| `/api/resources` | 5 分钟 | 媒体资源列表 |
| `/api/authors` | 15 分钟 | 作者列表 |
| `/api/tags` | 15 分钟 | 标签列表 |
| `/api/config` | 1 小时 | 配置信息 |
| 其他 | 10 分钟 | 默认值 |

## 使用示例

### 创建缓存记录

```typescript
import { createCacheRecord } from './cache';

const record = createCacheRecord(
  'cache-key',
  '/api/resources',
  { items: [...], total: 100 },
  { page: 1, pageSize: 20 }
);
```

### 检查缓存是否过期

```typescript
import { isStale } from './cache';

if (isStale(entry)) {
  // 缓存已过期，需要刷新
}
```

### 检查版本是否有效

```typescript
import { isValidVersion } from './cache';

if (!isValidVersion(entry)) {
  // 版本不匹配，丢弃缓存
}
```

## 版本控制

### 缓存版本

- **当前版本**: `1`
- **何时递增**: API 响应格式发生变化时
- **影响**: 旧版本的缓存条目会被自动丢弃

### 数据库版本

- **当前版本**: `1`
- **何时递增**: IndexedDB 架构（表结构、索引）发生变化时
- **影响**: 需要提供迁移逻辑或清空数据库

## 开发计划

### 已完成

- ✅ IndexedDB 架构定义
- ✅ TypeScript 类型接口
- ✅ 缓存版本常量
- ✅ 辅助函数（过期检查、版本验证、大小估算）

### 待实现

- ⏳ 更深入的集成测试覆盖

## 相关文档

- [需求文档](../../../.kiro/specs/frontend-caching/requirements.md)
- [设计文档](../../../.kiro/specs/frontend-caching/design.md)
- [任务列表](../../../.kiro/specs/frontend-caching/tasks.md)
