import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import Topbar from './Topbar';

vi.mock('antd', () => {
  const Modal = Object.assign(() => null, {
    confirm: vi.fn(),
  });
  const message = {
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
  return { Modal, message };
});

type TopbarComponentProps = React.ComponentProps<typeof Topbar>;

function createProps(overrides: Partial<TopbarComponentProps> = {}): TopbarComponentProps {
  return {
    q: '',
    activeType: '全部',
    activeDirId: 'all',
    activeTag: '',
    activeTags: [],
    tagFilterMode: 'OR',
    tagStats: [],
    tagStatsLoading: false,
    tagStatsError: null,
    onReloadTags: vi.fn(),
    dirs: [],
    expanded: false,
    collapsed: false,
    viewMode: 'masonry',
    sortMode: 'publish',
    onQChange: vi.fn(),
    onTypeChange: vi.fn(),
    onDirChange: vi.fn(),
    onTagChange: vi.fn(),
    onTagsChange: vi.fn(),
    onTagFilterModeChange: vi.fn(),
    onFeedClick: vi.fn(),
    onRefresh: vi.fn(),
    onFullScan: vi.fn(async () => ({})),
    fullScanLoading: false,
    selectionMode: false,
    selectedCount: 0,
    onToggleSelectionMode: vi.fn(),
    onExpandedChange: vi.fn(),
    onCollapsedChange: vi.fn(),
    onViewModeChange: vi.fn(),
    onSortModeChange: vi.fn(),
    mobileVariant: false,
    ...overrides,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderTopbar(props: TopbarComponentProps) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <MemoryRouter>
        <Topbar {...props} />
      </MemoryRouter>
    );
  });
}

async function updateInput(value: string) {
  const input = container?.querySelector('#q') as HTMLInputElement | null;
  if (!input) throw new Error('search input not found');

  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function clickById(id: string) {
  const btn = container?.querySelector(`#${id}`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`button #${id} not found`);

  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  if (container?.isConnected) {
    container.remove();
  }
  root = null;
  container = null;
});

describe('Topbar search submit behavior', () => {
  it('does not call onQChange while typing', async () => {
    const onQChange = vi.fn();
    await renderTopbar(createProps({ onQChange }));

    await updateInput('typing-keyword');
    expect(onQChange).not.toHaveBeenCalled();
  });

  it('submits trimmed query only when submit button is clicked', async () => {
    const onQChange = vi.fn();
    await renderTopbar(createProps({ q: '  hello world  ', onQChange }));
    await clickById('submitQ');

    expect(onQChange).toHaveBeenCalledTimes(1);
    expect(onQChange).toHaveBeenCalledWith('hello world');
  });

  it('clears and submits empty query when clear button is clicked', async () => {
    const onQChange = vi.fn();
    await renderTopbar(createProps({ q: 'already-set', onQChange }));

    await clickById('clearQ');
    expect(onQChange).toHaveBeenCalledTimes(1);
    expect(onQChange).toHaveBeenCalledWith('');
  });

  it('does not render search suggestions on input focus', async () => {
    await renderTopbar(createProps());

    const input = container?.querySelector('#q') as HTMLInputElement | null;
    if (!input) throw new Error('search input not found');

    await act(async () => {
      input.focus();
    });

    expect(container?.querySelector('.searchSuggestions')).toBeNull();
  });
});
