import { useEffect, useRef, useState } from 'react';
import { Image } from 'antd';

interface BaseImageProps {
  src: string;
  alt?: string;
  className?: string;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  imgStyle?: React.CSSProperties;
  rootMargin?: string;
  onLoad?: (img: HTMLImageElement) => void;
  showSkeleton?: boolean;
  decoding?: 'sync' | 'async' | 'auto';
}

// 虚拟列表场景：图片会被卸载/重新挂载。用一个轻量缓存避免"回到视口就闪一下骨架"的体验。
// 使用简单的 Set，但限制最大数量防止无限增长
const loadedSrcCache = new Set<string>();
const MAX_CACHE_SIZE = 500; // 限制缓存大小

function addToCache(src: string) {
  if (loadedSrcCache.size >= MAX_CACHE_SIZE) {
    // 删除最旧的（Set 迭代顺序是插入顺序）
    const firstKey = loadedSrcCache.values().next().value;
    if (firstKey) {
      loadedSrcCache.delete(firstKey);
    }
  }
  loadedSrcCache.add(src);
}

/**
 * 统一基础图片组件
 * 
 * 必要素质：
 * - 懒加载：IntersectionObserver + loading="lazy"
 * - 占位/骨架：未加载时显示 skeleton（可配置）
 * - 错误兜底：onError 时隐藏 broken icon
 * - 尺寸策略：默认 width:100%, height:auto，不设置固定高度
 * - 可访问性：支持 alt，可传 aria-*
 * - 性能：支持 decoding="async"
 */
export default function BaseImage({
  src,
  alt = '',
  className = '',
  wrapperClassName = '',
  wrapperStyle,
  imgStyle,
  rootMargin = '240px 0px',
  onLoad,
  showSkeleton = true,
  decoding = 'async',
}: BaseImageProps) {
  // antd Image 会额外包一层，所以用外层 div 做 IntersectionObserver 的观测目标
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cached = loadedSrcCache.has(src);
  const [shouldLoad, setShouldLoad] = useState(cached);
  const [loaded, setLoaded] = useState(cached);

  useEffect(() => {
    // src changed => reset states
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

  return (
    <div ref={wrapperRef} className={`relative ${wrapperClassName} `} style={wrapperStyle}>
      {!loaded && showSkeleton && (
        <div className="absolute inset-0 bg-white/10 animate-pulse" aria-hidden="true"></div>
      )}
      <Image
        preview={false}
        alt={alt}
        loading="lazy"
        decoding={decoding}
        src={shouldLoad ? src : undefined}
        className={`w-full block ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
        // className/imgStyle 语义保持：原 className 主要是给 img 的
        classNames={{ image: className }}
        styles={{ image: { width: '100%', height: 'auto', ...(imgStyle || {}) } }}
        onLoad={(e) => {
          // antd Image 的 onLoad 透传到 img，拿到 HTMLImageElement
          const img = (e?.currentTarget as unknown) as HTMLImageElement;
          addToCache(src);
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
