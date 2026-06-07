import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, formatCents, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

export default function ProgramDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: program, isLoading } = useQuery({
    queryKey: ['programs', id],
    queryFn: () => api.get<{ data: Record<string, unknown> }>(`/programs/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });

  const { data: reconLogs } = useQuery({
    queryKey: ['programs', id, 'reconciliation'],
    queryFn: () => api.get<{ data: Array<{ id: string; asOf: string; status: string; variance: string; floatBalance: string; totalCardBalances: string }> }>(`/programs/${id}/reconciliation`).then((r) => r.data.data),
    enabled: !!id,
  });

  if (isLoading) return <div className="flex h-64 items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (!program) return <div className="p-6 text-center text-gray-500">Program not found</div>;

  return (
    <div className="p-6">
      <button onClick={() => navigate('/programs')} className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" />Back to Programs
      </button>

      <h1 className="mb-1 text-xl font-semibold text-gray-900">{String(program['name'] ?? '')}</h1>
      <p className="mb-6 text-sm text-gray-500 font-mono">{String(program['slug'] ?? '')}</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="mb-4 font-semibold text-gray-900">Configuration</h2>
          <dl className="space-y-3 text-sm">
            {Object.entries({
              Status: String(program['status'] ?? ''),
              Currency: String(program['currency'] ?? ''),
              'Card Expiry (days)': String(program['cardExpiryDays'] ?? ''),
              'Dormancy Fee': program['dormancyFeeCents'] ? formatCents(String(program['dormancyFeeCents'])) : '$0.00',
              'Dormancy Months': String(program['dormancyMonths'] ?? ''),
              'Budget Cap': program['budgetCap'] ? formatCents(String(program['budgetCap'])) : 'Unlimited',
              'Approval Threshold': program['approvalThreshold'] ? formatCents(String(program['approvalThreshold'])) : '—',
              'KYC Required Above': program['kycRequiredAbove'] ? formatCents(String(program['kycRequiredAbove'])) : 'Not required',
              Created: formatDate(String(program['createdAt'] ?? '')),
            }).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-gray-500">{k}</dt>
                <dd className="font-medium text-gray-900 text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card p-6">
          <h2 className="mb-4 font-semibold text-gray-900">Reconciliation History</h2>
          {reconLogs && reconLogs.length > 0 ? (
            <div className="space-y-2 text-sm">
              {reconLogs.slice(0, 10).map((log) => (
                <div key={log.id} className="flex items-center justify-between py-1">
                  <span className="text-gray-500">{formatDate(log.asOf)}</span>
                  <span className={`badge ${log.status === 'BALANCED' ? 'badge-green' : log.status === 'CRITICAL' ? 'badge-red' : 'badge-yellow'}`}>
                    {log.status}
                  </span>
                  <span className="font-mono text-xs text-gray-700">
                    Δ {formatCents(log.variance)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No reconciliation records yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
