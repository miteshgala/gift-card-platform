import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldX, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { api, getErrorMessage } from '../../lib/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  PENDING:  { label: 'Pending',  cls: 'bg-yellow-100 text-yellow-700', icon: Clock },
  APPROVED: { label: 'Approved', cls: 'bg-green-100 text-green-700',  icon: CheckCircle },
  REJECTED: { label: 'Rejected', cls: 'bg-red-100 text-red-700',      icon: XCircle },
  EXPIRED:  { label: 'Expired',  cls: 'bg-gray-100 text-gray-500',    icon: AlertTriangle },
};

interface KycCheck {
  id: string;
  cardId: string;
  recipientEmail: string | null;
  amount: number;
  status: string;
  providerRef: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  card: {
    cardNumberMasked: string;
    status: string;
    initialBalance: number;
    currency: string;
  };
}

interface RejectModalProps {
  cardId: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}

function RejectModal({ cardId, onClose, onConfirm, isPending }: RejectModalProps) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Reject KYC Check</h2>
        <p className="text-sm text-gray-500 mb-4">Card: <span className="font-mono">{cardId}</span></p>
        <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
        <textarea
          className="input w-full h-24 resize-none"
          placeholder="Provide a reason for rejection..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => onConfirm(reason || 'Manual rejection by admin')}
            disabled={isPending}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isPending ? 'Rejecting…' : 'Reject Card'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KycPage() {
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['kyc', statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) params.append('status', statusFilter);
      const res = await api.get(`/kyc?${params}`);
      return res.data;
    },
  });

  const approve = useMutation({
    mutationFn: (cardId: string) => api.post(`/kyc/${cardId}/approve`),
    onSuccess: () => {
      toast.success('KYC approved — card activated');
      qc.invalidateQueries({ queryKey: ['kyc'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const reject = useMutation({
    mutationFn: ({ cardId, reason }: { cardId: string; reason: string }) =>
      api.post(`/kyc/${cardId}/reject`, { reason }),
    onSuccess: () => {
      toast.success('KYC rejected — card cancelled');
      setRejectTarget(null);
      qc.invalidateQueries({ queryKey: ['kyc'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const checks: KycCheck[] = data?.data ?? [];
  const meta = data?.meta;

  const pendingCount = statusFilter === 'PENDING' ? meta?.total : undefined;

  return (
    <div className="space-y-5">
      {rejectTarget && (
        <RejectModal
          cardId={rejectTarget}
          isPending={reject.isPending}
          onClose={() => setRejectTarget(null)}
          onConfirm={(reason) => reject.mutate({ cardId: rejectTarget, reason })}
        />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">KYC Queue</h1>
          {pendingCount !== undefined && pendingCount > 0 && (
            <span className="bg-yellow-100 text-yellow-700 text-xs font-bold px-2.5 py-1 rounded-full">
              {pendingCount} pending
            </span>
          )}
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {Object.entries(STATUS_CONFIG).map(([key, { label }]) => (
          <button
            key={key}
            onClick={() => { setStatusFilter(key); setPage(1); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              statusFilter === key
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => { setStatusFilter(''); setPage(1); }}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            statusFilter === ''
              ? 'bg-white shadow-sm text-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          All
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Card</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Recipient</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Amount</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Submitted</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Reviewed</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading…</td>
                </tr>
              ) : checks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    No {statusFilter.toLowerCase()} KYC checks found
                  </td>
                </tr>
              ) : checks.map((check) => {
                const cfg = STATUS_CONFIG[check.status] ?? STATUS_CONFIG['PENDING'];
                const Icon = cfg.icon;
                return (
                  <tr key={check.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono font-medium text-gray-900">{check.card.cardNumberMasked}</p>
                      <p className="text-gray-400 text-xs">{check.cardId.slice(0, 12)}…</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {check.recipientEmail ?? <span className="text-gray-300 italic">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {Number(check.amount).toLocaleString(undefined, { style: 'currency', currency: check.card.currency ?? 'USD' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.cls}`}>
                        <Icon className="w-3.5 h-3.5" />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {format(new Date(check.createdAt), 'MMM d, yyyy HH:mm')}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {check.reviewedAt
                        ? format(new Date(check.reviewedAt), 'MMM d, yyyy HH:mm')
                        : <span className="text-gray-300">—</span>}
                      {check.rejectionReason && (
                        <p className="text-red-400 mt-0.5 max-w-[160px] truncate" title={check.rejectionReason}>
                          {check.rejectionReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {check.status === 'PENDING' && (
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => { if (confirm('Approve this KYC check and activate the card?')) approve.mutate(check.cardId); }}
                            disabled={approve.isPending}
                            title="Approve"
                            className="p-1.5 rounded-lg bg-green-50 hover:bg-green-100 text-green-600 transition-colors disabled:opacity-40"
                          >
                            <ShieldCheck className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setRejectTarget(check.cardId)}
                            title="Reject"
                            className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition-colors"
                          >
                            <ShieldX className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-sm text-gray-500">
              Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, meta.total)} of {meta.total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={!meta.hasPrev}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!meta.hasNext}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
