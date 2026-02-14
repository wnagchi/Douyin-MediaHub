import type { DeleteItemsRequestItem, PreparedDownloadItem } from '../api';

export type DownloadStatus =
  | 'preparing'
  | 'queued'
  | 'triggering'
  | 'triggered'
  | 'failed'
  | 'cancelled';

export type DownloadTaskMode = 'single' | 'batch-mobile' | 'batch-desktop';

export interface DownloadItem extends PreparedDownloadItem {
  status: DownloadStatus;
  error?: string;
}

export interface DownloadTask {
  id: string;
  name: string;
  mode: DownloadTaskMode;
  status: DownloadStatus;
  total: number;
  triggered: number;
  failed: number;
  items: DownloadItem[];
  createdAt: number;
}

export interface DownloadSingleInput {
  filename: string;
  downloadUrl: string;
}

export interface DownloadMediaSourceInput {
  dirId?: string;
  filename: string;
  mediaUrl: string;
}

export type BatchSelectionItem = DeleteItemsRequestItem;

export const MOBILE_BATCH_LIMIT = 20;
