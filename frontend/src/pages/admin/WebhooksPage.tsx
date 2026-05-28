import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Webhook, Plus, Trash2, ChevronDown, ChevronRight,
  CheckCircle, XCircle, Clock, RefreshCw,
} from 'lucide-react';
import { api, getErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const ALL_EVENTS = [
  'CARD_ISSUED', 'CARD_ACTIVATED', 'CARD_FROZEN', 'CARD_CANCELLED',
  'BALANCE_LOADED', 'BALANCE_REDEEMED', 'BALANCE_TRANSFERRED',
  'BALANCE_LOW', 'CARD_EXPIRING_SOON', 'CARD_EXPIRED',
  'ORDER_COMPLETED', 'ORDER_FAILED',
  'FRAUD_FLAGGED',
  'KYC_APPROVED', 'KYC_REJECTED',
];

const DELIVERY_STATUS: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  PENDING:   { label: 'Pending',   cls: 'bg-yellow-100 text-yellow-700', icon: Clock },
  SUCCESS:   { label: 'Success',   cls: 'bg-green-100 text-green-700',   icon: CheckCircle },
  FAILED:    { label: 'Failed',    cls: 'bg-red-100 text-red-700',       icon: XCircle },
  RETRYING:  { label: 'Retrying',  cls: 'bg-blue-100 text-blue-700',     icon: RefreshCw },
  ABANDONED: { label: 'Abandoned', cls: 'bg-gray-100 text-gray-500',     icon: XCircle },
};

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

interface Delivery {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  errorMessage: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
}

