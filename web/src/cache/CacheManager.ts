/**
 * CacheManager
 * 主线程缓存管理器：封装 Web Worker 通信、缓存键生成、统计与失效
 */

import {
  CACHE_VERSION,
  type CacheEntry,
  type CacheRecord,
  isStale,
  isValidVersion,
} from './schema';

export interface CacheManagerOptions {
  enabled?: boolean;
  requestTimeoutMs?: number;
  enableLogging?: boolean;
  maxEntries?: number;
  useWorker?: boolean;
}

export interface CacheMeta {
  cached: boolean;
  stale: boolean;
  timestamp?: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: string;
  storage?: {
    totalEntries: number;
    storageSize: number;
    byEndpoint: Record<string, { entries: number; size: number }>;
  };
}

type PendingResolver = {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timeout: number;
};

export class CacheManager {
  private enabled: boolean;
  private requestTimeoutMs: number;
  private enableLogging: boolean;
  private maxEntries: number;
  private useWorker: boolean;
  private worker: Worker | null = null;
  private pending = new Map<string, PendingResolver>();
  private initPromise: Promise<void> | null = null;
  private hits = 0;
  private misses = 0;
  private inMemory = new Map<string, CacheRecord>();
  private groupKeys = new Map<string, Set<string>>();
  private seq = 0;

