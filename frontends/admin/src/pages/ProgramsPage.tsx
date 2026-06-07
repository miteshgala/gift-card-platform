import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Building2 } from 'lucide-react';
import { api, formatCents, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { getCurrentUser } from '@/lib/auth';

interface Program {
  id: string;
  slug: string;
  name: string;
  currency: string;
  status: string;
  openLoop: boolean;
  cardExpiryDays: number;
  budgetCap?: string;
  createdAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'badge-green',
  SUSPENDED: 'badge-red',
};

export default function ProgramsPage() {
  const navigate = useNavigate();
  const user = getCurrentUser();

  const { data, isLoading } = useQuery({
    queryKey: ['programs'],
    queryFn: () => api.get<{ data: Program[] }>('/programs').then((r) => r.data.data),
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Programs</h1>
          <p className="text-sm text-gray-500">Manage gift card programs</p>
        </div>
        {user?.role === 'SUPER_ADMIN' && (
          <button className="btn-primary">
            <Building2 className="h-4 w-4" />
            New Program
          </button>
        )}
      </div>

      <div className="card">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center"><LoadingSpinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-6 py-3">Program</th>
                  <th className="px-6 py-3">Slug</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Currency</th>
                  <th className="px-6 py-3">Budget Cap</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Created</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/programs/${p.id}`)}
                  >
                    <td className="px-6 py-4 font-medium text-gray-900">{p.name}</td>
                    <td className="px-6 py-4 font-mono text-gray-600">{p.slug}</td>
                    <td className="px-6 py-4 text-gray-600">{p.openLoop ? 'Open Loop' : 'Closed Loop'}</td>
                    <td className="px-6 py-4 text-gray-600">{p.currency}</td>
                    <td className="px-6 py-4 text-gray-600">{p.budgetCap ? formatCents(p.budgetCap) : '—'}</td>
                    <td className="px-6 py-4">
                      <span className={STATUS_BADGE[p.status] ?? 'badge-gray'}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{formatDate(p.createdAt)}</td>
                    <td className="px-4 py-4"><ChevronRight className="h-4 w-4 text-gray-400" /></td>
                  </tr>
                ))}
                {(!data || data.length === 0) && (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-400">No programs found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
