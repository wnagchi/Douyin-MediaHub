import { useEffect, useRef, useState } from 'react';
import { Image } from 'antd';

interface LazyImageProps {
  src: string;
  alt?: string;
  className?: string;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  rootMargin?: string;
  onLoad?: (img: HTMLImageElement) => void;
  priority?: boolean; // 优先加载（首屏内容）
}

export default function LazyImage({
  src,
  alt = '',
  className,
  wrapperClassName,
  wrapperStyle,
  rootMargin = '400px 0px', // 增加预加载距离，手机端优化
  onLoad,
  priority = false,
}: LazyImageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(priority); // 优先级图片立即加载
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    // src changed => reset states
    setShouldLoad(priority);
    setLoaded(false);
    setError(false);
  }, [src, priority]);

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

  return (
    <div ref={wrapperRef} className={`relative ${wrapperClassName || ''}`} style={wrapperStyle}>
      {/* 加载骨架屏 - 渐进式显示 */}
      {!loaded && !error && (
        <div
          className="absolute inset-0 bg-gradient-to-br from-white/8 via-white/5 to-white/8 animate-pulse"
          aria-hidden="true"
          style={{
            backgroundSize: '200% 200%',
            animation: 'shimmer 2s ease-in-out infinite',
          }}
        ></div>
      )}

      {/* 加载失败提示 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 border border-white/10 rounded-lg">
          <div className="text-center text-white/50 text-xs px-4">
            <div className="mb-1">⚠️</div>
            <div>加载失败</div>
          </div>
        </div>
      )}

      <Image
        preview={false}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        src={shouldLoad ? src : undefined}
        className={`${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
        classNames={{ image: className || '' }}
        styles={{ image: { width: '100%', height: 'auto' } }}
        onLoad={(e) => {
          const img = (e?.currentTarget as unknown) as HTMLImageElement;
          setLoaded(true);
          setError(false);
          if (img) onLoad?.(img);
        }}
        onError={() => {
          setLoaded(true);
          setError(true);
        }}
      />
    </div>
  );
}

