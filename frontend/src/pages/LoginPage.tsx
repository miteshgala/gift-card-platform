import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Gift, Loader2 } from 'lucide-react';
import { useLogin } from '../hooks/useAuth';

const schema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(1, 'Password required'),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const login = useLogin();
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 via-brand-700 to-purple-700 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4">
            <Gift className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Gift Card Platform</h1>
          <p className="text-brand-200 mt-2">Sign in to your account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <form onSubmit={handleSubmit((data) => login.mutate(data))} className="space-y-5">
            <div>
              <label className="label">Email address</label>
              <input
                {...register('email')}
                type="email"
                className="input"
                placeholder="admin@example.com"
                autoComplete="email"
              />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <label className="label">Password</label>
              <input
                {...register('password')}
                type="password"
                className="input"
                placeholder="••••••••"
                autoComplete="current-password"
              />
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={login.isPending}
              className="btn-primary w-full py-2.5"
            >
              {login.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {login.isPending ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-500">
              Customer?{' '}
              <a href="/balance" className="text-brand-600 hover:underline font-medium">
                Check your balance
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
