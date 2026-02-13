import React, { memo } from 'react';
import { Modal, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { MediaDir, TagStat } from '../api';

interface TopbarProps {
  q: string;
  activeType: string;
  activeDirId: string;
  activeTag: string;
  activeTags: string[];
  tagFilterMode: 'AND' | 'OR';
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
  onTagsChange: (tags: string[]) => void;
  onTagFilterModeChange: (mode: 'AND' | 'OR') => void;
  onFeedClick: () => void;
  onRefresh: () => void;
  onFullScan: () => Promise<any>;
  fullScanLoading: boolean;
  selectionMode: boolean;
  selectedCount: number;
  onToggleSelectionMode: () => void;
  onExpandedChange: (expanded: boolean) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onViewModeChange: (mode: 'masonry' | 'album' | 'publisher') => void;
  onSortModeChange: (mode: 'publish' | 'ingest') => void;
  mobileVariant?: boolean;
}

const FILTER_TYPES = ['全部', '视频', '图集', '实况', '混合'];

const Topbar = memo(function Topbar({
  q,
  activeType,
  activeDirId,
  activeTag,
  activeTags,
  tagFilterMode,
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
  onTagsChange,
  onTagFilterModeChange,
  onFeedClick,
  onRefresh,
  onFullScan,
  fullScanLoading,
  selectionMode,
  selectedCount,
  onToggleSelectionMode,
  onExpandedChange,
  onCollapsedChange,
  onViewModeChange,
  onSortModeChange,
  mobileVariant,
}: TopbarProps) {
  const headerRef = React.useRef<HTMLElement | null>(null);
  const isMobileVariant = Boolean(mobileVariant);
  const navigate = useNavigate();
  const [qValue, setQValue] = React.useState(q);

  const [tagValue, setTagValue] = React.useState(activeTag);
  const [tagModalOpen, setTagModalOpen] = React.useState(false);
  const [tagSearch, setTagSearch] = React.useState('');
  const [filterPanelOpen, setFilterPanelOpen] = React.useState(false);
  const [toolsPanelOpen, setToolsPanelOpen] = React.useState(false);

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
  }, [collapsed, viewMode, sortMode, dirs.length, tagStats.length, filterPanelOpen, toolsPanelOpen]);

  React.useEffect(() => {
    setQValue(q);
  }, [q]);
  React.useEffect(() => {
    setTagValue(activeTag);
  }, [activeTag]);
  React.useEffect(() => {
    if (collapsed) {
      setFilterPanelOpen(false);
      setToolsPanelOpen(false);
    }
  }, [collapsed]);
  React.useEffect(() => {
    if (isMobileVariant) {
      setFilterPanelOpen(false);
      setToolsPanelOpen(false);
    }
  }, [isMobileVariant]);

  const submitSearch = React.useCallback(() => {
    const next = qValue.trim();
    setQValue(next);
    onQChange(next);
  }, [onQChange, qValue]);

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

  const activeFilterCount = React.useMemo(() => {
    let count = 0;
    if (q.trim()) count += 1;
    if (activeType && activeType !== '全部') count += 1;
    if (activeDirId && activeDirId !== 'all') count += 1;
    if (sortMode && sortMode !== 'publish') count += 1;
    if ((activeTag && activeTag.trim()) || activeTags.length > 0) count += 1;
    return count;
  }, [q, activeType, activeDirId, sortMode, activeTag, activeTags.length]);

  return (
    <header ref={headerRef as any} className={`topbar ${collapsed ? 'collapsed' : ''}`}>
      <div className="topbarMain">
        <div className="brand">
          <div className="search primarySearch brandSearch" style={{ position: 'relative' }}>
            <input
              id="q"
              type="search"
              placeholder={viewMode === 'publisher' ? '搜索作者（仅匹配作者名）…' : '搜索：作者 / 主题 / 关键词…'}
              autoComplete="off"
              value={qValue}
              onChange={(e) => setQValue(e.target.value)}
            />
            <button id="submitQ" className="btn compact" title="搜索" onClick={submitSearch}>
              搜索
            </button>
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
          <button
            id="refreshPageEntry"
            className="iconBtn"
            title="刷新页面"
            onClick={() => window.location.reload()}
            aria-label="刷新页面"
          >
            ⟳
          </button>
          <button
            id="toggleTopbarCollapsedMini"
            className="iconBtn mobileOnly"
            title={collapsed ? '展开工具栏' : '收起工具栏'}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? '▾' : '▴'}
          </button>
        </div>

        <div className="topbarMainControls">
          <div className="primaryRow">
            <div className="primaryActions">
              <button
                id="toggleFilterPanel"
                className={`btn ghost compact ${filterPanelOpen ? 'active' : ''}`}
                title="筛选条件"
                onClick={() => setFilterPanelOpen((prev) => !prev)}
              >
                筛选
                {activeFilterCount > 0 && <span className="countBadge">{activeFilterCount}</span>}
              </button>
              <div className="quickSelect">
                <select
                  id="sortSelect"
                  title="排序方式"
                  value={sortMode}
                  onChange={(e) => onSortModeChange(e.target.value as 'publish' | 'ingest')}
                >
                  <option value="publish">最新发布</option>
                  <option value="ingest">最近加入</option>
                </select>
              </div>
              <button
                id="selection"
                className={`btn ghost compact ${selectionMode ? 'active' : ''}`}
                title={selectionMode ? `已选择 ${selectedCount} 项` : '多选操作'}
                onClick={onToggleSelectionMode}
              >
                {selectionMode ? `多选 (${selectedCount})` : '多选'}
              </button>
              <button
                id="toggleToolsPanel"
                className={`btn ghost compact ${toolsPanelOpen ? 'active' : ''}`}
                title="更多工具"
                onClick={() => setToolsPanelOpen((prev) => !prev)}
              >
                更多
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="controls">
        <div className="typeRow topbarTabs">
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
        </div>

        <div className="topbarPanels">
          <div className={`panel filterPanel ${filterPanelOpen ? 'open' : ''}`}>
            <div className="panelHeader">
              <div className="panelTitle">筛选条件</div>
              <div className="panelHeaderActions">
                {activeFilterCount > 0 && <div className="panelCount">已启用 {activeFilterCount} 项</div>}
                <button className="iconBtn" title="收起筛选" onClick={() => setFilterPanelOpen(false)}>
                  ×
                </button>
              </div>
            </div>
            <div className="panelBody">
              <div className="panelGrid">
                <div className="panelItem">
                  <label className="panelLabel" htmlFor="tag">
                    话题标签
                  </label>
                  <div className="search compactSearch" style={{ position: 'relative' }}>
                    <input
                      id="tag"
                      type="search"
                      placeholder={activeTags.length > 0 ? `已选 ${activeTags.length} 个标签 (${tagFilterMode})` : '输入 #话题 或 标签名（可留空）'}
                      autoComplete="off"
                      value={tagValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTagValue(v);
                        onTagChange(v);
                      }}
                      disabled={activeTags.length > 0}
                      style={
                        activeTags.length > 0
                          ? {
                              backgroundColor: 'rgba(var(--accent-rgb), 0.15)',
                              cursor: 'not-allowed',
                              color: 'rgba(255,255,255,0.85)',
                            }
                          : undefined
                      }
                    />
                    <button
                      id="clearTag"
                      className="iconBtn"
                      title={activeTags.length > 0 ? '清空多标签筛选' : '清空标签'}
                      onClick={() => {
                        setTagValue('');
                        onTagChange('');
                        if (activeTags.length > 0) {
                          onTagsChange([]);
                        }
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {activeTags.length > 0 && (
                    <div className="panelHint">已选 {activeTags.length} 个标签（{tagFilterMode}）</div>
                  )}
                </div>
                <div className="panelItem">
                  <label className="panelLabel" htmlFor="dirSelect">
                    内容来源
                  </label>
                  <div className="dirPick fullWidth">
                    <select
                      id="dirSelect"
                      title="选择内容来源"
                      value={activeDirId}
                      onChange={(e) => onDirChange(e.target.value)}
                    >
                      <option value="all">全部来源</option>
                      {dirs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label || d.path || d.id}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={`panel toolsPanel ${toolsPanelOpen ? 'open' : ''}`}>
            <div className="panelHeader">
              <div className="panelTitle">工具与视图</div>
              <div className="panelHeaderActions">
                <button className="iconBtn" title="收起工具" onClick={() => setToolsPanelOpen(false)}>
                  ×
                </button>
              </div>
            </div>
            <div className="panelBody">
              <div className="panelActionsGrid">
                <button
                  id="openTagModal"
                  className="btn ghost"
                  title="打开话题标签库"
                  onClick={() => {
                    setTagSearch('');
                    setTagModalOpen(true);
                    onReloadTags?.();
                  }}
                >
                  话题标签
                </button>
                {!isMobileVariant && (
                  <button
                    id="toggleViewMode"
                    className={`btn ghost toggle ${viewMode !== 'album' ? 'active' : ''}`}
                    title={
                      viewMode === 'masonry'
                        ? '瀑布流：更多内容预览'
                        : viewMode === 'album'
                          ? '合集：按主题归类'
                          : '作者：按作者浏览'
                    }
                    onClick={() => {
                      const next = viewMode === 'masonry' ? 'album' : viewMode === 'album' ? 'publisher' : 'masonry';
                      onViewModeChange(next);
                    }}
                  >
                    {viewMode === 'masonry' ? '瀑布流' : viewMode === 'album' ? '合集' : '作者'}
                  </button>
                )}
                <button
                  id="toggleExpanded"
                  className={`btn ghost toggle ${expanded ? 'active' : ''}`}
                  title="切换卡片大小"
                  onClick={() => onExpandedChange(!expanded)}
                >
                  {expanded ? '紧凑' : '大图'}
                </button>
                <button id="refresh" className="btn" onClick={onRefresh}>
                  刷新内容
                </button>
                {!isMobileVariant && (
                  <button
                    id="fullScan"
                    className="btn ghost"
                    disabled={fullScanLoading}
                    title="同步本地内容"
                    onClick={() => {
                      Modal.confirm({
                        title: '同步本地内容？',
                        content: '将重新扫描内容来源并更新索引（可能需要一点时间）。',
                        okText: fullScanLoading ? '同步中…' : '开始同步',
                        cancelText: '取消',
                        centered: true,
                        okButtonProps: { disabled: fullScanLoading },
                        onOk: async () => {
                          try {
                            const r = await onFullScan();
                            const scanned = r?.scannedDirs ?? '-';
                            const added = r?.added ?? '-';
                            const updated = r?.updated ?? '-';
                            const deleted = r?.deleted ?? '-';

                            if (added > 0) {
                              message.success({
                                content: `✨ 同步完成：发现 ${added} 条新内容！`,
                                description: `来源: ${scanned} | 新增: ${added} | 更新: ${updated} | 删除: ${deleted}`,
                                duration: 6,
                              });
                            } else if (updated > 0) {
                              message.success({
                                content: `✅ 同步完成：更新了 ${updated} 条内容`,
                                description: `来源: ${scanned} | 新增: ${added} | 更新: ${updated} | 删除: ${deleted}`,
                                duration: 5,
                              });
                            } else if (deleted > 0) {
                              message.warning({
                                content: `🗑️ 同步完成：移除了 ${deleted} 条内容`,
                                description: `来源: ${scanned} | 新增: ${added} | 更新: ${updated} | 删除: ${deleted}`,
                                duration: 5,
                              });
                            } else {
                              message.info({
                                content: '✓ 同步完成：没有变化',
                                description: `已同步 ${scanned} 个来源，内容已是最新`,
                                duration: 4,
                              });
                            }
                          } catch (e) {
                            const errorMsg = String(e instanceof Error ? e.message : e);
                            message.error({
                              content: '❌ 同步失败',
                              description: errorMsg || '未知错误，请稍后再试',
                              duration: 8,
                            });
                            console.error('Scan error:', e);
                          }
                        },
                      });
                    }}
                  >
                    同步内容
                  </button>
                )}
                {!isMobileVariant && (
                  <button id="feed" className="btn immersivePrimary" title="进入全屏沉浸浏览" onClick={onFeedClick}>
                    🎬 沉浸看
                  </button>
                )}
                <button
                  id="openHome"
                  className="btn ghost"
                  onClick={() => navigate('/')}
                  title="返回正常资源页"
                >
                  正常资源
                </button>
                <button
                  id="openUnclassified"
                  className="btn ghost"
                  onClick={() => navigate('/unclassified')}
                  title="打开未分类资源页"
                >
                  未分类
                </button>
                <button
                  id="openSettings"
                  className="btn ghost"
                  onClick={() => navigate('/settings')}
                  title="打开设置"
                >
                  设置
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>话题标签（多选）</span>
            {activeTags.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  className="btn ghost compact"
                  onClick={() => onTagFilterModeChange(tagFilterMode === 'AND' ? 'OR' : 'AND')}
                  title={tagFilterMode === 'AND' ? '切换到 OR 模式（满足任一标签）' : '切换到 AND 模式（同时满足所有标签）'}
                  style={{ fontSize: 11, padding: '4px 8px' }}
                >
                  {tagFilterMode === 'AND' ? 'AND (且)' : 'OR (或)'}
                </button>
              </div>
            )}
          </div>
        }
        open={tagModalOpen}
        onCancel={() => setTagModalOpen(false)}
        footer={null}
        centered
        className="tagModal"
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            type="search"
            placeholder="搜索话题…"
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

        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'rgba(255,255,255,.75)' }}>
            {activeTags.length > 0 ? (
              <>已选 {activeTags.length} 个话题 ({tagFilterMode}) | 显示：{filteredTagStats.length}/{safeTagStats.length}</>
            ) : (
              <>当前筛选：{activeTag || '-'} | 显示：{filteredTagStats.length}/{safeTagStats.length}</>
            )}
          </div>
          {(activeTags.length > 0 || activeTag) && (
            <button
              className="btn ghost compact"
              onClick={() => {
                setTagValue('');
                onTagChange('');
                onTagsChange([]);
              }}
              title="清空所有标签筛选"
            >
              清空筛选
            </button>
          )}
        </div>

        {/* 已选话题显示 */}
        {activeTags.length > 0 && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(255,255,255,.05)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginBottom: 6 }}>已选话题：</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {activeTags.map((tag) => (
                <button
                  key={tag}
                  className="chip active"
                  onClick={() => {
                    const newTags = activeTags.filter(t => t !== tag);
                    onTagsChange(newTags);
                  }}
                  style={{ fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}
                  title={`点击移除：${tag}`}
                >
                  {tag} ×
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: '56vh', overflow: 'auto', paddingRight: 4 }}>
          {tagStatsLoading && (
            <div style={{ color: 'rgba(255,255,255,.75)', fontSize: 12, fontFamily: 'var(--mono)' }}>加载话题中…</div>
          )}
          {!tagStatsLoading && tagStatsError && (
            <div style={{ color: 'rgba(255, 99, 132, .92)', fontSize: 12, fontFamily: 'var(--mono)' }}>
              加载失败：{tagStatsError}
            </div>
          )}
          {!tagStatsLoading && !tagStatsError && safeTagStats.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,.75)', fontSize: 12, fontFamily: 'var(--mono)', lineHeight: 1.6 }}>
              <div>暂无话题标签。</div>
              <div style={{ opacity: 0.85 }}>可能原因：当前还没有可用的标签数据或正在同步中。</div>
              <div style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => onReloadTags?.()}>
                  重新加载
                </button>
              </div>
            </div>
          )}
          {filteredTagStats.map((t) => {
            const label = `#${t.tag}`;
            const isActiveInMulti = activeTags.includes(label) || activeTags.includes(t.tag);
            const isActiveSingle = activeTag.trim() === label || activeTag.trim() === t.tag;
            const isActive = isActiveInMulti || isActiveSingle;
            return (
              <button
                key={t.tag}
                className={`chip ${isActive ? 'active' : ''}`}
                style={isActive ? undefined : tagTintStyle(label)}
                title={`${label} | groups=${t.groupCount} items=${t.itemCount}${isActiveInMulti ? ' (已选)' : ''}`}
                onClick={() => {
                  // 多选模式：添加到 activeTags
                  if (activeTags.length > 0 || isActiveInMulti) {
                    const newTags = isActiveInMulti
                      ? activeTags.filter(tag => tag !== label && tag !== t.tag)
                      : [...activeTags, label];
                    onTagsChange(newTags);
                  } else {
                    // 单选模式：使用原有逻辑
                    setTagValue(label);
                    onTagChange(label);
                    setTagModalOpen(false);
                  }
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
});

export default Topbar;
