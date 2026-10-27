import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InlineNotification from './components/ui/InlineNotification';
import { SettingsProvider } from './context/SettingsContext';
import { ConfirmProvider } from './components/ui/ConfirmDialog';
import { AuthProvider } from './context/AuthContext';
import { PermissionsProvider } from './context/PermissionsContext';
import { ProductionTimerProvider } from './context/ProductionTimerContext';
import ProductionTimerWidget from './components/ui/ProductionTimerWidget';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './features/auth/LoginPage';
import HomePage from './features/dashboard/HomePage';
import ProductsPage from './features/products/ProductsPage';
import OrdersPage from './features/orders/OrdersPage';
import POSPage from './features/pos/POSPage';
import CustomersPage from './features/customers/CustomersPage';
import StockPage from './features/stock/StockPage';
import IngredientDetailPage from './features/stock/IngredientDetailPage';
import RecipesPage from './features/recipes/RecipesPage';
import NomenclaturePage from './features/recipes/NomenclaturePage';
import PreparationPage from './features/recipes/PreparationPage';
import EmployeesPage from './features/employees/EmployeesPage';
import EmployeeDetailPage from './features/employees/EmployeeDetailPage';
import ReportsPage from './features/reports/ReportsPage';
import SalesPage from './features/sales/SalesPage';
import ProductionPage from './features/production/ProductionPage';
import PlanDetailPage from './features/production/PlanDetailPage';
import BonSortiePrelevementPage from './features/production/BonSortiePrelevementPage';
import ProductionDashboardPage from './features/production/ProductionDashboardPage';
import ProductionLayout from './features/production/ProductionLayout';
import SalesLayout from './features/sales/SalesLayout';
import ProjectsPage from './features/projects/ProjectsPage';
import ProjectDetailPage from './features/projects/ProjectDetailPage';
import UsersPage from './features/users/UsersPage';
import SettingsPage from './features/settings/SettingsPage';
import AccountingPage from './features/accounting/AccountingPage';
import PurchasingPage from './features/purchasing/PurchasingPage';
import ReplenishmentPage from './features/replenishment/ReplenishmentPage';
import RequestDetailPage from './features/replenishment/RequestDetailPage';
import JourneeBoutiquePage from './features/boutique/JourneeBoutiquePage';
import ControlePage from './features/controle/ControlePage';
import ForecastPage from './features/forecast/ForecastPage';
import HaccpPage from './features/haccp/HaccpPage';
import OpeningInventoryCheckPage from './features/inventory-check/OpeningInventoryCheckPage';
import LegacyRedirect from './components/LegacyRedirect';
import ApprovalsPage from './features/approvals/ApprovalsPage';
import RecallPage from './features/traceability/RecallPage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
      <ConfirmProvider>
      <AuthProvider>
      <PermissionsProvider>
      <ProductionTimerProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/pos" element={<POSPage />} />
              {/* Module Ventes : commandes, ventes, clients et produits sous une même barre latérale. */}
              <Route element={<SalesLayout />}>
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/sales" element={<SalesPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
              </Route>
              {/* Module Stock = ex-Économat (/inventory) + ex-Pesage (/warehouse), fusion du
                  2026-10-11. Les anciennes URL redirigent (bookmarks, notifications deja emises). */}
              <Route path="/stock" element={<StockPage />} />
              <Route path="/stock/:id" element={<IngredientDetailPage />} />
              <Route path="/stock/bsi/:id" element={<BonSortiePrelevementPage />} />
              <Route path="/inventory" element={<LegacyRedirect from="inventory" to="/stock" />} />
              <Route path="/inventory/:id" element={<LegacyRedirect from="inventory" to="/stock/:id" />} />
              <Route path="/warehouse" element={<LegacyRedirect from="warehouse" to="/stock" />} />
              <Route path="/warehouse/bsi/:id" element={<LegacyRedirect from="warehouse" to="/stock/bsi/:id" />} />
              {/* Emballages repliés dans le Stock (onglet Consommables). */}
              <Route path="/packaging" element={<Navigate to="/stock?tab=consumables" replace />} />
              <Route path="/recipes/:id/nomenclature" element={<NomenclaturePage />} />
              {/* Préparations de base : même ossature, contenu adapté à une fournée. */}
              <Route path="/recipes/:id/preparation" element={<PreparationPage />} />
              {/* Module Production : plusieurs pages sous une même barre latérale. Les pages de
                  détail (plan, nomenclature, préparation, demande) restent en pleine page. */}
              <Route element={<ProductionLayout />}>
                <Route path="/production" element={<ProductionPage />} />
                <Route path="/production/dashboard" element={<ProductionDashboardPage />} />
                <Route path="/forecast" element={<ForecastPage />} />
                <Route path="/haccp" element={<HaccpPage />} />
                <Route path="/replenishment" element={<ReplenishmentPage />} />
                <Route path="/recipes" element={<RecipesPage />} />
                <Route path="/production/costs" element={<ReportsPage fixedTab="cost" />} />
              </Route>
              <Route path="/production/:id" element={<PlanDetailPage />} />
              <Route path="/replenishment/:id" element={<RequestDetailPage />} />
              <Route path="/boutique" element={<JourneeBoutiquePage />} />
              {/* Anciens écrans regroupés dans la Journée boutique : liens et favoris conservés. */}
              <Route path="/reconciliation" element={<Navigate to="/boutique?tab=ventes" replace />} />
              <Route path="/controle" element={<ControlePage />} />
              <Route path="/traceability/recall" element={<RecallPage />} />
              <Route path="/unsold" element={<Navigate to="/boutique?tab=invendus" replace />} />
              <Route path="/inventory-check/opening" element={<OpeningInventoryCheckPage />} />
              <Route path="/inventory-check/validation" element={<Navigate to="/boutique?tab=ouverture" replace />} />
              <Route path="/employees" element={<EmployeesPage />} />
              <Route path="/employees/:id" element={<EmployeeDetailPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/accounting" element={<AccountingPage />} />
              <Route path="/purchasing" element={<PurchasingPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/approvals" element={<ApprovalsPage />} />
              {/* Projets (mig 358) : module à rubriques, fiche en pleine page. */}
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <InlineNotification />
        <ProductionTimerWidget />
      </ProductionTimerProvider>
      </PermissionsProvider>
      </AuthProvider>
      </ConfirmProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
