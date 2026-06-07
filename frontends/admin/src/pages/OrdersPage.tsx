import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, CheckCircle } from 'lucide-react';
import { api, formatCents, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { v4 as uuid } from 'uuid';

interface Order {
  id: string;
  programId: string;
  status: string;
  totalCards: number;
  processedCards: number;
  failedCards: number;
  totalAmountCents: string;
  currency: string;
  createdAt: string;
  approvedAt?: string;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge-gray',
  PENDING_APPROVAL: 'badge-yellow',
  PROCESSING: 'badge-blue',
  COMPLETED: 'badge-green',
  FAILED: 'badge-red',
  CANCELLED: 'badge-gray',
};

export default function OrdersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['orders', status],
    queryFn: () =>
      api.get<{ data: Order[] }>('/orders', { params: { status: status || undefined, limit: 50 } }).then((r) => r.data.data),
  });

  const approve = useMutation({
    mutationFn: (orderId: string) =>
      api.post(`/orders/${orderId}/approve`, {}, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orders'] }),
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Orders</h1>
          <p className="text-sm text-gray-500">Bulk card issuance orders</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/orders/new')}>
          <Plus className="h-4 w-4" />
          New Order
        </button>
      </div>

      <div className="mb-4">
        <select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="PENDING_APPROVAL">Pending Approval</option>
          <option value="PROCESSING">Processing</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center"><LoadingSpinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-6 py-3">Order ID</th>
                  <th className="px-6 py-3 text-right">Cards</th>
                  <th className="px-6 py-3 text-right">Total Value</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Progress</th>
                  <th className="px-6 py-3">Created</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <button
                        className="font-mono text-brand-600 hover:underline text-xs"
                        onClick={() => navigate(`/orders/${order.id}`)}
                      >
                        {order.id.slice(0, 8)}…
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right text-gray-700">{order.totalCards.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right font-medium text-gray-900">
                      {formatCents(order.totalAmountCents)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={STATUS_BADGE[order.status] ?? 'badge-gray'}>
                        {order.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600 text-xs">
                      {order.status === 'PROCESSING' || order.status === 'COMPLETED'
                        ? `${order.processedCards}/${order.totalCards}`
                        : '—'}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{formatDate(order.createdAt)}</td>
                    <td className="px-4 py-4">
                      {order.status === 'PENDING_APPROVAL' && (
                        <button
                          className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800"
                          onClick={() => approve.mutate(order.id)}
                          disabled={approve.isPending}
                        >
                          <CheckCircle className="h-4 w-4" />
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(!data || data.length === 0) && (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No orders found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
