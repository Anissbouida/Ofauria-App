import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InlineNotification from './components/ui/InlineNotification';
import { SettingsProvider } from './context/SettingsContext';
import { ConfirmProvider } from './components/ui/ConfirmDialog';
import { AuthProvider } from './context/AuthContext';
import { LocaleProvider } from './i18n';
import { LocaleUserSync } from './components/layout/LanguageSwitcher';
import { PermissionsProvider } from './context/PermissionsContext';
import { ProductionTimerProvider } from './context/ProductionTimerContext';
import ProductionTimerWidget from './components/ui/ProductionTimerWidget';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './features/auth/LoginPage';
import PortalPage from './features/portal/PortalPage';
import HomePage from './features/dashboard/HomePage';
import ProductsPage from './features/products/ProductsPage';
import OrdersPage from './features/orders/OrdersPage';
import DeliveryNotesPage from './features/sales/DeliveryNotesPage';
import SalesContractsPage from './features/sales/SalesContractsPage';
import SalesTargetsPage from './features/sales/SalesTargetsPage';
import RebatesPage from './features/sales/RebatesPage';
import POSPage from './features/pos/POSPage';
import CustomersPage from './features/customers/CustomersPage';
import StockPage from './features/stock/StockPage';
import IngredientDetailPage from './features/stock/IngredientDetailPage';
import PriceHealthPage from './features/stock/PriceHealthPage';
import RecipesPage from './features/recipes/RecipesPage';
import NomenclaturePage from './features/recipes/NomenclaturePage';
import EmployeesPage from './features/employees/EmployeesPage';
import EmployeeDetailPage from './features/employees/EmployeeDetailPage';
import ReportsPage from './features/reports/ReportsPage';
import OperatorStationPage from './features/production/OperatorStationPage';
import SalesPage from './features/sales/SalesPage';
import ProductionPage from './features/production/ProductionPage';
import PlanDetailPage from './features/production/PlanDetailPage';
import BonSortiePrelevementPage from './features/production/BonSortiePrelevementPage';
import ProductionDashboardPage from './features/production/ProductionDashboardPage';
import ProductionLayout from './features/production/ProductionLayout';
import WorkCentersPage from './features/production/WorkCentersPage';
import AnalyticCostPage from './features/production/AnalyticCostPage';
import CostSettingsPage from './features/production/CostSettingsPage';
import StandardCostsPage from './features/production/StandardCostsPage';
import StandardCostDetailPage from './features/production/StandardCostDetailPage';
import DisassemblyPage from './features/production/DisassemblyPage';
import MrpPage from './features/production/MrpPage';
import AtelierPage from './features/production/AtelierPage';
import ProductionSettingsPage from './features/production/ProductionSettingsPage';
import SalesLayout from './features/sales/SalesLayout';
import SalesDashboard from './features/sales/SalesDashboard';
import OrderRecordPage from './features/orders/OrderRecordPage';
import CustomerRecordPage from './features/customers/CustomerRecordPage';
import PriceListsPage from './features/pricing/PriceListsPage';
import ProductTransfersPage from './features/logistics/ProductTransfersPage';
import ProReturnsPage from './features/logistics/ProReturnsPage';
import SalesChannelsPage from './features/sales/SalesChannelsPage';
import QuotesPage from './features/quotes/QuotesPage';
import CrmPage from './features/crm/CrmPage';
import PromotionsPage from './features/promotions/PromotionsPage';
import DunningPage from './features/dunning/DunningPage';
import ProjectsPage from './features/projects/ProjectsPage';
import ProjectDetailPage from './features/projects/ProjectDetailPage';
import MaintenancePage from './features/maintenance/MaintenancePage';
import UsersPage from './features/users/UsersPage';
import UserRecordPage from './features/users/UserRecordPage';
import RoleRecordPage from './features/users/RoleRecordPage';
import AcceptInvitationPage from './features/auth/AcceptInvitationPage';
import SettingsPage from './features/settings/SettingsPage';
import ConfigurationWizard from './features/settings/ConfigurationWizard';
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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
      <SettingsProvider>
      <ConfirmProvider>
      <AuthProvider>
      <LocaleUserSync />
      <PermissionsProvider>
      <ProductionTimerProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Lien d'invitation d'un nouveau compte (refonte Utilisateurs, lot 3) : page publique. */}
            <Route path="/invitation/:token" element={<AcceptInvitationPage />} />
            {/* Portail client (phase 10.3) : page publique, hors app interne, jeton Bearer. */}
            <Route path="/portail" element={<PortalPage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/pos" element={<POSPage />} />
              {/* Module Ventes : commandes, ventes, clients et produits sous une même barre latérale. */}
              <Route element={<SalesLayout />}>
                <Route path="/sales-dashboard" element={<SalesDashboard />} />
                <Route path="/crm" element={<CrmPage />} />
                <Route path="/promotions" element={<PromotionsPage />} />
                <Route path="/quotes" element={<QuotesPage />} />
                <Route path="/dunning" element={<DunningPage />} />
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/orders/:id" element={<OrderRecordPage />} />
                <Route path="/delivery-notes" element={<DeliveryNotesPage />} />
                <Route path="/sales-contracts" element={<SalesContractsPage />} />
                <Route path="/sales-targets" element={<SalesTargetsPage />} />
                <Route path="/rebates" element={<RebatesPage />} />
                <Route path="/sales" element={<SalesPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/customers/:id" element={<CustomerRecordPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/sales-channels" element={<SalesChannelsPage />} />
                <Route path="/price-lists" element={<PriceListsPage />} />
                <Route path="/product-transfers" element={<ProductTransfersPage />} />
                <Route path="/pro-returns" element={<ProReturnsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
              </Route>
              {/* Module Stock = ex-Économat (/inventory) + ex-Pesage (/warehouse), fusion du
                  2026-10-11. Les anciennes URL redirigent (bookmarks, notifications deja emises). */}
              <Route path="/stock" element={<StockPage />} />
              <Route path="/stock/price-health" element={<PriceHealthPage />} />
              <Route path="/stock/:id" element={<IngredientDetailPage />} />
              <Route path="/stock/bsi/:id" element={<BonSortiePrelevementPage />} />
              <Route path="/inventory" element={<LegacyRedirect from="inventory" to="/stock" />} />
              <Route path="/inventory/:id" element={<LegacyRedirect from="inventory" to="/stock/:id" />} />
              <Route path="/warehouse" element={<LegacyRedirect from="warehouse" to="/stock" />} />
              <Route path="/warehouse/bsi/:id" element={<LegacyRedirect from="warehouse" to="/stock/bsi/:id" />} />
              {/* Emballages repliés dans le Stock (onglet Consommables). */}
              <Route path="/packaging" element={<Navigate to="/stock?tab=consumables" replace />} />
              {/* Bases et produits s'éditent via le même éditeur (L2, unification du
                  modèle) — NomenclaturePage. L'ancien écran PreparationPage est supprimé. */}
              <Route path="/recipes/:id/nomenclature" element={<NomenclaturePage />} />
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
                <Route path="/production/work-centers" element={<WorkCentersPage />} />
                <Route path="/production/analyse-couts" element={<AnalyticCostPage />} />
                <Route path="/production/cout-de-revient" element={<CostSettingsPage />} />
                {/* Mig 661 : coût standard des articles, sorti de la fiche technique. */}
                <Route path="/production/couts-standard" element={<StandardCostsPage />} />
                <Route path="/production/disassembly" element={<DisassemblyPage />} />
                <Route path="/production/mrp" element={<MrpPage />} />
                <Route path="/production/atelier" element={<AtelierPage />} />
                <Route path="/production/settings" element={<ProductionSettingsPage />} />
              </Route>
              {/* Étape 10f : poste opérateur tactile plein écran. */}
              <Route path="/production/poste" element={<OperatorStationPage />} />
              <Route path="/production/couts-standard/:recipeId" element={<StandardCostDetailPage />} />
              <Route path="/production/:id" element={<PlanDetailPage />} />
              <Route path="/replenishment/:id" element={<RequestDetailPage />} />
              <Route path="/boutique" element={<JourneeBoutiquePage />} />
              {/* Anciens écrans regroupés dans la Journée boutique : liens et favoris conservés. */}
              <Route path="/reconciliation" element={<Navigate to="/boutique?tab=ventes" replace />} />
              <Route path="/controle" element={<ControlePage />} />
              <Route path="/traceability/recall" element={<Navigate to="/controle?tab=tracabilite" replace />} />
              <Route path="/unsold" element={<Navigate to="/boutique?tab=invendus" replace />} />
              <Route path="/inventory-check/opening" element={<OpeningInventoryCheckPage />} />
              <Route path="/inventory-check/validation" element={<Navigate to="/boutique?tab=ouverture" replace />} />
              <Route path="/employees" element={<EmployeesPage />} />
              <Route path="/employees/:id" element={<EmployeeDetailPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/users/roles/:code" element={<RoleRecordPage />} />
              <Route path="/users/:id" element={<UserRecordPage />} />
              <Route path="/accounting" element={<AccountingPage />} />
              <Route path="/purchasing" element={<PurchasingPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/assistant" element={<ConfigurationWizard />} />
              <Route path="/approvals" element={<ApprovalsPage />} />
              {/* Projets (mig 358) : module à rubriques, fiche en pleine page. */}
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/maintenance" element={<MaintenancePage />} />
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
      </LocaleProvider>
    </QueryClientProvider>
  );
}
