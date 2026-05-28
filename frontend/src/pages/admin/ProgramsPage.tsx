import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Pencil, ChevronRight, ChevronDown, Megaphone } from 'lucide-react';
import { api, getErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Program {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  currency: string;
  budgetCap: number | null;
  budgetUtilized: number;
  approvalThreshold: number | null;
  cardExpiryDays: number;
  allowPartialRedeem: boolean;
  isActive: boolean;
}

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  bonusLoadPercent: number;
  minLoadAmount: number | null;
  maxLoadAmount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}

interface ProgramFormData {
  name: string;
  slug: string;
  description: string;
  currency: string;
  budgetCap: string;
  approvalThreshold: string;
  cardExpiryDays: string;
  allowPartialRedeem: boolean;
}

interface CampaignFormData {
  name: string;
  description: string;
  bonusLoadPercent: string;
  minLoadAmount: string;
  maxLoadAmount: string;
  startsAt: string;
  endsAt: string;
}

const EMPTY_PROGRAM: ProgramFormData = {
  name: '', slug: '', description: '', currency: 'USD',
  budgetCap: '', approvalThreshold: '', cardExpiryDays: '365', allowPartialRedeem: true,
};

const EMPTY_CAMPAIGN: CampaignFormData = {
  name: '', description: '', bonusLoadPercent: '0',
  minLoadAmount: '', maxLoadAmount: '', startsAt: '', endsAt: '',
};

// ─── Program Modal ────────────────────────────────────────────────────────────

