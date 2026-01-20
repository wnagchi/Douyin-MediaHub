import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Masonry } from 'antd';
import type { AuthorStat, FetchResourcesParams, MediaGroup, PaginationInfo } from '../api';
import { fetchAuthors, fetchResources } from '../api';
import BaseImage from './BaseImage';
import MediaGrid from './MediaGrid';
import PreviewModal from './PreviewModal';
import { getPreferredItemIndex } from '../utils/media';

type PaginationState = PaginationInfo & { totalItems?: number };

function fmtAuthorLabel(author: string) {
  const a = String(author ?? '');
  return a.trim() ? a : '（未知发布者）';
}

function fmtShort(v: string, max = 16) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function useIsNarrow(breakpoint = 980) {
  const [isNarrow, setIsNarrow] = useState(() => {
    try {
      return typeof window !== 'undefined' ? window.innerWidth <= breakpoint : true;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    const onResize = () => {
      setIsNarrow(window.innerWidth <= breakpoint);
    };
    window.addEventListener('resize', onResize, { passive: true } as any);
    return () => window.removeEventListener('resize', onResize as any);
  }, [breakpoint]);
  return isNarrow;
}

export default function PublisherView({
  q,
  activeType,
  activeDirId,
  activeTag,
  sortMode,
  expanded,
}: {
  q: string;
  activeType: string;
  activeDirId: string;
  activeTag: string;
  sortMode: 'publish' | 'ingest';
  expanded: boolean;
}) {
  const isNarrow = useIsNarrow(980);
  // --- Authors sidebar ---
  const [authors, setAuthors] = useState<AuthorStat[]>([]);
  const [authorsLoading, setAuthorsLoading] = useState(false);
  const [authorsLoadingMore, setAuthorsLoadingMore] = useState(false);
  const [authorsError, setAuthorsError] = useState<string | null>(null);
  const [authorsPagination, setAuthorsPagination] = useState<PaginationState>({
    page: 0,
    pageSize: 200,
    total: 0,
    totalPages: 0,
    hasMore: false,
  });

  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null);

  const authorFilters = useMemo(() => {
    const params: Record<string, string> = {};
    // 复用 Topbar 的过滤器：dir/type/tag，会显著减少 author 维度下的数据量
    if (activeDirId && activeDirId !== 'all') params.dirId = activeDirId;
    if (activeType && activeType !== '全部') params.type = activeType;
    if (activeTag && activeTag.trim()) params.tag = activeTag.trim();
    // q 在“按发布者查看”里用于筛 author（后端只匹配 author 字段）
    if (q && q.trim()) params.q = q.trim();
    return params;
  }, [activeDirId, activeTag, activeType, q]);

  const loadAuthors = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      const nextPage = reset ? 1 : authorsPagination.page + 1;
      if (reset) {
        setAuthors([]);
        setAuthorsError(null);
        setAuthorsLoading(true);
        setAuthorsLoadingMore(false);
      } else {
        setAuthorsLoadingMore(true);
      }

      try {
        const r = await fetchAuthors({
          page: nextPage,
          pageSize: authorsPagination.pageSize || 200,
          q: authorFilters.q,
          dirId: authorFilters.dirId,
          type: authorFilters.type,
          tag: authorFilters.tag,
        });
        if (!r.ok) throw new Error(r.error || '加载发布者失败');

        setAuthors((prev) => (reset ? (r.authors || []) : [...prev, ...((r.authors || []) as AuthorStat[])]));
        setAuthorsPagination(
          r.pagination || {
            page: nextPage,
            pageSize: authorsPagination.pageSize || 200,
            total: (r.authors || []).length,
            totalPages: 1,
            hasMore: false,
          }
        );
        setAuthorsLoading(false);
        setAuthorsLoadingMore(false);
      } catch (e) {
        setAuthorsLoading(false);
        setAuthorsLoadingMore(false);
        setAuthorsError(String(e instanceof Error ? e.message : e));
      }
    },
    [authorFilters.dirId, authorFilters.q, authorFilters.tag, authorFilters.type, authorsPagination.page, authorsPagination.pageSize]
  );

  // filters change => reload authors & (if selected) reload groups
  useEffect(() => {
    loadAuthors({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorFilters]);

  // --- Right panel: groups for selected author ---
  const [groups, setGroups] = useState<MediaGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsLoadingMore, setGroupsLoadingMore] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groupsPagination, setGroupsPagination] = useState<PaginationState>({
    page: 0,
    pageSize: 30,
    total: 0,
    totalPages: 0,
    hasMore: false,
    totalItems: 0,
  });

  const loadGroups = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      if (selectedAuthor == null) return;
      const nextPage = reset ? 1 : groupsPagination.page + 1;

      if (reset) {
        setGroups([]);
        setGroupsError(null);
        setGroupsLoading(true);
        setGroupsLoadingMore(false);
      } else {
        setGroupsLoadingMore(true);
      }

      try {
        const params: FetchResourcesParams = { page: nextPage, pageSize: groupsPagination.pageSize || 30, sort: sortMode };
        if (activeDirId && activeDirId !== 'all') params.dirId = activeDirId;
        if (activeType && activeType !== '全部') params.type = activeType;
        if (activeTag && activeTag.trim()) params.tag = activeTag.trim();
        // 关键：按 author 精确过滤，不用前端扫描/分组
        params.author = selectedAuthor;

        const j = await fetchResources(params);
        if (!j.ok) throw new Error(j.error || '加载发布者内容失败');

        setGroups((prev) => (reset ? (j.groups || []) : [...prev, ...((j.groups || []) as MediaGroup[])]));
        setGroupsPagination(
          j.pagination
            ? { ...j.pagination, totalItems: j.pagination.totalItems ?? j.pagination.total }
            : {
                page: nextPage,
                pageSize: groupsPagination.pageSize || 30,
                total: (j.groups || []).length,
                totalPages: 1,
                hasMore: false,
                totalItems: (j.groups || []).reduce((acc, g) => acc + (g.items?.length || 0), 0),
              }
        );
        setGroupsLoading(false);
        setGroupsLoadingMore(false);
      } catch (e) {
        setGroupsLoading(false);
        setGroupsLoadingMore(false);
        setGroupsError(String(e instanceof Error ? e.message : e));
      }
    },
    [activeDirId, activeTag, activeType, groupsPagination.page, groupsPagination.pageSize, selectedAuthor, sortMode]
  );

  useEffect(() => {
    // author changed => reload groups
    if (selectedAuthor == null) {
      setGroups([]);
      setGroupsError(null);
      setGroupsLoading(false);
      setGroupsLoadingMore(false);
      setGroupsPagination({
        page: 0,
        pageSize: 30,
        total: 0,
        totalPages: 0,
        hasMore: false,
        totalItems: 0,
      });
      return;
    }
    loadGroups({ reset: true });
  }, [selectedAuthor, loadGroups]);

  // filters change while author selected => reload groups
  useEffect(() => {
    if (selectedAuthor == null) return;
    loadGroups({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDirId, activeType, activeTag, sortMode, authorFilters.q]);

  // --- modal preview ---
  const [modal, setModal] = useState<{ open: boolean; groupIdx: number; itemIdx: number }>({
    open: false,
    groupIdx: 0,
    itemIdx: 0,
  });

  const openModal = (groupIdx: number, itemIdx: number) => {
    setModal(() => {
      const g = groups[groupIdx];
      return {
        open: true,
        groupIdx,
        itemIdx: getPreferredItemIndex(g) >= 0 ? getPreferredItemIndex(g) : itemIdx,
      };
    });
  };

  // --- authors infinite scroll sentinel ---
  const authorSentinelRef = useRef<HTMLDivElement>(null);
  const authorObserverRef = useRef<IntersectionObserver | null>(null);
  const authorsLoadingMoreRef = useRef(false);
  const authorsHasMoreRef = useRef(false);
  const loadAuthorsRef = useRef(loadAuthors);

  useEffect(() => {
    loadAuthorsRef.current = loadAuthors;
  }, [loadAuthors]);
  useEffect(() => {
    authorsLoadingMoreRef.current = authorsLoading || authorsLoadingMore;
  }, [authorsLoading, authorsLoadingMore]);
  useEffect(() => {
    authorsHasMoreRef.current = Boolean(authorsPagination.hasMore);
  }, [authorsPagination.hasMore]);

  useEffect(() => {
    if (!authorObserverRef.current) {
      authorObserverRef.current = new IntersectionObserver(
        (entries) => {
          if (!entries[0]?.isIntersecting) return;
          if (!authorsHasMoreRef.current) return;
          if (authorsLoadingMoreRef.current) return;
          loadAuthorsRef.current({ reset: false });
        },
        { root: null, rootMargin: '600px 0px', threshold: 0.01 }
      );
    }
    return () => {
      authorObserverRef.current?.disconnect();
      authorObserverRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!authorSentinelRef.current || !authorObserverRef.current) return;
    authorObserverRef.current.observe(authorSentinelRef.current);
    return () => {
      if (authorSentinelRef.current && authorObserverRef.current) authorObserverRef.current.unobserve(authorSentinelRef.current);
    };
  }, [authors.length]);

  const authorMeta = useMemo(() => {
    const total = authorsPagination.total || authors.length;
    return `发布者：${authors.length}/${total}`;
  }, [authors.length, authorsPagination.total]);

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (activeDirId && activeDirId !== 'all') parts.push(`目录:${fmtShort(activeDirId, 12)}`);
    if (activeType && activeType !== '全部') parts.push(`类型:${activeType}`);
    if (activeTag && activeTag.trim()) parts.push(`标签:${fmtShort(activeTag.trim(), 12)}`);
    if (q && q.trim()) parts.push(`搜索:${fmtShort(q.trim(), 16)}`);
    return parts;
  }, [activeDirId, activeTag, activeType, q]);

  const groupsMeta = useMemo(() => {
    const totalGroups = groupsPagination.total || groups.length;
    const totalItems = groupsPagination.totalItems || groups.reduce((acc, g) => acc + (g.items?.length || 0), 0);
    return `groups: ${groups.length}/${totalGroups} | items: ${totalItems}`;
  }, [groups, groupsPagination.total, groupsPagination.totalItems]);

  // 窄屏交互：进入详情后只展示详情页，避免上下两个大区块造成“又长又乱”
  const showList = !isNarrow || selectedAuthor == null;
  const showDetail = !isNarrow || selectedAuthor != null;

  return (
    <div
      className="publisherLayout"
      // 某些移动端 WebView 可能对媒体查询/布局视口有差异：这里在“窄屏”时强制单列布局，避免出现“只占半屏”的情况
      style={isNarrow ? ({ flexDirection: 'column', gap: 12 } as any) : undefined}
    >
      {showList && (
        <aside
          className="publisherSidebar"
          style={isNarrow ? ({ width: '100%', flex: '0 0 auto' } as any) : undefined}
        >
        <div className="publisherSidebarHeader">
          <div className="publisherSidebarTitle">按发布者</div>
          <div className="publisherSidebarMeta">{authorMeta}</div>
          {filterSummary.length > 0 && (
            <div className="publisherFilterBar" aria-label="当前筛选">
              {filterSummary.map((t) => (
                <span key={t} className="publisherFilterPill">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="publisherSidebarHint">
          提示：上方搜索框在该模式下用于筛选发布者（author），并且会继承目录/类型/标签筛选。
        </div>

        {authorsError && <div className="publisherError">加载失败：{authorsError}</div>}
        {!authorsLoading && !authorsError && authors.length === 0 && (
          <div className="publisherEmpty">暂无发布者数据（可能需要先执行一次索引更新 /api/reindex）。</div>
        )}

        {isNarrow ? (
          <div className="publisherAuthorGrid">
            <Masonry
              columns={{ xs: 2, sm: 3, md: 4 }}
              gutter={{ xs: 12, md: 16 }}
              fresh
              items={authors.map((a) => {
                const label = fmtAuthorLabel(a.author);
                const isActive = selectedAuthor === a.author;
                const coverSrc = a.latestItem?.thumbUrl || a.latestItem?.url || '';
                const isVideo = a.latestItem?.kind === 'video';
                const hasCover = Boolean(coverSrc);

                return {
                  key: `author-${a.author}`,
                  data: a,
                  children: (
                    <Card
                      hoverable
                      className={`publisherAuthorCard ${isActive ? 'active' : ''}`}
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: 16,
                        overflow: 'hidden',
                      }}
                      styles={{ body: { padding: 10, backgroundColor: 'transparent' } }}
                      cover={
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedAuthor(a.author)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedAuthor(a.author);
                            }
                          }}
                          className="publisherAuthorCardCover"
                          title={`${label} | groups=${a.groupCount} items=${a.itemCount}`}
                        >
                          {hasCover ? (
                            <BaseImage
                              src={coverSrc}
                              alt={label}
                              wrapperClassName="publisherAuthorCardCoverImg"
                              className="publisherAuthorCardCoverImgEl"
                              // 让封面按原始比例自适应高度（否则所有卡片同高，看起来像普通网格）
                              imgStyle={{ width: '100%', height: 'auto' }}
                              showSkeleton={true}
                            />
                          ) : (
                            <div className="publisherAuthorCardCoverEmpty">暂无封面</div>
                          )}
                          <div className="publisherAuthorCardOverlay" aria-hidden="true">
                            {isVideo && <span className="publisherAuthorCardPlay">▶</span>}
                          </div>
                        </div>
                      }
                      onClick={() => setSelectedAuthor(a.author)}
                    >
                      <div className="publisherAuthorCardName" title={label}>
                        {label}
                      </div>
                      <div className="publisherAuthorCardMeta">
                        <span className="chip mini">{a.groupCount}g</span>
                        <span className="chip mini">{a.itemCount}i</span>
                      </div>
                    </Card>
                  ),
                };
              })}
            />
            <div ref={authorSentinelRef} style={{ height: 1 }} aria-hidden="true" />
          </div>
        ) : (
          <div className="publisherAuthorList">
            {authors.map((a) => {
              const label = fmtAuthorLabel(a.author);
              const isActive = selectedAuthor === a.author;
              return (
                <button
                  key={`author-${a.author}`}
                  className={`publisherAuthorRow ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedAuthor(a.author)}
                  title={`${label} | groups=${a.groupCount} items=${a.itemCount}`}
                  type="button"
                >
                  <div className="publisherAuthorName">{label}</div>
                  <div className="publisherAuthorCounts">
                    <span className="chip mini">{a.groupCount}g</span>
                    <span className="chip mini">{a.itemCount}i</span>
                  </div>
                </button>
              );
            })}
            <div ref={authorSentinelRef} style={{ height: 1 }} aria-hidden="true" />
          </div>
        )}

        <div className="publisherSidebarFooter">
          {authorsPagination.hasMore ? (
            <button className="btn" disabled={authorsLoadingMore} onClick={() => loadAuthors({ reset: false })}>
              {authorsLoadingMore ? '加载中…' : '加载更多发布者'}
            </button>
          ) : (
            <div className="publisherEndHint">发布者列表已到底</div>
          )}
        </div>
      </aside>
      )}

      {showDetail && (
        <section className="publisherMain">
        <div className="publisherMainHeader">
          <div className="publisherMainTitle">
            {selectedAuthor == null ? '请选择发布者' : `发布者：${fmtAuthorLabel(selectedAuthor)}`}
          </div>
          <div className="publisherMainMeta">{selectedAuthor == null ? '' : groupsMeta}</div>
          {selectedAuthor != null && (
            <div className="publisherMainActions">
              <button className="btn ghost" onClick={() => setSelectedAuthor(null)}>
                {isNarrow ? '返回' : '返回发布者列表'}
              </button>
              <button className="btn" onClick={() => loadGroups({ reset: true })}>
                刷新该发布者
              </button>
            </div>
          )}
        </div>
        {selectedAuthor != null && filterSummary.length > 0 && (
          <div className="publisherFilterBar publisherFilterBarMain" aria-label="当前筛选">
            {filterSummary.map((t) => (
              <span key={t} className="publisherFilterPill">
                {t}
              </span>
            ))}
          </div>
        )}

        {selectedAuthor == null ? (
          <div className="publisherMainEmpty">从左侧选择一个发布者后，将在右侧按分页加载该发布者的合集（groups）。</div>
        ) : groupsError ? (
          <div className="publisherError">加载失败：{groupsError}</div>
        ) : (
          <MediaGrid
            sections={[
              {
                key: 'author',
                title: '',
                meta: '',
                items: groups.map((g, idx) => ({ groupIdx: idx, group: g })),
              },
            ]}
            expanded={expanded}
            hasMore={Boolean(groupsPagination.hasMore)}
            totalGroups={groupsPagination.total || groups.length}
            loading={groupsLoading}
            loadingMore={groupsLoadingMore}
            onLoadMore={() => {
              if (!groupsPagination.hasMore || groupsLoadingMore || groupsLoading) return;
              loadGroups({ reset: false });
            }}
            onThumbClick={(groupIdx, itemIdx) => openModal(groupIdx, itemIdx)}
            onTagClick={undefined}
          />
        )}
      </section>
      )}

      {modal.open && (
        <PreviewModal
          groups={groups}
          groupIdx={modal.groupIdx}
          itemIdx={modal.itemIdx}
          feedMode={false}
          onClose={() => setModal((p) => ({ ...p, open: false }))}
          onStep={(delta) => {
            setModal((prev) => {
              const g = groups[prev.groupIdx];
              const items = g?.items || [];
              const nextIdx = Math.max(0, Math.min(prev.itemIdx + delta, items.length - 1));
              return { ...prev, itemIdx: nextIdx };
            });
          }}
          onSetItemIdx={(nextIdx) => {
            setModal((prev) => {
              const g = groups[prev.groupIdx];
              const items = g?.items || [];
              const clamped = Math.max(0, Math.min(nextIdx, items.length - 1));
              return clamped === prev.itemIdx ? prev : { ...prev, itemIdx: clamped };
            });
          }}
          onGroupStep={() => {}}
          onReload={() => loadGroups({ reset: true })}
        />
      )}
    </div>
  );
}

