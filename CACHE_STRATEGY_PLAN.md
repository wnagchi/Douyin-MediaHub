# 缓存策略优化开发计划

## 📋 项目背景

### 当前缓存现状分析

**已实现的缓存：**
1. ✅ 静态文件 ETag 缓存（5分钟）
2. ✅ PWA Service Worker（基础配置）
3. ✅ 缩略图文件系统缓存
4. ✅ SQLite 数据库索引缓存

**存在的问题：**
1. ❌ API 响应全部设置 `cache: 'no-store'`，无缓存
2. ❌ 缩略图无过期管理，可能无限增长
3. ❌ Service Worker 策略过于简单
4. ❌ 浏览器内存缓存未充分利用
5. ❌ 无缓存预热机制
6. ❌ 缺少缓存监控和清理工具

---

## 🎯 优化目标

1. **性能提升**：减少 50% 的网络请求，提升页面加载速度
2. **离线支持**：实现基础的离线浏览能力
3. **流量节省**：减少重复数据传输，节省带宽
4. **用户体验**：更快的响应速度，更流畅的交互

---

## 📅 开发计划（分阶段实施）


### 🔷 Phase 1: 后端 HTTP 缓存优化（2-3天）

#### 1.1 静态资源缓存增强

**目标**：优化静态文件的缓存策略

**任务清单：**
- [ ] 根据文件类型设置不同的缓存时长
  - HTML: `no-cache`（需要验证）
  - JS/CSS: `max-age=31536000, immutable`（带版本号）
  - 图片/字体: `max-age=2592000`（30天）
  - 视频: `max-age=86400`（1天）
- [ ] 实现更强的 ETag 生成（包含文件内容哈希）
- [ ] 添加 `Last-Modified` 头支持
- [ ] 实现 `If-Modified-Since` 验证

**文件修改：**
- `src/http/static.js`

**代码示例：**
```javascript
function getCacheControl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  // 不缓存 HTML（需要验证最新版本）
  if (ext === '.html') return 'no-cache';
  
  // 长期缓存（带版本号的资源）
  if (['.js', '.css'].includes(ext)) {
    return 'public, max-age=31536000, immutable';
  }
  
  // 中期缓存
  if (['.jpg', '.jpeg', '.png', '.webp', '.svg', '.woff2'].includes(ext)) {
    return 'public, max-age=2592000'; // 30天
  }
  
  // 短期缓存
  if (['.mp4', '.webm', '.mov'].includes(ext)) {
    return 'public, max-age=86400'; // 1天
  }
  
  return 'public, max-age=3600'; // 默认1小时
}
```


#### 1.2 API 响应缓存策略

**目标**：为不同 API 设置合理的缓存策略

**任务清单：**
- [ ] `/api/resources` - 短期缓存（1-5分钟）
- [ ] `/api/tags` - 中期缓存（10分钟）
- [ ] `/api/authors` - 中期缓存（10分钟）
- [ ] `/api/config` - 长期缓存（直到修改）
- [ ] `/thumb/*` - 长期缓存（30天）
- [ ] `/vthumb/*` - 长期缓存（30天）
- [ ] 实现 ETag 支持（基于数据版本）
- [ ] 添加 `Cache-Control` 头
- [ ] 实现条件请求（304 Not Modified）

**文件修改：**
- `src/handler.js`
- 新建 `src/http/cache.js`

**代码示例：**
```javascript
// src/http/cache.js
const crypto = require('crypto');

class CacheManager {
  constructor() {
    this.etags = new Map(); // 存储 ETag
    this.lastModified = new Map(); // 存储最后修改时间
  }

  generateETag(data) {
    const hash = crypto.createHash('md5')
      .update(JSON.stringify(data))
      .digest('hex');
    return `"${hash}"`;
  }

  shouldReturn304(req, etag, lastModified) {
    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];

    if (ifNoneMatch && ifNoneMatch === etag) {
      return true;
    }

    if (ifModifiedSince && lastModified) {
      const reqTime = new Date(ifModifiedSince).getTime();
      const modTime = new Date(lastModified).getTime();
      if (reqTime >= modTime) {
        return true;
      }
    }

    return false;
  }

  setCacheHeaders(res, options = {}) {
    const {
      maxAge = 300, // 默认5分钟
      etag = null,
      lastModified = null,
      mustRevalidate = false,
      immutable = false,
    } = options;

    const cacheControl = [
      'public',
      `max-age=${maxAge}`,
      mustRevalidate && 'must-revalidate',
      immutable && 'immutable',
    ].filter(Boolean).join(', ');

    res.setHeader('Cache-Control', cacheControl);
    
    if (etag) {
      res.setHeader('ETag', etag);
    }
    
    if (lastModified) {
      res.setHeader('Last-Modified', lastModified);
    }
  }
}

module.exports = { CacheManager };
```


