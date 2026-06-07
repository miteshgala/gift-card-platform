import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldX, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { api, formatDateTime } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { v4 as uuid } from 'uuid';

interface KycCheck {
  id: string;
  cardId: string;
  programId: string;
  checkType: string;
  provider: string;
  status: string;
  riskScore?: number;
  reasonCodes: string[];
  reviewNotes?: string;
  expiresAt?: string;
  createdAt: string;
  card?: {
    id: string;
    last4: string;
    recipientName?: string;
    recipientEmail?: string;
  };
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge-yellow',
  APPROVED: 'badge-green',
  REJECTED: 'badge-red',
  REQUIRES_REVIEW: 'badge-blue',
  EXPIRED: 'badge-gray',
};

const TYPE_LABEL: Record<string, string> = {
  IDENTITY: 'Identity',
  OFAC: 'OFAC Sanctions',
  ENHANCED_DUE_DILIGENCE: 'Enhanced DD',
};

const PROVIDER_LABEL: Record<string, string> = {
  INTERNAL: 'Internal',
  PERSONA: 'Persona',
  ALLOY: 'Alloy',
  LEXISNEXIS: 'LexisNexis',
};

function RiskScore({ score }: { score?: number }) {
  if (score == null) return <span className="text-gray-400">—</span>;
  const color =
    score >= 75 ? 'bg-red-100 text-red-700' :
    score >= 50 ? 'bg-yellow-100 text-yellow-700' :
    'bg-green-100 text-green-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
      {score}
    </span>
  );
}

interface ReviewModalProps {
  check: KycCheck;
  onClose: () => void;
  onSubmit: (data: { status: 'APPROVED' | 'REJECTED' | 'REQUIRES_REVIEW'; riskScore?: number; reviewNotes?: string }) => void;
  isPending: boolean;
}

