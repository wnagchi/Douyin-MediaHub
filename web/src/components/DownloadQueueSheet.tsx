import { useMemo } from 'react';
import {
  selectDownloadCancelQueue,
  selectDownloadCloseQueue,
  selectDownloadQueueOpen,
  selectDownloadTask,
  selectDownloadTriggerQueueItem,
  useDownloadStore,
} from '../store';

function rowStatusText(status: string) {
  if (status === 'queued') return '待下载';
  if (status === 'triggering') return '触发中';
  if (status === 'triggered') return '已触发';
  if (status === 'failed') return '触发失败';
  if (status === 'cancelled') return '已取消';
  return status;
}

export default function DownloadQueueSheet() {
  const task = useDownloadStore(selectDownloadTask);
  const queueOpen = useDownloadStore(selectDownloadQueueOpen);
  const closeQueue = useDownloadStore(selectDownloadCloseQueue);
  const triggerQueueItem = useDownloadStore(selectDownloadTriggerQueueItem);
  const cancelQueue = useDownloadStore(selectDownloadCancelQueue);
  const queueInfo = useMemo(() => {
    if (!task || task.mode !== 'batch-mobile') return null;
    const pending = task.items.filter((item) => item.status === 'queued' || item.status === 'triggering').length;
    return { pending, total: task.items.length };
  }, [task]);

  if (!task || task.mode !== 'batch-mobile' || !queueOpen || !queueInfo) return null;

  return (
    <div className="downloadQueueSheetOverlay" onClick={closeQueue}>
      <div className="downloadQueueSheet" onClick={(e) => e.stopPropagation()}>
        <div className="downloadQueueSheetHeader">
          <div>
            <div className="downloadQueueSheetTitle">下载队列</div>
            <div className="downloadQueueSheetMeta">
              已触发 {task.triggered}/{queueInfo.total}，待处理 {queueInfo.pending}
            </div>
          </div>
          <button className="downloadQueueSheetIconBtn" onClick={closeQueue} aria-label="关闭队列">
            ×
          </button>
        </div>
        <div className="downloadQueueSheetBody">
          {task.items.map((item) => (
            <div key={item.id} className={`downloadQueueRow ${item.status}`}>
              <div className="downloadQueueRowMain">
                <div className="downloadQueueRowName">{item.filename}</div>
                <div className="downloadQueueRowStatus">{rowStatusText(item.status)}</div>
                {item.error && <div className="downloadQueueRowError">{item.error}</div>}
              </div>
              {(item.status === 'queued' || item.status === 'failed') ? (
                <button
                  className="downloadQueueRowBtn"
                  onClick={() => triggerQueueItem(item.id)}
                >
                  下载
                </button>
              ) : (
                <button className="downloadQueueRowBtn ghost" disabled>
                  {item.status === 'triggered' ? '完成' : '处理中'}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="downloadQueueSheetActions">
          <button className="downloadQueueSheetBtn ghost" onClick={closeQueue}>收起</button>
          {queueInfo.pending > 0 && (
            <button className="downloadQueueSheetBtn danger" onClick={cancelQueue}>取消剩余</button>
          )}
        </div>
      </div>
    </div>
  );
}
