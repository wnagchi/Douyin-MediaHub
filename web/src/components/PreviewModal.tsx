import { useEffect, useRef, useState } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Mousewheel, Keyboard } from 'swiper/modules';
import type { Swiper as SwiperClass } from 'swiper';
import 'swiper/css';
import 'swiper/css/mousewheel';
import 'swiper/css/keyboard';
import { MediaGroup } from '../api';
import { escHtml, clamp } from '../utils';
import { inspectMedia } from '../api';
import { getPreferredItemIndex } from '../utils/media';

interface PreviewModalProps {
  groups: MediaGroup[];
  groupIdx: number;
  itemIdx: number;
  feedMode: boolean;
  onClose: () => void;
  onStep: (delta: number) => void;
  onGroupStep: (delta: number) => void;
  onFeedModeChange?: (feedMode: boolean) => void;
}

export default function PreviewModal({
  groups,
  groupIdx,
  itemIdx,
  feedMode,
  onClose,
  onStep,
  onGroupStep,
  onFeedModeChange,
}: PreviewModalProps) {
  const [warnVisible, setWarnVisible] = useState(false);
  const [warnExtra, setWarnExtra] = useState('');
  const [showInspectInfo, setShowInspectInfo] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true); // 默认静音（feedMode 默认静音）
  const videoRef = useRef<HTMLVideoElement>(null);
  const swiperRef = useRef<SwiperClass | null>(null);
  const lastSlideRef = useRef(groupIdx);
  const lastItemIdxRef = useRef(itemIdx);
  const modalRef = useRef<HTMLDivElement>(null);
  const bodyScrollYRef = useRef<number>(0);

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
      // 如果事件发生在 Swiper 容器内，允许 Swiper 处理
      const target = e.target as HTMLElement;
      const isInSwiper = target.closest('.feedSwiper, .itemSwiper');
      if (!isInSwiper) {
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      const isInSwiper = target.closest('.feedSwiper, .itemSwiper');
      if (!isInSwiper) {
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
    if (item.kind !== 'video' || !videoRef.current) {
      setIsPlaying(false);
      return;
    }
    const v = videoRef.current;
    // 初始化静音状态：feedMode 默认静音，普通预览模式默认不静音
    const initialMuted = feedMode;
    setIsMuted(initialMuted);
    v.muted = initialMuted;

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
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleVolumeChange = () => {
      setIsMuted(v.muted);
    };

    v.addEventListener('error', handleError);
    v.addEventListener('loadedmetadata', handleLoadedMetadata);
    v.addEventListener('play', handlePlay);
    v.addEventListener('pause', handlePause);
    v.addEventListener('volumechange', handleVolumeChange);

    // 自动播放（仅在 feedMode 或非 iOS）
    const playPromise = v.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {
        setIsPlaying(false);
      });
    }

    return () => {
      v.pause();
      v.removeEventListener('error', handleError);
      v.removeEventListener('loadedmetadata', handleLoadedMetadata);
      v.removeEventListener('play', handlePlay);
      v.removeEventListener('pause', handlePause);
      v.removeEventListener('volumechange', handleVolumeChange);
    };
  }, [item, feedMode, clampedIdx, groupIdx, showInspectInfo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [onClose, onStep]);

  useEffect(() => {
    setWarnVisible(false);
    setWarnExtra('');
    setShowInspectInfo(false);
  }, [groupIdx, clampedIdx]);

  useEffect(() => {
    lastItemIdxRef.current = clampedIdx;
  }, [clampedIdx]);

  useEffect(() => {
    if (!feedMode || !swiperRef.current) return;
    if (swiperRef.current.activeIndex !== groupIdx) {
      swiperRef.current.slideTo(groupIdx, 0);
      lastSlideRef.current = groupIdx;
    }
  }, [feedMode, groupIdx]);

  const handleVideoClick = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => {});
    }
  };

  const handleMuteToggle = (e: React.MouseEvent) => {
    e.stopPropagation(); // 防止触发视频播放/暂停
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
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
              <video
                ref={videoRef}
                key={`active-${groupIdx}-${currentIdx}`}
                src={media.url}
                controls={!useCustomControls}
                autoPlay
                playsInline
                preload="metadata"
                muted={isMuted}
                loop={feedMode}
                className={useCustomControls ? 'modalVideo customControls' : 'modalVideo'}
              ></video>
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
              {/* 静音按钮在所有视频播放时都显示 */}
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
            </div>
            {warnVisible && (
              <div className="warnBox">
                该视频在浏览器里<strong>有声音但没画面</strong>时，通常是<strong>视频编码不被支持</strong>（常见：<code>H.265/HEVC</code>）。<br />
                建议：1) 点击右下角<strong>下载</strong>后用 VLC/系统播放器打开；2) 在 Win10/Edge/Chrome 安装 HEVC 扩展；3) 转码为 H.264(AVC) 再放。
                {warnExtra && <div style={{ marginTop: '8px' }}>{escHtml(warnExtra)}</div>}
                <button
                  onClick={() => setShowInspectInfo(!showInspectInfo)}
                  style={{ marginTop: '8px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer' }}
                >
                  {showInspectInfo ? '隐藏' : '显示'}详细信息
                </button>
              </div>
            )}
          </>
        );
      } else {
        // 非激活 slide：使用 thumbUrl 图片代替视频，减少媒体开销
        if (media.thumbUrl) {
          mediaElement = (
            <img
              key={`preview-${groupIdx}-${currentIdx}`}
              src={media.thumbUrl}
              alt={media.filename}
              className="feedPreviewVideo"
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
      mediaElement = <img src={media.url} alt={media.filename} />;
    } else {
      mediaElement = (
        <a href={media.url} className="btn">
          打开文件：{escHtml(media.filename)}
        </a>
      );
    }

    return (
      <>
        {mediaElement}
        {feedMode && isActive && (
          <div className="feedOverlay">
            <div className="feedTitle">
              {escHtml(`${targetGroup.author || ''}  ${targetGroup.theme || ''}`.trim() || targetGroup.theme || media.filename)}
            </div>
            <div className="feedSub">
              {escHtml(
                `${targetGroup.timeText || ''} | ${targetGroup.groupType || ''} | ${currentIdx + 1}/${items.length} | 上下滑切换`
              )}
            </div>
          </div>
        )}
      </>
    );
  };

  const renderInactiveSlide = (targetGroup: MediaGroup) => {
    const previewIdx = getPreferredItemIndex(targetGroup);
    return (
      <>
        {renderMedia(targetGroup, previewIdx, false)}
        <div className="feedOverlay">
          <div className="feedTitle">
            {escHtml(`${targetGroup.author || ''}  ${targetGroup.theme || ''}`.trim() || targetGroup.theme || '预览')}
          </div>
          <div className="feedSub">
            {escHtml(`${targetGroup.timeText || ''} | ${targetGroup.groupType || ''} | ${targetGroup.items?.length || 0} 条目`)}
          </div>
        </div>
      </>
    );
  };

  const renderFeedActiveSlide = () => {
    if (items.length <= 1) return renderMedia(group, clampedIdx, true);
    return (
      <Swiper
        direction="horizontal"
        nested
        slidesPerView={1}
        initialSlide={clampedIdx}
        className="itemSwiper"
        onSwiper={(instance) => {
          lastItemIdxRef.current = instance.activeIndex;
        }}
        onSlideChange={(instance) => {
          const next = instance.activeIndex;
          const prev = lastItemIdxRef.current;
          const delta = next - prev;
          if (delta !== 0) {
            onStep(delta);
          }
          lastItemIdxRef.current = next;
        }}
      >
        {items.map((_, idx) => (
          <SwiperSlide key={`item-${idx}`}>{renderMedia(group, idx, idx === clampedIdx)}</SwiperSlide>
        ))}
      </Swiper>
    );
  };

  const feedSwiper = (
    <Swiper
      direction="vertical"
      slidesPerView={1}
      modules={[Mousewheel, Keyboard]}
      mousewheel={{
        forceToAxis: true,
        releaseOnEdges: false,
        sensitivity: 1,
      }}
      keyboard={{ enabled: true }}
      initialSlide={groupIdx}
      onSwiper={(instance) => {
        swiperRef.current = instance;
        lastSlideRef.current = instance.activeIndex;
      }}
      onSlideChange={(instance) => {
        const prev = lastSlideRef.current;
        const next = instance.activeIndex;
        if (next > prev) {
          onGroupStep(1);
        } else if (next < prev) {
          onGroupStep(-1);
        }
        lastSlideRef.current = next;
      }}
      className="feedSwiper"
    >
      {groups.map((g, idx) => (
        <SwiperSlide key={`group-${idx}`}>
          {idx === groupIdx ? (
            <div className="feedSlide active">{renderFeedActiveSlide()}</div>
          ) : (
            <div className="feedSlide inactive">{renderInactiveSlide(g)}</div>
          )}
        </SwiperSlide>
      ))}
    </Swiper>
  );

  return (
    <div
      ref={modalRef}
      className={`modal ${feedMode ? 'feed' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="预览"
    >
      <div className="modalBackdrop" onClick={onClose}></div>
      <div className="modalPanel">
        <div className="modalTop">
          <div className="modalTitle">{escHtml(title || item.filename)}</div>
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
            {!feedMode && (
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
        <div className="modalBody">{feedMode ? feedSwiper : renderMedia(group, clampedIdx, true)}</div>
        {!feedMode && (
          <div className="modalBottom">
            <div className="modalHint">
              {hint}
              {warnExtra && `  |  ${escHtml(warnExtra)}`}
            </div>
            <a id="download" className="btn ghost" href={item.url} download={item.filename}>
              下载
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
