import { useCallback, useEffect, useRef, useState, cloneElement, isValidElement } from 'react';
import { Image } from 'antd';
import { MediaGroup, deleteMediaItems } from '../api';
import { escHtml, clamp } from '../utils';
import { inspectMedia } from '../api';
import BaseVideo from './BaseVideo';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Virtual, Keyboard, Mousewheel } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import 'swiper/css';
import 'swiper/css/virtual';

type FlatItem = {
  id: string;
  groupIdx: number;
  itemIdx: number;
  item: import('../api').MediaItem;
  group: MediaGroup;
};

const FULL_LOAD_GROUP_MAX = 40;

function FeedImage({
  fullSrc,
  thumbSrc,
  alt,
  eager,
  loadFull,
  onLoadOrientation,
}: {
  fullSrc: string;
  thumbSrc?: string;
  alt: string;
  eager: boolean;
  loadFull: boolean;
  onLoadOrientation?: (img: HTMLImageElement) => void;
}) {
  const [fullLoaded, setFullLoaded] = useState(false);

  useEffect(() => {
    setFullLoaded(false);
  }, [fullSrc, loadFull]);

  const fallback = thumbSrc || fullSrc;

  return (
    <div className="feedImageWrap">
      <img
        className="feedImageThumb"
        src={fallback}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
      {loadFull && (
        <img
          className={`feedImageFull ${fullLoaded ? 'loaded' : ''}`}
          src={fullSrc}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={(e) => {
            setFullLoaded(true);
            onLoadOrientation?.(e.currentTarget);
          }}
        />
      )}
    </div>
  );
}

interface PreviewModalProps {
  groups: MediaGroup[];
  groupIdx: number;
  itemIdx: number;
  feedMode: boolean;
  onClose: () => void;
  onStep: (delta: number) => void;
  onSetItemIdx: (nextIdx: number) => void;
  onGroupStep: (delta: number) => void;
  onSetGroupIdx?: (nextIdx: number) => void; // 用于 Swiper 直接设置 group index
  onNeedMore?: () => void; // 仅沉浸路由页：触底时提前加载下一页，避免卡在尾部
  onFeedModeChange?: (feedMode: boolean) => void;
  onReload?: () => void;
  feedListMeta?: {
    index: number;
    total: number;
  };
  flatItems?: FlatItem[]; // 纯竖向模式：扁平化的 item 列表
  feedOverlay?: React.ReactNode; // Feed 浮层 UI
}

