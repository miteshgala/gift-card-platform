import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';

const LoginPage        = lazy(() => import('./pages/LoginPage'));
const BalancePage      = lazy(() => import('./pages/BalancePage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const ReloadPage       = lazy(() => import('./pages/ReloadPage'));
const DisputePage      = lazy(() => import('./pages/DisputePage'));
const PinChangePage    = lazy(() => import('./pages/PinChangePage'));
const RegisterPage     = lazy(() => import('./pages/RegisterPage'));

function isLoggedIn() { return !!localStorage.getItem('ch_token'); }

function RequireAuth({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-gray-400 text-sm">Loading…</div>}>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/balance"      element={<RequireAuth><BalancePage /></RequireAuth>} />
        <Route path="/transactions" element={<RequireAuth><TransactionsPage /></RequireAuth>} />
        <Route path="/reload"       element={<RequireAuth><ReloadPage /></RequireAuth>} />
        <Route path="/dispute"      element={<RequireAuth><DisputePage /></RequireAuth>} />
        <Route path="/pin"          element={<RequireAuth><PinChangePage /></RequireAuth>} />
        <Route path="/register"     element={<RegisterPage />} />
        <Route path="*"             element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
