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
}

export default function PreviewModal({
  groups,
  groupIdx,
  itemIdx,
  feedMode,
  onClose,
  onStep,
  onGroupStep,
}: PreviewModalProps) {
  const [warnVisible, setWarnVisible] = useState(false);
  const [warnExtra, setWarnExtra] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const swiperRef = useRef<SwiperClass | null>(null);
  const lastSlideRef = useRef(groupIdx);

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

  useEffect(() => {
    if (item.kind === 'video' && videoRef.current) {
      const v = videoRef.current;
      const showWarn = (extra?: string) => {
        setWarnVisible(true);
        if (extra) setWarnExtra(extra);
      };

      (async () => {
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
      })();

      const handleError = () => {
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
      };

      const handleLoadedMetadata = () => {
        if (v.videoWidth === 0 && Number.isFinite(v.duration) && v.duration > 0) {
          showWarn('检测到 videoWidth=0（可能是音频-only 或视频轨无法解码）');
        }
      };

      v.addEventListener('error', handleError);
      v.addEventListener('loadedmetadata', handleLoadedMetadata);

      return () => {
        v.removeEventListener('error', handleError);
        v.removeEventListener('loadedmetadata', handleLoadedMetadata);
      };
    }
  }, [item]);

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
    if (!feedMode || !swiperRef.current) return;
    if (swiperRef.current.activeIndex !== groupIdx) {
      swiperRef.current.slideTo(groupIdx, 0);
      lastSlideRef.current = groupIdx;
    }
  }, [feedMode, groupIdx]);

  const renderMedia = (targetGroup: MediaGroup, currentIdx: number, isActive: boolean) => {
    const items = targetGroup.items || [];
    if (!items.length) {
      return <div className="feedEmpty">暂无内容</div>;
    }
    const safeIdx = clamp(currentIdx, 0, Math.max(0, items.length - 1));
    const media = items[safeIdx];
    if (!media) return <div className="feedEmpty">暂无内容</div>;

    if (media.kind === 'video') {
      if (isActive) {
        return (
          <>
            <video
              ref={videoRef}
              src={media.url}
              controls
              autoPlay
              playsInline
              preload="metadata"
            ></video>
            {warnVisible && (
              <div className="warnBox">
                该视频在浏览器里<strong>有声音但没画面</strong>时，通常是<strong>视频编码不被支持</strong>（常见：<code>H.265/HEVC</code>）。<br />
                建议：1) 点击右下角<strong>下载</strong>后用 VLC/系统播放器打开；2) 在 Win10/Edge/Chrome 安装 HEVC 扩展；3) 转码为 H.264(AVC) 再放。
                {warnExtra && <div style={{ marginTop: '8px' }}>{escHtml(warnExtra)}</div>}
              </div>
            )}
          </>
        );
      }
      return (
        <video
          src={media.url}
          muted
          playsInline
          preload="metadata"
          className="feedPreviewVideo"
        ></video>
      );
    }
    if (media.kind === 'image') {
      return <img src={media.url} alt={media.filename} />;
    }
    return (
      <a href={media.url} className="btn">
        打开文件：{escHtml(media.filename)}
      </a>
    );
  };

  const renderInactiveSlide = (targetGroup: MediaGroup) => {
    const previewIdx = getPreferredItemIndex(targetGroup);
    return (
      <div className="feedSlide">
        {renderMedia(targetGroup, previewIdx, false)}
        <div className="feedOverlay">
          <div className="feedTitle">
            {escHtml(`${targetGroup.author || ''}  ${targetGroup.theme || ''}`.trim() || targetGroup.theme || '预览')}
          </div>
          <div className="feedSub">
            {escHtml(`${targetGroup.timeText || ''} | ${targetGroup.groupType || ''} | ${targetGroup.items?.length || 0} 条目`)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`modal ${feedMode ? 'feed' : ''}`} role="dialog" aria-modal="true" aria-label="预览">
      <div className="modalBackdrop" onClick={onClose}></div>
      <div className="modalPanel" onWheel={handleWheel} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <div className="modalTop">
          <div className="modalTitle">{escHtml(title || item.filename)}</div>
          <div className="modalBtns">
            <button id="prev" className="iconBtn" title="上一项 (←)" onClick={() => onStep(-1)}>
              ←
            </button>
            <button id="next" className="iconBtn" title="下一项 (→)" onClick={() => onStep(1)}>
              →
            </button>
            <button id="close" className="iconBtn" title="关闭 (Esc)" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="modalBody" id="modalBody">
          {item.kind === 'video' ? (
            <>
              <video
                ref={videoRef}
                src={item.url}
                controls
                autoPlay
                playsInline
                preload="metadata"
              ></video>
              {warnVisible && (
                <div className="warnBox" style={{ display: warnVisible ? '' : 'none' }}>
                  该视频在浏览器里<strong>有声音但没画面</strong>时，通常是<strong>视频编码不被支持</strong>（常见：<code>H.265/HEVC</code>）。<br />
                  建议：1) 点击右下角<strong>下载</strong>后用 VLC/系统播放器打开；2) 在 Win10/Edge/Chrome 安装 HEVC 扩展；3) 转码为 H.264(AVC) 再放。
                  {warnExtra && <div style={{ marginTop: '8px' }}>{escHtml(warnExtra)}</div>}
                </div>
              )}
            </>
          ) : item.kind === 'image' ? (
            <img src={item.url} alt={item.filename} />
          ) : (
            <a href={item.url} className="btn">
              打开文件：{escHtml(item.filename)}
            </a>
          )}
          {feedMode && (
            <div className="feedOverlay">
              <div className="feedTitle">
                {escHtml(`${group.author || ''}  ${group.theme || ''}`.trim() || group.theme || item.filename)}
              </div>
              <div className="feedSub">
                {escHtml(
                  `${group.timeText || ''} | ${group.groupType || ''} | ${clampedIdx + 1}/${items.length} | 上滑下一组 / 下滑上一组`
                )}
              </div>
            </div>
          )}
        </div>
        <div className="modalBottom">
          <div className="modalHint" id="modalHint">
            {hint}
            {warnExtra && `  |  ${escHtml(warnExtra)}`}
          </div>
          <a id="download" className="btn ghost" href={item.url} download={item.filename}>
            下载
          </a>
        </div>
      </div>
    </div>
  );
}
