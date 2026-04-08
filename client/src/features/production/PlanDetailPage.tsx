import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionApi } from '../../api/production.api';
import { replenishmentApi } from '../../api/replenishment.api';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { PRODUCTION_STATUS_LABELS, getRoleCategorySlugs } from '@ofauria/shared';
import { usePermissions } from '../../context/PermissionsContext';
import {
  ArrowLeft, CheckCircle, Play, AlertTriangle, Factory, Printer, Filter, Package,
  User, Phone, Calendar, Banknote, Box, Clock, RotateCcw, XCircle, ChefHat,
  ClipboardList, Hash, FileText, Loader2, PackageOpen, Layers, Beaker, TrendingUp
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

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
  const [showCompletion, setShowCompletion] = useState(false);
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
    <strong>N\u00b0 Plan :</strong> ${(p.id as string).slice(0, 8).toUpperCase()}<br/>
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
    <strong>N\u00b0 Plan :</strong> ${(p.id as string).slice(0, 8).toUpperCase()}<br/>
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
  <h3>Detail de la production</h3>
  <table>
    <thead><tr>
      <th>Produit</th>
      <th class="text-right">Qte planifiee</th>
      <th class="text-right">Qte produite</th>
      <th class="text-right">Ecart</th>
      <th class="text-center">Taux</th>
      <th class="text-center">Statut</th>
    </tr></thead>
    <tbody>
      ${planItems.map((it: Record<string, unknown>) => {
        const planned = (it.planned_quantity as number) || 0;
        const actual = (it.actual_quantity as number) || 0;
        const diff = actual - planned;
        const rate = planned > 0 ? Math.round((actual / planned) * 100) : 0;
        const statusClass = rate >= 100 ? 'ok' : rate >= 80 ? 'warning' : 'warning';
        const statusLabel = rate >= 100 ? 'Complet' : rate >= 80 ? 'Partiel' : 'Insuffisant';
        return `
        <tr>
          <td class="bold">${it.product_name}</td>
          <td class="text-right">${planned}</td>
          <td class="text-right bold">${actual}</td>
          <td class="text-right ${diff > 0 ? 'over' : diff < 0 ? 'warning' : ''}">${diff > 0 ? '+' : ''}${diff}</td>
          <td class="text-center">
            ${rate}%
            <div class="rate-bar"><div class="fill" style="width:${Math.min(rate, 100)}%;background:${rate >= 100 ? '#48bb78' : rate >= 80 ? '#ecc94b' : '#fc8181'}"></div></div>
          </td>
          <td class="text-center"><span class="${statusClass}">${statusLabel}</span></td>
        </tr>`;
      }).join('')}
      <tr style="border-top:2px solid #333; font-weight:bold; background:#f7fafc">
        <td>TOTAL</td>
        <td class="text-right">${totalPlanned}</td>
        <td class="text-right">${totalProduced}</td>
        <td class="text-right ${totalProduced - totalPlanned >= 0 ? 'ok' : 'warning'}">${totalProduced - totalPlanned > 0 ? '+' : ''}${totalProduced - totalPlanned}</td>
        <td class="text-center">${globalRate}%</td>
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
  const needs = [...needsMap.values()];
  const insufficientNeeds = needs.filter((n) => parseFloat(n.available_quantity as string) < parseFloat(n.needed_quantity as string));

  const sc = statusConfig[plan.status] || statusConfig.draft;
  const rc = roleConfig[plan.target_role as string];

  // Progress stats
  const producedCount = items.filter((it: Record<string, unknown>) => it.status === 'produced' || it.status === 'transferred' || it.status === 'received').length;
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
                {waitingCount > 0 && <span>{waitingCount} en attente</span>}
                {pendingCount > 0 && <span>{pendingCount} en cours</span>}
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
          const produciblePending = items.filter((it: Record<string, unknown>) => it.status === 'pending' && (it.waiting_status !== 'waiting'));
          const allProduced = produciblePending.length === 0 && items.some((it: Record<string, unknown>) => it.status === 'produced' || it.status === 'transferred' || it.status === 'received');
          return (
            <>
              {produciblePending.length > 0 && (
                <button onClick={() => setShowCompletion(true)} className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm">
                  <Factory size={16} /> Produire ({produciblePending.length})
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

            {/* Production items */}
            {hasProduction && (
              <div className="bg-white rounded-2xl shadow-sm border border-blue-200 overflow-hidden self-start">
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-5 py-4 border-b border-blue-200 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                    <Factory size={18} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-blue-800">A produire</h3>
                    <span className="text-xs text-blue-600">{items.length} article(s)</span>
                  </div>
                </div>
                <table className="w-full">
                  <thead className="border-b border-blue-100">
                    <tr className="bg-blue-50/50">
                      <th className="text-left px-5 py-2.5 text-xs font-semibold text-blue-700 uppercase">Produit</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-blue-700 uppercase">Planifie</th>
                      <th className="text-right px-5 py-2.5 text-xs font-semibold text-blue-700 uppercase">Produit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-50">
                    {items.map((item: Record<string, unknown>) => (
                      <tr key={item.id as string} className="hover:bg-blue-50/30 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            {item.product_image ? (
                              <img src={item.product_image as string} alt="" className="w-10 h-10 rounded-xl object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                                <ClipboardList size={16} className="text-blue-600" />
                              </div>
                            )}
                            <div>
                              <span className="font-medium text-sm">{item.product_name as string}</span>
                              {(item.notes as string) && <div className="text-xs text-gray-400">{item.notes as string}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-right font-semibold text-sm">{item.planned_quantity as number}</td>
                        <td className="px-5 py-3.5 text-right text-sm">
                          {item.actual_quantity != null ? (
                            <span className={`inline-flex items-center gap-1 font-bold ${(item.actual_quantity as number) >= (item.planned_quantity as number) ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {(item.actual_quantity as number) >= (item.planned_quantity as number) && <CheckCircle size={14} />}
                              {item.actual_quantity as number}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })() : (
        /* Non-replenishment plan: card-based items */
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                <Layers size={18} className="text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Articles du plan</h2>
                <span className="text-xs text-gray-500">{items.length} article(s)</span>
              </div>
            </div>
            {plan.status === 'in_progress' && totalActive > 0 && (
              <div className="flex items-center gap-3">
                <div className="w-28 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="text-xs font-medium text-gray-500">{producedCount}/{totalActive} ({progressPct}%)</span>
              </div>
            )}
          </div>
          <div className="divide-y divide-gray-50">
            {items.map((item: Record<string, unknown>) => {
              const itemStatus = (item.status as string) || 'pending';
              const isWaiting = item.waiting_status === 'waiting';
              const isCancelled = itemStatus === 'cancelled';
              const isProduced = itemStatus === 'produced' || itemStatus === 'transferred' || itemStatus === 'received';

              const statusBadgeConfig = itemStatus === 'produced'
                ? { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: <CheckCircle size={12} />, label: 'Produit' }
                : itemStatus === 'transferred'
                ? { bg: 'bg-purple-100', text: 'text-purple-700', icon: <TrendingUp size={12} />, label: 'Transfere' }
                : itemStatus === 'received'
                ? { bg: 'bg-blue-100', text: 'text-blue-700', icon: <Package size={12} />, label: 'Recu' }
                : isCancelled
                ? { bg: 'bg-red-100', text: 'text-red-700', icon: <XCircle size={12} />, label: 'Annule' }
                : isWaiting
                ? { bg: 'bg-amber-100', text: 'text-amber-700', icon: <Clock size={12} />, label: 'En attente' }
                : { bg: 'bg-gray-100', text: 'text-gray-600', icon: <Play size={12} />, label: 'En cours' };

              return (
                <div key={item.id as string} className={`px-5 py-4 flex items-center gap-4 hover:bg-gray-50/50 transition-colors ${isCancelled ? 'opacity-50' : ''}`}>
                  {/* Left color bar */}
                  <div className={`w-1 h-12 rounded-full flex-shrink-0 ${
                    isProduced ? 'bg-emerald-500' : isCancelled ? 'bg-red-300' : isWaiting ? 'bg-amber-400' : 'bg-gray-300'
                  }`} />
                  {/* Image */}
                  {item.product_image ? (
                    <img src={item.product_image as string} alt="" className="w-11 h-11 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                      <ClipboardList size={18} className="text-amber-400" />
                    </div>
                  )}
                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <span className={`font-medium text-sm ${isCancelled ? 'line-through text-gray-400' : 'text-gray-900'}`}>{item.product_name as string}</span>
                    {(item.notes as string) && <div className="text-xs text-gray-400 mt-0.5">{item.notes as string}</div>}
                  </div>
                  {/* Quantities */}
                  <div className="flex items-center gap-5 flex-shrink-0">
                    <div className="text-center">
                      <div className="text-[10px] text-gray-400 uppercase tracking-wide">Planifie</div>
                      <div className="text-lg font-bold text-gray-700">{item.planned_quantity as number}</div>
                    </div>
                    <div className="text-gray-200">/</div>
                    <div className="text-center">
                      <div className="text-[10px] text-gray-400 uppercase tracking-wide">Produit</div>
                      {item.actual_quantity != null ? (
                        <div className={`text-lg font-bold ${(item.actual_quantity as number) >= (item.planned_quantity as number) ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {item.actual_quantity as number}
                        </div>
                      ) : (
                        <div className="text-lg text-gray-300 font-bold">—</div>
                      )}
                    </div>
                  </div>
                  {/* Status badge */}
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1 flex-shrink-0 ${statusBadgeConfig.bg} ${statusBadgeConfig.text}`}>
                    {statusBadgeConfig.icon} {statusBadgeConfig.label}
                  </span>
                </div>
              );
            })}
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

      {/* ══════════════ COMPLETION MODAL ══════════════ */}
      {showCompletion && (
        <CompletionModal
          planId={id!}
          items={items}
          allItems={allItems}
          onClose={() => setShowCompletion(false)}
          onCompleted={async () => {
            const freshPlan = await productionApi.getById(id!);
            printFicheProduction(freshPlan);
          }}
        />
      )}
    </div>
  );
}

function CompletionModal({ planId, items, allItems, onClose, onCompleted }: {
  planId: string;
  items: Record<string, unknown>[];
  allItems: Record<string, unknown>[];
  onClose: () => void;
  onCompleted: () => void;
}) {
  const queryClient = useQueryClient();
  const producibleItems = items.filter((it) => it.status === 'pending' && it.waiting_status !== 'waiting');
  const producibleAllItems = allItems.filter((it) => it.status === 'pending' && it.waiting_status !== 'waiting');
  const [actuals, setActuals] = useState<Record<string, number>>(
    Object.fromEntries(producibleAllItems.map(it => [it.id as string, it.planned_quantity as number]))
  );

  const produceMutation = useMutation({
    mutationFn: () => productionApi.produceItems(
      planId,
      Object.entries(actuals)
        .filter(([, qty]) => qty > 0)
        .map(([planItemId, actualQuantity]) => ({ planItemId, actualQuantity }))
    ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['production'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      const producedCount = Object.values(actuals).filter(q => q > 0).length;
      toast.success(`${producedCount} article(s) produit(s) — stock mis a jour`);
      if (result.autoCompleted) {
        toast.success('Plan de production termine automatiquement', { duration: 4000 });
      }
      if (result.warnings?.length > 0) {
        result.warnings.forEach((w: string) => toast(w, { icon: '\u26a0\ufe0f', duration: 5000 }));
      }
      onClose();
      onCompleted();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Erreur lors de la production';
      toast.error(message);
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header gradient */}
        <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-t-2xl p-5 text-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Factory size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold">Produire les articles</h2>
              <p className="text-emerald-100 text-xs mt-0.5">{producibleItems.length} article(s) a produire — Le stock sera mis a jour</p>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-2">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_80px_90px] gap-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 pb-2">
              <span>Produit</span>
              <span className="text-right">Planifie</span>
              <span className="text-right">Produit</span>
            </div>
            {producibleItems.map((item) => (
              <div key={item.id as string} className="grid grid-cols-[1fr_80px_90px] gap-3 items-center py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors">
                <div className="flex items-center gap-2.5 min-w-0">
                  {item.product_image ? (
                    <img src={item.product_image as string} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                      <ClipboardList size={14} className="text-amber-400" />
                    </div>
                  )}
                  <span className="font-medium text-sm truncate text-gray-800">{item.product_name as string}</span>
                </div>
                <span className="text-right text-gray-500 font-medium">{item.planned_quantity as number}</span>
                <input
                  type="number" min="0"
                  value={actuals[item.id as string] || 0}
                  onChange={(e) => setActuals({ ...actuals, [item.id as string]: parseInt(e.target.value) || 0 })}
                  className="w-full text-right py-2 px-3 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 pt-4 border-t border-gray-100 flex-shrink-0 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors text-sm">
            Annuler
          </button>
          <button onClick={() => produceMutation.mutate()} disabled={produceMutation.isPending || Object.values(actuals).every(q => q <= 0)}
            className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm flex items-center justify-center gap-2">
            {produceMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            {produceMutation.isPending ? 'Production...' : 'Produire et mettre a jour'}
          </button>
        </div>
      </div>
    </div>
  );
}