#### 1.3 缩略图缓存管理

**目标**：优化缩略图存储和过期策略

**任务清单：**
- [ ] 实现缩略图访问时间记录
- [ ] 添加 LRU（最近最少使用）清理策略
- [ ] 设置缩略图总大小限制（如 5GB）
- [ ] 实现定期清理任务
- [ ] 添加缩略图统计 API

**文件修改：**
- `src/thumbs.js`
- 新建 `src/cache/thumbCache.js`

**代码示例：**
```javascript
// src/cache/thumbCache.js
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

class ThumbCacheManager {
  constructor({ rootDir, maxSizeGB = 5, maxAgeMs = 30 * 24 * 60 * 60 * 1000 }) {
    this.rootDir = rootDir;
    this.maxSize = maxSizeGB * 1024 * 1024 * 1024;
    this.maxAge = maxAgeMs;
    this.thumbsDir = path.join(rootDir, 'data', 'thumbs');
  }

  async getStats() {
    const files = await fsp.readdir(this.thumbsDir);
    let totalSize = 0;
    let count = 0;

    for (const file of files) {
      try {
        const stat = await fsp.stat(path.join(this.thumbsDir, file));
        totalSize += stat.size;
        count++;
      } catch {}
    }

    return { count, totalSize, maxSize: this.maxSize };
  }

  async cleanup() {
    const files = await fsp.readdir(this.thumbsDir);
    const now = Date.now();
    const fileStats = [];

    // 收集文件信息
    for (const file of files) {
      try {
        const filePath = path.join(this.thumbsDir, file);
        const stat = await fsp.stat(filePath);
        fileStats.push({
          path: filePath,
          size: stat.size,
          atime: stat.atimeMs,
          mtime: stat.mtimeMs,
          age: now - stat.atimeMs,
        });
      } catch {}
    }

    let deleted = 0;
    let freedSize = 0;

    // 1. 删除过期文件
    for (const file of fileStats) {
      if (file.age > this.maxAge) {
        await fsp.unlink(file.path);
        deleted++;
        freedSize += file.size;
      }
    }

    // 2. 如果超过大小限制，删除最旧的文件
    const totalSize = fileStats.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > this.maxSize) {
      const sorted = fileStats.sort((a, b) => a.atime - b.atime);
      let currentSize = totalSize;

      for (const file of sorted) {
        if (currentSize <= this.maxSize * 0.8) break; // 清理到80%
        try {
          await fsp.unlink(file.path);
          currentSize -= file.size;
          deleted++;
          freedSize += file.size;
        } catch {}
      }
    }

    return { deleted, freedSize };
  }
}

module.exports = { ThumbCacheManager };
```


---

### 🔷 Phase 2: 前端缓存优化（2-3天）

#### 2.1 浏览器内存缓存

**目标**：在前端实现智能的内存缓存层

**任务清单：**
- [ ] 实现 API 响应内存缓存
- [ ] 添加缓存失效策略（TTL）
- [ ] 实现缓存预热（预加载常用数据）
- [ ] 添加缓存统计和监控

**文件修改：**
- 新建 `web/src/utils/cache.ts`
- 修改 `web/src/api.ts`

**代码示例：**
```typescript
// web/src/utils/cache.ts
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxSize = 100; // 最多缓存100个条目

  set<T>(key: string, data: T, ttl: number = 300000) { // 默认5分钟
    // LRU: 如果超过限制，删除最旧的
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  invalidate(pattern?: string) {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys()),
    };
  }
}

export const memoryCache = new MemoryCache();
```


#### 2.2 API 请求优化

**目标**：改进 API 调用，支持缓存

