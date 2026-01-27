/**
 * InvalidationService
 * 缓存失效服务：根据业务事件触发失效
 */

import type { CacheManager } from './CacheManager';

export class InvalidationService {
  private cache: CacheManager;

  constructor(cache: CacheManager) {
    this.cache = cache;
  }

  async onReindex(): Promise<void> {
    await Promise.all([
      this.cache.invalidateByEndpoint('/api/resources'),
      this.cache.invalidateByEndpoint('/api/authors'),
      this.cache.invalidateByEndpoint('/api/tags'),
    ]);
  }

  async onConfigUpdate(): Promise<void> {
    await this.cache.invalidateByEndpoint('/api/config');
  }

  async onMediaDelete(): Promise<void> {
    await this.cache.invalidateByEndpoint('/api/resources');
  }

  async onManualClear(): Promise<void> {
    await this.cache.invalidateAll();
  }
}
