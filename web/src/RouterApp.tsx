import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import App from './App';
import FeedPage from './pages/FeedPage';
import SettingsPage from './pages/SettingsPage';

const ROUTES = {
  home: '/',
  feed: '/feed',
  settings: '/settings',
} as const;

export default function RouterApp() {
  const location = useLocation();
  const pathname = location.pathname;
  const [mounted, setMounted] = React.useState({
    home: true,
    feed: false,
    settings: false,
  });

  React.useEffect(() => {
    if (pathname === ROUTES.feed && !mounted.feed) {
      setMounted((prev) => ({ ...prev, feed: true }));
    }
    if (pathname === ROUTES.settings && !mounted.settings) {
      setMounted((prev) => ({ ...prev, settings: true }));
    }
  }, [pathname, mounted.feed, mounted.settings]);

  const isHome = pathname === ROUTES.home;
  const isFeed = pathname === ROUTES.feed;
  const isSettings = pathname === ROUTES.settings;
  const isKnown = isHome || isFeed || isSettings;

  return (
    <>
      <div className={`routeCache ${!isHome ? 'routeHidden' : ''}`} aria-hidden={!isHome}>
        <App />
      </div>
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
