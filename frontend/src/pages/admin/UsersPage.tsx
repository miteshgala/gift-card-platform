import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getErrorMessage } from '../../lib/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  PROGRAM_ADMIN: 'bg-blue-100 text-blue-700',
  FINANCE: 'bg-green-100 text-green-700',
  MARKETING: 'bg-amber-100 text-amber-700',
  SUPPORT: 'bg-cyan-100 text-cyan-700',
  READ_ONLY: 'bg-gray-100 text-gray-600',
};

const ROLES = ['SUPER_ADMIN', 'PROGRAM_ADMIN', 'FINANCE', 'MARKETING', 'SUPPORT', 'READ_ONLY'];

export default function UsersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users?limit=50')).data,
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`/users/${userId}/role`, { role }),
    onSuccess: () => { toast.success('Role updated'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const deactivate = useMutation({
    mutationFn: (userId: string) => api.patch(`/users/${userId}/deactivate`),
    onSuccess: () => { toast.success('User deactivated'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const users = data?.data ?? [];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Login</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Change Role</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : users.map((user: {
              id: string; firstName: string; lastName: string; email: string;
              role: string; isActive: boolean; lastLoginAt?: string;
            }) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium">{user.firstName} {user.lastName}</p>
                    <p className="text-gray-400 text-xs">{user.email}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`badge ${ROLE_COLORS[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
                    {user.role.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`badge ${user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {user.lastLoginAt ? format(new Date(user.lastLoginAt), 'MMM d, h:mm a') : 'Never'}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={user.role}
                    onChange={(e) => changeRole.mutate({ userId: user.id, role: e.target.value })}
                    className="input w-auto text-xs py-1"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  {user.isActive && (
                    <button
                      onClick={() => { if (confirm('Deactivate this user?')) deactivate.mutate(user.id); }}
                      className="text-red-500 text-xs hover:underline"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
