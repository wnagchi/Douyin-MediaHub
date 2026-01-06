import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Topbar from './components/Topbar';
import MediaGrid from './components/MediaGrid';
import MediaTiles from './components/MediaTiles';
import PreviewModal from './components/PreviewModal';
import SetupCard from './components/SetupCard';
import PublisherView from './components/PublisherView';
import {
  fetchResources,
  fetchConfig,
  saveConfigMediaDirs,
  fetchTags,
  fetchAuthors,
  type MediaGroup,
  type MediaDir,
  type PaginationInfo,
  type TagStat,
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
  activeTag: string;
  tagStats: TagStat[];
  tagStatsLoading: boolean;
  tagStatsError: string | null;
  renderLimit: number;
  expanded: boolean;
  topbarCollapsed: boolean;
  viewMode: 'masonry' | 'album' | 'publisher';
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
  const navigate = useNavigate();
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

  const [state, setState] = useState<AppState>({
    groups: [],
    activeType: '全部',
    activeDirId: 'all',
    q: '',
    activeTag: '',
    tagStats: [],
    tagStatsLoading: false,
    tagStatsError: null,
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
      if (filters.activeTag && filters.activeTag.trim()) params.tag = filters.activeTag.trim();
      if (filters.sortMode) params.sort = filters.sortMode;

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

      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          loadingMore: false,
          error: String(err instanceof Error ? err.message : err),
        }));
      }
    },
    [state.activeDirId, state.activeTag, state.activeType, state.pagination.page, state.q, state.sortMode]
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

  useEffect(() => {
    if (initialViewMode === 'publisher') {
      loadAuthorsMeta();
    } else {
      loadResources({ reset: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // 标签统计：默认取当前目录（或全部目录）的 Top tags
  useEffect(() => {
    reloadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeDirId]);

  const refreshWithOverrides = (
    overrides: Partial<Pick<AppState, 'q' | 'activeType' | 'activeDirId' | 'sortMode' | 'activeTag'>>
  ) => {
    setState((prev) => ({ ...prev, ...overrides }));
    if (state.viewMode !== 'publisher') {
      loadResources({ reset: true, overrideFilters: overrides });
    }
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
    setState((prev) => {
      const group = prev.groups[groupIdx];
      return {
        ...prev,
        modal: {
          open: true,
          groupIdx,
          itemIdx: feedMode ? getPreferredItemIndex(group) : itemIdx,
        },
        feedMode,
      };
    });
  };
  const handleCloseModal = () => {
    setState((prev) => ({
      ...prev,
      modal: { ...prev.modal, open: false },
      feedMode: false,
    }));
  };

  const handleFeedModeChange = (newFeedMode: boolean) => {
    // 预览弹层 -> 独立沉浸页（路由化）
    if (!newFeedMode) return;
    setState((prev) => {
      if (!prev.modal.open) return prev;
      const group = prev.groups[prev.modal.groupIdx];
      const item = group?.items?.[prev.modal.itemIdx];
      if (!item?.dirId || !item.filename) return prev;

      const qs = new URLSearchParams();
      qs.set('fid', item.dirId);
      qs.set('fn', item.filename);
      qs.set('g', String(prev.modal.groupIdx));
      qs.set('i', String(prev.modal.itemIdx));
      if (prev.q.trim()) qs.set('q', prev.q.trim());
      if (prev.activeType && prev.activeType !== '全部') qs.set('type', prev.activeType);
      if (prev.activeDirId && prev.activeDirId !== 'all') qs.set('dirId', prev.activeDirId);
      if (prev.activeTag && prev.activeTag.trim()) qs.set('tag', prev.activeTag.trim());
      if (prev.sortMode) qs.set('sort', prev.sortMode);

      // 先关弹层再跳转（避免残留 body scroll lock 等副作用）
      queueMicrotask(() => navigate({ pathname: '/feed', search: `?${qs.toString()}` }));
      return {
        ...prev,
        modal: { ...prev.modal, open: false },
        feedMode: false,
      };
    });
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

  const handleModalSetItemIdx = (nextIdx: number) => {
    setState((prev) => {
      if (!prev.modal.open) return prev;
      const group = prev.groups[prev.modal.groupIdx];
      if (!group) return prev;
      const items = group.items || [];
      const clamped = Math.max(0, Math.min(nextIdx, items.length - 1));
      if (clamped === prev.modal.itemIdx) return prev;
      return { ...prev, modal: { ...prev.modal, itemIdx: clamped } };
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

  const visibleCount = state.viewMode === 'publisher' ? 0 : Math.min(state.renderLimit, state.groups.length);
  const visibleItems: MediaGridItem[] =
    state.viewMode === 'publisher'
      ? []
      : state.groups.slice(0, visibleCount).map((group, groupIdx) => ({ group, groupIdx }));

  const sections: MediaGridSection[] =
    state.viewMode === 'album' ? [{ key: 'all', title: '', items: visibleItems }] : [];

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
        activeTag={state.activeTag}
        tagStats={state.tagStats}
        tagStatsLoading={state.tagStatsLoading}
        tagStatsError={state.tagStatsError}
        onReloadTags={reloadTags}
        dirs={state.dirs}
        expanded={state.expanded}
        collapsed={state.topbarCollapsed}
        viewMode={state.viewMode}
        sortMode={state.sortMode}
        onQChange={(q) => refreshWithOverrides({ q })}
        onTypeChange={(type) => refreshWithOverrides({ activeType: type })}
        onDirChange={(dirId) => refreshWithOverrides({ activeDirId: dirId })}
        onTagChange={(tag) => refreshWithOverrides({ activeTag: tag })}
        onFeedClick={() => {
          if (!state.groups.length) return;
          const g0 = state.groups[0];
          const idx = getPreferredItemIndex(g0);
          const item = g0?.items?.[idx >= 0 ? idx : 0];
          if (!item?.dirId || !item.filename) return;
          const qs = new URLSearchParams();
          qs.set('fid', item.dirId);
          qs.set('fn', item.filename);
          qs.set('g', '0');
          qs.set('i', String(idx >= 0 ? idx : 0));
          if (state.q.trim()) qs.set('q', state.q.trim());
          if (state.activeType && state.activeType !== '全部') qs.set('type', state.activeType);
          if (state.activeDirId && state.activeDirId !== 'all') qs.set('dirId', state.activeDirId);
          if (state.activeTag && state.activeTag.trim()) qs.set('tag', state.activeTag.trim());
          if (state.sortMode) qs.set('sort', state.sortMode);
          navigate({ pathname: '/feed', search: `?${qs.toString()}` });
        }}
        onRefresh={() => {
          if (state.viewMode === 'publisher') return loadAuthorsMeta();
          return loadResources({ reset: true });
        }}
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
        onViewModeChange={(mode: 'masonry' | 'album' | 'publisher') => {
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
              modal: { ...prev.modal, open: false },
              feedMode: false,
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
        }}
        onSortModeChange={(mode) => {
          try {
            localStorage.setItem('ui_sort_mode', mode);
          } catch {}
          refreshWithOverrides({ sortMode: mode });
        }}
      />
      <main className={`container ${state.expanded ? 'expanded' : ''}`}>
        {(state.viewMode !== 'publisher' || state.loading || state.error || state.setup.needed) && (
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
                        )}/${totalItems}  |  filter: ${state.activeType}  |  tag: ${state.activeTag || '-'}  |  q: ${
                          state.q || '-'
                        }`;
                      })()}
            </div>
          </div>
        )}

        {state.setup.needed ? (
          <SetupCard
            setup={state.setup}
            onSave={handleSaveMediaDirs}
          />
        ) : state.viewMode === 'publisher' ? (
          <PublisherView
            q={state.q}
            activeType={state.activeType}
            activeDirId={state.activeDirId}
            activeTag={state.activeTag}
            sortMode={state.sortMode}
            expanded={state.expanded}
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
            onTagClick={(tag) => refreshWithOverrides({ activeTag: tag })}
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
          onSetItemIdx={handleModalSetItemIdx}
          onGroupStep={handleGroupStep}
          onFeedModeChange={handleFeedModeChange}
          onReload={() => loadResources({ reset: true })}
        />
      )}
    </>
  );
}

export default App;
