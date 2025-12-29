import { useEffect, useRef } from 'react';
import type { MediaGroup, MediaItem } from '../api';
import { escHtml } from '../utils';

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
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (groupIdx: number, itemIdx: number) => void;
}

const THUMB_ROOT_MARGIN = '240px 0px';

export default function MediaTiles({
  items,
  expanded,
  hasMore,
  totalGroups,
  loadingMore,
  onLoadMore,
  onOpen,
}: MediaTilesProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const moreObserverRef = useRef<IntersectionObserver | null>(null);
  const thumbObserverRef = useRef<IntersectionObserver | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreObserverRef.current) {
      moreObserverRef.current = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting && !loadingMore) onLoadMore();
          }
        },
        { root: null, rootMargin: '600px 0px', threshold: 0.01 }
      );
    }

    if (!thumbObserverRef.current) {
      const unloadOffscreen = window.matchMedia && window.matchMedia('(max-width: 520px)').matches;
      thumbObserverRef.current = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const v = e.target;
            if (!(v instanceof HTMLVideoElement)) continue;
            if (e.isIntersecting) {
              if (!v.src) {
                const src = v.dataset.src;
                if (!src) continue;
                v.preload = 'metadata';
                v.src = src;
                try {
                  v.load();
                } catch {}
              }
            } else {
              try {
                v.pause();
              } catch {}
              if (unloadOffscreen && v.src) {
                v.removeAttribute('src');
                try {
                  v.load();
                } catch {}
              }
            }
          }
        },
        { root: null, rootMargin: THUMB_ROOT_MARGIN, threshold: 0.01 }
      );
    }

    return () => {
      moreObserverRef.current?.disconnect();
      thumbObserverRef.current?.disconnect();
    };
  }, [loadingMore, onLoadMore]);

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

  useEffect(() => {
    if (!thumbObserverRef.current || !rootRef.current) return;
    const videos = rootRef.current.querySelectorAll('video[data-src]');
    videos.forEach((v) => thumbObserverRef.current!.observe(v));
    return () => {
      videos.forEach((v) => thumbObserverRef.current?.unobserve(v));
    };
  }, [items]);

  // 用“列宽”而不是“列数”来限制 tile 宽度，避免大屏下图片被拉得过宽
  // Tailwind 任意值：columns-[220px] => columns: 220px;
  const cols = expanded
    ? 'columns-[220px] sm:columns-[240px] md:columns-[260px] lg:columns-[280px]'
    : 'columns-[180px] sm:columns-[200px] md:columns-[220px] lg:columns-[240px]';

  return (
    <div ref={rootRef}>
      <div className={`${cols} [column-gap:12px] md:[column-gap:14px]`}>
        {items.map((t) => {
          const isVideo = t.item.kind === 'video';
          const label = isVideo ? '视频' : t.item.kind === 'image' ? '图片' : '文件';
          const title = `${t.group.author || ''} ${t.group.theme || ''}`.trim() || t.item.filename;
          const sub = `${t.group.timeText || ''}`.trim();

          return (
            <div
              key={`${t.groupIdx}-${t.itemIdx}`}
              className="break-inside-avoid mb-3 inline-block w-full"
            >
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
                  {isVideo ? (
                    <video
                      preload="none"
                      muted
                      playsInline
                      data-src={escHtml(t.item.url)}
                      className="block w-full h-auto"
                    ></video>
                  ) : t.item.kind === 'image' ? (
                    <img
                      loading="lazy"
                      src={escHtml(t.item.url)}
                      alt=""
                      className="block w-full h-auto"
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

