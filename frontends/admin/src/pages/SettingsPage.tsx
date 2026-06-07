import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck, Key, User, Lock, Eye, EyeOff, Copy, Trash2, Plus } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { v4 as uuid } from 'uuid';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Me {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  totpEnabled: boolean;
  programId: string | null;
}

interface ApiKey {
  id: string;
  keyPrefix: string;
  name: string;
  programId: string;
  createdAt: string;
  lastUsedAt?: string;
}

// ─── Tab type ─────────────────────────────────────────────────────────────────
type Tab = 'profile' | 'password' | 'two-factor' | 'api-keys';

// ─── Profile tab ─────────────────────────────────────────────────────────────
const profileSchema = z.object({
  firstName: z.string().min(1, 'Required').max(60),
  lastName: z.string().min(1, 'Required').max(60),
});
type ProfileForm = z.infer<typeof profileSchema>;

function ProfileTab({ user }: { user: Me }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { firstName: user.firstName, lastName: user.lastName },
  });

  const [saved, setSaved] = useState(false);

  const onSubmit = async (data: ProfileForm) => {
    await api.patch('/users/me', data, { headers: { 'Idempotency-Key': uuid() } });
    void qc.invalidateQueries({ queryKey: ['me'] });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="max-w-lg">
      <h2 className="mb-5 text-base font-semibold text-gray-900">Profile Information</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="label">First Name</label>
          <input className="input w-full" {...register('firstName')} />
          {errors.firstName && <p className="mt-1 text-xs text-red-500">{errors.firstName.message}</p>}
        </div>
        <div>
          <label className="label">Last Name</label>
          <input className="input w-full" {...register('lastName')} />
          {errors.lastName && <p className="mt-1 text-xs text-red-500">{errors.lastName.message}</p>}
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input w-full bg-gray-50" value={user.email} readOnly />
          <p className="mt-1 text-xs text-gray-400">Email cannot be changed. Contact your admin.</p>
        </div>
        <div>
          <label className="label">Role</label>
          <input className="input w-full bg-gray-50" value={user.role.replace('_', ' ')} readOnly />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save Changes'}
          </button>
          {saved && <span className="text-sm text-green-600">✓ Saved</span>}
        </div>
      </form>
    </div>
  );
}

// ─── Password tab ─────────────────────────────────────────────────────────────
const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Required'),
  newPassword: z.string().min(12, 'Minimum 12 characters')
    .regex(/[A-Z]/, 'Must include uppercase')
    .regex(/[a-z]/, 'Must include lowercase')
    .regex(/\d/, 'Must include number')
    .regex(/[^a-zA-Z\d]/, 'Must include symbol'),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});
type PasswordForm = z.infer<typeof passwordSchema>;

