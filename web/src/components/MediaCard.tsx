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

        <div className="thumbs" data-group={groupIdx}>
          {items.map((it, idx) => {
            const isVideo = it.kind === 'video';
            const badgeText = it.seq != null ? `_${it.seq}` : isVideo ? 'mp4' : 'img';

            return (
              <div
                key={idx}
                className="thumb"
                role="button"
                tabIndex={0}
                data-g={groupIdx}
                data-i={idx}
                title={escHtml(it.filename)}
                onClick={() => handleThumbClick(idx)}
                onKeyDown={(e) => handleThumbKeyDown(e, idx)}
              >
                <BaseImage
                  wrapperClassName="w-full"
                  className="w-full"
                  src={escHtml(it.thumbUrl ?? it.url)}
                  alt=""
                />
                <div className="overlay">
                  <span className="badge">{escHtml(badgeText)}</span>
                  {isVideo ? (
                    <div className="play" aria-hidden="true">
                      ▶
                    </div>
                  ) : (
                    <div style={{ width: '30px' }}></div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}
