/**
 * IndexedDB 缓存架构定义
 * 
 * 本模块定义了前端缓存系统的 IndexedDB 数据库架构、类型接口和常量。
 * 用于持久化存储 API 响应，支持离线浏览和减少网络请求。
 */

// ============================================================================
// 数据库常量
// ============================================================================

/**
 * IndexedDB 数据库名称
 */
export const DB_NAME = 'douyin-cache';

/**
 * 数据库版本号
 * 当架构发生变化时需要递增此版本号
 */
export const DB_VERSION = 1;

/**
 * 缓存存储的对象存储名称
 */
export const STORE_NAME = 'api-cache';

/**
 * 缓存版本号
 * 用于标识缓存条目的版本，当 API 响应格式变化时需要递增
 * 不匹配的版本会被自动丢弃
 */
export const CACHE_VERSION = 1;

// ============================================================================
// 索引名称常量
// ============================================================================

/**
 * 按端点索引的名称
 * 用于快速查询特定端点的所有缓存条目
 */
export const INDEX_ENDPOINT = 'endpoint';

/**
 * 按时间戳索引的名称
 * 用于清理旧条目和实现 LRU 策略
 */
export const INDEX_TIMESTAMP = 'timestamp';

/**
 * 按版本索引的名称
 * 用于查找和清理过期版本的缓存条目
 */
export const INDEX_VERSION = 'version';

// ============================================================================
// TypeScript 接口定义
// ============================================================================

/**
 * 缓存记录接口
 * 存储在 IndexedDB 中的完整记录结构
 */
export interface CacheRecord {
  /**
   * 缓存键（主键）
   * 由端点和参数生成的唯一标识符
   */
  key: string;

  /**
   * API 端点路径
   * 例如: '/api/resources', '/api/authors'
   * 用于按端点分组和失效
   */
  endpoint: string;

  /**
   * 缓存的响应数据
   * 可以是任何 JSON 可序列化的数据
   */
  data: any;

  /**
   * 缓存创建时间戳（Unix 毫秒）
   * 用于判断缓存是否过期
   */
  timestamp: number;

  /**
   * 缓存版本号
   * 用于版本控制和迁移
   */
  version: number;

  /**
   * 数据大小（字节）
   * 用于存储配额管理和统计
   */
  size: number;

  /**
   * 请求参数（可选）
   * 存储用于生成缓存键的原始参数
   * 用于调试和统计
   */
  params?: Record<string, any>;
}

/**
 * 缓存条目接口
 * 从 IndexedDB 读取后返回给应用层的数据结构
 */
export interface CacheEntry<T = any> {
  /**
   * 缓存键
   */
  key: string;

  /**
   * API 端点
   */
  endpoint: string;

  /**
   * 缓存的数据（带类型）
   */
  data: T;

  /**
   * 缓存时间戳
   */
  timestamp: number;

  /**
   * 缓存版本
   */
  version: number;

  /**
   * 数据大小
   */
  size: number;

  /**
   * 请求参数
   */
  params?: Record<string, any>;
}

/**
 * IndexedDB 对象存储配置
 */
export interface StoreConfig {
  /**
   * 存储名称
   */
  name: string;

  /**
   * 主键路径
   */
  keyPath: string;

  /**
   * 索引配置列表
   */
  indexes: IndexConfig[];
}

/**
 * IndexedDB 索引配置
 */
export interface IndexConfig {
  /**
   * 索引名称
   */
  name: string;

  /**
   * 索引键路径
   */
  keyPath: string;

  /**
   * 是否唯一
   */
  unique: boolean;
}

/**
 * 数据库架构配置
 */
export interface DatabaseSchema {
  /**
   * 数据库名称
   */
  name: string;

  /**
   * 数据库版本
   */
  version: number;

  /**
   * 对象存储配置列表
   */
  stores: StoreConfig[];
}

// ============================================================================
// 架构定义
// ============================================================================

/**
 * IndexedDB 数据库架构
 * 定义了缓存系统的完整数据库结构
 */
export const DATABASE_SCHEMA: DatabaseSchema = {
  name: DB_NAME,
  version: DB_VERSION,
  stores: [
    {
      name: STORE_NAME,
      keyPath: 'key',
      indexes: [
        {
          name: INDEX_ENDPOINT,
          keyPath: 'endpoint',
          unique: false,
        },
        {
          name: INDEX_TIMESTAMP,
          keyPath: 'timestamp',
          unique: false,
        },
        {
          name: INDEX_VERSION,
          keyPath: 'version',
          unique: false,
        },
      ],
    },
  ],
};

// ============================================================================
// 过期阈值配置
// ============================================================================

/**
 * 过期阈值配置（毫秒）
 * 定义了不同端点的缓存过期时间
 */
export const STALE_THRESHOLDS: Record<string, number> = {
  '/api/resources': 5 * 60 * 1000,      // 5 分钟
  '/api/authors': 15 * 60 * 1000,       // 15 分钟
  '/api/tags': 15 * 60 * 1000,          // 15 分钟
  '/api/config': 60 * 60 * 1000,        // 1 小时
  default: 10 * 60 * 1000,              // 默认 10 分钟
};

/**
 * 获取指定端点的过期阈值
 * @param endpoint API 端点路径
 * @returns 过期阈值（毫秒）
 */
export function getStaleThreshold(endpoint: string): number {
  return STALE_THRESHOLDS[endpoint] || STALE_THRESHOLDS.default;
}

/**
 * 检查缓存条目是否过期
 * @param entry 缓存条目
 * @param customThreshold 自定义过期阈值（可选）
 * @returns 是否过期
 */
export function isStale(
  entry: CacheEntry | CacheRecord,
  customThreshold?: number
): boolean {
  const threshold = customThreshold || getStaleThreshold(entry.endpoint);
  const age = Date.now() - entry.timestamp;
  return age > threshold;
}

/**
 * 检查缓存条目版本是否有效
 * @param entry 缓存条目
 * @returns 版本是否有效
 */
export function isValidVersion(entry: CacheEntry | CacheRecord): boolean {
  return entry.version === CACHE_VERSION;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 估算数据大小（字节）
 * 使用 JSON 序列化长度作为近似值
 * @param data 要估算的数据
 * @returns 估算的字节数
 */
export function estimateSize(data: any): number {
  try {
    return JSON.stringify(data).length;
  } catch (error) {
    console.warn('[Cache] Failed to estimate size:', error);
    return 0;
  }
}

/**
 * 创建缓存记录
 * @param key 缓存键
 * @param endpoint API 端点
 * @param data 响应数据
 * @param params 请求参数（可选）
 * @returns 缓存记录
 */
export function createCacheRecord(
  key: string,
  endpoint: string,
  data: any,
  params?: Record<string, any>
): CacheRecord {
  return {
    key,
    endpoint,
    data,
    timestamp: Date.now(),
    version: CACHE_VERSION,
    size: estimateSize(data),
    params,
  };
}

/**
 * 将缓存记录转换为缓存条目
 * @param record 缓存记录
 * @returns 缓存条目
 */
export function recordToEntry<T = any>(record: CacheRecord): CacheEntry<T> {
  return {
    key: record.key,
    endpoint: record.endpoint,
    data: record.data as T,
    timestamp: record.timestamp,
    version: record.version,
    size: record.size,
    params: record.params,
  };
}
