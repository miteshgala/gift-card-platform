import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, TrendingUp, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';

const REPORTS = [
  { id: 'liability', label: 'Outstanding Liability', icon: FileText, desc: 'Total unredeemed card value' },
  { id: 'breakage', label: 'Breakage Report', icon: AlertCircle, desc: 'Expired/dormant value analysis' },
  { id: 'redemption-rate', label: 'Redemption Rate', icon: TrendingUp, desc: 'By program and date range' },
  { id: 'transaction-volume', label: 'Transaction Volume', icon: TrendingUp, desc: 'Volume by type and period' },
  { id: 'escheatment', label: 'Escheatment Report', icon: FileText, desc: 'Dormant cards by state' },
];

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState('liability');
  const [format, setFormat] = useState('json');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['report', activeReport, format, from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ format: 'json' });
      if (from) params.append('from', from);
      if (to) params.append('to', to);
      const res = await api.get(`/reports/${activeReport}?${params}`);
      return res.data.data;
    },
  });

  const handleExport = async (fmt: 'csv' | 'pdf') => {
    const params = new URLSearchParams({ format: fmt });
    if (from) params.append('from', from);
    if (to) params.append('to', to);

    const token = localStorage.getItem('access_token');
    const res = await fetch(`/api/v1/reports/${activeReport}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeReport}-report.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Reports</h1>

      <div className="flex gap-6">
        {/* Report selector */}
        <div className="w-64 flex-shrink-0 space-y-1">
          {REPORTS.map((r) => {
            const Icon = r.icon;
            return (
              <button
                key={r.id}
                onClick={() => setActiveReport(r.id)}
                className={`w-full flex items-start gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                  activeReport === r.id
                    ? 'bg-brand-50 border border-brand-200'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <Icon className={`w-5 h-5 mt-0.5 ${activeReport === r.id ? 'text-brand-500' : 'text-gray-400'}`} />
                <div>
                  <p className={`text-sm font-medium ${activeReport === r.id ? 'text-brand-700' : 'text-gray-700'}`}>
                    {r.label}
                  </p>
                  <p className="text-xs text-gray-400">{r.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Report content */}
        <div className="flex-1 space-y-4">
          {/* Filters */}
          <div className="card p-4 flex items-center gap-4">
            <div>
              <label className="label">From</label>
              <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => handleExport('csv')} className="btn-secondary">
                <Download className="w-4 h-4" />
                CSV
              </button>
              <button onClick={() => handleExport('pdf')} className="btn-secondary">
                <Download className="w-4 h-4" />
                PDF
              </button>
            </div>
          </div>

          {/* Data display */}
          <div className="card p-6">
            <h2 className="font-semibold text-gray-900 mb-4">
              {REPORTS.find((r) => r.id === activeReport)?.label}
            </h2>
            {isLoading ? (
              <div className="py-8 text-center text-gray-400">Loading report...</div>
            ) : data ? (
              <div className="space-y-4">
                {/* Display as key-value pairs or table */}
                {Array.isArray(data) ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          {Object.keys(data[0] ?? {}).map((k) => (
                            <th key={k} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.slice(0, 50).map((row: Record<string, unknown>, i: number) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                            {Object.values(row).map((v, j) => (
                              <td key={j} className="px-3 py-2 text-sm">{String(v ?? '—')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <dl className="grid grid-cols-2 gap-4">
                    {Object.entries(data as Record<string, unknown>).map(([k, v]) => (
                      <div key={k} className="bg-gray-50 rounded-lg p-4">
                        <dt className="text-xs text-gray-500 uppercase tracking-wide">{k.replace(/([A-Z])/g, ' $1')}</dt>
                        <dd className="text-lg font-bold text-gray-900 mt-1">{String(v ?? '—')}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-gray-400">Select a report</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
