import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, formatCents, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { v4 as uuid } from 'uuid';

interface SettlementRun {
  id: string;
  programId: string;
  partyId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  grossRedemptions: string;
  feesWithheld: string;
  netPayable: string;
  currency: string;
  approvedAt?: string;
  paidAt?: string;
  party?: { id: string; name: string };
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge-gray',
  CALCULATING: 'badge-blue',
  READY: 'badge-yellow',
  APPROVED: 'badge-blue',
  PAID: 'badge-green',
  FAILED: 'badge-red',
};

export default function SettlementPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['settlement', 'runs'],
    queryFn: () => api.get<{ data: SettlementRun[] }>('/settlement/runs').then((r) => r.data.data),
  });

  const approve = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/settlement/runs/${id}/approve`, {}, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settlement', 'runs'] }),
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Settlement</h1>
        <p className="text-sm text-gray-500">Settlement runs and party payments</p>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center"><LoadingSpinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-6 py-3">Party</th>
                  <th className="px-6 py-3">Period</th>
                  <th className="px-6 py-3 text-right">Gross</th>
                  <th className="px-6 py-3 text-right">Fees</th>
                  <th className="px-6 py-3 text-right">Net Payable</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.map((run) => (
                  <tr key={run.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{run.party?.name ?? run.partyId.slice(0, 8)}</td>
                    <td className="px-6 py-4 text-gray-600 text-xs">
                      {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
                    </td>
                    <td className="px-6 py-4 text-right text-gray-700">{formatCents(run.grossRedemptions)}</td>
                    <td className="px-6 py-4 text-right text-red-600">-{formatCents(run.feesWithheld)}</td>
                    <td className="px-6 py-4 text-right font-semibold text-gray-900">{formatCents(run.netPayable)}</td>
                    <td className="px-6 py-4">
                      <span className={STATUS_BADGE[run.status] ?? 'badge-gray'}>{run.status}</span>
                    </td>
                    <td className="px-6 py-4">
                      {run.status === 'READY' && (
                        <button
                          onClick={() => approve.mutate(run.id)}
                          disabled={approve.isPending}
                          className="text-xs text-brand-600 hover:text-brand-800"
                        >
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(!data || data.length === 0) && (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No settlement runs found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
