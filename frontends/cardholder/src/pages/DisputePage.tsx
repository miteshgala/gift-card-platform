import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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

const REASON_LABELS: Record<string, string> = {
  UNAUTHORIZED: 'Unauthorized transaction',
  NOT_RECEIVED: 'Goods/services not received',
  DUPLICATE: 'Duplicate charge',
  WRONG_AMOUNT: 'Incorrect amount charged',
  OTHER: 'Other',
};

export default function DisputePage() {
  const [step, setStep] = useState<'select' | 'form' | 'success'>('select');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [reason, setReason] = useState('UNAUTHORIZED');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['ch', 'transactions', 'all'],
    queryFn: () =>
      api
        .get<{ data: Transaction[]; meta: { hasMore: boolean; nextCursor?: string } }>(
          '/transactions',
          { params: { limit: 50 } },
        )
        .then((r) => r.data),
  });

  // Only show debit transactions (purchases) that can be disputed
  const disputable = data?.data.filter(
    (tx) => tx.direction === 'DEBIT' && ['AUTH', 'CAPTURE'].includes(tx.entryType),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTx) return;
    setError('');
    setSubmitting(true);
    try {
      await api.post('/disputes', {
        transactionId: selectedTx.id,
        reason,
        description,
      });
      setStep('success');
    } catch {
      setError('Failed to submit dispute. Please try again or contact support.');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'success') {
    return (
      <CardShell>
        <div className="mt-2">
          <div className="card p-8 text-center space-y-3">
            <div className="mx-auto h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="h-7 w-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900">Dispute Submitted</h3>
            <p className="text-sm text-gray-500">
              We've received your dispute and will review it within 3–5 business days.
              You'll be notified of any updates.
            </p>
            <button
              className="btn-primary w-full mt-2"
              onClick={() => {
                setStep('select');
                setSelectedTx(null);
                setReason('UNAUTHORIZED');
                setDescription('');
              }}
            >
              Done
            </button>
          </div>
        </div>
      </CardShell>
    );
  }

  if (step === 'form' && selectedTx) {
    return (
      <CardShell>
        <div className="mt-2 space-y-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep('select')}
              className="text-gray-400 hover:text-gray-600 text-xs"
            >
              ← Back
            </button>
            <h2 className="text-sm font-semibold text-gray-700">Dispute Transaction</h2>
          </div>

          {/* Selected transaction summary */}
          <div className="card p-4 bg-gray-50">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium text-gray-900 text-sm">
                  {selectedTx.merchantName ?? selectedTx.description}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{formatDate(selectedTx.postedAt)}</div>
              </div>
              <div className="font-semibold text-sm text-gray-900">
                -{formatCents(selectedTx.amountCents)}
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="card p-5 space-y-4">
            {/* Reason */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Reason for dispute
              </label>
              <div className="space-y-2">
                {Object.entries(REASON_LABELS).map(([value, label]) => (
                  <label
                    key={value}
                    className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                      reason === value
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={value}
                      checked={reason === value}
                      onChange={() => setReason(value)}
                      className="accent-brand-600"
                    />
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Additional details{' '}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                rows={4}
                placeholder="Describe what happened…"
                className="input resize-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
              />
              <div className="text-right text-xs text-gray-400 mt-0.5">
                {description.length}/1000
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Submitting…' : 'Submit Dispute'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400">
            Disputes are typically resolved within 5–10 business days
          </p>
        </div>
      </CardShell>
    );
  }

  // Step: select transaction
  return (
    <CardShell>
      <div className="mt-2 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">File a Dispute</h2>
        <p className="text-xs text-gray-500">
          Select the transaction you'd like to dispute.
        </p>

        {isLoading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>
        ) : !disputable || disputable.length === 0 ? (
          <div className="card p-8 text-center text-gray-400 text-sm">
            No transactions available to dispute
          </div>
        ) : (
          <div className="space-y-2">
            {disputable.map((tx) => (
              <button
                key={tx.id}
                className="card p-4 w-full flex items-center gap-3 text-left hover:border-brand-300 transition-colors"
                onClick={() => {
                  setSelectedTx(tx);
                  setStep('form');
                }}
              >
                <div className="rounded-full bg-red-100 text-red-600 p-2 shrink-0">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 text-sm truncate">
                    {tx.merchantName ?? tx.description}
                  </div>
                  <div className="text-xs text-gray-400">{formatDate(tx.postedAt)}</div>
                </div>
                <div className="font-semibold text-sm text-gray-900 tabular-nums shrink-0">
                  -{formatCents(tx.amountCents)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </CardShell>
  );
}
