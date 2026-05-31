import { Routes, Route, Navigate } from 'react-router-dom';
import { SignIn } from '../auth/SignIn';
import { AuthCallback } from '../auth/AuthCallback';
import { ProtectedRoute } from './ProtectedRoute';
import { AppShell } from './AppShell';
import { Planner } from './pages/Planner';
import { Priorities } from './pages/Priorities';
import { Habits } from './pages/Habits';
import { Settings } from './pages/Settings';
import { StatsPlaceholder } from './pages/StatsPlaceholder';

export function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Planner />} />
          <Route path="/priorities" element={<Priorities />} />
          <Route path="/stats" element={<StatsPlaceholder />} />
          <Route path="/habits" element={<Habits />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/tasks" element={<Navigate to="/priorities" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
