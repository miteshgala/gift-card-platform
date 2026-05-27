import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { api } from '../../lib/api';

export default function ProgramsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['programs'],
    queryFn: async () => (await api.get('/programs')).data.data,
  });

  const programs = data ?? [];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Programs</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <p className="text-gray-400">Loading...</p>
        ) : programs.map((program: {
          id: string; name: string; slug: string; currency: string;
          budgetCap?: number; budgetUtilized: number; isActive: boolean; cardExpiryDays: number;
        }) => (
          <div key={program.id} className="card p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2.5 bg-brand-50 rounded-lg">
                <Building2 className="w-5 h-5 text-brand-500" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{program.name}</h3>
                <p className="text-gray-400 text-xs">{program.slug}</p>
              </div>
              <span className={`ml-auto badge ${program.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {program.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Currency</dt>
                <dd className="font-medium">{program.currency}</dd>
              </div>
              {program.budgetCap && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Budget Cap</dt>
                    <dd className="font-medium">${Number(program.budgetCap).toLocaleString()}</dd>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">Utilized</span>
                      <span>${Number(program.budgetUtilized).toLocaleString()}</span>
                    </div>
                    <div className="bg-gray-100 rounded-full h-1.5">
                      <div
                        className="bg-brand-500 h-1.5 rounded-full"
                        style={{ width: `${Math.min(100, (Number(program.budgetUtilized) / Number(program.budgetCap)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500">Card Expiry</dt>
                <dd className="font-medium">{program.cardExpiryDays} days</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
