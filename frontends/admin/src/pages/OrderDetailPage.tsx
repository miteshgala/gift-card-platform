import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, formatCents } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const STATUS_BADGE: Record<string, string> = {
  ISSUED: 'badge-green',
  PENDING: 'badge-gray',
  FAILED: 'badge-red',
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: order, isLoading } = useQuery({
    queryKey: ['orders', id],
    queryFn: () =>
      api.get<{ data: { id: string; status: string; totalCards: number; processedCards: number; failedCards: number; totalAmountCents: string; currency: string; createdAt: string; approvedAt?: string; errorMessage?: string; lineItems: Array<{ id: string; recipientName?: string; recipientEmail?: string; amountCents: string; cardType: string; status: string; cardId?: string; errorMessage?: string }> } }>(`/orders/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });

  if (isLoading) return <div className="flex h-64 items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (!order) return <div className="p-6 text-center text-gray-500">Order not found</div>;

  return (
    <div className="p-6">
      <button onClick={() => navigate('/orders')} className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" />Back to Orders
      </button>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Order Details</h1>
          <p className="font-mono text-xs text-gray-400">{order.id}</p>
        </div>
        <span className={`badge ${order.status === 'COMPLETED' ? 'badge-green' : order.status === 'FAILED' ? 'badge-red' : 'badge-yellow'}`}>
          {order.status}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['Total Cards', order.totalCards.toLocaleString()],
          ['Processed', order.processedCards.toLocaleString()],
          ['Failed', order.failedCards.toLocaleString()],
          ['Total Value', formatCents(order.totalAmountCents)],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      {order.errorMessage && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{order.errorMessage}</div>
      )}

      <div className="card">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900">Line Items (first 100)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-6 py-3">Recipient</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3 text-right">Amount</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Card ID</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {order.lineItems.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <div>{item.recipientName ?? '—'}</div>
                    {item.recipientEmail && <div className="text-xs text-gray-400">{item.recipientEmail}</div>}
                  </td>
                  <td className="px-6 py-3 text-gray-600">{item.cardType}</td>
                  <td className="px-6 py-3 text-right font-medium">{formatCents(item.amountCents)}</td>
                  <td className="px-6 py-3">
                    <span className={STATUS_BADGE[item.status] ?? 'badge-gray'}>{item.status}</span>
                    {item.errorMessage && <div className="text-xs text-red-500 mt-0.5">{item.errorMessage}</div>}
                  </td>
                  <td className="px-6 py-3 font-mono text-xs text-gray-400">{item.cardId ? item.cardId.slice(0, 8) + '…' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
