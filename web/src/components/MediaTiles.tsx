import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Masonry } from 'antd';
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
  onImmersiveOpen: (groupIdx: number, itemIdx: number) => void;
  selectionMode?: boolean;
  selectedItems?: Set<string>;
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
  onImmersiveOpen,
  selectionMode = false,
  selectedItems = new Set(),
}: MediaTilesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() => {
    try {
      return typeof window !== 'undefined' ? window.innerWidth : 0;
    } catch {
      return 0;
    }
  });

  // 移动端列数选择：2列或3列
  const [mobileColumns, setMobileColumns] = useState<2 | 3>(() => {
    try {
      const saved = localStorage.getItem('masonry_mobile_columns');
      return saved === '3' ? 3 : 2;
    } catch {
      return 2;
    }
  });

  // 保存列数偏好
  const toggleMobileColumns = () => {
    const newColumns = mobileColumns === 2 ? 3 : 2;
    setMobileColumns(newColumns);
    try {
      localStorage.setItem('masonry_mobile_columns', String(newColumns));
    } catch {
      // ignore
    }
  };

  // 监听容器宽度：用于计算列数
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

  // 无限滚动：监听底部元素
  useEffect(() => {
    if (!hasMore || loadingMore || !sentinelRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) {
          onLoadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  const layout = useMemo(() => {
    const w = containerWidth || 0;
    const isMobile = w > 0 ? w < 768 : true;
    const gap = isMobile ? 12 : 16;
    const minCol = expanded ? 220 : 180;
    const columnCount = isMobile ? mobileColumns : Math.max(3, Math.floor((Math.max(w, 1) + gap) / (minCol + gap)));
    return { isMobile, gap, minCol, columnCount };
  }, [containerWidth, expanded, mobileColumns]);

  const itemKey = (t: TileItem) => `${t.groupIdx}-${t.itemIdx}`;

  const renderTile = useCallback(
    (data: TileItem) => {
      const isVideo = data.item.kind === 'video';
      const groupType = data.group.groupType || (Array.isArray(data.group.types) ? data.group.types[0] : '') || '';
      const isLive = groupType === '实况';
      const badgeLabel = isLive ? '实况' : isVideo ? '视频' : data.item.kind === 'image' ? '图片' : '文件';
      const badgeVariant = isLive ? 'live' : isVideo ? 'video' : data.item.kind === 'image' ? 'photo' : '';
      const itemKey = data.item.dirId && data.item.filename ? `${data.item.dirId}|${data.item.filename}` : '';
      const isSelected = selectionMode && selectedItems.has(itemKey);

      return (
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
          className={`tileWrapper relative w-full overflow-hidden border border-white/10 bg-black/20 shadow-[0_18px_60px_rgba(0,0,0,.45)] ${
            selectionMode ? 'selectionMode' : ''
          } ${isSelected ? 'selected' : ''}`}
        >
          {!selectionMode && (
            <button
              type="button"
              className="immersiveEntryBtn"
              onClick={(e) => {
                e.stopPropagation();
                onImmersiveOpen(data.groupIdx, data.itemIdx);
              }}
              title="进入沉浸模式"
              aria-label="进入沉浸模式"
            >
              沉浸
            </button>
          )}
          {isVideo || data.item.kind === 'image' ? (
            <BaseImage
              wrapperClassName="w-full block"
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
      );
    },
    [onImmersiveOpen, onOpen, selectionMode, selectedItems]
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
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* 移动端列数切换按钮 */}
      {layout.isMobile && !selectionMode && (
        <button
          type="button"
          className="mobileColumnsToggle"
          onClick={toggleMobileColumns}
          title={`当前 ${mobileColumns} 列，点击切换`}
          aria-label={`切换列数（当前 ${mobileColumns} 列）`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileColumns === 2 ? (
              // 2列图标
              <>
                <rect x="3" y="3" width="8" height="18" rx="1" />
                <rect x="13" y="3" width="8" height="18" rx="1" />
              </>
            ) : (
              // 3列图标
              <>
                <rect x="3" y="3" width="5" height="18" rx="1" />
                <rect x="9.5" y="3" width="5" height="18" rx="1" />
                <rect x="16" y="3" width="5" height="18" rx="1" />
              </>
            )}
          </svg>
          <span>{mobileColumns}列</span>
        </button>
      )}
      
      <Masonry
        // 参考文档：https://ant.design/components/masonry-cn
        columns={{ xs: mobileColumns, sm: mobileColumns, md: layout.columnCount }}
        gutter={{ xs: 12, md: 16 }}
        fresh
        items={items.map((it) => ({
          key: itemKey(it),
          data: it,
          children: renderTile(it),
        }))}
      />

      <div ref={sentinelRef} style={{ height: '1px', gridColumn: '1 / -1' }} aria-hidden="true" />
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

