import { useState, useEffect, useCallback } from 'react';
import { fetchResources, fetchConfig, saveConfigMediaDirs, fetchTags, fetchAuthors } from '../api';
import type { AppState, PaginationState } from '../types/app';
import type { TagStat } from '../api';

const GROUP_BATCH = 30;
const PAGE_SIZE = 30;

function getInitialState(): Omit<AppState, 'selectionMode' | 'selectedItems' | 'modal' | 'feedMode'> {
  const initialExpanded = (() => {
    try {
      return localStorage.getItem('ui_expanded') === '1';
    } catch {
      return false;
    }
  })();

  const initialViewMode: 'masonry' | 'album' | 'publisher' = (() => {
    try {
      const v = localStorage.getItem('ui_view_mode');
      // 兼容旧值：'tiles' -> 'masonry', 'cards' -> 'album'
      if (v === 'tiles' || v === 'masonry') return 'masonry';
      if (v === 'cards' || v === 'album') return 'album';
      if (v === 'publisher') return 'publisher';
      return 'masonry';
    } catch {
      return 'masonry';
    }
  })();

  const initialTopbarCollapsed = (() => {
    try {
      return localStorage.getItem('ui_topbar_collapsed') === '1';
    } catch {
      return false;
    }
  })();

  const initialSortMode: 'publish' | 'ingest' = (() => {
    try {
      const v = localStorage.getItem('ui_sort_mode');
      return v === 'ingest' ? 'ingest' : 'publish';
    } catch {
      return 'publish';
    }
  })();

  return {
    groups: [],
    activeType: '全部',
    activeDirId: 'all',
    q: '',
    activeTag: '',
    activeTags: [],
    tagFilterMode: 'OR',
    tagStats: [],
    tagStatsLoading: false,
    tagStatsError: null,
    renderLimit: GROUP_BATCH,
    expanded: initialExpanded,
    topbarCollapsed: initialTopbarCollapsed,
    viewMode: initialViewMode,
    sortMode: initialSortMode,
    setup: {
      needed: false,
      mediaDirs: [],
      defaultMediaDirs: [],
      fromEnv: false,
    },
    dirs: [],
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
    favorites: new Set(),
  };
}

