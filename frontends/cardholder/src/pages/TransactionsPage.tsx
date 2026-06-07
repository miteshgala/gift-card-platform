import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { api, formatCents, formatDate } from '@/lib/api';
import CardShell from '@/components/CardShell';

interface Transaction {
  id: string;
  entryType: string;
  description: string;
  direction: string;
  amountCents: string;
  currency: string;
  merchantName?: string;
  postedAt: string;
}

const ENTRY_LABEL: Record<string, string> = {
  LOAD: 'Initial Load',
  RELOAD: 'Reload',
  AUTH: 'Authorization',
  CAPTURE: 'Purchase',
  REVERSAL: 'Reversal',
  VOID: 'Void',
  FEE: 'Dormancy Fee',
  DISPUTE_CREDIT: 'Dispute Credit',
  DISPUTE_REVERSAL: 'Dispute Reversal',
  ADJUSTMENT: 'Adjustment',
};

export default function TransactionsPage() {
  const [cursor, setCursor] = useState<string | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['ch', 'transactions', cursor],
    queryFn: () =>
      api.get<{ data: Transaction[]; meta: { hasMore: boolean; nextCursor?: string } }>('/transactions', {
        params: { limit: 20, cursor },
      }).then((r) => r.data),
  });

  return (
    <CardShell>
      <div className="mt-2">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Transaction History</h2>

        {isLoading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>
        ) : (
          <div className="space-y-2">
            {data?.data.map((tx) => (
              <div key={tx.id} className="card p-4 flex items-center gap-3">
                <div className={`rounded-full p-2 ${tx.direction === 'CREDIT' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                  {tx.direction === 'CREDIT'
                    ? <ArrowDownLeft className="h-4 w-4" />
                    : <ArrowUpRight className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 text-sm truncate">
                    {tx.merchantName ?? ENTRY_LABEL[tx.entryType] ?? tx.entryType}
                  </div>
                  <div className="text-xs text-gray-400">{formatDate(tx.postedAt)}</div>
                </div>
                <div className={`font-semibold text-sm tabular-nums ${tx.direction === 'CREDIT' ? 'text-green-600' : 'text-gray-900'}`}>
                  {tx.direction === 'CREDIT' ? '+' : '-'}{formatCents(tx.amountCents)}
                </div>
              </div>
            ))}

            {(!data?.data || data.data.length === 0) && (
              <div className="card p-8 text-center text-gray-400 text-sm">No transactions yet</div>
            )}

            {data?.meta.hasMore && (
              <button
                className="w-full py-3 text-sm text-brand-600 font-medium hover:text-brand-800"
                onClick={() => setCursor(data.meta.nextCursor)}
              >
                Load more
              </button>
            )}
          </div>
        )}
      </div>
    </CardShell>
  );
}
