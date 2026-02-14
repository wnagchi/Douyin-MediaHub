import { getPlatformInfo, isIOS, isMobile, isStandalonePWA } from './platform';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
}

describe('download platform detection', () => {
  const originalMatchMedia = window.matchMedia;
  const standaloneDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'standalone');

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    if (standaloneDescriptor) {
      Object.defineProperty(window.navigator, 'standalone', standaloneDescriptor);
    } else {
      delete (window.navigator as any).standalone;
    }
  });

  it('detects iOS from userAgent', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X)');
    expect(isIOS()).toBe(true);
  });

  it('returns false for non-iOS userAgent', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8)');
    expect(isIOS()).toBe(false);
  });

  it('detects standalone mode from display-mode media query', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, media: '(display-mode: standalone)' } as any);
    expect(isStandalonePWA()).toBe(true);
  });

  it('detects standalone mode from navigator.standalone', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, media: '(display-mode: standalone)' } as any);
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    expect(isStandalonePWA()).toBe(true);
  });

  it('detects mobile by viewport width', () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true });
    expect(isMobile()).toBe(true);
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
  });

  it('returns combined platform info', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X)');
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, media: '(display-mode: standalone)' } as any);
    const info = getPlatformInfo();
    expect(info.ios).toBe(true);
    expect(info.standalonePwa).toBe(true);
    expect(typeof info.mobile).toBe('boolean');
  });
});
