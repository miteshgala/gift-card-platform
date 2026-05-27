import { Outlet, Link } from 'react-router-dom';
import { Gift } from 'lucide-react';

export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-purple-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Gift className="w-7 h-7 text-brand-500" />
          <span className="font-bold text-lg text-gray-900">GiftCard Platform</span>
          <nav className="ml-auto flex items-center gap-4 text-sm">
            <Link to="/balance" className="text-gray-600 hover:text-brand-600">Check Balance</Link>
            <Link to="/register-card" className="text-gray-600 hover:text-brand-600">Register Card</Link>
            <Link to="/login" className="btn-primary text-sm px-3 py-1.5">Admin Login</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-12">
        <Outlet />
      </main>
    </div>
  );
}
