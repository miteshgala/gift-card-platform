import { useQuery } from '@tanstack/react-query';
import { CreditCard, DollarSign, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from 'recharts';
import { format } from 'date-fns';

function KpiCard({ title, value, subtitle, icon: Icon, color }: {
  title: string; value: string; subtitle?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <div className="card p-6 flex items-start gap-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: liability, isLoading: liabilityLoading } = useQuery({
    queryKey: ['reports', 'liability'],
    queryFn: async () => {
      const res = await api.get('/reports/liability');
      return res.data.data;
    },
  });

  const { data: redemption } = useQuery({
    queryKey: ['reports', 'redemption'],
    queryFn: async () => {
      const res = await api.get('/reports/redemption-rate');
      return res.data.data;
    },
  });

  const { data: volume } = useQuery({
    queryKey: ['reports', 'volume'],
    queryFn: async () => {
      const res = await api.get('/reports/transaction-volume');
      return res.data.data;
    },
  });

  const { data: flags } = useQuery({
    queryKey: ['fraud', 'flags', 'unresolved'],
    queryFn: async () => {
      const res = await api.get('/fraud/flags?resolved=false&limit=5');
      return res.data.data;
    },
  });

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Last updated: {format(new Date(), 'MMM d, h:mm a')}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Outstanding Liability"
          value={liability ? formatCurrency(liability.totalLiability) : '—'}
          subtitle={`${liability?.activeCards ?? 0} active cards`}
          icon={DollarSign}
          color="bg-blue-500"
        />
        <KpiCard
          title="Total Cards Issued"
          value={redemption?.totalCards?.toLocaleString() ?? '—'}
          subtitle={`${redemption?.redeemedCards ?? 0} redeemed`}
          icon={CreditCard}
          color="bg-emerald-500"
        />
        <KpiCard
          title="Redemption Rate"
          value={redemption?.valueRedemptionRate ?? '—'}
          subtitle="by value"
          icon={TrendingUp}
          color="bg-purple-500"
        />
        <KpiCard
          title="Open Fraud Flags"
          value={flags?.length?.toString() ?? '—'}
          subtitle="requiring review"
          icon={AlertTriangle}
          color="bg-red-500"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transaction Volume by Type */}
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Transaction Volume by Type</h2>
          {volume?.byType?.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={volume.byType}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="totalAmount" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
              No transaction data
            </div>
          )}
        </div>

        {/* Fraud Flags Summary */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Recent Fraud Flags</h2>
            <a href="/admin/fraud" className="text-brand-500 text-sm hover:underline">View all</a>
          </div>
          {flags && flags.length > 0 ? (
            <div className="space-y-3">
              {flags.map((flag: { id: string; severity: string; reason: string; card?: { cardNumberMasked?: string }; createdAt: string }) => (
                <div key={flag.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className={`badge mt-0.5 ${
                    flag.severity === 'HIGH' || flag.severity === 'CRITICAL'
                      ? 'bg-red-100 text-red-700'
                      : flag.severity === 'MEDIUM'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {flag.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{flag.reason}</p>
                    <p className="text-xs text-gray-500">{flag.card?.cardNumberMasked}</p>
                  </div>
                  <p className="text-xs text-gray-400 flex-shrink-0">
                    {format(new Date(flag.createdAt), 'MMM d')}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-gray-400 text-sm">
              No unresolved fraud flags
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
