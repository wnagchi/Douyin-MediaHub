/**
 * 缓存 Web Worker
 * 
 * 在后台线程中处理所有 IndexedDB 缓存操作，避免阻塞主 UI 线程。
 * 实现消息协议以与主线程通信，处理缓存的 CRUD 操作、失效和统计。
 */

import {
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
  CACHE_VERSION,
  INDEX_ENDPOINT,
  INDEX_TIMESTAMP,
  INDEX_VERSION,
  type CacheRecord,
  type DatabaseSchema,
  DATABASE_SCHEMA,
  estimateSize,
  isValidVersion,
} from './schema';

// ============================================================================
// 消息协议类型定义
// ============================================================================

/**
 * Worker 消息类型
 */
export type WorkerMessageType =
  | 'init'        // 初始化 IndexedDB
  | 'get'         // 获取缓存条目
  | 'set'         // 设置缓存条目
  | 'delete'      // 删除缓存条目
  | 'clear'       // 清除所有缓存
  | 'invalidate'  // 按模式失效缓存
  | 'stats'       // 获取缓存统计
  | 'cleanup';    // 清理旧条目

/**
 * Worker 消息接口
 */
export interface WorkerMessage {
  /**
   * 消息 ID，用于关联请求和响应
   */
  id: string;

  /**
   * 消息类型
   */
  type: WorkerMessageType;

  /**
   * 消息负载数据
   */
  payload?: any;
}

/**
 * Worker 响应接口
 */
export interface WorkerResponse {
  /**
   * 对应的请求消息 ID
   */
  id: string;

  /**
   * 操作是否成功
   */
  success: boolean;

  /**
   * 响应数据（成功时）
   */
  data?: any;

  /**
   * 错误信息（失败时）
   */
  error?: string;
}

// ============================================================================
// 全局状态
// ============================================================================

/**
 * IndexedDB 数据库实例
 */
let db: IDBDatabase | null = null;

/**
 * 数据库是否已初始化
 */
let isInitialized = false;

/**
 * 初始化错误（如果有）
 */
let initError: string | null = null;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 发送响应消息到主线程
 * @param id 消息 ID
 * @param success 是否成功
 * @param data 响应数据
 * @param error 错误信息
 */
function sendResponse(
  id: string,
  success: boolean,
  data?: any,
  error?: string
): void {
  const response: WorkerResponse = {
    id,
    success,
    data,
    error,
  };
  self.postMessage(response);
}

/**
 * 发送成功响应
 * @param id 消息 ID
 * @param data 响应数据
 */
function sendSuccess(id: string, data?: any): void {
  sendResponse(id, true, data);
}

/**
 * 发送错误响应
 * @param id 消息 ID
 * @param error 错误信息
 */
function sendError(id: string, error: string): void {
  sendResponse(id, false, undefined, error);
}

/**
 * 获取对象存储
 * @param mode 事务模式
 * @returns 对象存储
 */
function getStore(mode: IDBTransactionMode): IDBObjectStore | null {
  if (!db) {
    return null;
  }
  try {
    const transaction = db.transaction([STORE_NAME], mode);
    return transaction.objectStore(STORE_NAME);
  } catch (error) {
    console.error('[CacheWorker] Failed to get store:', error);
    return null;
  }
}

// ============================================================================
// IndexedDB 初始化
// ============================================================================

/**
 * 初始化 IndexedDB 数据库
 * @param id 消息 ID
 */
function handleInit(id: string): void {
  // 如果已经初始化，直接返回成功
  if (isInitialized && db) {
    sendSuccess(id, { initialized: true });
    return;
  }

  // 如果之前初始化失败，返回错误
  if (initError) {
    sendError(id, initError);
    return;
  }

  // 打开数据库
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onerror = () => {
    const error = `Failed to open database: ${request.error?.message || 'Unknown error'}`;
    initError = error;
    sendError(id, error);
  };

  request.onsuccess = () => {
    db = request.result;
    isInitialized = true;
    sendSuccess(id, { initialized: true });
  };

  request.onupgradeneeded = (event) => {
    const database = (event.target as IDBOpenDBRequest).result;
    
    // 创建对象存储（如果不存在）
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      
      // 创建索引
      store.createIndex(INDEX_ENDPOINT, 'endpoint', { unique: false });
      store.createIndex(INDEX_TIMESTAMP, 'timestamp', { unique: false });
      store.createIndex(INDEX_VERSION, 'version', { unique: false });
    }
  };
}

// ============================================================================
// 缓存 CRUD 操作
// ============================================================================

/**
 * 获取缓存条目
 * @param id 消息 ID
 * @param payload 包含缓存键的负载
 */
