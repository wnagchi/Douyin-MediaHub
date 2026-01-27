import { describe, it, expect } from 'vitest';
import { CacheManager, stableStringify } from './CacheManager';

describe('CacheManager.generateCacheKey', () => {
  it('should generate deterministic keys with sorted params', () => {
    const keyA = CacheManager.generateCacheKey('/api/resources', { b: 2, a: 1 });
    const keyB = CacheManager.generateCacheKey('/api/resources', { a: 1, b: 2 });
    expect(keyA).toBe(keyB);
  });

  it('should omit null/undefined params', () => {
    const key = CacheManager.generateCacheKey('/api/resources', { q: 'a', x: undefined, y: null });
    expect(key).toBe('/api/resources?q=a');
  });

  it('should include array params consistently', () => {
    const key = CacheManager.generateCacheKey('/api/resources', { tags: ['a', 'b'] });
    expect(key).toBe('/api/resources?tags=%5Ba%2Cb%5D');
  });
});

describe('stableStringify', () => {
  it('should stringify nested objects with stable key order', () => {
    const a = stableStringify({ b: 2, a: 1 });
    const b = stableStringify({ a: 1, b: 2 });
    expect(a).toBe(b);
  });
});
