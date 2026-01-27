import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheManager } from './CacheManager';

describe('CacheManager (in-memory fallback)', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager({ enabled: true, useWorker: false });
  });

  afterEach(() => {
    cache.dispose();
    vi.useRealTimers();
  });

  it('should set and get cache entries', async () => {
    await cache.set('key-1', '/api/test', { ok: true });
    const { entry, stale } = await cache.getFresh('key-1');
    expect(entry?.data).toEqual({ ok: true });
    expect(stale).toBe(false);
  });

  it('should mark entries stale after threshold', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-01-27T10:00:00Z');
    vi.setSystemTime(now);

    await cache.set('key-2', '/api/test', { ok: true });

    vi.setSystemTime(new Date(now.getTime() + 11 * 60 * 1000));
    const { stale } = await cache.getFresh('key-2');
    expect(stale).toBe(true);
  });
});
