import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPreferredItemIndex } from '../utils/media';
import type { MediaGroup } from '../api';

interface ModalState {
  open: boolean;
  groupIdx: number;
  itemIdx: number;
}

interface UsePreviewModalOptions {
  groups: MediaGroup[];
  isMobile: boolean;
  selectionMode: boolean;
  q: string;
  activeType: string;
  activeDirId: string;
  activeTag: string;
  sortMode: 'publish' | 'ingest';
  onToggleItemSelection?: (dirId: string, filename: string) => void;
  notifyScanLocked?: (msg: string) => boolean;
}

export function usePreviewModal({
  groups,
  isMobile,
  selectionMode,
  q,
  activeType,
  activeDirId,
  activeTag,
  sortMode,
  onToggleItemSelection,
  notifyScanLocked,
}: UsePreviewModalOptions) {
  const navigate = useNavigate();
  const [modal, setModal] = useState<ModalState>({ open: false, groupIdx: 0, itemIdx: 0 });
  const [feedMode, setFeedMode] = useState(false);

  const handleOpenModal = useCallback(
    (groupIdx: number, itemIdx: number, feedModeParam = false) => {
      // 选择模式下点击切换选择状态
      if (selectionMode && onToggleItemSelection) {
        const group = groups[groupIdx];
        const item = group?.items?.[itemIdx];
        if (item?.dirId && item.filename) {
          onToggleItemSelection(item.dirId, item.filename);
        }
        return;
      }

      if (isMobile) {
        handleOpenImmersive(groupIdx, itemIdx);
        return;
      }

      const group = groups[groupIdx];
      setModal({
        open: true,
        groupIdx,
        itemIdx: feedModeParam ? getPreferredItemIndex(group) : itemIdx,
      });
      setFeedMode(feedModeParam);
    },
    [groups, isMobile, selectionMode, onToggleItemSelection]
  );

  const handleOpenImmersive = useCallback(
    (groupIdx: number, itemIdx: number) => {
      if (notifyScanLocked && notifyScanLocked('扫描进行中，暂不可进入沉浸模式')) return;
      if (selectionMode) return;
      const group = groups[groupIdx];
      if (!group) return;
      const items = group.items || [];
      let targetIdx = itemIdx;
      if (targetIdx < 0 || targetIdx >= items.length) {
        const preferred = getPreferredItemIndex(group);
        targetIdx = preferred >= 0 ? preferred : 0;
      }
      const item = items[targetIdx];
      if (!item?.dirId || !item.filename) return;
      const qs = new URLSearchParams();
      qs.set('fid', item.dirId);
      qs.set('fn', item.filename);
      qs.set('g', String(groupIdx));
      qs.set('i', String(targetIdx));
      if (q.trim()) qs.set('q', q.trim());
      if (activeType && activeType !== '全部') qs.set('type', activeType);
      if (activeDirId && activeDirId !== 'all') qs.set('dirId', activeDirId);
      if (activeTag && activeTag.trim()) qs.set('tag', activeTag.trim());
      if (sortMode) qs.set('sort', sortMode);
      navigate({ pathname: '/feed', search: `?${qs.toString()}` });
    },
    [navigate, notifyScanLocked, selectionMode, groups, q, activeType, activeDirId, activeTag, sortMode]
  );

  const handleCloseModal = useCallback(() => {
    setModal((prev) => ({ ...prev, open: false }));
    setFeedMode(false);
  }, []);

  const handleFeedModeChange = useCallback(
    (newFeedMode: boolean) => {
      // 预览弹层 -> 独立沉浸页（路由化）
      if (!newFeedMode) return;
      if (!modal.open) return;
      const group = groups[modal.groupIdx];
      const item = group?.items?.[modal.itemIdx];
      if (!item?.dirId || !item.filename) return;

      const qs = new URLSearchParams();
      qs.set('fid', item.dirId);
      qs.set('fn', item.filename);
      qs.set('g', String(modal.groupIdx));
      qs.set('i', String(modal.itemIdx));
      if (q.trim()) qs.set('q', q.trim());
      if (activeType && activeType !== '全部') qs.set('type', activeType);
      if (activeDirId && activeDirId !== 'all') qs.set('dirId', activeDirId);
      if (activeTag && activeTag.trim()) qs.set('tag', activeTag.trim());
      if (sortMode) qs.set('sort', sortMode);
      navigate({ pathname: '/feed', search: `?${qs.toString()}` });
    },
    [modal, groups, q, activeType, activeDirId, activeTag, sortMode, navigate]
  );

  const handleFeedClick = useCallback(() => {
    if (notifyScanLocked && notifyScanLocked('扫描进行中，暂不可进入沉浸模式')) return;
    if (!groups.length) return;
    const g0 = groups[0];
    const idx = getPreferredItemIndex(g0);
    handleOpenImmersive(0, idx >= 0 ? idx : 0);
  }, [handleOpenImmersive, notifyScanLocked, groups]);

  const handleModalStep = useCallback(
    (delta: number) => {
      setModal((prev) => {
        if (!prev.open) return prev;
        const group = groups[prev.groupIdx];
        if (!group) return prev;
        const items = group.items || [];
        const newIdx = Math.max(0, Math.min(prev.itemIdx + delta, items.length - 1));
        return { ...prev, itemIdx: newIdx };
      });
    },
    [groups]
  );

  const handleModalSetItemIdx = useCallback(
    (nextIdx: number) => {
      setModal((prev) => {
        if (!prev.open) return prev;
        const group = groups[prev.groupIdx];
        if (!group) return prev;
        const items = group.items || [];
        const clamped = Math.max(0, Math.min(nextIdx, items.length - 1));
        if (clamped === prev.itemIdx) return prev;
        return { ...prev, itemIdx: clamped };
      });
    },
    [groups]
  );

  const handleGroupStep = useCallback(
    (delta: number) => {
      setModal((prev) => {
        if (!prev.open || !feedMode) return prev;
        const next = Math.max(0, Math.min(prev.groupIdx + delta, groups.length - 1));
        if (next === prev.groupIdx) return prev;
        const g = groups[next];
        const firstVideoIdx = getPreferredItemIndex(g);
        return { groupIdx: next, itemIdx: firstVideoIdx >= 0 ? firstVideoIdx : 0, open: true };
      });
    },
    [groups, feedMode]
  );

  return {
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
  };
}
