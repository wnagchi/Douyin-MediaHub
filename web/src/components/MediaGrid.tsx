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
  loadingMore: boolean;
  onLoadMore: () => void;
  onThumbClick: (groupIdx: number, itemIdx: number) => void;
}

const THUMB_ROOT_MARGIN = '240px 0px';

export default function MediaGrid({
  sections,
  expanded,
  layout,
  hasMore,
  totalGroups,
  loadingMore,
  onLoadMore,
  onThumbClick,
}: MediaGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const moreObserverRef = useRef<IntersectionObserver | null>(null);
  const thumbObserverRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!moreObserverRef.current) {
      moreObserverRef.current = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting && !loadingMore) {
              onLoadMore();
            }
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
      if (moreObserverRef.current) {
        moreObserverRef.current.disconnect();
      }
      if (thumbObserverRef.current) {
        thumbObserverRef.current.disconnect();
      }
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

  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!thumbObserverRef.current || !gridRef.current) return;
    const videos = gridRef.current.querySelectorAll('video[data-src]');
    videos.forEach((v) => thumbObserverRef.current!.observe(v));
    return () => {
      videos.forEach((v) => thumbObserverRef.current?.unobserve(v));
    };
  }, [sections]);

  const displayedGroups = sections.reduce((acc, s) => acc + (s.items?.length || 0), 0);
  const isMasonry = layout === 'masonry';
  const masonryCols = expanded
    ? 'columns-1 lg:columns-2'
    : 'columns-1 md:columns-2 xl:columns-3';

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
