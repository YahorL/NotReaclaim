import { Routes, Route } from 'react-router-dom';
import { SignIn } from '../auth/SignIn';
import { AuthCallback } from '../auth/AuthCallback';
import { ProtectedRoute } from './ProtectedRoute';
import { AppShell } from './AppShell';
import { Planner } from './pages/Planner';
import { Tasks } from './pages/Tasks';
import { Habits } from './pages/Habits';
import { Settings } from './pages/Settings';

export function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Planner />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/habits" element={<Habits />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
    </Routes>
  );
}
