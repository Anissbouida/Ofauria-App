import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionApi } from '../../api/production.api';
import { replenishmentApi } from '../../api/replenishment.api';
import { ingredientLotsApi } from '../../api/inventory.api';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { PRODUCTION_STATUS_LABELS, getRoleCategorySlugs } from '@ofauria/shared';
import { usePermissions } from '../../context/PermissionsContext';
import {
  ArrowLeft, CheckCircle, Play, AlertTriangle, Factory, Printer, Filter, Package,
  User, Phone, Calendar, Banknote, Box, Clock, RotateCcw, XCircle, ChefHat,
  ClipboardList, Hash, FileText, Loader2, PackageOpen, Layers, Beaker, TrendingUp, Flame
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import ProductionLaunchModal from './ProductionLaunchModal';

const statusConfig: Record<string, { bg: string; text: string; dot: string; gradient: string; label: string; icon: React.ReactNode }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400', gradient: 'from-gray-500 to-gray-600', label: 'Brouillon', icon: <FileText size={14} /> },
  confirmed: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', gradient: 'from-blue-500 to-blue-600', label: 'Confirme', icon: <CheckCircle size={14} /> },
  in_progress: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', gradient: 'from-amber-500 to-orange-600', label: 'En cours', icon: <Play size={14} /> },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', gradient: 'from-emerald-500 to-emerald-600', label: 'Termine', icon: <CheckCircle size={14} /> },
};

