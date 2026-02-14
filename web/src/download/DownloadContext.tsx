import React from 'react';
import { message } from 'antd';
import type { DeleteItemsRequestItem } from '../api';
import { buildDownloadUrlFromMedia, downloadSingle, prepareBatch, startDesktopBatchZip } from './manager';
import { getPlatformInfo } from './platform';
import { MOBILE_BATCH_LIMIT } from './types';
import type { DownloadMediaSourceInput, DownloadSingleInput, DownloadTask } from './types';

interface DownloadContextValue {
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

const DownloadContext = React.createContext<DownloadContextValue | null>(null);

function taskId(prefix: string) {
  return `${prefix}-${Date.now()}`;
}

function summarizeBatchTask(task: DownloadTask): DownloadTask {
  const triggered = task.items.filter((item) => item.status === 'triggered').length;
  const failed = task.items.filter((item) => item.status === 'failed').length;
  const cancelled = task.items.filter((item) => item.status === 'cancelled').length;
  const pending = task.items.filter((item) => item.status === 'queued' || item.status === 'triggering').length;
  let status = task.status;
  if (pending > 0) {
    status = 'queued';
  } else if (failed > 0) {
    status = 'failed';
  } else if (triggered > 0) {
    status = 'triggered';
  } else if (cancelled > 0) {
    status = 'cancelled';
  }
  return { ...task, triggered, failed, status };
}

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [task, setTask] = React.useState<DownloadTask | null>(null);
  const [queueOpen, setQueueOpen] = React.useState(false);
  const [statusExpanded, setStatusExpanded] = React.useState(true);

