import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import PreviewModal from '../components/PreviewModal';
import FeedOverlay from '../components/FeedOverlay';
import { fetchResources, type MediaGroup, type PaginationInfo } from '../api';
import { getPreferredItemIndex } from '../utils/media';

type PageState = {
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  groups: MediaGroup[];
  pagination: PaginationInfo | null;
  // current selection
  groupIdx: number;
  itemIdx: number;
  found: boolean;
};

type FlatItem = {
  id: string;
  groupIdx: number;
  itemIdx: number;
  group: MediaGroup;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function encodeFn(fn: string) {
  // URLSearchParams 会处理大部分编码；这里保持一致性
  return fn;
}

export default function FeedPage() {
  const navigate = useNavigate();
  const navType = useNavigationType();
  const [sp] = useSearchParams();

  const filters = useMemo(() => {
    const q = (sp.get('q') || '').trim();
    const type = (sp.get('type') || '').trim(); // '全部' 时可为空
    const dirId = (sp.get('dirId') || '').trim(); // 'all' 时可为空
    const tag = (sp.get('tag') || '').trim();
    const sort = (sp.get('sort') || '').trim() as 'publish' | 'ingest' | '';
    return { q, type, dirId, tag, sort: sort === 'ingest' ? 'ingest' : 'publish' };
  }, [sp]);

  const target = useMemo(() => {
    // fid/fn: 稳定定位（避免仅依赖 groupIdx/itemIdx）
    const fid = (sp.get('fid') || '').trim();
    const fn = sp.get('fn') || '';
    const g = Number(sp.get('g') || '0');
    const i = Number(sp.get('i') || '0');
    return {
      fid: fid || '',
      fn: fn || '',
      g: Number.isFinite(g) ? g : 0,
      i: Number.isFinite(i) ? i : 0,
    };
  }, [sp]);

  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);
  // 注意：g/i 会在滑动时频繁变化（我们会 replace 到 URL），但这不应触发“清空并重拉”。
  // 所以 bootstrapKey 只看稳定定位：fid+fn + filters。
  const bootstrapKey = filtersKey; // Only depend on filters, not fid/fn which change on sliding

  const [state, setState] = useState<PageState>({
    loading: true,
    loadingMore: false,
    error: null,
    groups: [],
    pagination: null,
    groupIdx: 0,
    itemIdx: 0,
    found: false,
  });

  const requestSeq = useRef(0);
  const stateRef = useRef<PageState>(state);
  const lastBootstrapKeyRef = useRef<string>('');
  const inFlightPagesRef = useRef<Set<number>>(new Set());
  const flatItemsRef = useRef<FlatItem[]>([]);
  const shownInitialRef = useRef(false);
  const loadedPageRef = useRef(1); // Track the highest loaded page
  const isSlidingRef = useRef(false); // Track if user is sliding in immersive mode

  // keep latest state for async flows (avoid stale closure on iOS fast swipes)
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // immersive route: force solid background to avoid iOS top/bottom "white flash"
  useEffect(() => {
    document.body.classList.add('immersiveRoute');
    return () => {
      document.body.classList.remove('immersiveRoute');
    };
  }, []);

  const flatItems = useMemo(() => {
    const list: FlatItem[] = [];
    state.groups.forEach((group, groupIdx) => {
      const items = group?.items || [];
      items.forEach((item, itemIdx) => {
        if (!item) return;
        const id = item.dirId && item.filename ? `${item.dirId}|${item.filename}` : '';
        list.push({ id, groupIdx, itemIdx, item, group });
      });
    });
    return list;
  }, [state.groups]);

  useEffect(() => {
    flatItemsRef.current = flatItems;
  }, [flatItems]);

  useEffect(() => {
    // #region agent log
    const runId = 'run1';
    const ids = flatItems.map((x) => x.id);
    const emptyIdCount = ids.filter((x) => !x).length;
    const uniq = new Set(ids.filter((x) => x));
    const nonEmptyCount = ids.length - emptyIdCount;
    const duplicateNonEmptyCount = nonEmptyCount - uniq.size;
    fetch('http://127.0.0.1:7243/ingest/0fb33d7e-80b0-4097-89dd-e057fc4b7a5a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId,
        hypothesisId: 'C',
        location: 'web/src/pages/FeedPage.tsx:flatItemsMetrics',
        message: 'flatItems metrics',
        data: {
          flatLen: flatItems.length,
          emptyIdCount,
          nonEmptyCount,
          duplicateNonEmptyCount,
          groupsLen: state.groups.length,
          groupIdx: state.groupIdx,
          itemIdx: state.itemIdx,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [flatItems, state.groups.length, state.groupIdx, state.itemIdx]);

  const getFlatIndex = useCallback((groups: MediaGroup[], groupIdx: number, itemIdx: number, list: FlatItem[]) => {
    if (!list.length) return -1;
    const g = groups[groupIdx];
    const it = g?.items?.[itemIdx];
    if (it?.dirId && it.filename) {
      const id = `${it.dirId}|${it.filename}`;
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === id) return i;
      }
    }
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (entry.groupIdx === groupIdx && entry.itemIdx === itemIdx) return i;
    }
    return -1;
  }, []);

  // 从 flatIndex 获取对应的 groupIdx 和 itemIdx
  const getGroupItemFromFlatIndex = useCallback((flatIndex: number) => {
    const item = flatItems[flatIndex];
    if (!item) return null;
    return { groupIdx: item.groupIdx, itemIdx: item.itemIdx };
  }, [flatItems]);


  const findTarget = useCallback(
    (groups: MediaGroup[]) => {
      // 1) 优先按 fid+fn 精确定位
      if (target.fid && target.fn) {
        for (let gi = 0; gi < groups.length; gi++) {
          const g = groups[gi];
          const items = g?.items || [];
          for (let ii = 0; ii < items.length; ii++) {
            const it = items[ii];
            if (!it) continue;
            if ((it.dirId || '') === target.fid && it.filename === target.fn) {
              return { groupIdx: gi, itemIdx: ii, found: true };
            }
          }
        }
      }

      // 2) 兜底：按 g/i
      if (groups.length) {
        const gi = clamp(target.g, 0, groups.length - 1);
        const items = groups[gi]?.items || [];
        const ii = clamp(target.i, 0, Math.max(0, items.length - 1));
        return { groupIdx: gi, itemIdx: ii, found: false };
      }
      return null;
    },
    [target.fid, target.fn, target.g, target.i]
  );

  const fetchPage = useCallback(
    async (page: number) => {
      const params: Record<string, string | number> = { page, pageSize: 30 };
      if (filters.q) params.q = filters.q;
      if (filters.type) params.type = filters.type;
      if (filters.dirId) params.dirId = filters.dirId;
      if (filters.tag) params.tag = filters.tag;
      if (filters.sort) params.sort = filters.sort;
      // Use cache strategy instead of force refresh
      return fetchResources(params, { allowStaleWhenOffline: true });
    },
    [filters.dirId, filters.q, filters.sort, filters.tag, filters.type]
  );

  // 首次加载/filters变化：拉取直到找到目标（或达到上限）
  useEffect(() => {
    let cancelled = false;
    // 关键：只要 fid/fn+filters 没变，就不要清空并重拉。
    // 但在 StrictMode 首次双执行时，如果还在 loading，允许重新触发，避免被清空导致卡住。
    // Also skip if user is sliding in immersive mode (URL changes from sliding, not navigation)
    if (lastBootstrapKeyRef.current === bootstrapKey && !stateRef.current.loading) {
      return;
    }
    if (isSlidingRef.current) {
      // User is sliding in immersive mode, don't reset state
      return;
    }

    lastBootstrapKeyRef.current = bootstrapKey;
    inFlightPagesRef.current.clear();
    shownInitialRef.current = false;
    loadedPageRef.current = 1; // Reset page tracking on new bootstrap

    const seq = ++requestSeq.current;

    setState((prev) => ({
      ...prev,
      loading: true,
      loadingMore: false,
      error: null,
      groups: [],
      pagination: null,
      groupIdx: 0,
      itemIdx: 0,
      found: false,
    }));

    (async () => {
      const MAX_PAGES = 20;
      let page = 1;
      const all: MediaGroup[] = [];
      let pagination: PaginationInfo | null = null;

      while (!cancelled && page <= MAX_PAGES) {
        const r = await fetchPage(page);
        if (cancelled || requestSeq.current !== seq) return;
        if (!r.ok) throw new Error(r.error || 'API error');

        const groups = r.groups || [];
        all.push(...groups);
        pagination = r.pagination || null;

        const found = findTarget(all);
        if (found) {
          loadedPageRef.current = page; // Update loaded page
          setState({
            loading: false,
            loadingMore: false,
            error: null,
            groups: all,
            pagination,
            groupIdx: found.groupIdx,
            itemIdx: found.itemIdx,
            found: found.found,
          });
          return;
        }

        if (!shownInitialRef.current && all.length) {
          const fallback = findTarget(all);
          if (fallback) {
            setState({
              loading: false,
              loadingMore: false,
              error: null,
              groups: all,
              pagination,
              groupIdx: fallback.groupIdx,
              itemIdx: fallback.itemIdx,
              found: false,
            });
            shownInitialRef.current = true;
          }
        }

        if (!pagination?.hasMore) break;
        page += 1;
      }

      // 没找到也展示：按 g/i（或空态）
      loadedPageRef.current = page; // Update loaded page
      const fallback = findTarget(all);
      if (fallback) {
        setState({
          loading: false,
          loadingMore: false,
          error: null,
          groups: all,
          pagination,
          groupIdx: fallback.groupIdx,
          itemIdx: fallback.itemIdx,
          found: false,
        });
      } else {
        setState({
          loading: false,
          loadingMore: false,
          error: '未加载到任何内容（可能筛选条件无结果）',
          groups: [],
          pagination,
          groupIdx: 0,
          itemIdx: 0,
          found: false,
        });
      }
    })().catch((e) => {
      if (cancelled || requestSeq.current !== seq) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: String(e instanceof Error ? e.message : e),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [bootstrapKey, fetchPage, findTarget]);

  const loadMoreIfNeeded = useCallback(async () => {
    // 同步 guard：避免 loading=true 时仍继续发请求导致并发/重复追加
    const cur = stateRef.current;
    // #region agent log
    const list0 = flatItemsRef.current;
    const curIdx0 = getFlatIndex(cur.groups, cur.groupIdx, cur.itemIdx, list0);
    const remaining0 = curIdx0 >= 0 ? list0.length - curIdx0 : null;
    fetch('http://127.0.0.1:7243/ingest/0fb33d7e-80b0-4097-89dd-e057fc4b7a5a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'run2',
        hypothesisId: 'F',
        location: 'web/src/pages/FeedPage.tsx:loadMoreIfNeeded',
        message: 'loadMoreIfNeeded called',
        data: {
          loading: cur.loading,
          loadingMore: cur.loadingMore,
          hasMore: !!cur.pagination?.hasMore,
          curIdx: curIdx0,
          listLen: list0.length,
          remaining: remaining0,
          loadedPage: loadedPageRef.current,
          inFlightCount: inFlightPagesRef.current.size,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (cur.loading || cur.loadingMore) return;
    if (!cur.pagination?.hasMore) return;
    
    const list = flatItemsRef.current;
    const curIdx = getFlatIndex(cur.groups, cur.groupIdx, cur.itemIdx, list);
    if (curIdx < 0) return;
    // near the end: prefetch next page
    if (list.length - curIdx > 18) return;

    // Use ref to track loaded page (avoid stale closure)
    const nextPage = loadedPageRef.current + 1;
    if (inFlightPagesRef.current.has(nextPage)) return;
    
    setState((prev) => ({ ...prev, loadingMore: true }));
    inFlightPagesRef.current.add(nextPage);

    const seq = requestSeq.current;

    try {
      const r = await fetchPage(nextPage);
      if (requestSeq.current !== seq) return;
      if (!r.ok) throw new Error(r.error || 'API error');
      
      // Update loadedPageRef immediately after successful fetch
      loadedPageRef.current = nextPage;
      
      setState((prev) => ({
        ...prev,
        loadingMore: false,
        groups: [...prev.groups, ...(r.groups || [])],
        pagination: r.pagination || prev.pagination,
      }));
    } catch (e) {
      if (requestSeq.current !== seq) return;
      setState((prev) => ({
        ...prev,
        loadingMore: false,
        error: String(e instanceof Error ? e.message : e),
      }));
    } finally {
      inFlightPagesRef.current.delete(nextPage);
    }
  }, [fetchPage, getFlatIndex]);

  // 列表滑到靠后时预取更多
  useEffect(() => {
    if (!state.groups.length) return;
    if (!state.pagination?.hasMore) return;
    const list = flatItemsRef.current;
    const curIdx = getFlatIndex(state.groups, state.groupIdx, state.itemIdx, list);
    if (curIdx < 0) return;
    // 提前一点预取，避免用户快速上滑直接撞到“已加载末尾”
    if (list.length - curIdx <= 18) {
      loadMoreIfNeeded();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.groupIdx, state.itemIdx, state.groups.length, state.pagination?.hasMore]);

  // 同步 URL（replace），让“复制链接”永远指向当前媒体
  useEffect(() => {
    const g = state.groups[state.groupIdx];
    const it = g?.items?.[state.itemIdx];
    if (!it?.dirId || !it.filename) return;

    const next = new URLSearchParams(sp);
    next.set('fid', it.dirId);
    next.set('fn', encodeFn(it.filename));
    next.set('g', String(state.groupIdx));
    next.set('i', String(state.itemIdx));

    const nextStr = next.toString();
    const curStr = sp.toString();
    if (nextStr !== curStr) {
      navigate({ pathname: '/feed', search: `?${nextStr}` }, { replace: true });
      // Reset sliding flag after navigate completes (next tick)
      requestAnimationFrame(() => {
        isSlidingRef.current = false;
      });
    } else {
      // No URL change needed, reset flag immediately
      isSlidingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, state.groupIdx, state.itemIdx, state.groups]);

  const onClose = () => navigate(-1);
  const flatIndex = getFlatIndex(state.groups, state.groupIdx, state.itemIdx, flatItems);
  // 在“合集上下切换”模式下，feedListMeta 表示合集序号
  const feedListMeta = state.groups.length ? { index: state.groupIdx, total: state.groups.length } : undefined;
  const currentGroup = state.groups[state.groupIdx];
  const currentItem = currentGroup?.items?.[state.itemIdx];

  // 处理标签点击：刷新 Feed 并应用标签筛选
  const handleTagClick = useCallback((tag: string) => {
    const next = new URLSearchParams(sp);
    next.set('tag', tag);
    navigate({ pathname: '/feed', search: `?${next.toString()}` });
  }, [navigate, sp]);

  const stepItemInGroup = useCallback((delta: number) => {
    setState((prev) => {
      const group = prev.groups[prev.groupIdx];
      const items = group?.items || [];
      if (!items.length) return prev;
      const nextIdx = clamp(prev.itemIdx + delta, 0, items.length - 1);
      if (nextIdx === prev.itemIdx) return prev;
      return { ...prev, itemIdx: nextIdx };
    });
  }, []);

  const stepGroup = useCallback((delta: number) => {
    isSlidingRef.current = true; // Mark as sliding to prevent bootstrap reset
    setState((prev) => {
      if (!prev.groups.length) return prev;
      const nextGroupIdx = clamp(prev.groupIdx + delta, 0, prev.groups.length - 1);
      if (nextGroupIdx === prev.groupIdx) return prev;
      const nextGroup = prev.groups[nextGroupIdx];
      const nextItemIdx = getPreferredItemIndex(nextGroup);
      return { ...prev, groupIdx: nextGroupIdx, itemIdx: nextItemIdx };
    });
  }, []);

  const setGroupIdx = useCallback((nextGroupIdx: number) => {
    isSlidingRef.current = true; // Mark as sliding to prevent bootstrap reset
    setState((prev) => {
      if (!prev.groups.length) return prev;
      const clamped = clamp(nextGroupIdx, 0, prev.groups.length - 1);
      if (clamped === prev.groupIdx) return prev;
      const nextGroup = prev.groups[clamped];
      const nextItemIdx = getPreferredItemIndex(nextGroup);
      return { ...prev, groupIdx: clamped, itemIdx: nextItemIdx };
    });
  }, []);

  if (state.loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.75)' }}>
        加载沉浸模式…
      </div>
    );
  }

  if (!state.groups.length) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.75)' }}>
        <div style={{ textAlign: 'center' }}>
          <div>无可用内容</div>
          {state.error && <div style={{ marginTop: 8, opacity: 0.8 }}>{state.error}</div>}
          <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate(-1)}>
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {state.error && (
        <div style={{ position: 'fixed', top: 8, left: 8, right: 8, zIndex: 9999, pointerEvents: 'none' }}>
          <div
            style={{
              margin: '0 auto',
              maxWidth: 900,
              background: 'rgba(255, 99, 132, .18)',
              border: '1px solid rgba(255, 99, 132, .35)',
              color: 'rgba(255,255,255,.9)',
              padding: '8px 10px',
              borderRadius: 12,
              fontSize: 12,
              pointerEvents: 'auto',
            }}
          >
            {state.error}
          </div>
        </div>
      )}

      <PreviewModal
        groups={state.groups}
        groupIdx={state.groupIdx}
        itemIdx={state.itemIdx}
        feedMode
        feedListMeta={feedListMeta}
        // 关键：恢复“上下切换合集、左右切换合集内内容”的核心交互，不再传 flatItems
        onClose={onClose}
        onNeedMore={loadMoreIfNeeded}
        onStep={stepItemInGroup}
        onSetItemIdx={(nextIdx) => {
          setState((prev) => {
            const g = prev.groups[prev.groupIdx];
            const items = g?.items || [];
            const clamped = clamp(nextIdx, 0, Math.max(0, items.length - 1));
            if (clamped === prev.itemIdx) return prev;
            return { ...prev, itemIdx: clamped };
          });
        }}
        onGroupStep={stepGroup}
        onSetGroupIdx={setGroupIdx}
        // 沉浸路由页不需要“切换到预览模式”按钮
        onFeedModeChange={undefined}
        onReload={() => {
          // 简化：刷新当前页面即可触发重拉
          navigate(0);
        }}
        feedOverlay={currentGroup && currentItem ? (
          <FeedOverlay
            item={currentItem}
            group={currentGroup}
            positionText={
              feedListMeta
                ? `合集 ${feedListMeta.index + 1}/${feedListMeta.total} · 内容 ${state.itemIdx + 1}/${currentGroup.items?.length ?? 0}`
                : undefined
            }
            onTagClick={handleTagClick}
          />
        ) : undefined}
      />
    </>
  );
}

