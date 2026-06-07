import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import CardShell from '@/components/CardShell';

export default function PinChangePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!/^\d{4,6}$/.test(newPin)) {
      setError('PIN must be 4–6 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setError('New PINs do not match.');
      return;
    }
    if (newPin === currentPin) {
      setError('New PIN must be different from your current PIN.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/cardholder/pin/change', { currentPin, newPin });
      setStep('success');
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
      if (code === 'INVALID_PIN') setError('Current PIN is incorrect.');
      else if (code === 'PIN_LOCKED') setError('PIN is temporarily locked due to too many incorrect attempts. Try again in 30 minutes.');
      else setError('Failed to change PIN. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'success') {
    return (
      <CardShell>
        <div className="flex flex-col items-center py-8 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <Shield className="h-7 w-7 text-green-600" />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-gray-900">PIN Changed</h2>
          <p className="mb-6 text-sm text-gray-500">
            Your card PIN has been updated successfully.
          </p>
          <button
            onClick={() => navigate('/balance')}
            className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Back to Account
          </button>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <div className="mt-2">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <h2 className="mb-1 text-base font-semibold text-gray-900">Change PIN</h2>
        <p className="mb-5 text-sm text-gray-500">Enter your current PIN and choose a new one.</p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Current PIN</label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={6}
                required
                className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-10 text-center text-xl tracking-widest font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                onClick={() => setShowCurrent((v) => !v)}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">New PIN</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={6}
                required
                className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-10 text-center text-xl tracking-widest font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                onClick={() => setShowNew((v) => !v)}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Confirm New PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              required
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-xl tracking-widest font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
            />
          </div>

          <p className="text-xs text-gray-400">
            PIN must be 4–6 digits. Don't use obvious sequences like 1234 or 0000.
          </p>

          <button
            type="submit"
            disabled={loading || !currentPin || !newPin || !confirmPin}
            className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Changing PIN…' : 'Change PIN'}
          </button>
        </form>
      </div>
    </CardShell>
  );
}
