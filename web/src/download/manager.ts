import { prepareDownloads, type DeleteItemsRequestItem, type PrepareDownloadResponse } from '../api';
import { isIOS } from './platform';
import type { BatchSelectionItem, DownloadMediaSourceInput, DownloadSingleInput } from './types';

function encodeFilenameForDisposition(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function filenameFromDisposition(disposition: string): string | null {
  if (!disposition) return null;
  const utf8Match = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (utf8Match?.[1]) return encodeFilenameForDisposition(utf8Match[1].trim());
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(disposition);
  if (quoted?.[1]) return quoted[1].trim();
  const bare = /filename\s*=\s*([^;]+)/i.exec(disposition);
  return bare?.[1]?.trim() || null;
}

function withDownloadFlag(mediaUrl: string): string {
  if (!mediaUrl) return mediaUrl;
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(mediaUrl, base);
    parsed.searchParams.set('download', '1');
    if (/^https?:\/\//i.test(mediaUrl)) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return mediaUrl.includes('?') ? `${mediaUrl}&download=1` : `${mediaUrl}?download=1`;
  }
}

export function buildDownloadUrlFromMedia(source: DownloadMediaSourceInput): string {
  if (source.mediaUrl) return withDownloadFlag(source.mediaUrl);
  if (source.dirId && source.filename) {
    return `/media/${encodeURIComponent(source.dirId)}/${encodeURIComponent(source.filename)}?download=1`;
  }
  return source.mediaUrl;
}

function clickAnchor(url: string, filename?: string, target: '_self' | '_blank' = '_self'): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  if (filename) {
    anchor.download = filename;
  }
  anchor.target = target;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export async function triggerBrowserDownload(url: string, filename?: string): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('当前环境不支持下载');
  if (isIOS()) {
    // iOS/PWA 下避免使用 location.assign，避免触发页面级导航（会被 SPA/PWA 路由兜底）。
    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!resp.ok) {
      throw new Error(`下载失败（${resp.status}）`);
    }
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    try {
      clickAnchor(blobUrl, filename, '_blank');
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1200);
    }
    return;
  }
  clickAnchor(url, filename, '_self');
}

export async function downloadSingle(input: DownloadSingleInput): Promise<void> {
  await triggerBrowserDownload(input.downloadUrl, input.filename);
}

export async function prepareBatch(items: BatchSelectionItem[]): Promise<PrepareDownloadResponse> {
  return prepareDownloads(items);
}

export async function startDesktopBatchZip(items: DeleteItemsRequestItem[]): Promise<{ filename: string }> {
  const r = await fetch('/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });

  if (!r.ok) {
    let errorMsg = `下载失败（${r.status}）`;
    try {
      const j = await r.json();
      if (j?.error) errorMsg = j.error;
    } catch {}
    throw new Error(errorMsg);
  }

  const disposition = r.headers.get('Content-Disposition') || r.headers.get('content-disposition') || '';
  const filename = filenameFromDisposition(disposition) || `media-${Date.now()}.zip`;
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  try {
    await triggerBrowserDownload(url, filename);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { filename };
}
