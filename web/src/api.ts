import {
  cachedFetch,
  buildGroupKey,
  maybeInvalidateGroupOnTotalChange,
  invalidationService,
  clearBrowserCache as clearCacheClient,
} from './cache/client';
import type { CacheFetchOptions } from './cache/client';
import type { CacheMeta } from './cache/CacheManager';

export interface MediaDir {
  id: string;
  path: string;
  label?: string;
  exists?: boolean;
}

export interface MediaItem {
  // 后端实际会返回 kind='file'（无法识别类型时），这里兼容一下
  kind: 'video' | 'image' | 'other' | 'file';
  filename: string;
  url: string;
  thumbUrl?: string;
  dirId?: string;
  seq?: number;
  // 某些场景（如发布者卡片）会返回最新条目的时间信息
  timeText?: string;
  timestampMs?: number;
}

export interface MediaGroup {
  theme?: string;
  themeText?: string;
  author?: string;
  timeText?: string;
  groupType?: string;
  types?: string[];
  tags?: string[];
  items: MediaItem[];
  [key: string]: any;
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  totalItems?: number;
}

export interface ResourcesResponse {
  ok: boolean;
  code?: string;
  error?: string;
  dirs?: MediaDir[];
  groups?: MediaGroup[];
  mediaDirs?: string[];
  defaultMediaDirs?: string[];
  pagination?: PaginationInfo;
  __cache?: CacheMeta;
}

export interface ConfigResponse {
  ok: boolean;
  error?: string;
  mediaDirs?: string[];
  defaultMediaDirs?: string[];
  fromEnv?: boolean;
  persisted?: boolean;
  __cache?: CacheMeta;
}

export interface InspectResponse {
  ok: boolean;
  error?: string;
  name?: string;
  dirId?: string;
  note?: string;
  info?: {
    videoCodecHint?: string;
    moov?: {
      likelyFastStart?: boolean;
    };
    codecHints?: string[];
  };
}

export interface DeleteItemsRequestItem {
  dirId: string;
  filename: string;
}

export interface DeleteItemsResponse {
  ok: boolean;
  error?: string;
  deleted?: number;
  failed?: number;
  results?: Array<{ ok: boolean; dirId: string; filename: string; error?: string; deleted?: boolean; skipped?: string }>;
}

async function asJson<T>(resp: Response): Promise<T> {
  return resp.json();
}

export interface FetchResourcesParams {
  page?: number;
  pageSize?: number;
  q?: string;
  type?: string;
  dirId?: string;
  tag?: string;
  // 当需要过滤“未知发布者”时 author 可能是空字符串，因此不能用 truthy 判断
  author?: string;
  sort?: 'publish' | 'ingest';
}

export interface FetchResourcesOptions
  extends Pick<CacheFetchOptions, 'forceRefresh' | 'skipCache' | 'allowStaleWhenOffline'> {}

export async function fetchResources(
  params: FetchResourcesParams = {},
  cacheOptions: FetchResourcesOptions = {}
): Promise<ResourcesResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.q) query.set('q', params.q);
  if (params.type) query.set('type', params.type);
  if (params.dirId) query.set('dirId', params.dirId);
  if (params.tag) query.set('tag', params.tag);
  if (params.author !== undefined) query.set('author', String(params.author ?? ''));
  if (params.sort) query.set('sort', params.sort);
  const qs = query.toString();
  const url = qs ? `/api/resources?${qs}` : '/api/resources';
  const groupKey = buildGroupKey('/api/resources', params, ['page', 'pageSize']);
  const requestOptions: RequestInit = cacheOptions.skipCache ? { cache: 'no-store' } : {};
  const response = await cachedFetch<ResourcesResponse>(
    url,
    requestOptions,
    {
      ...cacheOptions,
      endpoint: '/api/resources',
      params,
      groupKey,
    }
  );

  if (!response.__cache?.cached) {
    const total = response.pagination?.totalItems ?? response.pagination?.total;
    await maybeInvalidateGroupOnTotalChange(groupKey, total);
  }

  return response;
}

export interface TagStat {
  tag: string; // stored without '#'
  groupCount: number;
  itemCount: number;
  latestTimestampMs?: number;
}

export interface TagsResponse {
  ok: boolean;
  error?: string;
  tags?: TagStat[];
  __cache?: CacheMeta;
}

export async function fetchTags(params: { q?: string; dirId?: string; limit?: number } = {}): Promise<TagsResponse> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.dirId) query.set('dirId', params.dirId);
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  const url = qs ? `/api/tags?${qs}` : '/api/tags';

  return cachedFetch<TagsResponse>(url, {}, { endpoint: '/api/tags', params });
}

export interface AuthorStat {
  author: string; // 可能为空字符串（未知发布者）
  groupCount: number;
  itemCount: number;
  latestTimestampMs?: number;
  // 后端补充：该作者在当前筛选条件下的最新条目（用于移动端“封面卡片”）
  latestItem?: MediaItem;
}

export interface AuthorsResponse {
  ok: boolean;
  code?: string;
  error?: string;
  dirs?: MediaDir[];
  mediaDirs?: string[];
  defaultMediaDirs?: string[];
  authors?: AuthorStat[];
  pagination?: PaginationInfo;
  __cache?: CacheMeta;
}

