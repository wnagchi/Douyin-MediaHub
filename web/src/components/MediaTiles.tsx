import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Masonry, useInfiniteLoader } from 'masonic';
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
  const loadingMoreRef = useRef<boolean>(loadingMore);
  const onLoadMoreRef = useRef<() => void>(onLoadMore);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() => {
    try {
      return typeof window !== 'undefined' ? window.innerWidth : 0;
    } catch {
      return 0;
    }
  });

  // 保持回调最新，但 Observer 只创建一次（避免 loadingMore 变化触发 disconnect 导致 Observer 永久失效）
  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  const loadMoreItems = useCallback(
    async (_startIndex: number, _stopIndex: number, _currentItems: TileItem[]) => {
      if (!hasMore) return;
      if (loadingMoreRef.current) return;
      onLoadMoreRef.current();
    },
    [hasMore]
  );
  const maybeLoadMore = useInfiniteLoader<TileItem, typeof loadMoreItems>(loadMoreItems, {
    isItemLoaded: (index, current) => Boolean(current[index]),
    // hasMore=false 时把 totalItems 限定为当前长度，避免继续触发
    totalItems: hasMore ? 9e9 : items.length,
    threshold: 10,
    minimumBatchSize: 16,
  });

  // 监听容器宽度：用于计算列数/列宽（masonic 的 columnCount + columnWidth）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => setContainerWidth(el.clientWidth || 0);
    update();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    const w = containerWidth || 0;
    const isMobile = w > 0 ? w < 768 : true;
    const gap = isMobile ? 12 : 16; // 对齐 app.css 的 masonry-gap
    const minCol = expanded ? 220 : 180;
    const columnCount = isMobile ? 2 : Math.max(3, Math.floor((Math.max(w, 1) + gap) / (minCol + gap)));
    const columnWidth = w > 0 ? Math.max(1, Math.floor((w - gap * (columnCount - 1)) / columnCount)) : minCol;
    return { isMobile, gap, minCol, columnCount, columnWidth };
  }, [containerWidth, expanded]);

  const itemKey = (t: TileItem) => `${t.groupIdx}-${t.itemIdx}`;

  const renderTile = useCallback(
    ({ data }: { data: TileItem; index: number; width: number }) => {
      const isVideo = data.item.kind === 'video';
      const groupType = data.group.groupType || (Array.isArray(data.group.types) ? data.group.types[0] : '') || '';
      const isLive = groupType === '实况';
      const badgeLabel = isLive ? '实况' : isVideo ? '视频' : data.item.kind === 'image' ? '图片' : '文件';
      const badgeVariant = isLive ? 'live' : isVideo ? 'video' : data.item.kind === 'image' ? 'photo' : '';

      return (
        <div className="w-full">
          <div
            role="button"
            tabIndex={0}
            title={escHtml(data.item.filename)}
            onClick={() => onOpen(data.groupIdx, data.itemIdx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(data.groupIdx, data.itemIdx);
              }
            }}
            className="relative w-full overflow-hidden border border-white/10 bg-black/20 shadow-[0_18px_60px_rgba(0,0,0,.45)]"
          >
            <div className="relative w-full bg-black/25">
              {isVideo || data.item.kind === 'image' ? (
                <BaseImage
                  wrapperClassName="w-full"
                  className="w-full block"
                  src={escHtml(data.item.thumbUrl ?? data.item.url)}
                  alt=""
                />
              ) : (
                <div className="w-full min-h-[220px] grid place-items-center text-sm text-white/75">{escHtml(badgeLabel)}</div>
              )}

              <div className="tileOverlay" aria-hidden="true">
                <div className="tileOverlayTopLeft">
                  <div className={`tileTypeBadge ${badgeVariant}`} aria-label={escHtml(badgeLabel)}>
                    <span className="tileTypeBadgeIcon">{isLive ? '●' : isVideo ? '▶' : '⧉'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    },
    [onOpen]
  );

  if (loading && !items.length) {
    const skeletonCount = expanded ? 10 : 14;
    return (
      <div>
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
    <div ref={containerRef}>
      <Masonry
        items={items}
        render={renderTile as any}
        itemKey={itemKey}
        columnCount={layout.columnCount}
        columnWidth={layout.columnWidth}
        columnGutter={layout.gap}
        overscanBy={layout.isMobile ? 4 : 2}
        onRender={maybeLoadMore}
      />

      <div className="listFooter">
        {hasMore ? (
          <button id="loadMoreTiles" className="btn" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? '加载中…' : `加载更多（${items.length}/${totalGroups}）`}
          </button>
        ) : (
          <div className="endHint">已到底</div>
        )}
      </div>
    </div>
  );
}

