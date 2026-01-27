/**
 * 缓存 Worker 集成测试
 * 
 * 测试 Web Worker 中的实际 IndexedDB 操作
 * 这些测试在真实的浏览器环境中运行，验证完整的缓存工作流
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { WorkerMessage, WorkerResponse } from './cacheWorker';
import {
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
  CACHE_VERSION,
  type CacheRecord,
} from './schema';

// ============================================================================
// 测试辅助函数
// ============================================================================

/**
 * 生成唯一的消息 ID
 */
function generateMessageId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 清理测试数据库
 */
async function cleanupDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn('Database deletion blocked');
      resolve(); // 继续测试
    };
  });
}

/**
 * 直接打开数据库（用于验证）
 */
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 直接从数据库读取记录
 */
async function getRecordFromDB(key: string): Promise<CacheRecord | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * 直接向数据库写入记录
 */
async function putRecordToDB(record: CacheRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * 统计数据库中的记录数
 */
async function countRecords(): Promise<number> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.count();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
}

// ============================================================================
// Worker 通信辅助函数
// ============================================================================

/**
 * 创建 Worker 实例并等待初始化
 */
async function createWorker(): Promise<Worker> {
  const worker = new Worker(
    new URL('./cacheWorker.ts', import.meta.url),
    { type: 'module' }
  );

  // 等待 worker 准备就绪
  await new Promise((resolve) => setTimeout(resolve, 100));

  return worker;
}

/**
 * 向 Worker 发送消息并等待响应
 */
async function sendWorkerMessage(
  worker: Worker,
  type: WorkerMessage['type'],
  payload?: any
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const id = generateMessageId();
    const timeout = setTimeout(() => {
      reject(new Error('Worker response timeout'));
    }, 5000);

    const handler = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id === id) {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        resolve(event.data);
      }
    };

    worker.addEventListener('message', handler);

    const message: WorkerMessage = { id, type, payload };
    worker.postMessage(message);
  });
}

// ============================================================================
// 集成测试套件
// ============================================================================

