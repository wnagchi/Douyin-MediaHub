/**
 * 内存缓存条目
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  key: string;
}

/**
 * 内存缓存管理器
 * 实现 LRU（最近最少使用）缓存策略
 */
class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxSize = 100; // 最多缓存100个条目
  private hits = 0;
  private misses = 0;

  /**
   * 设置缓存
   * @param key 缓存键
   * @param data 缓存数据
   * @param ttl 过期时间（毫秒），默认5分钟
   */
  set<T>(key: string, data: T, ttl: number = 300000) {
    // LRU: 如果超过限制，删除最旧的
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
      key,
    });
  }

  /**
   * 获取缓存
   * @param key 缓存键
   * @returns 缓存数据或 null
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // LRU: 更新访问时间（重新插入到末尾）
    this.cache.delete(key);
    this.cache.set(key, { ...entry, timestamp: now });

    this.hits++;
    return entry.data as T;
  }

  /**
   * 检查缓存是否存在且未过期
   * @param key 缓存键
   * @returns 是否存在
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * 删除缓存
   * @param key 缓存键
   */
  delete(key: string) {
    this.cache.delete(key);
  }

  /**
   * 清空缓存（支持模式匹配）
   * @param pattern 可选的正则表达式模式
   */
  invalidate(pattern?: string | RegExp) {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: hitRate.toFixed(2) + '%',
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 清空所有缓存和统计
   */
  clear() {
    this.cache.clear();
    this.resetStats();
  }
}

// 导出单例
export const memoryCache = new MemoryCache();

/**
 * 请求去重 Map
 * 防止同时发起多个相同的请求
 */
const pendingRequests = new Map<string, Promise<any>>();

/**
 * 带缓存的 fetch 封装
 * @param url 请求 URL
 * @param options fetch 选项
 * @param cacheOptions 缓存选项
 * @returns Promise<T>
 */
export async function cachedFetch<T>(
  url: string,
  options: RequestInit = {},
  cacheOptions: { ttl?: number; key?: string; skipCache?: boolean } = {}
): Promise<T> {
  const cacheKey = cacheOptions.key || url;
  const ttl = cacheOptions.ttl || 300000; // 默认5分钟
  const skipCache = cacheOptions.skipCache || false;

  // 1. 检查内存缓存
  if (!skipCache) {
    const cached = memoryCache.get<T>(cacheKey);
    if (cached) {
      console.log('[Cache] Hit:', cacheKey);
      return cached;
    }
  }

  // 2. 检查是否有进行中的相同请求（去重）
  if (pendingRequests.has(cacheKey)) {
    console.log('[Cache] Dedup:', cacheKey);
    return pendingRequests.get(cacheKey);
  }

  // 3. 发起新请求
  const promise = fetch(url, {
    ...options,
    // 移除 cache: 'no-store'，使用浏览器默认缓存
  })
    .then(async (r) => {
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      }
      return r.json();
    })
    .then((data) => {
      if (!skipCache) {
        memoryCache.set(cacheKey, data, ttl);
      }
      pendingRequests.delete(cacheKey);
      return data;
    })
    .catch((err) => {
      pendingRequests.delete(cacheKey);
      throw err;
    });

  pendingRequests.set(cacheKey, promise);
  return promise;
}

/**
 * 生成缓存键
 * @param base 基础键
 * @param params 参数对象
 * @returns 缓存键
 */
export function generateCacheKey(base: string, params: Record<string, any> = {}): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return sortedParams ? `${base}?${sortedParams}` : base;
}
