import { useQuery } from '@tanstack/react-query';
import { CreditCard, DollarSign, ShoppingCart, AlertTriangle } from 'lucide-react';
import { api, formatCents, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { getCurrentUser } from '@/lib/auth';

interface ProgramLiability {
  programId: string;
  name: string;
  floatBalance: string;
  totalCardBalance: string;
  activeCards: number;
  currency: string;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  change?: string;
  color?: string;
}

function StatCard({ label, value, icon, change, color = 'text-brand-600' }: StatCardProps) {
  return (
    <div className="card p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
          {change && <p className="mt-1 text-xs text-gray-500">{change}</p>}
        </div>
        <div className={`rounded-lg bg-gray-50 p-2 ${color}`}>{icon}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const user = getCurrentUser();

  const { data: liability, isLoading: liabilityLoading } = useQuery({
    queryKey: ['reports', 'card-liability'],
    queryFn: () => api.get<{ data: ProgramLiability[] }>('/reports/card-liability').then((r) => r.data.data),
  });

  const endDate = new Date().toISOString();
  const startDate = new Date(Date.now() - 30 * 86400_000).toISOString();

  const { data: issuance, isLoading: issuanceLoading } = useQuery({
    queryKey: ['reports', 'issuance', startDate],
    queryFn: () =>
      api.get<{ data: { summary: { totalCards: number; totalLoadedCents: string } } }>('/reports/issuance', {
        params: { startDate, endDate, programId: user?.programId },
      }).then((r) => r.data.data),
  });

  const { data: openFlags } = useQuery({
    queryKey: ['fraud', 'flags', 'open'],
    queryFn: () =>
      api.get<{ data: unknown[] }>('/fraud/flags', { params: { status: 'OPEN', limit: 1 } }).then((r) => r.data.data),
  });

  if (liabilityLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const totalFloat = liability?.reduce((s, p) => s + Number(p.floatBalance), 0) ?? 0;
  const totalCards = liability?.reduce((s, p) => s + p.activeCards, 0) ?? 0;
  const totalLiability = liability?.reduce((s, p) => s + Number(p.totalCardBalance), 0) ?? 0;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">
          Platform overview — last updated {formatDate(new Date())}
        </p>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Float"
          value={formatCents(totalFloat)}
          icon={<DollarSign className="h-5 w-5" />}
          color="text-green-600"
        />
        <StatCard
          label="Outstanding Liability"
          value={formatCents(totalLiability)}
          icon={<DollarSign className="h-5 w-5" />}
          color="text-blue-600"
        />
        <StatCard
          label="Active Cards"
          value={totalCards.toLocaleString()}
          icon={<CreditCard className="h-5 w-5" />}
          color="text-brand-600"
        />
        <StatCard
          label="Issued (30 days)"
          value={issuanceLoading ? '…' : (issuance?.summary.totalCards ?? 0).toLocaleString()}
          icon={<ShoppingCart className="h-5 w-5" />}
          color="text-purple-600"
          change={`${formatCents(issuance?.summary.totalLoadedCents ?? '0')} loaded`}
        />
      </div>

      {/* Program liability table */}
      <div className="mb-6 card">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900">Program Liability</h2>
          <p className="text-sm text-gray-500">Float vs. outstanding card balances by program</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-6 py-3">Program</th>
                <th className="px-6 py-3 text-right">Float</th>
                <th className="px-6 py-3 text-right">Card Liability</th>
                <th className="px-6 py-3 text-right">Active Cards</th>
                <th className="px-6 py-3 text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {liability?.map((p) => {
                const variance = Number(p.floatBalance) - Number(p.totalCardBalance);
                return (
                  <tr key={p.programId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{p.name}</td>
                    <td className="px-6 py-4 text-right text-gray-700">{formatCents(p.floatBalance)}</td>
                    <td className="px-6 py-4 text-right text-gray-700">{formatCents(p.totalCardBalance)}</td>
                    <td className="px-6 py-4 text-right text-gray-700">{p.activeCards.toLocaleString()}</td>
                    <td className={`px-6 py-4 text-right font-medium ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCents(Math.abs(variance))}
                    </td>
                  </tr>
                );
              })}
              {(!liability || liability.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                    No program data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Open fraud flags alert */}
      {openFlags && openFlags.length > 0 && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0" />
          <p className="text-sm text-yellow-800">
            There are open fraud flags requiring review.{' '}
            <a href="/fraud" className="font-medium underline">Review now →</a>
          </p>
        </div>
      )}
    </div>
  );
}