function ReviewModal({ check, onClose, onSubmit, isPending }: ReviewModalProps) {
  const [status, setStatus] = useState<'APPROVED' | 'REJECTED' | 'REQUIRES_REVIEW'>('APPROVED');
  const [riskScore, setRiskScore] = useState<string>(check.riskScore?.toString() ?? '');
  const [reviewNotes, setReviewNotes] = useState(check.reviewNotes ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Review KYC Check</h2>
        <p className="mb-5 text-sm text-gray-500">
          {TYPE_LABEL[check.checkType] ?? check.checkType} · Card ···{check.card?.last4}
          {check.card?.recipientName && ` · ${check.card.recipientName}`}
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-700">Decision</label>
          <div className="flex gap-2">
            {(['APPROVED', 'REQUIRES_REVIEW', 'REJECTED'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                  status === s
                    ? s === 'APPROVED' ? 'border-green-500 bg-green-50 text-green-700'
                      : s === 'REJECTED' ? 'border-red-500 bg-red-50 text-red-700'
                      : 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {s === 'APPROVED' ? 'Approve' : s === 'REJECTED' ? 'Reject' : 'Flag'}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-700">Risk Score (0–100)</label>
          <input
            type="number"
            min={0}
            max={100}
            className="input w-full"
            placeholder="Leave blank to keep current"
            value={riskScore}
            onChange={(e) => setRiskScore(e.target.value)}
          />
        </div>

        <div className="mb-6">
          <label className="mb-1 block text-xs font-medium text-gray-700">Review Notes</label>
          <textarea
            rows={3}
            className="input w-full resize-none"
            placeholder="Optional notes for audit trail…"
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={onClose} disabled={isPending}>
            Cancel
          </button>
          <button
            className={`flex-1 btn-primary ${status === 'REJECTED' ? 'bg-red-600 hover:bg-red-700' : ''}`}
            disabled={isPending}
            onClick={() =>
              onSubmit({
                status,
                riskScore: riskScore ? Number(riskScore) : undefined,
                reviewNotes: reviewNotes || undefined,
              })
            }
          >
            {isPending ? 'Saving…' : 'Submit Decision'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ check, onReview }: { check: KycCheck; onReview: (c: KycCheck) => void }) {
  const [expanded, setExpanded] = useState(false);
  const canReview = check.status === 'PENDING' || check.status === 'REQUIRES_REVIEW';

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-6 py-3">
          <div className="font-medium text-gray-900 text-sm">
            ···{check.card?.last4 ?? check.cardId.slice(0, 8)}
          </div>
          {check.card?.recipientName && (
            <div className="text-xs text-gray-500">{check.card.recipientName}</div>
          )}
        </td>
        <td className="px-6 py-3 text-sm text-gray-700">
          {TYPE_LABEL[check.checkType] ?? check.checkType}
        </td>
        <td className="px-6 py-3 text-sm text-gray-600">
          {PROVIDER_LABEL[check.provider] ?? check.provider}
        </td>
        <td className="px-6 py-3">
          <span className={`badge ${STATUS_BADGE[check.status] ?? 'badge-gray'}`}>
            {check.status.replace('_', ' ')}
          </span>
        </td>
        <td className="px-6 py-3">
          <RiskScore score={check.riskScore} />
        </td>
        <td className="px-6 py-3 text-xs text-gray-500 whitespace-nowrap">
          {formatDateTime(check.createdAt)}
        </td>
        <td className="px-6 py-3">
          <div className="flex items-center gap-2">
            {canReview && (
              <button
                onClick={() => onReview(check)}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Review
              </button>
            )}
            {(check.reasonCodes.length > 0 || check.reviewNotes) && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-gray-400 hover:text-gray-600"
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50">
          <td colSpan={7} className="px-6 py-3">
            {check.reasonCodes.length > 0 && (
              <div className="mb-2">
                <span className="text-xs font-medium text-gray-500 mr-2">Reason codes:</span>
                {check.reasonCodes.map((rc) => (
                  <span key={rc} className="mr-1 inline-block rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">
                    {rc}
                  </span>
                ))}
              </div>
            )}
            {check.reviewNotes && (
              <p className="text-xs text-gray-600">
                <span className="font-medium text-gray-500">Notes: </span>
                {check.reviewNotes}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function KycPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [reviewing, setReviewing] = useState<KycCheck | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['kyc', statusFilter, typeFilter],
    queryFn: () =>
      api.get<{ data: KycCheck[] }>('/kyc', {
        params: {
          status: statusFilter || undefined,
          checkType: typeFilter || undefined,
          limit: 50,
        },
      }).then((r) => r.data.data),
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { status: string; riskScore?: number; reviewNotes?: string };
    }) =>
      api.patch(`/kyc/${id}/review`, body, {
        headers: { 'Idempotency-Key': uuid() },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kyc'] });
      setReviewing(null);
    },
  });

  const pendingCount = data?.filter((c) => c.status === 'PENDING' || c.status === 'REQUIRES_REVIEW').length ?? 0;

  return (
    <>
      {reviewing && (
        <ReviewModal
          check={reviewing}
          onClose={() => setReviewing(null)}
          isPending={reviewMutation.isPending}
          onSubmit={(body) => reviewMutation.mutate({ id: reviewing.id, body })}
        />
      )}

      <div className="p-6">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">KYC / KYB Checks</h1>
            <p className="text-sm text-gray-500">Identity verification and compliance reviews for high-value cards</p>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2">
              <ShieldX className="h-4 w-4 text-yellow-600" />
              <span className="text-sm font-medium text-yellow-800">
                {pendingCount} pending review{pendingCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="mb-4 flex gap-3">
          <select
            className="input w-44"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="REQUIRES_REVIEW">Requires Review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="EXPIRED">Expired</option>
          </select>
          <select
            className="input w-52"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All check types</option>
            <option value="IDENTITY">Identity</option>
            <option value="OFAC">OFAC Sanctions</option>
            <option value="ENHANCED_DUE_DILIGENCE">Enhanced Due Diligence</option>
          </select>
        </div>

        {/* Summary chips */}
        {data && (
          <div className="mb-4 flex gap-3 flex-wrap">
            {(['PENDING', 'REQUIRES_REVIEW', 'APPROVED', 'REJECTED'] as const).map((s) => {
              const count = data.filter((c) => c.status === s).length;
              if (count === 0) return null;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className={`badge ${STATUS_BADGE[s] ?? 'badge-gray'}`}>{count}</span>
                  {s.replace('_', ' ')}
                </button>
              );
            })}
          </div>
        )}

        <div className="card">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    <th className="px-6 py-3">Card</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Provider</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Risk Score</th>
                    <th className="px-6 py-3">Created</th>
                    <th className="px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data?.map((check) => (
                    <CheckRow key={check.id} check={check} onReview={setReviewing} />
                  ))}
                  {(!data || data.length === 0) && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center">
                        <Eye className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                        <p className="text-sm text-gray-400">No KYC checks found</p>
                      </td>
                    </tr>
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
