import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { api } from '@/lib/api';
import CardShell from '@/components/CardShell';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '');

const PRESET_AMOUNTS = [25, 50, 100, 200];

function CheckoutForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setError('');
    setProcessing(true);
    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    if (stripeError) {
      setError(stripeError.message ?? 'Payment failed. Please try again.');
      setProcessing(false);
    } else {
      onSuccess();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <button type="submit" disabled={!stripe || processing} className="btn-primary w-full">
        {processing ? 'Processing…' : 'Add Funds'}
      </button>
    </form>
  );
}

export default function ReloadPage() {
  const [amountDollars, setAmountDollars] = useState<number>(50);
  const [customAmount, setCustomAmount] = useState('');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const selectedCents = customAmount
    ? Math.round(parseFloat(customAmount) * 100)
    : amountDollars * 100;

  async function handleCreateIntent() {
    if (selectedCents < 100) {
      setError('Minimum reload amount is $1.00');
      return;
    }
    if (selectedCents > 50000) {
      setError('Maximum reload amount is $500.00');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ data: { clientSecret: string } }>('/reload/intent', {
        amountCents: selectedCents,
      });
      setClientSecret(res.data.data.clientSecret);
    } catch {
      setError('Unable to start reload. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <CardShell>
        <div className="mt-2">
          <div className="card p-8 text-center space-y-3">
            <div className="mx-auto h-14 w-14 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900">Funds Added!</h3>
            <p className="text-sm text-gray-500">
              Your balance will be updated shortly.
            </p>
            <button
              className="btn-primary w-full mt-2"
              onClick={() => {
                setSuccess(false);
                setClientSecret(null);
                setCustomAmount('');
                setAmountDollars(50);
              }}
            >
              Reload Again
            </button>
          </div>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <div className="mt-2 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Add Funds</h2>

        {!clientSecret ? (
          <div className="card p-5 space-y-4">
            {/* Preset amounts */}
            <div>
              <p className="text-xs text-gray-500 mb-2">Select amount</p>
              <div className="grid grid-cols-4 gap-2">
                {PRESET_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => { setAmountDollars(amt); setCustomAmount(''); }}
                    className={`rounded-xl py-2.5 text-sm font-medium border transition-colors ${
                      !customAmount && amountDollars === amt
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-brand-400'
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom amount */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Or enter custom amount</label>
              <div className="relative">
                <span className="absolute left-3.5 top-3 text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  min="1"
                  max="500"
                  step="0.01"
                  placeholder="0.00"
                  className="input pl-7"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <div className="pt-1">
              <div className="flex justify-between text-sm mb-3">
                <span className="text-gray-500">Reload amount</span>
                <span className="font-semibold text-gray-900">
                  ${(selectedCents / 100).toFixed(2)}
                </span>
              </div>
              <button
                onClick={handleCreateIntent}
                disabled={loading || selectedCents < 100}
                className="btn-primary w-full"
              >
                {loading ? 'Preparing…' : 'Continue to Payment'}
              </button>
            </div>
          </div>
        ) : (
          <div className="card p-5 space-y-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-500">Adding to card</span>
              <span className="font-semibold text-gray-900">
                ${(selectedCents / 100).toFixed(2)}
              </span>
            </div>
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
              <CheckoutForm onSuccess={() => setSuccess(true)} />
            </Elements>
            <button
              className="w-full text-xs text-gray-400 hover:text-gray-600 mt-1"
              onClick={() => setClientSecret(null)}
            >
              ← Change amount
            </button>
          </div>
        )}

        <p className="text-center text-xs text-gray-400">
          Payments are processed securely via Stripe
        </p>
      </div>
    </CardShell>
  );
}