**任务清单：**
- [ ] 移除 `cache: 'no-store'`
- [ ] 添加缓存键生成逻辑
- [ ] 实现请求去重（防止重复请求）
- [ ] 添加缓存刷新机制

**文件修改：**
- `web/src/api.ts`

**代码示例：**
```typescript
// web/src/api.ts 修改
import { memoryCache } from './utils/cache';

// 请求去重 Map
const pendingRequests = new Map<string, Promise<any>>();

async function cachedFetch<T>(
  url: string,
  options: RequestInit = {},
  cacheOptions: { ttl?: number; key?: string } = {}
): Promise<T> {
  const cacheKey = cacheOptions.key || url;
  const ttl = cacheOptions.ttl || 300000; // 默认5分钟

  // 1. 检查内存缓存
  const cached = memoryCache.get<T>(cacheKey);
  if (cached) {
    console.log('[Cache] Hit:', cacheKey);
    return cached;
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
    .then(r => r.json())
    .then(data => {
      memoryCache.set(cacheKey, data, ttl);
      pendingRequests.delete(cacheKey);
      return data;
    })
    .catch(err => {
      pendingRequests.delete(cacheKey);
      throw err;
    });

  pendingRequests.set(cacheKey, promise);
  return promise;
}

// 修改现有函数
export async function fetchResources(params: FetchResourcesParams = {}): Promise<ResourcesResponse> {
  const query = new URLSearchParams();
  // ... 构建查询参数

  const url = qs ? `/api/resources?${qs}` : '/api/resources';
  
  // 使用缓存（根据筛选条件决定TTL）
  const hasFilters = params.q || params.type || params.dirId || params.tag;
  const ttl = hasFilters ? 60000 : 300000; // 有筛选条件时缓存1分钟，否则5分钟

  return cachedFetch<ResourcesResponse>(url, {}, { ttl });
}

export async function fetchTags(params: { q?: string; dirId?: string; limit?: number } = {}): Promise<TagsResponse> {
  const query = new URLSearchParams();
  // ... 构建查询参数
  
  const url = qs ? `/api/tags?${qs}` : '/api/tags';
  
  // 标签数据变化较少，缓存10分钟
  return cachedFetch<TagsResponse>(url, {}, { ttl: 600000 });
}
```


#### 2.3 图片懒加载与预加载

**目标**：优化图片加载策略

**任务清单：**
- [ ] 实现 Intersection Observer 懒加载
- [ ] 添加占位符/骨架屏
- [ ] 实现图片预加载（预测用户行为）
- [ ] 添加渐进式加载效果

**文件修改：**
- 新建 `web/src/hooks/useImageLoader.ts`
- 修改 `web/src/components/MediaTiles.tsx`

**代码示例：**
```typescript
// web/src/hooks/useImageLoader.ts
import { useEffect, useRef, useState } from 'react';

interface UseImageLoaderOptions {
  src: string;
  placeholder?: string;
  threshold?: number;
  rootMargin?: string;
}

export function useImageLoader({
  src,
  placeholder = '',
  threshold = 0.1,
  rootMargin = '50px',
}: UseImageLoaderOptions) {
  const [imageSrc, setImageSrc] = useState(placeholder);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!imgRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = new Image();
            img.src = src;
            
            img.onload = () => {
              setImageSrc(src);
              setIsLoading(false);
            };
            
            img.onerror = () => {
              setError(true);
              setIsLoading(false);
            };

            observer.unobserve(entry.target);
          }
        });
      },
      { threshold, rootMargin }
    );

    observer.observe(imgRef.current);

    return () => {
      observer.disconnect();
    };
  }, [src, threshold, rootMargin]);

  return { imgRef, imageSrc, isLoading, error };
}

// 预加载下一批图片
export function preloadImages(urls: string[], priority: 'high' | 'low' = 'low') {
  urls.forEach((url) => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'image';
    link.href = url;
    if (priority === 'high') {
      link.setAttribute('importance', 'high');
    }
    document.head.appendChild(link);
  });
}
```


---

### 🔷 Phase 3: Service Worker 增强（2天）

#### 3.1 高级缓存策略

**目标**：实现智能的 Service Worker 缓存策略

