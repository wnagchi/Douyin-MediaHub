/**
 * IndexedDB 架构单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
  CACHE_VERSION,
  DATABASE_SCHEMA,
  getStaleThreshold,
  isStale,
  isValidVersion,
  estimateSize,
  createCacheRecord,
  recordToEntry,
  type CacheRecord,
  type CacheEntry,
} from './schema';

describe('缓存架构常量', () => {
  it('应该定义正确的数据库名称', () => {
    expect(DB_NAME).toBe('douyin-cache');
  });

  it('应该定义正确的数据库版本', () => {
    expect(DB_VERSION).toBe(1);
  });

  it('应该定义正确的存储名称', () => {
    expect(STORE_NAME).toBe('api-cache');
  });

  it('应该定义正确的缓存版本', () => {
    expect(CACHE_VERSION).toBe(1);
  });

  it('应该定义完整的数据库架构', () => {
    expect(DATABASE_SCHEMA).toEqual({
      name: DB_NAME,
      version: DB_VERSION,
      stores: [
        {
          name: STORE_NAME,
          keyPath: 'key',
          indexes: [
            { name: 'endpoint', keyPath: 'endpoint', unique: false },
            { name: 'timestamp', keyPath: 'timestamp', unique: false },
            { name: 'version', keyPath: 'version', unique: false },
          ],
        },
      ],
    });
  });
});

describe('getStaleThreshold', () => {
  it('应该返回 resources 端点的正确阈值（5分钟）', () => {
    expect(getStaleThreshold('/api/resources')).toBe(5 * 60 * 1000);
  });

  it('应该返回 authors 端点的正确阈值（15分钟）', () => {
    expect(getStaleThreshold('/api/authors')).toBe(15 * 60 * 1000);
  });

  it('应该返回 tags 端点的正确阈值（15分钟）', () => {
    expect(getStaleThreshold('/api/tags')).toBe(15 * 60 * 1000);
  });

  it('应该返回 config 端点的正确阈值（1小时）', () => {
    expect(getStaleThreshold('/api/config')).toBe(60 * 60 * 1000);
  });

  it('应该返回未知端点的默认阈值（10分钟）', () => {
    expect(getStaleThreshold('/api/unknown')).toBe(10 * 60 * 1000);
  });
});

describe('isStale', () => {
  it('应该判断新鲜的缓存条目为未过期', () => {
    const entry: CacheEntry = {
      key: 'test-key',
      endpoint: '/api/resources',
      data: { test: 'data' },
      timestamp: Date.now(),
      version: CACHE_VERSION,
      size: 100,
    };

    expect(isStale(entry)).toBe(false);
  });

  it('应该判断过期的缓存条目为已过期', () => {
    const entry: CacheEntry = {
      key: 'test-key',
      endpoint: '/api/resources',
      data: { test: 'data' },
      timestamp: Date.now() - 10 * 60 * 1000, // 10分钟前
      version: CACHE_VERSION,
      size: 100,
    };

    expect(isStale(entry)).toBe(true);
  });

  it('应该使用自定义阈值判断过期', () => {
    const entry: CacheEntry = {
      key: 'test-key',
      endpoint: '/api/resources',
      data: { test: 'data' },
      timestamp: Date.now() - 2 * 60 * 1000, // 2分钟前
      version: CACHE_VERSION,
      size: 100,
    };

    // 使用1分钟阈值，应该过期
    expect(isStale(entry, 1 * 60 * 1000)).toBe(true);

    // 使用5分钟阈值，应该未过期
    expect(isStale(entry, 5 * 60 * 1000)).toBe(false);
  });
});

describe('isValidVersion', () => {
  it('应该判断当前版本的条目为有效', () => {
    const entry: CacheEntry = {
      key: 'test-key',
      endpoint: '/api/resources',
      data: { test: 'data' },
      timestamp: Date.now(),
      version: CACHE_VERSION,
      size: 100,
    };

    expect(isValidVersion(entry)).toBe(true);
  });

  it('应该判断旧版本的条目为无效', () => {
    const entry: CacheEntry = {
      key: 'test-key',
      endpoint: '/api/resources',
      data: { test: 'data' },
      timestamp: Date.now(),
      version: CACHE_VERSION - 1,
      size: 100,
    };

    expect(isValidVersion(entry)).toBe(false);
  });
});

describe('estimateSize', () => {
  it('应该估算简单对象的大小', () => {
    const data = { test: 'data' };
    const size = estimateSize(data);
    expect(size).toBeGreaterThan(0);
    expect(size).toBe(JSON.stringify(data).length);
  });

  it('应该估算复杂对象的大小', () => {
    const data = {
      items: [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ],
      total: 2,
    };
    const size = estimateSize(data);
    expect(size).toBeGreaterThan(0);
    expect(size).toBe(JSON.stringify(data).length);
  });

  it('应该处理无法序列化的数据', () => {
    const circular: any = {};
    circular.self = circular;
    const size = estimateSize(circular);
    expect(size).toBe(0);
  });
});

describe('createCacheRecord', () => {
  it('应该创建完整的缓存记录', () => {
    const key = 'test-key';
    const endpoint = '/api/resources';
    const data = { test: 'data' };
    const params = { page: 1, pageSize: 20 };

    const record = createCacheRecord(key, endpoint, data, params);

    expect(record.key).toBe(key);
    expect(record.endpoint).toBe(endpoint);
    expect(record.data).toEqual(data);
    expect(record.params).toEqual(params);
    expect(record.version).toBe(CACHE_VERSION);
    expect(record.size).toBeGreaterThan(0);
    expect(record.timestamp).toBeGreaterThan(0);
    expect(Date.now() - record.timestamp).toBeLessThan(100); // 应该是刚创建的
  });

  it('应该创建不带参数的缓存记录', () => {
    const key = 'test-key';
    const endpoint = '/api/config';
    const data = { setting: 'value' };

    const record = createCacheRecord(key, endpoint, data);

    expect(record.key).toBe(key);
    expect(record.endpoint).toBe(endpoint);
    expect(record.data).toEqual(data);
    expect(record.params).toBeUndefined();
    expect(record.version).toBe(CACHE_VERSION);
  });
});

describe('recordToEntry', () => {
  it('应该将缓存记录转换为缓存条目', () => {
    const record: CacheRecord = {
      key: 'test-key',
      endpoint: '/api/resources',
      data: { test: 'data' },
      timestamp: Date.now(),
      version: CACHE_VERSION,
      size: 100,
      params: { page: 1 },
    };

    const entry = recordToEntry(record);

    expect(entry.key).toBe(record.key);
    expect(entry.endpoint).toBe(record.endpoint);
    expect(entry.data).toEqual(record.data);
    expect(entry.timestamp).toBe(record.timestamp);
    expect(entry.version).toBe(record.version);
    expect(entry.size).toBe(record.size);
    expect(entry.params).toEqual(record.params);
  });

  it('应该保持数据类型', () => {
    interface TestData {
      id: number;
      name: string;
    }

    const record: CacheRecord = {
      key: 'test-key',
      endpoint: '/api/resources',
      data: { id: 1, name: 'Test' },
      timestamp: Date.now(),
      version: CACHE_VERSION,
      size: 100,
    };

    const entry = recordToEntry<TestData>(record);

    expect(entry.data.id).toBe(1);
    expect(entry.data.name).toBe('Test');
  });
});