const roleConfig: Record<string, { label: string; bg: string; text: string; avatar: string }> = {
  baker: { label: 'Boulanger', bg: 'bg-amber-100', text: 'text-amber-800', avatar: 'bg-amber-500' },
  pastry_chef: { label: 'Patissier', bg: 'bg-pink-100', text: 'text-pink-800', avatar: 'bg-pink-500' },
  viennoiserie: { label: 'Viennoiserie', bg: 'bg-orange-100', text: 'text-orange-800', avatar: 'bg-orange-500' },
  beldi_sale: { label: 'Beldi & Sale', bg: 'bg-green-100', text: 'text-green-800', avatar: 'bg-green-500' },
};

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showProductionLaunch, setShowProductionLaunch] = useState(false);
  const [launchTargetItemId, setLaunchTargetItemId] = useState<string | null>(null);
  const [expandedFefoIngredients, setExpandedFefoIngredients] = useState<Set<string>>(new Set());
  const { settings } = useSettings();
  const isChef = ['admin', 'manager', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'].includes(user?.role || '');

  const { data: plan, isLoading } = useQuery({
    queryKey: ['production', id],
    queryFn: () => productionApi.getById(id!),
    enabled: !!id,
  });

  const replenishmentId = plan?.replenishment_request_id as string | undefined;
  const { data: linkedReplenishment } = useQuery({
    queryKey: ['replenishment', replenishmentId],
    queryFn: () => replenishmentApi.getById(replenishmentId!),
    enabled: !!replenishmentId,
  });

  // Reverse traceability: which ingredient lots were used in this production
  const { data: productionLotUsage = [] } = useQuery({
    queryKey: ['production-lots', id],
    queryFn: () => ingredientLotsApi.productionLots(id!),
    enabled: !!id && (plan?.status === 'completed' || plan?.status === 'in_progress'),
  });

  // FEFO preview: which lots will be used (read-only preview before production)
  const { data: fefoPreview = [] } = useQuery({
    queryKey: ['fefo-preview', id],
    queryFn: () => ingredientLotsApi.fefoPreview(id!),
    enabled: !!id && ['confirmed', 'in_progress'].includes(plan?.status),
  });

  const confirmMutation = useMutation({
    mutationFn: () => productionApi.confirm(id!),
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      toast.success('Plan confirme avec succes');
      if (result.warnings?.length > 0) {
        result.warnings.forEach((w: string) => toast(w, { icon: '\u26a0\ufe0f', duration: 5000 }));
      }
    },
  });

  const getPlanLotPrefix = (planData?: Record<string, unknown>) => {
    const p = planData || plan;
    if (!p) return '';
    const d = new Date(p.plan_date as string);
    const dateStr = `${String(d.getFullYear() % 100).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const firstLot = ((p.items || items || []) as Record<string, unknown>[]).find(it => it.lot_number);
    if (firstLot) {
      const ln = firstLot.lot_number as string;
      return ln.substring(0, ln.lastIndexOf('-'));
    }
    return `LOT-${dateStr}`;
  };

  const printProductionTicket = (item: Record<string, unknown>) => {
    if (!plan) return;
    const prodTs = item.production_timestamp || item.produced_at;
    const prodDate = prodTs ? new Date(prodTs as string) : new Date(plan.plan_date);
    const sld = item.shelf_life_days as number;
    const dlcDate = item.expires_at ? new Date(item.expires_at as string) : sld ? new Date(prodDate.getTime() + sld * 86400000) : null;
    const prodBy = item.produced_by_first_name ? `${item.produced_by_first_name} ${item.produced_by_last_name}` : '—';
    const planDate = new Date(plan.plan_date as string);
    const lotNumber = (item.lot_number as string) || `LOT-${format(planDate, 'yyMMdd')}-${String(1).padStart(3, '0')}`;
    const isReexposable = item.is_reexposable as boolean;
    const isRecyclable = item.is_recyclable as boolean;
    const cycleVie = isReexposable ? 'DLV — Conservable' : isRecyclable ? 'Recyclable' : 'Vente du jour';
    const now = format(new Date(), 'dd/MM/yyyy HH:mm');

    const w = window.open('', '_blank', 'width=400,height=600');
    if (!w) return;

    w.document.write(`<!DOCTYPE html><html><head><title>Ticket - ${item.product_name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; padding: 15px; color: #333; font-size: 12px; width: 80mm; }
  .ticket { border: 2px solid #333; padding: 12px; border-radius: 6px; }
  .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 10px; }
  .header h1 { font-size: 14px; margin-bottom: 2px; }
  .header h2 { font-size: 11px; font-weight: normal; color: #666; }
  .header .lot { font-size: 13px; font-weight: bold; margin-top: 6px; letter-spacing: 0.5px; background: #f5f5f5; padding: 4px 8px; border-radius: 4px; }
  .product-name { text-align: center; font-size: 16px; font-weight: bold; padding: 10px 0; border-bottom: 1px dashed #ccc; margin-bottom: 8px; text-transform: uppercase; }
  .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dotted #eee; }
  .row .label { font-size: 11px; color: #666; text-transform: uppercase; }
  .row .value { font-weight: bold; font-size: 12px; }
  .cycle { text-align: center; margin-top: 10px; padding: 6px; border: 1px solid #333; border-radius: 4px; font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .cycle.dlv { background: #f0fdf4; color: #15803d; border-color: #15803d; }
  .cycle.recyclable { background: #ecfeff; color: #0e7490; border-color: #0e7490; }
  .cycle.vdj { background: #fff7ed; color: #c2410c; border-color: #c2410c; }
  .barcode { text-align: center; margin-top: 10px; font-family: 'Courier New', monospace; font-size: 14px; letter-spacing: 2px; font-weight: bold; }
  .footer { text-align: center; margin-top: 10px; font-size: 9px; color: #999; border-top: 1px solid #eee; padding-top: 6px; }
  .print-btn { position: fixed; top: 10px; right: 10px; background: #16a34a; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  @media print { .print-btn { display: none; } body { padding: 0; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">Imprimer</button>

<div class="ticket">
  <div class="header">
    <h1>${settings.companyName}</h1>
    <h2>${settings.subtitle || ''}</h2>
    <div class="lot">${lotNumber}</div>
  </div>

  <div class="product-name">${item.product_name}</div>

  <div class="row">
    <span class="label">Quantite produite</span>
    <span class="value">${item.actual_quantity ?? item.planned_quantity}</span>
  </div>
  <div class="row">
    <span class="label">Date de production</span>
    <span class="value">${format(prodDate, 'dd/MM/yyyy HH:mm')}</span>
  </div>
  <div class="row">
    <span class="label">Produit par</span>
    <span class="value">${prodBy}</span>
  </div>
  <div class="row">
    <span class="label">Date d'expiration</span>
    <span class="value">${dlcDate ? format(dlcDate, 'dd/MM/yyyy') : 'Vente du jour'}</span>
  </div>
  <div class="row">
    <span class="label">N° Plan</span>
    <span class="value">${(plan.id as string).slice(0, 8).toUpperCase()}</span>
  </div>
  <div class="row">
    <span class="label">Role</span>
    <span class="value">${plan.target_role === 'baker' ? 'Boulanger' : plan.target_role === 'pastry_chef' ? 'Patissier' : plan.target_role === 'viennoiserie' ? 'Viennoiserie' : plan.target_role === 'beldi_sale' ? 'Beldi & Sale' : '—'}</span>
  </div>

  <div class="cycle ${isReexposable ? 'dlv' : isRecyclable ? 'recyclable' : 'vdj'}">
    ${cycleVie}
  </div>

  <div class="barcode">${lotNumber}</div>

  <div class="footer">
    Imprime le ${now}<br/>
    Conservez ce ticket pour la tracabilite
  </div>
</div>
</body></html>`);
    w.document.close();
  };

  const printBonDeCommande = (planData?: Record<string, unknown>) => {
    const p = planData || plan;
    if (!p) return;
    const planItems = items;
    const ingredientNeeds = needs;
    const dateStr = format(new Date(p.plan_date as string), 'dd/MM/yyyy');
    const now = format(new Date(), 'dd/MM/yyyy HH:mm');

    const w = window.open('', '_blank', 'width=800,height=600');
    if (!w) return;

    w.document.write(`<!DOCTYPE html><html><head><title>Bon de commande - ${dateStr}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; padding: 20px; color: #333; font-size: 13px; }
  .header { text-align: center; border-bottom: 3px double #333; padding-bottom: 15px; margin-bottom: 20px; }
  .header h1 { font-size: 22px; margin-bottom: 4px; }
  .header h2 { font-size: 16px; font-weight: normal; color: #666; }
  .header .subtitle { font-size: 11px; color: #999; margin-top: 4px; }
  .info { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 12px; }
  .info div { line-height: 1.6; }
  .section { margin-bottom: 20px; }
  .section h3 { font-size: 14px; background: #f5f5f5; padding: 6px 10px; margin-bottom: 8px; border-left: 4px solid #c97a2a; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f5f5f5; text-align: left; padding: 6px 10px; font-size: 11px; text-transform: uppercase; color: #666; border-bottom: 2px solid #ddd; }
  td { padding: 6px 10px; border-bottom: 1px solid #eee; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .bold { font-weight: bold; }
  .warning { color: #c53030; font-weight: bold; }
  .ok { color: #2f855a; }
  .checkbox { width: 14px; height: 14px; border: 1.5px solid #999; display: inline-block; margin-right: 4px; vertical-align: middle; }
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 15px; border-top: 1px solid #ddd; }
  .sig-block { text-align: center; width: 200px; }
  .sig-block .line { border-bottom: 1px solid #333; height: 50px; margin-bottom: 5px; }
  .sig-block p { font-size: 11px; color: #666; }
  .footer { text-align: center; margin-top: 30px; font-size: 10px; color: #999; border-top: 1px dashed #ccc; padding-top: 10px; }
  @media print { body { padding: 10px; } button { display: none; } }
  .print-btn { position: fixed; top: 10px; right: 10px; background: #c97a2a; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; }
</style></head><body>
<button class="print-btn" onclick="window.print()">Imprimer</button>

<div class="header">
  <h1>${settings.companyName}</h1>
  <h2>${settings.subtitle}</h2>
  <div class="subtitle">Bon de commande matieres premieres</div>
</div>

<div class="info">
  <div>
    <strong>N\u00b0 Lot :</strong> ${getPlanLotPrefix(p)}<br/>
    <strong>Date de production :</strong> ${dateStr}<br/>
    <strong>Type :</strong> ${p.type === 'daily' ? 'Quotidien' : 'Hebdomadaire'}
  </div>
  <div style="text-align:right">
    <strong>Chef :</strong> ${p.target_role === 'baker' ? 'Boulanger' : p.target_role === 'pastry_chef' ? 'Patissier' : p.target_role === 'viennoiserie' ? 'Viennoiserie' : p.target_role === 'beldi_sale' ? 'Beldi & Sale' : p.created_by_name || '-'}<br/>
    <strong>Date d'emission :</strong> ${now}<br/>
    <strong>Statut :</strong> Confirme
  </div>
</div>

<div class="section">
  <h3>Produits a fabriquer</h3>
  <table>
    <thead><tr>
      <th>Produit</th>
      <th class="text-right">Quantite</th>
    </tr></thead>
    <tbody>
      ${planItems.map((it: Record<string, unknown>) => `
        <tr>
          <td>${it.product_name}</td>
          <td class="text-right bold">${it.planned_quantity}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</div>

<div class="section">
  <h3>Ingredients a preparer</h3>
  <table>
    <thead><tr>
      <th style="width:30px"></th>
      <th>Ingredient</th>
      <th class="text-right">Quantite requise</th>
      <th class="text-center">Unite</th>
      <th class="text-right">Stock disponible</th>
      <th class="text-center">Statut</th>
    </tr></thead>
    <tbody>
      ${ingredientNeeds.map((n: Record<string, unknown>) => {
        const needed = parseFloat(n.needed_quantity as string);
        const available = parseFloat(n.available_quantity as string);
        const sufficient = n.is_sufficient as boolean;
        return `
        <tr>
          <td><span class="checkbox"></span></td>
          <td>${n.ingredient_name}</td>
          <td class="text-right bold">${needed.toFixed(2)}</td>
          <td class="text-center">${n.unit}</td>
          <td class="text-right">${available.toFixed(2)}</td>
          <td class="text-center">${sufficient
            ? '<span class="ok">OK</span>'
            : '<span class="warning">MANQUE ' + (needed - available).toFixed(2) + '</span>'
          }</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>

${p.notes ? `<div class="section"><h3>Notes</h3><p style="padding:5px 10px">${p.notes}</p></div>` : ''}

<div class="signatures">
  <div class="sig-block">
    <div class="line"></div>
    <p><strong>Chef de production</strong><br/>Signature</p>
  </div>
  <div class="sig-block">
    <div class="line"></div>
    <p><strong>Magasinier</strong><br/>Signature & date de remise</p>
  </div>
</div>

<div class="footer">
  ${settings.companyName} - Bon de commande interne - Imprime le ${now}
</div>

</body></html>`);
    w.document.close();
  };

  const printBonSortieIngredients = () => {
    if (!plan) return;
    const dateStr = format(new Date(plan.plan_date as string), 'dd/MM/yyyy');
    const now = format(new Date(), 'dd/MM/yyyy HH:mm');
    const planDate = new Date(plan.plan_date as string);
    const bsiDateStr = `${String(planDate.getFullYear() % 100).padStart(2, '0')}${String(planDate.getMonth() + 1).padStart(2, '0')}${String(planDate.getDate()).padStart(2, '0')}`;
    const hour = new Date().getHours();
    const shift = hour < 14 ? 'Matin' : 'Apres-midi';

    // Build ingredient rows from fefoPreview data (FEFO lot allocation)
    const fefoItems = (fefoPreview as Record<string, unknown>[]) || [];

    // Aggregate needs (same as the needs variable) for ingredients without FEFO lots
    const needsForPrint = needs;

    // Build rows: one row per ingredient, with FEFO lot info when available
    type BsiRow = {
      ingredientName: string;
      neededQty: number;
      unit: string;
      lotNumber: string;
      expirationDate: string;
      daysUntilExpiry: number | null;
      urgency: 'urgent' | 'priority' | 'normal';
    };

    const rows: BsiRow[] = [];

    for (const need of needsForPrint) {
      const ingredientId = need.ingredient_id as string;
      const ingredientName = need.ingredient_name as string;
      const neededQty = parseFloat(need.needed_quantity as string);
      const unit = (need.unit as string) || '';

      // Find matching FEFO preview entry
      const fefoEntry = fefoItems.find((f) => (f.ingredientId as string) === ingredientId);
      const lots = fefoEntry ? (fefoEntry.lots as Record<string, unknown>[]) || [] : [];

      if (lots.length > 0) {
        // One row per lot used for this ingredient
        for (const lot of lots) {
          const expDate = lot.expirationDate as string | null;
          const daysLeft = lot.daysUntilExpiry as number | null;
          let urgency: 'urgent' | 'priority' | 'normal' = 'normal';
          if (daysLeft !== null && daysLeft < 3) urgency = 'urgent';
          else if (daysLeft !== null && daysLeft < 7) urgency = 'priority';

          rows.push({
            ingredientName,
            neededQty: parseFloat((lot.quantityToUse as number).toFixed(2)),
            unit,
            lotNumber: (lot.supplierLotNumber as string) || '—',
            expirationDate: expDate ? format(new Date(expDate), 'dd/MM/yyyy') : '—',
            daysUntilExpiry: daysLeft,
            urgency,
          });
        }
      } else {
        // No FEFO lot data — show ingredient without lot info
        rows.push({
          ingredientName,
          neededQty,
          unit,
          lotNumber: '—',
          expirationDate: '—',
          daysUntilExpiry: null,
          urgency: 'normal',
        });
      }
    }

    // Generate BSI number
    const bsiNumber = `BSI-${bsiDateStr}-${String(1).padStart(3, '0')}`;

    const roleLabel = plan.target_role === 'baker' ? 'Boulanger' : plan.target_role === 'pastry_chef' ? 'Patissier' : plan.target_role === 'viennoiserie' ? 'Viennoiserie' : plan.target_role === 'beldi_sale' ? 'Beldi & Sale' : (plan.created_by_name || '—');

    const w = window.open('', '_blank', 'width=800,height=700');
    if (!w) return;

    w.document.write(`<!DOCTYPE html><html><head><title>BSI - ${dateStr}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; padding: 25px; color: #333; font-size: 12px; }
  .header { text-align: center; border-bottom: 3px double #333; padding-bottom: 15px; margin-bottom: 20px; }
  .header h1 { font-size: 20px; margin-bottom: 3px; }
  .header h2 { font-size: 14px; font-weight: normal; color: #666; }
  .header .doc-title { font-size: 16px; font-weight: bold; margin-top: 10px; text-transform: uppercase; letter-spacing: 1px; color: #1a1a1a; }
  .header .doc-number { font-size: 13px; font-weight: bold; margin-top: 4px; font-family: 'Courier New', monospace; color: #444; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 11px; border: 1px solid #ddd; border-radius: 6px; padding: 12px 16px; background: #fafafa; }
  .meta div { line-height: 1.8; }
  .meta strong { color: #333; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; }
  thead th { background: #2d2d2d; color: white; text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  thead th:first-child { border-radius: 4px 0 0 0; }
  thead th:last-child { border-radius: 0 4px 0 0; }
  tbody td { padding: 7px 10px; border-bottom: 1px solid #e5e5e5; font-size: 11px; }
  tbody tr:nth-child(even) { background: #f9f9f9; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .bold { font-weight: bold; }
  .row-urgent { background: #fff5f5 !important; }
  .row-urgent td { color: #c53030; font-weight: 600; }
  .row-priority { background: #fffaf0 !important; }
  .row-priority td { color: #c05621; }
  .urgency-tag { font-size: 9px; font-weight: bold; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; display: inline-block; margin-left: 6px; }
  .urgency-tag.urgent { background: #fed7d7; color: #c53030; }
  .urgency-tag.priority { background: #feebc8; color: #c05621; }
  .checkbox { width: 16px; height: 16px; border: 2px solid #666; display: inline-block; border-radius: 2px; }
  .lot-badge { font-family: 'Courier New', monospace; font-size: 10px; background: #edf2f7; padding: 2px 6px; border-radius: 3px; color: #2d3748; }
  .signatures { display: flex; justify-content: space-between; margin-top: 30px; padding-top: 15px; }
  .sig-block { text-align: center; width: 220px; }
  .sig-block .title { font-size: 11px; font-weight: bold; color: #333; margin-bottom: 5px; text-transform: uppercase; }
  .sig-block .line { border-bottom: 1px solid #333; height: 45px; margin-bottom: 5px; }
  .sig-block .sub { font-size: 10px; color: #666; }
  .observations { margin-top: 20px; border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
  .observations .title { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #666; margin-bottom: 8px; }
  .observations .lines { min-height: 60px; border-top: 1px dotted #ccc; padding-top: 8px; }
  .observations .line-row { border-bottom: 1px dotted #ddd; height: 22px; }
  .footer { text-align: center; margin-top: 25px; font-size: 9px; color: #999; border-top: 1px dashed #ccc; padding-top: 8px; }
  .print-btn { position: fixed; top: 10px; right: 10px; background: #2d8a4e; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; z-index: 10; }
  .print-btn:hover { background: #276e3e; }
  @media print { .print-btn { display: none; } body { padding: 15px; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">Imprimer</button>

<div class="header">
  <h1>${settings.companyName}</h1>
  <h2>${settings.subtitle || ''}</h2>
  <div class="doc-title">Bon de Sortie Ingredients</div>
  <div class="doc-number">${bsiNumber}</div>
</div>

<div class="meta">
  <div>
    <strong>Date de production :</strong> ${dateStr}<br/>
    <strong>Shift :</strong> ${shift}<br/>
    <strong>N\u00b0 Plan :</strong> ${getPlanLotPrefix()}
  </div>
  <div style="text-align:right">
    <strong>Chef de production :</strong> ${roleLabel}<br/>
    <strong>Magasinier :</strong> ___________________<br/>
    <strong>Emis le :</strong> ${now}
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:28px">#</th>
      <th style="width:200px">Ingredient</th>
      <th class="text-right" style="width:75px">Qte requise</th>
      <th class="text-center" style="width:50px">Unite</th>
      <th style="width:140px">Lot a utiliser</th>
      <th class="text-center" style="width:95px">Date d'exp.</th>
      <th class="text-center" style="width:45px">Servi</th>
    </tr>
  </thead>
  <tbody>
    ${rows.map((row, idx) => {
      const rowClass = row.urgency === 'urgent' ? 'row-urgent' : row.urgency === 'priority' ? 'row-priority' : '';
      const urgencyTag = row.urgency === 'urgent'
        ? '<span class="urgency-tag urgent">URGENT — utiliser en priorite</span>'
        : row.urgency === 'priority'
          ? '<span class="urgency-tag priority">Prioritaire</span>'
          : '';
      return `
      <tr class="${rowClass}">
        <td class="text-center bold">${idx + 1}</td>
        <td>${row.ingredientName}${urgencyTag}</td>
        <td class="text-right bold">${row.neededQty.toFixed(2)}</td>
        <td class="text-center">${row.unit}</td>
        <td><span class="lot-badge">${row.lotNumber}</span></td>
        <td class="text-center">${row.expirationDate}${row.daysUntilExpiry !== null && row.daysUntilExpiry <= 7 ? ' <small>(' + row.daysUntilExpiry + 'j)</small>' : ''}</td>
        <td class="text-center"><span class="checkbox"></span></td>
      </tr>`;
    }).join('')}
  </tbody>
</table>

<div class="observations">
  <div class="title">Observations / Ecarts / Substitutions</div>
  <div class="lines">
    <div class="line-row"></div>
    <div class="line-row"></div>
    <div class="line-row"></div>
  </div>
</div>

<div class="signatures">
  <div class="sig-block">
    <div class="title">Chef de production</div>
    <div class="line"></div>
    <div class="sub">Nom : ${roleLabel}<br/>Signature</div>
  </div>
  <div class="sig-block">
    <div class="title">Magasinier</div>
    <div class="line"></div>
    <div class="sub">Nom : ___________________<br/>Signature & date de remise</div>
  </div>
</div>

<div class="footer">
  ${settings.companyName} — Bon de Sortie Ingredients — ${bsiNumber} — Imprime le ${now}
</div>

</body></html>`);
    w.document.close();
  };

  const printFicheProduction = (planData?: Record<string, unknown>) => {
    const p = planData || plan;
    if (!p) return;
    const allPlanNeeds = (p.ingredient_needs || []) as Record<string, unknown>[];
    const filteredPrintNeeds = allowedSlugs
      ? allPlanNeeds.filter((n) => allowedSlugs.includes(n.category_slug as string))
      : allPlanNeeds;
    const printNeedsMap = new Map<string, Record<string, unknown>>();
    for (const n of filteredPrintNeeds) {
      const ingId = n.ingredient_id as string;
      const existing = printNeedsMap.get(ingId);
      if (existing) {
        existing.needed_quantity = (parseFloat(existing.needed_quantity as string) + parseFloat(n.needed_quantity as string)).toString();
      } else {
        printNeedsMap.set(ingId, { ...n });
      }
    }
    const ingredientNeeds = [...printNeedsMap.values()];
    const allPrintItems = (p.items || []) as Record<string, unknown>[];
    const planItems = allowedSlugs
      ? allPrintItems.filter((it) => allowedSlugs.includes(it.category_slug as string))
      : allPrintItems;
    const dateStr = format(new Date(p.plan_date as string), 'dd/MM/yyyy');
    const now = format(new Date(), 'dd/MM/yyyy HH:mm');

    let totalPlanned = 0, totalProduced = 0;
    planItems.forEach((it) => {
      totalPlanned += (it.planned_quantity as number) || 0;
      totalProduced += (it.actual_quantity as number) || 0;
    });
    const globalRate = totalPlanned > 0 ? Math.round((totalProduced / totalPlanned) * 100) : 0;

    const w = window.open('', '_blank', 'width=800,height=600');
    if (!w) return;

    w.document.write(`<!DOCTYPE html><html><head><title>Fiche de production - ${dateStr}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; padding: 20px; color: #333; font-size: 13px; }
  .header { text-align: center; border-bottom: 3px double #333; padding-bottom: 15px; margin-bottom: 20px; }
  .header h1 { font-size: 22px; margin-bottom: 4px; }
  .header h2 { font-size: 16px; font-weight: normal; color: #666; }
  .header .subtitle { font-size: 11px; color: #999; margin-top: 4px; }
  .info { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 12px; }
  .info div { line-height: 1.8; }
  .section { margin-bottom: 20px; }
  .section h3 { font-size: 14px; background: #f5f5f5; padding: 6px 10px; margin-bottom: 8px; border-left: 4px solid #2f855a; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f5f5f5; text-align: left; padding: 6px 10px; font-size: 11px; text-transform: uppercase; color: #666; border-bottom: 2px solid #ddd; }
  td { padding: 6px 10px; border-bottom: 1px solid #eee; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .bold { font-weight: bold; }
  .ok { color: #2f855a; font-weight: bold; }
  .warning { color: #c53030; font-weight: bold; }
  .over { color: #2b6cb0; font-weight: bold; }
  .summary-box { display: flex; gap: 20px; margin-bottom: 20px; }
  .summary-card { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 12px; text-align: center; }
  .summary-card .value { font-size: 24px; font-weight: bold; margin: 4px 0; }
  .summary-card .label { font-size: 11px; color: #666; text-transform: uppercase; }
  .summary-card.green { border-color: #c6f6d5; background: #f0fff4; }
  .summary-card.green .value { color: #2f855a; }
  .summary-card.amber { border-color: #fefcbf; background: #fffff0; }
  .summary-card.amber .value { color: #b7791f; }
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 15px; border-top: 1px solid #ddd; }
  .sig-block { text-align: center; width: 200px; }
  .sig-block .line { border-bottom: 1px solid #333; height: 50px; margin-bottom: 5px; }
  .sig-block p { font-size: 11px; color: #666; }
  .footer { text-align: center; margin-top: 30px; font-size: 10px; color: #999; border-top: 1px dashed #ccc; padding-top: 10px; }
  .rate-bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; margin-top: 4px; }
  .rate-bar .fill { height: 100%; border-radius: 4px; }
  @media print { body { padding: 10px; } .print-btn { display: none; } }
  .print-btn { position: fixed; top: 10px; right: 10px; background: #2f855a; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; }
</style></head><body>
<button class="print-btn" onclick="window.print()">Imprimer</button>

<div class="header">
  <h1>${settings.companyName}</h1>
  <h2>${settings.subtitle}</h2>
  <div class="subtitle">Fiche de production</div>
</div>

<div class="info">
  <div>
    <strong>N\u00b0 Lot :</strong> ${getPlanLotPrefix(p)}<br/>
    <strong>Date de production :</strong> ${dateStr}<br/>
    <strong>Type :</strong> ${p.type === 'daily' ? 'Quotidien' : 'Hebdomadaire'}
  </div>
  <div style="text-align:right">
    <strong>Chef de production :</strong> ${p.created_by_name || '-'}<br/>
    <strong>Date d'impression :</strong> ${now}<br/>
    <strong>Statut :</strong> Terminee
  </div>
</div>

<div class="summary-box">
  <div class="summary-card">
    <div class="label">Produits planifies</div>
    <div class="value">${totalPlanned}</div>
  </div>
  <div class="summary-card green">
    <div class="label">Produits realises</div>
    <div class="value">${totalProduced}</div>
  </div>
  <div class="summary-card ${globalRate >= 100 ? 'green' : 'amber'}">
    <div class="label">Taux de realisation</div>
    <div class="value">${globalRate}%</div>
  </div>
</div>

<div class="section">
  <h3>Detail de la production — Tracabilite</h3>
  <table>
    <thead><tr>
      <th>Produit</th>
      <th class="text-right">Planifie</th>
      <th class="text-right">Produit</th>
      <th class="text-right">Ecart</th>
      <th class="text-center">Produit par</th>
      <th class="text-center">Date production</th>
      <th class="text-center">Date expiration</th>
      <th class="text-center">Statut</th>
    </tr></thead>
    <tbody>
      ${planItems.map((it: Record<string, unknown>) => {
        const planned = (it.planned_quantity as number) || 0;
        const actual = (it.actual_quantity as number) || 0;
        const diff = actual - planned;
        const statusClass = actual >= planned ? 'ok' : 'warning';
        const statusLabel = actual >= planned ? 'Complet' : actual > 0 ? 'Partiel' : 'Non produit';
        const prodTs = it.production_timestamp || it.produced_at;
        const prodDateStr = prodTs ? format(new Date(prodTs as string), 'dd/MM/yyyy HH:mm', { locale: fr }) : '-';
        const producedByStr = it.produced_by_first_name ? `${it.produced_by_first_name} ${it.produced_by_last_name}` : '-';
        const slDays = it.shelf_life_days as number;
        const prodD = prodTs ? new Date(prodTs as string) : new Date(p.plan_date);
        const dlcD = it.expires_at ? new Date(it.expires_at as string) : slDays ? new Date(prodD.getTime() + slDays * 86400000) : null;
        const dlcStr = dlcD ? format(dlcD, 'dd/MM/yyyy', { locale: fr }) : '-';
        return `
        <tr>
          <td class="bold">${it.product_name}${(it.is_reexposable as boolean) === false ? ' <span style="color:#c05621;font-size:10px">(Non reexp.)</span>' : ''}</td>
          <td class="text-right">${planned}</td>
          <td class="text-right bold">${actual}</td>
          <td class="text-right ${diff > 0 ? 'over' : diff < 0 ? 'warning' : ''}">${diff > 0 ? '+' : ''}${diff}</td>
          <td class="text-center" style="font-size:11px">${producedByStr}</td>
          <td class="text-center" style="font-size:11px">${prodDateStr}</td>
          <td class="text-center" style="font-size:11px">${dlcStr}</td>
          <td class="text-center"><span class="${statusClass}">${statusLabel}</span></td>
        </tr>`;
      }).join('')}
      <tr style="border-top:2px solid #333; font-weight:bold; background:#f7fafc">
        <td>TOTAL</td>
        <td class="text-right">${totalPlanned}</td>
        <td class="text-right">${totalProduced}</td>
        <td class="text-right ${totalProduced - totalPlanned >= 0 ? 'ok' : 'warning'}">${totalProduced - totalPlanned > 0 ? '+' : ''}${totalProduced - totalPlanned}</td>
        <td colspan="3" class="text-center">Taux: ${globalRate}%</td>
        <td></td>
      </tr>
    </tbody>
  </table>
</div>

${p.notes ? `<div class="section"><h3>Observations</h3><p style="padding:5px 10px">${p.notes}</p></div>` : ''}

<div class="signatures">
  <div class="sig-block">
    <div class="line"></div>
    <p><strong>Chef de production</strong><br/>Signature</p>
  </div>
  <div class="sig-block">
    <div class="line"></div>
    <p><strong>Responsable qualite</strong><br/>Signature</p>
  </div>
  <div class="sig-block">
    <div class="line"></div>
    <p><strong>Direction</strong><br/>Visa</p>
  </div>
</div>

<div class="footer">
  ${settings.companyName} - Fiche de production - Imprime le ${now}
</div>

</body></html>`);
    w.document.close();
  };

  const startMutation = useMutation({
    mutationFn: () => productionApi.start(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      toast.success('Production demarree');
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (itemIds: string[]) => productionApi.restoreItems(id!, itemIds),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      if (result.warnings?.length > 0) {
        result.warnings.forEach((w: string) => toast(w, { icon: '\u26a0\ufe0f', duration: 5000 }));
      } else {
        toast.success('Article(s) restaure(s) avec succes');
      }
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Erreur lors de la restauration');
    },
  });

  const cancelItemsMutation = useMutation({
    mutationFn: ({ itemIds, reason }: { itemIds: string[]; reason?: string }) => productionApi.cancelItems(id!, itemIds, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      toast.success('Article(s) annule(s)');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Erreur lors de l\'annulation');
    },
  });

  // Start item: pending → in_progress
  const handleStartItem = async (itemId: string) => {
    try {
      await productionApi.startItems(id!, [itemId]);
      await queryClient.invalidateQueries({ queryKey: ['production', id] });
      toast.success('Production lancee');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Erreur lors du lancement');
    }
  };

  const { getModuleConfig } = usePermissions();
  const prodConfig = getModuleConfig('production');
  const userRole = user?.role || '';
  const isChefRole = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'].includes(userRole);
  const allowedSlugs = plan?.order_id
    ? null
    : isChefRole
      ? getRoleCategorySlugs(userRole)
      : plan?.target_role
        ? getRoleCategorySlugs(plan.target_role as string)
        : (prodConfig.category_slugs as string[] | undefined) || null;

  // Loading state
  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={32} className="animate-spin text-amber-500" />
        <span className="text-gray-500 text-sm">Chargement du plan...</span>
      </div>
    </div>
  );

  if (!plan) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
        <PackageOpen size={32} className="text-gray-400" />
      </div>
      <p className="text-gray-500">Plan non trouve</p>
      <button onClick={() => navigate('/production')} className="text-amber-600 hover:text-amber-700 text-sm font-medium flex items-center gap-1">
        <ArrowLeft size={16} /> Retour a la production
      </button>
    </div>
  );

  const allItems = plan.items || [];
  const items = allowedSlugs
    ? allItems.filter((it: Record<string, unknown>) => allowedSlugs.includes(it.category_slug as string))
    : allItems;
  const allNeeds = (plan.ingredient_needs || []) as Record<string, unknown>[];
  const filteredNeeds = allowedSlugs
    ? allNeeds.filter((n) => allowedSlugs.includes(n.category_slug as string))
    : allNeeds;
  const needsMap = new Map<string, Record<string, unknown>>();
  for (const n of filteredNeeds) {
    const ingId = n.ingredient_id as string;
    const existing = needsMap.get(ingId);
    if (existing) {
      existing.needed_quantity = (parseFloat(existing.needed_quantity as string) + parseFloat(n.needed_quantity as string)).toString();
    } else {
      needsMap.set(ingId, { ...n });
    }
  }
  // Recalculate is_sufficient after aggregation (needed_quantity was summed)
  for (const n of needsMap.values()) {
    n.is_sufficient = parseFloat(n.available_quantity as string) >= parseFloat(n.needed_quantity as string);
  }
  const needs = [...needsMap.values()];
  const insufficientNeeds = needs.filter((n) => parseFloat(n.available_quantity as string) < parseFloat(n.needed_quantity as string));

  const sc = statusConfig[plan.status] || statusConfig.draft;
  const rc = roleConfig[plan.target_role as string];

  // Progress stats
  const producedCount = items.filter((it: Record<string, unknown>) => it.status === 'produced' || it.status === 'transferred' || it.status === 'received').length;
  const inProgressCount = items.filter((it: Record<string, unknown>) => it.status === 'in_progress').length;
  const cancelledCount = items.filter((it: Record<string, unknown>) => it.status === 'cancelled').length;
  const waitingCount = items.filter((it: Record<string, unknown>) => it.waiting_status === 'waiting').length;
  const pendingCount = items.filter((it: Record<string, unknown>) => it.status === 'pending' && it.waiting_status !== 'waiting').length;
  const totalActive = items.length - cancelledCount;
  const progressPct = totalActive > 0 ? Math.round((producedCount / totalActive) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* ══════════════ HEADER CARD ══════════════ */}
      <div className={`bg-gradient-to-br ${sc.gradient} rounded-2xl p-6 text-white shadow-lg relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white rounded-full" />
          <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white rounded-full" />
        </div>
        <div className="relative">
          {/* Top row: back + title */}
          <div className="flex items-start gap-4 mb-4">
            <button onClick={() => navigate('/production')} className="p-2 hover:bg-white/20 rounded-xl transition-colors mt-0.5">
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold">
                  Plan du {format(new Date(plan.plan_date), 'dd MMMM yyyy', { locale: fr })}
                </h1>
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-white/20 backdrop-blur-sm flex items-center gap-1.5">
                  {sc.icon}
                  {plan.status === 'completed' && plan.completion_type === 'partial'
                    ? 'Termine partiel'
                    : plan.status === 'completed' && plan.completion_type === 'complete'
                    ? 'Termine complet'
                    : PRODUCTION_STATUS_LABELS[plan.status as keyof typeof PRODUCTION_STATUS_LABELS]}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-white/80 text-sm flex-wrap">
                <span className="flex items-center gap-1.5">
                  <User size={14} /> {plan.created_by_name}
                </span>
                {rc && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/20 flex items-center gap-1">
                    <ChefHat size={12} /> {rc.label}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Hash size={14} /> {(plan.id as string).slice(0, 8).toUpperCase()}
                </span>
                {plan.type && (
                  <span className="flex items-center gap-1.5">
                    <Calendar size={14} /> {plan.type === 'daily' ? 'Quotidien' : 'Hebdomadaire'}
                  </span>
                )}
                {plan.notes && (
                  <span className="flex items-center gap-1.5">
                    <FileText size={14} /> {plan.notes}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <div className="text-2xl font-bold">{items.length}</div>
              <div className="text-xs text-white/70">Articles</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <div className="text-2xl font-bold">{producedCount}</div>
              <div className="text-xs text-white/70">Produits</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <div className="text-2xl font-bold">{needs.length}</div>
              <div className="text-xs text-white/70">Ingredients</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <div className="text-2xl font-bold">{progressPct}%</div>
              <div className="text-xs text-white/70">Progression</div>
            </div>
          </div>

          {/* Progress bar (for in_progress and completed) */}
          {(plan.status === 'in_progress' || plan.status === 'completed') && totalActive > 0 && (
            <div className="mt-4">
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="flex justify-between text-xs text-white/60 mt-1">
                <span>{producedCount} produit(s)</span>
                {inProgressCount > 0 && <span>{inProgressCount} en cours</span>}
                {waitingCount > 0 && <span>{waitingCount} en attente</span>}
                {pendingCount > 0 && <span>{pendingCount} a faire</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════ ACTION BUTTONS ══════════════ */}
      <div className="flex flex-wrap gap-3">
        {plan.status === 'draft' && isChef && (
          <button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm">
            {confirmMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            {confirmMutation.isPending ? 'Confirmation...' : 'Confirmer le plan'}
          </button>
        )}
        {['confirmed', 'in_progress'].includes(plan.status) && (
          <button onClick={() => printBonSortieIngredients()} className="px-5 py-2.5 bg-white border border-emerald-200 text-emerald-700 rounded-xl font-medium hover:bg-emerald-50 transition-all flex items-center gap-2 text-sm shadow-sm">
            <Printer size={16} className="text-emerald-600" /> Bon de sortie ingredients
          </button>
        )}
        {plan.status === 'confirmed' && (
          <>
            <button onClick={() => printBonDeCommande()} className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all flex items-center gap-2 text-sm shadow-sm">
              <Printer size={16} className="text-amber-600" /> Bon de commande
            </button>
            {isChef && (
              <button onClick={() => startMutation.mutate()} disabled={startMutation.isPending}
                className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm">
                {startMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {startMutation.isPending ? 'Demarrage...' : 'Demarrer la production'}
              </button>
            )}
          </>
        )}
        {plan.status === 'in_progress' && isChef && (() => {
          const pendingItems = items.filter((it: Record<string, unknown>) => it.status === 'pending' && (it.waiting_status !== 'waiting'));
          const inProgressItems = items.filter((it: Record<string, unknown>) => it.status === 'in_progress');
          const allProduced = pendingItems.length === 0 && inProgressItems.length === 0 && items.some((it: Record<string, unknown>) => it.status === 'produced' || it.status === 'transferred' || it.status === 'received');
          return (
            <>
              {pendingItems.length > 0 && (
                <button onClick={async () => {
                  const ids = pendingItems.map((it: Record<string, unknown>) => it.id as string);
                  try {
                    await productionApi.startItems(id!, ids);
                    await queryClient.invalidateQueries({ queryKey: ['production', id] });
                    toast.success(`${ids.length} production(s) lancee(s)`);
                  } catch (e: any) { toast.error(e?.response?.data?.error?.message || 'Erreur'); }
                }} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm">
                  <Play size={16} /> Lancer tout ({pendingItems.length})
                </button>
              )}
              {inProgressItems.length > 0 && (
                <button onClick={() => { setLaunchTargetItemId(null); setShowProductionLaunch(true); }} className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm">
                  <Factory size={16} /> Enregistrer tout ({inProgressItems.length})
                </button>
              )}
              {waitingCount > 0 && allProduced && (
                <button
                  onClick={() => {
                    if (confirm(`Cloture partielle : ${waitingCount} article(s) en attente seront annules. Continuer ?`)) {
                      productionApi.complete(id!, [], 'partial').then(() => {
                        queryClient.invalidateQueries({ queryKey: ['production', id] });
                        toast.success('Plan cloture partiellement');
                      }).catch((err: any) => {
                        toast.error(err?.response?.data?.error?.message || 'Erreur');
                      });
                    }
                  }}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm"
                >
                  <CheckCircle size={16} /> Cloture partielle
                </button>
              )}
            </>
          );
        })()}
        {plan.status === 'completed' && isChef && (
          <button onClick={() => printFicheProduction()} className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all flex items-center gap-2 text-sm shadow-sm">
            <Printer size={16} className="text-emerald-600" /> Fiche de production
          </button>
        )}
      </div>

      {/* ══════════════ LINKED ORDER CARD ══════════════ */}
      {plan.order_number && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
              <Package size={18} className="text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-blue-900">Commande liee</h3>
              <span className="text-xs text-blue-600">{plan.order_number}</span>
            </div>
            <span className={`ml-auto px-3 py-1 rounded-full text-xs font-medium ${
              plan.order_status === 'in_production' ? 'bg-amber-100 text-amber-700' :
              plan.order_status === 'ready' ? 'bg-emerald-100 text-emerald-700' :
              plan.order_status === 'completed' ? 'bg-gray-100 text-gray-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {plan.order_status === 'pending' ? 'En attente' :
               plan.order_status === 'confirmed' ? 'Confirmee' :
               plan.order_status === 'in_production' ? 'En production' :
               plan.order_status === 'ready' ? 'Prete' :
               plan.order_status === 'completed' ? 'Livree' :
               plan.order_status === 'cancelled' ? 'Annulee' : plan.order_status}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {plan.order_customer_first_name && (
              <div className="bg-white/70 rounded-xl p-3 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <User size={14} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">Client</div>
                  <div className="text-sm font-medium text-gray-800">{plan.order_customer_first_name} {plan.order_customer_last_name || ''}</div>
                </div>
              </div>
            )}
            {plan.order_customer_phone && (
              <div className="bg-white/70 rounded-xl p-3 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Phone size={14} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">Telephone</div>
                  <div className="text-sm font-medium text-gray-800">{plan.order_customer_phone}</div>
                </div>
              </div>
            )}
            {plan.order_pickup_date && (
              <div className="bg-white/70 rounded-xl p-3 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Calendar size={14} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">Retrait</div>
                  <div className="text-sm font-medium text-gray-800">{format(new Date(plan.order_pickup_date), 'dd/MM/yyyy', { locale: fr })}</div>
                </div>
              </div>
            )}
            {plan.order_total && (
              <div className="bg-white/70 rounded-xl p-3 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Banknote size={14} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">Total</div>
                  <div className="text-sm font-medium text-gray-800">
                    {parseFloat(plan.order_total).toFixed(2)} DH
                    {parseFloat(plan.order_advance_amount) > 0 && (
                      <span className="text-blue-500 text-xs ml-1">(Av. {parseFloat(plan.order_advance_amount).toFixed(2)})</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════ WARNINGS BANNER ══════════════ */}
      {plan.warnings && (plan.warnings as string[]).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
            <span className="text-sm font-semibold text-amber-800">
              Alertes ({(plan.warnings as string[]).length})
            </span>
          </div>
          <ul className="space-y-1.5">
            {[...new Set(plan.warnings as string[])].map((w: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-700">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ══════════════ ROLE FILTER BANNER ══════════════ */}
      {allowedSlugs && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Filter size={16} className="text-amber-600" />
          </div>
          <span className="text-sm text-amber-800">
            Affichage filtre selon votre profil — <strong>{items.length}</strong> produit(s) sur {allItems.length} au total
          </span>
        </div>
      )}

      {/* ══════════════ ITEMS SECTION ══════════════ */}
      {linkedReplenishment ? (() => {
        const repItems = (linkedReplenishment.items || []) as Record<string, unknown>[];
        const planRoleSlugs = plan?.target_role ? getRoleCategorySlugs(plan.target_role as string) : null;
        const effectiveSlugs = allowedSlugs || planRoleSlugs;
        const filteredRepItems = effectiveSlugs
          ? repItems.filter((ri) => effectiveSlugs.includes(ri.category_slug as string))
          : repItems;
        const stockItems = filteredRepItems.filter((ri) => {
          const fromStock = (ri.fulfilled_from_stock as number) || 0;
          const status = ri.status as string;
          return fromStock > 0 || status === 'fulfilled' || status === 'from_stock';
        });
        const hasStock = stockItems.length > 0;
        const hasProduction = items.length > 0;

        return (
          <div className={`grid gap-5 ${hasStock && hasProduction ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
            {/* Stock items */}
            {hasStock && (
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-200 overflow-hidden self-start">
                <div className="bg-gradient-to-r from-emerald-50 to-green-50 px-5 py-4 border-b border-emerald-200 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center">
                    <Box size={18} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-emerald-800">Preleves du stock</h3>
                    <span className="text-xs text-emerald-600">{stockItems.length} article(s)</span>
                  </div>
                </div>
                <div className="divide-y divide-emerald-50">
                  {stockItems.map((ri) => (
                    <div key={ri.id as string} className="px-5 py-3.5 flex items-center gap-3 hover:bg-emerald-50/30 transition-colors">
                      {ri.product_image ? (
                        <img src={ri.product_image as string} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                          <Package size={16} className="text-emerald-600" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{ri.product_name as string}</div>
                        <div className="text-xs text-gray-400">{ri.category_name as string}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="font-bold text-emerald-700">{(ri.fulfilled_from_stock as number) || 0}</span>
                        <span className="text-xs text-gray-400 ml-0.5">/ {(ri.requested_quantity as number) || 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-emerald-50 px-5 py-2.5 border-t border-emerald-200">
                  <span className="text-xs text-emerald-600 flex items-center gap-1.5">
                    <TrendingUp size={12} /> Transfert auto — Demande {linkedReplenishment.request_number as string}
                  </span>
                </div>
              </div>
            )}

            {/* Production items — simple table */}
            {hasProduction && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden self-start">
                <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
                  <Factory size={16} className="text-blue-600" />
                  <h3 className="font-semibold text-gray-900 text-sm">A produire</h3>
                  <span className="text-xs text-gray-400">{items.length} article(s)</span>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      <th className="text-left px-5 py-2.5">Produit</th>
                      <th className="text-center px-3 py-2.5 w-14">Qte</th>
                      <th className="text-center px-3 py-2.5 w-14">Fait</th>
                      <th className="text-left px-3 py-2.5">N° Lot</th>
                      <th className="text-center px-3 py-2.5">Date de production</th>
                      <th className="text-left px-3 py-2.5">Produit par</th>
                      <th className="text-center px-3 py-2.5">Date d'expiration</th>
                      <th className="text-center px-3 py-2.5">Cycle de vie</th>
                      <th className="text-center px-3 py-2.5 w-24">Statut</th>
                      <th className="text-center px-3 py-2.5 w-24"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: Record<string, unknown>, idx: number) => {
                      const itemStatus = (item.status as string) || 'pending';
                      const isPending = itemStatus === 'pending';
                      const isInProgress = itemStatus === 'in_progress';
                      const isItemWaiting = item.waiting_status === 'waiting';
                      const isProduced = itemStatus === 'produced' || itemStatus === 'transferred' || itemStatus === 'received';
                      const isCancelled = itemStatus === 'cancelled';
                      const prodTs = item.production_timestamp || item.produced_at;
                      const startTs = item.started_at as string | null;
                      const prodDate = prodTs ? new Date(prodTs as string) : new Date(plan.plan_date);
                      const sld = item.shelf_life_days as number;
                      const dlcD = item.expires_at ? new Date(item.expires_at as string) : sld ? new Date(prodDate.getTime() + sld * 86400000) : null;
                      const nowD = new Date();
                      const prodBy = item.produced_by_first_name ? `${item.produced_by_first_name} ${item.produced_by_last_name}` : null;
                      const startedBy = item.started_by_first_name ? `${item.started_by_first_name} ${item.started_by_last_name}` : null;
                      const planDateObj = new Date(plan.plan_date as string);
                      const lotNumber = (item.lot_number as string) || `LOT-${format(planDateObj, 'yyMMdd')}-${String(idx + 1).padStart(3, '0')}`;

                      return (
                        <tr key={item.id as string} className={`border-b border-gray-50 transition-colors hover:bg-gray-50/60 ${isCancelled ? 'opacity-40' : ''} ${isInProgress ? 'bg-blue-50/40' : idx % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                          <td className="px-5 py-3">
                            <span className={`font-medium ${isCancelled ? 'line-through text-gray-400' : 'text-gray-900'}`}>{item.product_name as string}</span>
                          </td>
                          <td className="px-3 py-3 text-center font-bold text-gray-600">{item.planned_quantity as number}</td>
                          <td className="px-3 py-3 text-center">
                            {item.actual_quantity != null ? (
                              <span className={`font-bold ${(item.actual_quantity as number) >= (item.planned_quantity as number) ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {item.actual_quantity as number}
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-gray-600 font-mono whitespace-nowrap">
                            {(isProduced || isInProgress) ? lotNumber : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-center text-gray-600 whitespace-nowrap">
                            {isProduced && prodTs ? format(prodDate, 'dd/MM/yy HH:mm') : isInProgress && startTs ? format(new Date(startTs), 'dd/MM/yy HH:mm') : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-gray-600">
                            {isProduced && prodBy ? prodBy : isInProgress && startedBy ? startedBy : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            {isProduced && dlcD ? (
                              <span className={dlcD <= nowD ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                                {dlcD <= nowD ? 'Expire' : format(dlcD, 'dd/MM/yyyy')}
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            {isProduced ? (
                              (item.is_reexposable as boolean) ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700">DLV</span>
                              ) : (item.is_recyclable as boolean) ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-50 text-cyan-700">Recyclable</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700">Vente du jour</span>
                              )
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {isProduced ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700"><CheckCircle size={11} /> Produit</span>
                            ) : isInProgress ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 animate-pulse"><Play size={11} /> En cours</span>
                            ) : isCancelled ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600"><XCircle size={11} /> Annule</span>
                            ) : isItemWaiting ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-600"><Clock size={11} /> Attente</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">A faire</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {plan.status === 'in_progress' && isChef && isPending && !isItemWaiting ? (
                              <button onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-1">
                                <Play size={12} /> Lancer
                              </button>
                            ) : plan.status === 'in_progress' && isChef && isInProgress ? (
                              <button onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors inline-flex items-center gap-1">
                                <Play size={12} /> Continuer
                              </button>
                            ) : isProduced ? (
                              <button onClick={() => printProductionTicket(item)} className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1" title="Imprimer ticket">
                                <Printer size={13} /> Ticket
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>
        );
      })() : (
        /* Non-replenishment plan: simple table */
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Layers size={16} className="text-amber-600" />
              <h2 className="font-semibold text-gray-900 text-sm">Articles du plan</h2>
              <span className="text-xs text-gray-400">{items.length} article(s)</span>
            </div>
            {plan.status === 'in_progress' && totalActive > 0 && (
              <div className="flex items-center gap-3">
                <div className="w-28 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="text-xs font-medium text-gray-500">{producedCount}/{totalActive}</span>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                <th className="text-left px-5 py-2.5">Produit</th>
                <th className="text-center px-3 py-2.5 w-14">Qte</th>
                <th className="text-center px-3 py-2.5 w-14">Fait</th>
                <th className="text-left px-3 py-2.5">N° Lot</th>
                <th className="text-center px-3 py-2.5">Date de production</th>
                <th className="text-left px-3 py-2.5">Produit par</th>
                <th className="text-center px-3 py-2.5">Date d'expiration</th>
                <th className="text-center px-3 py-2.5">Cycle de vie</th>
                <th className="text-center px-3 py-2.5 w-24">Statut</th>
                <th className="text-center px-3 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: Record<string, unknown>, idx: number) => {
                const itemStatus = (item.status as string) || 'pending';
                const isInProgress = itemStatus === 'in_progress';
                const isWaiting = item.waiting_status === 'waiting';
                const isCancelled = itemStatus === 'cancelled';
                const isProduced = itemStatus === 'produced' || itemStatus === 'transferred' || itemStatus === 'received';
                const prodTimestamp = item.production_timestamp || item.produced_at;
                const startTs = item.started_at as string | null;
                const prodDate = prodTimestamp ? new Date(prodTimestamp as string) : new Date(plan.plan_date);
                const sldays = item.shelf_life_days as number;
                const dlcDate = item.expires_at ? new Date(item.expires_at as string) : sldays ? new Date(prodDate.getTime() + sldays * 86400000) : null;
                const now = new Date();
                const producedBy = item.produced_by_first_name ? `${item.produced_by_first_name} ${item.produced_by_last_name}` : null;
                const startedBy = item.started_by_first_name ? `${item.started_by_first_name} ${item.started_by_last_name}` : null;
                const planDateObj2 = new Date(plan.plan_date as string);
                const lotNumber = (item.lot_number as string) || `LOT-${format(planDateObj2, 'yyMMdd')}-${String(idx + 1).padStart(3, '0')}`;

                return (
                  <tr key={item.id as string} className={`border-b border-gray-50 transition-colors hover:bg-gray-50/60 ${isCancelled ? 'opacity-40' : ''} ${isInProgress ? 'bg-blue-50/40' : idx % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                    <td className="px-5 py-3">
                      <span className={`font-medium ${isCancelled ? 'line-through text-gray-400' : 'text-gray-900'}`}>{item.product_name as string}</span>
                    </td>
                    <td className="px-3 py-3 text-center font-bold text-gray-600">{item.planned_quantity as number}</td>
                    <td className="px-3 py-3 text-center">
                      {item.actual_quantity != null ? (
                        <span className={`font-bold ${(item.actual_quantity as number) >= (item.planned_quantity as number) ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {item.actual_quantity as number}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-gray-600 font-mono whitespace-nowrap">
                      {(isProduced || isInProgress) ? lotNumber : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center text-gray-600 whitespace-nowrap">
                      {isProduced && prodTimestamp ? format(prodDate, 'dd/MM/yy HH:mm') : isInProgress && startTs ? format(new Date(startTs), 'dd/MM/yy HH:mm') : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-gray-600">
                      {isProduced && producedBy ? producedBy : isInProgress && startedBy ? startedBy : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      {isProduced && dlcDate ? (
                        <span className={dlcDate <= now ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                          {dlcDate <= now ? 'Expire' : format(dlcDate, 'dd/MM/yyyy')}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      {isProduced ? (
                        (item.is_reexposable as boolean) ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700">DLV</span>
                        ) : (item.is_recyclable as boolean) ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-50 text-cyan-700">Recyclable</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700">Vente du jour</span>
                        )
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {itemStatus === 'produced' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700"><CheckCircle size={11} /> Produit</span>
                      ) : itemStatus === 'transferred' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700"><TrendingUp size={11} /> Transfere</span>
                      ) : itemStatus === 'received' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700"><Package size={11} /> Recu</span>
                      ) : isInProgress ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 animate-pulse"><Play size={11} /> En cours</span>
                      ) : isCancelled ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600"><XCircle size={11} /> Annule</span>
                      ) : isWaiting ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-600"><Clock size={11} /> Attente</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">A faire</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {plan.status === 'in_progress' && isChef && itemStatus === 'pending' && !isWaiting ? (
                        <button onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-1">
                          <Play size={12} /> Lancer
                        </button>
                      ) : plan.status === 'in_progress' && isChef && isInProgress ? (
                        <button onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors inline-flex items-center gap-1">
                          <Play size={12} /> Continuer
                        </button>
                      ) : isProduced ? (
                        <button onClick={() => printProductionTicket(item)} className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1" title="Imprimer ticket">
                          <Printer size={13} /> Ticket
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ══════════════ WAITING LIST ══════════════ */}
      {plan.status !== 'draft' && (() => {
        const waitingItems = items.filter((it: Record<string, unknown>) => it.waiting_status === 'waiting');
        const restoredItems = items.filter((it: Record<string, unknown>) => it.waiting_status === 'restored');
        if (waitingItems.length === 0 && restoredItems.length === 0) return null;
        return (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-4 border-b border-amber-200 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                <Clock size={18} className="text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-amber-900">Liste d'attente</h2>
                {waitingItems.length > 0 && <span className="text-xs text-amber-600">{waitingItems.length} en attente</span>}
              </div>
            </div>

            {waitingItems.length > 0 && (
              <div className="mx-5 mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-center gap-3">
                <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
                <span className="text-sm text-amber-800">
                  Ces articles ne peuvent pas etre produits — ingredients insuffisants.
                  {plan.status === 'in_progress' && ' La production ne peut pas etre terminee tant que des articles sont en attente.'}
                </span>
              </div>
            )}

            <div className="p-5 space-y-2">
              {waitingItems.map((item: Record<string, unknown>) => (
                <div key={item.id as string} className="flex items-center gap-3 p-3.5 bg-amber-50/50 rounded-xl border border-amber-100 hover:bg-amber-50 transition-colors">
                  {item.product_image ? (
                    <img src={item.product_image as string} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <Clock size={16} className="text-amber-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{item.product_name as string}</div>
                    <div className="text-xs text-amber-600">Qte planifiee: {item.planned_quantity as number}</div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 flex items-center gap-1">
                    <Clock size={10} /> En attente
                  </span>
                  {isChef && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => restoreMutation.mutate([item.id as string])}
                        disabled={restoreMutation.isPending}
                        className="px-3 py-1.5 text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg flex items-center gap-1 transition-colors"
                      >
                        <RotateCcw size={12} /> Restaurer
                      </button>
                      <button
                        onClick={() => cancelItemsMutation.mutate({ itemIds: [item.id as string], reason: 'Annule depuis la liste d\'attente' })}
                        disabled={cancelItemsMutation.isPending}
                        className="px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 rounded-lg flex items-center gap-1 transition-colors"
                      >
                        <XCircle size={12} /> Annuler
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {restoredItems.map((item: Record<string, unknown>) => (
                <div key={item.id as string} className="flex items-center gap-3 p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-100">
                  {item.product_image ? (
                    <img src={item.product_image as string} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <CheckCircle size={16} className="text-emerald-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{item.product_name as string}</div>
                    <div className="text-xs text-emerald-600">Qte planifiee: {item.planned_quantity as number}</div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 flex items-center gap-1">
                    <CheckCircle size={10} /> Restaure
                  </span>
                </div>
              ))}
            </div>

            {waitingItems.length > 1 && isChef && (
              <div className="px-5 pb-4 flex justify-end">
                <button
                  onClick={() => restoreMutation.mutate(waitingItems.map((it: Record<string, unknown>) => it.id as string))}
                  disabled={restoreMutation.isPending}
                  className="px-5 py-2.5 text-sm font-medium bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 rounded-xl flex items-center gap-2 transition-all shadow-md"
                >
                  <RotateCcw size={14} /> Restaurer tous ({waitingItems.length})
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ══════════════ INGREDIENT NEEDS ══════════════ */}
      {plan.status !== 'draft' && needs.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
                <Beaker size={18} className="text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Besoins en ingredients</h2>
                <span className="text-xs text-gray-500">{needs.length} ingredient(s)</span>
              </div>
            </div>
            {insufficientNeeds.length > 0 && (
              <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-100 text-red-700 flex items-center gap-1.5">
                <AlertTriangle size={12} /> {insufficientNeeds.length} insuffisant(s)
              </span>
            )}
          </div>

          <div className="divide-y divide-gray-50">
            {needs.map((need: Record<string, unknown>) => {
              const needed = parseFloat(need.needed_quantity as string);
              const available = parseFloat(need.available_quantity as string);
              const sufficient = need.is_sufficient as boolean;
              const pct = needed > 0 ? Math.min(Math.round((available / needed) * 100), 100) : 100;

              return (
                <div key={need.id as string} className={`px-5 py-3.5 flex items-center gap-4 hover:bg-gray-50/50 transition-colors ${!sufficient ? 'bg-red-50/30' : ''}`}>
                  {/* Left color bar */}
                  <div className={`w-1 h-10 rounded-full flex-shrink-0 ${sufficient ? 'bg-emerald-500' : 'bg-red-400'}`} />
                  {/* Name + unit */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900">{need.ingredient_name as string}</div>
                    <div className="text-xs text-gray-400">{need.unit as string}</div>
                  </div>
                  {/* Progress bar */}
                  <div className="w-24 flex-shrink-0">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${sufficient ? 'bg-emerald-500' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5 text-center">{pct}%</div>
                  </div>
                  {/* Quantities */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-center">
                      <div className="text-[10px] text-gray-400 uppercase tracking-wide">Besoin</div>
                      <div className="text-sm font-bold text-gray-700">{needed.toFixed(2)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-gray-400 uppercase tracking-wide">Dispo</div>
                      <div className="text-sm font-bold text-gray-700">{available.toFixed(2)}</div>
                    </div>
                  </div>
                  {/* Status */}
                  {sufficient ? (
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 flex items-center gap-1 flex-shrink-0">
                      <CheckCircle size={10} /> OK
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 flex items-center gap-1 flex-shrink-0">
                      <AlertTriangle size={10} /> -{(needed - available).toFixed(2)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════ FEFO LOT SELECTION PREVIEW ══════════════ */}
      {['confirmed', 'in_progress'].includes(plan.status) && (fefoPreview as Record<string, unknown>[]).length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center">
              <Layers size={18} className="text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Selection FEFO des lots</h2>
              <span className="text-xs text-gray-500">{(fefoPreview as Record<string, unknown>[]).length} ingredient(s)</span>
            </div>
          </div>

          <div className="divide-y divide-gray-50">
            {(fefoPreview as Record<string, unknown>[]).map((item: Record<string, unknown>) => {
              const ingredientId = item.ingredientId as string;
              const lots = (item.lots || []) as Record<string, unknown>[];
              const shortfall = item.shortfall as number;
              const hasExpiringSoon = lots.some((l) => l.isExpiringSoon);
              const isExpanded = expandedFefoIngredients.has(ingredientId);
              const barColor = shortfall > 0 ? 'bg-red-400' : hasExpiringSoon ? 'bg-orange-400' : 'bg-emerald-500';

              return (
                <div key={ingredientId}>
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedFefoIngredients((prev) => {
                        const next = new Set(prev);
                        if (next.has(ingredientId)) next.delete(ingredientId);
                        else next.add(ingredientId);
                        return next;
                      });
                    }}
                    className="w-full px-5 py-3.5 flex items-center gap-4 hover:bg-gray-50/50 transition-colors text-left"
                  >
                    <div className={`w-1 h-10 rounded-full flex-shrink-0 ${barColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900">{item.ingredientName as string}</div>
                      <div className="text-xs text-gray-400">{item.ingredientUnit as string}</div>
                    </div>
                    <div className="text-center flex-shrink-0">
                      <div className="text-[10px] text-gray-400 uppercase tracking-wide">Besoin</div>
                      <div className="text-sm font-bold text-gray-700">{(item.neededQuantity as number).toFixed(2)}</div>
                    </div>
                    <div className="text-center flex-shrink-0">
                      <div className="text-[10px] text-gray-400 uppercase tracking-wide">Lots</div>
                      <div className="text-sm font-bold text-gray-700">{lots.length}</div>
                    </div>
                    {shortfall > 0 && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 flex items-center gap-1 flex-shrink-0">
                        <AlertTriangle size={10} /> -{shortfall.toFixed(2)}
                      </span>
                    )}
                    {hasExpiringSoon && !shortfall && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700 flex items-center gap-1 flex-shrink-0">
                        <Flame size={10} /> DLC proche
                      </span>
                    )}
                    {!shortfall && !hasExpiringSoon && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 flex items-center gap-1 flex-shrink-0">
                        <CheckCircle size={10} /> OK
                      </span>
                    )}
                    <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isExpanded && lots.length > 0 && (
                    <div className="bg-gray-50/50 px-5 pb-3">
                      <div className="ml-5 space-y-1.5">
                        {lots.map((lot: Record<string, unknown>) => {
                          const isExpiringSoon = lot.isExpiringSoon as boolean;
                          const daysUntilExpiry = lot.daysUntilExpiry as number | null;
                          return (
                            <div key={lot.lotId as string} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs ${isExpiringSoon ? 'bg-orange-50 border border-orange-200' : 'bg-white border border-gray-100'}`}>
                              <span className="font-mono px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800 font-medium">
                                {(lot.lotNumber as string) || '—'}
                              </span>
                              <span className="text-gray-500">
                                {(lot.supplierLotNumber as string) || 'Sans ref.'}
                              </span>
                              <span className="font-bold text-gray-700">
                                {(lot.quantityToUse as number).toFixed(2)} / {(lot.quantityAvailable as number).toFixed(2)}
                              </span>
                              {lot.expirationDate && (
                                <span className={`px-1.5 py-0.5 rounded flex items-center gap-1 ${isExpiringSoon ? 'bg-orange-100 text-orange-700 font-medium' : 'bg-gray-100 text-gray-600'}`}>
                                  {isExpiringSoon && <Flame size={10} className="text-orange-500" />}
                                  DLC: {format(new Date(lot.expirationDate as string), 'dd/MM/yyyy')}
                                </span>
                              )}
                              {daysUntilExpiry !== null && (
                                <span className={`px-1.5 py-0.5 rounded ${daysUntilExpiry < 3 ? 'bg-orange-100 text-orange-700 font-medium' : daysUntilExpiry < 7 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
                                  {daysUntilExpiry < 0 ? 'Expire' : `J-${daysUntilExpiry}`}
                                </span>
                              )}
                              {lot.supplierName && (
                                <span className="text-gray-400 ml-auto">{String(lot.supplierName)}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════ LOT TRACEABILITY ══════════════ */}
      {(plan.status === 'completed' || plan.status === 'in_progress') && (productionLotUsage as Record<string, unknown>[]).length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
              <Layers size={18} className="text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Tracabilite des lots</h2>
              <span className="text-xs text-gray-500">{(productionLotUsage as Record<string, unknown>[]).length} lot(s) d'ingredients utilise(s)</span>
            </div>
          </div>

          <div className="divide-y divide-gray-50">
            {(productionLotUsage as Record<string, unknown>[]).map((usage, idx) => {
              const expDate = usage.expiration_date ? new Date(usage.expiration_date as string) : null;
              const isExpired = expDate && expDate < new Date();

              return (
                <div key={idx} className="px-5 py-3.5 flex items-center gap-4 hover:bg-gray-50/50 transition-colors">
                  <div className={`w-1 h-10 rounded-full flex-shrink-0 ${isExpired ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900">{usage.ingredient_name as string}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {(usage.supplier_lot_number as string) || 'Sans ref.'}
                      </span>
                      {expDate && (
                        <span className={`text-[10px] ${isExpired ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
                          DLC: {format(expDate, 'dd/MM/yyyy')}
                        </span>
                      )}
                      {usage.received_at && (
                        <span className="text-[10px] text-gray-400">
                          Recu: {format(new Date(usage.received_at as string), 'dd/MM/yyyy')}
                        </span>
                      )}
                      {usage.supplier_name ? <span className="text-[10px] text-gray-400">— {String(usage.supplier_name)}</span> : null}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-gray-700">{parseFloat(usage.quantity_used as string).toFixed(2)}</div>
                    <div className="text-[10px] text-gray-400">{(usage.ingredient_unit as string) || ''} utilise(s)</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════ PRODUCTION LAUNCH MODAL (4-step) ══════════════ */}
      {showProductionLaunch && (
        <ProductionLaunchModal
          planId={id!}
          plan={plan}
          items={items.filter((it: Record<string, unknown>) => it.status === 'in_progress' || it.status === 'pending')}
          targetItemId={launchTargetItemId}
          needs={needs}
          fefoPreview={fefoPreview}
          onClose={() => { setShowProductionLaunch(false); setLaunchTargetItemId(null); }}
          onCompleted={() => {}}
        />
      )}
    </div>
  );
}

