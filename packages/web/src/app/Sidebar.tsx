import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const links = [
  { to: '/', label: 'Planner', end: true },
  { to: '/tasks', label: 'Tasks', end: false },
  { to: '/habits', label: 'Habits', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export function Sidebar() {
  const { signOut } = useAuth();
  return (
    <nav className="flex w-48 flex-col gap-1 border-r border-gray-200 p-3">
      <div className="mb-3 font-semibold">NotReclaim</div>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) => `rounded px-2 py-1 ${isActive ? 'bg-blue-100 font-medium' : 'text-gray-700'}`}
        >
          {l.label}
        </NavLink>
      ))}
      <div className="mt-auto flex flex-col gap-2 pt-3 text-sm text-gray-500">
        <span>◉ Connected</span>
        <button onClick={signOut} className="text-left text-gray-700 hover:underline">Sign out</button>
      </div>
    </nav>
  );
}