function CreateEndpointModal({
  programId,
  onClose,
}: {
  programId: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<string[]>(['CARD_ISSUED', 'BALANCE_REDEEMED']);
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: () => api.post('/integrations/endpoints', { programId, url, events, description: description || undefined }),
    onSuccess: () => {
      toast.success('Webhook endpoint created');
      qc.invalidateQueries({ queryKey: ['webhook-endpoints'] });
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const toggleEvent = (evt: string) => {
    setEvents((prev) => prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">New Webhook Endpoint</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL <span className="text-red-500">*</span></label>
            <input
              className="input w-full"
              type="url"
              placeholder="https://example.com/webhooks/giftcard"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              className="input w-full"
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Events <span className="text-xs text-gray-400">({events.length} selected)</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {ALL_EVENTS.map((evt) => (
                <label key={evt} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={events.includes(evt)}
                    onChange={() => toggleEvent(evt)}
                    className="accent-brand-500"
                  />
                  <span className="text-xs font-mono text-gray-700">{evt}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => create.mutate()}
            disabled={!url || events.length === 0 || create.isPending}
            className="btn-primary disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create Endpoint'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeliveryLog({ endpointId }: { endpointId: string }) {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['webhook-deliveries', endpointId, page],
    queryFn: async () => (await api.get(`/integrations/endpoints/${endpointId}/deliveries?page=${page}&limit=10`)).data,
  });

  const deliveries: Delivery[] = data?.data ?? [];
  const meta = data?.meta;

  if (isLoading) return <p className="text-gray-400 text-sm px-4 py-3">Loading deliveries…</p>;
  if (deliveries.length === 0) return <p className="text-gray-400 text-sm px-4 py-3">No deliveries yet</p>;

  return (
    <div className="border-t border-gray-100">
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left px-4 py-2 font-medium text-gray-400">Event</th>
            <th className="text-center px-3 py-2 font-medium text-gray-400">Status</th>
            <th className="text-center px-3 py-2 font-medium text-gray-400">Attempts</th>
            <th className="text-center px-3 py-2 font-medium text-gray-400">HTTP</th>
            <th className="text-left px-3 py-2 font-medium text-gray-400">Last Attempt</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {deliveries.map((d) => {
            const cfg = DELIVERY_STATUS[d.status] ?? DELIVERY_STATUS['PENDING'];
            const Icon = cfg.icon;
            return (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-gray-700">{d.event}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
                    <Icon className="w-3 h-3" />
                    {cfg.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-center text-gray-500">{d.attempts}</td>
                <td className="px-3 py-2 text-center">
                  {d.responseStatus ? (
                    <span className={`font-mono font-bold ${d.responseStatus < 300 ? 'text-green-600' : 'text-red-500'}`}>
                      {d.responseStatus}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-3 py-2 text-gray-400">
                  {d.lastAttemptAt ? format(new Date(d.lastAttemptAt), 'MMM d, HH:mm:ss') : '—'}
                  {d.errorMessage && (
                    <p className="text-red-400 truncate max-w-[200px]" title={d.errorMessage}>{d.errorMessage}</p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-50 bg-gray-50">
          <span className="text-xs text-gray-400">{meta.total} total deliveries</span>
          <div className="flex gap-1.5">
            <button onClick={() => setPage((p) => p - 1)} disabled={!meta.hasPrev} className="btn-secondary text-xs px-2 py-1 disabled:opacity-40">←</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={!meta.hasNext} className="btn-secondary text-xs px-2 py-1 disabled:opacity-40">→</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EndpointCard({ endpoint }: { endpoint: WebhookEndpoint }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const deleteEndpoint = useMutation({
    mutationFn: () => api.delete(`/integrations/endpoints/${endpoint.id}?programId=${user?.programId}`),
    onSuccess: () => {
      toast.success('Endpoint deleted');
      qc.invalidateQueries({ queryKey: ['webhook-endpoints'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="card overflow-hidden">
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="p-2 bg-brand-50 rounded-lg mt-0.5">
          <Webhook className="w-4 h-4 text-brand-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-mono text-sm font-medium text-gray-900 truncate">{endpoint.url}</p>
            <span className={`badge ${endpoint.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
              {endpoint.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          {endpoint.description && (
            <p className="text-xs text-gray-400 mt-0.5">{endpoint.description}</p>
          )}
          <div className="flex flex-wrap gap-1 mt-2">
            {endpoint.events.slice(0, 5).map((evt) => (
              <span key={evt} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded font-mono">{evt}</span>
            ))}
            {endpoint.events.length > 5 && (
              <span className="bg-gray-100 text-gray-400 text-xs px-2 py-0.5 rounded">+{endpoint.events.length - 5} more</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Delete this webhook endpoint and all its delivery history?')) deleteEndpoint.mutate();
            }}
            disabled={deleteEndpoint.isPending}
            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {expanded
            ? <ChevronDown className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && <DeliveryLog endpointId={endpoint.id} />}
    </div>
  );
}

export default function WebhooksPage() {
  const [showCreate, setShowCreate] = useState(false);
  const user = useAuthStore((s) => s.user);

  const { data: endpoints, isLoading } = useQuery({
    queryKey: ['webhook-endpoints', user?.programId],
    queryFn: async () => {
      const params = user?.programId ? `?programId=${user.programId}` : '';
      return (await api.get(`/integrations/endpoints${params}`)).data.data as WebhookEndpoint[];
    },
  });

  return (
    <div className="space-y-5 max-w-4xl">
      {showCreate && user?.programId && (
        <CreateEndpointModal programId={user.programId} onClose={() => setShowCreate(false)} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Receive real-time events from the Gift Card platform at your HTTPS endpoints.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          Add Endpoint
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-700">
        <strong>Signing:</strong> Every delivery includes an{' '}
        <code className="bg-blue-100 px-1 rounded">X-Webhook-Signature</code> header (HMAC-SHA256).
        Verify it using your endpoint&apos;s secret to authenticate payloads.
        Failed deliveries are retried with exponential back-off up to 5 times.
      </div>

      {/* Endpoint list */}
      {isLoading ? (
        <p className="text-gray-400 text-sm">Loading endpoints…</p>
      ) : !endpoints?.length ? (
        <div className="card p-12 text-center">
          <Webhook className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No webhook endpoints</p>
          <p className="text-gray-400 text-sm mt-1">Add an endpoint to start receiving real-time events.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">
            <Plus className="w-4 h-4" />
            Add First Endpoint
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {endpoints.map((ep) => <EndpointCard key={ep.id} endpoint={ep} />)}
        </div>
      )}
    </div>
  );
}
