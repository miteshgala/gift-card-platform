import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CreditCard, Loader2, CheckCircle, AlertCircle, History } from 'lucide-react';
import { api, getErrorMessage } from '../../lib/api';
import { format } from 'date-fns';

const schema = z.object({
  cardNumber: z.string().regex(/^\d{16}$/, 'Enter 16-digit card number (no dashes)'),
  pin: z.string().regex(/^\d{4}$/, 'Enter 4-digit PIN'),
});
type FormData = z.infer<typeof schema>;

interface BalanceResult {
  id: string;
  cardNumberMasked: string;
  status: string;
  currency: string;
  currentBalance: number;
  expiresAt?: string;
  lastTransactionAt?: string;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description?: string;
  createdAt: string;
}

export default function BalanceCheckPage() {
  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError(null);
    setBalance(null);
    setTransactions(null);
    try {
      const res = await api.post('/ledger/balance-check', data);
      setBalance(res.data.data);
      setCardId(res.data.data.id);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    if (!cardId) return;
    setLoadingHistory(true);
    try {
      const res = await api.get(`/ledger/cards/${cardId}/transactions?limit=10`);
      setTransactions(res.data.data);
    } finally {
      setLoadingHistory(false);
    }
  };

  const STATUS_COLORS: Record<string, string> = {
    ACTIVE: 'text-green-600',
    FROZEN: 'text-blue-600',
    EXPIRED: 'text-red-600',
    REDEEMED: 'text-gray-500',
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-100 rounded-2xl mb-4">
          <CreditCard className="w-8 h-8 text-brand-600" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900">Check Your Balance</h1>
        <p className="text-gray-500 mt-2">Enter your gift card details to check your balance</p>
      </div>

      <div className="card p-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Card Number (16 digits)</label>
            <input
              {...register('cardNumber')}
              className="input font-mono tracking-widest text-center text-lg"
              placeholder="1234567890123456"
              maxLength={16}
            />
            {errors.cardNumber && <p className="text-red-500 text-xs mt-1">{errors.cardNumber.message}</p>}
          </div>
          <div>
            <label className="label">PIN (4 digits)</label>
            <input
              {...register('pin')}
              type="password"
              className="input font-mono tracking-widest text-center text-lg"
              placeholder="••••"
              maxLength={4}
            />
            {errors.pin && <p className="text-red-500 text-xs mt-1">{errors.pin.message}</p>}
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
            {loading ? 'Checking...' : 'Check Balance'}
          </button>
        </form>
      </div>

      {error && (
        <div className="card p-4 border-red-200 bg-red-50 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {balance && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <h2 className="font-semibold text-gray-900">Card Found</h2>
          </div>

          <div className="bg-gradient-to-r from-brand-500 to-purple-600 rounded-xl p-6 text-white">
            <p className="text-brand-100 text-sm mb-1">Card Number</p>
            <p className="font-mono text-lg font-bold">{balance.cardNumberMasked}</p>
            <div className="flex justify-between items-end mt-4">
              <div>
                <p className="text-brand-100 text-xs">Available Balance</p>
                <p className="text-3xl font-bold">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: balance.currency })
                    .format(Number(balance.currentBalance))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-brand-100 text-xs">Status</p>
                <p className={`font-semibold text-sm ${STATUS_COLORS[balance.status] ?? 'text-white'}`}>
                  {balance.status}
                </p>
              </div>
            </div>
          </div>

          {balance.expiresAt && (
            <p className="text-sm text-gray-500">
              Expires: <strong>{format(new Date(balance.expiresAt), 'MMMM d, yyyy')}</strong>
            </p>
          )}

          <button
            onClick={loadHistory}
            disabled={loadingHistory}
            className="btn-secondary w-full"
          >
            {loadingHistory ? <Loader2 className="w-4 h-4 animate-spin" /> : <History className="w-4 h-4" />}
            View Transaction History
          </button>
        </div>
      )}

      {transactions && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Transactions</h2>
          </div>
          {transactions.length === 0 ? (
            <p className="px-6 py-4 text-gray-400 text-sm">No transactions yet</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {transactions.map((tx) => (
                <div key={tx.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{tx.type}</p>
                    <p className="text-xs text-gray-400">{tx.description ?? format(new Date(tx.createdAt), 'MMM d, yyyy h:mm a')}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-medium text-sm ${['REDEEM', 'EXPIRY_FEE'].includes(tx.type) ? 'text-red-500' : 'text-green-600'}`}>
                      {['REDEEM', 'EXPIRY_FEE'].includes(tx.type) ? '-' : '+'}
                      ${Number(tx.amount).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-400">Bal: ${Number(tx.balanceAfter).toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
