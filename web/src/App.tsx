import { useState, useEffect, useCallback } from 'react';
import Topbar from './components/Topbar';
import MediaGrid from './components/MediaGrid';
import MediaTiles from './components/MediaTiles';
import PreviewModal from './components/PreviewModal';
import SetupCard from './components/SetupCard';
import {
  fetchResources,
  fetchConfig,
  saveConfigMediaDirs,
  type MediaGroup,
  type MediaDir,
  type PaginationInfo,
} from './api';
import { getPreferredItemIndex } from './utils/media';
import type { MediaGridItem, MediaGridSection } from './components/MediaGrid';
import type { TileItem } from './components/MediaTiles';

const GROUP_BATCH = 30;
const PAGE_SIZE = 30;

interface PaginationState extends PaginationInfo {
  totalItems: number;
}

interface AppState {
  groups: MediaGroup[];
  activeType: string;
  activeDirId: string;
  q: string;
  renderLimit: number;
  expanded: boolean;
  topbarCollapsed: boolean;
  viewMode: 'masonry' | 'album';
  sortMode: 'publish' | 'ingest';
  modal: {
    open: boolean;
    groupIdx: number;
    itemIdx: number;
  };
  feedMode: boolean;
  setup: {
    needed: boolean;
    mediaDirs: string[];
    defaultMediaDirs: string[];
    fromEnv: boolean;
  };
  dirs: MediaDir[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  pagination: PaginationState;
}

function App() {
  const initialExpanded = (() => {
    try {
      return localStorage.getItem('ui_expanded') === '1';
    } catch {
      return false;
    }
  })();
  const initialViewMode: 'masonry' | 'album' = (() => {
    try {
      const v = localStorage.getItem('ui_view_mode');
      // 兼容旧值：'tiles' -> 'masonry', 'cards' -> 'album'
      if (v === 'tiles' || v === 'masonry') return 'masonry';
      if (v === 'cards' || v === 'album') return 'album';
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

  const [state, setState] = useState<AppState>({
    groups: [],
    activeType: '全部',
    activeDirId: 'all',
    q: '',
    renderLimit: GROUP_BATCH,
    expanded: initialExpanded,
    topbarCollapsed: initialTopbarCollapsed,
    viewMode: initialViewMode,
    sortMode: initialSortMode,
    modal: { open: false, groupIdx: 0, itemIdx: 0 },
    feedMode: false,
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
  });

  const loadResources = useCallback(
    async ({
      reset = false,
      overrideFilters = {},
    }: {
      reset?: boolean;
      overrideFilters?: Partial<Pick<AppState, 'q' | 'activeType' | 'activeDirId' | 'sortMode'>>;
    } = {}) => {
      const filters = {
        q: overrideFilters.q ?? state.q,
        activeType: overrideFilters.activeType ?? state.activeType,
        activeDirId: overrideFilters.activeDirId ?? state.activeDirId,
        sortMode: overrideFilters.sortMode ?? state.sortMode,
      };

      const nextPage = reset ? 1 : state.pagination.page + 1;
      const params: Record<string, string | number> = {
        page: nextPage,
        pageSize: PAGE_SIZE,
      };
      if (filters.q.trim()) params.q = filters.q.trim();
      if (filters.activeType && filters.activeType !== '全部') params.type = filters.activeType;
      if (filters.activeDirId && filters.activeDirId !== 'all') params.dirId = filters.activeDirId;
      if (filters.sortMode) params.sort = filters.sortMode;

      setState((prev) => ({
        ...prev,
        ...(reset ? filters : {}),
        loading: reset ? true : prev.loading,
        loadingMore: reset ? false : true,
        error: null,
        ...(reset ? { renderLimit: GROUP_BATCH, groups: [] } : {}),
      }));

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/16b8df7c-fc7a-42ad-880f-3b84c1e70f04', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'debug-session',
          runId: 'run1',
          hypothesisId: 'H1',
          location: 'App.tsx:120',
          message: 'loadResources start',
          data: {
            reset,
            nextPage,
            filters,
            params,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

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
          const nextGroups = [...baseGroups, ...(j.groups || [])];
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

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/16b8df7c-fc7a-42ad-880f-3b84c1e70f04', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'debug-session',
            runId: 'run1',
            hypothesisId: 'H2',
            location: 'App.tsx:179',
            message: 'loadResources success',
            data: {
              reset,
              returned: j.groups?.length || 0,
              pagination: j.pagination,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          loadingMore: false,
          error: String(err instanceof Error ? err.message : err),
        }));
      }
    },
    [state.activeDirId, state.activeType, state.pagination.page, state.q, state.sortMode]
  );

  useEffect(() => {
    loadResources({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshWithOverrides = (overrides: Partial<Pick<AppState, 'q' | 'activeType' | 'activeDirId' | 'sortMode'>>) => {
    setState((prev) => ({ ...prev, ...overrides }));
    loadResources({ reset: true, overrideFilters: overrides });
  };

  const handleSaveMediaDirs = async (mediaDirs: string[]) => {
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
  };

  const handleLoadMore = () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/16b8df7c-fc7a-42ad-880f-3b84c1e70f04', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'H3',
        location: 'App.tsx:210',
        message: 'handleLoadMore invoked',
        data: {
          loading: state.loading,
          loadingMore: state.loadingMore,
          renderLimit: state.renderLimit,
          groupsLength: state.groups.length,
          pagination: state.pagination,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    if (state.loadingMore || state.loading) return;
    const nextLimit = Math.min(state.renderLimit + GROUP_BATCH, state.groups.length);
    if (nextLimit > state.renderLimit) {
      setState((prev) => ({ ...prev, renderLimit: nextLimit }));
      return;
    }
    if (state.pagination.hasMore) {
      loadResources();
    }
  };

  const handleOpenModal = (groupIdx: number, itemIdx: number, feedMode = false) => {
    setState((prev) => ({
      ...prev,
      modal: {
        open: true,
        groupIdx,
        itemIdx: feedMode ? getPreferredItemIndex(prev.groups[groupIdx]) : itemIdx,
      },
      feedMode,
    }));
  };
  const handleCloseModal = () => {
    setState((prev) => ({
      ...prev,
      modal: { ...prev.modal, open: false },
      feedMode: false,
    }));
  };

  const handleFeedModeChange = (newFeedMode: boolean) => {
    setState((prev) => ({
      ...prev,
      feedMode: newFeedMode,
    }));
  };

  const handleModalStep = (delta: number) => {
    setState((prev) => {
      if (!prev.modal.open) return prev;
      const group = prev.groups[prev.modal.groupIdx];
      if (!group) return prev;
      const items = group.items || [];
      const newIdx = Math.max(0, Math.min(prev.modal.itemIdx + delta, items.length - 1));
      return { ...prev, modal: { ...prev.modal, itemIdx: newIdx } };
    });
  };

  const handleGroupStep = (delta: number) => {
    setState((prev) => {
      if (!prev.modal.open || !prev.feedMode) return prev;
      const next = Math.max(0, Math.min(prev.modal.groupIdx + delta, prev.groups.length - 1));
      if (next === prev.modal.groupIdx) return prev;
      const g = prev.groups[next];
      const firstVideoIdx = getPreferredItemIndex(g);
      return {
        ...prev,
        modal: { groupIdx: next, itemIdx: firstVideoIdx >= 0 ? firstVideoIdx : 0, open: true },
      };
    });
  };

  const visibleCount = Math.min(state.renderLimit, state.groups.length);
  const visibleItems: MediaGridItem[] = state.groups.slice(0, visibleCount).map((group, groupIdx) => ({ group, groupIdx }));

  const sections: MediaGridSection[] = (() => {
    // 合集模式：直接返回所有 items，不再按 author 分组
    return [{ key: 'all', title: '', items: visibleItems }];
  })();

  const tileItems: TileItem[] = (() => {
    if (state.viewMode !== 'masonry') return [];
    const list: TileItem[] = [];
    for (const { group, groupIdx } of visibleItems) {
      const items = Array.isArray(group.items) ? group.items : [];
      for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
        const item = items[itemIdx];
        if (!item) continue;
        list.push({ groupIdx, itemIdx, group, item });
      }
    }
    return list;
  })();

  return (
    <>
      <div className="bg"></div>
      <Topbar
        q={state.q}
        activeType={state.activeType}
        activeDirId={state.activeDirId}
        dirs={state.dirs}
        expanded={state.expanded}
        collapsed={state.topbarCollapsed}
        viewMode={state.viewMode}
        sortMode={state.sortMode}
        onQChange={(q) => refreshWithOverrides({ q })}
        onTypeChange={(type) => refreshWithOverrides({ activeType: type })}
        onDirChange={(dirId) => refreshWithOverrides({ activeDirId: dirId })}
        onFeedClick={() => {
          if (state.groups.length) handleOpenModal(0, 0, true);
        }}
        onRefresh={() => loadResources({ reset: true })}
        onExpandedChange={(expanded) => {
          try {
            localStorage.setItem('ui_expanded', expanded ? '1' : '0');
          } catch {}
          setState((prev) => ({ ...prev, expanded }));
        }}
        onCollapsedChange={(collapsed) => {
          try {
            localStorage.setItem('ui_topbar_collapsed', collapsed ? '1' : '0');
          } catch {}
          setState((prev) => ({ ...prev, topbarCollapsed: collapsed }));
        }}
        onViewModeChange={(mode: 'masonry' | 'album') => {
          try {
            localStorage.setItem('ui_view_mode', mode);
          } catch {}
          setState((prev) => ({ ...prev, viewMode: mode }));
        }}
        onSortModeChange={(mode) => {
          try {
            localStorage.setItem('ui_sort_mode', mode);
          } catch {}
          refreshWithOverrides({ sortMode: mode });
        }}
      />
      <main className={`container ${state.expanded ? 'expanded' : ''}`}>
        <div className="metaRow">
          <div className="meta">
            {state.loading
              ? '加载中…'
              : state.error
                ? `加载失败：${state.error}`
                : state.setup.needed
                  ? '未检测到 media 目录：请先配置资源目录（绝对路径）'
                  : (() => {
                      const displayed = visibleCount;
                      const totalGroups = state.pagination.total || state.groups.length;
                      const loadedItems = state.groups.reduce((acc, g) => acc + (g.items?.length || 0), 0);
                      const totalItems = state.pagination.totalItems || loadedItems;
                      return `groups: ${displayed}/${totalGroups}  |  items: ${Math.min(
                        loadedItems,
                        totalItems
                      )}/${totalItems}  |  filter: ${state.activeType}  |  q: ${state.q || '-'}`;
                    })()}
          </div>
        </div>

        {state.setup.needed ? (
          <SetupCard
            setup={state.setup}
            onSave={handleSaveMediaDirs}
          />
        ) : state.viewMode === 'masonry' ? (
          <MediaTiles
            items={tileItems}
            expanded={state.expanded}
            hasMore={state.pagination.hasMore || state.renderLimit < state.groups.length}
            totalGroups={state.pagination.total || state.groups.length}
            loading={state.loading}
            loadingMore={state.loadingMore}
            onLoadMore={handleLoadMore}
            onOpen={(groupIdx, itemIdx) => handleOpenModal(groupIdx, itemIdx, false)}
          />
        ) : (
          <MediaGrid
            sections={sections}
            expanded={state.expanded}
            hasMore={state.pagination.hasMore || state.renderLimit < state.groups.length}
            totalGroups={state.pagination.total || state.groups.length}
            loading={state.loading}
            loadingMore={state.loadingMore}
            onLoadMore={handleLoadMore}
            onThumbClick={(groupIdx, itemIdx) => handleOpenModal(groupIdx, itemIdx, false)}
          />
        )}
      </main>

      {state.modal.open && (
        <PreviewModal
          groups={state.groups}
          groupIdx={state.modal.groupIdx}
          itemIdx={state.modal.itemIdx}
          feedMode={state.feedMode}
          onClose={handleCloseModal}
          onStep={handleModalStep}
          onGroupStep={handleGroupStep}
          onFeedModeChange={handleFeedModeChange}
        />
      )}
    </>
  );
}

export default App;
