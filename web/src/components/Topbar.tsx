import React from 'react';
import { Modal } from 'antd';
import { MediaDir, TagStat } from '../api';

interface TopbarProps {
  q: string;
  activeType: string;
  activeDirId: string;
  activeTag: string;
  tagStats: TagStat[];
  tagStatsLoading: boolean;
  tagStatsError: string | null;
  onReloadTags: () => void;
  dirs: MediaDir[];
  expanded: boolean;
  collapsed: boolean;
  viewMode: 'masonry' | 'album' | 'publisher';
  sortMode: 'publish' | 'ingest';
  onQChange: (q: string) => void;
  onTypeChange: (type: string) => void;
  onDirChange: (dirId: string) => void;
  onTagChange: (tag: string) => void;
  onFeedClick: () => void;
  onRefresh: () => void;
  onExpandedChange: (expanded: boolean) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onViewModeChange: (mode: 'masonry' | 'album' | 'publisher') => void;
  onSortModeChange: (mode: 'publish' | 'ingest') => void;
}

const FILTER_TYPES = ['全部', '视频', '图集', '实况', '混合'];

export default function Topbar({
  q,
  activeType,
  activeDirId,
  activeTag,
  tagStats,
  tagStatsLoading,
  tagStatsError,
  onReloadTags,
  dirs,
  expanded,
  collapsed,
  viewMode,
  sortMode,
  onQChange,
  onTypeChange,
  onDirChange,
  onTagChange,
  onFeedClick,
  onRefresh,
  onExpandedChange,
  onCollapsedChange,
  onViewModeChange,
  onSortModeChange,
}: TopbarProps) {
  const headerRef = React.useRef<HTMLElement | null>(null);
  const [qValue, setQValue] = React.useState(q);
  const qTimerRef = React.useRef<number>();
  const onQChangeRef = React.useRef(onQChange);

  const [tagValue, setTagValue] = React.useState(activeTag);
  const [tagModalOpen, setTagModalOpen] = React.useState(false);
  const [tagSearch, setTagSearch] = React.useState('');

  React.useEffect(() => {
    onQChangeRef.current = onQChange;
  }, [onQChange]);

  // 将 Topbar 实际高度写入 CSS 变量，供其它 sticky 元素避让（移动端尤其重要）
  React.useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => {
      const h = Math.max(0, Math.round(el.getBoundingClientRect().height || 0));
      root.style.setProperty('--topbar-h', `${h}px`);
    };
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => set());
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed, viewMode, sortMode, dirs.length, tagStats.length]);

  React.useEffect(() => {
    setQValue(q);
  }, [q]);
  React.useEffect(() => {
    setTagValue(activeTag);
  }, [activeTag]);

  const safeTagStats = React.useMemo(() => {
    return Array.isArray(tagStats) ? tagStats.filter((t) => t && t.tag) : [];
  }, [tagStats]);

  const filteredTagStats = React.useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    const base = safeTagStats;
    const list = q ? base.filter((t) => (`#${t.tag}`).toLowerCase().includes(q)) : base;
    return list.slice(0, q ? 800 : 300);
  }, [safeTagStats, tagSearch]);

  const tagTintStyle = React.useCallback((label: string) => {
    // stable color from string -> hue
    const s = String(label || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    const hue = h % 360;
    // Higher contrast for readability on dark modal background
    const bg = `hsla(${hue}, 85%, 56%, 0.30)`;
    const border = `hsla(${hue}, 90%, 62%, 0.55)`;
    const color = `hsla(${hue}, 90%, 96%, 0.98)`;
    return {
      background: bg,
      borderColor: border,
      color,
      fontWeight: 650,
      textShadow: '0 1px 2px rgba(0,0,0,.55)',
    } as React.CSSProperties;
  }, []);

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
    <header ref={headerRef as any} className={`topbar ${collapsed ? 'collapsed' : ''}`}>
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
            placeholder={viewMode === 'publisher' ? '搜索发布者（仅匹配发布者名）…' : '搜索：发布人 / 主题 / 类型...'}
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

        <div className="search">
          <input
            id="tag"
            type="search"
            placeholder="标签筛选：输入 #自拍 或 自拍（可清空）"
            autoComplete="off"
            value={tagValue}
            onChange={(e) => {
              const v = e.target.value;
              setTagValue(v);
              onTagChange(v);
            }}
          />
          <button
            id="clearTag"
            className="iconBtn"
            title="清空标签"
            onClick={() => {
              setTagValue('');
              onTagChange('');
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
            id="openTagModal"
            className="btn ghost"
            title="打开标签库（弹层）"
            onClick={() => {
              setTagSearch('');
              setTagModalOpen(true);
              onReloadTags?.();
            }}
          >
            标签库
          </button>
          <button
            id="toggleViewMode"
            className={`btn ghost toggle ${viewMode !== 'album' ? 'active' : ''}`}
            title={
              viewMode === 'masonry'
                ? '瀑布流模式：图片尽量全部展示（大数据量会更吃内存）'
                : viewMode === 'album'
                  ? '合集模式：按组展示（更省内存）'
                  : '按发布者：先列发布者，再按发布者分页查看'
            }
            onClick={() => {
              const next = viewMode === 'masonry' ? 'album' : viewMode === 'album' ? 'publisher' : 'masonry';
              onViewModeChange(next);
            }}
          >
            {viewMode === 'masonry' ? '瀑布流' : viewMode === 'album' ? '合集' : '发布者'}
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

      <Modal
        title="标签库（点击筛选）"
        open={tagModalOpen}
        onCancel={() => setTagModalOpen(false)}
        footer={null}
        centered
        className="tagModal"
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            type="search"
            placeholder="搜索标签…"
            value={tagSearch}
            onChange={(e) => setTagSearch(e.target.value)}
            style={{
              flex: 1,
              border: '1px solid rgba(255,255,255,.12)',
              background: 'rgba(255,255,255,.06)',
              color: 'rgba(255,255,255,.92)',
              borderRadius: 12,
              padding: '10px 12px',
              outline: 'none',
            }}
          />
          <button className="btn ghost compact" onClick={() => setTagSearch('')} title="清空搜索">
            清空
          </button>
        </div>

        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'rgba(255,255,255,.75)' }}>
            当前筛选：{activeTag || '-'} | 显示：{filteredTagStats.length}/{safeTagStats.length}
          </div>
          {activeTag && (
            <button
              className="btn ghost compact"
              onClick={() => {
                setTagValue('');
                onTagChange('');
              }}
              title="清空当前标签筛选"
            >
              清空筛选
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: '56vh', overflow: 'auto', paddingRight: 4 }}>
          {tagStatsLoading && (
            <div style={{ color: 'rgba(255,255,255,.75)', fontSize: 12, fontFamily: 'var(--mono)' }}>加载标签中…</div>
          )}
          {!tagStatsLoading && tagStatsError && (
            <div style={{ color: 'rgba(255, 99, 132, .92)', fontSize: 12, fontFamily: 'var(--mono)' }}>
              加载失败：{tagStatsError}
            </div>
          )}
          {!tagStatsLoading && !tagStatsError && safeTagStats.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,.75)', fontSize: 12, fontFamily: 'var(--mono)', lineHeight: 1.6 }}>
              <div>暂无标签统计。</div>
              <div style={{ opacity: 0.85 }}>
                可能原因：还没执行过 <code>/api/reindex?force=1</code> 回填 tags，或当前目录没有包含 <code>#标签</code> 的描述。
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => onReloadTags?.()}>
                  重新加载标签
                </button>
              </div>
            </div>
          )}
          {filteredTagStats.map((t) => {
            const label = `#${t.tag}`;
            const isActive = activeTag.trim() === label || activeTag.trim() === t.tag;
            return (
              <button
                key={t.tag}
                className={`chip ${isActive ? 'active' : ''}`}
                style={isActive ? undefined : tagTintStyle(label)}
                title={`${label} | groups=${t.groupCount} items=${t.itemCount}`}
                onClick={() => {
                  setTagValue(label);
                  onTagChange(label);
                  setTagModalOpen(false);
                }}
              >
                {label} ({t.groupCount})
              </button>
            );
          })}
        </div>
      </Modal>
    </header>
  );
}
