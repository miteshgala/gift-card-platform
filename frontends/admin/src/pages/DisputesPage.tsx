import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, formatCents, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { v4 as uuid } from 'uuid';

interface Dispute {
  id: string;
  cardId: string;
  programId: string;
  disputeType: string;
  status: string;
  amount: string;
  currency: string;
  description: string;
  createdAt: string;
  card?: { id: string; last4: string; recipientName?: string };
}

const STATUS_BADGE: Record<string, string> = {
  SUBMITTED: 'badge-yellow',
  UNDER_REVIEW: 'badge-blue',
  PROVISIONAL_CREDIT_ISSUED: 'badge-blue',
  WON: 'badge-green',
  LOST: 'badge-red',
  WITHDRAWN: 'badge-gray',
};

interface ResolveModalProps {
  dispute: Dispute;
  onClose: () => void;
  onSubmit: (outcome: 'WON' | 'LOST' | 'WITHDRAWN', resolution: string, reclaim: boolean) => void;
  isPending: boolean;
}

function ResolveModal({ dispute, onClose, onSubmit, isPending }: ResolveModalProps) {
  const [outcome, setOutcome] = useState<'WON' | 'LOST' | 'WITHDRAWN'>('WON');
  const [resolution, setResolution] = useState('');
  const [reclaim, setReclaim] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Resolve Dispute</h2>
        <p className="mb-5 text-sm text-gray-500">
          Card ···{dispute.card?.last4} · {formatCents(dispute.amount)} ·{' '}
          {dispute.disputeType.replace('_', ' ')}
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-700">Outcome</label>
          <div className="flex gap-2">
            {(['WON', 'LOST', 'WITHDRAWN'] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOutcome(o)}
                className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                  outcome === o
                    ? o === 'WON' ? 'border-green-500 bg-green-50 text-green-700'
                      : o === 'LOST' ? 'border-red-500 bg-red-50 text-red-700'
                      : 'border-gray-500 bg-gray-50 text-gray-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Resolution Notes <span className="text-gray-400">(min 10 chars)</span>
          </label>
          <textarea
            rows={3}
            className="input w-full resize-none"
            placeholder="Describe the resolution decision…"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          />
        </div>

        {dispute.status === 'PROVISIONAL_CREDIT_ISSUED' && outcome === 'LOST' && (
          <div className="mb-4 flex items-center gap-2">
            <input
              id="reclaim"
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              checked={reclaim}
              onChange={(e) => setReclaim(e.target.checked)}
            />
            <label htmlFor="reclaim" className="text-sm text-gray-700">
              Reclaim provisional credit
            </label>
          </div>
        )}

        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={onClose} disabled={isPending}>
            Cancel
          </button>
          <button
            className="btn-primary flex-1"
            disabled={isPending || resolution.length < 10}
            onClick={() => onSubmit(outcome, resolution, reclaim)}
          >
            {isPending ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DisputesPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Dispute | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['disputes', statusFilter],
    queryFn: () =>
      api.get<{ data: Dispute[] }>('/disputes', { params: { status: statusFilter || undefined, limit: 50 } }).then((r) => r.data.data),
  });

  const issueCredit = useMutation({
    mutationFn: (id: string) =>
      api.post(`/disputes/${id}/provisional-credit`, {}, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['disputes'] }),
  });

  const resolve = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { outcome: string; resolution: string; reclaimProvisionalCredit: boolean } }) =>
      api.patch(`/disputes/${id}/resolve`, body, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['disputes'] });
      setSelected(null);
    },
  });

  return (
    <>
      {selected && (
        <ResolveModal
          dispute={selected}
          onClose={() => setSelected(null)}
          isPending={resolve.isPending}
          onSubmit={(outcome, resolution, reclaimProvisionalCredit) =>
            resolve.mutate({ id: selected.id, body: { outcome, resolution, reclaimProvisionalCredit } })
          }
        />
      )}

      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Disputes</h1>
          <p className="text-sm text-gray-500">Cardholder dispute management</p>
        </div>

        <div className="mb-4">
          <select className="input w-48" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="UNDER_REVIEW">Under Review</option>
            <option value="PROVISIONAL_CREDIT_ISSUED">Credit Issued</option>
            <option value="WON">Won</option>
            <option value="LOST">Lost</option>
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
                    <th className="px-6 py-3">Card</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3 text-right">Amount</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Filed</th>
                    <th className="px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data?.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="font-mono font-medium text-gray-900">
                          {d.card ? `•••• ${d.card.last4}` : d.cardId.slice(0, 8)}
                        </div>
                        {d.card?.recipientName && <div className="text-xs text-gray-500">{d.card.recipientName}</div>}
                      </td>
                      <td className="px-6 py-4 text-gray-600 text-xs">{d.disputeType.replace('_', ' ')}</td>
                      <td className="px-6 py-4 text-right font-medium text-gray-900">{formatCents(d.amount)}</td>
                      <td className="px-6 py-4">
                        <span className={STATUS_BADGE[d.status] ?? 'badge-gray'}>{d.status.replace('_', ' ')}</span>
                      </td>
                      <td className="px-6 py-4 text-gray-600">{formatDate(d.createdAt)}</td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          {d.status === 'SUBMITTED' && (
                            <button
                              onClick={() => issueCredit.mutate(d.id)}
                              disabled={issueCredit.isPending}
                              className="text-xs text-brand-600 hover:text-brand-800"
                            >
                              Issue Credit
                            </button>
                          )}
                          {['SUBMITTED', 'UNDER_REVIEW', 'PROVISIONAL_CREDIT_ISSUED'].includes(d.status) && (
                            <button
                              onClick={() => setSelected(d)}
                              className="text-xs text-gray-600 hover:text-gray-800"
                            >
                              Resolve
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(!data || data.length === 0) && (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-400">No disputes found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
