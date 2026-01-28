import React from 'react';
import { Modal, message } from 'antd';
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

export default function Topbar({
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
  const [qValue, setQValue] = React.useState(q);
  const qTimerRef = React.useRef<number>();
  const onQChangeRef = React.useRef(onQChange);

  const [tagValue, setTagValue] = React.useState(activeTag);
  const [tagModalOpen, setTagModalOpen] = React.useState(false);
  const [tagSearch, setTagSearch] = React.useState('');

  // 搜索历史记录
  const [searchHistory, setSearchHistory] = React.useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('search_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showSearchSuggestions, setShowSearchSuggestions] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

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
      const trimmed = qValue.trim();
      if (!trimmed) return;
      setSearchHistory((prev) => {
        const next = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 10);
        if (prev.length === next.length && prev.every((v, i) => v === next[i])) {
          return prev;
        }
        return next;
      });
    }, 160);
    return () => {
      if (qTimerRef.current) clearTimeout(qTimerRef.current);
    };
  }, [qValue]);

  React.useEffect(() => {
    try {
      localStorage.setItem('search_history', JSON.stringify(searchHistory));
    } catch {}
  }, [searchHistory]);

  // 点击外部关闭搜索建议
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchInputRef.current && !searchInputRef.current.contains(e.target as Node)) {
        setShowSearchSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 搜索建议列表（历史记录 + 作者建议）
  const searchSuggestions = React.useMemo(() => {
    const suggestions: Array<{ type: 'history' | 'author' | 'tag'; value: string; label: string }> = [];

    // 添加历史记录
    searchHistory.forEach(h => {
      if (h.toLowerCase().includes(qValue.toLowerCase()) || !qValue) {
        suggestions.push({ type: 'history', value: h, label: h });
      }
    });

    // 添加作者建议（从当前目录列表推断）
    // 这里简化处理，实际可以从 API 获取作者列表

    return suggestions.slice(0, 8);
  }, [qValue, searchHistory]);

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
        <div className="search" style={{ position: 'relative' }}>
          <input
            ref={searchInputRef}
            id="q"
            type="search"
            placeholder={viewMode === 'publisher' ? '搜索发布者（仅匹配发布者名）…' : '搜索：发布人 / 主题 / 类型...'}
            autoComplete="off"
            value={qValue}
            onChange={(e) => setQValue(e.target.value)}
            onFocus={() => setShowSearchSuggestions(true)}
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

          {/* 搜索建议下拉框 - 手机端优化 */}
          {showSearchSuggestions && searchSuggestions.length > 0 && (
            <div className="searchSuggestions">
              {searchSuggestions.map((suggestion, idx) => (
                <button
                  key={`${suggestion.type}-${idx}`}
                  className="searchSuggestionItem"
                  onClick={() => {
                    setQValue(suggestion.value);
                    onQChange(suggestion.value);
                    setShowSearchSuggestions(false);
                  }}
                >
                  <span className="searchSuggestionIcon">
                    {suggestion.type === 'history' && '🕐'}
                    {suggestion.type === 'author' && '👤'}
                    {suggestion.type === 'tag' && '#'}
                  </span>
                  <span className="searchSuggestionLabel">{suggestion.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="search" style={{ position: 'relative' }}>
          <input
            id="tag"
            type="search"
            placeholder={activeTags.length > 0 ? `已选 ${activeTags.length} 个标签 (${tagFilterMode})` : "标签筛选：输入 #自拍 或 自拍（可清空）"}
            autoComplete="off"
            value={tagValue}
            onChange={(e) => {
              const v = e.target.value;
              setTagValue(v);
              onTagChange(v);
            }}
            disabled={activeTags.length > 0}
            style={activeTags.length > 0 ? {
              backgroundColor: 'rgba(var(--accent-rgb), 0.15)',
              cursor: 'not-allowed',
              color: 'rgba(255,255,255,0.85)'
            } : undefined}
          />
          <button
            id="clearTag"
            className="iconBtn"
            title={activeTags.length > 0 ? "清空多标签筛选" : "清空标签"}
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
          {!isMobileVariant && (
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
          )}

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
          <button
            id="selection"
            className={`btn ${selectionMode ? 'active' : 'ghost'}`}
            title={selectionMode ? `已选择 ${selectedCount} 项` : '批量操作'}
            onClick={onToggleSelectionMode}
          >
            {selectionMode ? `选择 (${selectedCount})` : '批量'}
          </button>
          {!isMobileVariant && (
            <button
              id="fullScan"
              className="btn ghost"
              disabled={fullScanLoading}
              title="全量扫描（强制更新索引）：POST /api/reindex?force=1"
              onClick={() => {
                Modal.confirm({
                  title: '确认执行全量扫描？',
                  content: '这会强制扫描所有资源目录并更新索引（可能耗时较长）。',
                  okText: fullScanLoading ? '扫描中…' : '开始扫描',
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

                      // 如果有新增内容，特别提示
                      if (added > 0) {
                        message.success({
                          content: `✨ 扫描完成：发现 ${added} 个新增文件！`,
                          description: `目录: ${scanned} | 新增: ${added} | 更新: ${updated} | 删除: ${deleted}`,
                          duration: 6,
                        });
                      } else if (updated > 0) {
                        message.success({
                          content: `✅ 扫描完成：更新了 ${updated} 个文件`,
                          description: `目录: ${scanned} | 新增: ${added} | 更新: ${updated} | 删除: ${deleted}`,
                          duration: 5,
                        });
                      } else if (deleted > 0) {
                        message.warning({
                          content: `🗑️ 扫描完成：删除了 ${deleted} 个文件`,
                          description: `目录: ${scanned} | 新增: ${added} | 更新: ${updated} | 删除: ${deleted}`,
                          duration: 5,
                        });
                      } else {
                        message.info({
                          content: '✓ 扫描完成：没有变化',
                          description: `已扫描 ${scanned} 个目录，所有文件都是最新的`,
                          duration: 4,
                        });
                      }
                    } catch (e) {
                      const errorMsg = String(e instanceof Error ? e.message : e);
                      message.error({
                        content: '❌ 扫描失败',
                        description: errorMsg || '未知错误，请检查网络连接或服务器状态',
                        duration: 8,
                      });
                      console.error('Scan error:', e);
                    }
                  },
                });
              }}
            >
              扫描
            </button>
          )}
          {!isMobileVariant && (
            <button id="feed" className="btn immersivePrimary" title="进入沉浸模式（横滑切换内容，竖滑切换合集）" onClick={onFeedClick}>
              🎬 沉浸
            </button>
          )}
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
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>标签库（多选筛选）</span>
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

        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'rgba(255,255,255,.75)' }}>
            {activeTags.length > 0 ? (
              <>已选 {activeTags.length} 个标签 ({tagFilterMode}) | 显示：{filteredTagStats.length}/{safeTagStats.length}</>
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

        {/* 已选标签显示 */}
        {activeTags.length > 0 && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(255,255,255,.05)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginBottom: 6 }}>已选标签：</div>
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
}
