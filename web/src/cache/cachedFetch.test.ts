import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('cachedFetch', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).Worker = undefined;
    (globalThis as any).indexedDB = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should cache responses in memory fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, value: 1 }),
    });

    (globalThis as any).fetch = fetchMock;

    const { cachedFetch } = await import('./client');

    const first = await cachedFetch<{ ok: boolean; value: number }>('/api/test');
    const second = await cachedFetch<{ ok: boolean; value: number }>('/api/test');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
