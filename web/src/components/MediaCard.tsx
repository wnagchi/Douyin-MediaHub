import { MediaGroup } from '../api';
import { escHtml } from '../utils';
import BaseImage from './BaseImage';

interface MediaCardProps {
  group: MediaGroup;
  groupIdx: number;
  expanded?: boolean;
  wrapperClassName?: string;
  onThumbClick: (groupIdx: number, itemIdx: number) => void;
}

function fmtGroupTitle(g: MediaGroup): string {
  return g.theme || '(无主题)';
}

function typeClass(t: string): string {
  if (t === '视频') return 'video';
  if (t === '图集') return 'photo';
  if (t === '实况') return 'live';
  if (t === '混合') return 'mix';
  return '';
}

function typeLabel(g: MediaGroup): string {
  return g.groupType || (g.types && g.types[0]) || '未知';
}

function typeTags(g: MediaGroup): string[] {
  const list = Array.isArray(g.types) ? g.types.slice() : [];
  const computed = typeLabel(g);
  const tags = computed === '混合' ? ['混合', ...list] : list.length ? list : [computed];
  const uniq = Array.from(new Set(tags.filter(Boolean)));
  return uniq;
}

export default function MediaCard({
  group,
  groupIdx,
  expanded = false,
  wrapperClassName,
  onThumbClick,
}: MediaCardProps) {
  const title = fmtGroupTitle(group);
  const type = typeLabel(group);
  const tags = typeTags(group);
  const items = Array.isArray(group.items) ? group.items : [];
  const first = items[0] || null;
  const firstIsVideo = first?.kind === 'video';

  const handleThumbClick = (itemIdx: number) => {
    onThumbClick(groupIdx, itemIdx);
  };

  const handleThumbKeyDown = (e: React.KeyboardEvent, itemIdx: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onThumbClick(groupIdx, itemIdx);
    }
  };

  return (
    <article className={`card ${wrapperClassName || ''}`} data-type={escHtml(type)}>
      <div className="cardInner">
        <div className="cardTop">
          <div>
            <div className="cardTitle">{escHtml(title)}</div>
            <div className="cardSub">
              {group.author && (
                <span className="pill">
                  <strong>发布人</strong> {escHtml(group.author)}
                </span>
              )}
              {group.timeText && (
                <span className="pill">
                  <strong>时间</strong> {escHtml(group.timeText)}
                </span>
              )}
              <span className="pill">
                <strong>条目</strong> {items.length}
              </span>
            </div>
          </div>
          <div className="tagRow" aria-label="类型标签">
            {tags.map((t) => (
              <span key={t} className={`tag ${typeClass(t)}`}>
                {escHtml(t)}
              </span>
            ))}
          </div>
        </div>

        <div className="albumCoverWrap" data-group={groupIdx}>
          {first ? (
            <div
              className="albumCover"
              role="button"
              tabIndex={0}
              data-g={groupIdx}
              data-i={0}
              title={escHtml(first.filename)}
              onClick={() => handleThumbClick(0)}
              onKeyDown={(e) => handleThumbKeyDown(e, 0)}
            >
              <BaseImage
                wrapperClassName="albumCoverImg"
                className="albumCoverImgEl"
                src={escHtml(first.thumbUrl ?? first.url)}
                alt=""
                imgStyle={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div className="albumCoverOverlay" aria-hidden="true">
                {firstIsVideo && <div className="albumCoverPlay">▶</div>}
              </div>
            </div>
          ) : (
            <div className="albumCover albumCoverEmpty">暂无内容</div>
          )}
        </div>
      </div>
    </article>
  );
}
