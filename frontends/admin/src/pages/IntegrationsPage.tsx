import { useQuery } from '@tanstack/react-query';
import { api, formatCents } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface HrRule {
  id: string;
  eventType: string;
  amountCents: string;
  cardType: string;
  enabled: boolean;
}

interface GlMapping {
  id: string;
  accountType: string;
  glAccountCode: string;
  glDescription: string;
  erpSystem: string;
}

const HR_EVENT_LABELS: Record<string, string> = {
  NEW_HIRE: '🎉 New Hire',
  WORK_ANNIVERSARY: '🎂 Work Anniversary',
  PERFORMANCE_AWARD: '🏆 Performance Award',
  BIRTHDAY: '🎁 Birthday',
  RETIREMENT: '👋 Retirement',
};

export default function IntegrationsPage() {
  const { data: hrRules, isLoading: hrLoading } = useQuery({
    queryKey: ['integrations', 'hr', 'rules'],
    queryFn: () => api.get<{ data: HrRule[] }>('/integrations/hr/rules').then((r) => r.data.data),
  });

  const { data: glMappings, isLoading: glLoading } = useQuery({
    queryKey: ['integrations', 'gl', 'mappings'],
    queryFn: () => api.get<{ data: GlMapping[] }>('/integrations/gl/mappings').then((r) => r.data.data),
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-500">HR events, GL mappings, and ERP configuration</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* HR Event Rules */}
        <div className="card">
          <div className="border-b px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">HR Event Rules</h2>
              <p className="text-xs text-gray-500">Auto-issue cards on HR lifecycle events</p>
            </div>
          </div>
          {hrLoading ? (
            <div className="flex h-32 items-center justify-center"><LoadingSpinner /></div>
          ) : (
            <ul className="divide-y">
              {hrRules?.map((rule) => (
                <li key={rule.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="font-medium text-gray-900 text-sm">{HR_EVENT_LABELS[rule.eventType] ?? rule.eventType}</div>
                    <div className="text-xs text-gray-500">{formatCents(rule.amountCents)} · {rule.cardType}</div>
                  </div>
                  <span className={`badge ${rule.enabled ? 'badge-green' : 'badge-gray'}`}>
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </li>
              ))}
              {(!hrRules || hrRules.length === 0) && (
                <li className="px-6 py-8 text-center text-sm text-gray-400">No HR rules configured</li>
              )}
            </ul>
          )}
        </div>

        {/* GL Mappings */}
        <div className="card">
          <div className="border-b px-6 py-4">
            <h2 className="font-semibold text-gray-900">GL / ERP Mappings</h2>
            <p className="text-xs text-gray-500">Account type → GL account code</p>
          </div>
          {glLoading ? (
            <div className="flex h-32 items-center justify-center"><LoadingSpinner /></div>
          ) : (
            <ul className="divide-y text-sm">
              {glMappings?.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-6 py-3">
                  <div>
                    <div className="font-medium text-gray-900">{m.accountType}</div>
                    <div className="text-xs text-gray-500">{m.glDescription}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xs text-brand-600">{m.glAccountCode}</div>
                    <div className="text-xs text-gray-400">{m.erpSystem}</div>
                  </div>
                </li>
              ))}
              {(!glMappings || glMappings.length === 0) && (
                <li className="px-6 py-8 text-center text-sm text-gray-400">No GL mappings configured</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
