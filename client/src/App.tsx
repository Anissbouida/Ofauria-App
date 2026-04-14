import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InlineNotification from './components/ui/InlineNotification';
import { SettingsProvider } from './context/SettingsContext';
import { AuthProvider } from './context/AuthContext';
import { PermissionsProvider } from './context/PermissionsContext';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './features/auth/LoginPage';
import HomePage from './features/dashboard/HomePage';
import ProductsPage from './features/products/ProductsPage';
import OrdersPage from './features/orders/OrdersPage';
import POSPage from './features/pos/POSPage';
import CustomersPage from './features/customers/CustomersPage';
import InventoryPage from './features/inventory/InventoryPage';
import IngredientDetailPage from './features/inventory/IngredientDetailPage';
import RecipesPage from './features/recipes/RecipesPage';
import EmployeesPage from './features/employees/EmployeesPage';
import ReportsPage from './features/reports/ReportsPage';
import SalesPage from './features/sales/SalesPage';
import ProductionPage from './features/production/ProductionPage';
import PlanDetailPage from './features/production/PlanDetailPage';
import UsersPage from './features/users/UsersPage';
import SettingsPage from './features/settings/SettingsPage';
import AccountingPage from './features/accounting/AccountingPage';
import PurchasingPage from './features/purchasing/PurchasingPage';
import ReplenishmentPage from './features/replenishment/ReplenishmentPage';
import RequestDetailPage from './features/replenishment/RequestDetailPage';
import UnsoldDecisionsPage from './features/unsold/UnsoldDecisionsPage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
      <AuthProvider>
      <PermissionsProvider>
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
              <Route path="/inventory/:id" element={<IngredientDetailPage />} />
              <Route path="/recipes" element={<RecipesPage />} />
              <Route path="/production" element={<ProductionPage />} />
              <Route path="/production/:id" element={<PlanDetailPage />} />
              <Route path="/replenishment" element={<ReplenishmentPage />} />
              <Route path="/replenishment/:id" element={<RequestDetailPage />} />
              <Route path="/unsold" element={<UnsoldDecisionsPage />} />
              <Route path="/employees" element={<EmployeesPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/accounting" element={<AccountingPage />} />
              <Route path="/purchasing" element={<PurchasingPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <InlineNotification />
      </PermissionsProvider>
      </AuthProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
