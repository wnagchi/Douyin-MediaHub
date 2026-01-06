import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import RouterApp from './RouterApp';
import 'antd/dist/reset.css';
import 'video-react/dist/video-react.css';
import './app.css';
import { registerSW } from 'virtual:pwa-register';

// PWA: 自动更新 Service Worker（devOptions.enabled=true 时开发环境也会生效）
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <RouterApp />
    </HashRouter>
  </React.StrictMode>
);
