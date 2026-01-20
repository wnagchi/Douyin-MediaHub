export interface MediaDir {
  id: string;
  path: string;
  label?: string;
  exists?: boolean;
}

export interface MediaItem {
  kind: 'video' | 'image' | 'other';
  filename: string;
  url: string;
  thumbUrl?: string;
  dirId?: string;
  seq?: number;
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
}

export interface ConfigResponse {
  ok: boolean;
  error?: string;
  mediaDirs?: string[];
  defaultMediaDirs?: string[];
  fromEnv?: boolean;
  persisted?: boolean;
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

export async function fetchResources(params: FetchResourcesParams = {}): Promise<ResourcesResponse> {
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
  const r = await fetch(url, { cache: 'no-store' });
  return asJson<ResourcesResponse>(r);
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
}

export async function fetchTags(params: { q?: string; dirId?: string; limit?: number } = {}): Promise<TagsResponse> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.dirId) query.set('dirId', params.dirId);
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  const url = qs ? `/api/tags?${qs}` : '/api/tags';
  const r = await fetch(url, { cache: 'no-store' });
  return asJson<TagsResponse>(r);
}

export interface AuthorStat {
  author: string; // 可能为空字符串（未知发布者）
  groupCount: number;
  itemCount: number;
  latestTimestampMs?: number;
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
  const r = await fetch(url, { cache: 'no-store' });
  return asJson<AuthorsResponse>(r);
}

export async function fetchConfig(): Promise<ConfigResponse> {
  const r = await fetch('/api/config', { cache: 'no-store' });
  return asJson<ConfigResponse>(r);
}

export async function saveConfigMediaDirs(mediaDirs: string[]): Promise<ConfigResponse> {
  const r = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaDirs }),
  });
  return asJson<ConfigResponse>(r);
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
  return asJson<DeleteItemsResponse>(r);
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

export async function reindex(params: { force?: boolean } = {}): Promise<ReindexResponse> {
  const force = params.force ? '1' : '0';
  const r = await fetch(`/api/reindex?force=${force}`, { method: 'POST', cache: 'no-store' });
  return asJson<ReindexResponse>(r);
}
