import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CreditCard } from 'lucide-react';
import { api } from '../../lib/api';
import { format } from 'date-fns';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  FROZEN: 'bg-blue-100 text-blue-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  REDEEMED: 'bg-gray-100 text-gray-600',
  EXPIRED: 'bg-red-100 text-red-600',
  CANCELLED: 'bg-red-100 text-red-800',
};

export default function CardDetailPage() {
  const { cardId } = useParams<{ cardId: string }>();

  const { data: card, isLoading } = useQuery({
    queryKey: ['card', cardId],
    queryFn: async () => {
      const res = await api.get(`/cards/${cardId}`);
      return res.data.data;
    },
  });

  const { data: txData } = useQuery({
    queryKey: ['transactions', cardId],
    queryFn: async () => {
      const res = await api.get(`/ledger/cards/${cardId}/transactions?limit=20`);
      return res.data;
    },
    enabled: !!cardId,
  });

  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading card...</div>;
  if (!card) return <div className="p-8 text-center text-gray-400">Card not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <a href="/admin/cards" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </a>
        <h1 className="text-2xl font-bold text-gray-900">Card Details</h1>
      </div>

      {/* Card Info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-brand-50 rounded-xl">
                <CreditCard className="w-6 h-6 text-brand-500" />
              </div>
              <div>
                <p className="font-mono font-bold">{card.cardNumberMasked}</p>
                <span className={`badge ${STATUS_COLORS[card.status]}`}>{card.status}</span>
              </div>
            </div>

            <dl className="space-y-3 text-sm">
              {[
                ['Type', card.cardType],
                ['Currency', card.currency],
                ['Initial Balance', `$${Number(card.initialBalance).toFixed(2)}`],
                ['Current Balance', `$${Number(card.currentBalance).toFixed(2)}`],
                ['Recipient Email', card.recipientEmail ?? '—'],
                ['Recipient Name', card.recipientName ?? '—'],
                ['Activated', card.activatedAt ? format(new Date(card.activatedAt), 'MMM d, yyyy') : '—'],
                ['Expires', card.expiresAt ? format(new Date(card.expiresAt), 'MMM d, yyyy') : '—'],
                ['Created', format(new Date(card.createdAt), 'MMM d, yyyy h:mm a')],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Transaction History */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Transaction History</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance After</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {txData?.data?.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No transactions</td></tr>
                  ) : txData?.data?.map((tx: {
                    id: string; type: string; amount: number; balanceAfter: number;
                    description?: string; createdAt: string;
                  }) => (
                    <tr key={tx.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className={`badge ${
                          tx.type === 'LOAD' || tx.type === 'REFUND' ? 'bg-green-100 text-green-700'
                          : tx.type === 'REDEEM' ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-600'
                        }`}>
                          {tx.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium font-mono">
                        {['REDEEM', 'EXPIRY_FEE', 'TRANSFER_OUT'].includes(tx.type) ? '-' : '+'}
                        ${Number(tx.amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 font-mono">
                        ${Number(tx.balanceAfter).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 truncate max-w-[150px]">
                        {tx.description ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {format(new Date(tx.createdAt), 'MMM d, h:mm a')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
