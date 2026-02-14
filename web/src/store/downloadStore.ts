import { message } from 'antd';
import { create } from 'zustand';
import type { DeleteItemsRequestItem } from '../api';
import { buildDownloadUrlFromMedia, downloadSingle, prepareBatch, startDesktopBatchZip } from '../download/manager';
import { getPlatformInfo } from '../download/platform';
import { MOBILE_BATCH_LIMIT } from '../download/types';
import type { DownloadMediaSourceInput, DownloadSingleInput, DownloadTask } from '../download/types';

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

type DownloadStoreData = {
  task: DownloadTask | null;
  queueOpen: boolean;
  statusExpanded: boolean;
};

const initialDownloadStoreData: DownloadStoreData = {
  task: null,
  queueOpen: false,
  statusExpanded: true,
};

export interface DownloadStoreState extends DownloadStoreData {
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

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  ...initialDownloadStoreData,
  downloadSingleItem: async (input: DownloadSingleInput) => {
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
    set({ task: nextTask, queueOpen: false, statusExpanded: true });
    try {
      await downloadSingle(input);
      set((state) => {
        if (!state.task || state.task.id !== nextTask.id) return state;
        const items = state.task.items.map((item) => ({ ...item, status: 'triggered' as const }));
        return {
          task: { ...state.task, status: 'triggered', triggered: 1, items },
        };
      });
      message.success(`已触发下载：${input.filename}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set((state) => {
        if (!state.task || state.task.id !== nextTask.id) return state;
        const items = state.task.items.map((item) => ({ ...item, status: 'failed' as const, error: msg }));
        return {
          task: { ...state.task, status: 'failed', failed: 1, items },
        };
      });
      message.error(`下载触发失败：${msg}`);
    }
  },
  downloadMediaItem: async (source: DownloadMediaSourceInput) => {
    const downloadUrl = buildDownloadUrlFromMedia(source);
    await get().downloadSingleItem({
      filename: source.filename,
      downloadUrl,
    });
  },
  startBatchDownload: async (items: DeleteItemsRequestItem[]) => {
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
      set({
        task: preparingTask,
        queueOpen: false,
        statusExpanded: true,
      });
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
          set((state) => {
            if (!state.task || state.task.id !== preparingTask.id) return state;
            return {
              task: {
                ...state.task,
                status: 'failed',
                failed: items.length,
              },
            };
          });
          message.error('没有可下载项');
          return;
        }

        const queueItems = prepared.items.map((item) => ({ ...item, status: 'queued' as const }));
        set((state) => {
          if (!state.task || state.task.id !== preparingTask.id) return state;
          return {
            task: {
              ...state.task,
              status: 'queued',
              total: queueItems.length,
              items: queueItems,
            },
            queueOpen: true,
          };
        });
        message.success(`下载队列已就绪（${prepared.items.length}项）`);
      } catch (error) {
        message.destroy(loadingKey);
        const msg = error instanceof Error ? error.message : String(error);
        set((state) => {
          if (!state.task || state.task.id !== preparingTask.id) return state;
          return {
            task: {
              ...state.task,
              status: 'failed',
              failed: items.length,
            },
          };
        });
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
    set({
      task: desktopTask,
      queueOpen: false,
      statusExpanded: true,
    });
    const loadingKey = `download-zip-${desktopTask.id}`;
    message.loading({ key: loadingKey, content: '正在生成下载包...', duration: 0 });
    try {
      const result = await startDesktopBatchZip(items);
      message.destroy(loadingKey);
      set((state) => {
        if (!state.task || state.task.id !== desktopTask.id) return state;
        return {
          task: {
            ...state.task,
            status: 'triggered',
            triggered: state.task.total,
          },
        };
      });
      message.success(`下载已触发：${result.filename}`);
    } catch (error) {
      message.destroy(loadingKey);
      const msg = error instanceof Error ? error.message : String(error);
      set((state) => {
        if (!state.task || state.task.id !== desktopTask.id) return state;
        return {
          task: {
            ...state.task,
            status: 'failed',
            failed: state.task.total,
          },
        };
      });
      message.error(`下载失败：${msg}`);
    }
  },
  triggerQueueItem: async (itemId: string) => {
    const currentTask = get().task;
    if (!currentTask || currentTask.mode !== 'batch-mobile') return;
    const currentItem = currentTask.items.find((item) => item.id === itemId);
    if (!currentItem) return;
    if (currentItem.status !== 'queued' && currentItem.status !== 'failed') return;
    const target = {
      id: currentItem.id,
      filename: currentItem.filename,
      downloadUrl: currentItem.downloadUrl,
    };

    set((state) => {
      if (!state.task || state.task.mode !== 'batch-mobile') return state;
      const nextItems = state.task.items.map((item) =>
        item.id === itemId ? { ...item, status: 'triggering' as const, error: undefined } : item
      );
      return {
        task: summarizeBatchTask({ ...state.task, status: 'triggering', items: nextItems }),
      };
    });

    try {
      await downloadSingle({ filename: target.filename, downloadUrl: target.downloadUrl });
      set((state) => {
        if (!state.task || state.task.mode !== 'batch-mobile') return state;
        const nextItems = state.task.items.map((item) =>
          item.id === target.id ? { ...item, status: 'triggered' as const, error: undefined } : item
        );
        return {
          task: summarizeBatchTask({ ...state.task, items: nextItems }),
        };
      });
      message.success(`已触发下载：${target.filename}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set((state) => {
        if (!state.task || state.task.mode !== 'batch-mobile') return state;
        const nextItems = state.task.items.map((item) =>
          item.id === target.id ? { ...item, status: 'failed' as const, error: msg } : item
        );
        return {
          task: summarizeBatchTask({ ...state.task, items: nextItems }),
        };
      });
      message.error(`下载触发失败：${msg}`);
    }
  },
  cancelQueue: () => {
    set((state) => {
      if (!state.task || state.task.mode !== 'batch-mobile') return state;
      const items = state.task.items.map((item) =>
        item.status === 'queued' || item.status === 'triggering'
          ? { ...item, status: 'cancelled' as const }
          : item
      );
      return {
        task: summarizeBatchTask({ ...state.task, status: 'cancelled', items }),
        queueOpen: false,
      };
    });
    message.info('已取消剩余下载任务');
  },
  openQueue: () => set({ queueOpen: true }),
  closeQueue: () => set({ queueOpen: false }),
  toggleStatusExpanded: () => set((state) => ({ statusExpanded: !state.statusExpanded })),
  dismissTask: () => set({ task: null, queueOpen: false }),
}));

export function resetDownloadStoreState() {
  useDownloadStore.setState(initialDownloadStoreData);
}
