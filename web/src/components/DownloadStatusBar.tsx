import { useMemo } from 'react';
import { useDownload } from '../download/DownloadContext';

function statusLabel(status: string) {
  if (status === 'preparing') return '准备中';
  if (status === 'queued') return '队列中';
  if (status === 'triggering') return '触发中';
  if (status === 'triggered') return '已触发';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return status;
}

export default function DownloadStatusBar() {
  const { task, queueOpen, statusExpanded, openQueue, toggleStatusExpanded, dismissTask } = useDownload();
  const summary = useMemo(() => {
    if (!task) return null;
    const pending = task.items.filter((item) => item.status === 'queued' || item.status === 'triggering').length;
    return {
      pending,
      hasQueueAction: task.mode === 'batch-mobile' && pending > 0,
    };
  }, [task]);

  if (!task || !summary) return null;

  return (
    <div className="downloadStatusBar" role="status" aria-live="polite">
      <div className="downloadStatusBarTop">
        <div className="downloadStatusBarTitle">{task.name}</div>
        <div className={`downloadStatusBarState ${task.status}`}>{statusLabel(task.status)}</div>
      </div>
      {statusExpanded && (
        <div className="downloadStatusBarMeta">
          <span>进度: {task.triggered}/{task.total}</span>
          <span>失败: {task.failed}</span>
          {summary.pending > 0 && <span>待处理: {summary.pending}</span>}
        </div>
      )}
      <div className="downloadStatusBarActions">
        {summary.hasQueueAction && !queueOpen && (
          <button className="downloadStatusBarBtn" onClick={openQueue}>
            打开队列
          </button>
        )}
        <button className="downloadStatusBarBtn" onClick={toggleStatusExpanded}>
          {statusExpanded ? '收起' : '展开'}
        </button>
        <button className="downloadStatusBarBtn danger" onClick={dismissTask}>
          关闭
        </button>
      </div>
    </div>
  );
}
