import { downloadSingle, buildDownloadUrlFromMedia, prepareBatch, startDesktopBatchZip } from './manager';
import { prepareDownloads } from '../api';

vi.mock('../api', () => ({
  prepareDownloads: vi.fn(),
}));

describe('download manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds download url from dirId + filename', () => {
    const url = buildDownloadUrlFromMedia({
      dirId: 'media-dir',
      filename: 'a b.mp4',
      mediaUrl: '/media/media-dir/a%20b.mp4',
    });
    expect(url).toBe('/media/media-dir/a%20b.mp4?download=1');
  });

  it('appends download query for plain media url', () => {
    const url = buildDownloadUrlFromMedia({
      filename: 'a.mp4',
      mediaUrl: '/media/x/a.mp4?token=1',
    });
    expect(url).toBe('/media/x/a.mp4?token=1&download=1');
  });

  it('triggers single download with anchor click', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await downloadSingle({
      filename: 'video.mp4',
      downloadUrl: '/media/a/video.mp4?download=1',
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('delegates batch preparation to API', async () => {
    const mockedPrepare = vi.mocked(prepareDownloads);
    mockedPrepare.mockResolvedValueOnce({ ok: true, items: [], invalid: [] });
    const result = await prepareBatch([{ dirId: 'd1', filename: 'a.mp4' }]);
    expect(mockedPrepare).toHaveBeenCalledWith([{ dirId: 'd1', filename: 'a.mp4' }]);
    expect(result.ok).toBe(true);
  });

  it('downloads desktop zip and resolves filename from Content-Disposition', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(new Blob(['zip']), {
        status: 200,
        headers: {
          'Content-Disposition': "attachment; filename*=UTF-8''media-%E4%B8%8B%E8%BD%BD.zip",
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const result = await startDesktopBatchZip([{ dirId: 'd1', filename: 'a.mp4' }]);
    expect(result.filename).toBe('media-下载.zip');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledTimes(0);
  });

  it('throws when desktop zip endpoint returns error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(startDesktopBatchZip([{ dirId: 'd1', filename: 'a.mp4' }])).rejects.toThrow('bad request');
  });
});
