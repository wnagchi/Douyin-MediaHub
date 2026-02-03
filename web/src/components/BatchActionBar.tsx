interface BatchActionBarProps {
  selectedCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onDownload: () => void;
  onDelete: () => Promise<unknown>;
  onCancel: () => void;
}

export default function BatchActionBar({
  selectedCount,
  onSelectAll,
  onClear,
  onDownload,
  onDelete,
  onCancel,
}: BatchActionBarProps) {
  const handleDelete = async () => {
    if (selectedCount === 0) return;

    const confirmed = window.confirm(
      `确定要删除选中的 ${selectedCount} 个文件吗？\n\n此操作不可撤销！`
    );

    if (!confirmed) return;

    try {
      await onDelete();
      alert(`成功删除 ${selectedCount} 个文件`);
    } catch (error) {
      alert(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="batchActionBar">
      <div className="batchActionBarContent">
        <div className="batchActionBarInfo">
          <span className="batchActionBarCount">已选择 {selectedCount} 项</span>
          <button className="batchActionBarLink" onClick={selectedCount === 0 ? onSelectAll : onClear}>
            {selectedCount === 0 ? '全选' : '清空'}
          </button>
        </div>
        <div className="batchActionBarButtons">
          <button
            className="batchActionBarButton download"
            disabled={selectedCount === 0}
            onClick={onDownload}
            title="下载选中项"
          >
            <span className="batchActionBarButtonIcon">⬇️</span>
            <span className="batchActionBarButtonText">下载</span>
          </button>
          <button
            className="batchActionBarButton delete"
            disabled={selectedCount === 0}
            onClick={handleDelete}
            title="删除选中项"
          >
            <span className="batchActionBarButtonIcon">🗑️</span>
            <span className="batchActionBarButtonText">删除</span>
          </button>
          <button className="batchActionBarButton cancel" onClick={onCancel} title="取消选择">
            <span className="batchActionBarButtonIcon">✕</span>
            <span className="batchActionBarButtonText">取消</span>
          </button>
        </div>
      </div>
    </div>
  );
}
