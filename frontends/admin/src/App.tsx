import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { isAuthenticated } from '@/lib/auth';
import Layout from '@/components/Layout';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

// Lazy-load pages for code splitting
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const ProgramsPage = lazy(() => import('@/pages/ProgramsPage'));
const ProgramDetailPage = lazy(() => import('@/pages/ProgramDetailPage'));
const CardsPage = lazy(() => import('@/pages/CardsPage'));
const CardDetailPage = lazy(() => import('@/pages/CardDetailPage'));
const OrdersPage = lazy(() => import('@/pages/OrdersPage'));
const OrderDetailPage = lazy(() => import('@/pages/OrderDetailPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const FraudPage = lazy(() => import('@/pages/FraudPage'));
const DisputesPage = lazy(() => import('@/pages/DisputesPage'));
const SettlementPage = lazy(() => import('@/pages/SettlementPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const WebhooksPage = lazy(() => import('@/pages/WebhooksPage'));
const AuditLogPage = lazy(() => import('@/pages/AuditLogPage'));
const IntegrationsPage = lazy(() => import('@/pages/IntegrationsPage'));
const KycPage = lazy(() => import('@/pages/KycPage'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="programs" element={<ProgramsPage />} />
          <Route path="programs/:id" element={<ProgramDetailPage />} />
          <Route path="cards" element={<CardsPage />} />
          <Route path="cards/:id" element={<CardDetailPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="fraud" element={<FraudPage />} />
          <Route path="disputes" element={<DisputesPage />} />
          <Route path="settlement" element={<SettlementPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="webhooks" element={<WebhooksPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="kyc" element={<KycPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
