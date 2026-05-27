import { useQuery } from '@tanstack/react-query';
import {
  CreditCard, DollarSign, TrendingUp, AlertTriangle,
  ArrowUpRight, ArrowDownRight, ShieldCheck, Clock,
} from 'lucide-react';
import { api } from '../../lib/api';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, Cell, PieChart, Pie,
} from 'recharts';
import { format, parseISO } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsData {
  asOf: string;
  programId?: string;
  today: {
    cardsIssued: number;
    redemptions: number;
    loadVolume: number;
    redeemVolume: number;
  };
  portfolio: {
    totalCards: number;
    activeCards: number;
    outstandingLiability: number;
    pendingKyc: number;
  };
  volumeSeries: Array<{
    date: string;
    loads: number;
    redeems: number;
    refunds: number;
    netVolume: number;
  }>;
  topLocations: Array<{ location: string; txCount: number; totalAmount: number }>;
  cohort: Array<{ status: string; cardCount: number; totalBalance: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

const COHORT_COLORS: Record<string, string> = {
  ACTIVE: '#10b981',
  PENDING: '#f59e0b',
  FROZEN: '#6366f1',
  EXPIRED: '#6b7280',
  CANCELLED: '#ef4444',
  REDEEMED: '#3b82f6',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  title, value, subtitle, delta, icon: Icon, color,
}: {
  title: string;
  value: string;
  subtitle?: string;
  delta?: { label: string; positive: boolean };
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="card p-6 flex items-start gap-4">
      <div className={`p-3 rounded-xl ${color} flex-shrink-0`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5 truncate">{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        {delta && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium mt-1 ${delta.positive ? 'text-emerald-600' : 'text-red-500'}`}>
            {delta.positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {delta.label}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: analytics, isLoading } = useQuery<AnalyticsData>({
    queryKey: ['reports', 'analytics'],
    queryFn: async () => {
      const res = await api.get('/reports/analytics');
      return res.data.data;
    },
    refetchInterval: 60_000, // refresh every minute
  });

  const { data: flags } = useQuery({
    queryKey: ['fraud', 'flags', 'unresolved'],
    queryFn: async () => {
      const res = await api.get('/fraud/flags?resolved=false&limit=5');
      return res.data.data;
    },
  });

  const today = analytics?.today;
  const portfolio = analytics?.portfolio;
  const volumeSeries = analytics?.volumeSeries ?? [];
  const topLocations = analytics?.topLocations ?? [];
  const cohort = analytics?.cohort ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
        <p className="text-sm text-gray-500">
          {analytics?.asOf ? `As of ${format(parseISO(analytics.asOf), 'MMM d, h:mm a')}` : 'Loading…'}
        </p>
      </div>

      {/* ── Today's Snapshot ─────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Today</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Cards Issued"
            value={today?.cardsIssued?.toLocaleString() ?? '—'}
            subtitle="issued today"
            icon={CreditCard}
            color="bg-emerald-500"
          />
          <KpiCard
            title="Redemptions"
            value={today?.redemptions?.toLocaleString() ?? '—'}
            subtitle="transactions today"
            icon={TrendingUp}
            color="bg-purple-500"
          />
          <KpiCard
            title="Load Volume"
            value={today ? fmt(today.loadVolume) : '—'}
            subtitle="funded today"
            icon={ArrowUpRight}
            color="bg-blue-500"
          />
          <KpiCard
            title="Redeem Volume"
            value={today ? fmt(today.redeemVolume) : '—'}
            subtitle="spent today"
            icon={ArrowDownRight}
            color="bg-amber-500"
          />
        </div>
      </div>

      {/* ── Portfolio KPIs ────────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Portfolio</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Outstanding Liability"
            value={portfolio ? fmt(portfolio.outstandingLiability) : '—'}
            subtitle={`${portfolio?.activeCards ?? 0} active cards`}
            icon={DollarSign}
            color="bg-blue-600"
          />
          <KpiCard
            title="Total Cards"
            value={portfolio?.totalCards?.toLocaleString() ?? '—'}
            subtitle="all time"
            icon={CreditCard}
            color="bg-indigo-500"
          />
          <KpiCard
            title="Pending KYC"
            value={portfolio?.pendingKyc?.toString() ?? '—'}
            subtitle="awaiting identity check"
            icon={ShieldCheck}
            color={portfolio?.pendingKyc ? 'bg-amber-500' : 'bg-gray-400'}
          />
          <KpiCard
            title="Open Fraud Flags"
            value={flags?.length?.toString() ?? '—'}
            subtitle="requiring review"
            icon={AlertTriangle}
            color={flags?.length ? 'bg-red-500' : 'bg-gray-400'}
          />
        </div>
      </div>

      {/* ── 30-Day Volume Chart ───────────────────────────────────────────────── */}
      <div className="card p-6">
        <SectionHeading title="30-Day Transaction Volume" subtitle="Daily loads vs. redemptions" />
        {volumeSeries.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={volumeSeries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradLoad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradRedeem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(d: string) => format(parseISO(d), 'MMM d')}
                interval={4}
              />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: number, name: string) => [fmt(v), name === 'loads' ? 'Loads' : name === 'redeems' ? 'Redeems' : 'Refunds']}
                labelFormatter={(d: string) => format(parseISO(d), 'MMM d, yyyy')}
              />
              <Legend formatter={(v) => v === 'loads' ? 'Loads' : v === 'redeems' ? 'Redeems' : 'Refunds'} />
              <Area type="monotone" dataKey="loads" stroke="#3b82f6" fill="url(#gradLoad)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="redeems" stroke="#8b5cf6" fill="url(#gradRedeem)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="refunds" stroke="#10b981" fill="none" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[240px] flex items-center justify-center text-gray-400 text-sm">
            {isLoading ? 'Loading…' : 'No transaction data in the last 30 days'}
          </div>
        )}
      </div>

      {/* ── Bottom Row: Top Locations + Cohort + Fraud ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Top Redemption Locations */}
        <div className="card p-6">
          <SectionHeading title="Top Redemption Locations" subtitle="Last 30 days" />
          {topLocations.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topLocations} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="location" tick={{ fontSize: 10 }} width={90} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="totalAmount" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
              <Clock className="w-8 h-8 opacity-30" />
              <p>No location data yet</p>
            </div>
          )}
        </div>

        {/* Card Status Cohort */}
        <div className="card p-6">
          <SectionHeading title="Card Status Cohort" subtitle="All-time distribution" />
          {cohort.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie
                    data={cohort}
                    dataKey="cardCount"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={65}
                    paddingAngle={2}
                  >
                    {cohort.map((entry) => (
                      <Cell key={entry.status} fill={COHORT_COLORS[entry.status] ?? '#9ca3af'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => v.toLocaleString()} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-1.5">
                {cohort.map((c) => (
                  <div key={c.status} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: COHORT_COLORS[c.status] ?? '#9ca3af' }}
                      />
                      <span className="text-gray-600">{c.status}</span>
                    </div>
                    <span className="font-medium text-gray-800">{c.cardCount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
              {isLoading ? 'Loading…' : 'No card data'}
            </div>
          )}
        </div>

        {/* Recent Fraud Flags */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-900">Recent Fraud Flags</h2>
              <p className="text-xs text-gray-400 mt-0.5">Unresolved alerts</p>
            </div>
            <a href="/admin/fraud" className="text-indigo-600 text-xs font-medium hover:underline">View all</a>
          </div>
          {flags && flags.length > 0 ? (
            <div className="space-y-2.5">
              {flags.map((flag: {
                id: string; severity: string; reason: string;
                card?: { cardNumberMasked?: string }; createdAt: string;
              }) => (
                <div key={flag.id} className="flex items-start gap-2.5 p-2.5 bg-gray-50 rounded-lg">
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full mt-0.5 flex-shrink-0 ${
                    flag.severity === 'HIGH' || flag.severity === 'CRITICAL'
                      ? 'bg-red-100 text-red-700'
                      : flag.severity === 'MEDIUM'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {flag.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 truncate">{flag.reason}</p>
                    <p className="text-xs text-gray-400">{flag.card?.cardNumberMasked}</p>
                  </div>
                  <p className="text-xs text-gray-400 flex-shrink-0">
                    {format(parseISO(flag.createdAt), 'MMM d')}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[180px] flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
              <ShieldCheck className="w-8 h-8 opacity-30 text-emerald-400" />
              <p>No unresolved flags</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
