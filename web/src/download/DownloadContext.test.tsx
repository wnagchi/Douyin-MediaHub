import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { message } from 'antd';
import { DownloadProvider, useDownload } from './DownloadContext';
import { resetDownloadStoreState } from '../store';

const prepareBatchMock = vi.fn();
const downloadSingleMock = vi.fn();

vi.mock('./platform', () => ({
  getPlatformInfo: vi.fn(() => ({ ios: true, standalonePwa: true, mobile: true })),
}));

vi.mock('./manager', () => ({
  buildDownloadUrlFromMedia: vi.fn(() => '/media/mock/a.mp4?download=1'),
  downloadSingle: (...args: any[]) => downloadSingleMock(...args),
  prepareBatch: (...args: any[]) => prepareBatchMock(...args),
  startDesktopBatchZip: vi.fn(),
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

function Harness({ count }: { count: number }) {
  const { startBatchDownload, triggerQueueItem, task } = useDownload();
  return (
    <div>
      <button
        id="startBatch"
        onClick={() => {
          const items = Array.from({ length: count }, (_, idx) => ({ dirId: 'd1', filename: `f-${idx}.mp4` }));
          void startBatchDownload(items);
        }}
      >
        start
      </button>
      <button
        id="triggerFirst"
        onClick={() => {
          const firstId = task?.items?.[0]?.id;
          if (firstId) void triggerQueueItem(firstId);
        }}
      >
        triggerFirst
      </button>
      <div id="progress">{task ? `${task.triggered}/${task.total}` : '0/0'}</div>
    </div>
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderHarness(count: number) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <DownloadProvider>
        <Harness count={count} />
      </DownloadProvider>
    );
  });
}

describe('DownloadContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDownloadStoreState();
    downloadSingleMock.mockResolvedValue(undefined);
    prepareBatchMock.mockResolvedValue({
      ok: true,
      items: [
        {
          id: 'd1|f-0.mp4',
          dirId: 'd1',
          filename: 'f-0.mp4',
          mediaUrl: '/media/d1/f-0.mp4',
          downloadUrl: '/media/d1/f-0.mp4?download=1',
          contentType: 'video/mp4',
          size: 10,
        },
        {
          id: 'd1|f-1.mp4',
          dirId: 'd1',
          filename: 'f-1.mp4',
          mediaUrl: '/media/d1/f-1.mp4',
          downloadUrl: '/media/d1/f-1.mp4?download=1',
          contentType: 'video/mp4',
          size: 20,
        },
      ],
      invalid: [],
    });
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

  it('enforces mobile queue limit (20)', async () => {
    await renderHarness(21);
    const button = container?.querySelector('#startBatch') as HTMLButtonElement | null;
    if (!button) throw new Error('start button not found');

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(message.warning).toHaveBeenCalled();
    expect(prepareBatchMock).not.toHaveBeenCalled();
  });

  it('triggers queued item download and updates progress', async () => {
    await renderHarness(2);
    const startButton = container?.querySelector('#startBatch') as HTMLButtonElement | null;
    const triggerFirst = container?.querySelector('#triggerFirst') as HTMLButtonElement | null;
    if (!startButton || !triggerFirst) throw new Error('required button not found');

    await act(async () => {
      startButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      triggerFirst.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(downloadSingleMock).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('#progress')?.textContent).toBe('1/2');
  });
});
