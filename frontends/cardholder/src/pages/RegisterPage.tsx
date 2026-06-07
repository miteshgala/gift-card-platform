import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Mail, Phone, CheckCircle } from 'lucide-react';
import { z } from 'zod';
import { api } from '@/lib/api';

const schema = z.object({
  cardNumber: z.string().regex(/^\d{16}$/, 'Enter 16-digit card number'),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits'),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  phone: z.string().regex(/^\+\d{7,15}$/, 'Use international format: +12025551234').optional().or(z.literal('')),
});

type Step = 'form' | 'success';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('form');
  const [cardNumber, setCardNumber] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const formatCardNumber = (val: string) => {
    return val.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const rawCard = cardNumber.replace(/\s/g, '');

    const parsed = schema.safeParse({
      cardNumber: rawCard,
      pin,
      email: email || undefined,
      phone: phone || undefined,
    });

    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Please check your inputs.');
      return;
    }

    if (!email && !phone) {
      setError('Please provide at least an email or phone number.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/cardholder/register', {
        cardNumber: rawCard,
        pin,
        email: email || undefined,
        phone: phone || undefined,
      });
      setStep('success');
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
      if (code === 'INVALID_CREDENTIALS') setError('Card number or PIN is incorrect.');
      else setError('Registration failed. Please check your details and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'success') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 mx-auto">
            <CheckCircle className="h-7 w-7 text-green-600" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-gray-900">Card Registered</h2>
          <p className="mb-6 text-sm text-gray-500">
            You'll now receive account notifications at your registered contact details.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Sign In to Your Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-3 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600">
              <CreditCard className="h-6 w-6 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Register Your Card</h1>
          <p className="mt-1 text-sm text-gray-500">
            Add an email or phone to receive balance alerts and notifications
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Card number */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Card Number</label>
            <div className="relative">
              <CreditCard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                inputMode="numeric"
                className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 py-3 font-mono text-sm tracking-widest focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder="0000 0000 0000 0000"
                value={cardNumber}
                onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                maxLength={19}
                required
              />
            </div>
          </div>

          {/* PIN */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Card PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              required
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-center text-xl tracking-widest font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </div>

          <div className="my-1 border-t pt-4">
            <p className="mb-3 text-sm font-medium text-gray-700">Where should we send notifications?</p>

            {/* Email */}
            <div className="mb-3">
              <label className="mb-1 block text-sm text-gray-600">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 py-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Phone */}
            <div>
              <label className="mb-1 block text-sm text-gray-600">Phone Number <span className="text-gray-400">(optional)</span></label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="tel"
                  className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 py-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  placeholder="+12025551234"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">International format with country code (e.g. +1 for US)</p>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !cardNumber || !pin}
            className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Registering…' : 'Register Card'}
          </button>

          <p className="text-center text-xs text-gray-400">
            Already registered?{' '}
            <button type="button" onClick={() => navigate('/login')} className="text-brand-600 hover:underline">
              Sign in
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
