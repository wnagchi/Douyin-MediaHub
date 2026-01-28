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
  hasMore: boolean;
  totalGroups: number;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onThumbClick: (groupIdx: number, itemIdx: number) => void;
  onImmersiveOpen: (groupIdx: number, itemIdx: number) => void;
  onTagClick?: (tag: string) => void;
  selectionMode?: boolean;
  selectedItems?: Set<string>;
}

export default function MediaGrid({
  sections,
  expanded,
  hasMore,
  totalGroups,
  loading,
  loadingMore,
  onLoadMore,
  onThumbClick,
  onImmersiveOpen,
  onTagClick,
  selectionMode = false,
  selectedItems = new Set(),
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

  if (loading && displayedGroups === 0) {
    const skCount = expanded ? 8 : 12;
    return (
      <div
        id="grid"
        className={`grid ${expanded ? 'expanded' : ''}`}
        ref={gridRef}
      >
        <div className={`sectionGrid ${expanded ? 'expanded' : ''}`}>
          {Array.from({ length: skCount }).map((_, i) => (
            <div key={`sk-${i}`}>
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
      className={`grid ${expanded ? 'expanded' : ''}`}
      ref={gridRef}
    >
      {sections.map((sec) => (
        <div key={sec.key} className="sectionBlock">
          {(sec.title || sec.meta) && (
            <div className="flex items-baseline justify-between gap-3 px-1 pt-2 pb-1">
              <div className="font-extrabold tracking-tight text-[rgba(255,255,255,.92)]">{sec.title}</div>
              {sec.meta && <div className="text-xs font-mono text-[rgba(255,255,255,.55)] whitespace-nowrap">{sec.meta}</div>}
            </div>
          )}

          <div className={`sectionGrid ${expanded ? 'expanded' : ''}`}>
            {sec.items.map(({ group, groupIdx }) => (
              <MediaCard
                key={groupIdx}
                group={group}
                groupIdx={groupIdx}
                expanded={expanded}
                onThumbClick={onThumbClick}
                onImmersiveOpen={onImmersiveOpen}
                onTagClick={onTagClick}
                selectionMode={selectionMode}
                selectedItems={selectedItems}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="listFooter">
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