**任务清单：**
- [ ] 实现多种缓存策略（Network First, Cache First, Stale While Revalidate）
- [ ] 为不同资源类型配置不同策略
- [ ] 实现离线降级页面
- [ ] 添加后台同步支持

**文件修改：**
- 修改 `vite.config.ts` 中的 PWA 配置
- 新建 `web/public/sw-custom.js`

**代码示例：**
```typescript
// vite.config.ts 修改
VitePWA({
  registerType: 'autoUpdate',
  workbox: {
    // 运行时缓存策略
    runtimeCaching: [
      {
        // API 请求：网络优先，失败时使用缓存
        urlPattern: /^https?:\/\/.*\/api\/.*/,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-cache',
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 5 * 60, // 5分钟
          },
          networkTimeoutSeconds: 10,
        },
      },
      {
        // 缩略图：缓存优先
        urlPattern: /^https?:\/\/.*\/(thumb|vthumb)\/.*/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'thumb-cache',
          expiration: {
            maxEntries: 500,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30天
          },
        },
      },
      {
        // 静态资源：缓存优先
        urlPattern: /\.(?:js|css|woff2?|ttf|otf|eot)$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'static-cache',
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 365 * 24 * 60 * 60, // 1年
          },
        },
      },
      {
        // 图片：Stale While Revalidate
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'image-cache',
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7天
          },
        },
      },
    ],
    // 预缓存关键资源
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  },
  manifest: {
    // ... 现有配置
  },
})
```


#### 3.2 离线支持

**目标**：提供基础的离线浏览能力

**任务清单：**
- [ ] 实现离线页面
- [ ] 缓存最近浏览的内容
- [ ] 添加离线状态提示
- [ ] 实现后台同步（上传、删除等操作）

**文件修改：**
- 新建 `web/public/offline.html`
- 新建 `web/src/utils/offline.ts`

**代码示例：**
```typescript
// web/src/utils/offline.ts
export class OfflineManager {
  private isOnline = navigator.onLine;
  private listeners: Array<(online: boolean) => void> = [];

  constructor() {
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  private handleOnline() {
    this.isOnline = true;
    this.notify();
    this.syncPendingOperations();
  }

  private handleOffline() {
    this.isOnline = false;
    this.notify();
  }

  private notify() {
    this.listeners.forEach(fn => fn(this.isOnline));
  }

  subscribe(fn: (online: boolean) => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  getStatus() {
    return this.isOnline;
  }

  // 保存待同步的操作
  async queueOperation(operation: any) {
    const queue = await this.getQueue();
    queue.push(operation);
    localStorage.setItem('offline-queue', JSON.stringify(queue));
  }

  private async getQueue() {
    try {
      const data = localStorage.getItem('offline-queue');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // 同步待处理操作
  private async syncPendingOperations() {
    const queue = await this.getQueue();
    if (queue.length === 0) return;

    console.log('[Offline] Syncing', queue.length, 'operations');

    for (const op of queue) {
      try {
        // 执行操作
        await this.executeOperation(op);
      } catch (err) {
        console.error('[Offline] Sync failed:', err);
      }
    }

    localStorage.removeItem('offline-queue');
  }

  private async executeOperation(op: any) {
    // 根据操作类型执行相应的 API 调用
    switch (op.type) {
      case 'delete':
        // await deleteMediaItems(op.items);
        break;
      // ... 其他操作
    }
  }
}

export const offlineManager = new OfflineManager();
```


---

### 🔷 Phase 4: 缓存管理工具（1-2天）

#### 4.1 缓存监控面板

**目标**：提供可视化的缓存管理界面

**任务清单：**
- [ ] 创建缓存统计 API
- [ ] 实现缓存管理页面
- [ ] 显示各类缓存的大小和条目数
- [ ] 提供手动清理功能

**文件修改：**
- 新建 `src/cache/manager.js`
- 新建 `web/src/pages/CacheManagement.tsx`
- 修改 `src/handler.js` 添加缓存管理 API

