import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
  AreaChart, Area,
} from 'recharts';
import { CreditCard, DollarSign, TrendingUp, ShoppingBag, Calendar } from 'lucide-react';
import { api, formatCents } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { getCurrentUser } from '@/lib/auth';
import { format, subDays, eachDayOfInterval, parseISO } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────
interface IssuanceCard {
  id: string;
  cardType: string;
  initialLoad: string;
  status: string;
  createdAt: string;
}

interface IssuanceSummary {
  totalCards: number;
  totalLoadedCents: string;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

interface RedemptionTx {
  id: string;
  capturedAmount: string;
  reversedAmount: string;
  merchantMcc?: string;
  capturedAt: string;
}

interface RedemptionSummary {
  totalTransactions: number;
  totalRedemptionsCents: string;
  avgTransactionCents: string;
}

interface ProgramLiability {
  programId: string;
  name: string;
  floatBalance: string;
  totalCardBalance: string;
  activeCards: number;
}

interface KycCheck {
  id: string;
  status: string;
  checkType: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7'];

const PRESET_RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

function centsToFloat(v: string | number): number {
  return Number(v) / 100;
}

function buildDailyIssuance(cards: IssuanceCard[], startDate: Date, endDate: Date) {
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const map: Record<string, { date: string; count: number; loaded: number }> = {};
  days.forEach((d) => {
    const key = format(d, 'MM/dd');
    map[key] = { date: key, count: 0, loaded: 0 };
  });
  cards.forEach((c) => {
    const key = format(parseISO(c.createdAt), 'MM/dd');
    if (map[key]) {
      map[key].count += 1;
      map[key].loaded += centsToFloat(c.initialLoad);
    }
  });
  return Object.values(map);
}

function buildDailyRedemptions(txs: RedemptionTx[], startDate: Date, endDate: Date) {
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const map: Record<string, { date: string; amount: number; count: number }> = {};
  days.forEach((d) => {
    const key = format(d, 'MM/dd');
    map[key] = { date: key, amount: 0, count: 0 };
  });
  txs.forEach((tx) => {
    const key = format(parseISO(tx.capturedAt), 'MM/dd');
    if (map[key]) {
      map[key].amount += centsToFloat(Number(tx.capturedAmount) - Number(tx.reversedAmount));
      map[key].count += 1;
    }
  });
  return Object.values(map);
}

// ─── Subcomponents ────────────────────────────────────────────────────────────
interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  color?: string;
}
function MetricCard({ label, value, sub, icon, color = 'text-brand-600' }: MetricCardProps) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold text-gray-900">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
        </div>
        <div className={`rounded-lg bg-gray-50 p-2 ${color}`}>{icon}</div>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-gray-700">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-500">{p.name}:</span>
          <span className="font-medium text-gray-900">
            {typeof p.value === 'number' && p.name.toLowerCase().includes('amount')
              ? `$${p.value.toFixed(2)}`
              : typeof p.value === 'number' && p.name.toLowerCase().includes('loaded')
              ? `$${p.value.toFixed(2)}`
              : p.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const user = getCurrentUser();
  const [preset, setPreset] = useState<7 | 30 | 90>(30);

  const endDate = useMemo(() => new Date(), []);
  const startDate = useMemo(() => subDays(endDate, preset), [endDate, preset]);

  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  const issuanceQ = useQuery({
    queryKey: ['analytics', 'issuance', preset],
    queryFn: () =>
      api.get<{ data: { summary: IssuanceSummary; cards: IssuanceCard[] } }>('/reports/issuance', {
        params: { startDate: startIso, endDate: endIso, programId: user?.programId },
      }).then((r) => r.data.data),
    staleTime: 2 * 60 * 1000,
  });

  const redemptionQ = useQuery({
    queryKey: ['analytics', 'redemption', preset],
    queryFn: () =>
      api.get<{ data: { summary: RedemptionSummary; transactions: RedemptionTx[] } }>('/reports/redemption', {
        params: { startDate: startIso, endDate: endIso, programId: user?.programId },
      }).then((r) => r.data.data),
    staleTime: 2 * 60 * 1000,
  });

  const liabilityQ = useQuery({
    queryKey: ['analytics', 'liability'],
    queryFn: () =>
      api.get<{ data: ProgramLiability[] }>('/reports/card-liability').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const kycQ = useQuery({
    queryKey: ['analytics', 'kyc'],
    queryFn: () =>
      api.get<{ data: KycCheck[] }>('/kyc', { params: { limit: 500 } }).then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = issuanceQ.isLoading || redemptionQ.isLoading || liabilityQ.isLoading;

  // ── Derived data ───────────────────────────────────────────────────────────
  const dailyIssuance = useMemo(
    () => (issuanceQ.data ? buildDailyIssuance(issuanceQ.data.cards, startDate, endDate) : []),
    [issuanceQ.data, startDate, endDate],
  );

  const dailyRedemptions = useMemo(
    () => (redemptionQ.data ? buildDailyRedemptions(redemptionQ.data.transactions, startDate, endDate) : []),
    [redemptionQ.data, startDate, endDate],
  );

  const cardTypeData = useMemo(() => {
    const bt = issuanceQ.data?.summary.byType ?? {};
    return Object.entries(bt)
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0);
  }, [issuanceQ.data]);

  const kycStatusData = useMemo(() => {
    const checks = kycQ.data ?? [];
    const counts: Record<string, number> = {};
    checks.forEach((c) => { counts[c.status] = (counts[c.status] ?? 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [kycQ.data]);

  const liabilityBarData = useMemo(
    () =>
      (liabilityQ.data ?? []).map((p) => ({
        name: p.name.length > 16 ? p.name.slice(0, 14) + '…' : p.name,
        Float: centsToFloat(p.floatBalance),
        Liability: centsToFloat(p.totalCardBalance),
      })),
    [liabilityQ.data],
  );

  // Compress daily data for 90d (group to weekly ticks to avoid clutter)
  const tickInterval = preset === 7 ? 0 : preset === 30 ? 4 : 13;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const { summary: iSummary } = issuanceQ.data ?? { summary: { totalCards: 0, totalLoadedCents: '0', byType: {}, byStatus: {} } };
  const { summary: rSummary } = redemptionQ.data ?? { summary: { totalTransactions: 0, totalRedemptionsCents: '0', avgTransactionCents: '0' } };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500">Platform performance and financial metrics</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-white p-1 shadow-sm">
          <Calendar className="mx-2 h-4 w-4 text-gray-400" />
          {PRESET_RANGES.map(({ label, days }) => (
            <button
              key={days}
              onClick={() => setPreset(days as 7 | 30 | 90)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                preset === days
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Cards Issued"
          value={iSummary.totalCards.toLocaleString()}
          sub={`Last ${preset} days`}
          icon={<CreditCard className="h-5 w-5" />}
          color="text-brand-600"
        />
        <MetricCard
          label="Total Loaded"
          value={formatCents(iSummary.totalLoadedCents)}
          sub="Initial load value"
          icon={<DollarSign className="h-5 w-5" />}
          color="text-green-600"
        />
        <MetricCard
          label="Redemptions"
          value={rSummary.totalTransactions.toLocaleString()}
          sub={formatCents(rSummary.totalRedemptionsCents) + ' redeemed'}
          icon={<ShoppingBag className="h-5 w-5" />}
          color="text-purple-600"
        />
        <MetricCard
          label="Avg Transaction"
          value={formatCents(rSummary.avgTransactionCents)}
          sub="Per redemption"
          icon={<TrendingUp className="h-5 w-5" />}
          color="text-orange-600"
        />
      </div>

      {/* Row 1: Issuance trend */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Daily Card Issuance</h2>
          <p className="mb-4 text-xs text-gray-400">Cards issued per day</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={dailyIssuance} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="countGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={tickInterval} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="count" name="Cards" stroke="#6366f1" fill="url(#countGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Card Type Mix</h2>
          <p className="mb-4 text-xs text-gray-400">Distribution by type</p>
          {cardTypeData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie
                    data={cardTypeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {cardTypeData.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => v.toLocaleString()} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1">
                {cardTypeData.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                      <span className="text-gray-600">{d.name}</span>
                    </div>
                    <span className="font-medium text-gray-900">{d.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-8 text-center text-sm text-gray-400">No issuance data</p>
          )}
        </div>
      </div>

      {/* Row 2: Redemptions trend */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Daily Redemption Volume</h2>
          <p className="mb-4 text-xs text-gray-400">USD redeemed per day</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={dailyRedemptions} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="amountGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={tickInterval} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v as number).toFixed(0)}`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="amount" name="Amount ($)" stroke="#22c55e" fill="url(#amountGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">KYC Check Status</h2>
          <p className="mb-4 text-xs text-gray-400">All-time distribution</p>
          {kycStatusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={kycStatusData} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={90} />
                <Tooltip />
                <Bar dataKey="value" name="Checks" radius={[0, 3, 3, 0]}>
                  {kycStatusData.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="mt-8 text-center text-sm text-gray-400">No KYC data</p>
          )}
        </div>
      </div>

      {/* Row 3: Float vs Liability by program */}
      {liabilityBarData.length > 0 && (
        <div className="mb-6 card p-5">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Float vs. Card Liability by Program</h2>
          <p className="mb-4 text-xs text-gray-400">Current balances (USD)</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={liabilityBarData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v as number).toLocaleString()}`} />
              <Tooltip
                formatter={(value: number) => `$${value.toFixed(2)}`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Float" fill="#6366f1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Liability" fill="#22c55e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Row 4: Card status breakdown */}
      {iSummary.totalCards > 0 && (
        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Card Status Breakdown</h2>
          <p className="mb-4 text-xs text-gray-400">For cards issued in the selected period</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(iSummary.byStatus).map(([status, count], i) => (
              <div key={status} className="rounded-lg bg-gray-50 p-4 text-center">
                <div
                  className="mb-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ background: PALETTE[i % PALETTE.length] + '20' }}
                >
                  <span className="h-3 w-3 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                </div>
                <div className="text-xl font-semibold text-gray-900">{(count as number).toLocaleString()}</div>
                <div className="text-xs text-gray-500">{status.replace('_', ' ')}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
