import { MediaGroup } from '../api';
import { escHtml } from '../utils';
import BaseImage from './BaseImage';
import { Card } from 'antd';

const { Meta } = Card;

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
  expanded: _expanded = false,
  wrapperClassName,
  onThumbClick,
}: MediaCardProps) {
  const title = fmtGroupTitle(group);
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

  // 构建描述信息
  const descriptionParts: string[] = [];
  if (group.author) {
    descriptionParts.push(`发布人: ${group.author}`);
  }
  if (group.timeText) {
    descriptionParts.push(`时间: ${group.timeText}`);
  }
  descriptionParts.push(`条目: ${items.length}`);
  
  const description = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.65)' }}>
        {descriptionParts.join(' | ')}
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {tags.map((t) => (
          <span 
            key={t} 
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              fontSize: '11px',
              borderRadius: '4px',
              backgroundColor: typeClass(t) === 'video' ? 'rgba(59, 130, 246, 0.2)' :
                               typeClass(t) === 'photo' ? 'rgba(236, 72, 153, 0.2)' :
                               typeClass(t) === 'live' ? 'rgba(34, 197, 94, 0.2)' :
                               typeClass(t) === 'mix' ? 'rgba(168, 85, 247, 0.2)' :
                               'rgba(156, 163, 175, 0.2)',
              color: 'rgba(255,255,255,0.85)',
            }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <Card
      hoverable
      className={wrapperClassName || ''}
      style={{ 
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        overflow: 'hidden',
      }}
      styles={{
        body: {
          padding: '12px',
          backgroundColor: 'transparent',
        },
      }}
      cover={
        first ? (
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '220px',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
            className='!flex items-center justify-center'
            role="button"
            tabIndex={0}
            title={escHtml(first.filename)}
            onClick={() => handleThumbClick(0)}
            onKeyDown={(e) => handleThumbKeyDown(e, 0)}
          >
            <BaseImage
              wrapperClassName=""
              className=""
              src={escHtml(first.thumbUrl ?? first.url)}
              alt={title}
              imgStyle={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'cover',
              }}
            />
            {firstIsVideo && (
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px',
                  color: 'white',
                  pointerEvents: 'none',
                }}
              >
                ▶
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              width: '100%',
              height: '220px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              color: 'rgba(255, 255, 255, 0.3)',
            }}
          >
            暂无内容
          </div>
        )
      }
    >
      <Meta 
        title={
          <div style={{ color: 'rgba(255, 255, 255, 0.92)', fontSize: '14px', fontWeight: 600 }}>
            {title}
          </div>
        }
        description={description}
      />
    </Card>
  );
}
