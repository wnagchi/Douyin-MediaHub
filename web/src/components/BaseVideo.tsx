import { useEffect, useRef, useState } from 'react';
import { ControlBar, Player } from 'video-react';

interface BaseVideoProps {
  src: string;
  poster?: string;
  className?: string;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  playerStyle?: React.CSSProperties;
  rootMargin?: string;
  showSkeleton?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  playsInline?: boolean;
  preload?: 'auto' | 'metadata' | 'none';
  controls?: boolean;
  onVideoEl?: (video: HTMLVideoElement | null) => void;
}

// 与 BaseImage 类似：避免虚拟列表/Swiper 场景反复挂载造成的骨架闪烁
const loadedSrcCache = new Set<string>();
const MAX_CACHE_SIZE = 200;

function addToCache(src: string) {
  if (loadedSrcCache.size >= MAX_CACHE_SIZE) {
    const firstKey = loadedSrcCache.values().next().value;
    if (firstKey) loadedSrcCache.delete(firstKey);
  }
  loadedSrcCache.add(src);
}

function findVideoEl(root: HTMLElement | null): HTMLVideoElement | null {
  if (!root) return null;
  return root.querySelector('video');
}

export default function BaseVideo({
  src,
  poster,
  className = '',
  wrapperClassName = '',
  wrapperStyle,
  playerStyle,
  rootMargin = '240px 0px',
  showSkeleton = true,
  autoPlay = false,
  muted = false,
  loop = false,
  playsInline = true,
  preload = 'metadata',
  controls = true,
  onVideoEl,
}: BaseVideoProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const cached = loadedSrcCache.has(src);
  const [shouldLoad, setShouldLoad] = useState(cached);
  const [loaded, setLoaded] = useState(cached);

  useEffect(() => {
    const nextCached = loadedSrcCache.has(src);
    setShouldLoad(nextCached);
    setLoaded(nextCached);
  }, [src]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (shouldLoad) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShouldLoad(true);
            io.disconnect();
            break;
          }
        }
      },
      { root: null, rootMargin, threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, shouldLoad]);

  // 在 video-react 渲染完成后，拿到内部 <video>，用于：
  // - 让上层复用现有的事件监听/播放控制逻辑
  // - loaded/skeleton 状态
  useEffect(() => {
    if (!shouldLoad) {
      onVideoEl?.(null);
      return;
    }

    const root = wrapperRef.current;
    let raf = 0;
    let lastVideo: HTMLVideoElement | null = null;

    const attach = () => {
      const v = findVideoEl(root);
      if (!v) {
        raf = requestAnimationFrame(attach);
        return;
      }
      if (v === lastVideo) return;
      lastVideo = v;
      onVideoEl?.(v);

      const handleLoaded = () => {
        addToCache(src);
        setLoaded(true);
      };
      const handleError = () => {
        // stop skeleton even if it fails; leave error UI to upper layer
        setLoaded(true);
      };

      // 如果浏览器已经有数据，直接认为 loaded
      if (v.readyState >= 1) handleLoaded();

      v.addEventListener('loadedmetadata', handleLoaded, { once: true });
      v.addEventListener('loadeddata', handleLoaded, { once: true });
      v.addEventListener('error', handleError);

      return () => {
        v.removeEventListener('error', handleError);
      };
    };

    attach();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      onVideoEl?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldLoad, src]);

  return (
    <div ref={wrapperRef} className={`relative ${wrapperClassName}`} style={wrapperStyle}>
      {!loaded && showSkeleton && (
        <div className="absolute inset-0 bg-white/10 animate-pulse" aria-hidden="true"></div>
      )}
      {shouldLoad && (
        <Player
          ref={playerRef}
          src={src}
          poster={poster}
          autoPlay={autoPlay}
          muted={muted}
          loop={loop}
          playsInline={playsInline}
          preload={preload}
          className={className}
          style={playerStyle}
        >
          {controls ? <ControlBar autoHide={true} /> : <ControlBar disableCompletely={true} />}
        </Player>
      )}
    </div>
  );
}

