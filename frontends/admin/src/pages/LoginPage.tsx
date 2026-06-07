import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CreditCard } from 'lucide-react';
import { api } from '@/lib/api';
import { setTokens } from '@/lib/auth';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  totp: z.string().regex(/^\d{6}$/).optional().or(z.literal('')),
});

type LoginForm = z.infer<typeof loginSchema>;

interface LoginResponse {
  data: {
    accessToken: string;
    refreshToken: string;
    requiresTotp?: boolean;
  };
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(data: LoginForm) {
    setIsLoading(true);
    setError('');

    try {
      const response = await api.post<LoginResponse>('/auth/login', {
        email: data.email,
        password: data.password,
        totp: data.totp || undefined,
      });

      if (response.data.data.requiresTotp) {
        setRequiresTotp(true);
        setIsLoading(false);
        return;
      }

      setTokens(response.data.data.accessToken, response.data.data.refreshToken);
      navigate('/dashboard');
    } catch (err: unknown) {
      const errorData = err as { response?: { data?: { error?: { message?: string } } } };
      setError(errorData.response?.data?.error?.message ?? 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600">
            <CreditCard className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">GiftCard Platform</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to your admin account</p>
        </div>

        {/* Card */}
        <div className="card p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="label" htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="input"
                {...register('email')}
              />
              {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
            </div>

            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="input"
                {...register('password')}
              />
              {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
            </div>

            {requiresTotp && (
              <div>
                <label className="label" htmlFor="totp">Authenticator code</label>
                <input
                  id="totp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  className="input text-center text-lg tracking-widest"
                  {...register('totp')}
                />
                <p className="mt-1 text-xs text-gray-500">Enter the 6-digit code from your authenticator app</p>
              </div>
            )}

            {error && (
              <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full py-2.5"
            >
              {isLoading ? 'Signing in…' : requiresTotp ? 'Verify & Sign in' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-gray-500">
          Production-grade gift card & stored value platform
        </p>
      </div>
    </div>
  );
}
