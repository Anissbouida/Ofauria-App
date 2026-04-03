import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { SettingsProvider } from './context/SettingsContext';
import { AuthProvider } from './context/AuthContext';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './features/auth/LoginPage';
import HomePage from './features/dashboard/HomePage';
import ProductsPage from './features/products/ProductsPage';
import OrdersPage from './features/orders/OrdersPage';
import POSPage from './features/pos/POSPage';
import CustomersPage from './features/customers/CustomersPage';
import InventoryPage from './features/inventory/InventoryPage';
import RecipesPage from './features/recipes/RecipesPage';
import EmployeesPage from './features/employees/EmployeesPage';
import ReportsPage from './features/reports/ReportsPage';
import SalesPage from './features/sales/SalesPage';
import ProductionPage from './features/production/ProductionPage';
import PlanDetailPage from './features/production/PlanDetailPage';
import UsersPage from './features/users/UsersPage';
import SettingsPage from './features/settings/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/pos" element={<POSPage />} />
              <Route path="/sales" element={<SalesPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/recipes" element={<RecipesPage />} />
              <Route path="/production" element={<ProductionPage />} />
              <Route path="/production/:id" element={<PlanDetailPage />} />
              <Route path="/employees" element={<EmployeesPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      </AuthProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