function PasswordTab() {
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState('');

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

  const onSubmit = async (data: PasswordForm) => {
    setServerError('');
    try {
      await api.post('/auth/change-password', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      }, { headers: { 'Idempotency-Key': uuid() } });
      setSuccess(true);
      reset();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Failed to change password';
      setServerError(msg);
    }
  };

  return (
    <div className="max-w-lg">
      <h2 className="mb-5 text-base font-semibold text-gray-900">Change Password</h2>
      {success && (
        <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          Password changed successfully. All other sessions have been signed out.
        </div>
      )}
      {serverError && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {serverError}
        </div>
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="label">Current Password</label>
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              className="input w-full pr-10"
              {...register('currentPassword')}
            />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              onClick={() => setShowCurrent((v) => !v)}>
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.currentPassword && <p className="mt-1 text-xs text-red-500">{errors.currentPassword.message}</p>}
        </div>
        <div>
          <label className="label">New Password</label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              className="input w-full pr-10"
              {...register('newPassword')}
            />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              onClick={() => setShowNew((v) => !v)}>
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.newPassword && <p className="mt-1 text-xs text-red-500">{errors.newPassword.message}</p>}
        </div>
        <div>
          <label className="label">Confirm New Password</label>
          <input type="password" className="input w-full" {...register('confirmPassword')} />
          {errors.confirmPassword && <p className="mt-1 text-xs text-red-500">{errors.confirmPassword.message}</p>}
        </div>
        <div className="pt-2">
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Changing…' : 'Change Password'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── 2FA tab ──────────────────────────────────────────────────────────────────
function TwoFactorTab({ user }: { user: Me }) {
  const qc = useQueryClient();
  const [setupData, setSetupData] = useState<{ qrCodeUrl: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'idle' | 'setup' | 'disable'>('idle');

  const startSetup = async () => {
    setError('');
    const res = await api.post<{ data: { qrCodeUrl: string; secret: string } }>('/auth/totp/setup', {});
    setSetupData(res.data.data);
    setStep('setup');
  };

  const confirmSetup = async () => {
    setError('');
    try {
      await api.post('/auth/totp/verify', { code: totpCode }, { headers: { 'Idempotency-Key': uuid() } });
      void qc.invalidateQueries({ queryKey: ['me'] });
      setStep('idle');
      setSetupData(null);
      setTotpCode('');
    } catch {
      setError('Invalid verification code. Try again.');
    }
  };

  const disable2FA = async () => {
    setError('');
    try {
      await api.post('/auth/totp/disable', { code: disableCode }, { headers: { 'Idempotency-Key': uuid() } });
      void qc.invalidateQueries({ queryKey: ['me'] });
      setStep('idle');
      setDisableCode('');
    } catch {
      setError('Invalid code. Please try again.');
    }
  };

  return (
    <div className="max-w-lg">
      <h2 className="mb-2 text-base font-semibold text-gray-900">Two-Factor Authentication</h2>
      <p className="mb-5 text-sm text-gray-500">
        Protect your account with an authenticator app (Google Authenticator, Authy, 1Password, etc.)
      </p>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {user.totpEnabled ? (
        step === 'disable' ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">Enter your 6-digit authenticator code to disable 2FA:</p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="input w-40 text-center text-lg tracking-widest font-mono"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
            />
            <div className="flex gap-3">
              <button className="btn-secondary" onClick={() => setStep('idle')}>Cancel</button>
              <button className="btn-primary bg-red-600 hover:bg-red-700" onClick={disable2FA} disabled={disableCode.length !== 6}>
                Disable 2FA
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-4 rounded-lg bg-green-50 border border-green-200 p-4">
            <ShieldCheck className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-800">Two-factor authentication is enabled</p>
              <p className="text-xs text-green-600 mt-0.5">Your account is protected with an authenticator app.</p>
            </div>
            <button className="text-xs text-red-600 hover:text-red-800" onClick={() => setStep('disable')}>
              Disable
            </button>
          </div>
        )
      ) : step === 'setup' && setupData ? (
        <div className="space-y-5">
          <div className="rounded-lg border bg-gray-50 p-4">
            <p className="mb-3 text-sm font-medium text-gray-700">
              1. Scan this QR code with your authenticator app
            </p>
            <img src={setupData.qrCodeUrl} alt="TOTP QR Code" className="h-40 w-40 rounded border" />
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-gray-500">Can't scan? Enter code manually</summary>
              <code className="mt-1 block rounded bg-white border px-3 py-2 text-xs font-mono text-gray-700 break-all">
                {setupData.secret}
              </code>
            </details>
          </div>
          <div>
            <p className="mb-2 text-sm text-gray-700">2. Enter the 6-digit code from your authenticator app</p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="input w-40 text-center text-lg tracking-widest font-mono"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
            />
          </div>
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={() => { setStep('idle'); setSetupData(null); }}>Cancel</button>
            <button className="btn-primary" onClick={confirmSetup} disabled={totpCode.length !== 6}>
              Verify & Enable
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-4 rounded-lg bg-yellow-50 border border-yellow-200 p-4">
          <ShieldCheck className="h-5 w-5 text-yellow-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-800">Two-factor authentication is not enabled</p>
            <p className="text-xs text-yellow-600 mt-0.5">Add an extra layer of security to your account.</p>
          </div>
          <button className="btn-primary text-xs py-1 px-3" onClick={startSetup}>
            Enable 2FA
          </button>
        </div>
      )}
    </div>
  );
}