function handleGet(id: string, payload: { key: string }): void {
  if (!db) {
    sendError(id, 'Database not initialized');
    return;
  }

  const { key } = payload;
  if (!key) {
    sendError(id, 'Cache key is required');
    return;
  }

  const store = getStore('readonly');
  if (!store) {
    sendError(id, 'Failed to access store');
    return;
  }

  const request = store.get(key);

  request.onerror = () => {
    sendError(id, `Failed to get cache entry: ${request.error?.message || 'Unknown error'}`);
  };

  request.onsuccess = () => {
    const record = request.result as CacheRecord | undefined;
    
    // 缓存未命中
    if (!record) {
      sendSuccess(id, null);
      return;
    }

    // 检查版本是否有效
    if (!isValidVersion(record)) {
      // 版本不匹配，删除旧条目并返回 null
      handleDelete(id, { key });
      return;
    }

    // 返回缓存条目
    sendSuccess(id, record);
  };
}

/**
 * 设置缓存条目
 * @param id 消息 ID
 * @param payload 包含缓存数据的负载
 */
function handleSet(id: string, payload: {
  key: string;
  endpoint: string;
  data: any;
  params?: Record<string, any>;
}): void {
  if (!db) {
    sendError(id, 'Database not initialized');
    return;
  }

  const { key, endpoint, data, params } = payload;
  if (!key || !endpoint || data === undefined) {
    sendError(id, 'Key, endpoint, and data are required');
    return;
  }

  const store = getStore('readwrite');
  if (!store) {
    sendError(id, 'Failed to access store');
    return;
  }

  // 创建缓存记录
  const record: CacheRecord = {
    key,
    endpoint,
    data,
    timestamp: Date.now(),
    version: CACHE_VERSION,
    size: estimateSize(data),
    params,
  };

  const request = store.put(record);

  request.onerror = () => {
    const errorMsg = request.error?.message || 'Unknown error';
    
    // 检查是否是配额超限错误
    if (request.error?.name === 'QuotaExceededError') {
      sendError(id, 'Storage quota exceeded');
    } else {
      sendError(id, `Failed to set cache entry: ${errorMsg}`);
    }
  };

  request.onsuccess = () => {
    sendSuccess(id, { key, timestamp: record.timestamp });
  };
}

/**
 * 删除缓存条目
 * @param id 消息 ID
 * @param payload 包含缓存键的负载
 */
function handleDelete(id: string, payload: { key: string }): void {
  if (!db) {
    sendError(id, 'Database not initialized');
    return;
  }

  const { key } = payload;
  if (!key) {
    sendError(id, 'Cache key is required');
    return;
  }

  const store = getStore('readwrite');
  if (!store) {
    sendError(id, 'Failed to access store');
    return;
  }

  const request = store.delete(key);

  request.onerror = () => {
    sendError(id, `Failed to delete cache entry: ${request.error?.message || 'Unknown error'}`);
  };

  request.onsuccess = () => {
    sendSuccess(id, { deleted: true });
  };
}

/**
 * 清除所有缓存条目
 * @param id 消息 ID
 */
function handleClear(id: string): void {
  if (!db) {
    sendError(id, 'Database not initialized');
    return;
  }

  const store = getStore('readwrite');
  if (!store) {
    sendError(id, 'Failed to access store');
    return;
  }

  const request = store.clear();

  request.onerror = () => {
    sendError(id, `Failed to clear cache: ${request.error?.message || 'Unknown error'}`);
  };

  request.onsuccess = () => {
    sendSuccess(id, { cleared: true });
  };
}

// ============================================================================
// 缓存失效
// ============================================================================

/**
 * 按模式失效缓存条目
 * @param id 消息 ID
 * @param payload 包含失效模式的负载
 */
function handleInvalidate(id: string, payload: {
  pattern?: string;
  endpoint?: string;
}): void {
  if (!db) {
    sendError(id, 'Database not initialized');
    return;
  }

  const { pattern, endpoint } = payload;
  
  const store = getStore('readwrite');
  if (!store) {
    sendError(id, 'Failed to access store');
    return;
  }

  // 如果指定了端点，使用端点索引
  if (endpoint) {
    const index = store.index(INDEX_ENDPOINT);
    const request = index.openCursor(IDBKeyRange.only(endpoint));
    const keysToDelete: string[] = [];

    request.onerror = () => {
      sendError(id, `Failed to invalidate cache: ${request.error?.message || 'Unknown error'}`);
    };

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const record = cursor.value as CacheRecord;
        keysToDelete.push(record.key);
        cursor.continue();
      } else {
        // 删除所有匹配的键
        deleteKeys(id, keysToDelete);
      }
    };
  } else if (pattern) {
    // 使用正则表达式模式匹配
    const regex = new RegExp(pattern);
    const request = store.openCursor();
    const keysToDelete: string[] = [];

    request.onerror = () => {
      sendError(id, `Failed to invalidate cache: ${request.error?.message || 'Unknown error'}`);
    };

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const record = cursor.value as CacheRecord;
        if (regex.test(record.endpoint) || regex.test(record.key)) {
          keysToDelete.push(record.key);
        }
        cursor.continue();
      } else {
        // 删除所有匹配的键
        deleteKeys(id, keysToDelete);
      }
    };
  } else {
    sendError(id, 'Either pattern or endpoint is required');
  }
}

/**
 * 批量删除缓存键
 * @param id 消息 ID
 * @param keys 要删除的键列表
 */
