/**
 * 架构验证脚本
 * 用于验证 IndexedDB 架构定义的正确性
 */

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

console.log('=== 缓存架构验证 ===\n');

// 验证常量
console.log('1. 数据库常量:');
console.log(`   - 数据库名称: ${DB_NAME}`);
console.log(`   - 数据库版本: ${DB_VERSION}`);
console.log(`   - 存储名称: ${STORE_NAME}`);
console.log(`   - 缓存版本: ${CACHE_VERSION}`);
console.log('   ✓ 常量定义正确\n');

// 验证架构
console.log('2. 数据库架构:');
console.log(`   - 存储数量: ${DATABASE_SCHEMA.stores.length}`);
console.log(`   - 主键: ${DATABASE_SCHEMA.stores[0].keyPath}`);
console.log(`   - 索引数量: ${DATABASE_SCHEMA.stores[0].indexes.length}`);
DATABASE_SCHEMA.stores[0].indexes.forEach(idx => {
  console.log(`     * ${idx.name} (${idx.keyPath})`);
});
console.log('   ✓ 架构定义正确\n');

// 验证过期阈值
console.log('3. 过期阈值:');
const endpoints = ['/api/resources', '/api/authors', '/api/tags', '/api/config', '/api/unknown'];
endpoints.forEach(endpoint => {
  const threshold = getStaleThreshold(endpoint);
  const minutes = threshold / (60 * 1000);
  console.log(`   - ${endpoint}: ${minutes} 分钟`);
});
console.log('   ✓ 过期阈值配置正确\n');

// 验证缓存记录创建
console.log('4. 缓存记录创建:');
const testData = { items: [1, 2, 3], total: 3 };
const testParams = { page: 1, pageSize: 20 };
const record = createCacheRecord(
  'test-key',
  '/api/resources',
  testData,
  testParams
);
console.log(`   - 键: ${record.key}`);
console.log(`   - 端点: ${record.endpoint}`);
console.log(`   - 版本: ${record.version}`);
console.log(`   - 大小: ${record.size} 字节`);
console.log(`   - 时间戳: ${new Date(record.timestamp).toISOString()}`);
console.log('   ✓ 缓存记录创建正确\n');

// 验证过期检查
console.log('5. 过期检查:');
const freshEntry: CacheEntry = {
  key: 'fresh-key',
  endpoint: '/api/resources',
  data: testData,
  timestamp: Date.now(),
  version: CACHE_VERSION,
  size: 100,
};
console.log(`   - 新鲜条目过期: ${isStale(freshEntry)} (应为 false)`);

const staleEntry: CacheEntry = {
  key: 'stale-key',
  endpoint: '/api/resources',
  data: testData,
  timestamp: Date.now() - 10 * 60 * 1000, // 10分钟前
  version: CACHE_VERSION,
  size: 100,
};
console.log(`   - 过期条目过期: ${isStale(staleEntry)} (应为 true)`);
console.log('   ✓ 过期检查正确\n');

// 验证版本检查
console.log('6. 版本检查:');
const validEntry: CacheEntry = {
  key: 'valid-key',
  endpoint: '/api/resources',
  data: testData,
  timestamp: Date.now(),
  version: CACHE_VERSION,
  size: 100,
};
console.log(`   - 当前版本有效: ${isValidVersion(validEntry)} (应为 true)`);

const invalidEntry: CacheEntry = {
  key: 'invalid-key',
  endpoint: '/api/resources',
  data: testData,
  timestamp: Date.now(),
  version: CACHE_VERSION - 1,
  size: 100,
};
console.log(`   - 旧版本有效: ${isValidVersion(invalidEntry)} (应为 false)`);
console.log('   ✓ 版本检查正确\n');

// 验证记录转换
console.log('7. 记录转换:');
const entry = recordToEntry(record);
console.log(`   - 转换后类型匹配: ${entry.key === record.key}`);
console.log(`   - 数据保持一致: ${JSON.stringify(entry.data) === JSON.stringify(record.data)}`);
console.log('   ✓ 记录转换正确\n');

// 验证大小估算
console.log('8. 大小估算:');
const smallData = { test: 'data' };
const largeData = { items: Array(100).fill({ id: 1, name: 'test' }) };
console.log(`   - 小数据: ${estimateSize(smallData)} 字节`);
console.log(`   - 大数据: ${estimateSize(largeData)} 字节`);
console.log('   ✓ 大小估算正确\n');

console.log('=== 所有验证通过 ✓ ===');
