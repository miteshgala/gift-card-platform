import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store/auth';
import { api, getErrorMessage } from '../../lib/api';
import toast from 'react-hot-toast';
import { Key, Webhook } from 'lucide-react';

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const { data: apiKeys } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => (await api.get(`/integrations/api-keys?programId=${user?.programId}`)).data.data,
    enabled: !!user?.programId,
  });

  const createKey = useMutation({
    mutationFn: () => api.post('/integrations/api-keys', {
      programId: user?.programId,
      name: `Key ${Date.now()}`,
      isSandbox: true,
    }),
    onSuccess: (res) => {
      toast.success(`API key created: ${res.data.data.key}`);
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const revokeKey = useMutation({
    mutationFn: (keyId: string) => api.delete(`/integrations/api-keys/${keyId}?programId=${user?.programId}`),
    onSuccess: () => { toast.success('Key revoked'); qc.invalidateQueries({ queryKey: ['api-keys'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* API Keys */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-brand-500" />
            <h2 className="font-semibold text-gray-900">API Keys</h2>
          </div>
          <button onClick={() => createKey.mutate()} className="btn-primary text-sm">
            Create Key
          </button>
        </div>
        <div className="space-y-3">
          {apiKeys?.length === 0 ? (
            <p className="text-gray-400 text-sm">No API keys yet</p>
          ) : apiKeys?.map((key: {
            id: string; name: string; keyPrefix: string; isSandbox: boolean; isActive: boolean; lastUsedAt?: string;
          }) => (
            <div key={key.id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
              <div>
                <p className="font-medium text-sm">{key.name}</p>
                <p className="font-mono text-xs text-gray-400">{key.keyPrefix}••••••••</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`badge ${key.isSandbox ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                  {key.isSandbox ? 'Sandbox' : 'Live'}
                </span>
                {key.isActive && (
                  <button
                    onClick={() => { if (confirm('Revoke this key?')) revokeKey.mutate(key.id); }}
                    className="text-red-500 text-xs hover:underline"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* OpenAPI Docs Link */}
      <div className="card p-6">
        <h2 className="font-semibold text-gray-900 mb-2">API Documentation</h2>
        <p className="text-sm text-gray-500 mb-3">Explore the interactive API documentation to test endpoints and view schemas.</p>
        <a
          href="/api-docs"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary text-sm"
        >
          Open Swagger UI →
        </a>
      </div>
    </div>
  );
}
