import { useState, useCallback } from 'react';
import { message } from 'antd';
import { reindexWithProgress, type ScanProgress } from '../api';

interface UseScanOptions {
  viewMode: 'masonry' | 'album' | 'publisher';
  onReloadTags: () => Promise<void>;
  onLoadAuthorsMeta: () => Promise<void>;
  onLoadResources: (options?: { reset?: boolean }) => Promise<void>;
}

export function useScan({
  viewMode,
  onReloadTags,
  onLoadAuthorsMeta,
  onLoadResources,
}: UseScanOptions) {
  const [fullScanLoading, setFullScanLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanSheetOpen, setScanSheetOpen] = useState(false);

  const notifyScanLocked = useCallback(
    (msg: string) => {
      if (!fullScanLoading) return false;
      message.info(msg);
      return true;
    },
    [fullScanLoading]
  );

  const handleFullScan = useCallback(async () => {
    if (fullScanLoading) return { ok: false, running: true };
    setFullScanLoading(true);
    setScanProgress(null);
    try {
      const r = await reindexWithProgress(
        { force: true },
        (progress) => {
          setScanProgress(progress);
        }
      );
      if (!r.ok) throw new Error(r.error || '全量扫描失败');
      // 扫描完成后：刷新当前视图 + 重新加载标签（tags 可能被回填/更新）
      await onReloadTags();
      if (viewMode === 'publisher') {
        await onLoadAuthorsMeta();
      } else {
        await onLoadResources({ reset: true });
      }
      return r;
    } finally {
      setFullScanLoading(false);
      setScanProgress(null);
    }
  }, [fullScanLoading, viewMode, onReloadTags, onLoadAuthorsMeta, onLoadResources]);

  const handleScanClick = useCallback(() => {
    if (notifyScanLocked('扫描进行中，暂不可重复发起')) return;
    setScanSheetOpen(true);
  }, [notifyScanLocked]);

  const handleScanConfirm = useCallback(async () => {
    setScanSheetOpen(false);
    try {
      await handleFullScan();
    } catch (e) {
      const errorMsg = String(e instanceof Error ? e.message : e);
      message.error({
        content: '扫描失败',
        description: errorMsg || '未知错误，请检查服务端日志',
        duration: 6,
      });
    }
  }, [handleFullScan]);

  return {
    fullScanLoading,
    scanProgress,
    scanSheetOpen,
    notifyScanLocked,
    handleFullScan,
    handleScanClick,
    handleScanConfirm,
    setScanSheetOpen,
  };
}
