import type { ScanProgress } from '../api';
import { resetScanStoreState, useScanStore } from './scanStore';

const sampleProgress: ScanProgress = {
  phase: 'scanning',
  totalDirs: 4,
  currentDir: 2,
  currentDirPath: '/data/media',
  scannedFiles: 30,
  added: 5,
  updated: 3,
  deleted: 1,
};

describe('scanStore', () => {
  beforeEach(() => {
    resetScanStoreState();
  });

  it('updates scan loading/progress/sheet fields', () => {
    let state = useScanStore.getState();
    expect(state.fullScanLoading).toBe(false);
    expect(state.scanProgress).toBeNull();
    expect(state.scanSheetOpen).toBe(false);

    state.setFullScanLoading(true);
    state.setScanProgress(sampleProgress);
    state.setScanSheetOpen(true);

    state = useScanStore.getState();
    expect(state.fullScanLoading).toBe(true);
    expect(state.scanProgress).toEqual(sampleProgress);
    expect(state.scanSheetOpen).toBe(true);
  });

  it('resets scan state', () => {
    useScanStore.getState().setFullScanLoading(true);
    useScanStore.getState().setScanProgress(sampleProgress);
    useScanStore.getState().setScanSheetOpen(true);

    useScanStore.getState().resetScanState();
    const state = useScanStore.getState();
    expect(state.fullScanLoading).toBe(false);
    expect(state.scanProgress).toBeNull();
    expect(state.scanSheetOpen).toBe(false);
  });
});
