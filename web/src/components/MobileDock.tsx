import { memo } from 'react';

type ViewMode = 'masonry' | 'album' | 'publisher';

interface MobileDockProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onImmersive: () => void;
  onScanClick: () => void;
  scanDisabled?: boolean;
  immersiveDisabled?: boolean;
  hidden?: boolean;
}

const MobileDock = memo(function MobileDock({
  viewMode,
  onViewModeChange,
  onImmersive,
  onScanClick,
  scanDisabled,
  immersiveDisabled,
  hidden,
}: MobileDockProps) {
  return (
    <div className={`mobileDock ${hidden ? 'mobileDockHidden' : ''}`}>
      <div className="mobileDockInner">
        <div className="mobileDockSegmented" role="tablist" aria-label="视图切换">
          <button
            className={`mobileDockSegment ${viewMode === 'masonry' ? 'active' : ''}`}
            onClick={() => onViewModeChange('masonry')}
            role="tab"
            aria-selected={viewMode === 'masonry'}
          >
            瀑布流
          </button>
          <button
            className={`mobileDockSegment ${viewMode === 'album' ? 'active' : ''}`}
            onClick={() => onViewModeChange('album')}
            role="tab"
            aria-selected={viewMode === 'album'}
          >
            合集
          </button>
          <button
            className={`mobileDockSegment ${viewMode === 'publisher' ? 'active' : ''}`}
            onClick={() => onViewModeChange('publisher')}
            role="tab"
            aria-selected={viewMode === 'publisher'}
          >
            发布者
          </button>
        </div>

        <div className="mobileDockActions">
          <button
            className="mobileDockAction immersive"
            onClick={onImmersive}
            disabled={immersiveDisabled}
            title="进入沉浸模式"
          >
            🎬
          </button>
          <button
            className="mobileDockAction scan"
            onClick={onScanClick}
            disabled={scanDisabled}
            title="全量扫描"
          >
            扫描
          </button>
        </div>
      </div>
    </div>
  );
});

export default MobileDock;