**代码示例：**
```javascript
// src/cache/manager.js
class CacheManager {
  constructor({ rootDir }) {
    this.rootDir = rootDir;
  }

  async getStats() {
    const stats = {
      thumbs: await this.getThumbStats(),
      database: await this.getDatabaseStats(),
      total: 0,
    };

    stats.total = stats.thumbs.size + stats.database.size;
    return stats;
  }

  async getThumbStats() {
    const thumbsDir = path.join(this.rootDir, 'data', 'thumbs');
    const files = await fsp.readdir(thumbsDir);
    
    let totalSize = 0;
    for (const file of files) {
      try {
        const stat = await fsp.stat(path.join(thumbsDir, file));
        totalSize += stat.size;
      } catch {}
    }

    return {
      count: files.length,
      size: totalSize,
      path: thumbsDir,
    };
  }

  async getDatabaseStats() {
    const dbPath = path.join(this.rootDir, 'data', 'index.sqlite');
    try {
      const stat = await fsp.stat(dbPath);
      return {
        size: stat.size,
        path: dbPath,
      };
    } catch {
      return { size: 0, path: dbPath };
    }
  }

  async clearThumbs() {
    const thumbsDir = path.join(this.rootDir, 'data', 'thumbs');
    const files = await fsp.readdir(thumbsDir);
    
    let deleted = 0;
    for (const file of files) {
      try {
        await fsp.unlink(path.join(thumbsDir, file));
        deleted++;
      } catch {}
    }

    return { deleted };
  }
}

module.exports = { CacheManager };
```


#### 4.2 前端缓存管理界面

**任务清单：**
- [ ] 创建缓存管理页面
- [ ] 显示缓存统计信息
- [ ] 提供清理按钮
- [ ] 添加缓存刷新功能

**代码示例：**
```typescript
// web/src/pages/CacheManagement.tsx
import { useState, useEffect } from 'react';
import { Button, Card, Statistic, Space, message } from 'antd';

interface CacheStats {
  thumbs: { count: number; size: number };
  database: { size: number };
  total: number;
}

export default function CacheManagement() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStats = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cache/stats');
      const data = await res.json();
      setStats(data);
    } catch (err) {
      message.error('加载缓存统计失败');
    } finally {
      setLoading(false);
    }
  };

  const clearThumbs = async () => {
    if (!confirm('确定要清空所有缩略图缓存吗？')) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/cache/clear/thumbs', { method: 'POST' });
      const data = await res.json();
      message.success(`已清理 ${data.deleted} 个缩略图`);
      loadStats();
    } catch (err) {
      message.error('清理失败');
    } finally {
      setLoading(false);
    }
  };

  const clearBrowserCache = () => {
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
      message.success('浏览器缓存已清理');
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>缓存管理</h1>
      
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card title="缓存统计" loading={loading}>
          <Space size="large">
            <Statistic 
              title="缩略图缓存" 
              value={stats?.thumbs.count || 0} 
              suffix="个"
            />
            <Statistic 
              title="缩略图大小" 
              value={formatSize(stats?.thumbs.size || 0)} 
            />
            <Statistic 
              title="数据库大小" 
              value={formatSize(stats?.database.size || 0)} 
            />
            <Statistic 
              title="总缓存大小" 
              value={formatSize(stats?.total || 0)} 
            />
          </Space>
        </Card>

        <Card title="缓存操作">
          <Space>
            <Button onClick={loadStats} loading={loading}>
              刷新统计
            </Button>
            <Button onClick={clearThumbs} loading={loading} danger>
              清空缩略图
            </Button>
            <Button onClick={clearBrowserCache}>
              清空浏览器缓存
            </Button>
          </Space>
        </Card>
      </Space>
    </div>
  );
}
```


---

### 🔷 Phase 5: 性能优化与测试（1-2天）

#### 5.1 性能测试

**任务清单：**
- [ ] 使用 Lighthouse 测试性能指标
- [ ] 测试不同网络条件下的表现
- [ ] 压力测试缓存系统
- [ ] 测试离线功能

**测试指标：**
- First Contentful Paint (FCP) < 1.5s
- Largest Contentful Paint (LCP) < 2.5s
- Time to Interactive (TTI) < 3.5s
- 缓存命中率 > 70%

#### 5.2 监控与日志

**任务清单：**
- [ ] 添加缓存命中率统计
- [ ] 记录缓存性能指标
- [ ] 实现性能监控面板
- [ ] 添加错误追踪