  constructor(options: CacheManagerOptions = {}) {
    this.enabled = options.enabled !== false;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
    this.enableLogging = options.enableLogging ?? false;
    this.maxEntries = options.maxEntries ?? 500;
    this.useWorker = options.useWorker !== false;

    if (!this.enabled) {
      this.useWorker = false;
      return;
    }

    if (typeof Worker === 'undefined' || typeof indexedDB === 'undefined') {
      this.useWorker = false;
      return;
    }

    if (this.useWorker) {
      this.worker = new Worker(new URL('./cacheWorker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (event) => {
        const { id, success, data, error } = event.data || {};
        if (!id || !this.pending.has(id)) return;
        const entry = this.pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timeout);
        this.pending.delete(id);
        if (success) {
          entry.resolve(data);
        } else {
          entry.reject(new Error(error || 'Cache worker error'));
        }
      });
    }
  }

  private log(message: string, payload?: any) {
    if (!this.enableLogging) return;
    // eslint-disable-next-line no-console
    console.log(`[CacheManager] ${message}`, payload || '');
  }

  private nextId(): string {
    this.seq += 1;
    return `cache-${Date.now()}-${this.seq}`;
  }

  private async ensureInit(): Promise<void> {
    if (!this.enabled) return;
    if (!this.useWorker || !this.worker) return;

    if (!this.initPromise) {
      this.initPromise = this.send('init');
    }
    await this.initPromise;
  }

  private async send(type: string, payload?: any): Promise<any> {
    if (!this.worker) throw new Error('Cache worker not available');
    const id = this.nextId();

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Cache worker timeout'));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.worker?.postMessage({ id, type, payload });
    });
  }

  getEnabled(): boolean {
    return this.enabled;
  }

  static generateCacheKey(endpoint: string, params: Record<string, any> = {}): string {
    const normalized = normalizeParams(params);
    const entries = Object.keys(normalized)
      .sort()
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(stableStringify(normalized[key]))}`);
    return entries.length ? `${endpoint}?${entries.join('&')}` : endpoint;
  }

  async get<T = any>(key: string): Promise<CacheEntry<T> | null> {
    if (!this.enabled) return null;

    if (!this.useWorker) {
      const record = this.inMemory.get(key);
      if (!record) return null;
      if (!isValidVersion(record)) {
        this.inMemory.delete(key);
        return null;
      }
      return record as CacheEntry<T>;
    }

    await this.ensureInit();
    const record = await this.send('get', { key });
    if (!record) return null;
    return record as CacheEntry<T>;
  }

  async getFresh<T = any>(key: string): Promise<{ entry: CacheEntry<T> | null; stale: boolean }> {
    const entry = await this.get<T>(key);
    if (!entry) {
      this.misses += 1;
      return { entry: null, stale: false };
    }

    const stale = isStale(entry);
    if (!stale) {
      this.hits += 1;
    } else {
      this.misses += 1;
    }

    return { entry, stale };
  }

  async set(key: string, endpoint: string, data: any, params?: Record<string, any>, groupKey?: string): Promise<void> {
    if (!this.enabled) return;

    this.registerGroupKey(groupKey, key);

    if (!this.useWorker) {
      const record: CacheRecord = {
        key,
        endpoint,
        data,
        timestamp: Date.now(),
        version: CACHE_VERSION,
        size: safeEstimateSize(data),
        params,
      };
      this.inMemory.set(key, record);
      if (this.inMemory.size > this.maxEntries) {
        this.cleanupInMemory();
      }
      return;
    }

    await this.ensureInit();

    try {
      await this.send('set', { key, endpoint, data, params });
    } catch (error: any) {
      const msg = String(error?.message || error);
      if (msg.includes('quota')) {
        this.log('Quota exceeded, running cleanup');
        await this.send('cleanup', { maxEntries: this.maxEntries });
        await this.send('set', { key, endpoint, data, params });
      } else {
        throw error;
      }
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.enabled) return;

    if (!this.useWorker) {
      this.inMemory.delete(key);
      return;
    }

    await this.ensureInit();
    await this.send('delete', { key });
  }

  async invalidateAll(): Promise<void> {
    if (!this.enabled) return;

    this.groupKeys.clear();

    if (!this.useWorker) {
      this.inMemory.clear();
      return;
    }

    await this.ensureInit();
    await this.send('clear');
  }

  async invalidateByPattern(pattern: string): Promise<void> {
    if (!this.enabled) return;

    if (!this.useWorker) {
      const regex = new RegExp(pattern);
      for (const key of this.inMemory.keys()) {
        if (regex.test(key)) this.inMemory.delete(key);
      }
      return;
    }

    await this.ensureInit();
    await this.send('invalidate', { pattern });
  }

  async invalidateByEndpoint(endpoint: string): Promise<void> {
    if (!this.enabled) return;

    if (!this.useWorker) {
      for (const [key, record] of this.inMemory.entries()) {
        if (record.endpoint === endpoint) this.inMemory.delete(key);
      }
      return;
    }

    await this.ensureInit();
    await this.send('invalidate', { endpoint });
  }

  async invalidateGroup(groupKey: string): Promise<void> {
    const keys = this.groupKeys.get(groupKey);
    if (!keys || keys.size === 0) return;

    const list = Array.from(keys);
    this.groupKeys.delete(groupKey);

    await Promise.all(list.map((key) => this.delete(key)));
  }

  registerGroupKey(groupKey: string | undefined, key: string): void {
    if (!groupKey) return;
    if (!this.groupKeys.has(groupKey)) {
      this.groupKeys.set(groupKey, new Set());
    }
    this.groupKeys.get(groupKey)?.add(key);
  }

  getStats(): Promise<CacheStats> | CacheStats {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(2) + '%' : '0%';

    if (!this.useWorker) {
      return {
        hits: this.hits,
        misses: this.misses,
        hitRate,
        storage: {
          totalEntries: this.inMemory.size,
          storageSize: Array.from(this.inMemory.values()).reduce((acc, r) => acc + r.size, 0),
          byEndpoint: {},
        },
      };
    }

    return (async () => {
      await this.ensureInit();
      const storage = await this.send('stats');
      return {
        hits: this.hits,
        misses: this.misses,
        hitRate,
        storage,
      };
    })();
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  dispose(): void {
    this.pending.forEach((entry) => clearTimeout(entry.timeout));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  private cleanupInMemory(): void {
    const entries = Array.from(this.inMemory.values()).sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = Math.max(0, entries.length - this.maxEntries);
    for (let i = 0; i < toRemove; i++) {
      this.inMemory.delete(entries[i].key);
    }
  }
}

function normalizeParams(params: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  Object.keys(params || {}).forEach((key) => {
    const value = params[key];
    if (value === null || value === undefined) return;
    normalized[key] = value;
  });
  return normalized;
}

function stableStringify(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const props = keys.map((key) => `${key}:${stableStringify(value[key])}`);
    return `{${props.join(',')}}`;
  }
  return String(value);
}

function safeEstimateSize(data: any): number {
  try {
    return JSON.stringify(data).length;
  } catch {
    return 0;
  }
}

export { normalizeParams, stableStringify };
