import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MediaItem, MediaGroup } from '../api';
import { escHtml } from '../utils';

interface FeedOverlayProps {
  item: MediaItem;
  group: MediaGroup;
  positionText?: string;
  onTagClick?: (tag: string) => void;
  // 视频控制相关
  isMuted?: boolean;
  playbackRate?: number;
  onMuteToggle?: () => void;
  onSpeedChange?: () => void;
  showVideoControls?: boolean; // 是否显示视频控制按钮（仅视频时显示）
}

export default function FeedOverlay({ 
  item, 
  group, 
  positionText, 
  onTagClick,
  isMuted = true,
  playbackRate = 1.0,
  onMuteToggle,
  onSpeedChange,
  showVideoControls = false,
}: FeedOverlayProps) {
  const navigate = useNavigate();

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    link.href = item.url;
    link.download = item.filename;
    link.click();
  }, [item.url, item.filename]);

  const handleTagClick = useCallback(
    (tag: string) => {
      if (onTagClick) {
        onTagClick(tag);
      } else {
        // 默认行为：跳转到主页面并应用标签筛选
        navigate(`/?tag=${encodeURIComponent(tag)}`);
      }
    },
    [onTagClick, navigate]
  );

  return (
    <div className="feedOverlay">
      {/* 右侧操作栏 */}
      <div className="feedActionRail" aria-label="操作栏">
        <div className="feedOverlayActions">
          {/* 视频控制按钮：仅在视频时显示 */}
          {showVideoControls && onMuteToggle && (
            <button
              className="feedActionBtn"
              onClick={onMuteToggle}
              title={isMuted ? '取消静音' : '静音'}
              aria-label={isMuted ? '取消静音' : '静音'}
            >
              {isMuted ? (
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                  <path
                    d="M16 8 L10 12 L6 12 L6 20 L10 20 L16 24 L16 8 Z"
                    fill="currentColor"
                  />
                  <path
                    d="M20 16 L24 12 M24 16 L20 12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                  <path
                    d="M16 8 L10 12 L6 12 L6 20 L10 20 L16 24 L16 8 Z"
                    fill="currentColor"
                  />
                  <path
                    d="M20 10 L26 16 L20 22"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          )}
          {showVideoControls && onSpeedChange && (
            <button
              className="feedActionBtn"
              onClick={onSpeedChange}
              title={`播放速度: ${playbackRate}x`}
              aria-label={`播放速度: ${playbackRate}x`}
            >
              <span style={{ fontSize: '14px', fontWeight: 'bold', fontFamily: 'var(--mono)' }}>
                {playbackRate}x
              </span>
            </button>
          )}
          <button
            className="feedActionBtn"
            onClick={handleDownload}
            title="下载"
            aria-label="下载"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 15V3M12 15L8 11M12 15L16 11M5 17H19"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* 底部信息 */}
      <div className="feedOverlayBottom">
        <div className="feedInfo">
          {group.author && (
            <div className="feedAuthor">{escHtml(group.author)}</div>
          )}
          {group.themeText && (
            <div className="feedTitle">{escHtml(group.themeText)}</div>
          )}
          <div className="feedMeta">
            {group.timeText && <span>{escHtml(group.timeText)}</span>}
            {positionText && <span>{positionText}</span>}
          </div>
        </div>
        {group.tags && group.tags.length > 0 && (
          <div className="feedTags">
            {group.tags.map((tag, idx) => (
              <button
                key={idx}
                className="feedTag"
                onClick={() => handleTagClick(tag)}
              >
                #{escHtml(tag)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
