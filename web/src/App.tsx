import Topbar from './components/Topbar';
import MediaGrid from './components/MediaGrid';
import MediaTiles from './components/MediaTiles';
import PreviewModal from './components/PreviewModal';
import SetupCard from './components/SetupCard';
import PublisherView from './components/PublisherView';
import MobileDock from './components/MobileDock';
import ScanConfirmSheet from './components/ScanConfirmSheet';
import ScanProgressModal from './components/ScanProgressModal';
import BatchActionBar from './components/BatchActionBar';
import { useAppState } from './hooks/useAppState';
import { useMobileLayout } from './hooks/useMobileLayout';
import { useSelection } from './hooks/useSelection';
import { usePreviewModal } from './hooks/usePreviewModal';
import { useScan } from './hooks/useScan';
import type { MediaGridItem, MediaGridSection } from './components/MediaGrid';
import type { TileItem } from './components/MediaTiles';

function App() {
  // 主状态管理
  const {
    state,
    setState,
    loadResources,
    loadAuthorsMeta,
    reloadTags,
    refreshWithOverrides,
    handleSaveMediaDirs,
    handleLoadMore,
    handleViewModeChange,
  } = useAppState();

  // 移动端布局检测
  const { isMobile, mobileDockHidden } = useMobileLayout();

  // 扫描相关逻辑
  const {
    fullScanLoading,
    scanProgress,
    scanSheetOpen,
    notifyScanLocked,
    handleFullScan,
    handleScanClick,
    handleScanConfirm,
    setScanSheetOpen,
  } = useScan({
    viewMode: state.viewMode,
    onReloadTags: reloadTags,
    onLoadAuthorsMeta: loadAuthorsMeta,
    onLoadResources: loadResources,
  });

  // 批量选择逻辑
  const {
    selectionMode,
    selectedItems,
    toggleSelectionMode,
    toggleItemSelection,
    selectAll,
    clearSelection,
    handleBatchDelete,
    handleBatchDownload,
  } = useSelection({
    groups: state.groups,
    onRefresh: () => loadResources({ reset: true }),
  });

  // 预览模态框逻辑
  const {
    modal,
    feedMode,
    handleOpenModal,
    handleCloseModal,
    handleModalStep,
    handleModalSetItemIdx,
    handleGroupStep,
    handleOpenImmersive,
    handleFeedModeChange,
    handleFeedClick,
  } = usePreviewModal({
    groups: state.groups,
    isMobile,
    selectionMode,
    q: state.q,
    activeType: state.activeType,
    activeDirId: state.activeDirId,
    activeTag: state.activeTag,
    sortMode: state.sortMode,
    onToggleItemSelection: toggleItemSelection,
    notifyScanLocked,
  });

  // 计算派生数据
  const visibleCount = state.viewMode === 'publisher' ? 0 : Math.min(state.renderLimit, state.groups.length);
  const visibleItems: MediaGridItem[] =
    state.viewMode === 'publisher'
      ? []
      : state.groups.slice(0, visibleCount).map((group, groupIdx) => ({ group, groupIdx }));

  const sections: MediaGridSection[] =
    state.viewMode === 'album' ? [{ key: 'all', title: '', items: visibleItems }] : [];

  const tileItems: TileItem[] = (() => {
    if (state.viewMode !== 'masonry') return [];
    const list: TileItem[] = [];
    for (const { group, groupIdx } of visibleItems) {
      const items = Array.isArray(group.items) ? group.items : [];
      for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
        const item = items[itemIdx];
        if (!item) continue;
        list.push({ groupIdx, itemIdx, group, item });
      }
    }
    return list;
  })();

  // 处理视图模式切换（需要扫描锁定检查和关闭模态框）
  const handleViewModeChangeWithLock = (mode: 'masonry' | 'album' | 'publisher') => {
    if (notifyScanLocked('扫描进行中，暂不可切换视图')) return;
    // 切换视图模式时关闭模态框
    if (modal.open) {
      handleCloseModal();
    }
    handleViewModeChange(mode);
  };

  return (
    <>
      <div className="bg"></div>
      <Topbar
        q={state.q}
        activeType={state.activeType}
        activeDirId={state.activeDirId}
        activeTag={state.activeTag}
        activeTags={state.activeTags}
        tagFilterMode={state.tagFilterMode}
        tagStats={state.tagStats}
        tagStatsLoading={state.tagStatsLoading}
        tagStatsError={state.tagStatsError}
        onReloadTags={reloadTags}
        dirs={state.dirs}
        expanded={state.expanded}
        collapsed={state.topbarCollapsed}
        viewMode={state.viewMode}
        sortMode={state.sortMode}
        mobileVariant={isMobile}
        onQChange={(q) => refreshWithOverrides({ q })}
        onTypeChange={(type) => refreshWithOverrides({ activeType: type })}
        onDirChange={(dirId) => refreshWithOverrides({ activeDirId: dirId })}
        onTagChange={(tag) => refreshWithOverrides({ activeTag: tag })}
        onTagsChange={(tags) => {
          setState((prev) => ({ ...prev, activeTags: tags }));
          if (state.viewMode !== 'publisher') {
            loadResources({ reset: true });
          }
        }}
        onTagFilterModeChange={(mode) => {
          setState((prev) => ({ ...prev, tagFilterMode: mode }));
          if (state.viewMode !== 'publisher' && state.activeTags.length > 0) {
            loadResources({ reset: true });
          }
        }}
        onFeedClick={handleFeedClick}
        onRefresh={() => {
          if (state.viewMode === 'publisher') return loadAuthorsMeta();
          return loadResources({ reset: true });
        }}
        onFullScan={handleFullScan}
        fullScanLoading={fullScanLoading}
        selectionMode={selectionMode}
        selectedCount={selectedItems.size}
        onToggleSelectionMode={toggleSelectionMode}
        onExpandedChange={(expanded) => {
          try {
            localStorage.setItem('ui_expanded', expanded ? '1' : '0');
          } catch {}
          setState((prev) => ({ ...prev, expanded }));
        }}
        onCollapsedChange={(collapsed) => {
          try {
            localStorage.setItem('ui_topbar_collapsed', collapsed ? '1' : '0');
          } catch {}
          setState((prev) => ({ ...prev, topbarCollapsed: collapsed }));
        }}
        onViewModeChange={handleViewModeChangeWithLock}
        onSortModeChange={(mode) => {
          try {
            localStorage.setItem('ui_sort_mode', mode);
          } catch {}
          refreshWithOverrides({ sortMode: mode });
        }}
      />
      <main className={`container ${state.expanded ? 'expanded' : ''}`}>
        {(state.viewMode !== 'publisher' || state.loading || state.error || state.setup.needed) && (
          <div className="metaRow">
            <div className="meta">
              {state.loading
                ? '加载中…'
                : state.error
                  ? `加载失败：${state.error}`
                  : state.setup.needed
                    ? '未检测到 media 目录：请先配置资源目录（绝对路径）'
                    : (() => {
                        const displayed = visibleCount;
                        const totalGroups = state.pagination.total || state.groups.length;
                        const loadedItems = state.groups.reduce((acc, g) => acc + (g.items?.length || 0), 0);
                        const totalItems = state.pagination.totalItems || loadedItems;
                        return `groups: ${displayed}/${totalGroups}  |  items: ${Math.min(
                          loadedItems,
                          totalItems
                        )}/${totalItems}  |  filter: ${state.activeType}  |  tag: ${state.activeTag || '-'}  |  q: ${
                          state.q || '-'
                        }`;
                      })()}
            </div>
          </div>
        )}

        {state.setup.needed ? (
          <SetupCard setup={state.setup} onSave={handleSaveMediaDirs} />
        ) : state.viewMode === 'publisher' ? (
          <PublisherView
            q={state.q}
            activeType={state.activeType}
            activeDirId={state.activeDirId}
            activeTag={state.activeTag}
            sortMode={state.sortMode}
            expanded={state.expanded}
          />
        ) : state.viewMode === 'masonry' ? (
          <MediaTiles
            items={tileItems}
            expanded={state.expanded}
            hasMore={state.pagination.hasMore || state.renderLimit < state.groups.length}
            totalGroups={state.pagination.total || state.groups.length}
            loading={state.loading}
            loadingMore={state.loadingMore}
            onLoadMore={handleLoadMore}
            onOpen={(groupIdx, itemIdx) => handleOpenModal(groupIdx, itemIdx, false)}
            onImmersiveOpen={handleOpenImmersive}
            selectionMode={selectionMode}
            selectedItems={selectedItems}
          />
        ) : (
          <MediaGrid
            sections={sections}
            expanded={state.expanded}
            hasMore={state.pagination.hasMore || state.renderLimit < state.groups.length}
            totalGroups={state.pagination.total || state.groups.length}
            loading={state.loading}
            loadingMore={state.loadingMore}
            onLoadMore={handleLoadMore}
            onThumbClick={(groupIdx, itemIdx) => handleOpenModal(groupIdx, itemIdx, false)}
            onImmersiveOpen={handleOpenImmersive}
            onTagClick={(tag) => refreshWithOverrides({ activeTag: tag })}
            selectionMode={selectionMode}
            selectedItems={selectedItems}
          />
        )}
      </main>

      {modal.open && (
        <PreviewModal
          groups={state.groups}
          groupIdx={modal.groupIdx}
          itemIdx={modal.itemIdx}
          feedMode={feedMode}
          onClose={handleCloseModal}
          onStep={handleModalStep}
          onSetItemIdx={handleModalSetItemIdx}
          onGroupStep={handleGroupStep}
          onFeedModeChange={handleFeedModeChange}
          onReload={() => loadResources({ reset: true })}
        />
      )}

      {isMobile && !selectionMode && (
        <MobileDock
          viewMode={state.viewMode}
          onViewModeChange={handleViewModeChangeWithLock}
          onImmersive={handleFeedClick}
          onScanClick={handleScanClick}
          scanDisabled={fullScanLoading}
          immersiveDisabled={fullScanLoading}
          hidden={mobileDockHidden || scanSheetOpen}
        />
      )}

      <ScanConfirmSheet
        open={scanSheetOpen}
        onCancel={() => setScanSheetOpen(false)}
        onConfirm={handleScanConfirm}
        loading={fullScanLoading}
      />

      <ScanProgressModal loading={fullScanLoading} progress={scanProgress} />

      {selectionMode && (
        <BatchActionBar
          selectedCount={selectedItems.size}
          onSelectAll={selectAll}
          onClear={clearSelection}
          onDownload={handleBatchDownload}
          onDelete={handleBatchDelete}
          onCancel={toggleSelectionMode}
        />
      )}
    </>
  );
}

export default App;
