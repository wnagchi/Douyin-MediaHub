import React from 'react';
import type { DeleteItemsRequestItem } from '../api';
import {
  selectDownloadCancelQueue,
  selectDownloadCloseQueue,
  selectDownloadDismissTask,
  selectDownloadMediaItem,
  selectDownloadOpenQueue,
  selectDownloadQueueOpen,
  selectDownloadSingleItem,
  selectDownloadStartBatchDownload,
  selectDownloadStatusExpanded,
  selectDownloadTask,
  selectDownloadToggleStatusExpanded,
  selectDownloadTriggerQueueItem,
  useDownloadStore,
} from '../store';
import type { DownloadMediaSourceInput, DownloadSingleInput, DownloadTask } from './types';

export interface DownloadContextValue {
  task: DownloadTask | null;
  queueOpen: boolean;
  statusExpanded: boolean;
  downloadMediaItem: (source: DownloadMediaSourceInput) => Promise<void>;
  downloadSingleItem: (input: DownloadSingleInput) => Promise<void>;
  startBatchDownload: (items: DeleteItemsRequestItem[]) => Promise<void>;
  triggerQueueItem: (itemId: string) => Promise<void>;
  cancelQueue: () => void;
  openQueue: () => void;
  closeQueue: () => void;
  toggleStatusExpanded: () => void;
  dismissTask: () => void;
}

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useDownload() {
  const task = useDownloadStore(selectDownloadTask);
  const queueOpen = useDownloadStore(selectDownloadQueueOpen);
  const statusExpanded = useDownloadStore(selectDownloadStatusExpanded);
  const downloadMediaItem = useDownloadStore(selectDownloadMediaItem);
  const downloadSingleItem = useDownloadStore(selectDownloadSingleItem);
  const startBatchDownload = useDownloadStore(selectDownloadStartBatchDownload);
  const triggerQueueItem = useDownloadStore(selectDownloadTriggerQueueItem);
  const cancelQueue = useDownloadStore(selectDownloadCancelQueue);
  const openQueue = useDownloadStore(selectDownloadOpenQueue);
  const closeQueue = useDownloadStore(selectDownloadCloseQueue);
  const toggleStatusExpanded = useDownloadStore(selectDownloadToggleStatusExpanded);
  const dismissTask = useDownloadStore(selectDownloadDismissTask);

  return React.useMemo<DownloadContextValue>(
    () => ({
      task,
      queueOpen,
      statusExpanded,
      downloadMediaItem,
      downloadSingleItem,
      startBatchDownload,
      triggerQueueItem,
      cancelQueue,
      openQueue,
      closeQueue,
      toggleStatusExpanded,
      dismissTask,
    }),
    [
      task,
      queueOpen,
      statusExpanded,
      downloadMediaItem,
      downloadSingleItem,
      startBatchDownload,
      triggerQueueItem,
      cancelQueue,
      openQueue,
      closeQueue,
      toggleStatusExpanded,
      dismissTask,
    ]
  );
}
