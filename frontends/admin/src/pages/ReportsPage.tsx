import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { Download } from 'lucide-react';
import { api, formatCents, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

type ReportType = 'issuance' | 'redemption' | 'dormancy' | 'escheatment' | 'gl-export' | 'card-liability';

const REPORTS: { key: ReportType; label: string }[] = [
  { key: 'card-liability', label: 'Card Liability' },
  { key: 'issuance',       label: 'Issuance' },
  { key: 'redemption',     label: 'Redemption' },
  { key: 'dormancy',       label: 'Dormancy Fees' },
  { key: 'escheatment',    label: 'Escheatment' },
  { key: 'gl-export',      label: 'GL Export' },
];

const DATE_RANGE_REPORTS: ReportType[] = ['issuance', 'redemption', 'gl-export'];

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Individual report renderers ─────────────────────────────────────────────

function LiabilityReport({ data }: { data: Array<{ programId: string; name: string; currency: string; floatBalance: string; totalCardBalance: string; activeCards: number; asOf: string }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
            <th className="px-6 py-3">Program</th>
            <th className="px-6 py-3 text-right">Float Balance</th>
            <th className="px-6 py-3 text-right">Total Card Balance</th>
            <th className="px-6 py-3 text-right">Active Cards</th>
            <th className="px-6 py-3">As Of</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((row) => (
            <tr key={row.programId} className="hover:bg-gray-50">
              <td className="px-6 py-4 font-medium text-gray-900">{row.name}</td>
              <td className="px-6 py-4 text-right tabular-nums">{formatCents(row.floatBalance)}</td>
              <td className="px-6 py-4 text-right tabular-nums">{formatCents(row.totalCardBalance)}</td>
              <td className="px-6 py-4 text-right">{row.activeCards.toLocaleString()}</td>
              <td className="px-6 py-4 text-gray-500 text-xs">{formatDate(row.asOf)}</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">No data</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

interface IssuanceSummary {
  totalCards: number;
  totalLoadedCents: string;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

function IssuanceReport({ data }: { data: { summary: IssuanceSummary } }) {
  const { summary } = data;
  const typeData = Object.entries(summary.byType).map(([name, value]) => ({ name, value }));
  const statusData = Object.entries(summary.byStatus).map(([name, value]) => ({ name, value }));
  const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444'];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card p-5">
          <p className="text-xs text-gray-500">Total Cards Issued</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{summary.totalCards.toLocaleString()}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-gray-500">Total Loaded Value</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatCents(summary.totalLoadedCents)}</p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">By Type</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={typeData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {typeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">By Status</h3>
          <ul className="space-y-2">
            {statusData.map(({ name, value }) => (
              <li key={name} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{name}</span>
                <span className="font-semibold tabular-nums">{value.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface RedemptionSummary {
  totalTransactions: number;
  totalRedemptionsCents: string;
  avgTransactionCents: string;
}

function RedemptionReport({ data }: { data: { summary: RedemptionSummary } }) {
  const { summary } = data;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {[
        { label: 'Total Transactions', value: summary.totalTransactions.toLocaleString() },
        { label: 'Total Redemptions', value: formatCents(summary.totalRedemptionsCents) },
        { label: 'Average Transaction', value: formatCents(summary.avgTransactionCents) },
      ].map(({ label, value }) => (
        <div key={label} className="card p-5">
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums mt-1">{value}</p>
        </div>
      ))}
    </div>
  );
}

function DormancyReport({ data }: { data: { assessments: Array<{ id: string; assessedAt: string; feeAmount: string; card: { id: string; last4: string } | null }>; totalFeesCents: string } }) {
  return (
    <div className="space-y-4">
      <div className="card p-5 flex justify-between items-center">
        <span className="text-sm text-gray-600">Total Fees Assessed</span>
        <span className="text-xl font-bold tabular-nums">{formatCents(data.totalFeesCents)}</span>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-6 py-3">Card (last 4)</th>
              <th className="px-6 py-3">Assessed At</th>
              <th className="px-6 py-3 text-right">Fee</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.assessments.slice(0, 100).map((a) => (
              <tr key={a.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-mono">•••• {a.card?.last4 ?? '—'}</td>
                <td className="px-6 py-3 text-gray-500">{formatDate(a.assessedAt)}</td>
                <td className="px-6 py-3 text-right tabular-nums text-red-600">{formatCents(a.feeAmount)}</td>
              </tr>
            ))}
            {data.assessments.length === 0 && (
              <tr><td colSpan={3} className="px-6 py-12 text-center text-gray-400">No dormancy fees in this period</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EscheatmentReport({ data }: { data: { records: Array<{ id: string; stateCode: string; amount: string; status: string; createdAt: string; card: { id: string; last4: string } | null }>; totalAmountCents: string; count: number } }) {
  return (
    <div className="space-y-4">
      <div className="card p-5 flex justify-between">
        <div>
          <p className="text-xs text-gray-500">Total Escheatment</p>
          <p className="text-xl font-bold tabular-nums">{formatCents(data.totalAmountCents)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Records</p>
          <p className="text-xl font-bold">{data.count}</p>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-6 py-3">State</th>
              <th className="px-6 py-3">Card</th>
              <th className="px-6 py-3 text-right">Amount</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.records.slice(0, 100).map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-semibold">{r.stateCode}</td>
                <td className="px-6 py-3 font-mono">•••• {r.card?.last4 ?? '—'}</td>
                <td className="px-6 py-3 text-right tabular-nums">{formatCents(r.amount)}</td>
                <td className="px-6 py-3">
                  <span className={`badge ${r.status === 'REMITTED' ? 'badge-green' : r.status === 'PENDING' ? 'badge-yellow' : 'badge-gray'}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-6 py-3 text-gray-500">{formatDate(r.createdAt)}</td>
              </tr>
            ))}
            {data.records.length === 0 && (
              <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">No escheatment records</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GlExportReport({ data }: { data: { lines: Array<{ entryId: string; entryType: string; postedAt: string; description: string; glAccountCode: string; glDescription: string; direction: string; amountCents: string; currency: string }>; programId: string } }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">{data.lines.length} journal lines</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">GL Account</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Dr/Cr</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.lines.slice(0, 200).map((line, i) => (
              <tr key={`${line.entryId}-${i}`} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-xs text-gray-500">{formatDate(line.postedAt)}</td>
                <td className="px-4 py-2">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono">{line.entryType}</span>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-brand-700">{line.glAccountCode}</td>
                <td className="px-4 py-2 text-gray-700 max-w-xs truncate">{line.glDescription}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs font-semibold ${line.direction === 'DEBIT' ? 'text-red-600' : 'text-green-600'}`}>
                    {line.direction}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCents(line.amountCents)}</td>
              </tr>
            ))}
            {data.lines.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">No journal entries in this period</td></tr>
            )}
          </tbody>
        </table>
        {data.lines.length > 200 && (
          <p className="px-4 py-2 text-xs text-gray-400 border-t">Showing 200 of {data.lines.length} lines. Download to see all.</p>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [report, setReport] = useState<ReportType>('card-liability');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ['reports', report, startDate, endDate],
    queryFn: () =>
      api
        .get<{ data: unknown }>(`/reports/${report}`, {
          params: DATE_RANGE_REPORTS.includes(report) ? { startDate, endDate } : {},
        })
        .then((r) => r.data.data),
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500">Financial and operational reports</p>
        </div>
        {!!data && (
          <button
            onClick={() => downloadJson(data, `${report}-${new Date().toISOString().slice(0, 10)}.json`)}
            className="btn-secondary flex items-center gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Export JSON
          </button>
        )}
      </div>

      {/* Report selector */}
      <div className="mb-4 flex flex-wrap gap-2">
        {REPORTS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setReport(key)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              report === key
                ? 'bg-brand-600 text-white'
                : 'bg-white text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Date range (only for time-bounded reports) */}
      {DATE_RANGE_REPORTS.includes(report) && (
        <div className="mb-4 flex gap-3">
          <div>
            <label className="label">Start Date</label>
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">End Date</label>
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Report content */}
      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div>
          {report === 'card-liability' && !!data && (
            <LiabilityReport data={data as Parameters<typeof LiabilityReport>[0]['data']} />
          )}
          {report === 'issuance' && !!data && (
            <IssuanceReport data={data as Parameters<typeof IssuanceReport>[0]['data']} />
          )}
          {report === 'redemption' && !!data && (
            <RedemptionReport data={data as Parameters<typeof RedemptionReport>[0]['data']} />
          )}
          {report === 'dormancy' && !!data && (
            <DormancyReport data={data as Parameters<typeof DormancyReport>[0]['data']} />
          )}
          {report === 'escheatment' && !!data && (
            <EscheatmentReport data={data as Parameters<typeof EscheatmentReport>[0]['data']} />
          )}
          {report === 'gl-export' && !!data && (
            <GlExportReport data={data as Parameters<typeof GlExportReport>[0]['data']} />
          )}
        </div>
      )}
    </div>
  );
}
