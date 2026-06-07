import { useQuery } from '@tanstack/react-query';
import { api, formatCents, formatDate } from '@/lib/api';
import CardShell from '@/components/CardShell';

export default function BalancePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['ch', 'card'],
    queryFn: () => api.get<{ data: Record<string, unknown> }>('/card').then((r) => r.data.data),
  });

  return (
    <CardShell>
      <div className="mt-2">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Card Details</h2>
        {isLoading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>
        ) : data ? (
          <div className="card p-5 space-y-3 text-sm">
            {[
              ['Card Number', `•••• •••• •••• ${data['last4']}`],
              ['Type', String(data['cardType'] ?? '')],
              ['Status', String(data['status'] ?? '')],
              ['Currency', String(data['currency'] ?? '')],
              ['Recipient', data['recipientName'] ?? '—'],
              ['Email', data['recipientEmail'] ?? '—'],
              ['Expires', data['expiresAt'] ? formatDate(String(data['expiresAt'])) : '—'],
              ['KYC Status', String(data['kycStatus'] ?? '')],
              ['Issued', data['createdAt'] ? formatDate(String(data['createdAt'])) : '—'],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between">
                <span className="text-gray-500">{String(label)}</span>
                <span className="font-medium text-gray-900 text-right">{String(value)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400 text-sm">Unable to load card details</div>
        )}
      </div>
    </CardShell>
  );
}
