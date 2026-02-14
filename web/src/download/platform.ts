function safeUserAgent() {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent || '';
}

export function isIOS(ua = safeUserAgent()): boolean {
  if (!ua) return false;
  return /iPad|iPhone|iPod/i.test(ua) || (/\bMacintosh\b/i.test(ua) && 'ontouchend' in globalThis);
}

export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  const byMedia = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari legacy flag
  const byNavigator = typeof navigator !== 'undefined' && (navigator as any).standalone === true;
  return Boolean(byMedia || byNavigator);
}

export function isMobile(ua = safeUserAgent()): boolean {
  if (typeof window !== 'undefined' && window.innerWidth <= 768) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function getPlatformInfo() {
  return {
    ios: isIOS(),
    standalonePwa: isStandalonePWA(),
    mobile: isMobile(),
  };
}
