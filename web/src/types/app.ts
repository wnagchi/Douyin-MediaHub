import type { PaginationInfo, MediaGroup, MediaDir, TagStat } from '../api';

export interface PaginationState extends PaginationInfo {
  totalItems: number;
}

export interface AppState {
  groups: MediaGroup[];
  activeType: string;
  activeDirId: string;
  q: string;
  activeTag: string;
  activeTags: string[]; // 多选标签
  tagFilterMode: 'AND' | 'OR'; // 标签筛选逻辑
  tagStats: TagStat[];
  tagStatsLoading: boolean;
  tagStatsError: string | null;
  renderLimit: number;
  expanded: boolean;
  topbarCollapsed: boolean;
  viewMode: 'masonry' | 'album' | 'publisher';
  sortMode: 'publish' | 'ingest';
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
  loadingMore: boolean;
  error: string | null;
  pagination: PaginationState;
  // 批量操作相关
  selectionMode: boolean;
  selectedItems: Set<string>; // 格式: "dirId|filename"
  // 收藏相关
  favorites: Set<string>; // 格式: "dirId|filename"
}
