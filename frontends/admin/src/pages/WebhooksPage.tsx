import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pause, Play } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { v4 as uuid } from 'uuid';

interface WebhookEndpoint {
  id: string;
  url: string;
  description?: string;
  events: string[];
  status: string;
  createdAt: string;
}

export default function WebhooksPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  const { data: endpoints, isLoading } = useQuery({
    queryKey: ['webhooks', 'endpoints'],
    queryFn: () => api.get<{ data: WebhookEndpoint[] }>('/webhooks/endpoints').then((r) => r.data.data),
  });

  const { data: events } = useQuery({
    queryKey: ['webhooks', 'events'],
    queryFn: () => api.get<{ data: string[] }>('/webhooks/events').then((r) => r.data.data),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/webhooks/endpoints', { url: newUrl, description: newDesc, events: selectedEvents }, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['webhooks', 'endpoints'] });
      setShowCreate(false);
      setNewUrl('');
      setSelectedEvents([]);
    },
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/webhooks/endpoints/${id}/status`, { status }, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks', 'endpoints'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/webhooks/endpoints/${id}`, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks', 'endpoints'] }),
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Webhooks</h1>
          <p className="text-sm text-gray-500">Manage outbound webhook endpoints</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Add Endpoint
        </button>
      </div>

      <div className="space-y-4">
        {isLoading && <div className="flex h-32 items-center justify-center"><LoadingSpinner /></div>}
        {endpoints?.map((ep) => (
          <div key={ep.id} className="card p-5">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sm text-brand-600 break-all">{ep.url}</span>
                  <span className={`badge ${ep.status === 'ACTIVE' ? 'badge-green' : 'badge-gray'}`}>{ep.status}</span>
                </div>
                {ep.description && <p className="text-xs text-gray-500 mb-2">{ep.description}</p>}
                <div className="flex flex-wrap gap-1">
                  {ep.events.map((e) => (
                    <span key={e} className="badge badge-blue text-xs">{e}</span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-400">Created {formatDate(ep.createdAt)}</p>
              </div>
              <div className="flex gap-2 ml-4">
                <button
                  onClick={() => toggleStatus.mutate({ id: ep.id, status: ep.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
                  className="btn-secondary px-2 py-1.5"
                  title={ep.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                >
                  {ep.status === 'ACTIVE' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => { if (confirm('Delete this endpoint?')) remove.mutate(ep.id); }}
                  className="px-2 py-1.5 rounded-md text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {!isLoading && (!endpoints || endpoints.length === 0) && (
          <div className="card p-12 text-center text-gray-400">
            No webhook endpoints configured
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="card w-full max-w-lg p-6">
            <h2 className="mb-4 font-semibold text-gray-900">Add Webhook Endpoint</h2>
            <div className="space-y-4">
              <div>
                <label className="label">URL</label>
                <input type="url" className="input" placeholder="https://…" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
              </div>
              <div>
                <label className="label">Description (optional)</label>
                <input type="text" className="input" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
              </div>
              <div>
                <label className="label">Events</label>
                <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto text-xs">
                  {events?.map((e) => (
                    <label key={e} className="flex items-center gap-1.5 p-1 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(e)}
                        onChange={(ev) => {
                          setSelectedEvents(ev.target.checked
                            ? [...selectedEvents, e]
                            : selectedEvents.filter((x) => x !== e));
                        }}
                      />
                      <span className="text-gray-700">{e}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={!newUrl || selectedEvents.length === 0 || create.isPending}
                onClick={() => create.mutate()}
              >
                Create
              </button>
            </div>
            {create.data && (
              <div className="mt-3 rounded-md bg-green-50 px-4 py-3 text-xs text-green-800">
                Endpoint created. Signing secret: <code className="font-mono break-all">{(create.data.data as { data: { signingSecret: string } }).data.signingSecret}</code>
                <br /><span className="text-red-600 font-medium">Save this — it will not be shown again.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
