import { useState, useCallback } from 'react';
import type { MediaGroup } from '../api';
import { getPreferredItemIndex } from '../utils/media';

export interface ModalState {
  open: boolean;
  groupIdx: number; // 全局索引
  itemIdx: number;
}

export function useModalNavigation(groups: MediaGroup[], windowStart: number) {
  const [modalState, setModalState] = useState<ModalState>({
    open: false,
    groupIdx: 0,
    itemIdx: 0,
  });
  const [feedMode, setFeedMode] = useState(false);

  const openModal = useCallback(
    (groupIdx: number, itemIdx: number, isFeedMode = false) => {
      // groupIdx 是窗口内的相对索引，需要转换为全局索引
      const globalGroupIdx = windowStart + groupIdx;
      const group = groups[groupIdx];
      setModalState({
        open: true,
        groupIdx: globalGroupIdx,
        itemIdx: isFeedMode ? getPreferredItemIndex(group) : itemIdx,
      });
      setFeedMode(isFeedMode);
    },
    [groups, windowStart]
  );

  const closeModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, open: false }));
    setFeedMode(false);
  }, []);

  const stepItem = useCallback(
    (delta: number) => {
      setModalState((prev) => {
        if (!prev.open) return prev;
        // modal.groupIdx 是全局索引，需要转换为窗口内的相对索引
        const localGroupIdx = prev.groupIdx - windowStart;
        const group = groups[localGroupIdx];
        if (!group) return prev;
        const items = group.items || [];
        const newIdx = Math.max(0, Math.min(prev.itemIdx + delta, items.length - 1));
        return { ...prev, itemIdx: newIdx };
      });
    },
    [groups, windowStart]
  );

  const stepGroup = useCallback(
    (delta: number) => {
      setModalState((prev) => {
        if (!prev.open || !feedMode) return prev;
        // modal.groupIdx 是全局索引，计算下一个全局索引
        const nextGlobalIdx = prev.groupIdx + delta;
        const nextLocalIdx = nextGlobalIdx - windowStart;

        // 如果下一个 group 不在当前窗口内，需要加载更多或回退
        if (nextLocalIdx < 0 || nextLocalIdx >= groups.length) {
          // 超出窗口范围，暂时不允许跳转（或触发加载）
          return prev;
        }

        const g = groups[nextLocalIdx];
        if (!g) return prev;
        const firstVideoIdx = getPreferredItemIndex(g);
        return {
          ...prev,
          groupIdx: nextGlobalIdx,
          itemIdx: firstVideoIdx >= 0 ? firstVideoIdx : 0,
        };
      });
    },
    [groups, windowStart, feedMode]
  );

  return {
    modalState,
    feedMode,
    openModal,
    closeModal,
    stepItem,
    stepGroup,
    setFeedMode,
  };
}
