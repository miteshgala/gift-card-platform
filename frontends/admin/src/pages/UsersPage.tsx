import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, PauseCircle } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { v4 as uuid } from 'uuid';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  programId?: string;
  status: string;
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'badge-green',
  INVITED: 'badge-yellow',
  SUSPENDED: 'badge-red',
  DEACTIVATED: 'badge-gray',
};

const ROLE_BADGE: Record<string, string> = {
  SUPER_ADMIN: 'badge-red',
  PROGRAM_ADMIN: 'badge-blue',
  PROGRAM_ANALYST: 'badge-blue',
  SUPPORT_AGENT: 'badge-gray',
  AUDITOR: 'badge-gray',
  API_SERVICE: 'badge-gray',
};

export default function UsersPage() {
  const qc = useQueryClient();
  const [inviteModal, setInviteModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ data: User[] }>('/users', { params: { limit: 100 } }).then((r) => r.data.data),
  });

  const suspend = useMutation({
    mutationFn: (userId: string) =>
      api.patch(`/users/${userId}/suspend`, {}, { headers: { 'Idempotency-Key': uuid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500">Admin and API users</p>
        </div>
        <button className="btn-primary" onClick={() => setInviteModal(true)}>
          <UserPlus className="h-4 w-4" />
          Invite User
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center"><LoadingSpinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-6 py-3">User</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Email Verified</th>
                  <th className="px-6 py-3">Last Login</th>
                  <th className="px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{user.firstName} {user.lastName}</div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={ROLE_BADGE[user.role] ?? 'badge-gray'}>
                        {user.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={STATUS_BADGE[user.status] ?? 'badge-gray'}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {user.emailVerified ? '✓' : '—'}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {user.lastLoginAt ? formatDate(user.lastLoginAt) : 'Never'}
                    </td>
                    <td className="px-6 py-4">
                      {user.status === 'ACTIVE' && (
                        <button
                          onClick={() => suspend.mutate(user.id)}
                          disabled={suspend.isPending}
                          className="flex items-center gap-1 text-xs text-yellow-600 hover:text-yellow-800"
                        >
                          <PauseCircle className="h-3.5 w-3.5" />
                          Suspend
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(!data || data.length === 0) && (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-400">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* TODO: Invite modal */}
      {inviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="card w-full max-w-md p-6">
            <h2 className="mb-4 font-semibold text-gray-900">Invite User</h2>
            <p className="text-sm text-gray-500 mb-4">
              An invite link will be generated and can be sent to the new user.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setInviteModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => setInviteModal(false)}>Send Invite</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
