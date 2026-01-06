import { Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import FeedPage from './pages/FeedPage';

export default function RouterApp() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/feed" element={<FeedPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