  const downloadSingleItem = React.useCallback(async (input: DownloadSingleInput) => {
    const nextTask: DownloadTask = {
      id: taskId('single'),
      name: `下载 ${input.filename}`,
      mode: 'single',
      status: 'triggering',
      total: 1,
      triggered: 0,
      failed: 0,
      createdAt: Date.now(),
      items: [
        {
          id: `single|${input.filename}`,
          dirId: '',
          filename: input.filename,
          mediaUrl: input.downloadUrl,
          downloadUrl: input.downloadUrl,
          contentType: '',
          size: 0,
          status: 'triggering',
        },
      ],
    };
    setTask(nextTask);
    setQueueOpen(false);
    setStatusExpanded(true);
    try {
      await downloadSingle(input);
      setTask((prev) => {
        if (!prev || prev.id !== nextTask.id) return prev;
        const items = prev.items.map((item) => ({ ...item, status: 'triggered' as const }));
        return { ...prev, status: 'triggered', triggered: 1, items };
      });
      message.success(`已触发下载：${input.filename}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setTask((prev) => {
        if (!prev || prev.id !== nextTask.id) return prev;
        const items = prev.items.map((item) => ({ ...item, status: 'failed' as const, error: msg }));
        return { ...prev, status: 'failed', failed: 1, items };
      });
      message.error(`下载触发失败：${msg}`);
    }
  }, []);

  const downloadMediaItem = React.useCallback(
    async (source: DownloadMediaSourceInput) => {
      const downloadUrl = buildDownloadUrlFromMedia(source);
      await downloadSingleItem({
        filename: source.filename,
        downloadUrl,
      });
    },
    [downloadSingleItem]
  );

  const startBatchDownload = React.useCallback(async (items: DeleteItemsRequestItem[]) => {
    if (!items.length) return;
    const platform = getPlatformInfo();
    const shouldUseQueue = platform.ios || platform.standalonePwa;
    if (shouldUseQueue && items.length > MOBILE_BATCH_LIMIT) {
      message.warning(`移动端单次最多下载 ${MOBILE_BATCH_LIMIT} 项，请拆分后重试`);
      return;
    }

    if (shouldUseQueue) {
      const preparingTask: DownloadTask = {
        id: taskId('batch-mobile'),
        name: `批量下载（${items.length}项）`,
        mode: 'batch-mobile',
        status: 'preparing',
        total: items.length,
        triggered: 0,
        failed: 0,
        createdAt: Date.now(),
        items: [],
      };
      setTask(preparingTask);
      setQueueOpen(false);
      setStatusExpanded(true);
      const loadingKey = `download-prepare-${preparingTask.id}`;
      message.loading({ key: loadingKey, content: '正在准备下载队列...', duration: 0 });
      try {
        const prepared = await prepareBatch(items);
        message.destroy(loadingKey);
        if (!prepared.ok) {
          throw new Error(prepared.error || '下载准备失败');
        }

        if (prepared.invalid.length > 0) {
          message.warning(`有 ${prepared.invalid.length} 项无法下载，已自动跳过`);
        }

        if (!prepared.items.length) {
          setTask((prev) =>
            prev && prev.id === preparingTask.id
              ? { ...prev, status: 'failed', failed: items.length }
              : prev
          );
          message.error('没有可下载项');
          return;
        }

        const queueItems = prepared.items.map((item) => ({ ...item, status: 'queued' as const }));
        setTask((prev) => {
          if (!prev || prev.id !== preparingTask.id) return prev;
          return {
            ...prev,
            status: 'queued',
            total: queueItems.length,
            items: queueItems,
          };
        });
        setQueueOpen(true);
        message.success(`下载队列已就绪（${prepared.items.length}项）`);
      } catch (error) {
        message.destroy(loadingKey);
        const msg = error instanceof Error ? error.message : String(error);
        setTask((prev) =>
          prev && prev.id === preparingTask.id
            ? { ...prev, status: 'failed', failed: items.length }
            : prev
        );
        message.error(`下载准备失败：${msg}`);
      }
      return;
    }

    const desktopTask: DownloadTask = {
      id: taskId('batch-desktop'),
      name: `批量下载（${items.length}项）`,
      mode: 'batch-desktop',
      status: 'triggering',
      total: items.length,
      triggered: 0,
      failed: 0,
      createdAt: Date.now(),
      items: [],
    };
    setTask(desktopTask);
    setQueueOpen(false);
    setStatusExpanded(true);
    const loadingKey = `download-zip-${desktopTask.id}`;
    message.loading({ key: loadingKey, content: '正在生成下载包...', duration: 0 });
    try {
      const result = await startDesktopBatchZip(items);
      message.destroy(loadingKey);
      setTask((prev) =>
        prev && prev.id === desktopTask.id
          ? { ...prev, status: 'triggered', triggered: prev.total }
          : prev
      );
      message.success(`下载已触发：${result.filename}`);
    } catch (error) {
      message.destroy(loadingKey);
      const msg = error instanceof Error ? error.message : String(error);
      setTask((prev) =>
        prev && prev.id === desktopTask.id
          ? { ...prev, status: 'failed', failed: prev.total }
          : prev
      );
      message.error(`下载失败：${msg}`);
    }
  }, []);

  const triggerQueueItem = React.useCallback(async (itemId: string) => {
    const currentTask = task;
    if (!currentTask || currentTask.mode !== 'batch-mobile') return;
    const currentItem = currentTask.items.find((item) => item.id === itemId);
    if (!currentItem) return;
    if (currentItem.status !== 'queued' && currentItem.status !== 'failed') return;
    const target = {
      id: currentItem.id,
      filename: currentItem.filename,
      downloadUrl: currentItem.downloadUrl,
    };

    setTask((prev) => {
      if (!prev || prev.mode !== 'batch-mobile') return prev;
      const items = prev.items.map((item) =>
        item.id === itemId ? { ...item, status: 'triggering' as const, error: undefined } : item
      );
      return summarizeBatchTask({ ...prev, status: 'triggering', items });
    });

    try {
      await downloadSingle({ filename: target.filename, downloadUrl: target.downloadUrl });
      setTask((prev) => {
        if (!prev || prev.mode !== 'batch-mobile') return prev;
        const items = prev.items.map((item) =>
          item.id === target!.id ? { ...item, status: 'triggered' as const, error: undefined } : item
        );
        return summarizeBatchTask({ ...prev, items });
      });
      message.success(`已触发下载：${target.filename}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setTask((prev) => {
        if (!prev || prev.mode !== 'batch-mobile') return prev;
        const items = prev.items.map((item) =>
          item.id === target!.id ? { ...item, status: 'failed' as const, error: msg } : item
        );
        return summarizeBatchTask({ ...prev, items });
      });
      message.error(`下载触发失败：${msg}`);
    }
  }, [task]);

  const cancelQueue = React.useCallback(() => {
    setTask((prev) => {
      if (!prev || prev.mode !== 'batch-mobile') return prev;
      const items = prev.items.map((item) =>
        item.status === 'queued' || item.status === 'triggering'
          ? { ...item, status: 'cancelled' as const }
          : item
      );
      return summarizeBatchTask({ ...prev, status: 'cancelled', items });
    });
    setQueueOpen(false);
    message.info('已取消剩余下载任务');
  }, []);

  const openQueue = React.useCallback(() => setQueueOpen(true), []);
  const closeQueue = React.useCallback(() => setQueueOpen(false), []);
  const toggleStatusExpanded = React.useCallback(() => setStatusExpanded((prev) => !prev), []);
  const dismissTask = React.useCallback(() => {
    setTask(null);
    setQueueOpen(false);
  }, []);

  const value = React.useMemo<DownloadContextValue>(
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

  return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>;
}

export function useDownload() {
  const ctx = React.useContext(DownloadContext);
  if (!ctx) throw new Error('useDownload must be used within DownloadProvider');
  return ctx;
}
