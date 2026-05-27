import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  programId?: string;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  setUser: (user: AuthUser) => void;
  clearUser: () => void;
}

// Simple in-memory store (no localStorage for auth state — tokens are in localStorage)
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  setUser: (user) => set({ user, isAuthenticated: true }),
  clearUser: () => set({ user: null, isAuthenticated: false }),
}));
