import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, setTokens, clearTokens } from '../lib/api';
import { useAuthStore } from '../store/auth';

interface LoginInput {
  email: string;
  password: string;
}

export function useLogin() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: async (data: LoginInput) => {
      const res = await api.post('/auth/login', data);
      return res.data.data;
    },
    onSuccess: (data) => {
      setTokens(data.accessToken, data.refreshToken);
      setUser(data.user);
      navigate('/admin');
      toast.success(`Welcome back, ${data.user.firstName}!`);
    },
    onError: () => {
      toast.error('Invalid email or password');
    },
  });
}

export function useLogout() {
  const navigate = useNavigate();
  const clearUser = useAuthStore((s) => s.clearUser);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        await api.post('/auth/logout', { refreshToken }).catch(() => {});
      }
    },
    onSettled: () => {
      clearTokens();
      clearUser();
      qc.clear();
      navigate('/login');
    },
  });
}

export function useCurrentUser() {
  const setUser = useAuthStore((s) => s.setUser);

  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.get('/auth/me');
      setUser(res.data.data);
      return res.data.data;
    },
    enabled: !!localStorage.getItem('access_token'),
    retry: false,
  });
}
