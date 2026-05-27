import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store/auth';
import { useCurrentUser } from './hooks/useAuth';
import { getAccessToken } from './lib/api';

// Layouts
import AdminLayout from './components/layout/AdminLayout';
import PublicLayout from './components/layout/PublicLayout';

// Admin pages
import Dashboard from './pages/admin/Dashboard';
import CardsPage from './pages/admin/CardsPage';
import CardDetailPage from './pages/admin/CardDetailPage';
import OrdersPage from './pages/admin/OrdersPage';
import ReportsPage from './pages/admin/ReportsPage';
import UsersPage from './pages/admin/UsersPage';
import FraudPage from './pages/admin/FraudPage';
import ProgramsPage from './pages/admin/ProgramsPage';
import SettingsPage from './pages/admin/SettingsPage';

// Public / Customer pages
import LoginPage from './pages/LoginPage';
import BalanceCheckPage from './pages/customer/BalanceCheckPage';
import RegisterCardPage from './pages/customer/RegisterCardPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasToken = !!getAccessToken();

  if (!isAuthenticated && !hasToken) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function App() {
  const { refetch } = useCurrentUser();

  // Bootstrap auth from stored token on mount
  useEffect(() => {
    if (getAccessToken()) refetch();
  }, []);

  return (
    <Routes>
      {/* Auth */}
      <Route path="/login" element={<LoginPage />} />

      {/* Customer self-service */}
      <Route element={<PublicLayout />}>
        <Route path="/balance" element={<BalanceCheckPage />} />
        <Route path="/register-card" element={<RegisterCardPage />} />
      </Route>

      {/* Admin */}
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="cards" element={<CardsPage />} />
        <Route path="cards/:cardId" element={<CardDetailPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="fraud" element={<FraudPage />} />
        <Route path="programs" element={<ProgramsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      {/* Default */}
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default App;
