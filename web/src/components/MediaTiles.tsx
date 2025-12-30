import { useEffect, useRef, useState } from 'react';
import type { MediaGroup, MediaItem } from '../api';
import { escHtml } from '../utils';
import LazyImage from './LazyImage';

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

  // 用“多列容器”而不是 CSS columns：避免加载新数据/图片解码时触发整页 columns 重新平衡导致闪动
  const [colCount, setColCount] = useState<number>(1);
  const [cols, setCols] = useState<TileItem[][]>([[]]);
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
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/0fb33d7e-80b0-4097-89dd-e057fc4b7a5a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run2',hypothesisId:'H3',location:'MediaTiles.tsx:moreObserver',message:'sentinel intersect -> onLoadMore',data:{itemsLen:items.length,loadingMore:loadingMoreRef.current,hasMore},timestamp:Date.now()})}).catch(()=>{});
              // #endregion
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

  // 根据容器宽度计算列数：用“列宽阈值”避免大屏下 tile 过宽（兼容原先 columns-[xxxpx] 的体验）
  useEffect(() => {
    const el = masonryRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const recompute = () => {
      const w = el.clientWidth || 0;
      // 与原先 Tailwind columns-[180px]/[220px] 大致对齐
      const minCol = expanded ? 220 : 180;
      const gap = window.matchMedia && window.matchMedia('(min-width: 768px)').matches ? 14 : 12;
      // base calculation
      const base = Math.max(1, Math.floor((w + gap) / (minCol + gap)));

      // Hysteresis + mobile-friendly 2-col fallback:
      // Some iOS/phone viewports end up with w slightly smaller than the threshold for 2 cols (e.g. 366px),
      // which makes it "stuck" in 1-col. We allow 2-col when each column would still be >= 160px,
      // and add hysteresis to avoid 1<->2 flapping while scrolling.
      const colW2 = Math.floor((w - gap) / 2);
      const next = (() => {
        if (expanded) return base;
        if (base >= 2) return base;
        // base is 1
        if (colW2 >= 160) return 2;
        return 1;
      })();

      // 估算列宽：用于根据媒体比例估算高度（仅用于“后续追加”的分配，不会触发旧项换列）
      const colW = next > 0 ? Math.max(1, Math.floor((w - gap * (next - 1)) / next)) : w;
      colWidthRef.current = colW;
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/0fb33d7e-80b0-4097-89dd-e057fc4b7a5a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run2',hypothesisId:'H1',location:'MediaTiles.tsx:recomputeCols',message:'recompute columns v2',data:{expanded,w,minCol,gap,base,colW2,next,colW,prevColCount:colCount},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setColCount((prev) => {
        if (expanded) return prev === next ? prev : next;
        // hysteresis to reduce flapping near the threshold
        if (prev >= 2) {
          // keep 2 cols unless it's really too narrow
          return colW2 >= 150 ? 2 : 1;
        }
        return prev === next ? prev : next;
      });
    };

    recompute();
    const ro = new ResizeObserver(() => recompute());
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  // 关键：只把“新增的 items”追加进列里，旧 tile 不换列 => 加载更多时不闪动
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
      cols.length !== Math.max(1, colCount);

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/0fb33d7e-80b0-4097-89dd-e057fc4b7a5a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run2',hypothesisId:'H2',location:'MediaTiles.tsx:itemsEffect',message:'items->layout decision',data:{itemsLen:items.length,prevCount:prev.count,prevFirstKey:prev.firstKey,firstKey,colCount,colsLen:cols.length,needHardReset,appendedLen:Math.max(0,items.length-prev.count)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

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
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-[14px]">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <div
              key={`sk-${i}`}
              className="rounded-[16px] border border-white/10 bg-black/20 overflow-hidden shadow-[0_18px_60px_rgba(0,0,0,.45)]"
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
      <div ref={masonryRef} className="flex items-start gap-3 md:gap-[14px]">
        {cols.map((col, colIdx) => (
          <div key={`col-${colIdx}`} className="flex-1 min-w-0 flex flex-col gap-3 md:gap-[14px]">
            {col.map((t) => {
              const isVideo = t.item.kind === 'video';
              const label = isVideo ? '视频' : t.item.kind === 'image' ? '图片' : '文件';
              const title = `${t.group.author || ''} ${t.group.theme || ''}`.trim() || t.item.filename;
              const sub = `${t.group.timeText || ''}`.trim();
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
                    className="relative w-full overflow-hidden rounded-[16px] border border-white/10 bg-black/20 shadow-[0_18px_60px_rgba(0,0,0,.45)]"
                  >
                    {/* 竖屏优先 */}
                    <div className="relative w-full bg-black/25">
                      {isVideo || t.item.kind === 'image' ? (
                        <LazyImage
                          wrapperClassName="w-full overflow-hidden"
                          wrapperStyle={{
                            // 关键：先用估算高度占位，避免图片加载完成后把下面内容“顶来顶去”
                            height: Math.max(180, Math.round(estimateHeight(t))),
                          }}
                          className="absolute inset-0 w-full h-full object-cover"
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
                          {escHtml(label)}
                        </div>
                      )}

                      {/* 文字层：避免“叠在一起”，统一放入 overlay，标题两行省略，时间一行 */}
                      <div className="pointer-events-none absolute inset-0">
                        <div className="absolute top-2 left-2 flex items-center gap-2">
                          <div className="text-xs font-mono text-white/85 bg-white/10 border border-white/15 rounded-full px-2 py-1 backdrop-blur">
                            {escHtml(label)}
                          </div>
                        </div>
                        {isVideo && (
                          <div className="absolute top-2 right-2 grid place-items-center w-8 h-8 rounded-full bg-black/35 border border-white/15 text-white/90 text-sm backdrop-blur">
                            ▶
                          </div>
                        )}

                        <div className="absolute left-0 right-0 bottom-0 p-2 bg-gradient-to-t from-black/75 via-black/35 to-transparent">
                          <div className="text-[13px] font-extrabold text-white/92 leading-snug overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
                            {escHtml(title)}
                          </div>
                          {sub && (
                            <div className="mt-1 text-[12px] font-mono text-white/70 truncate">
                              {escHtml(sub)}
                            </div>
                          )}
                        </div>
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