// ─── API Keys tab ─────────────────────────────────────────────────────────────
function ApiKeysTab({ user }: { user: Me }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyProgramId, setNewKeyProgramId] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: keys, isLoading } = useQuery({
    queryKey: ['me', 'api-keys'],
    queryFn: () => api.get<{ data: ApiKey[] }>('/users/me/api-keys').then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: (body: { label: string; programId?: string }) =>
      api.post<{ data: ApiKey & { key: string } }>('/users/me/api-keys', body, {
        headers: { 'Idempotency-Key': uuid() },
      }),
    onSuccess: (res) => {
      setRevealedKey(res.data.data.key);
      setShowCreate(false);
      setNewKeyName('');
      setNewKeyProgramId('');
      void qc.invalidateQueries({ queryKey: ['me', 'api-keys'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/users/me/api-keys/${id}`, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me', 'api-keys'] }),
  });

  const copyKey = async () => {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">API Keys</h2>
          <p className="text-sm text-gray-500">Secret keys for programmatic access. Shown once — store securely.</p>
        </div>
        <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          New Key
        </button>
      </div>

      {revealedKey && (
        <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="mb-2 text-sm font-medium text-green-800">Your new API key — copy it now, it won't be shown again</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded border bg-white px-3 py-2 text-xs font-mono text-gray-800 break-all">
              {revealedKey}
            </code>
            <button onClick={copyKey} className="shrink-0 rounded border px-2 py-2 text-gray-600 hover:bg-white">
              <Copy className="h-4 w-4" />
            </button>
          </div>
          {copied && <p className="mt-1 text-xs text-green-600">Copied to clipboard</p>}
          <button className="mt-3 text-xs text-gray-500 underline" onClick={() => setRevealedKey(null)}>
            I've saved it — dismiss
          </button>
        </div>
      )}

      {showCreate && (
        <div className="mb-5 rounded-lg border bg-gray-50 p-4">
          <h3 className="mb-3 text-sm font-medium text-gray-800">Create API Key</h3>
          <div className="space-y-3">
            <div>
              <label className="label">Key Name</label>
              <input
                className="input w-full"
                placeholder="e.g. Production Webhook Handler"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            {user.role === 'SUPER_ADMIN' && (
              <div>
                <label className="label">Program ID</label>
                <input
                  className="input w-full font-mono text-sm"
                  placeholder="UUID of the program"
                  value={newKeyProgramId}
                  onChange={(e) => setNewKeyProgramId(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-3">
            <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!newKeyName || createMutation.isPending}
              onClick={() => createMutation.mutate({ label: newKeyName, programId: newKeyProgramId || undefined })}
            >
              {createMutation.isPending ? 'Creating…' : 'Create Key'}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center"><LoadingSpinner /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Prefix</th>
                <th className="px-6 py-3">Created</th>
                <th className="px-6 py-3">Last Used</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {keys?.map((key) => (
                <tr key={key.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{key.name}</td>
                  <td className="px-6 py-3 font-mono text-gray-600">{key.keyPrefix}…</td>
                  <td className="px-6 py-3 text-gray-500">{formatDate(key.createdAt)}</td>
                  <td className="px-6 py-3 text-gray-400">{key.lastUsedAt ? formatDate(key.lastUsedAt) : '—'}</td>
                  <td className="px-6 py-3">
                    <button
                      onClick={() => revokeMutation.mutate(key.id)}
                      disabled={revokeMutation.isPending}
                      className="text-red-500 hover:text-red-700"
                      title="Revoke key"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {(!keys || keys.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center">
                    <Key className="mx-auto mb-2 h-7 w-7 text-gray-300" />
                    <p className="text-sm text-gray-400">No API keys. Create one above.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'profile',    label: 'Profile',         icon: <User className="h-4 w-4" /> },
  { key: 'password',   label: 'Password',         icon: <Lock className="h-4 w-4" /> },
  { key: 'two-factor', label: 'Two-Factor Auth',  icon: <ShieldCheck className="h-4 w-4" /> },
  { key: 'api-keys',   label: 'API Keys',         icon: <Key className="h-4 w-4" /> },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('profile');

  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ data: Me }>('/users/me').then((r) => r.data.data),
  });

  if (isLoading) return <div className="flex h-64 items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (!user) return null;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Manage your account, security, and API access</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar nav */}
        <nav className="w-48 shrink-0">
          <ul className="space-y-0.5">
            {TABS.map(({ key, label, icon }) => (
              <li key={key}>
                <button
                  onClick={() => setActiveTab(key)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    activeTab === key
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {icon}
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <div className="flex-1 card p-6">
          {activeTab === 'profile'    && <ProfileTab user={user} />}
          {activeTab === 'password'   && <PasswordTab />}
          {activeTab === 'two-factor' && <TwoFactorTab user={user} />}
          {activeTab === 'api-keys'   && <ApiKeysTab user={user} />}
        </div>
      </div>
    </div>
  );
}
