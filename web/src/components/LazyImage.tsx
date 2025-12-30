import { useEffect, useRef, useState } from 'react';

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
  const imgRef = useRef<HTMLImageElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // src changed => reset states
    setShouldLoad(false);
    setLoaded(false);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/0fb33d7e-80b0-4097-89dd-e057fc4b7a5a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run2',hypothesisId:'H4',location:'LazyImage.tsx:reset',message:'LazyImage reset due to src change',data:{srcLen:String(src||'').length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [src]);

  useEffect(() => {
    const el = imgRef.current;
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
    <div className={`relative ${wrapperClassName || ''}`} style={wrapperStyle}>
      {!loaded && (
        <div className="absolute inset-0 bg-white/10 animate-pulse" aria-hidden="true"></div>
      )}
      <img
        ref={imgRef}
        loading="lazy"
        {...(shouldLoad ? { src } : {})}
        alt={alt}
        className={`${className || ''} transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={(e) => {
          setLoaded(true);
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/0fb33d7e-80b0-4097-89dd-e057fc4b7a5a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run2',hypothesisId:'H4',location:'LazyImage.tsx:onLoad',message:'LazyImage loaded',data:{shouldLoad,srcLen:String(src||'').length,nw:e.currentTarget.naturalWidth,nh:e.currentTarget.naturalHeight},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          onLoad?.(e.currentTarget);
        }}
        onError={() => {
          // stop skeleton; keep element hidden to avoid broken-icon flicker
          setLoaded(true);
        }}
      />
    </div>
  );
}

