import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Filter, SnowflakeIcon, XCircle, Plus } from 'lucide-react';
import { api, getErrorMessage } from '../../lib/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  FROZEN: 'bg-blue-100 text-blue-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  REDEEMED: 'bg-gray-100 text-gray-600',
  EXPIRED: 'bg-red-100 text-red-600',
  CANCELLED: 'bg-red-100 text-red-800',
};

export default function CardsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['cards', { search, status, page }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.append('search', search);
      if (status) params.append('status', status);
      const res = await api.get(`/cards?${params}`);
      return res.data;
    },
  });

  const freeze = useMutation({
    mutationFn: (cardId: string) => api.post(`/cards/${cardId}/freeze`, { reason: 'Manual freeze by admin' }),
    onSuccess: () => { toast.success('Card frozen'); qc.invalidateQueries({ queryKey: ['cards'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const unfreeze = useMutation({
    mutationFn: (cardId: string) => api.post(`/cards/${cardId}/unfreeze`),
    onSuccess: () => { toast.success('Card unfrozen'); qc.invalidateQueries({ queryKey: ['cards'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const cancel = useMutation({
    mutationFn: (cardId: string) => api.post(`/cards/${cardId}/cancel`, { reason: 'Admin cancellation' }),
    onSuccess: () => { toast.success('Card cancelled'); qc.invalidateQueries({ queryKey: ['cards'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const cards = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Gift Cards</h1>
        <a href="/admin/orders" className="btn-primary">
          <Plus className="w-4 h-4" />
          Issue Cards
        </a>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Search by card number, email, name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="input w-auto"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="">All statuses</option>
          {['ACTIVE', 'FROZEN', 'PENDING', 'REDEEMED', 'EXPIRED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Card</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expires</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : cards.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No cards found</td></tr>
              ) : cards.map((card: {
                id: string; cardNumberMasked: string; cardType: string; status: string;
                currentBalance: number; currency: string; recipientEmail?: string;
                recipientName?: string; expiresAt?: string;
              }) => (
                <tr key={card.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <a href={`/admin/cards/${card.id}`} className="font-mono text-brand-600 hover:underline">
                      {card.cardNumberMasked}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{card.cardType}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${STATUS_COLORS[card.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {card.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: card.currency }).format(card.currentBalance)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-[150px] truncate">
                    {card.recipientEmail ?? card.recipientName ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {card.expiresAt ? format(new Date(card.expiresAt), 'MMM d, yyyy') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {card.status === 'ACTIVE' && (
                        <button
                          onClick={() => freeze.mutate(card.id)}
                          className="p-1.5 text-blue-500 hover:bg-blue-50 rounded"
                          title="Freeze"
                        >
                          <SnowflakeIcon className="w-4 h-4" />
                        </button>
                      )}
                      {card.status === 'FROZEN' && (
                        <button
                          onClick={() => unfreeze.mutate(card.id)}
                          className="p-1.5 text-green-500 hover:bg-green-50 rounded"
                          title="Unfreeze"
                        >
                          <SnowflakeIcon className="w-4 h-4" />
                        </button>
                      )}
                      {!['CANCELLED', 'REDEEMED'].includes(card.status) && (
                        <button
                          onClick={() => { if (confirm('Cancel this card?')) cancel.mutate(card.id); }}
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded"
                          title="Cancel"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
            <span>
              {meta.total} cards &bull; Page {meta.page} of {meta.totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!meta.hasPrev}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!meta.hasNext}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
