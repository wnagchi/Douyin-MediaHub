import { useState, useEffect } from 'react';

export function useMobileLayout() {
  const [isMobile, setIsMobile] = useState(() => {
    try {
      return typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
    } catch {
      return false;
    }
  });

  const [mobileDockHidden, setMobileDockHidden] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') {
      setMobileDockHidden(false);
      return;
    }
    let lastY = window.scrollY || 0;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const y = window.scrollY || 0;
        const delta = y - lastY;
        if (y <= 12) {
          setMobileDockHidden(false);
        } else if (delta > 6) {
          setMobileDockHidden(true);
        } else if (delta < -6) {
          setMobileDockHidden(false);
        }
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isMobile]);

  return { isMobile, mobileDockHidden };
}
