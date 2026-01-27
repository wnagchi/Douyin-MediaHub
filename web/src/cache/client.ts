/**
 * 缓存客户端集成
 * 提供 cachedFetch 与缓存/失效实例
 */

import { CacheManager, type CacheMeta } from './CacheManager';
import { RequestDeduplicator } from './RequestDeduplicator';
import { InvalidationService } from './InvalidationService';

export interface CacheFetchOptions {
  params?: Record<string, any>;
  endpoint?: string;
  forceRefresh?: boolean;
  skipCache?: boolean;
  groupKey?: string;
  allowStaleWhenOffline?: boolean;
}

export type CachedResponse<T> = T & { __cache?: CacheMeta };

const cacheManager = new CacheManager({
  enabled: true,
  enableLogging: false,
  maxEntries: 500,
});

const requestDeduplicator = new RequestDeduplicator();
const invalidationService = new InvalidationService(cacheManager);

let online = typeof navigator === 'undefined' ? true : navigator.onLine;
let onlineListenersAttached = false;
let refreshInFlight = false;

type RequestRecord = {
  url: string;
  options: RequestInit;
  cacheOptions: CacheFetchOptions;
};

const requestRegistry = new Map<string, RequestRecord>();

function ensureOnlineListeners() {
  if (onlineListenersAttached || typeof window === 'undefined') return;
  onlineListenersAttached = true;
  window.addEventListener('online', () => {
    online = true;
    void refreshStaleEntries();
  });
  window.addEventListener('offline', () => {
    online = false;
  });
}

function attachCacheMeta<T>(data: T, meta: CacheMeta): CachedResponse<T> {
  if (data && typeof data === 'object') {
    return { ...(data as any), __cache: meta };
  }
  return data as CachedResponse<T>;
}

export function buildCacheKey(endpoint: string, params: Record<string, any> = {}): string {
  return CacheManager.generateCacheKey(endpoint, params);
}

export function buildGroupKey(endpoint: string, params: Record<string, any> = {}, excludeKeys: string[] = []): string {
  const filtered: Record<string, any> = {};
  Object.keys(params || {}).forEach((key) => {
    if (excludeKeys.includes(key)) return;
    filtered[key] = params[key];
  });
  return CacheManager.generateCacheKey(endpoint, filtered);
}

const resourcesTotalByGroup = new Map<string, number>();

export async function maybeInvalidateGroupOnTotalChange(groupKey: string, total: number | undefined): Promise<void> {
  if (typeof total !== 'number') return;
  const prev = resourcesTotalByGroup.get(groupKey);
  resourcesTotalByGroup.set(groupKey, total);
  if (prev !== undefined && prev !== total) {
    await cacheManager.invalidateGroup(groupKey);
  }
}

export async function cachedFetch<T>(
  url: string,
  options: RequestInit = {},
  cacheOptions: CacheFetchOptions = {}
): Promise<CachedResponse<T>> {
  ensureOnlineListeners();

  const endpoint = cacheOptions.endpoint || url.split('?')[0];
  const params = cacheOptions.params || {};
  const cacheKey = buildCacheKey(endpoint, params);
  const groupKey = cacheOptions.groupKey;
  const skipCache = cacheOptions.skipCache || false;
  const forceRefresh = cacheOptions.forceRefresh || false;
  const allowStaleWhenOffline = cacheOptions.allowStaleWhenOffline !== false;

  requestRegistry.set(cacheKey, { url, options, cacheOptions: { ...cacheOptions, endpoint, params } });

  if (!cacheManager.getEnabled() || skipCache) {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return attachCacheMeta<T>(data, { cached: false, stale: false });
  }

  const { entry, stale } = forceRefresh ? { entry: null, stale: false } : await cacheManager.getFresh<T>(cacheKey);

  if (entry && !stale) {
    return attachCacheMeta<T>(entry.data, { cached: true, stale: false, timestamp: entry.timestamp });
  }

  if (!online && entry && allowStaleWhenOffline) {
    return attachCacheMeta<T>(entry.data, { cached: true, stale: true, timestamp: entry.timestamp });
  }

  if (!online && !entry) {
    throw new Error('offline');
  }

  const requestKey = cacheKey;
  try {
    const data = await requestDeduplicator.deduplicate(requestKey, async () => {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json = await response.json();
      await cacheManager.set(cacheKey, endpoint, json, params, groupKey);
      return json;
    });

    return attachCacheMeta<T>(data, { cached: false, stale: false, timestamp: Date.now() });
  } catch (error) {
    if (entry && allowStaleWhenOffline) {
      return attachCacheMeta<T>(entry.data, { cached: true, stale: true, timestamp: entry.timestamp });
    }
    throw error;
  }
}

export async function clearBrowserCache(): Promise<void> {
  await cacheManager.invalidateAll();
  requestDeduplicator.clear();
  if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  }
}

export { cacheManager, requestDeduplicator, invalidationService };

async function refreshStaleEntries(): Promise<void> {
  if (refreshInFlight || !online) return;
  refreshInFlight = true;

  try {
    const entries = Array.from(requestRegistry.entries());
    for (const [cacheKey, record] of entries) {
      const { entry, stale } = await cacheManager.getFresh(cacheKey);
      if (entry && stale) {
        await cachedFetch(record.url, record.options, {
          ...record.cacheOptions,
          forceRefresh: true,
        });
      }
    }
  } finally {
    refreshInFlight = false;
  }
}
