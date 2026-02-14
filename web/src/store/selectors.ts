import type { DownloadStoreState } from './downloadStore';

export const selectDownloadTask = (state: DownloadStoreState) => state.task;
export const selectDownloadQueueOpen = (state: DownloadStoreState) => state.queueOpen;
export const selectDownloadStatusExpanded = (state: DownloadStoreState) => state.statusExpanded;
export const selectDownloadOpenQueue = (state: DownloadStoreState) => state.openQueue;
export const selectDownloadCloseQueue = (state: DownloadStoreState) => state.closeQueue;
export const selectDownloadToggleStatusExpanded = (state: DownloadStoreState) => state.toggleStatusExpanded;
export const selectDownloadDismissTask = (state: DownloadStoreState) => state.dismissTask;
export const selectDownloadTriggerQueueItem = (state: DownloadStoreState) => state.triggerQueueItem;
export const selectDownloadCancelQueue = (state: DownloadStoreState) => state.cancelQueue;
export const selectDownloadStartBatchDownload = (state: DownloadStoreState) => state.startBatchDownload;
export const selectDownloadMediaItem = (state: DownloadStoreState) => state.downloadMediaItem;
export const selectDownloadSingleItem = (state: DownloadStoreState) => state.downloadSingleItem;