export async function fetchAuthors(
  params: { page?: number; pageSize?: number; q?: string; dirId?: string; type?: string; tag?: string } = {}
): Promise<AuthorsResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.q) query.set('q', params.q);
  if (params.dirId) query.set('dirId', params.dirId);
  if (params.type) query.set('type', params.type);
  if (params.tag) query.set('tag', params.tag);
  const qs = query.toString();
  const url = qs ? `/api/authors?${qs}` : '/api/authors';

  return cachedFetch<AuthorsResponse>(url, {}, { endpoint: '/api/authors', params });
}

export async function fetchConfig(): Promise<ConfigResponse> {
  return cachedFetch<ConfigResponse>('/api/config', {}, { endpoint: '/api/config' });
}

export async function saveConfigMediaDirs(mediaDirs: string[]): Promise<ConfigResponse> {
  const r = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaDirs }),
  });
  const result = await asJson<ConfigResponse>(r);

  // 配置更新后，清空相关缓存
  await invalidationService.onConfigUpdate();
  await invalidationService.onReindex();
  
  return result;
}

export async function inspectMedia({ dirId, filename }: { dirId: string; filename: string }): Promise<InspectResponse> {
  const r = await fetch(
    `/api/inspect?dir=${encodeURIComponent(dirId || '')}&name=${encodeURIComponent(filename)}`,
    { cache: 'no-store' }
  );
  return asJson<InspectResponse>(r);
}

export async function deleteMediaItems(items: DeleteItemsRequestItem[]): Promise<DeleteItemsResponse> {
  const r = await fetch('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const result = await asJson<DeleteItemsResponse>(r);
  if (result.ok) {
    await invalidationService.onMediaDelete();
  }
  return result;
}

export interface ReindexResponse {
  ok: boolean;
  error?: string;
  running?: boolean;
  dbPath?: string;
  scannedDirs?: number;
  skippedDirs?: number;
  added?: number;
  updated?: number;
  deleted?: number;
  durationMs?: number;
}

export interface ScanProgress {
  phase: 'init' | 'scanning' | 'processing' | 'complete';
  totalDirs: number;
  currentDir: number;
  currentDirPath: string;
  scannedFiles: number;
  added: number;
  updated: number;
  deleted: number;
}

export async function reindex(params: { force?: boolean } = {}): Promise<ReindexResponse> {
  const force = params.force ? '1' : '0';
  const r = await fetch(`/api/reindex?force=${force}`, { method: 'POST', cache: 'no-store' });
  return asJson<ReindexResponse>(r);
}

export function reindexWithProgress(
  params: { force?: boolean } = {},
  onProgress?: (progress: ScanProgress) => void
): Promise<ReindexResponse> {
  return new Promise((resolve, reject) => {
    const force = params.force ? '1' : '0';
    const eventSource = new EventSource(`/api/reindex?force=${force}&stream=1`);

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'progress' && onProgress) {
          onProgress(message.data);
        } else if (message.type === 'complete') {
          eventSource.close();
          // 扫描完成后清空缓存
          invalidationService.onReindex();
          resolve(message.data);
        } else if (message.type === 'error') {
          eventSource.close();
          reject(new Error(message.data.error || '扫描失败'));
        }
      } catch (e) {
        console.error('Failed to parse SSE message:', e);
      }
    };

    eventSource.onerror = (error) => {
      eventSource.close();
      reject(new Error('扫描连接中断'));
    };
  });
}

// 缓存管理 API
export interface CacheStats {
  ok: boolean;
  thumbs: {
    count: number;
    size: number;
    sizeFormatted: string;
    path: string;
    oldestAccess?: string;
    newestAccess?: string;
  };
  vthumbs: {
    count: number;
    size: number;
    sizeFormatted: string;
    path: string;
    oldestAccess?: string;
    newestAccess?: string;
  };
  database: {
    size: number;
    sizeFormatted: string;
    path: string;
  };
  total: number;
  totalFormatted: string;
}

export interface ClearCacheResponse {
  ok: boolean;
  error?: string;
  deleted?: number;
  freedSize?: number;
  freedSizeFormatted?: string;
  details?: {
    thumbs: {
      deleted: number;
      freedSize: number;
      freedSizeFormatted: string;
    };
    vthumbs: {
      deleted: number;
      freedSize: number;
      freedSizeFormatted: string;
    };
  };
}

export async function fetchCacheStats(): Promise<CacheStats> {
  const r = await fetch('/api/cache/stats');
  return asJson<CacheStats>(r);
}

export async function clearThumbs(): Promise<ClearCacheResponse> {
  const r = await fetch('/api/cache/clear/thumbs', { method: 'POST' });
  return asJson<ClearCacheResponse>(r);
}

export async function cleanupCache(maxAgeMs?: number): Promise<ClearCacheResponse> {
  const r = await fetch('/api/cache/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxAgeMs }),
  });
  return asJson<ClearCacheResponse>(r);
}

export function clearBrowserCache() {
  return clearCacheClient().then(() => ({ ok: true }));
}