**代码示例：**
```typescript
// web/src/utils/performance.ts
class PerformanceMonitor {
  private metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    apiCalls: 0,
    loadTimes: [] as number[],
  };

  recordCacheHit() {
    this.metrics.cacheHits++;
  }

  recordCacheMiss() {
    this.metrics.cacheMisses++;
  }

  recordApiCall(duration: number) {
    this.metrics.apiCalls++;
    this.metrics.loadTimes.push(duration);
  }

  getStats() {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    const hitRate = total > 0 ? (this.metrics.cacheHits / total) * 100 : 0;
    const avgLoadTime = this.metrics.loadTimes.length > 0
      ? this.metrics.loadTimes.reduce((a, b) => a + b, 0) / this.metrics.loadTimes.length
      : 0;

    return {
      cacheHitRate: hitRate.toFixed(2) + '%',
      totalRequests: total,
      avgLoadTime: avgLoadTime.toFixed(2) + 'ms',
      apiCalls: this.metrics.apiCalls,
    };
  }

  reset() {
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      apiCalls: 0,
      loadTimes: [],
    };
  }
}

export const perfMonitor = new PerformanceMonitor();
```

---

## 📊 预期效果

### 性能提升指标

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 首屏加载时间 | ~3s | ~1.5s | 50% ↓ |
| API 响应时间 | ~500ms | ~50ms | 90% ↓ |
| 缓存命中率 | 0% | 70%+ | - |
| 网络请求数 | 100+ | 30- | 70% ↓ |
| 流量消耗 | 10MB | 3MB | 70% ↓ |

### 用户体验提升

- ✅ 页面切换更流畅（缓存数据）
- ✅ 图片加载更快（预加载 + 懒加载）
- ✅ 离线可浏览最近内容
- ✅ 减少等待时间
- ✅ 降低流量消耗

---

## 🔧 实施建议

### 开发顺序

1. **先后端后前端**：确保服务端缓存策略正确
2. **先基础后高级**：先实现基本缓存，再优化细节
3. **逐步测试**：每个阶段完成后进行测试
4. **监控优先**：先建立监控，再优化性能

### 注意事项

1. **缓存失效**：确保数据更新时正确清理缓存
2. **存储限制**：注意浏览器存储配额限制
3. **版本管理**：资源更新时更新版本号
4. **降级方案**：缓存失败时的降级处理
5. **用户控制**：提供清理缓存的入口

### 风险控制

- 定期清理过期缓存，避免占用过多空间
- 监控缓存命中率，及时调整策略
- 提供手动刷新功能，应对缓存问题
- 做好错误处理和降级方案

---

## 📝 检查清单

### Phase 1 完成标准
- [ ] 静态文件缓存策略已实现
- [ ] API 响应支持 ETag 和条件请求
- [ ] 缩略图缓存管理已实现
- [ ] 后端缓存测试通过

### Phase 2 完成标准
- [ ] 前端内存缓存已实现
- [ ] API 请求支持缓存
- [ ] 图片懒加载已实现
- [ ] 缓存命中率 > 50%

### Phase 3 完成标准
- [ ] Service Worker 策略已配置
- [ ] 离线页面可访问
- [ ] 后台同步已实现
- [ ] PWA 功能正常

### Phase 4 完成标准
- [ ] 缓存管理 API 已实现
- [ ] 缓存管理页面可用
- [ ] 统计数据准确
- [ ] 清理功能正常

### Phase 5 完成标准
- [ ] Lighthouse 分数 > 90
- [ ] 性能指标达标
- [ ] 监控系统运行正常
- [ ] 文档已更新

---

## 📚 参考资料

- [HTTP Caching - MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)
- [Service Worker API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Workbox - Google](https://developers.google.com/web/tools/workbox)
- [Web Performance - web.dev](https://web.dev/performance/)

---

## 🎯 总结

这个缓存策略开发计划涵盖了从后端到前端的完整缓存优化方案，预计开发时间 **8-12 天**。

**核心优势：**
- 🚀 显著提升性能（50%+ 加载速度提升）
- 💾 减少服务器压力和带宽消耗
- 📱 支持离线浏览
- 🎨 改善用户体验
- 🔧 提供完善的管理工具

建议按阶段逐步实施，每个阶段完成后进行测试和优化，确保稳定性和效果。
