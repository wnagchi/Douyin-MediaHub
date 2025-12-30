import { useEffect, useRef, useState } from 'react';
import type { MediaGroup, MediaItem } from '../api';
import { escHtml } from '../utils';
import BaseImage from './BaseImage';

export interface TileItem {
  groupIdx: number;
  itemIdx: number;
  group: MediaGroup;
  item: MediaItem;
}

interface MediaTilesProps {
  items: TileItem[];
  expanded: boolean;
  hasMore: boolean;
  totalGroups: number;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (groupIdx: number, itemIdx: number) => void;
}

export default function MediaTiles({
  items,
  expanded,
  hasMore,
  totalGroups,
  loading,
  loadingMore,
  onLoadMore,
  onOpen,
}: MediaTilesProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const moreObserverRef = useRef<IntersectionObserver | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const masonryRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef<boolean>(loadingMore);
  const onLoadMoreRef = useRef<() => void>(onLoadMore);

  // 用"多列容器"而不是 CSS columns：避免加载新数据/图片解码时触发整页 columns 重新平衡导致闪动
  // 初始值设为 2，确保至少是两列（手机端最少2列）
  const [colCount, setColCount] = useState<number>(2);
  const [cols, setCols] = useState<TileItem[][]>([[], []]);
  const prevInfoRef = useRef<{ count: number; firstKey: string }>({ count: 0, firstKey: '' });

  const keyOf = (t: TileItem) => `${t.groupIdx}-${t.itemIdx}`;

  type TileMeta = { column: number; estH: number; ratio?: number };
  const tileMetaRef = useRef<Map<string, TileMeta>>(new Map());
  const colHeightsRef = useRef<number[]>([0]);
  const colWidthRef = useRef<number>(0);

  const getDefaultEstH = () => (expanded ? 320 : 280);

  const ensureColHeights = (n: number) => {
    const safeN = Math.max(1, Math.floor(n || 1));
    const arr = colHeightsRef.current;
    if (arr.length !== safeN) {
      colHeightsRef.current = Array.from({ length: safeN }, () => 0);
    } else {
      for (let i = 0; i < arr.length; i++) arr[i] = 0;
    }
    return safeN;
  };

  const pickShortestCol = (n: number) => {
    const hs = colHeightsRef.current;
    let best = 0;
    let bestH = hs[0] ?? 0;
    for (let i = 1; i < n; i++) {
      const h = hs[i] ?? 0;
      if (h < bestH) {
        bestH = h;
        best = i;
      }
    }
    return best;
  };

  const estimateHeight = (t: TileItem) => {
    const k = keyOf(t);
    const meta = tileMetaRef.current.get(k);
    if (meta?.ratio && colWidthRef.current) return meta.ratio * colWidthRef.current;
    if (meta?.estH) return meta.estH;
    return getDefaultEstH();
  };

  const buildColsGreedy = (all: TileItem[], n: number) => {
    const safeN = ensureColHeights(n);
    const out: TileItem[][] = Array.from({ length: safeN }, () => []);
    for (const t of all) {
      const k = keyOf(t);
      const est = estimateHeight(t);
      const col = pickShortestCol(safeN);
      out[col].push(t);
      colHeightsRef.current[col] += est;
      const prev = tileMetaRef.current.get(k);
      tileMetaRef.current.set(k, { column: col, estH: est, ratio: prev?.ratio });
    }
    return out;
  };

  // 保持回调最新，但 Observer 只创建一次（避免 loadingMore 变化触发 disconnect 导致 Observer 永久失效）
  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    if (!moreObserverRef.current) {
      moreObserverRef.current = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting && !loadingMoreRef.current) {
              onLoadMoreRef.current();
            }
          }
        },
        // “将触底就加载”：比 600px 更激进一些，减少用户等待
        { root: null, rootMargin: '900px 0px', threshold: 0.01 }
      );
    }

    return () => {
      moreObserverRef.current?.disconnect();
      moreObserverRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (hasMore && sentinelRef.current && moreObserverRef.current) {
      moreObserverRef.current.observe(sentinelRef.current);
    }
    return () => {
      if (sentinelRef.current && moreObserverRef.current) {
        moreObserverRef.current.unobserve(sentinelRef.current);
      }
    };
  }, [hasMore]);

  // 根据容器宽度计算列数：手机固定2列，电脑自适应
  useEffect(() => {
    const el = masonryRef.current;
    
    if (!el || typeof ResizeObserver === 'undefined') {
      // 如果没有 ResizeObserver，使用窗口宽度估算
      const w = window.innerWidth || 1200;
      const isMobile = w < 768;
      const minCol = expanded ? 220 : 180;
      const gap = isMobile ? 24 : 32;
      const next = isMobile ? 2 : Math.max(3, Math.floor((w * 0.8 + gap) / (minCol + gap)));
      setColCount(next);
      return;
    }

    const recompute = () => {
      const w = el.clientWidth || 0;
      const isMobile = w < 768; // 768px 以下视为手机
      const gap = isMobile ? 24 : 32;
      
      let next: number;
      if (isMobile) {
        // 手机端：固定2列
        next = 2;
      } else {
        // 电脑端：自适应多列，最少3列
        const minCol = expanded ? 220 : 180;
        next = Math.max(3, Math.floor((w + gap) / (minCol + gap)));
      }

      // 估算列宽：用于根据媒体比例估算高度（仅用于"后续追加"的分配，不会触发旧项换列）
      const colW = next > 0 ? Math.max(1, Math.floor((w - gap * (next - 1)) / next)) : w;
      colWidthRef.current = colW;
      setColCount(next);
    };

    // 立即计算一次
    recompute();
    const ro = new ResizeObserver(() => recompute());
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  // 关键：只把"新增的 items"追加进列里，旧 tile 不换列 => 加载更多时不闪动
  useEffect(() => {
    const firstKey = items[0] ? keyOf(items[0]) : '';
    const prev = prevInfoRef.current;

    // 空列表：清空
    if (!items.length) {
      prevInfoRef.current = { count: 0, firstKey: '' };
      setCols(Array.from({ length: Math.max(1, colCount) }, () => []));
      return;
    }

    const needHardReset =
      // 过滤/刷新：列表被替换或缩短
      prev.count > items.length ||
      // 过滤/刷新：首元素变化（通常意味着前缀不再相同）
      (prev.firstKey && firstKey !== prev.firstKey) ||
      // 列数变化：需要重新分配（避免列数变化后布局错乱）
      cols.length !== Math.max(1, colCount) ||
      // 从空列表变为有数据：必须触发分配
      (prev.count === 0 && items.length > 0);

    if (needHardReset) {
      setCols(buildColsGreedy(items, colCount));
      prevInfoRef.current = { count: items.length, firstKey };
      return;
    }

    // 仅追加新数据（假设 items 顺序稳定且是 append）
    if (items.length === prev.count) return;
    const appended = items.slice(prev.count);
    if (!appended.length) return;

    setCols((prevCols) => {
      const n = Math.max(1, colCount);
      const base = prevCols.length === n ? prevCols : buildColsGreedy(items.slice(0, prev.count), n);
      // colHeightsRef 需要与 base 对齐：当 base 已经是当前 state，colHeights 可能是旧值，这里重算一次
      // 注意：重算只影响“新 items 分配”，不会移动旧 items
      ensureColHeights(n);
      for (const col of base) {
        for (const t of col) {
          const est = estimateHeight(t);
          const meta = tileMetaRef.current.get(keyOf(t));
          const c = meta?.column ?? 0;
          colHeightsRef.current[c] += est;
        }
      }

      const nextCols = base.map((c) => c.slice());
      for (const t of appended) {
        const k = keyOf(t);
        const est = estimateHeight(t);
        const col = pickShortestCol(n);
        nextCols[col].push(t);
        colHeightsRef.current[col] += est;
        const prevMeta = tileMetaRef.current.get(k);
        tileMetaRef.current.set(k, { column: col, estH: est, ratio: prevMeta?.ratio });
      }
      return nextCols;
    });

    prevInfoRef.current = { count: items.length, firstKey };
  }, [items, colCount, cols.length]);

  if (loading && !items.length) {
    // 首屏占位：数据请求中时展示 skeleton，避免页面“空白”
    const skeletonCount = expanded ? 10 : 14;
    return (
      <div ref={rootRef}>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 masonry-gap">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <div
              key={`sk-${i}`}
              className="border border-white/10 bg-black/20 overflow-hidden shadow-[0_18px_60px_rgba(0,0,0,.45)]"
            >
              <div className="h-[220px] md:h-[260px] bg-white/10 animate-pulse"></div>
              <div className="p-2">
                <div className="h-4 w-3/4 bg-white/10 animate-pulse rounded"></div>
                <div className="mt-2 h-3 w-1/2 bg-white/10 animate-pulse rounded"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      <div ref={masonryRef} className="flex items-start masonry-gap">
        {cols.map((col, colIdx) => (
          <div key={`col-${colIdx}`} className="flex-1 min-w-0 flex flex-col masonry-gap">
            {col.map((t) => {
              const isVideo = t.item.kind === 'video';
              const groupType = t.group.groupType || (Array.isArray(t.group.types) ? t.group.types[0] : '') || '';
              const isLive = groupType === '实况';
              const badgeLabel = isLive ? '实况' : isVideo ? '视频' : t.item.kind === 'image' ? '图片' : '文件';
              const badgeVariant = isLive ? 'live' : isVideo ? 'video' : t.item.kind === 'image' ? 'photo' : '';

              const tileKey = keyOf(t);

              const updateMeasuredRatio = (ratio: number) => {
                if (!Number.isFinite(ratio) || ratio <= 0) return;
                const meta = tileMetaRef.current.get(tileKey);
                const colIndex = meta?.column ?? colIdx;
                const colW = colWidthRef.current || 0;
                if (!colW) return;
                const nextH = ratio * colW;
                const prevH = meta?.estH ?? getDefaultEstH();
                const delta = nextH - prevH;
                // 过滤重复/极小变化，避免视频重复触发 metadata 时把高度累加错
                if (Math.abs(delta) < 2 && meta?.ratio === ratio) return;
                tileMetaRef.current.set(tileKey, { column: colIndex, estH: nextH, ratio });
                if (colHeightsRef.current[colIndex] != null) {
                  colHeightsRef.current[colIndex] += delta;
                }
              };

              return (
                <div key={tileKey} className="w-full">
                  <div
                    role="button"
                    tabIndex={0}
                    title={escHtml(t.item.filename)}
                    onClick={() => onOpen(t.groupIdx, t.itemIdx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen(t.groupIdx, t.itemIdx);
                      }
                    }}
                    className="relative w-full overflow-hidden border border-white/10 bg-black/20 shadow-[0_18px_60px_rgba(0,0,0,.45)]"
                  >
                    {/* 图片自然高度撑开，只限制宽度 */}
                    <div className="relative w-full bg-black/25">
                      {isVideo || t.item.kind === 'image' ? (
                        <BaseImage
                          wrapperClassName="w-full"
                          className="w-full block"
                          src={escHtml(t.item.thumbUrl ?? t.item.url)}
                          alt=""
                          onLoad={(img) => {
                            const nw = img.naturalWidth || 0;
                            const nh = img.naturalHeight || 0;
                            if (nw > 0 && nh > 0) updateMeasuredRatio(nh / nw);
                          }}
                        />
                      ) : (
                        <div className="w-full min-h-[220px] grid place-items-center text-sm text-white/75">
                          {escHtml(badgeLabel)}
                        </div>
                      )}

                      {/* 叠加层：类型角标（用自定义 CSS 做定位/层级，避免 Tailwind 未生成时错位） */}
                      <div className="tileOverlay" aria-hidden="true">
                        <div className="tileOverlayTopLeft">
                          <div className={`tileTypeBadge ${badgeVariant}`} aria-label={escHtml(badgeLabel)}>
                            <span className="tileTypeBadgeIcon">{isLive ? '●' : isVideo ? '▶' : '⧉'}</span>
                            {/* <span className="tileTypeBadgeText">{escHtml(badgeLabel)}</span> */}
                          </div>
                        </div>
                        {/* {isVideo && <div className="tileOverlayTopRight">▶</div>} */}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="listFooter">
        {hasMore ? (
          <button id="loadMoreTiles" className="btn" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? '加载中…' : `加载更多（${items.length}/${totalGroups}）`}
          </button>
        ) : (
          <div className="endHint">已到底</div>
        )}
        <div id="sentinelTiles" className="sentinel" aria-hidden="true" ref={sentinelRef}></div>
      </div>
    </div>
  );
}

