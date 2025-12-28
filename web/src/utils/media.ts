import { MediaGroup } from '../api';

export function getPreferredItemIndex(group?: MediaGroup): number {
  const items = group?.items || [];
  if (!items.length) return 0;
  const firstVideoIdx = items.findIndex((it) => it.kind === 'video');
  return firstVideoIdx >= 0 ? firstVideoIdx : 0;
}