function deleteKeys(id: string, keys: string[]): void {
  if (!db) {
    sendError(id, 'Database not initialized');
    return;
  }

  if (keys.length === 0) {
    sendSuccess(id, { invalidated: 0 });
    return;
  }

  const store = getStore('readwrite');
  if (!store) {
    sendError(id, 'Failed to access store');
    return;
  }

  let completed = 0;
  let hasError = false;

  keys.forEach((key) => {
    const request = store.delete(key);

    request.onerror = () => {
      if (!hasError) {
        hasError = true;
        sendError(id, `Failed to delete key ${key}: ${request.error?.message || 'Unknown error'}`);
      }
    };

    request.onsuccess = () => {
      completed++;
      if (completed === keys.length && !hasError) {
        sendSuccess(id, { invalidated: keys.length });
      }
    };
  });
}

// ============================================================================
// 缓存统计
// ============================================================================

/**
 * 获取缓存统计信息
 * @param id 消息 ID
 */
function handleStats(id: string): void {
  if (!db) {
    sendError(id, 'Database not initialized');
    return;
  }

  const store = getStore('readonly');
  if (!store) {
    sendError(id, 'Failed to access store');
    return;
  }

  const request = store.openCursor();
  let totalEntries = 0;
  let totalSize = 0;
  const byEndpoint: Record<string, { entries: number; size: number }> = {};

  request.onerror = () => {
    sendError(id, `Failed to get stats: ${request.error?.message || 'Unknown error'}`);
  };

  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      const record = cursor.value as CacheRecord;
      totalEntries++;
      totalSize += record.size;

      if (!byEndpoint[record.endpoint]) {
        byEndpoint[record.endpoint] = { entries: 0, size: 0 };
      }
      byEndpoint[record.endpoint].entries++;
      byEndpoint[record.endpoint].size += record.size;

      cursor.continue();
    } else {
      // 所有条目已处理，发送统计信息
      sendSuccess(id, {
        totalEntries,
        storageSize: totalSize,
        byEndpoint,
      });
    }
  };
}

// ============================================================================
// 缓存清理
// ============================================================================

/**
 * 清理旧的缓存条目
 * @param id 消息 ID
 * @param payload 包含清理参数的负载
 */
function handleCleanup(id: string, payload?: {
  maxAge?: number;
  maxEntries?: number;
}): void {
  if (!db) {
    sendError(id, 'Database not initialized');
    return;
  }

  const { maxAge, maxEntries } = payload || {};
  const store = getStore('readwrite');
  if (!store) {
    sendError(id, 'Failed to access store');
    return;
  }

  // 使用时间戳索引按时间排序
  const index = store.index(INDEX_TIMESTAMP);
  const request = index.openCursor();
  const entries: Array<{ key: string; timestamp: number }> = [];

  request.onerror = () => {
    sendError(id, `Failed to cleanup cache: ${request.error?.message || 'Unknown error'}`);
  };

  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      const record = cursor.value as CacheRecord;
      entries.push({ key: record.key, timestamp: record.timestamp });
      cursor.continue();
    } else {
      // 所有条目已收集，执行清理
      const now = Date.now();
      const keysToDelete: string[] = [];

      // 按年龄清理
      if (maxAge) {
        entries.forEach((entry) => {
          if (now - entry.timestamp > maxAge) {
            keysToDelete.push(entry.key);
          }
        });
      }

      // 按数量清理（LRU）
      if (maxEntries && entries.length > maxEntries) {
        // 按时间戳排序（最旧的在前）
        entries.sort((a, b) => a.timestamp - b.timestamp);
        const toRemove = entries.length - maxEntries;
        for (let i = 0; i < toRemove; i++) {
          if (!keysToDelete.includes(entries[i].key)) {
            keysToDelete.push(entries[i].key);
          }
        }
      }

      // 删除标记的键
      if (keysToDelete.length > 0) {
        deleteKeys(id, keysToDelete);
      } else {
        sendSuccess(id, { cleaned: 0 });
      }
    }
  };
}

// ============================================================================
// 消息处理
// ============================================================================

/**
 * 处理来自主线程的消息
 */
self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const { id, type, payload } = event.data;

  // 验证消息格式
  if (!id || !type) {
    console.error('[CacheWorker] Invalid message format:', event.data);
    return;
  }

  try {
    switch (type) {
      case 'init':
        handleInit(id);
        break;

      case 'get':
        handleGet(id, payload);
        break;

      case 'set':
        handleSet(id, payload);
        break;

      case 'delete':
        handleDelete(id, payload);
        break;

      case 'clear':
        handleClear(id);
        break;

      case 'invalidate':
        handleInvalidate(id, payload);
        break;

      case 'stats':
        handleStats(id);
        break;

      case 'cleanup':
        handleCleanup(id, payload);
        break;

      default:
        sendError(id, `Unknown message type: ${type}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    sendError(id, `Worker error: ${errorMsg}`);
  }
});

// ============================================================================
// Worker 初始化
// ============================================================================

console.log('[CacheWorker] Worker initialized and ready');
