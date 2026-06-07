import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PauseCircle, PlayCircle } from 'lucide-react';
import { api, formatCents, formatDateTime } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { v4 as uuid } from 'uuid';

interface CardDetail {
  id: string;
  last4: string;
  bin: string;
  cardType: string;
  status: string;
  currency: string;
  initialLoad: string;
  balanceCents?: string;
  expiresAt: string;
  activatedAt?: string;
  lastUsedAt?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  programId: string;
  kycStatus: string;
  createdAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'badge-green',
  PENDING_ACTIVATION: 'badge-yellow',
  SUSPENDED: 'badge-yellow',
  EXPIRED: 'badge-gray',
  CANCELLED: 'badge-red',
};

export default function CardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState('');

  const { data: card, isLoading } = useQuery({
    queryKey: ['cards', id],
    queryFn: () =>
      api.get<{ data: CardDetail }>(`/cards/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });

  const suspend = useMutation({
    mutationFn: (reason: string) =>
      api.patch(`/cards/${id}/suspend`, { reason }, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cards', id] }),
    onError: () => setActionError('Failed to suspend card'),
  });

  const unsuspend = useMutation({
    mutationFn: () =>
      api.patch(`/cards/${id}/unsuspend`, {}, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cards', id] }),
    onError: () => setActionError('Failed to unsuspend card'),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!card) {
    return (
      <div className="p-6 text-center text-gray-500">Card not found</div>
    );
  }

  return (
    <div className="p-6">
      {/* Back */}
      <button
        onClick={() => navigate('/cards')}
        className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Cards
      </button>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Card •••• {card.last4}
          </h1>
          <p className="text-sm text-gray-500">{card.id}</p>
        </div>
        <div className="flex gap-2">
          {card.status === 'ACTIVE' && (
            <button
              className="btn-secondary"
              onClick={() => suspend.mutate('Admin action')}
            >
              <PauseCircle className="h-4 w-4" />
              Suspend
            </button>
          )}
          {card.status === 'SUSPENDED' && (
            <button className="btn-secondary" onClick={() => unsuspend.mutate()}>
              <PlayCircle className="h-4 w-4" />
              Unsuspend
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Card Info */}
        <div className="card p-6">
          <h2 className="mb-4 font-semibold text-gray-900">Card Details</h2>
          <dl className="space-y-3 text-sm">
            {[
              ['Status', <span className={STATUS_BADGE[card.status] ?? 'badge-gray'}>{card.status.replace('_', ' ')}</span>],
              ['Type', card.cardType],
              ['BIN', card.bin],
              ['Currency', card.currency],
              ['Initial Load', formatCents(card.initialLoad)],
              ['Expires', formatDateTime(card.expiresAt)],
              ['Activated', card.activatedAt ? formatDateTime(card.activatedAt) : '—'],
              ['Last Used', card.lastUsedAt ? formatDateTime(card.lastUsedAt) : '—'],
              ['KYC Status', card.kycStatus],
              ['Issued', formatDateTime(card.createdAt)],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between">
                <dt className="text-gray-500">{label}</dt>
                <dd className="font-medium text-gray-900 text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Recipient Info */}
        <div className="card p-6">
          <h2 className="mb-4 font-semibold text-gray-900">Recipient</h2>
          <dl className="space-y-3 text-sm">
            {[
              ['Name', card.recipientName ?? '—'],
              ['Email', card.recipientEmail ?? '—'],
              ['Phone', card.recipientPhone ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <dt className="text-gray-500">{label}</dt>
                <dd className="font-medium text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
