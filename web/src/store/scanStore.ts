import { create } from 'zustand';
import type { ScanProgress } from '../api';

type ScanStoreData = {
  fullScanLoading: boolean;
  scanProgress: ScanProgress | null;
  scanSheetOpen: boolean;
};

const initialScanStoreData: ScanStoreData = {
  fullScanLoading: false,
  scanProgress: null,
  scanSheetOpen: false,
};

export interface ScanStoreState extends ScanStoreData {
  setFullScanLoading: (loading: boolean) => void;
  setScanProgress: (progress: ScanProgress | null) => void;
  setScanSheetOpen: (open: boolean) => void;
  resetScanState: () => void;
}

export const useScanStore = create<ScanStoreState>((set) => ({
  ...initialScanStoreData,
  setFullScanLoading: (loading) => set({ fullScanLoading: loading }),
  setScanProgress: (progress) => set({ scanProgress: progress }),
  setScanSheetOpen: (open) => set({ scanSheetOpen: open }),
  resetScanState: () => set(initialScanStoreData),
}));

export function resetScanStoreState() {
  useScanStore.setState(initialScanStoreData);
}