export default function PreviewModal({
  groups,
  groupIdx,
  itemIdx,
  feedMode,
  onClose,
  onStep,
  onSetItemIdx,
  onGroupStep,
  onSetGroupIdx,
  onNeedMore,
  onFeedModeChange,
  onReload,
  feedListMeta,
  flatItems,
  feedOverlay,
}: PreviewModalProps) {
  const [warnVisible, setWarnVisible] = useState(false);
  const [warnExtra, setWarnExtra] = useState('');
  const [showInspectInfo, setShowInspectInfo] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mediaOrientation, setMediaOrientation] = useState<'portrait' | 'landscape' | 'square' | 'unknown'>('unknown');

  // 智能静音策略：
  // 1. 默认静音（避免尴尬）
  // 2. 用户取消静音后，3分钟内切换视频保持状态
  // 3. 超过3分钟自动恢复静音
  const [isMuted, setIsMuted] = useState(() => {
    try {
      const saved = sessionStorage.getItem('video_muted_session');
      const timestamp = sessionStorage.getItem('video_muted_timestamp');

      if (saved !== null && timestamp) {
        const lastUpdate = parseInt(timestamp, 10);
        const now = Date.now();
        const threeMinutes = 3 * 60 * 1000; // 3分钟

        // 如果在3分钟内，保持上次的状态
        if (now - lastUpdate < threeMinutes) {
          return saved === '1';
        }
      }

      // 默认静音或超时后恢复静音
      return true;
    } catch {
      return true;
    }
  });

  // 播放速度偏好可以长期保存（不会造成尴尬）
  const [playbackRate, setPlaybackRate] = useState(() => {
    try {
      const saved = localStorage.getItem('video_playback_rate');
      return saved ? parseFloat(saved) : 1.0;
    } catch {
      return 1.0;
    }
  });

  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [imagePreviewCurrent, setImagePreviewCurrent] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const bodyScrollYRef = useRef<number>(0);
  const thumbStripRef = useRef<HTMLDivElement>(null);
  const suppressNextClickRef = useRef(false);
  // Swiper refs for immersive mode
  const groupSwiperRef = useRef<SwiperType | null>(null);
  const itemSwiperRefs = useRef<Map<number, SwiperType | null>>(new Map());
  const groupsLengthRef = useRef(groups.length);
  const preloadedGroupKeysRef = useRef<Set<string>>(new Set());
  const preloadedGroupPeekRef = useRef<Set<string>>(new Set());
  const preloadedSrcRef = useRef<Set<string>>(new Set());
  const swipeRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    startTime: number;
    blocked: boolean;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startTime: 0,
    blocked: false,
  });

  const bindVideoEl = useCallback((el: HTMLVideoElement | null) => {
    setVideoEl(el);
  }, []);

  const detectOrientation = useCallback((w: number, h: number) => {
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'unknown' as const;
    const ratio = w / h;
    if (ratio >= 1.1) return 'landscape' as const;
    if (ratio <= 0.9) return 'portrait' as const;
    return 'square' as const;
  }, []);

  // 保存静音偏好到 sessionStorage，并记录时间戳
  useEffect(() => {
    try {
      sessionStorage.setItem('video_muted_session', isMuted ? '1' : '0');
      sessionStorage.setItem('video_muted_timestamp', String(Date.now()));
    } catch {}
  }, [isMuted]);

  // 保存播放速度偏好到 localStorage（长期保存）
  useEffect(() => {
    try {
      localStorage.setItem('video_playback_rate', String(playbackRate));
    } catch {}
  }, [playbackRate]);

  // 应用播放速度到视频元素
  useEffect(() => {
    if (videoEl && playbackRate) {
      videoEl.playbackRate = playbackRate;
    }
  }, [videoEl, playbackRate]);

  const group = groups[groupIdx];
  if (!group) {
    onClose();
    return null;
  }

  const items = group.items || [];
  const clampedIdx = clamp(itemIdx, 0, Math.max(0, items.length - 1));
  const item = items[clampedIdx];
  if (!item) {
    onClose();
    return null;
  }

  const title = `${group.timeText || ''} · ${group.author || ''} · ${group.theme || ''}`.replace(
    /\s+·\s+$/,
    ''
  );
  const hint = `${clampedIdx + 1}/${items.length}  |  ${item.filename}`;
  const canThumbStrip = !feedMode && items.length > 1;

  // 仅图片参与 antd 的预览组：预览层可左右切换其它图片，并反向联动到主视图
  const imageEntries = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it?.kind === 'image' && typeof it.url === 'string' && it.url.length > 0);
  const imageUrls = imageEntries.map(({ it }) => it.url);
  const currentImageIndexInGroup = (() => {
    const found = imageEntries.findIndex((x) => x.idx === clampedIdx);
    return found >= 0 ? found : 0;
  })();

  // 滚动锁定：弹层打开时锁住 body 滚动
  useEffect(() => {
    const body = document.body;
    bodyScrollYRef.current = window.scrollY;
    body.style.position = 'fixed';
    body.style.top = `-${bodyScrollYRef.current}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    return () => {
      body.style.position = '';
      body.style.top = '';
      body.style.width = '';
      body.style.overflow = '';
      window.scrollTo(0, bodyScrollYRef.current);
    };
  }, []);

  // 拦截 wheel/touchmove 事件，防止滚动穿透
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    const handleWheel = (e: WheelEvent) => {
      // 如果事件发生在可交互容器内，允许其处理
      const target = e.target as HTMLElement;
      const allow = target.closest('.itemSwiper');
      if (!allow) {
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      const allow = target.closest('.itemSwiper');
      if (!allow) {
        e.preventDefault();
      }
    };

    // 使用 passive: false 以便可以 preventDefault
    modal.addEventListener('wheel', handleWheel, { passive: false });
    modal.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      modal.removeEventListener('wheel', handleWheel);
      modal.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  // 视频播放逻辑：仅在激活且是视频时处理
  useEffect(() => {
    if (item.kind !== 'video' || !videoEl) {
      setIsPlaying(false);
      setVideoReady(false);
      return;
    }
    const v = videoEl;
    // 使用保存的静音偏好
    v.muted = isMuted;
    // 应用播放速度
    v.playbackRate = playbackRate;

    const showWarn = (extra?: string) => {
      setWarnVisible(true);
      if (extra) setWarnExtra(extra);
    };

    // inspectMedia 仅在错误或用户需要时调用
    const handleError = async () => {
      const code = v.error?.code;
      const reason =
        code === 3
          ? '解码失败(MEDIA_ERR_DECODE)'
          : code === 4
            ? '源不支持(MEDIA_ERR_SRC_NOT_SUPPORTED)'
            : code === 2
              ? '网络错误(MEDIA_ERR_NETWORK)'
              : code === 1
                ? '播放中止(MEDIA_ERR_ABORTED)'
                : '未知错误';
      showWarn(reason);

      // 仅在错误时调用 inspectMedia
      if (showInspectInfo) {
        try {
          const j = await inspectMedia({ dirId: item.dirId || '', filename: item.filename });
          if (!j.ok || !j.info) return;
          const info = j.info;
          const codecLine = info.videoCodecHint ? `codec=${info.videoCodecHint}` : '';
          const moovLine = info.moov?.likelyFastStart
            ? 'faststart=是'
            : 'faststart=否(可能需下载完/不利于流式播放)';
          const hints =
            Array.isArray(info.codecHints) && info.codecHints.length
              ? `hints=${info.codecHints.join(', ')}`
              : '';
          const extra = [codecLine, moovLine, hints].filter(Boolean).join('  |  ');
          if (extra) setWarnExtra(extra);
        } catch {
          // ignore
        }
      }
    };

    const handleLoadedMetadata = () => {
      if (v.videoWidth === 0 && Number.isFinite(v.duration) && v.duration > 0) {
        showWarn('检测到 videoWidth=0（可能是音频-only 或视频轨无法解码）');
      }
      const nextOrientation = detectOrientation(v.videoWidth, v.videoHeight);
      setMediaOrientation(nextOrientation);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleReady = () => setVideoReady(true);
    const handleVolumeChange = () => {
      setIsMuted(v.muted);
    };

    v.addEventListener('error', handleError);
    v.addEventListener('loadedmetadata', handleLoadedMetadata);
    v.addEventListener('loadeddata', handleReady);
    v.addEventListener('canplay', handleReady);
    v.addEventListener('play', handlePlay);
    v.addEventListener('pause', handlePause);
    v.addEventListener('volumechange', handleVolumeChange);

    if (v.readyState >= 2) {
      handleReady();
    }

    // 自动播放（仅在 feedMode 或非 iOS）
    const playPromise = v.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {
        setIsPlaying(false);
      });
    }

    return () => {
      v.pause();
      // iOS Safari 在频繁切换视频时容易累积媒体资源；主动断开 src 以帮助释放内存
      try {
        v.removeAttribute('src');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (v as any).srcObject = null;
        v.load();
      } catch {
        // ignore
      }
      v.removeEventListener('error', handleError);
      v.removeEventListener('loadedmetadata', handleLoadedMetadata);
      v.removeEventListener('loadeddata', handleReady);
      v.removeEventListener('canplay', handleReady);
      v.removeEventListener('play', handlePlay);
      v.removeEventListener('pause', handlePause);
      v.removeEventListener('volumechange', handleVolumeChange);
    };
  }, [item, feedMode, clampedIdx, groupIdx, showInspectInfo, videoEl, detectOrientation]);

  useEffect(() => {
    setVideoReady(false);
  }, [item.dirId, item.filename, item.kind]);

  const canSwipeDetails = !feedMode && items.length > 1 && !imagePreviewOpen;

  // 沉浸模式：切换到某个合集时，预加载该合集内资源，减少滑动闪动
  useEffect(() => {
    if (!feedMode) return;
    const preloadGroup = (g: MediaGroup, key: string, full: boolean) => {
      const list = Array.isArray(g.items) ? g.items : [];
      const limit = full ? list.length : Math.min(list.length, 6);
      for (let idx = 0; idx < limit; idx++) {
        const it = list[idx];
        const url = it?.url || '';
        if (!url || preloadedSrcRef.current.has(url)) continue;
        preloadedSrcRef.current.add(url);

        if (it.kind === 'image') {
          const NativeImage = typeof window !== 'undefined' ? window.Image : null;
          if (NativeImage) {
            const img = new NativeImage();
            img.decoding = 'async';
            img.src = url;
          }
        } else if (it.kind === 'video') {
          try {
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.muted = true;
            v.playsInline = true;
            v.src = url;
            v.load();
          } catch {
            // ignore
          }
        }
      }
    };

    const indices = [groupIdx - 1, groupIdx, groupIdx + 1];
    for (const idx of indices) {
      if (idx < 0 || idx >= groups.length) continue;
      const g = groups[idx];
      if (!g) continue;
      const key = g.id || `${g.timeText || ''}|${g.author || ''}|${g.theme || ''}|${idx}`;
      const isActive = idx === groupIdx;
      if (isActive) {
        if (preloadedGroupKeysRef.current.has(key)) continue;
        preloadedGroupKeysRef.current.add(key);
        preloadGroup(g, key, true);
      } else {
        if (preloadedGroupKeysRef.current.has(key) || preloadedGroupPeekRef.current.has(key)) continue;
        preloadedGroupPeekRef.current.add(key);
        preloadGroup(g, key, false);
      }
    }
  }, [feedMode, groupIdx, groups]);

  const handleDetailsPointerDown = (e: React.PointerEvent) => {
    if (!canSwipeDetails) return;
    // 仅处理主按钮，避免右键等
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const btn = (e as any).button;
    if (typeof btn === 'number' && btn !== 0) return;

    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'button, a, input, textarea, select, .customMuteButton, .video-react-control-bar, .video-react-big-play-button'
      )
    ) {
      return;
    }

    swipeRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      blocked: false,
    };

    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleDetailsPointerMove = (e: React.PointerEvent) => {
    const s = swipeRef.current;
    if (!s.active || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    // 若明显是纵向移动，认为不是左右切换手势
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      s.blocked = true;
    }
  };

  const finishSwipe = (e: React.PointerEvent) => {
    const s = swipeRef.current;
    if (!s.active || s.pointerId !== e.pointerId) return;

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    const dt = Date.now() - s.startTime;

    swipeRef.current.active = false;
    swipeRef.current.pointerId = null;

    if (s.blocked) return;

    // 触发阈值：横向位移足够、且明显大于纵向位移、且在合理时间内
    if (dt < 800 && Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      // 向左滑 -> 下一项；向右滑 -> 上一项
      onStep(dx < 0 ? 1 : -1);
      suppressNextClickRef.current = true;
    }
  };

  const handleDetailsPointerUp = (e: React.PointerEvent) => finishSwipe(e);
  const handleDetailsPointerCancel = (e: React.PointerEvent) => finishSwipe(e);

  useEffect(() => {
    // 沉浸模式下，Swiper 的 Keyboard 模块会处理键盘事件，这里只处理 Esc
    if (feedMode) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
        // 其他按键（ArrowLeft/Right/Up/Down）由 Swiper Keyboard 模块处理
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }

    // 非沉浸模式：处理所有键盘事件
    const handleKeyDown = (e: KeyboardEvent) => {
      // antd Image 预览打开时，优先让预览层处理按键（尤其是 Esc）
      if (imagePreviewOpen) return;
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        onStep(-1);
      } else if (e.key === 'ArrowRight') {
        onStep(1);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [feedMode, imagePreviewOpen, onClose, onStep]);


  // 缩略图条自动跟随：保证当前项优先处于可见范围（尽量居中）
  useEffect(() => {
    if (!canThumbStrip) return;
    const strip = thumbStripRef.current;
    if (!strip) return;
    const el = strip.querySelector<HTMLElement>(`[data-thumb-idx="${clampedIdx}"]`);
    if (!el) return;
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    } catch {
      // ignore
    }
  }, [canThumbStrip, clampedIdx]);

  useEffect(() => {
    setWarnVisible(false);
    setWarnExtra('');
    setShowInspectInfo(false);
    setMediaOrientation('unknown');
  }, [groupIdx, clampedIdx]);

  // Sync Swiper to state (for immersive mode)
  useEffect(() => {
    if (!feedMode) return;
    const groupSwiper = groupSwiperRef.current;
    const flatMode = !!(flatItems && flatItems.length);
    const desiredIndex = flatMode ? (feedListMeta?.index ?? 0) : groupIdx;
    // 关键：纯竖向 flat 模式下，activeIndex 由 Swiper 驱动并通过 onSlideChange 回写到 state。
    // 如果这里再“强制对齐”，会在 state 尚未更新到最新 flatIndex 的瞬间把 Swiper 拉回旧 index，造成“滑动卡住/回弹”。
    if (flatMode) return;
    if (groupSwiper && groupSwiper.activeIndex !== desiredIndex) {
      groupSwiper.slideTo(desiredIndex, 0);
    }
  }, [feedMode, groupIdx, feedListMeta?.index, flatItems]);

  useEffect(() => {
    if (!feedMode) return;
    if (flatItems && flatItems.length) return; // 纯竖向模式无 itemSwiper
    const itemSwiper = itemSwiperRefs.current.get(groupIdx);
    if (itemSwiper && itemSwiper.activeIndex !== clampedIdx) {
      itemSwiper.slideTo(clampedIdx, 0);
    }
  }, [feedMode, groupIdx, clampedIdx]);

  // Keep groupsLengthRef in sync
  useEffect(() => {
    groupsLengthRef.current = groups.length;
  }, [groups.length]);

  // Update Swiper Virtual when groups length changes
  useEffect(() => {
    if (!feedMode) return;
    const groupSwiper = groupSwiperRef.current;
    if (groupSwiper && groupSwiper.virtual) {
      groupSwiper.virtual.update(true);
    }
  }, [feedMode, groups.length, flatItems?.length]);

  // 沉浸模式手势现在由 Swiper 处理，不再需要自定义手势处理函数

  const handleVideoClick = () => {
    if (!videoEl) return;
    if (isPlaying) {
      videoEl.pause();
    } else {
      videoEl.play().catch(() => {});
    }
  };

  const handleMuteToggle = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation(); // 防止触发视频播放/暂停
    }
    if (!videoEl) return;
    videoEl.muted = !videoEl.muted;
    setIsMuted(videoEl.muted);
  };

  const handleSpeedChange = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const currentIndex = speeds.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % speeds.length;
    setPlaybackRate(speeds[nextIndex]);
  };

  const doDelete = async (scope: 'item' | 'group') => {
    if (deleting) return;
    const targets =
      scope === 'group'
        ? (group.items || []).map((it) => ({ dirId: it.dirId || '', filename: it.filename }))
        : [{ dirId: item.dirId || '', filename: item.filename }];

    const missing = targets.find((x) => !x.dirId || !x.filename);
    if (missing) {
      window.alert('删除失败：缺少 dirId 或 filename（无法定位实际文件路径）');
      return;
    }

    const count = targets.length;
    const msg =
      scope === 'group'
        ? `确认删除当前合集（共 ${count} 个文件）？此操作不可恢复。`
        : `确认删除当前文件？\n\n${item.filename}\n\n此操作不可恢复。`;

    if (!window.confirm(msg)) return;

    setDeleting(true);
    try {
      const r = await deleteMediaItems(targets);
      if (!r.ok) throw new Error(r.error || '删除失败');
      // 关闭弹窗并刷新列表，避免本地状态和后端索引不一致
      onClose();
      onReload?.();
    } catch (e) {
      window.alert(String(e instanceof Error ? e.message : e));
    } finally {
      setDeleting(false);
    }
  };

  const renderMedia = (targetGroup: MediaGroup, currentIdx: number, isActive: boolean) => {
    const items = targetGroup.items || [];
    if (!items.length) {
      return (
        <div className="feedEmpty">
          暂无内容
        </div>
      );
    }
    const safeIdx = clamp(currentIdx, 0, Math.max(0, items.length - 1));
    const media = items[safeIdx];
    if (!media) return <div className="feedEmpty">暂无内容</div>;

    let mediaElement: React.ReactNode = null;

    if (media.kind === 'video') {
      if (isActive) {
        // 沉浸模式：使用自定义控件（无系统 controls）
        const useCustomControls = feedMode;
        mediaElement = (
          <>
            <div className={useCustomControls ? 'customVideoWrapper' : 'videoWrapper'} onClick={useCustomControls ? handleVideoClick : undefined}>
              <BaseVideo
                key={`active-${groupIdx}-${currentIdx}`}
                src={media.url}
                poster={media.thumbUrl}
                autoPlay
                playsInline
                preload={feedMode ? 'auto' : 'metadata'}
                muted={isMuted}
                loop={feedMode}
                controls={!useCustomControls}
                showSkeleton={!feedMode}
                className={useCustomControls ? 'modalVideo customControls' : 'modalVideo'}
                wrapperClassName="w-full h-full"
                playerStyle={{ width: '100%', height: '100%' }}
                onVideoEl={bindVideoEl}
              />
              {feedMode && media.thumbUrl && (
                <img
                  className={`feedVideoPoster ${videoReady ? 'hide' : ''}`}
                  src={media.thumbUrl}
                  alt={media.filename}
                  loading="eager"
                  decoding="async"
                />
              )}
              {useCustomControls && (
                <div className="customVideoControls" aria-hidden="true">
                  {!isPlaying && (
                    <div className="customPlayButton">
                      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                        <circle cx="32" cy="32" r="30" fill="rgba(0,0,0,.6)" stroke="rgba(255,255,255,.8)" strokeWidth="2"/>
                        <path d="M26 20 L26 44 L44 32 Z" fill="rgba(255,255,255,.9)"/>
                      </svg>
                    </div>
                  )}
                </div>
              )}
              {/* 静音按钮和播放速度按钮：仅在没有 feedOverlay 时显示（有 feedOverlay 时这些按钮会在工具栏中） */}
              {!feedOverlay && (
                <>
                  <button
                    className="customMuteButton"
                    onClick={handleMuteToggle}
                    title={isMuted ? '取消静音' : '静音'}
                    aria-label={isMuted ? '取消静音' : '静音'}
                  >
                    {isMuted ? (
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                        <path
                          d="M16 8 L10 12 L6 12 L6 20 L10 20 L16 24 L16 8 Z"
                          fill="rgba(255,255,255,.9)"
                        />
                        <path
                          d="M20 16 L24 12 M24 16 L20 12"
                          stroke="rgba(255,255,255,.9)"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                        <path
                          d="M16 8 L10 12 L6 12 L6 20 L10 20 L16 24 L16 8 Z"
                          fill="rgba(255,255,255,.9)"
                        />
                        <path
                          d="M20 10 L26 16 L20 22"
                          stroke="rgba(255,255,255,.9)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                  <button
                    className="customSpeedButton"
                    onClick={(e) => {
                      e.stopPropagation();
                      const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
                      const currentIndex = speeds.indexOf(playbackRate);
                      const nextIndex = (currentIndex + 1) % speeds.length;
                      setPlaybackRate(speeds[nextIndex]);
                    }}
                    title={`播放速度: ${playbackRate}x`}
                    aria-label={`播放速度: ${playbackRate}x`}
                  >
                    <span style={{ fontSize: '14px', fontWeight: 'bold' }}>
                      {playbackRate}x
                    </span>
                  </button>
                </>
              )}
            </div>
            {warnVisible && (
              <div className="warnBox">
                <button 
                  className="warnBox-close"
                  onClick={() => setWarnVisible(false)}
                  aria-label="关闭提示"
                >
                  ×
                </button>
                <div className="warnBox-title">⚠️ 视频编码不支持</div>
                <div className="warnBox-content">
                  浏览器不支持该视频编码（<code>H.265/HEVC</code>）
                  <div className="warnBox-solution">
                    <strong>解决方案：</strong>
                    <br />
                    • 点击下载后用系统播放器打开
                    <br />
                    • 安装浏览器 HEVC 扩展
                  </div>
                </div>
                {warnExtra && (
                  <div className="warnBox-extra">{escHtml(warnExtra)}</div>
                )}
                <button
                  className="warnBox-toggle"
                  onClick={() => setShowInspectInfo(!showInspectInfo)}
                >
                  {showInspectInfo ? '隐藏' : '显示'}技术详情
                </button>
              </div>
            )}
          </>
        );
      } else {
        // 非激活 slide：使用 thumbUrl 图片代替视频，减少媒体开销
        if (media.thumbUrl) {
          mediaElement = (
            <Image
              key={`preview-${groupIdx}-${currentIdx}`}
              src={media.thumbUrl}
              alt={media.filename}
              preview={false}
              className="feedPreviewVideo"
              classNames={{ image: 'feedPreviewVideoImg' }}
              styles={{ image: { width: '100%', height: '100%', objectFit: 'contain' } }}
            />
          );
        } else {
          // 没有 thumbUrl 时使用占位
          mediaElement = (
            <div key={`preview-${groupIdx}-${currentIdx}`} className="feedPreviewVideo feedPlaceholder">
              <div style={{ color: 'rgba(255,255,255,.5)', fontSize: '14px' }}>视频预览</div>
            </div>
          );
        }
      }
    } else if (media.kind === 'image') {
      // 沉浸模式：iOS 对大量原图解码非常敏感（会杀页/重载）。
      // 策略：DOM 只挂当前 item 的原图，其余 item 用 thumb；切换合集时预加载该合集资源减少闪动。

      if (feedMode) {
        const isActiveGroup = targetGroup === group;
        const loadAll = isActiveGroup && items.length <= FULL_LOAD_GROUP_MAX;
        const loadFull = isActive || loadAll || (isActiveGroup && Math.abs(currentIdx - clampedIdx) <= 1);
        mediaElement = (
          <FeedImage
            fullSrc={media.url}
            thumbSrc={media.thumbUrl ?? media.url}
            alt={media.filename}
            eager={isActive}
            loadFull={loadFull}
            onLoadOrientation={
              isActive
                ? (img) => {
                    const nextOrientation = detectOrientation(img.naturalWidth, img.naturalHeight);
                    setMediaOrientation(nextOrientation);
                  }
                : undefined
            }
          />
        );
      } else if (!isActive) {
        // iOS Safari 容易因内存压力导致页面被系统回收/重载：非激活 slide 不渲染原图（预览模式）
        const src = media.thumbUrl ?? media.url;
        mediaElement = (
          <img
            key={`preview-img-${groupIdx}-${currentIdx}`}
            src={src}
            alt={media.filename}
            loading="lazy"
            decoding="async"
            style={{
              maxWidth: '100%',
              maxHeight: 'calc(100vh - 220px)',
              objectFit: 'contain',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,.10)',
              background: '#000',
              display: 'block',
            }}
          />
        );
      } else {
        mediaElement = (
          <Image
            src={media.url}
            alt={media.filename}
            // 预览使用 PreviewGroup 的 items（见下方），在预览层内可左右切换其它图片并联动主视图
            preview={
              imageUrls.length > 1
                ? false
                : {
                    zIndex: 2000,
                    mask: '点击预览',
                    onOpenChange: (open) => setImagePreviewOpen(open),
                  }
            }
            className="modalImage"
            classNames={{ image: 'modalImageImg' }}
            styles={{
              root: { width: '100%', display: 'grid', placeItems: 'center' },
              image: { maxWidth: '100%', maxHeight: 'calc(100vh - 220px)', objectFit: 'contain' },
            }}
          />
        );
      }
    } else {
      mediaElement = (
        <a href={media.url} className="btn">
          打开文件：{escHtml(media.filename)}
        </a>
      );
    }

    return mediaElement;
  };

  // 沉浸模式：只渲染当前项（上下切换通过手势触发数据切换），避免大规模 DOM/媒体开销

  const renderAlbumBody = () => {
    // 不使用 Swiper，直接渲染当前索引的媒体项
    // 通过键盘、按钮和缩略图切换
    return renderMedia(group, clampedIdx, true);
  };

  // Immersive mode: Swiper-based rendering
  const handleGroupSwiperChange = useCallback((swiper: SwiperType) => {
    const newGroupIdx = swiper.activeIndex;
    const currentGroupsLength = groupsLengthRef.current;
    if (newGroupIdx !== groupIdx) {
      if (onSetGroupIdx) {
        onSetGroupIdx(newGroupIdx);
      } else {
        const delta = newGroupIdx - groupIdx;
        onGroupStep(delta);
      }
      // Trigger prefetch when near end - use ref for latest value
      if (currentGroupsLength - newGroupIdx <= 5) {
        onNeedMore?.();
      }
    }
  }, [groupIdx, onSetGroupIdx, onGroupStep, onNeedMore]);

  const handleItemSwiperChange = useCallback((swiper: SwiperType) => {
    const newItemIdx = swiper.activeIndex;
    onSetItemIdx(newItemIdx);
  }, [onSetItemIdx]);

  // 纯竖向模式：基于 flatItems 的滑动
  const handleFlatSwiperChange = useCallback((swiper: SwiperType) => {
    const newFlatIdx = swiper.activeIndex;
    if (onSetGroupIdx) {
      onSetGroupIdx(newFlatIdx);
    } else {
      const currentFlatIdx = feedListMeta?.index ?? 0;
      const delta = newFlatIdx - currentFlatIdx;
      onGroupStep(delta);
    }
    // Trigger prefetch when near end
    if (flatItems && flatItems.length - newFlatIdx <= 5) {
      onNeedMore?.();
    }
  }, [feedListMeta, flatItems, onSetGroupIdx, onGroupStep, onNeedMore]);

  // 增强 feedOverlay：注入视频控制相关的 props
  // 在 flatItems 模式下，使用当前 flatItem 的 item；否则使用 group 的 item
  const currentMediaItem = (flatItems && feedListMeta) 
    ? flatItems[feedListMeta.index]?.item 
    : item;
  
  const enhancedFeedOverlay = feedOverlay && isValidElement(feedOverlay) ? 
    cloneElement(feedOverlay as React.ReactElement<any>, {
      isMuted,
      playbackRate,
      onMuteToggle: () => handleMuteToggle(),
      onSpeedChange: () => handleSpeedChange(),
      showVideoControls: currentMediaItem?.kind === 'video',
    }) : feedOverlay;

  const feedBody = feedMode ? (
    flatItems && flatItems.length > 0 ? (
      // 纯竖向模式：基于 flatItems 的单层 Swiper
      <Swiper
        className="groupSwiper"
        direction="vertical"
        slidesPerView={1}
        spaceBetween={0}
        modules={[Virtual, Keyboard, Mousewheel]}
        virtual={{
          enabled: true,
          addSlidesAfter: 1,
          addSlidesBefore: 1,
        }}
        keyboard={{
          enabled: true,
          onlyInViewport: false,
        }}
        mousewheel={{
          enabled: true,
          forceToAxis: true,
          sensitivity: 1,
          releaseOnEdges: false,
        }}
        onSwiper={(swiper) => {
          groupSwiperRef.current = swiper;
          const currentFlatIdx = feedListMeta?.index ?? 0;
          swiper.slideTo(currentFlatIdx, 0);
        }}
        onSlideChange={handleFlatSwiperChange}
        style={{ width: '100%', height: '100%' }}
      >
        {flatItems.map((flatItem, flatIdx) => {
          const isActive = flatIdx === (feedListMeta?.index ?? 0);
          return (
            <SwiperSlide key={flatItem.id} virtualIndex={flatIdx}>
              <div className={`feedSlide ${isActive ? 'active' : ''} ${mediaOrientation === 'portrait' ? 'portrait' : ''}`}>
                {renderMedia(flatItem.group, flatItem.itemIdx, isActive)}
              </div>
            </SwiperSlide>
          );
        })}
      </Swiper>
    ) : (
      // 兼容模式：保持原有的 group-based 双层 Swiper
      <Swiper
        className="groupSwiper"
        direction="vertical"
        slidesPerView={1}
        spaceBetween={0}
        modules={[Virtual, Keyboard, Mousewheel]}
        virtual={{
          enabled: true,
          addSlidesAfter: 1,
          addSlidesBefore: 1,
        }}
        keyboard={{
          enabled: true,
          onlyInViewport: false,
        }}
        mousewheel={{
          enabled: true,
          forceToAxis: true,
          sensitivity: 1,
          releaseOnEdges: false,
        }}
        onSwiper={(swiper) => {
          groupSwiperRef.current = swiper;
          swiper.slideTo(groupIdx, 0);
        }}
        onSlideChange={handleGroupSwiperChange}
        style={{ width: '100%', height: '100%' }}
      >
        {groups.map((targetGroup, gIdx) => {
          const items = targetGroup.items || [];
          const isActiveGroup = gIdx === groupIdx;
          const nearGroup = Math.abs(gIdx - groupIdx) <= 1;
          const currentItemIdx = isActiveGroup ? clampedIdx : 0;
          const previewIdx = Math.max(0, Math.min(items.length - 1, 0));

          return (
            <SwiperSlide key={gIdx} virtualIndex={gIdx}>
              {isActiveGroup ? (
                <Swiper
                  className="itemSwiper"
                  direction="horizontal"
                  slidesPerView={1}
                  spaceBetween={0}
                  modules={[Virtual, Keyboard]}
                  virtual={{
                    enabled: true,
                    addSlidesAfter: 1,
                    addSlidesBefore: 1,
                  }}
                  keyboard={{
                    enabled: true,
                    onlyInViewport: false,
                  }}
                  onSwiper={(swiper) => {
                    itemSwiperRefs.current.set(gIdx, swiper);
                    swiper.slideTo(currentItemIdx, 0);
                  }}
                  onSlideChange={handleItemSwiperChange}
                  style={{ width: '100%', height: '100%' }}
                >
                  {items.map((_item, iIdx) => {
                    const isActiveItem = isActiveGroup && iIdx === clampedIdx;
                    return (
                      <SwiperSlide key={iIdx} virtualIndex={iIdx}>
                        <div className={`feedSlide ${isActiveItem ? 'active' : ''} ${mediaOrientation === 'portrait' ? 'portrait' : ''}`}>
                          {renderMedia(targetGroup, iIdx, isActiveItem)}
                        </div>
                      </SwiperSlide>
                    );
                  })}
                </Swiper>
              ) : nearGroup && items.length ? (
                <div className="feedSlide peek">
                  {renderMedia(targetGroup, previewIdx, false)}
                </div>
              ) : (
                <div className="feedSlide inactive">
                  <div style={{ color: 'rgba(255,255,255,.4)', fontSize: '14px', textAlign: 'center' }}>
                    {targetGroup.author || targetGroup.theme || `合集 ${gIdx + 1}`}
                  </div>
                </div>
              )}
            </SwiperSlide>
          );
        })}
      </Swiper>
    )
  ) : null;

  return (
    <div
      ref={modalRef}
      className={`modal ${feedMode ? 'feed' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="预览"
    >
      {/* Mobile typography fixes: long titles/hints should not break layout */}
      <style>
        {`
          @media (max-width: 520px){
            .pmTitle{
              white-space: normal !important;
              overflow: hidden !important;
              text-overflow: ellipsis !important;
              display: -webkit-box !important;
              -webkit-box-orient: vertical !important;
              -webkit-line-clamp: 2 !important;
              line-height: 1.35 !important;
            }
            .pmTop{
              align-items: flex-start !important;
            }
            .pmHint{
              white-space: normal !important;
              overflow: hidden !important;
              text-overflow: ellipsis !important;
              display: -webkit-box !important;
              -webkit-box-orient: vertical !important;
              -webkit-line-clamp: 2 !important;
              word-break: break-all !important;
            }
            .pmFeedTitle{
              overflow: hidden !important;
              text-overflow: ellipsis !important;
              display: -webkit-box !important;
              -webkit-box-orient: vertical !important;
              -webkit-line-clamp: 2 !important;
              word-break: break-word !important;
            }
          }
        `}
      </style>
      <div className="modalBackdrop" onClick={onClose}></div>
      <div className="modalPanel">
        <div className="modalTop pmTop">
          <div className="modalTitle pmTitle">{escHtml(title || item.filename)}</div>
          <div className="modalBtns">
            {onFeedModeChange && (
              <button
                id="toggleFeedMode"
                className={`iconBtn ${feedMode ? 'active' : ''}`}
                title={feedMode ? '切换到预览模式' : '切换到沉浸模式'}
                onClick={() => onFeedModeChange(!feedMode)}
              >
                {feedMode ? '📱' : '🎬'}
              </button>
            )}
            {/* 顶部左右按钮降级：仍保留桌面端兜底，但不作为主操作 */}
            {!feedMode && !canThumbStrip && (
              <>
                <button id="prev" className="iconBtn" title="上一项 (←)" onClick={() => onStep(-1)}>
                  ←
                </button>
                <button id="next" className="iconBtn" title="下一项 (→)" onClick={() => onStep(1)}>
                  →
                </button>
              </>
            )}
            <button id="close" className="iconBtn" title="关闭 (Esc)" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="modalBody">
          {!feedMode && imageUrls.length > 1 ? (
            <Image.PreviewGroup
              // docs: https://ant.design/components/image-cn#previewtype
              items={imageUrls}
              preview={{
                zIndex: 2000,
                open: imagePreviewOpen,
                current: imagePreviewCurrent,
                onOpenChange: (open, info) => {
                  setImagePreviewOpen(open);
                  if (info && typeof info.current === 'number') {
                    setImagePreviewCurrent(info.current);
                    const mapped = imageEntries[info.current]?.idx;
                    if (typeof mapped === 'number') onSetItemIdx(mapped);
                  }
                },
                onChange: (current) => {
                  setImagePreviewCurrent(current);
                  const mapped = imageEntries[current]?.idx;
                  if (typeof mapped === 'number') onSetItemIdx(mapped);
                },
              }}
            >
              {/* 主图：点击打开预览，并与缩略图条联动 */}
              <div
                className="modalBodyInner"
                onPointerDown={handleDetailsPointerDown}
                onPointerMove={handleDetailsPointerMove}
                onPointerUp={handleDetailsPointerUp}
                onPointerCancel={handleDetailsPointerCancel}
                onClick={() => {
                  // 若刚触发左右滑动切换，则不要把这次当成“点击打开预览”
                  if (suppressNextClickRef.current) {
                    suppressNextClickRef.current = false;
                    return;
                  }
                  // 点击主图打开预览：同步 current
                  if (items[clampedIdx]?.kind !== 'image') return;
                  if (!imageUrls.length) return;
                  setImagePreviewCurrent(currentImageIndexInGroup);
                  setImagePreviewOpen(true);
                }}
              >
                {renderAlbumBody()}
              </div>
            </Image.PreviewGroup>
          ) : (
            // 单张图片或非图集：保持原行为（图片单独预览 / 视频播放）
            (feedMode ? (
              <>
                {feedBody}
                {enhancedFeedOverlay}
              </>
            ) : (
              <div
                className="modalBodyInner"
                onPointerDown={handleDetailsPointerDown}
                onPointerMove={handleDetailsPointerMove}
                onPointerUp={handleDetailsPointerUp}
                onPointerCancel={handleDetailsPointerCancel}
              >
                {renderMedia(group, clampedIdx, true)}
              </div>
            ))
          )}
        </div>
        {!feedMode && (
          <div className="modalBottom">
            {canThumbStrip && (
              <div ref={thumbStripRef} className="thumbStrip" aria-label="图集缩略图">
                {items.map((it, idx) => {
                  const active = idx === clampedIdx;
                  const src = it.thumbUrl ?? it.url;
                  const isVideo = it.kind === 'video';
                  const isImage = it.kind === 'image';
                  return (
                    <button
                      key={`${idx}-${it.filename}`}
                      type="button"
                      className={`thumbPill ${active ? 'active' : ''}`}
                      title={it.filename}
                      data-thumb-idx={idx}
                      onClick={() => onSetItemIdx(idx)}
                    >
                      {(isVideo || isImage) ? (
                        <Image
                          src={src}
                          alt={it.filename}
                          preview={false}
                          className="thumbPillImg"
                          classNames={{ image: 'thumbPillImgEl' }}
                          styles={{ image: { width: '100%', height: '100%', objectFit: 'cover' } }}
                        />
                      ) : (
                        <div className="thumbPillOther">文件</div>
                      )}
                      {isVideo && <span className="thumbPillBadge">▶</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="modalBottomRow">
              <div className="modalHint pmHint">
                {hint}
                {warnExtra && `  |  ${escHtml(warnExtra)}`}
              </div>
              <div className="modalActions">
                <button
                  type="button"
                  className="btn compact danger ghost"
                  disabled={deleting}
                  onClick={() => doDelete('item')}
                  title="删除当前文件"
                >
                  删除单张
                </button>
                <button
                  type="button"
                  className="btn compact danger"
                  disabled={deleting}
                  onClick={() => doDelete('group')}
                  title="删除当前合集（整组）"
                >
                  删除合集
                </button>
                <a id="download" className="btn compact ghost" href={item.url} download={item.filename}>
                  下载
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
