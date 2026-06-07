import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatDateTime } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface AuditEntry {
  id: string;
  action: string;
  category: string;
  actorEmail?: string;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
  details: Record<string, unknown>;
  requestId?: string;
  createdAt: string;
}

const CATEGORY_BADGE: Record<string, string> = {
  USER: 'badge-blue',
  CARD: 'badge-green',
  LEDGER: 'badge-yellow',
  ORDER: 'badge-blue',
  FRAUD: 'badge-red',
  SYSTEM: 'badge-gray',
  AUTH: 'badge-gray',
};

export default function AuditLogPage() {
  const [category, setCategory] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', category, cursor],
    queryFn: () =>
      api.get<{ data: AuditEntry[]; meta: { hasMore: boolean; nextCursor?: string } }>('/audit-log', {
        params: { category: category || undefined, cursor, limit: 50 },
      }).then((r) => r.data),
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Audit Log</h1>
        <p className="text-sm text-gray-500">Immutable record of all platform actions</p>
      </div>

      <div className="mb-4">
        <select className="input w-48" value={category} onChange={(e) => { setCategory(e.target.value); setCursor(undefined); }}>
          <option value="">All categories</option>
          <option value="USER">User</option>
          <option value="CARD">Card</option>
          <option value="LEDGER">Ledger</option>
          <option value="ORDER">Order</option>
          <option value="FRAUD">Fraud</option>
          <option value="SYSTEM">System</option>
          <option value="AUTH">Auth</option>
        </select>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center"><LoadingSpinner /></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    <th className="px-6 py-3">Timestamp</th>
                    <th className="px-6 py-3">Action</th>
                    <th className="px-6 py-3">Category</th>
                    <th className="px-6 py-3">Actor</th>
                    <th className="px-6 py-3">Resource</th>
                    <th className="px-6 py-3">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y font-mono text-xs">
                  {data?.data.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                      <td className="px-6 py-3 font-medium text-gray-900">{log.action}</td>
                      <td className="px-6 py-3">
                        <span className={CATEGORY_BADGE[log.category] ?? 'badge-gray'}>{log.category}</span>
                      </td>
                      <td className="px-6 py-3 text-gray-600">{log.actorEmail ?? '—'}</td>
                      <td className="px-6 py-3 text-gray-500">
                        {log.resourceId ? log.resourceId.slice(0, 8) + '…' : '—'}
                      </td>
                      <td className="px-6 py-3 text-gray-500">{log.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                  {(!data?.data || data.data.length === 0) && (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-400">No audit log entries</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {data?.meta.hasMore && (
              <div className="border-t px-6 py-3 text-center">
                <button
                  className="btn-secondary text-xs"
                  onClick={() => setCursor(data.meta.nextCursor)}
                >
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
