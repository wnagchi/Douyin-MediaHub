import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MediaItem, MediaGroup } from '../api';
import { escHtml } from '../utils';

interface FeedOverlayProps {
  item: MediaItem;
  group: MediaGroup;
  positionText?: string;
  onTagClick?: (tag: string) => void;
}

export default function FeedOverlay({ item, group, positionText, onTagClick }: FeedOverlayProps) {
  const navigate = useNavigate();

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    link.href = item.url;
    link.download = item.filename;
    link.click();
  }, [item.url, item.filename]);

  const handleCopyLink = useCallback(async () => {
    const url = new URL(item.url, window.location.origin);
    try {
      await navigator.clipboard.writeText(url.toString());
      // 可以添加一个 toast 提示，这里简化处理
    } catch (e) {
      console.error('Failed to copy link:', e);
    }
  }, [item.url]);

  const handleCopyInfo = useCallback(async () => {
    const info = `文件名: ${item.filename}\n路径: ${item.dirId || ''}\nURL: ${item.url}`;
    try {
      await navigator.clipboard.writeText(info);
    } catch (e) {
      console.error('Failed to copy info:', e);
    }
  }, [item]);

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
    <div
      className="feedOverlay"
      onPointerDown={(e) => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/0fb33d7e-80b0-4097-89dd-e057fc4b7a5a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'debug-session',
            runId: 'run2',
            hypothesisId: 'B',
            location: 'web/src/components/FeedOverlay.tsx:pointerDown',
            message: 'pointerDown on overlay',
            data: {
              targetTag: (e.target as HTMLElement | null)?.tagName || null,
              targetClass: (e.target as HTMLElement | null)?.className || null,
              clientX: e.clientX,
              clientY: e.clientY,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      }}
    >
      {/* 右侧操作栏 */}
      <div
        className="feedOverlayActions"
        onPointerDown={(e) => {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/0fb33d7e-80b0-4097-89dd-e057fc4b7a5a', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: 'debug-session',
              runId: 'run2',
              hypothesisId: 'B',
              location: 'web/src/components/FeedOverlay.tsx:pointerDownActions',
              message: 'pointerDown on overlay actions',
              data: {
                targetTag: (e.target as HTMLElement | null)?.tagName || null,
                targetClass: (e.target as HTMLElement | null)?.className || null,
                clientX: e.clientX,
                clientY: e.clientY,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
        }}
      >
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
        <button
          className="feedActionBtn"
          onClick={handleCopyLink}
          title="复制链接"
          aria-label="复制链接"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M10 13C10 14.1 10.9 15 12 15C13.1 15 14 14.1 14 13C14 11.9 13.1 11 12 11C10.9 11 10 11.9 10 13Z"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M8 21H16C18.2091 21 20 19.2091 20 17V7C20 4.79086 18.2091 3 16 3H8C5.79086 3 4 4.79086 4 7V17C4 19.2091 5.79086 21 8 21Z"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </button>
        <button
          className="feedActionBtn"
          onClick={handleCopyInfo}
          title="复制信息"
          aria-label="复制信息"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M8 5.00005C7.01165 5.00005 6.49359 5.00005 6.09202 5.33799C5.71569 5.65678 5.40973 6.12871 5.20482 6.70087C5 7.27303 5 7.88411 5 9.10626V16.8937C5 18.1159 5 18.727 5.20482 19.2991C5.40973 19.8713 5.71569 20.3432 6.09202 20.662C6.49359 21 7.01165 21 8 21H16C16.9883 21 17.5064 21 17.908 20.662C18.2843 20.3432 18.5903 19.8713 18.7952 19.2991C19 18.727 19 18.1159 19 16.8937V9.10626C19 7.88411 19 7.27303 18.7952 6.70087C18.5903 6.12871 18.2843 5.65678 17.908 5.33799C17.5064 5.00005 16.9883 5.00005 16 5.00005H8Z"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M9 9H15M9 13H15M9 17H13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* 底部信息 */}
      <div
        className="feedOverlayBottom"
        onPointerDown={(e) => {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/0fb33d7e-80b0-4097-89dd-e057fc4b7a5a', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: 'debug-session',
              runId: 'run2',
              hypothesisId: 'B',
              location: 'web/src/components/FeedOverlay.tsx:pointerDownBottom',
              message: 'pointerDown on overlay bottom',
              data: {
                targetTag: (e.target as HTMLElement | null)?.tagName || null,
                targetClass: (e.target as HTMLElement | null)?.className || null,
                clientX: e.clientX,
                clientY: e.clientY,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
        }}
      >
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
