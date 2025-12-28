import { useState, useEffect, useCallback } from 'react';
import Topbar from './components/Topbar';
import MediaGrid from './components/MediaGrid';
import PreviewModal from './components/PreviewModal';
import SetupCard from './components/SetupCard';
import { fetchResources, fetchConfig, saveConfigMediaDirs, type MediaGroup, type MediaDir } from './api';

const GROUP_BATCH = 30;

interface AppState {
  groups: MediaGroup[];
  filtered: MediaGroup[];
  activeType: string;
  activeDirId: string;
  q: string;
  renderLimit: number;
  modal: {
    open: boolean;
    groupIdx: number;
    itemIdx: number;
  };
  feedMode: boolean;
  setup: {
    needed: boolean;
    mediaDirs: string[];
    defaultMediaDirs: string[];
    fromEnv: boolean;
  };
  dirs: MediaDir[];
  loading: boolean;
  error: string | null;
}

function App() {
  const [state, setState] = useState<AppState>({
    groups: [],
    filtered: [],
    activeType: '全部',
    activeDirId: 'all',
    q: '',
    renderLimit: GROUP_BATCH,
    modal: { open: false, groupIdx: 0, itemIdx: 0 },
    feedMode: false,
    setup: {
      needed: false,
      mediaDirs: [],
      defaultMediaDirs: [],
      fromEnv: false,
    },
    dirs: [],
    loading: true,
    error: null,
  });

  const loadResources = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const j = await fetchResources();
      if (!j.ok) {
        if (j.code === 'NO_MEDIA_DIR') {
          const setup = {
            needed: true,
            mediaDirs: j.mediaDirs || [],
            defaultMediaDirs: j.defaultMediaDirs || [],
            fromEnv: false,
          };
          try {
            const cfg = await fetchConfig();
            if (cfg.ok) setup.fromEnv = Boolean(cfg.fromEnv);
          } catch {
            // ignore
          }
          setState((prev) => ({
            ...prev,
            setup,
            groups: [],
            filtered: [],
            loading: false,
          }));
          return;
        }
        throw new Error(j.error || 'API error');
      }
      setState((prev) => ({
        ...prev,
        setup: { ...prev.setup, needed: false },
        dirs: j.dirs || [],
        groups: j.groups || [],
        filtered: j.groups || [],
        loading: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: String(err instanceof Error ? err.message : err),
      }));
    }
  }, []);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  const applyFilters = useCallback(() => {
    setState((prev) => {
      const q = prev.q.trim();
      let arr = prev.groups.slice();

      if (prev.activeType && prev.activeType !== '全部') {
        arr = arr.filter(
          (g) =>
            (g.groupType || '') === prev.activeType ||
            (g.types || []).includes(prev.activeType)
        );
      }
      if (q) {
        arr = arr.filter((g) => {
          const hay = `${g.author} ${g.theme} ${g.groupType} ${(g.types || []).join(' ')} ${g.timeText}`.toLowerCase();
          return hay.includes(q.toLowerCase());
        });
      }

      const dirId = prev.activeDirId || 'all';
      if (dirId !== 'all') {
        arr = arr
          .map((g) => {
            const items = (g.items || []).filter((it) => it.dirId === dirId);
            return { ...g, items };
          })
          .filter((g) => (g.items || []).length > 0);
      }

      return { ...prev, filtered: arr, renderLimit: Math.min(GROUP_BATCH, arr.length || 0) };
    });
  }, []);

  useEffect(() => {
    applyFilters();
  }, [state.groups, state.activeType, state.activeDirId, state.q, applyFilters]);

  const handleSaveMediaDirs = async (mediaDirs: string[]) => {
    try {
      const j = await saveConfigMediaDirs(mediaDirs);
      if (!j.ok) throw new Error(j.error || '保存失败');
      localStorage.setItem('mediaDirs', mediaDirs.join('\n'));
      await loadResources();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: String(err instanceof Error ? err.message : err),
      }));
    }
  };

  const handleLoadMore = () => {
    setState((prev) => {
      const max = prev.filtered.length;
      if (prev.renderLimit >= max) return prev;
      return { ...prev, renderLimit: Math.min(prev.renderLimit + GROUP_BATCH, max) };
    });
  };

  const handleOpenModal = (groupIdx: number, itemIdx: number, feedMode = false) => {
    setState((prev) => ({
      ...prev,
      modal: { open: true, groupIdx, itemIdx },
      feedMode,
    }));
  };

  const handleCloseModal = () => {
    setState((prev) => ({
      ...prev,
      modal: { ...prev.modal, open: false },
      feedMode: false,
    }));
  };

  const handleModalStep = (delta: number) => {
    setState((prev) => {
      if (!prev.modal.open) return prev;
      const group = prev.filtered[prev.modal.groupIdx];
      if (!group) return prev;
      const items = group.items || [];
      const newIdx = Math.max(0, Math.min(prev.modal.itemIdx + delta, items.length - 1));
      return { ...prev, modal: { ...prev.modal, itemIdx: newIdx } };
    });
  };

  const handleGroupStep = (delta: number) => {
    setState((prev) => {
      if (!prev.modal.open || !prev.feedMode) return prev;
      const next = Math.max(0, Math.min(prev.modal.groupIdx + delta, prev.filtered.length - 1));
      if (next === prev.modal.groupIdx) return prev;
      const g = prev.filtered[next];
      const items = g?.items || [];
      const firstVideoIdx = items.findIndex((it) => it.kind === 'video');
      return {
        ...prev,
        modal: { groupIdx: next, itemIdx: firstVideoIdx >= 0 ? firstVideoIdx : 0, open: true },
      };
    });
  };

  return (
    <>
      <div className="bg"></div>
      <Topbar
        q={state.q}
        activeType={state.activeType}
        activeDirId={state.activeDirId}
        dirs={state.dirs}
        onQChange={(q) => setState((prev) => ({ ...prev, q }))}
        onTypeChange={(type) => setState((prev) => ({ ...prev, activeType: type }))}
        onDirChange={(dirId) => setState((prev) => ({ ...prev, activeDirId: dirId }))}
        onFeedClick={() => {
          if (state.filtered.length) handleOpenModal(0, 0, true);
        }}
        onRefresh={loadResources}
      />
      <main className="container">
        <div className="metaRow">
          <div className="meta">
            {state.loading
              ? '加载中…'
              : state.error
                ? `加载失败：${state.error}`
                : state.setup.needed
                  ? '未检测到 media 目录：请先配置资源目录（绝对路径）'
                  : `groups: ${Math.min(state.renderLimit, state.filtered.length)}/${state.filtered.length} (all ${state.groups.length})  |  items: ${state.filtered.reduce((acc, g) => acc + (g.items?.length || 0), 0)}/${state.groups.reduce((acc, g) => acc + (g.items?.length || 0), 0)}  |  filter: ${state.activeType}  |  q: ${state.q || '-'}`}
          </div>
        </div>

        {state.setup.needed ? (
          <SetupCard
            setup={state.setup}
            onSave={handleSaveMediaDirs}
          />
        ) : (
          <MediaGrid
            groups={state.filtered.slice(0, state.renderLimit)}
            hasMore={state.renderLimit < state.filtered.length}
            totalGroups={state.filtered.length}
            onLoadMore={handleLoadMore}
            onThumbClick={(groupIdx, itemIdx) => handleOpenModal(groupIdx, itemIdx, false)}
          />
        )}
      </main>

      {state.modal.open && (
        <PreviewModal
          groups={state.filtered}
          groupIdx={state.modal.groupIdx}
          itemIdx={state.modal.itemIdx}
          feedMode={state.feedMode}
          onClose={handleCloseModal}
          onStep={handleModalStep}
          onGroupStep={handleGroupStep}
        />
      )}
    </>
  );
}

export default App;
