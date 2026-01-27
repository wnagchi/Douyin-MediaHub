/**
 * 缓存模块入口
 * 导出缓存系统的公共接口
 */

// 导出架构定义和类型
export {
  // 常量
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
  CACHE_VERSION,
  INDEX_ENDPOINT,
  INDEX_TIMESTAMP,
  INDEX_VERSION,
  STALE_THRESHOLDS,
  DATABASE_SCHEMA,
  
  // 类型
  type CacheRecord,
  type CacheEntry,
  type StoreConfig,
  type IndexConfig,
  type DatabaseSchema,
  
  // 辅助函数
  getStaleThreshold,
  isStale,
  isValidVersion,
  estimateSize,
  createCacheRecord,
  recordToEntry,
} from './schema';

export {
  CacheManager,
  type CacheManagerOptions,
  type CacheMeta,
  type CacheStats,
  normalizeParams,
  stableStringify,
} from './CacheManager';

export { RequestDeduplicator } from './RequestDeduplicator';
export { InvalidationService } from './InvalidationService';
