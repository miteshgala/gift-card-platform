import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, CheckCircle } from 'lucide-react';
import { api, getErrorMessage } from '../../lib/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const SEVERITY_COLORS: Record<string, string> = {
  LOW: 'bg-blue-100 text-blue-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-orange-100 text-orange-700',
  CRITICAL: 'bg-red-100 text-red-700',
};

export default function FraudPage() {
  const [resolved, setResolved] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['fraud', 'flags', resolved],
    queryFn: async () => {
      const res = await api.get(`/fraud/flags?resolved=${resolved}&limit=50`);
      return res.data;
    },
  });

  const resolve = useMutation({
    mutationFn: (flagId: string) =>
      api.post(`/fraud/flags/${flagId}/resolve`, { resolution: 'Reviewed and dismissed by admin' }),
    onSuccess: () => { toast.success('Flag resolved'); qc.invalidateQueries({ queryKey: ['fraud'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const flags = data?.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900">Fraud Management</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setResolved(false)} className={resolved ? 'btn-secondary' : 'btn-primary'}>
            Open ({!resolved ? flags.length : '?'})
          </button>
          <button onClick={() => setResolved(true)} className={resolved ? 'btn-primary' : 'btn-secondary'}>
            Resolved
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Severity</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Card</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Flagged</th>
              {resolved && <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resolution</th>}
              {!resolved && <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : flags.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                {resolved ? 'No resolved flags' : 'No open fraud flags — great news!'}
              </td></tr>
            ) : flags.map((flag: {
              id: string; severity: string; reason: string;
              card?: { cardNumberMasked?: string }; createdAt: string; resolution?: string;
            }) => (
              <tr key={flag.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <span className={`badge ${SEVERITY_COLORS[flag.severity]}`}>{flag.severity}</span>
                </td>
                <td className="px-4 py-3 font-medium max-w-[300px] truncate">{flag.reason}</td>
                <td className="px-4 py-3 font-mono text-gray-500">{flag.card?.cardNumberMasked ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {format(new Date(flag.createdAt), 'MMM d, h:mm a')}
                </td>
                {resolved && <td className="px-4 py-3 text-gray-500 text-sm">{flag.resolution ?? '—'}</td>}
                {!resolved && (
                  <td className="px-4 py-3">
                    <button
                      onClick={() => resolve.mutate(flag.id)}
                      className="flex items-center gap-1.5 text-green-600 hover:text-green-700 text-sm"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Resolve
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
