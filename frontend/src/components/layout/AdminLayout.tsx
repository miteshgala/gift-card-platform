import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CreditCard, ShoppingCart, BarChart3,
  Users, Shield, Building2, Settings, LogOut, Bell, Gift,
} from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { useLogout } from '../../hooks/useAuth';

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/cards', label: 'Cards', icon: CreditCard },
  { to: '/admin/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { to: '/admin/fraud', label: 'Fraud', icon: Shield },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/programs', label: 'Programs', icon: Building2 },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-brand-900 text-white flex flex-col flex-shrink-0">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-brand-700">
          <Gift className="w-8 h-8 text-brand-100" />
          <div>
            <p className="font-bold text-sm leading-none">GiftCard</p>
            <p className="text-brand-300 text-xs">Platform</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-500 text-white'
                    : 'text-brand-200 hover:bg-brand-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-brand-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-sm font-bold">
              {user?.firstName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</p>
              <p className="text-brand-300 text-xs truncate">{user?.role?.replace('_', ' ')}</p>
            </div>
          </div>
          <button
            onClick={() => logout.mutate()}
            className="flex items-center gap-2 w-full px-3 py-2 text-brand-200 hover:text-white hover:bg-brand-800 rounded-lg text-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div />
          <div className="flex items-center gap-3">
            <button className="relative p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
            </button>
            <div className="text-sm text-gray-500">
              {user?.email}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
