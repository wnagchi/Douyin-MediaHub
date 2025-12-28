import { useEffect, useRef } from 'react';
import { MediaGroup } from '../api';
import MediaCard from './MediaCard';

interface MediaGridProps {
  groups: MediaGroup[];
  hasMore: boolean;
  totalGroups: number;
  loadingMore: boolean;
  onLoadMore: () => void;
  onThumbClick: (groupIdx: number, itemIdx: number) => void;
}

const THUMB_ROOT_MARGIN = '240px 0px';

export default function MediaGrid({
  groups,
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
  }, [groups]);

  return (
    <div id="grid" className="grid" ref={gridRef}>
      {groups.map((group, groupIdx) => (
        <MediaCard
          key={groupIdx}
          group={group}
          groupIdx={groupIdx}
          onThumbClick={onThumbClick}
        />
      ))}
      <div className="listFooter">
        {hasMore ? (
          <button id="loadMore" className="btn" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? '加载中…' : `加载更多（${groups.length}/${totalGroups}）`}
          </button>
        ) : (
          <div className="endHint">已到底</div>
        )}
        <div id="sentinel" className="sentinel" aria-hidden="true" ref={sentinelRef}></div>
      </div>
    </div>
  );
}
