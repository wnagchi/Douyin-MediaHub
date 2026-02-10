import { useState, useCallback } from 'react';
import { deleteMediaItems } from '../api';
import type { MediaGroup } from '../api';

interface UseSelectionOptions {
  groups: MediaGroup[];
  onRefresh: () => Promise<void>;
}

export function useSelection({ groups, onRefresh }: UseSelectionOptions) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => !prev);
    setSelectedItems(new Set()); // 切换模式时清空选择
  }, []);

  const toggleItemSelection = useCallback((dirId: string, filename: string) => {
    const key = `${dirId}|${filename}`;
    setSelectedItems((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(key)) {
        newSelected.delete(key);
      } else {
        newSelected.add(key);
      }
      return newSelected;
    });
  }, []);

  const selectAll = useCallback(() => {
    const allItems = new Set<string>();
    groups.forEach((group) => {
      group.items?.forEach((item) => {
        if (item.dirId && item.filename) {
          allItems.add(`${item.dirId}|${item.filename}`);
        }
      });
    });
    setSelectedItems(allItems);
  }, [groups]);

  const clearSelection = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  const handleBatchDelete = useCallback(async () => {
    if (selectedItems.size === 0) return;

    const items = Array.from(selectedItems).map((key) => {
      const [dirId, filename] = key.split('|');
      return { dirId, filename };
    });

    try {
      const result = await deleteMediaItems(items);
      if (!result.ok) {
        throw new Error(result.error || '删除失败');
      }

      // 刷新列表
      await onRefresh();

      // 退出选择模式
      setSelectionMode(false);
      setSelectedItems(new Set());

      return result;
    } catch (error) {
      throw error;
    }
  }, [selectedItems, onRefresh]);

  const handleBatchDownload = useCallback(async () => {
    if (selectedItems.size === 0) return;

    const items = Array.from(selectedItems).map((key) => {
      const [dirId, filename] = key.split('|');
      return { dirId, filename };
    });

    try {
      const r = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!r.ok) {
        let errorMsg = `下载失败（${r.status}）`;
        try {
          const j = await r.json();
          if (j?.error) errorMsg = j.error;
        } catch {}
        throw new Error(errorMsg);
      }

      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const disposition = r.headers.get('Content-Disposition') || r.headers.get('content-disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] || `media-${Date.now()}.zip`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      alert(`下载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [selectedItems]);

  return {
    selectionMode,
    selectedItems,
    toggleSelectionMode,
    toggleItemSelection,
    selectAll,
    clearSelection,
    handleBatchDelete,
    handleBatchDownload,
  };
}
