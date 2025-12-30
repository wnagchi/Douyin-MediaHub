import { useEffect, useRef } from 'react';
import { MediaGroup } from '../api';
import MediaCard from './MediaCard';

export interface MediaGridItem {
  groupIdx: number; // index in the original groups array (App state)
  group: MediaGroup;
}

export interface MediaGridSection {
  key: string;
  title: string;
  meta?: string;
  items: MediaGridItem[];
}

interface MediaGridProps {
  sections: MediaGridSection[];
  expanded: boolean;
  layout: 'grid' | 'masonry';
  hasMore: boolean;
  totalGroups: number;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onThumbClick: (groupIdx: number, itemIdx: number) => void;
}

export default function MediaGrid({
  sections,
  expanded,
  layout,
  hasMore,
  totalGroups,
  loading,
  loadingMore,
  onLoadMore,
  onThumbClick,
}: MediaGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const moreObserverRef = useRef<IntersectionObserver | null>(null);
  const loadingMoreRef = useRef<boolean>(loadingMore);
  const onLoadMoreRef = useRef<() => void>(onLoadMore);

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
              fetch('http://127.0.0.1:7243/ingest/0fb33d7e-80b0-4097-89dd-e057fc4b7a5a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run1',hypothesisId:'H3',location:'MediaGrid.tsx:moreObserver',message:'sentinel intersect -> onLoadMore',data:{loadingMore:loadingMoreRef.current,hasMore,totalGroups},timestamp:Date.now()})}).catch(()=>{});
              // #endregion
              onLoadMoreRef.current();
            }
          }
        },
        // “将触底就加载”：更早触发加载更多
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

  const gridRef = useRef<HTMLDivElement>(null);

  const displayedGroups = sections.reduce((acc, s) => acc + (s.items?.length || 0), 0);
  const isMasonry = layout === 'masonry';
  const masonryCols = expanded
    ? 'columns-1 lg:columns-2'
    : 'columns-1 md:columns-2 xl:columns-3';

  if (loading && displayedGroups === 0) {
    const skCount = expanded ? 8 : 12;
    return (
      <div
        id="grid"
        className={isMasonry ? '' : `grid ${expanded ? 'expanded' : ''}`}
        ref={gridRef}
      >
        <div className={isMasonry ? `${masonryCols} [column-gap:14px]` : `sectionGrid ${expanded ? 'expanded' : ''}`}>
          {Array.from({ length: skCount }).map((_, i) => (
            <div
              key={`sk-${i}`}
              className={isMasonry ? 'break-inside-avoid mb-3 inline-block w-full' : ''}
            >
              <div className="rounded-[16px] border border-white/10 bg-black/20 overflow-hidden">
                <div className="h-[220px] bg-white/10 animate-pulse"></div>
                <div className="p-3">
                  <div className="h-4 w-2/3 bg-white/10 animate-pulse rounded"></div>
                  <div className="mt-2 h-3 w-1/2 bg-white/10 animate-pulse rounded"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      id="grid"
      className={isMasonry ? '' : `grid ${expanded ? 'expanded' : ''}`}
      ref={gridRef}
    >
      {sections.map((sec) => (
        <div key={sec.key} className={isMasonry ? '' : 'sectionBlock'}>
          {(sec.title || sec.meta) && (
            <div className="flex items-baseline justify-between gap-3 px-1 pt-2 pb-1">
              <div className="font-extrabold tracking-tight text-[rgba(255,255,255,.92)]">{sec.title}</div>
              {sec.meta && <div className="text-xs font-mono text-[rgba(255,255,255,.55)] whitespace-nowrap">{sec.meta}</div>}
            </div>
          )}

          <div
            className={
              isMasonry
                ? `${masonryCols} [column-gap:14px]`
                : `sectionGrid ${expanded ? 'expanded' : ''}`
            }
          >
            {sec.items.map(({ group, groupIdx }) => (
              <MediaCard
                key={groupIdx}
                group={group}
                groupIdx={groupIdx}
                expanded={expanded}
                wrapperClassName={
                  isMasonry ? 'break-inside-avoid mb-3 inline-block w-full' : undefined
                }
                onThumbClick={onThumbClick}
              />
            ))}
          </div>
        </div>
      ))}
      <div className={isMasonry ? 'listFooter mt-2' : 'listFooter'}>
        {hasMore ? (
          <button id="loadMore" className="btn" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? '加载中…' : `加载更多（${displayedGroups}/${totalGroups}）`}
          </button>
        ) : (
          <div className="endHint">已到底</div>
        )}
        <div id="sentinel" className="sentinel" aria-hidden="true" ref={sentinelRef}></div>
      </div>
    </div>
  );
}
