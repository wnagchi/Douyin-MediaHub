import { describe, it, expect } from 'vitest';
import { RequestDeduplicator } from './RequestDeduplicator';

describe('RequestDeduplicator', () => {
  it('should deduplicate concurrent requests with same key', async () => {
    const dedup = new RequestDeduplicator();
    let calls = 0;

    const task = () =>
      dedup.deduplicate('key', async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'ok';
      });

    const [a, b] = await Promise.all([task(), task()]);
    expect(a).toBe('ok');
    expect(b).toBe('ok');
    expect(calls).toBe(1);
  });

  it('should allow new request after completion', async () => {
    const dedup = new RequestDeduplicator();
    let calls = 0;

    await dedup.deduplicate('key', async () => {
      calls += 1;
      return 'first';
    });

    await dedup.deduplicate('key', async () => {
      calls += 1;
      return 'second';
    });

    expect(calls).toBe(2);
  });
});
