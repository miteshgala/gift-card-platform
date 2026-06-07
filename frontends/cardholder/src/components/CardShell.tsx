/**
 * Shared shell for all authenticated cardholder pages.
 * Shows top navigation and a visual gift card widget.
 */

import { useQuery } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';
import { CreditCard, List, RefreshCw, AlertTriangle, LogOut } from 'lucide-react';
import { api, formatCents, formatDate } from '@/lib/api';
import clsx from 'clsx';

interface CardData {
  cardId: string;
  last4: string;
  balanceCents: string;
  currency: string;
  expiresAt: string;
  status: string;
}

const navItems = [
  { to: '/balance', label: 'Balance', icon: CreditCard },
  { to: '/transactions', label: 'History', icon: List },
  { to: '/reload', label: 'Reload', icon: RefreshCw },
  { to: '/dispute', label: 'Dispute', icon: AlertTriangle },
];

export default function CardShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['ch', 'balance'],
    queryFn: () => api.get<{ data: CardData }>('/balance').then((r) => r.data.data),
  });

  function logout() {
    localStorage.removeItem('ch_token');
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Visual card */}
      <div className="bg-gradient-to-br from-brand-600 to-brand-700 px-4 pt-8 pb-16">
        <div className="mx-auto max-w-sm">
          <div className="flex justify-between items-center mb-6">
            <span className="text-white font-semibold text-sm">My Gift Card</span>
            <button onClick={logout} className="text-brand-200 hover:text-white flex items-center gap-1 text-xs">
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>

          {/* Card widget */}
          <div className="rounded-2xl bg-white/15 backdrop-blur p-6 text-white shadow-lg">
            <div className="flex justify-between items-start mb-8">
              <CreditCard className="h-8 w-8 text-white/80" />
              <span className="text-xs text-white/60">Gift Card</span>
            </div>
            <div className="mb-1 text-3xl font-bold tracking-tight">
              {data ? formatCents(data.balanceCents) : '—'}
            </div>
            <div className="text-sm text-white/70">Available balance</div>
            <div className="mt-4 flex justify-between text-xs text-white/60">
              <span className="font-mono tracking-widest">•••• •••• •••• {data?.last4 ?? '····'}</span>
              <span>Exp {data ? formatDate(data.expiresAt) : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Nav tabs — overlapping the card */}
      <div className="mx-auto max-w-sm -mt-8 px-4 relative z-10">
        <div className="card p-1 flex">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex-1 flex flex-col items-center gap-0.5 rounded-xl py-2.5 text-xs font-medium transition-colors',
                  isActive ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-700',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Page content */}
      <div className="mx-auto max-w-sm px-4 pt-4 pb-12">
        {children}
      </div>
    </div>
  );
}
