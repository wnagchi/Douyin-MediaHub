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
}

export default function LazyImage({
  src,
  alt = '',
  className,
  wrapperClassName,
  wrapperStyle,
  rootMargin = '240px 0px',
  onLoad,
}: LazyImageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // src changed => reset states
    setShouldLoad(false);
    setLoaded(false);
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

  return (
    <div ref={wrapperRef} className={`relative ${wrapperClassName || ''}`} style={wrapperStyle}>
      {!loaded && (
        <div className="absolute inset-0 bg-white/10 animate-pulse" aria-hidden="true"></div>
      )}
      <Image
        preview={false}
        alt={alt}
        loading="lazy"
        src={shouldLoad ? src : undefined}
        className={`${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
        classNames={{ image: className || '' }}
        styles={{ image: { width: '100%', height: 'auto' } }}
        onLoad={(e) => {
          const img = (e?.currentTarget as unknown) as HTMLImageElement;
          setLoaded(true);
          if (img) onLoad?.(img);
        }}
        onError={() => {
          // stop skeleton; keep element hidden to avoid broken-icon flicker
          setLoaded(true);
        }}
      />
    </div>
  );
}

