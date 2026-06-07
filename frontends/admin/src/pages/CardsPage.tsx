import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, Plus } from 'lucide-react';
import { api, formatCents, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface Card {
  id: string;
  vaultToken: string;
  last4: string;
  cardType: string;
  status: string;
  currency: string;
  initialLoad: string;
  recipientName?: string;
  recipientEmail?: string;
  expiresAt: string;
  createdAt: string;
  programId: string;
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'badge-green',
  PENDING_ACTIVATION: 'badge-yellow',
  SUSPENDED: 'badge-yellow',
  EXPIRED: 'badge-gray',
  CANCELLED: 'badge-red',
};

export default function CardsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['cards', status],
    queryFn: () =>
      api.get<{ data: Card[] }>('/cards', {
        params: { status: status || undefined, limit: 50 },
      }).then((r) => r.data.data),
  });

  const filtered = data?.filter((c) => {
    if (!search) return true;
    return (
      c.last4.includes(search) ||
      c.recipientName?.toLowerCase().includes(search.toLowerCase()) ||
      c.recipientEmail?.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Cards</h1>
          <p className="text-sm text-gray-500">All issued gift cards</p>
        </div>
        <button onClick={() => navigate('/orders')} className="btn-primary">
          <Plus className="h-4 w-4" />
          New Order
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by last4, name, email…"
            className="input pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-40"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_ACTIVATION">Pending</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="EXPIRED">Expired</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* Table */}
      <div className="card">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-6 py-3">Card</th>
                  <th className="px-6 py-3">Recipient</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3 text-right">Initial Load</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Expires</th>
                  <th className="px-6 py-3">Issued</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered?.map((card) => (
                  <tr
                    key={card.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/cards/${card.id}`)}
                  >
                    <td className="px-6 py-4">
                      <span className="font-mono font-medium text-gray-900">•••• {card.last4}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{card.recipientName ?? '—'}</div>
                      {card.recipientEmail && (
                        <div className="text-xs text-gray-500">{card.recipientEmail}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{card.cardType}</td>
                    <td className="px-6 py-4 text-right font-medium text-gray-900">
                      {formatCents(card.initialLoad)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={STATUS_BADGE[card.status] ?? 'badge-gray'}>
                        {card.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{formatDate(card.expiresAt)}</td>
                    <td className="px-6 py-4 text-gray-600">{formatDate(card.createdAt)}</td>
                    <td className="px-4 py-4">
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </td>
                  </tr>
                ))}
                {(!filtered || filtered.length === 0) && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                      No cards found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
