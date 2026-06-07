import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CreditCard, ShoppingCart, Users, Shield,
  AlertTriangle, BarChart2, Webhook, Settings, LogOut,
  Building2, Handshake, List, UserCheck, TrendingUp, SlidersHorizontal,
} from 'lucide-react';
import { clearTokens, getCurrentUser } from '@/lib/auth';
import clsx from 'clsx';

const navItems = [
  { to: '/dashboard',   label: 'Dashboard',    icon: LayoutDashboard },
  { to: '/programs',    label: 'Programs',     icon: Building2 },
  { to: '/cards',       label: 'Cards',        icon: CreditCard },
  { to: '/orders',      label: 'Orders',       icon: ShoppingCart },
  { to: '/users',       label: 'Users',        icon: Users },
  { to: '/fraud',       label: 'Fraud',        icon: Shield },
  { to: '/disputes',    label: 'Disputes',     icon: AlertTriangle },
  { to: '/settlement',  label: 'Settlement',   icon: Handshake },
  { to: '/reports',     label: 'Reports',      icon: BarChart2 },
  { to: '/webhooks',    label: 'Webhooks',     icon: Webhook },
  { to: '/integrations',label: 'Integrations', icon: Settings },
  { to: '/kyc',         label: 'KYC / KYB',   icon: UserCheck },
  { to: '/analytics',   label: 'Analytics',    icon: TrendingUp },
  { to: '/audit-log',   label: 'Audit Log',    icon: List },
  { to: '/settings',    label: 'Settings',     icon: SlidersHorizontal },
];

export default function Layout() {
  const navigate = useNavigate();
  const user = getCurrentUser();

  function handleLogout() {
    clearTokens();
    navigate('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col bg-gray-900 text-gray-100">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 px-6 border-b border-gray-700">
          <CreditCard className="h-7 w-7 text-brand-400" />
          <span className="font-semibold text-lg tracking-tight">GiftCard Admin</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <ul className="space-y-0.5">
            {navItems.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-brand-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white',
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* User info + logout */}
        <div className="border-t border-gray-700 px-4 py-4">
          <div className="mb-2 text-xs text-gray-400 truncate">{user?.email}</div>
          <div className="mb-3 text-xs font-medium text-gray-300">{user?.role?.replace('_', ' ')}</div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 items-center justify-between border-b bg-white px-6 shadow-sm">
          <div className="text-sm text-gray-500">
            {user?.programId ? `Program: ${user.programId}` : 'All Programs'}
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            {user?.email}
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
