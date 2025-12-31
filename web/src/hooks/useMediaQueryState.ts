import { useState, useEffect, useCallback } from 'react';

export interface MediaQueryState {
  q: string;
  activeType: string;
  activeDirId: string;
  sortMode: 'publish' | 'ingest';
}

export function useMediaQueryState() {
  const initialSortMode: 'publish' | 'ingest' = (() => {
    try {
      const v = localStorage.getItem('ui_sort_mode');
      return v === 'ingest' ? 'ingest' : 'publish';
    } catch {
      return 'publish';
    }
  })();

  const [state, setState] = useState<MediaQueryState>({
    q: '',
    activeType: '全部',
    activeDirId: 'all',
    sortMode: initialSortMode,
  });

  const updateState = useCallback((updates: Partial<MediaQueryState>) => {
    setState((prev) => {
      const next = { ...prev, ...updates };
      // 持久化 sortMode
      if (updates.sortMode !== undefined) {
        try {
          localStorage.setItem('ui_sort_mode', updates.sortMode);
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, []);

  return [state, updateState] as const;
}
