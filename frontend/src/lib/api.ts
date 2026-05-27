import axios, { AxiosInstance, AxiosError } from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

// ─── Axios instance ───────────────────────────────────────────────────────────

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// ─── Request interceptor: attach access token ─────────────────────────────────

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Response interceptor: auto-refresh on 401 ────────────────────────────────

let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config!;

    if (error.response?.status === 401 && !(original as { _retry?: boolean })._retry) {
      (original as { _retry?: boolean })._retry = true;

      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token) => {
            original.headers!.Authorization = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }

      isRefreshing = true;
      try {
        const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefresh } = res.data.data;
        setTokens(accessToken, newRefresh);
        refreshQueue.forEach((cb) => cb(accessToken));
        refreshQueue = [];
        original.headers!.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch {
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ─── Token helpers ────────────────────────────────────────────────────────────

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem('access_token', accessToken);
  localStorage.setItem('refresh_token', refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

export function getAccessToken(): string | null {
  return localStorage.getItem('access_token');
}

// ─── API helpers ──────────────────────────────────────────────────────────────

export function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    return error.response?.data?.error?.message ?? error.message;
  }
  return 'An unexpected error occurred';
}
