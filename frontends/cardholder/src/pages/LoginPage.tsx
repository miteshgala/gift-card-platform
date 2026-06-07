import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Lock } from 'lucide-react';
import axios from 'axios';

export default function LoginPage() {
  const navigate = useNavigate();
  const [cardNumber, setCardNumber] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function formatCardInput(val: string) {
    return val.replace(/\D/g, '').slice(0, 16);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await axios.post<{ data: { accessToken: string } }>('/api/v1/cardholder/auth', {
        cardNumber, pin,
      });
      localStorage.setItem('ch_token', res.data.data.accessToken);
      navigate('/balance');
    } catch {
      setError('Invalid card number or PIN. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Card icon */}
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-white/20 flex items-center justify-center">
            <CreditCard className="h-9 w-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">My Gift Card</h1>
          <p className="text-brand-200 text-sm mt-1">Check balance · View transactions · Reload</p>
        </div>

        <div className="card p-7">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Card Number</label>
              <div className="relative">
                <CreditCard className="absolute left-3.5 top-3.5 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="1234 5678 9012 3456"
                  maxLength={16}
                  className="input pl-10 tracking-widest font-mono"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(formatCardInput(e.target.value))}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PIN</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-gray-400" />
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder="••••"
                  maxLength={6}
                  className="input pl-10 tracking-widest font-mono"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <button type="submit" disabled={loading || cardNumber.length < 16 || pin.length < 4} className="btn-primary w-full">
              {loading ? 'Checking…' : 'Access My Card'}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-gray-400">
            Your card data is encrypted and secure
          </p>
        </div>
      </div>
    </div>
  );
}
