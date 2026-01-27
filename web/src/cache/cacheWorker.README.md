# 缓存 Worker 使用说明

## 概述

`cacheWorker.ts` 是一个在后台线程中运行的 Web Worker，负责处理所有 IndexedDB 缓存操作。它通过消息协议与主线程通信，避免阻塞 UI 线程。

## 消息协议

### 消息类型

Worker 支持以下消息类型：

- `init` - 初始化 IndexedDB 数据库
- `get` - 获取缓存条目
- `set` - 设置缓存条目
- `delete` - 删除缓存条目
- `clear` - 清除所有缓存
- `invalidate` - 按模式失效缓存
- `stats` - 获取缓存统计信息
- `cleanup` - 清理旧条目

### 消息格式

#### 请求消息

```typescript
interface WorkerMessage {
  id: string;              // 唯一消息 ID，用于关联请求和响应
  type: WorkerMessageType; // 消息类型
  payload?: any;           // 消息负载（可选）
}
```

#### 响应消息

```typescript
interface WorkerResponse {
  id: string;       // 对应的请求消息 ID
  success: boolean; // 操作是否成功
  data?: any;       // 响应数据（成功时）
  error?: string;   // 错误信息（失败时）
}
```

## 使用示例

### 1. 初始化 Worker

```typescript
// 创建 Worker 实例
const worker = new Worker(
  new URL('./cacheWorker.ts', import.meta.url),
  { type: 'module' }
);

// 初始化数据库
const initMessage: WorkerMessage = {
  id: 'init-1',
  type: 'init',
};

worker.postMessage(initMessage);

// 监听响应
worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
  if (event.data.id === 'init-1') {
    if (event.data.success) {
      console.log('数据库初始化成功');
    } else {
      console.error('初始化失败:', event.data.error);
    }
  }
});
```

### 2. 设置缓存条目

```typescript
const setMessage: WorkerMessage = {
  id: 'set-1',
  type: 'set',
  payload: {
    key: 'resources-page-1',
    endpoint: '/api/resources',
    data: { items: [...], total: 100 },
    params: { page: 1, pageSize: 20 },
  },
};

worker.postMessage(setMessage);
```

### 3. 获取缓存条目

```typescript
const getMessage: WorkerMessage = {
  id: 'get-1',
  type: 'get',
  payload: {
    key: 'resources-page-1',
  },
};

worker.postMessage(getMessage);

// 响应中的 data 字段包含缓存记录或 null（未命中）
```

### 4. 按端点失效缓存

```typescript
const invalidateMessage: WorkerMessage = {
  id: 'invalidate-1',
  type: 'invalidate',
  payload: {
    endpoint: '/api/resources', // 失效所有 resources 端点的缓存
  },
};

worker.postMessage(invalidateMessage);
```

### 5. 按正则表达式模式失效

```typescript
const invalidateMessage: WorkerMessage = {
  id: 'invalidate-2',
  type: 'invalidate',
  payload: {
    pattern: '^/api/(resources|authors)', // 失效匹配模式的缓存
  },
};

worker.postMessage(invalidateMessage);
```

### 6. 获取统计信息

```typescript
const statsMessage: WorkerMessage = {
  id: 'stats-1',
  type: 'stats',
};

worker.postMessage(statsMessage);

// 响应数据格式：
// {
//   totalEntries: 50,
//   storageSize: 1024000,
//   byEndpoint: {
//     '/api/resources': { entries: 30, size: 800000 },
//     '/api/authors': { entries: 20, size: 224000 }
//   }
// }
```

### 7. 清理旧条目

```typescript
// 按年龄清理
const cleanupMessage: WorkerMessage = {
  id: 'cleanup-1',
  type: 'cleanup',
  payload: {
    maxAge: 3600000, // 删除超过 1 小时的条目
  },
};

// 按数量清理（LRU）
const cleanupMessage2: WorkerMessage = {
  id: 'cleanup-2',
  type: 'cleanup',
  payload: {
    maxEntries: 100, // 只保留最新的 100 个条目
  },
};

worker.postMessage(cleanupMessage);
```

### 8. 清除所有缓存

```typescript
const clearMessage: WorkerMessage = {
  id: 'clear-1',
  type: 'clear',
};

worker.postMessage(clearMessage);
```

## 错误处理

Worker 会在以下情况返回错误响应：

1. **数据库未初始化** - 在调用其他操作前必须先初始化
2. **缺少必需参数** - 例如 get/set/delete 操作缺少 key
3. **IndexedDB 错误** - 数据库操作失败
4. **存储配额超限** - 浏览器存储空间不足
5. **未知消息类型** - 发送了不支持的消息类型

错误响应示例：

```typescript
{
  id: 'get-1',
  success: false,
  error: 'Database not initialized'
}
```

## 版本控制

Worker 会自动检查缓存条目的版本号。如果版本不匹配（例如 API 响应格式变化），旧条目会被自动删除。

当前缓存版本：`CACHE_VERSION = 1`

## 性能考虑

1. **批量操作** - 失效和清理操作会批量处理多个条目
2. **索引优化** - 使用 IndexedDB 索引加速按端点和时间戳的查询
3. **异步处理** - 所有操作都是异步的，不会阻塞主线程
4. **LRU 清理** - 支持按时间戳自动清理最旧的条目

## 注意事项

1. 必须先发送 `init` 消息初始化数据库
2. 每个消息必须有唯一的 ID 以关联请求和响应
3. Worker 在浏览器环境中运行，测试环境可能需要特殊配置
4. 存储配额由浏览器控制，超限时会返回错误

## 下一步

Worker 实现完成后，需要创建 `CacheManager` 类来封装 Worker 通信逻辑，提供更友好的 Promise API。
