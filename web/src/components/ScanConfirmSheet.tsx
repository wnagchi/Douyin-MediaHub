import React from 'react';

interface ScanConfirmSheetProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

export default function ScanConfirmSheet({
  open,
  onCancel,
  onConfirm,
  loading,
}: ScanConfirmSheetProps) {
  if (!open) return null;

  return (
    <div className="scanSheetOverlay" onClick={onCancel} role="dialog" aria-modal="true">
      <div
        className="scanSheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="scanSheetHeader">
          <div className="scanSheetTitle">确认全量扫描</div>
          <button className="scanSheetClose" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="scanSheetBody">
          <div className="scanSheetDesc">
            全量扫描需要在前台执行，期间不可切换模式或进入沉浸模式。
          </div>
          <div className="scanSheetHint">建议在空闲时进行，可能需要较长时间。</div>
        </div>
        <div className="scanSheetActions">
          <button className="btn ghost" onClick={onCancel} disabled={loading}>
            取消
          </button>
          <button className="btn" onClick={onConfirm} disabled={loading}>
            {loading ? '扫描中…' : '开始扫描'}
          </button>
        </div>
      </div>
    </div>
  );
}
