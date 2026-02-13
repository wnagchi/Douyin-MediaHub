import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import App from './App';
import FeedPage from './pages/FeedPage';
import SettingsPage from './pages/SettingsPage';

const ROUTES = {
  home: '/',
  feed: '/feed',
  settings: '/settings',
  unclassified: '/unclassified',
} as const;

export default function RouterApp() {
  const location = useLocation();
  const pathname = location.pathname;
  const [mounted, setMounted] = React.useState({
    home: true,
    feed: false,
    settings: false,
    unclassified: false,
  });

  React.useEffect(() => {
    if (pathname === ROUTES.feed && !mounted.feed) {
      setMounted((prev) => ({ ...prev, feed: true }));
    }
    if (pathname === ROUTES.settings && !mounted.settings) {
      setMounted((prev) => ({ ...prev, settings: true }));
    }
    if (pathname === ROUTES.unclassified && !mounted.unclassified) {
      setMounted((prev) => ({ ...prev, unclassified: true }));
    }
  }, [pathname, mounted.feed, mounted.settings, mounted.unclassified]);

  const isHome = pathname === ROUTES.home;
  const isFeed = pathname === ROUTES.feed;
  const isSettings = pathname === ROUTES.settings;
  const isUnclassified = pathname === ROUTES.unclassified;
  const isKnown = isHome || isFeed || isSettings || isUnclassified;

  return (
    <>
      <div className={`routeCache ${!isHome ? 'routeHidden' : ''}`} aria-hidden={!isHome}>
        <App />
      </div>
      {mounted.unclassified && (
        <div className={`routeCache ${!isUnclassified ? 'routeHidden' : ''}`} aria-hidden={!isUnclassified}>
          <App unclassifiedOnly />
        </div>
      )}
      {mounted.feed && (
        <div className={`routeCache ${!isFeed ? 'routeHidden' : ''}`} aria-hidden={!isFeed}>
          <FeedPage active={isFeed} />
        </div>
      )}
      {mounted.settings && (
        <div className={`routeCache ${!isSettings ? 'routeHidden' : ''}`} aria-hidden={!isSettings}>
          <SettingsPage />
        </div>
      )}
      {!isKnown && <Navigate to="/" replace />}
    </>
  );
}
