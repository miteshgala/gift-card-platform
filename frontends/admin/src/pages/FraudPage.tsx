import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, CheckCircle } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { v4 as uuid } from 'uuid';

interface FraudFlag {
  id: string;
  cardId?: string;
  programId: string;
  source: string;
  severity: string;
  reasonCode: string;
  reasonText: string;
  score?: number;
  status: string;
  createdAt: string;
  card?: { id: string; last4: string };
}

const SEVERITY_BADGE: Record<string, string> = {
  LOW: 'badge-gray',
  MEDIUM: 'badge-yellow',
  HIGH: 'badge-red',
  CRITICAL: 'badge-red',
};

export default function FraudPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('OPEN');
  const [resolving, setResolving] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['fraud', 'flags', statusFilter],
    queryFn: () =>
      api.get<{ data: FraudFlag[] }>('/fraud/flags', { params: { status: statusFilter, limit: 50 } }).then((r) => r.data.data),
  });

  const resolve = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: string; note: string }) =>
      api.patch(`/fraud/flags/${id}/resolve`, { status, resolutionNote: note }, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fraud', 'flags'] });
      setResolving(null);
    },
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Fraud Management</h1>
          <p className="text-sm text-gray-500">Review and resolve fraud flags</p>
        </div>
        <Shield className="h-6 w-6 text-brand-600" />
      </div>

      <div className="mb-4 flex gap-3">
        {['OPEN', 'RESOLVED', 'FALSE_POSITIVE'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === s ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50'
            }`}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
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
                  <th className="px-6 py-3">Source</th>
                  <th className="px-6 py-3">Severity</th>
                  <th className="px-6 py-3">Reason</th>
                  <th className="px-6 py-3 text-right">Score</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.map((flag) => (
                  <tr key={flag.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-mono text-gray-900">
                      {flag.card ? `•••• ${flag.card.last4}` : '—'}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{flag.source}</td>
                    <td className="px-6 py-4">
                      <span className={SEVERITY_BADGE[flag.severity] ?? 'badge-gray'}>
                        {flag.severity}
                      </span>
                    </td>
                    <td className="px-6 py-4 max-w-xs">
                      <div className="font-medium text-gray-900 text-xs">{flag.reasonCode}</div>
                      <div className="text-xs text-gray-500 truncate">{flag.reasonText}</div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-gray-700">{flag.score ?? '—'}</td>
                    <td className="px-6 py-4 text-gray-600">{formatDate(flag.createdAt)}</td>
                    <td className="px-6 py-4">
                      {flag.status === 'OPEN' && (
                        <button
                          onClick={() => setResolving(flag.id)}
                          className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(!data || data.length === 0) && (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No fraud flags found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Resolve modal */}
      {resolving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="card w-full max-w-md p-6">
            <h2 className="mb-4 font-semibold text-gray-900">Resolve Fraud Flag</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.target as HTMLFormElement);
                resolve.mutate({
                  id: resolving,
                  status: fd.get('status') as string,
                  note: fd.get('note') as string,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="label">Resolution</label>
                <select name="status" className="input">
                  <option value="RESOLVED">Resolved — legitimate activity</option>
                  <option value="FALSE_POSITIVE">False positive</option>
                </select>
              </div>
              <div>
                <label className="label">Notes (required, min 10 chars)</label>
                <textarea name="note" className="input" rows={3} minLength={10} required placeholder="Describe your resolution…" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setResolving(null)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={resolve.isPending}>Resolve</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