export function useAppState(options: { unclassified?: '1' | '0' } = {}) {
  const [state, setState] = useState(getInitialState);

  const loadResources = useCallback(
    async ({
      reset = false,
      overrideFilters = {},
    }: {
      reset?: boolean;
      overrideFilters?: Partial<Pick<AppState, 'q' | 'activeType' | 'activeDirId' | 'sortMode' | 'activeTag'>>;
    } = {}) => {
      const filters = {
        q: overrideFilters.q ?? state.q,
        activeType: overrideFilters.activeType ?? state.activeType,
        activeDirId: overrideFilters.activeDirId ?? state.activeDirId,
        sortMode: overrideFilters.sortMode ?? state.sortMode,
        activeTag: overrideFilters.activeTag ?? state.activeTag,
      };

      const nextPage = reset ? 1 : state.pagination.page + 1;
      const params: Record<string, string | number> = {
        page: nextPage,
        pageSize: PAGE_SIZE,
      };
      if (filters.q.trim()) params.q = filters.q.trim();
      if (filters.activeType && filters.activeType !== '全部') params.type = filters.activeType;
      if (filters.activeDirId && filters.activeDirId !== 'all') params.dirId = filters.activeDirId;
      // 多标签模式下不使用单标签筛选
      if (state.activeTags.length === 0 && filters.activeTag && filters.activeTag.trim()) {
        params.tag = filters.activeTag.trim();
      }
      if (filters.sortMode) params.sort = filters.sortMode;
      if (options.unclassified) params.unclassified = options.unclassified;

      setState((prev) => ({
        ...prev,
        ...(reset ? filters : {}),
        loading: reset ? true : prev.loading,
        loadingMore: reset ? false : true,
        error: null,
        ...(reset ? { renderLimit: GROUP_BATCH, groups: [] } : {}),
      }));

      try {
        const j = await fetchResources(params);
        if (!j.ok) {
          if (j.code === 'NO_MEDIA_DIR') {
            const setup = {
              needed: true,
              mediaDirs: j.mediaDirs || [],
              defaultMediaDirs: j.defaultMediaDirs || [],
              fromEnv: false,
            };
            try {
              const cfg = await fetchConfig();
              if (cfg.ok) setup.fromEnv = Boolean(cfg.fromEnv);
            } catch {
              // ignore
            }
            setState((prev) => ({
              ...prev,
              setup,
              groups: [],
              loading: false,
              loadingMore: false,
              pagination: {
                page: 0,
                pageSize: PAGE_SIZE,
                total: 0,
                totalPages: 0,
                hasMore: false,
                totalItems: 0,
              },
            }));
            return;
          }
          throw new Error(j.error || 'API error');
        }

        setState((prev) => {
          const baseGroups = reset ? [] : prev.groups;
          let nextGroups = [...baseGroups, ...(j.groups || [])];

          // 客户端多标签筛选
          if (prev.activeTags.length > 0) {
            nextGroups = nextGroups.filter((group) => {
              const groupTags = Array.isArray(group.tags) ? group.tags : [];
              const normalizedGroupTags = groupTags.map((t) => `#${t}`);

              if (prev.tagFilterMode === 'AND') {
                // AND 模式：必须包含所有选中的标签
                return prev.activeTags.every((activeTag) => {
                  const normalized = activeTag.startsWith('#') ? activeTag : `#${activeTag}`;
                  return normalizedGroupTags.includes(normalized) || groupTags.includes(activeTag.replace('#', ''));
                });
              } else {
                // OR 模式：包含任一选中的标签即可
                return prev.activeTags.some((activeTag) => {
                  const normalized = activeTag.startsWith('#') ? activeTag : `#${activeTag}`;
                  return normalizedGroupTags.includes(normalized) || groupTags.includes(activeTag.replace('#', ''));
                });
              }
            });
          }

          const pagination: PaginationState = j.pagination
            ? {
                ...j.pagination,
                totalItems: j.pagination.totalItems ?? j.pagination.total,
              }
            : {
                page: reset ? 1 : prev.pagination.page,
                pageSize: PAGE_SIZE,
                total: nextGroups.length,
                totalPages: 1,
                hasMore: false,
                totalItems: nextGroups.reduce((acc, g) => acc + (g.items?.length || 0), 0),
              };

          return {
            ...prev,
            ...(reset ? filters : {}),
            setup: { ...prev.setup, needed: false },
            dirs: j.dirs || prev.dirs,
            groups: nextGroups,
            loading: false,
            loadingMore: false,
            pagination,
            renderLimit: reset ? Math.min(GROUP_BATCH, nextGroups.length) : prev.renderLimit,
          };
        });
      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          loadingMore: false,
          error: String(err instanceof Error ? err.message : err),
        }));
      }
    },
    [
      options.unclassified,
      state.activeDirId,
      state.activeTag,
      state.activeType,
      state.activeTags,
      state.tagFilterMode,
      state.pagination.page,
      state.q,
      state.sortMode,
    ]
  );

  const loadAuthorsMeta = useCallback(async () => {
    // 用 /api/authors 取 dirs + setup 信息（避免 publisher 模式还去加载 groups）
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const r = await fetchAuthors({ page: 1, pageSize: 1 });
      if (!r.ok) {
        if (r.code === 'NO_MEDIA_DIR') {
          const setup = {
            needed: true,
            mediaDirs: r.mediaDirs || [],
            defaultMediaDirs: r.defaultMediaDirs || [],
            fromEnv: false,
          };
          try {
            const cfg = await fetchConfig();
            if (cfg.ok) setup.fromEnv = Boolean(cfg.fromEnv);
          } catch {
            // ignore
          }
          setState((prev) => ({
            ...prev,
            setup,
            groups: [],
            dirs: [],
            loading: false,
            loadingMore: false,
            pagination: {
              page: 0,
              pageSize: PAGE_SIZE,
              total: 0,
              totalPages: 0,
              hasMore: false,
              totalItems: 0,
            },
          }));
          return;
        }
        throw new Error(r.error || 'API error');
      }
      setState((prev) => ({
        ...prev,
        setup: { ...prev.setup, needed: false },
        dirs: r.dirs || prev.dirs,
        loading: false,
        loadingMore: false,
        error: null,
      }));
    } catch (e) {
      setState((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: String(e instanceof Error ? e.message : e),
      }));
    }
  }, []);

  const reloadTags = useCallback(async () => {
    const dirId = state.activeDirId && state.activeDirId !== 'all' ? state.activeDirId : '';
    setState((prev) => ({ ...prev, tagStatsLoading: true, tagStatsError: null }));
    try {
      const r = await fetchTags({ dirId, limit: 800 });
      if (!r.ok) throw new Error(r.error || '加载标签失败');
      const stats = (r.tags || []).filter((x) => x && x.tag) as TagStat[];
      setState((prev) => ({ ...prev, tagStats: stats, tagStatsLoading: false, tagStatsError: null }));
    } catch (e) {
      setState((prev) => ({
        ...prev,
        tagStatsLoading: false,
        tagStatsError: String(e instanceof Error ? e.message : e),
      }));
    }
  }, [state.activeDirId]);

  const refreshWithOverrides = useCallback(
    (overrides: Partial<Pick<AppState, 'q' | 'activeType' | 'activeDirId' | 'sortMode' | 'activeTag'>>) => {
      setState((prev) => ({ ...prev, ...overrides }));
      if (state.viewMode !== 'publisher') {
        loadResources({ reset: true, overrideFilters: overrides });
      }
    },
    [state.viewMode, loadResources]
  );

  const handleSaveMediaDirs = useCallback(
    async (mediaDirs: string[]) => {
      try {
        const j = await saveConfigMediaDirs(mediaDirs);
        if (!j.ok) throw new Error(j.error || '保存失败');
        localStorage.setItem('mediaDirs', mediaDirs.join('\n'));
        await loadResources({ reset: true });
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: String(err instanceof Error ? err.message : err),
        }));
      }
    },
    [loadResources]
  );

  const handleLoadMore = useCallback(() => {
    if (state.loadingMore || state.loading) return;
    const nextLimit = Math.min(state.renderLimit + GROUP_BATCH, state.groups.length);
    if (nextLimit > state.renderLimit) {
      setState((prev) => ({ ...prev, renderLimit: nextLimit }));
      return;
    }
    if (state.pagination.hasMore) {
      loadResources();
    }
  }, [state.loadingMore, state.loading, state.renderLimit, state.groups.length, state.pagination.hasMore, loadResources]);

  const handleViewModeChange = useCallback(
    (mode: 'masonry' | 'album' | 'publisher') => {
      try {
        localStorage.setItem('ui_view_mode', mode);
      } catch {}
      if (mode === 'publisher') {
        // 进入发布者模式：清空已加载 groups，避免大数据常驻导致卡顿/崩溃
        setState((prev) => ({
          ...prev,
          viewMode: mode,
          groups: [],
          renderLimit: GROUP_BATCH,
          pagination: {
            page: 0,
            pageSize: PAGE_SIZE,
            total: 0,
            totalPages: 0,
            hasMore: false,
            totalItems: 0,
          },
        }));
        loadAuthorsMeta();
      } else {
        const leavingPublisher = state.viewMode === 'publisher';
        setState((prev) => ({ ...prev, viewMode: mode }));
        // 仅从 publisher 切回时，重新加载主列表（publisher 模式会清空 groups）
        if (leavingPublisher) loadResources({ reset: true, overrideFilters: {} });
      }
    },
    [loadAuthorsMeta, loadResources, state.viewMode]
  );

  // 初始化加载
  useEffect(() => {
    if (state.viewMode === 'publisher') {
      loadAuthorsMeta();
    } else {
      loadResources({ reset: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 标签统计：默认取当前目录（或全部目录）的 Top tags
  useEffect(() => {
    reloadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeDirId]);

  return {
    state,
    setState,
    loadResources,
    loadAuthorsMeta,
    reloadTags,
    refreshWithOverrides,
    handleSaveMediaDirs,
    handleLoadMore,
    handleViewModeChange,
  };
}
