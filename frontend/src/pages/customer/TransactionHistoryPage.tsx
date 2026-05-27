import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  CreditCard, Loader2, AlertCircle, Search, ChevronLeft,
  ChevronRight, ArrowDownCircle, ArrowUpCircle, RefreshCw,
  MinusCircle, ArrowLeftRight,
} from 'lucide-react';
import { api, getErrorMessage } from '../../lib/api';
import { format } from 'date-fns';

const schema = z.object({
  cardNumber: z.string().regex(/^\d{16}$/, 'Enter 16-digit card number'),
  pin: z.string().regex(/^\d{4}$/, 'Enter 4-digit PIN'),
});
type FormData = z.infer<typeof schema>;

interface CardInfo {
  id: string;
  cardNumberMasked: string;
  status: string;
  currency: string;
  currentBalance: number;
  expiresAt?: string;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description?: string;
  location?: string;
  referenceId?: string;
  createdAt: string;
  metadata?: { merchantCategory?: string; merchantId?: string };
}

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType; sign: string }> = {
  LOAD:         { label: 'Load',         color: 'text-green-600', icon: ArrowUpCircle,    sign: '+' },
  REDEEM:       { label: 'Redemption',   color: 'text-red-500',   icon: ArrowDownCircle,  sign: '-' },
  REFUND:       { label: 'Refund',       color: 'text-green-600', icon: ArrowUpCircle,    sign: '+' },
  ADJUSTMENT:   { label: 'Adjustment',   color: 'text-blue-600',  icon: RefreshCw,        sign: '±' },
  EXPIRY_FEE:   { label: 'Dormancy Fee', color: 'text-red-400',   icon: MinusCircle,      sign: '-' },
  TRANSFER_IN:  { label: 'Transfer In',  color: 'text-green-600', icon: ArrowLeftRight,   sign: '+' },
  TRANSFER_OUT: { label: 'Transfer Out', color: 'text-red-500',   icon: ArrowLeftRight,   sign: '-' },
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  FROZEN: 'bg-blue-100 text-blue-700',
  EXPIRED: 'bg-red-100 text-red-700',
  REDEEMED: 'bg-gray-100 text-gray-600',
  PENDING: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export default function TransactionHistoryPage() {
  const [card, setCard] = useState<CardInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('');

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const fetchTransactions = async (cardId: string, p = 1, type = '') => {
    setTxLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: '15' });
      if (type) params.set('type', type);
      const res = await api.get(`/ledger/cards/${cardId}/transactions?${params}`);
      setTransactions(res.data.data);
      setMeta(res.data.meta);
    } finally {
      setTxLoading(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError(null);
    setCard(null);
    setTransactions([]);
    setPage(1);
    try {
      const res = await api.post('/ledger/balance-check', data);
      const cardData = res.data.data;
      setCard(cardData);
      await fetchTransactions(cardData.id, 1, typeFilter);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (!card) return;
    setPage(newPage);
    fetchTransactions(card.id, newPage, typeFilter);
  };

  const handleTypeFilter = (type: string) => {
    if (!card) return;
    setTypeFilter(type);
    setPage(1);
    fetchTransactions(card.id, 1, type);
  };

  const fmt = (v: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(v));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-100 rounded-2xl mb-4">
          <CreditCard className="w-8 h-8 text-brand-600" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900">Transaction History</h1>
        <p className="text-gray-500 mt-2">Enter your card details to view your full transaction history</p>
      </div>

      {/* Lookup form */}
      <div className="card p-6">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              {...register('cardNumber')}
              className="input font-mono tracking-widest text-center"
              placeholder="16-digit card number"
              maxLength={16}
            />
            {errors.cardNumber && <p className="text-red-500 text-xs mt-1">{errors.cardNumber.message}</p>}
          </div>
          <div className="w-full sm:w-32">
            <input
              {...register('pin')}
              type="password"
              className="input font-mono tracking-widest text-center"
              placeholder="PIN"
              maxLength={4}
            />
            {errors.pin && <p className="text-red-500 text-xs mt-1">{errors.pin.message}</p>}
          </div>
          <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2 whitespace-nowrap">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? 'Looking up…' : 'View History'}
          </button>
        </form>
      </div>

      {error && (
        <div className="card p-4 border-red-200 bg-red-50 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {card && (
        <>
          {/* Card summary banner */}
          <div className="bg-gradient-to-r from-brand-500 to-purple-600 rounded-2xl p-6 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-brand-100 text-sm">Card Number</p>
              <p className="font-mono text-lg font-bold mt-0.5">{card.cardNumberMasked}</p>
            </div>
            <div className="text-center">
              <p className="text-brand-100 text-sm">Balance</p>
              <p className="text-3xl font-bold">{fmt(card.currentBalance, card.currency)}</p>
            </div>
            <div className="text-right">
              <p className="text-brand-100 text-sm">Status</p>
              <span className={`inline-block mt-1 px-3 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[card.status] ?? 'bg-white/20 text-white'}`}>
                {card.status}
              </span>
              {card.expiresAt && (
                <p className="text-brand-200 text-xs mt-1">Exp {format(new Date(card.expiresAt), 'MMM d, yyyy')}</p>
              )}
            </div>
          </div>

          {/* Type filter pills */}
          <div className="flex flex-wrap gap-2">
            {['', 'LOAD', 'REDEEM', 'REFUND', 'TRANSFER_IN', 'TRANSFER_OUT', 'EXPIRY_FEE'].map((t) => (
              <button
                key={t}
                onClick={() => handleTypeFilter(t)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  typeFilter === t
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t === '' ? 'All' : (TYPE_CONFIG[t]?.label ?? t)}
              </button>
            ))}
          </div>

          {/* Transactions table */}
          <div className="card overflow-hidden">
            {txLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No transactions found</p>
              </div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-500">Type</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-500">Description</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-500 hidden sm:table-cell">Balance After</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-500 hidden md:table-cell">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {transactions.map((tx) => {
                      const cfg = TYPE_CONFIG[tx.type] ?? { label: tx.type, color: 'text-gray-700', sign: '' };
                      const Icon = cfg.icon ?? RefreshCw;
                      return (
                        <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Icon className={`w-4 h-4 ${cfg.color}`} />
                              <span className="font-medium text-gray-900">{cfg.label}</span>
                            </div>
                            {tx.metadata?.merchantCategory && (
                              <p className="text-xs text-gray-400 mt-0.5 ml-6">MCC {tx.metadata.merchantCategory}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">
                            {tx.description ?? '—'}
                            {tx.location && <span className="text-gray-400"> · {tx.location}</span>}
                          </td>
                          <td className={`px-4 py-3 text-right font-semibold ${cfg.color}`}>
                            {cfg.sign}{fmt(tx.amount, card.currency)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500 hidden sm:table-cell">
                            {fmt(tx.balanceAfter, card.currency)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-400 hidden md:table-cell whitespace-nowrap">
                            {format(new Date(tx.createdAt), 'MMM d, yyyy')}
                            <br />
                            <span className="text-xs">{format(new Date(tx.createdAt), 'h:mm a')}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Pagination */}
                {meta && meta.totalPages > 1 && (
                  <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      {meta.total} transaction{meta.total !== 1 ? 's' : ''} · Page {meta.page} of {meta.totalPages}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handlePageChange(page - 1)}
                        disabled={page <= 1 || txLoading}
                        className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handlePageChange(page + 1)}
                        disabled={page >= meta.totalPages || txLoading}
                        className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
