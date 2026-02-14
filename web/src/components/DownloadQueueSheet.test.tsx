import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useDownload } from '../download/DownloadContext';
import DownloadQueueSheet from './DownloadQueueSheet';

vi.mock('../download/DownloadContext', () => ({
  useDownload: vi.fn(),
}));

type MutableState = {
  task: any;
  queueOpen: boolean;
  statusExpanded: boolean;
  triggerQueueItem: ReturnType<typeof vi.fn>;
  cancelQueue: ReturnType<typeof vi.fn>;
  closeQueue: ReturnType<typeof vi.fn>;
};

const mockedUseDownload = vi.mocked(useDownload);

function createState(): MutableState {
  const state: MutableState = {
    queueOpen: true,
    statusExpanded: true,
    task: {
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
    },
    triggerQueueItem: vi.fn(async (itemId: string) => {
      const target = state.task.items.find((it: any) => it.id === itemId);
      if (!target) return;
      target.status = 'triggered';
      state.task.triggered += 1;
    }),
    cancelQueue: vi.fn(() => {
      state.task.items.forEach((it: any) => {
        if (it.status === 'queued') it.status = 'cancelled';
      });
      state.task.status = 'cancelled';
    }),
    closeQueue: vi.fn(() => {
      state.queueOpen = false;
    }),
  };
  return state;
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
  let state: MutableState;

  beforeEach(() => {
    vi.clearAllMocks();
    state = createState();
    mockedUseDownload.mockImplementation(() => state as any);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
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

    expect(state.triggerQueueItem).toHaveBeenCalledTimes(1);
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

    expect(state.cancelQueue).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain('已取消');
  });

  it('renders nothing when queue is closed', async () => {
    state.queueOpen = false;
    await renderSheet();
    expect(container?.querySelector('.downloadQueueSheet')).toBeNull();
  });
});
