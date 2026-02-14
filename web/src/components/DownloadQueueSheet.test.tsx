import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import DownloadQueueSheet from './DownloadQueueSheet';
import type { DownloadTask } from '../download/types';
import { resetDownloadStoreState, useDownloadStore } from '../store';

vi.mock('../download/manager', () => ({
  buildDownloadUrlFromMedia: vi.fn(),
  downloadSingle: vi.fn(),
  prepareBatch: vi.fn(),
  startDesktopBatchZip: vi.fn(),
}));

vi.mock('../download/platform', () => ({
  getPlatformInfo: vi.fn(() => ({ ios: true, standalonePwa: true, mobile: true })),
}));

vi.mock('antd', () => ({
  message: {
    loading: vi.fn(),
    destroy: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

type StoreActionSpies = {
  triggerQueueItem: ReturnType<typeof vi.fn>;
  cancelQueue: ReturnType<typeof vi.fn>;
  closeQueue: ReturnType<typeof vi.fn>;
};

function createTask(): DownloadTask {
  return {
    id: 'task-1',
    name: '批量下载（2项）',
    mode: 'batch-mobile',
    status: 'queued',
    total: 2,
    triggered: 0,
    failed: 0,
    createdAt: Date.now(),
    items: [
      {
        id: 'd1|a.mp4',
        dirId: 'd1',
        filename: 'a.mp4',
        mediaUrl: '/media/d1/a.mp4',
        downloadUrl: '/media/d1/a.mp4?download=1',
        contentType: 'video/mp4',
        size: 10,
        status: 'queued',
      },
      {
        id: 'd1|b.mp4',
        dirId: 'd1',
        filename: 'b.mp4',
        mediaUrl: '/media/d1/b.mp4',
        downloadUrl: '/media/d1/b.mp4?download=1',
        contentType: 'video/mp4',
        size: 20,
        status: 'queued',
      },
    ],
  };
}

function seedStore(): StoreActionSpies {
  const triggerQueueItem = vi.fn(async (itemId: string) => {
    useDownloadStore.setState((state) => {
      if (!state.task || state.task.mode !== 'batch-mobile') return state;
      const items = state.task.items.map((item) =>
        item.id === itemId ? { ...item, status: 'triggered' as const } : item
      );
      return {
        task: {
          ...state.task,
          items,
          triggered: items.filter((item) => item.status === 'triggered').length,
        },
      };
    });
  });

  const cancelQueue = vi.fn(() => {
    useDownloadStore.setState((state) => {
      if (!state.task || state.task.mode !== 'batch-mobile') return state;
      return {
        task: {
          ...state.task,
          status: 'cancelled',
          items: state.task.items.map((item) =>
            item.status === 'queued' ? { ...item, status: 'cancelled' as const } : item
          ),
        },
      };
    });
  });

  const closeQueue = vi.fn(() => {
    useDownloadStore.setState({ queueOpen: false });
  });

  useDownloadStore.setState({
    task: createTask(),
    queueOpen: true,
    triggerQueueItem,
    cancelQueue,
    closeQueue,
  });

  return {
    triggerQueueItem,
    cancelQueue,
    closeQueue,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderSheet() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<DownloadQueueSheet />);
  });
}

async function rerenderSheet() {
  await act(async () => {
    root?.render(<DownloadQueueSheet />);
  });
}

describe('DownloadQueueSheet', () => {
  let actions: StoreActionSpies;

  beforeEach(() => {
    vi.clearAllMocks();
    resetDownloadStoreState();
    actions = seedStore();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    resetDownloadStoreState();
    if (container?.isConnected) container.remove();
    container = null;
    root = null;
  });

  it('increments progress after item download click', async () => {
    await renderSheet();
    const firstBtn = Array.from(container?.querySelectorAll('.downloadQueueRowBtn') || []).find((el) =>
      (el as HTMLButtonElement).textContent?.includes('下载')
    ) as HTMLButtonElement | undefined;
    if (!firstBtn) throw new Error('queue download button not found');

    await act(async () => {
      firstBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await rerenderSheet();

    expect(actions.triggerQueueItem).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain('已触发 1/2');
  });

  it('cancels remaining items', async () => {
    await renderSheet();
    const cancelBtn = Array.from(container?.querySelectorAll('.downloadQueueSheetBtn') || []).find((el) =>
      (el as HTMLButtonElement).textContent?.includes('取消剩余')
    ) as HTMLButtonElement | undefined;
    if (!cancelBtn) throw new Error('cancel button not found');

    await act(async () => {
      cancelBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await rerenderSheet();

    expect(actions.cancelQueue).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain('已取消');
  });

  it('renders nothing when queue is closed', async () => {
    useDownloadStore.setState({ queueOpen: false });
    await renderSheet();
    expect(container?.querySelector('.downloadQueueSheet')).toBeNull();
  });
});
