import { useState, useCallback } from 'react';
import type { MediaGroup, PaginationInfo } from '../api';

const GROUP_BATCH = 30;
const PAGE_SIZE = 30;
const MAX_WINDOW_SIZE = 150; // 约 5 页 * 30 groups/页

interface PaginationState extends PaginationInfo {
  totalItems: number;
}

export interface MediaPaginationState {
  groups: MediaGroup[];
  windowStart: number;
  renderLimit: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  pagination: PaginationState;
}

export function useMediaPagination() {
  const [state, setState] = useState<MediaPaginationState>({
    groups: [],
    windowStart: 0,
    renderLimit: GROUP_BATCH,
    loading: true,
    loadingMore: false,
    error: null,
    pagination: {
      page: 0,
      pageSize: PAGE_SIZE,
      total: 0,
      totalPages: 0,
      hasMore: false,
      totalItems: 0,
    },
  });

  const reset = useCallback(() => {
    setState((prev) => ({
      ...prev,
      groups: [],
      windowStart: 0,
      renderLimit: GROUP_BATCH,
      loading: true,
      loadingMore: false,
      error: null,
    }));
  }, []);

  const appendGroups = useCallback(
    (newGroups: MediaGroup[], paginationInfo: PaginationInfo | null, resetWindow = false) => {
      setState((prev) => {
        const baseGroups = resetWindow ? [] : prev.groups;
        let nextGroups = [...baseGroups, ...newGroups];
        let nextWindowStart = resetWindow ? 0 : prev.windowStart;

        // 滑动窗口：如果超过上限，删除最旧的数据
        if (nextGroups.length > MAX_WINDOW_SIZE) {
          const removeCount = nextGroups.length - MAX_WINDOW_SIZE;
          nextGroups = nextGroups.slice(removeCount);
          nextWindowStart += removeCount;
        }

        const pagination: PaginationState = paginationInfo
          ? {
              ...paginationInfo,
              totalItems: paginationInfo.totalItems ?? paginationInfo.total,
            }
          : {
              page: resetWindow ? 1 : prev.pagination.page,
              pageSize: PAGE_SIZE,
              total: nextGroups.length + nextWindowStart,
              totalPages: 1,
              hasMore: false,
              totalItems: nextGroups.reduce((acc, g) => acc + (g.items?.length || 0), 0),
            };

        return {
          ...prev,
          groups: nextGroups,
          windowStart: nextWindowStart,
          loading: false,
          loadingMore: false,
          pagination,
          renderLimit: resetWindow ? Math.min(GROUP_BATCH, nextGroups.length) : prev.renderLimit,
        };
      });
    },
    []
  );

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  }, []);

  const setLoadingMore = useCallback((loadingMore: boolean) => {
    setState((prev) => ({ ...prev, loadingMore }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const increaseRenderLimit = useCallback(() => {
    setState((prev) => {
      const nextLimit = Math.min(prev.renderLimit + GROUP_BATCH, prev.groups.length);
      return { ...prev, renderLimit: nextLimit };
    });
  }, []);

  return {
    state,
    reset,
    appendGroups,
    setLoading,
    setLoadingMore,
    setError,
    increaseRenderLimit,
  };
}
