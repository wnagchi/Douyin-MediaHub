import React from 'react';
import { MediaDir } from '../api';

interface TopbarProps {
  q: string;
  activeType: string;
  activeDirId: string;
  dirs: MediaDir[];
  expanded: boolean;
  collapsed: boolean;
  viewMode: 'masonry' | 'album';
  sortMode: 'publish' | 'ingest';
  onQChange: (q: string) => void;
  onTypeChange: (type: string) => void;
  onDirChange: (dirId: string) => void;
  onFeedClick: () => void;
  onRefresh: () => void;
  onExpandedChange: (expanded: boolean) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onViewModeChange: (mode: 'masonry' | 'album') => void;
  onSortModeChange: (mode: 'publish' | 'ingest') => void;
}

const FILTER_TYPES = ['全部', '视频', '图集', '实况', '混合'];

export default function Topbar({
  q,
  activeType,
  activeDirId,
  dirs,
  expanded,
  collapsed,
  viewMode,
  sortMode,
  onQChange,
  onTypeChange,
  onDirChange,
  onFeedClick,
  onRefresh,
  onExpandedChange,
  onCollapsedChange,
  onViewModeChange,
  onSortModeChange,
}: TopbarProps) {
  const [qValue, setQValue] = React.useState(q);
  const qTimerRef = React.useRef<number>();
  const onQChangeRef = React.useRef(onQChange);

  React.useEffect(() => {
    onQChangeRef.current = onQChange;
  }, [onQChange]);

  React.useEffect(() => {
    setQValue(q);
  }, [q]);

  React.useEffect(() => {
    if (qTimerRef.current) clearTimeout(qTimerRef.current);
    qTimerRef.current = window.setTimeout(() => {
      onQChangeRef.current(qValue);
    }, 160);
    return () => {
      if (qTimerRef.current) clearTimeout(qTimerRef.current);
    };
  }, [qValue]);

  return (
    <header className={`topbar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand">
        <div className="logo" aria-hidden="true">
          M
        </div>
        <div className="brandText">
          <div className="title">媒体资源库</div>
          <div className="subtitle">按发布时间 / 发布人 / 主题自动分组，支持混合资源预览</div>
        </div>
        <button
          id="toggleTopbarCollapsedMini"
          className="iconBtn mobileOnly"
          title={collapsed ? '展开工具栏' : '收起工具栏'}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? '▾' : '▴'}
        </button>
      </div>

      <div className="controls">
        <div className="search">
          <input
            id="q"
            type="search"
            placeholder="搜索：发布人 / 主题 / 类型..."
            autoComplete="off"
            value={qValue}
            onChange={(e) => setQValue(e.target.value)}
          />
          <button
            id="clearQ"
            className="iconBtn"
            title="清空"
            onClick={() => {
              setQValue('');
              onQChange('');
            }}
          >
            ×
          </button>
        </div>
        <div className="dirPick">
          <select
            id="dirSelect"
            title="选择资源目录"
            value={activeDirId}
            onChange={(e) => onDirChange(e.target.value)}
          >
            <option value="all">全部目录</option>
            {dirs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label || d.path || d.id}
              </option>
            ))}
          </select>
        </div>
        <div className="dirPick">
          <select
            id="sortSelect"
            title="排序方式"
            value={sortMode}
            onChange={(e) => onSortModeChange(e.target.value as 'publish' | 'ingest')}
          >
            <option value="publish">按发布时间</option>
            <option value="ingest">按入库时间</option>
          </select>
        </div>
        <div className="filters" id="filters">
          {FILTER_TYPES.map((type) => (
            <button
              key={type}
              className={`chip ${activeType === type ? 'active' : ''}`}
              data-type={type}
              onClick={() => onTypeChange(type)}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="metaActions">
          <button
            id="toggleViewMode"
            className={`btn ghost toggle ${viewMode === 'masonry' ? 'active' : ''}`}
            title={viewMode === 'masonry' ? '瀑布流模式：图片全部展示，手机2列，电脑自适应' : '合集模式：按组展示，手机1列，电脑2列'}
            onClick={() => onViewModeChange(viewMode === 'masonry' ? 'album' : 'masonry')}
          >
            {viewMode === 'masonry' ? '瀑布流' : '合集'}
          </button>

          <button
            id="toggleExpanded"
            className={`btn ghost toggle ${expanded ? 'active' : ''}`}
            title="切换展开模式（更大卡片/更多缩略图）"
            onClick={() => onExpandedChange(!expanded)}
          >
            展开
          </button>
          <button id="refresh" className="btn" onClick={onRefresh}>
            刷新
          </button>
          <button id="feed" className="btn ghost" title="沉浸式上滑浏览" onClick={onFeedClick}>
            沉浸
          </button>
          <button
            id="toggleTopbarCollapsed"
            className="btn ghost toggle mobileOnly"
            title={collapsed ? '展开工具栏' : '收起工具栏'}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? '展开工具栏' : '收起工具栏'}
          </button>
        </div>
      </div>
    </header>
  );
}
