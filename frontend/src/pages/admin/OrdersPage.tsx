import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Upload, Loader2, CheckCircle, Clock, XCircle } from 'lucide-react';
import { api, getErrorMessage } from '../../lib/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const schema = z.object({
  programId: z.string().min(1, 'Program required'),
  quantity: z.coerce.number().int().positive('Must be positive'),
  denomination: z.coerce.number().positive('Amount required'),
  cardType: z.enum(['DIGITAL', 'PHYSICAL']),
  currency: z.string().length(3),
});
type FormData = z.infer<typeof schema>;

const STATUS_ICONS: Record<string, React.ElementType> = {
  COMPLETED: CheckCircle,
  FAILED: XCircle,
  PROCESSING: Loader2,
  PENDING_APPROVAL: Clock,
  APPROVED: Clock,
};

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'text-green-600',
  FAILED: 'text-red-600',
  PROCESSING: 'text-blue-600',
  PENDING_APPROVAL: 'text-amber-600',
  APPROVED: 'text-purple-600',
};

export default function OrdersPage() {
  const [showForm, setShowForm] = useState(false);
  const qc = useQueryClient();

  const { data: programs } = useQuery({
    queryKey: ['programs'],
    queryFn: async () => (await api.get('/programs')).data.data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => (await api.get('/orders?limit=20')).data,
    refetchInterval: 5000, // poll for status updates
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { cardType: 'DIGITAL', currency: 'USD' },
  });

  const createOrder = useMutation({
    mutationFn: (data: FormData) => api.post('/orders', data),
    onSuccess: () => {
      toast.success('Order created and processing started');
      qc.invalidateQueries({ queryKey: ['orders'] });
      setShowForm(false);
      reset();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const approveOrder = useMutation({
    mutationFn: (orderId: string) => api.post(`/orders/${orderId}/approve`),
    onSuccess: () => { toast.success('Order approved'); qc.invalidateQueries({ queryKey: ['orders'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const orders = data?.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus className="w-4 h-4" />
          New Order
        </button>
      </div>

      {/* New Order Form */}
      {showForm && (
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Create Bulk Order</h2>
          <form onSubmit={handleSubmit((d) => createOrder.mutate(d))} className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Program</label>
              <select {...register('programId')} className="input">
                <option value="">Select program</option>
                {programs?.map((p: { id: string; name: string }) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {errors.programId && <p className="text-red-500 text-xs mt-1">{errors.programId.message}</p>}
            </div>
            <div>
              <label className="label">Quantity</label>
              <input {...register('quantity')} type="number" className="input" placeholder="100" />
              {errors.quantity && <p className="text-red-500 text-xs mt-1">{errors.quantity.message}</p>}
            </div>
            <div>
              <label className="label">Denomination ($)</label>
              <input {...register('denomination')} type="number" step="0.01" className="input" placeholder="50.00" />
              {errors.denomination && <p className="text-red-500 text-xs mt-1">{errors.denomination.message}</p>}
            </div>
            <div>
              <label className="label">Card Type</label>
              <select {...register('cardType')} className="input">
                <option value="DIGITAL">Digital (eGift)</option>
                <option value="PHYSICAL">Physical</option>
              </select>
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={createOrder.isPending} className="btn-primary">
                {createOrder.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Order
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Orders Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total Value</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Progress</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No orders yet</td></tr>
            ) : orders.map((order: {
              id: string; status: string; cardType: string; quantity: number;
              totalValue: number; currency: string; jobProgress: number; createdAt: string;
            }) => {
              const StatusIcon = STATUS_ICONS[order.status] ?? Clock;
              return (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{order.id.slice(-8).toUpperCase()}</td>
                  <td className="px-4 py-3">
                    <div className={`flex items-center gap-1.5 ${STATUS_COLORS[order.status] ?? 'text-gray-500'}`}>
                      <StatusIcon className={`w-4 h-4 ${order.status === 'PROCESSING' ? 'animate-spin' : ''}`} />
                      <span className="text-sm">{order.status.replace('_', ' ')}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{order.cardType}</td>
                  <td className="px-4 py-3 text-right">{order.quantity}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    ${Number(order.totalValue).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-brand-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${order.jobProgress}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{order.jobProgress}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {format(new Date(order.createdAt), 'MMM d, h:mm a')}
                  </td>
                  <td className="px-4 py-3">
                    {order.status === 'PENDING_APPROVAL' && (
                      <button
                        onClick={() => approveOrder.mutate(order.id)}
                        className="btn-primary text-xs px-3 py-1"
                      >
                        Approve
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
