import { LogOut, Bell } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function Header() {
  const { logout } = useAuth();

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div />
      <div className="flex items-center gap-4">
        <button className="p-2 rounded-lg hover:bg-gray-100 relative">
          <Bell size={20} className="text-gray-500" />
        </button>
        <button
          onClick={logout}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-red-600 transition-colors"
        >
          <LogOut size={18} />
          Deconnexion
        </button>
      </div>
    </header>
  );
}