describe('CacheWorker 集成测试', () => {
  let worker: Worker;

  beforeEach(async () => {
    // 清理数据库
    await cleanupDatabase();
    
    // 创建新的 Worker 实例
    worker = await createWorker();
    
    // 初始化数据库
    const response = await sendWorkerMessage(worker, 'init');
    expect(response.success).toBe(true);
  });

  afterEach(() => {
    // 终止 Worker
    if (worker) {
      worker.terminate();
    }
  });

  // ==========================================================================
  // 基础 CRUD 操作测试
  // ==========================================================================

  describe('基础 CRUD 操作', () => {
    it('应该能够设置和获取缓存条目', async () => {
      const key = 'test-key-1';
      const endpoint = '/api/test';
      const data = { message: 'Hello, World!' };

      // 设置缓存
      const setResponse = await sendWorkerMessage(worker, 'set', {
        key,
        endpoint,
        data,
      });

      expect(setResponse.success).toBe(true);
      expect(setResponse.data).toHaveProperty('key', key);
      expect(setResponse.data).toHaveProperty('timestamp');

      // 获取缓存
      const getResponse = await sendWorkerMessage(worker, 'get', { key });

      expect(getResponse.success).toBe(true);
      expect(getResponse.data).not.toBeNull();
      expect(getResponse.data.key).toBe(key);
      expect(getResponse.data.endpoint).toBe(endpoint);
      expect(getResponse.data.data).toEqual(data);
      expect(getResponse.data.version).toBe(CACHE_VERSION);
    });

    it('获取不存在的缓存应返回 null', async () => {
      const response = await sendWorkerMessage(worker, 'get', {
        key: 'non-existent-key',
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeNull();
    });

    it('应该能够删除缓存条目', async () => {
      const key = 'test-key-2';
      const endpoint = '/api/test';
      const data = { value: 42 };

      // 设置缓存
      await sendWorkerMessage(worker, 'set', { key, endpoint, data });

      // 删除缓存
      const deleteResponse = await sendWorkerMessage(worker, 'delete', { key });

      expect(deleteResponse.success).toBe(true);
      expect(deleteResponse.data.deleted).toBe(true);

      // 验证已删除
      const getResponse = await sendWorkerMessage(worker, 'get', { key });
      expect(getResponse.data).toBeNull();
    });

    it('应该能够清除所有缓存', async () => {
      // 设置多个缓存条目
      await sendWorkerMessage(worker, 'set', {
        key: 'key-1',
        endpoint: '/api/test',
        data: { id: 1 },
      });
      await sendWorkerMessage(worker, 'set', {
        key: 'key-2',
        endpoint: '/api/test',
        data: { id: 2 },
      });

      // 清除所有缓存
      const clearResponse = await sendWorkerMessage(worker, 'clear');

      expect(clearResponse.success).toBe(true);
      expect(clearResponse.data.cleared).toBe(true);

      // 验证所有缓存已清除
      const count = await countRecords();
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // 缓存失效测试
  // ==========================================================================

  describe('缓存失效', () => {
    it('应该能够按端点失效缓存', async () => {
      // 设置不同端点的缓存
      await sendWorkerMessage(worker, 'set', {
        key: 'resources-1',
        endpoint: '/api/resources',
        data: { id: 1 },
      });
      await sendWorkerMessage(worker, 'set', {
        key: 'resources-2',
        endpoint: '/api/resources',
        data: { id: 2 },
      });
      await sendWorkerMessage(worker, 'set', {
        key: 'authors-1',
        endpoint: '/api/authors',
        data: { id: 3 },
      });

      // 失效 /api/resources 端点
      const response = await sendWorkerMessage(worker, 'invalidate', {
        endpoint: '/api/resources',
      });

      expect(response.success).toBe(true);
      expect(response.data.invalidated).toBe(2);

      // 验证 resources 缓存已删除
      const res1 = await sendWorkerMessage(worker, 'get', { key: 'resources-1' });
      expect(res1.data).toBeNull();

      // 验证 authors 缓存仍存在
      const auth1 = await sendWorkerMessage(worker, 'get', { key: 'authors-1' });
      expect(auth1.data).not.toBeNull();
    });

    it('应该能够按模式失效缓存', async () => {
      // 设置缓存
      await sendWorkerMessage(worker, 'set', {
        key: 'api-resources-page-1',
        endpoint: '/api/resources',
        data: { page: 1 },
      });
      await sendWorkerMessage(worker, 'set', {
        key: 'api-resources-page-2',
        endpoint: '/api/resources',
        data: { page: 2 },
      });
      await sendWorkerMessage(worker, 'set', {
        key: 'api-authors-all',
        endpoint: '/api/authors',
        data: { all: true },
      });

      // 使用模式失效
      const response = await sendWorkerMessage(worker, 'invalidate', {
        pattern: 'resources',
      });

      expect(response.success).toBe(true);
      expect(response.data.invalidated).toBe(2);

      // 验证匹配的缓存已删除
      const res1 = await sendWorkerMessage(worker, 'get', { key: 'api-resources-page-1' });
      expect(res1.data).toBeNull();

      // 验证不匹配的缓存仍存在
      const auth = await sendWorkerMessage(worker, 'get', { key: 'api-authors-all' });
      expect(auth.data).not.toBeNull();
    });
  });

  // ==========================================================================
  // 缓存统计测试
  // ==========================================================================

  describe('缓存统计', () => {
    it('应该能够获取缓存统计信息', async () => {
      // 设置一些缓存条目
      await sendWorkerMessage(worker, 'set', {
        key: 'stat-1',
        endpoint: '/api/resources',
        data: { items: Array(10).fill({ id: 1, name: 'test' }) },
      });
      await sendWorkerMessage(worker, 'set', {
        key: 'stat-2',
        endpoint: '/api/authors',
        data: { items: Array(5).fill({ id: 2, name: 'author' }) },
      });

      // 获取统计信息
      const response = await sendWorkerMessage(worker, 'stats');

      expect(response.success).toBe(true);
      expect(response.data.totalEntries).toBe(2);
      expect(response.data.storageSize).toBeGreaterThan(0);
      expect(response.data.byEndpoint).toHaveProperty('/api/resources');
      expect(response.data.byEndpoint).toHaveProperty('/api/authors');
      expect(response.data.byEndpoint['/api/resources'].entries).toBe(1);
      expect(response.data.byEndpoint['/api/authors'].entries).toBe(1);
    });

    it('空缓存应返回零统计', async () => {
      const response = await sendWorkerMessage(worker, 'stats');

      expect(response.success).toBe(true);
      expect(response.data.totalEntries).toBe(0);
      expect(response.data.storageSize).toBe(0);
      expect(Object.keys(response.data.byEndpoint)).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 缓存清理测试
  // ==========================================================================

  describe('缓存清理', () => {
    it('应该能够按年龄清理缓存', async () => {
      // 设置旧缓存（手动设置时间戳）
      const oldRecord: CacheRecord = {
        key: 'old-entry',
        endpoint: '/api/test',
        data: { old: true },
        timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 小时前
        version: CACHE_VERSION,
        size: 100,
      };
      await putRecordToDB(oldRecord);

      // 设置新缓存
      await sendWorkerMessage(worker, 'set', {
        key: 'new-entry',
        endpoint: '/api/test',
        data: { new: true },
      });

      // 清理超过 1 小时的缓存
      const response = await sendWorkerMessage(worker, 'cleanup', {
        maxAge: 60 * 60 * 1000, // 1 小时
      });

      expect(response.success).toBe(true);
      expect(response.data.cleaned).toBe(1);

      // 验证旧缓存已删除
      const oldEntry = await getRecordFromDB('old-entry');
      expect(oldEntry).toBeNull();

      // 验证新缓存仍存在
      const newEntry = await getRecordFromDB('new-entry');
      expect(newEntry).not.toBeNull();
    });

    it('应该能够按数量清理缓存（LRU）', async () => {
      // 设置多个缓存条目
      for (let i = 1; i <= 5; i++) {
        await sendWorkerMessage(worker, 'set', {
          key: `entry-${i}`,
          endpoint: '/api/test',
          data: { id: i },
        });
        // 确保时间戳不同
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // 清理，只保留最新的 3 个
      const response = await sendWorkerMessage(worker, 'cleanup', {
        maxEntries: 3,
      });

      expect(response.success).toBe(true);
      expect(response.data.cleaned).toBe(2);

      // 验证总数
      const count = await countRecords();
      expect(count).toBe(3);

      // 验证最旧的两个已删除
      const entry1 = await getRecordFromDB('entry-1');
      expect(entry1).toBeNull();
      const entry2 = await getRecordFromDB('entry-2');
      expect(entry2).toBeNull();

      // 验证最新的三个仍存在
      const entry5 = await getRecordFromDB('entry-5');
      expect(entry5).not.toBeNull();
    });
  });

  // ==========================================================================
  // 错误处理测试
  // ==========================================================================

  describe('错误处理', () => {
    it('缺少必需参数应返回错误', async () => {
      const response = await sendWorkerMessage(worker, 'get', {});

      expect(response.success).toBe(false);
      expect(response.error).toContain('required');
    });

    it('无效的消息类型应返回错误', async () => {
      const response = await sendWorkerMessage(
        worker,
        'invalid-type' as any
      );

      expect(response.success).toBe(false);
      expect(response.error).toContain('Unknown message type');
    });
  });

  // ==========================================================================
  // 版本控制测试
  // ==========================================================================

  describe('版本控制', () => {
    it('应该自动丢弃旧版本的缓存', async () => {
      // 手动插入旧版本的缓存
      const oldRecord: CacheRecord = {
        key: 'old-version',
        endpoint: '/api/test',
        data: { value: 'old' },
        timestamp: Date.now(),
        version: CACHE_VERSION - 1, // 旧版本
        size: 100,
      };
      await putRecordToDB(oldRecord);

      // 尝试获取
      const response = await sendWorkerMessage(worker, 'get', {
        key: 'old-version',
      });

      // 应该返回 null（版本不匹配）
      expect(response.success).toBe(true);
      expect(response.data).toBeNull();

      // 验证已从数据库删除
      const record = await getRecordFromDB('old-version');
      expect(record).toBeNull();
    });
  });
});