function ProgramModal({
  initial,
  programId,
  onClose,
}: {
  initial?: Program;
  programId?: string;
  onClose: () => void;
}) {
  const editing = !!initial;
  const [form, setForm] = useState<ProgramFormData>(
    initial
      ? {
          name: initial.name,
          slug: initial.slug,
          description: initial.description ?? '',
          currency: initial.currency,
          budgetCap: initial.budgetCap ? String(initial.budgetCap) : '',
          approvalThreshold: initial.approvalThreshold ? String(initial.approvalThreshold) : '',
          cardExpiryDays: String(initial.cardExpiryDays),
          allowPartialRedeem: initial.allowPartialRedeem,
        }
      : EMPTY_PROGRAM
  );
  const qc = useQueryClient();

  const set = (k: keyof ProgramFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        slug: form.slug,
        description: form.description || undefined,
        currency: form.currency,
        budgetCap: form.budgetCap ? Number(form.budgetCap) : undefined,
        approvalThreshold: form.approvalThreshold ? Number(form.approvalThreshold) : undefined,
        cardExpiryDays: Number(form.cardExpiryDays),
        allowPartialRedeem: form.allowPartialRedeem,
      };
      return editing
        ? api.patch(`/programs/${programId}`, body)
        : api.post('/programs', body);
    },
    onSuccess: () => {
      toast.success(editing ? 'Program updated' : 'Program created');
      qc.invalidateQueries({ queryKey: ['programs'] });
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-5">{editing ? 'Edit Program' : 'New Program'}</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input className="input w-full" value={form.name} onChange={set('name')} placeholder="Acme Rewards" />
            </div>
            {!editing && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Slug *</label>
                <input className="input w-full font-mono" value={form.slug} onChange={set('slug')} placeholder="acme-rewards" />
                <p className="text-xs text-gray-400 mt-1">Lowercase letters, numbers and hyphens only</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select className="input w-full" value={form.currency} onChange={set('currency')}>
                {['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Card Expiry (days)</label>
              <input className="input w-full" type="number" min="1" value={form.cardExpiryDays} onChange={set('cardExpiryDays')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Budget Cap ($)</label>
              <input className="input w-full" type="number" min="0" step="0.01" placeholder="Unlimited" value={form.budgetCap} onChange={set('budgetCap')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Approval Threshold ($)</label>
              <input className="input w-full" type="number" min="0" step="0.01" placeholder="No limit" value={form.approvalThreshold} onChange={set('approvalThreshold')} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea className="input w-full h-20 resize-none" value={form.description} onChange={set('description')} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.allowPartialRedeem}
              onChange={(e) => setForm((f) => ({ ...f, allowPartialRedeem: e.target.checked }))}
              className="accent-brand-500"
            />
            <span className="text-sm text-gray-700">Allow partial redemptions</span>
          </label>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => save.mutate()} disabled={!form.name || save.isPending} className="btn-primary disabled:opacity-50">
            {save.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Program'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Campaign Modal ───────────────────────────────────────────────────────────

function CampaignModal({ programId, onClose }: { programId: string; onClose: () => void }) {
  const [form, setForm] = useState<CampaignFormData>(EMPTY_CAMPAIGN);
  const qc = useQueryClient();

  const set = (k: keyof CampaignFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: () => api.post(`/programs/${programId}/campaigns`, {
      name: form.name,
      description: form.description || undefined,
      bonusLoadPercent: Number(form.bonusLoadPercent),
      minLoadAmount: form.minLoadAmount ? Number(form.minLoadAmount) : undefined,
      maxLoadAmount: form.maxLoadAmount ? Number(form.maxLoadAmount) : undefined,
      startsAt: form.startsAt || undefined,
      endsAt: form.endsAt || undefined,
    }),
    onSuccess: () => {
      toast.success('Campaign created');
      qc.invalidateQueries({ queryKey: ['campaigns', programId] });
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-5">New Campaign</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input className="input w-full" value={form.name} onChange={set('name')} placeholder="Summer Promo" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bonus Load %</label>
            <input className="input w-full" type="number" min="0" max="100" value={form.bonusLoadPercent} onChange={set('bonusLoadPercent')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Load ($)</label>
              <input className="input w-full" type="number" min="0" step="0.01" value={form.minLoadAmount} onChange={set('minLoadAmount')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Load ($)</label>
              <input className="input w-full" type="number" min="0" step="0.01" value={form.maxLoadAmount} onChange={set('maxLoadAmount')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Starts At</label>
              <input className="input w-full" type="datetime-local" value={form.startsAt} onChange={set('startsAt')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ends At</label>
              <input className="input w-full" type="datetime-local" value={form.endsAt} onChange={set('endsAt')} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea className="input w-full h-16 resize-none" value={form.description} onChange={set('description')} />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!form.name || create.isPending} className="btn-primary disabled:opacity-50">
            {create.isPending ? 'Creating…' : 'Create Campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Program Card ─────────────────────────────────────────────────────────────

function ProgramCard({ program, canEdit, isSuperAdmin }: { program: Program; canEdit: boolean; isSuperAdmin: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showCampaign, setShowCampaign] = useState(false);

  const { data: campaigns } = useQuery({
    queryKey: ['campaigns', program.id],
    queryFn: async () => (await api.get(`/programs/${program.id}/campaigns`)).data.data as Campaign[],
    enabled: expanded,
  });

  const utilizationPct = program.budgetCap
    ? Math.min(100, (Number(program.budgetUtilized) / Number(program.budgetCap)) * 100)
    : 0;

  return (
    <>
      {showEdit && <ProgramModal initial={program} programId={program.id} onClose={() => setShowEdit(false)} />}
      {showCampaign && <CampaignModal programId={program.id} onClose={() => setShowCampaign(false)} />}

      <div className="card overflow-hidden">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-brand-50 rounded-lg">
              <Building2 className="w-5 h-5 text-brand-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-gray-900">{program.name}</h3>
                <span className="font-mono text-xs text-gray-400">{program.slug}</span>
                <span className={`ml-auto badge ${program.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {program.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              {program.description && <p className="text-xs text-gray-400 mt-1">{program.description}</p>}
            </div>
            {canEdit && (
              <button onClick={() => setShowEdit(true)} className="p-1.5 text-gray-400 hover:text-brand-500 rounded transition-colors">
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Currency</dt>
              <dd className="font-medium">{program.currency}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Card Expiry</dt>
              <dd className="font-medium">{program.cardExpiryDays}d</dd>
            </div>
            {program.approvalThreshold && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Approval Threshold</dt>
                <dd className="font-medium">${Number(program.approvalThreshold).toLocaleString()}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-500">Partial Redeem</dt>
              <dd className="font-medium">{program.allowPartialRedeem ? 'Yes' : 'No'}</dd>
            </div>
          </dl>

          {program.budgetCap && (
            <div className="mt-4">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">Budget utilized</span>
                <span className="text-gray-700">${Number(program.budgetUtilized).toLocaleString()} / ${Number(program.budgetCap).toLocaleString()}</span>
              </div>
              <div className="bg-gray-100 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full ${utilizationPct >= 90 ? 'bg-red-500' : utilizationPct >= 70 ? 'bg-amber-500' : 'bg-brand-500'}`}
                  style={{ width: `${utilizationPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Campaigns toggle */}
        <div className="border-t border-gray-100">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center justify-between w-full px-5 py-3 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <span className="flex items-center gap-2"><Megaphone className="w-3.5 h-3.5" /> Campaigns</span>
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {expanded && (
            <div className="px-5 pb-4 space-y-2">
              {campaigns?.length === 0 && <p className="text-xs text-gray-400">No campaigns yet</p>}
              {campaigns?.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-700">{c.name}</p>
                    <p className="text-xs text-gray-400">
                      {c.bonusLoadPercent > 0 && `+${c.bonusLoadPercent}% bonus`}
                      {c.startsAt && ` · ${format(new Date(c.startsAt), 'MMM d')}`}
                      {c.endsAt && ` → ${format(new Date(c.endsAt), 'MMM d')}`}
                    </p>
                  </div>
                  <span className={`badge ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
              {(canEdit || isSuperAdmin) && (
                <button onClick={() => setShowCampaign(true)} className="btn-secondary text-xs w-full mt-2">
                  <Plus className="w-3.5 h-3.5" /> New Campaign
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProgramsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isProgramAdmin = ['SUPER_ADMIN', 'PROGRAM_ADMIN'].includes(user?.role ?? '');

  const { data, isLoading } = useQuery({
    queryKey: ['programs'],
    queryFn: async () => (await api.get('/programs')).data.data as Program[],
  });

  return (
    <div className="space-y-5">
      {showCreate && <ProgramModal onClose={() => setShowCreate(false)} />}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Programs</h1>
        {isSuperAdmin && (
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            New Program
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-gray-400">Loading…</p>
      ) : !data?.length ? (
        <div className="card p-12 text-center">
          <Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No programs found</p>
          {isSuperAdmin && (
            <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">
              <Plus className="w-4 h-4" /> Create First Program
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {data.map((p) => (
            <ProgramCard key={p.id} program={p} canEdit={isProgramAdmin} isSuperAdmin={isSuperAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}
