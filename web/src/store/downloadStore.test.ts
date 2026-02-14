import { message } from 'antd';
import { resetDownloadStoreState, useDownloadStore } from './downloadStore';

const buildDownloadUrlFromMediaMock = vi.fn();
const downloadSingleMock = vi.fn();
const prepareBatchMock = vi.fn();
const startDesktopBatchZipMock = vi.fn();
const getPlatformInfoMock = vi.fn();

vi.mock('../download/manager', () => ({
  buildDownloadUrlFromMedia: (...args: any[]) => buildDownloadUrlFromMediaMock(...args),
  downloadSingle: (...args: any[]) => downloadSingleMock(...args),
  prepareBatch: (...args: any[]) => prepareBatchMock(...args),
  startDesktopBatchZip: (...args: any[]) => startDesktopBatchZipMock(...args),
}));

vi.mock('../download/platform', () => ({
  getPlatformInfo: (...args: any[]) => getPlatformInfoMock(...args),
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

describe('downloadStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDownloadStoreState();

    buildDownloadUrlFromMediaMock.mockImplementation((source: { mediaUrl: string }) => `${source.mediaUrl}?download=1`);
    downloadSingleMock.mockResolvedValue(undefined);
    prepareBatchMock.mockResolvedValue({
      ok: true,
      items: [
        {
          id: 'd1|a.mp4',
          dirId: 'd1',
          filename: 'a.mp4',
          mediaUrl: '/media/d1/a.mp4',
          downloadUrl: '/media/d1/a.mp4?download=1',
          contentType: 'video/mp4',
          size: 10,
        },
        {
          id: 'd1|b.mp4',
          dirId: 'd1',
          filename: 'b.mp4',
          mediaUrl: '/media/d1/b.mp4',
          downloadUrl: '/media/d1/b.mp4?download=1',
          contentType: 'video/mp4',
          size: 20,
        },
      ],
      invalid: [],
    });
    startDesktopBatchZipMock.mockResolvedValue({ filename: 'bundle.zip' });
    getPlatformInfoMock.mockReturnValue({ ios: true, standalonePwa: true, mobile: true });
  });

  it('handles single download success and failure flow', async () => {
    await useDownloadStore.getState().downloadSingleItem({
      filename: 'ok.mp4',
      downloadUrl: '/media/ok.mp4?download=1',
    });

    let state = useDownloadStore.getState();
    expect(state.task?.status).toBe('triggered');
    expect(state.task?.triggered).toBe(1);
    expect(message.success).toHaveBeenCalled();

    downloadSingleMock.mockRejectedValueOnce(new Error('boom'));
    await useDownloadStore.getState().downloadSingleItem({
      filename: 'bad.mp4',
      downloadUrl: '/media/bad.mp4?download=1',
    });

    state = useDownloadStore.getState();
    expect(state.task?.status).toBe('failed');
    expect(state.task?.failed).toBe(1);
    expect(state.task?.items[0]?.error).toBe('boom');
    expect(message.error).toHaveBeenCalled();
  });

  it('creates mobile queue and triggers queued item', async () => {
    await useDownloadStore.getState().startBatchDownload([
      { dirId: 'd1', filename: 'a.mp4' },
      { dirId: 'd1', filename: 'b.mp4' },
    ]);

    let state = useDownloadStore.getState();
    expect(state.queueOpen).toBe(true);
    expect(state.task?.mode).toBe('batch-mobile');
    expect(state.task?.status).toBe('queued');
    expect(state.task?.items).toHaveLength(2);

    await useDownloadStore.getState().triggerQueueItem('d1|a.mp4');
    state = useDownloadStore.getState();
    expect(downloadSingleMock).toHaveBeenCalledTimes(1);
    expect(state.task?.triggered).toBe(1);
    expect(state.task?.items[0]?.status).toBe('triggered');
  });

  it('cancels remaining queue items and supports UI state actions', async () => {
    await useDownloadStore.getState().startBatchDownload([
      { dirId: 'd1', filename: 'a.mp4' },
      { dirId: 'd1', filename: 'b.mp4' },
    ]);

    useDownloadStore.getState().cancelQueue();
    let state = useDownloadStore.getState();
    expect(state.queueOpen).toBe(false);
    expect(state.task?.status).toBe('cancelled');
    expect(state.task?.items.every((item) => item.status === 'cancelled')).toBe(true);

    expect(state.statusExpanded).toBe(true);
    useDownloadStore.getState().toggleStatusExpanded();
    state = useDownloadStore.getState();
    expect(state.statusExpanded).toBe(false);

    useDownloadStore.getState().dismissTask();
    state = useDownloadStore.getState();
    expect(state.task).toBeNull();
    expect(state.queueOpen).toBe(false);
  });

  it('enforces mobile queue limit', async () => {
    await useDownloadStore.getState().startBatchDownload(
      Array.from({ length: 21 }, (_, index) => ({ dirId: 'd1', filename: `f-${index}.mp4` }))
    );

    expect(prepareBatchMock).not.toHaveBeenCalled();
    expect(message.warning).toHaveBeenCalled();
  });
});
