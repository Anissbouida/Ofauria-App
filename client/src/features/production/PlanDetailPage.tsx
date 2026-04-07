import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionApi } from '../../api/production.api';
import { replenishmentApi } from '../../api/replenishment.api';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { PRODUCTION_STATUS_LABELS, getRoleCategorySlugs } from '@ofauria/shared';
import { usePermissions } from '../../context/PermissionsContext';
import { ArrowLeft, CheckCircle, Play, AlertTriangle, Factory, Printer, Filter, Package, User, Phone, Calendar, Banknote, Box, Clock, RotateCcw, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
};

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showCompletion, setShowCompletion] = useState(false);
  const { settings } = useSettings();
  const isChef = ['admin', 'manager', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'].includes(user?.role || '');

  const { data: plan, isLoading, refetch } = useQuery({
    queryKey: ['production', id],
    queryFn: () => productionApi.getById(id!),
    enabled: !!id,
  });

  // Load linked replenishment request if this plan was auto-generated
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
        result.warnings.forEach((w: string) => toast(w, { icon: '⚠️', duration: 5000 }));
      }
    },
  });

  const printBonDeCommande = (planData?: Record<string, unknown>) => {
    const p = planData || plan;
    if (!p) return;
    // Use role-filtered items and needs
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
    <strong>N° Plan :</strong> ${(p.id as string).slice(0, 8).toUpperCase()}<br/>
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
    // Use role-filtered items and needs for printing
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
    <strong>N° Plan :</strong> ${(p.id as string).slice(0, 8).toUpperCase()}<br/>
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

  // ═══ Modification 2: Restore items from waiting list ═══
  const restoreMutation = useMutation({
    mutationFn: (itemIds: string[]) => productionApi.restoreItems(id!, itemIds),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      if (result.warnings?.length > 0) {
        result.warnings.forEach((w: string) => toast(w, { icon: '⚠️', duration: 5000 }));
      } else {
        toast.success('Article(s) restaure(s) avec succes');
      }
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Erreur lors de la restauration');
    },
  });

  // ═══ Point 8: Cancel items from production plan ═══
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

  // Permission-based filtering: chef roles ALWAYS see only their own section
  // Admin/manager see everything or filtered by plan's target_role
  const { getModuleConfig } = usePermissions();
  const prodConfig = getModuleConfig('production');
  const userRole = user?.role || '';
  const isChefRole = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'].includes(userRole);
  const allowedSlugs = plan?.order_id
    ? null  // Order-linked plans: show all items
    : isChefRole
      ? getRoleCategorySlugs(userRole) // Chef: always filter by own role
      : plan?.target_role
        ? getRoleCategorySlugs(plan.target_role as string)
        : (prodConfig.category_slugs as string[] | undefined) || null;

  if (isLoading) return <p className="text-gray-500">Chargement...</p>;
  if (!plan) return <p className="text-gray-500">Plan non trouve</p>;

  const allItems = plan.items || [];
  const items = allowedSlugs
    ? allItems.filter((it: Record<string, unknown>) => allowedSlugs.includes(it.category_slug as string))
    : allItems;
  const allNeeds = (plan.ingredient_needs || []) as Record<string, unknown>[];
  // Filter ingredient needs by allowed categories, then aggregate by ingredient
  const filteredNeeds = allowedSlugs
    ? allNeeds.filter((n) => allowedSlugs.includes(n.category_slug as string))
    : allNeeds;
  // Aggregate needs by ingredient (same ingredient may appear for multiple products)
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/production')} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-bakery-chocolate">
              Plan du {format(new Date(plan.plan_date), 'dd MMMM yyyy', { locale: fr })}
            </h1>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[plan.status]}`}>
              {plan.status === 'completed' && plan.completion_type === 'partial'
                ? 'Termine partiel'
                : plan.status === 'completed' && plan.completion_type === 'complete'
                ? 'Termine complet'
                : PRODUCTION_STATUS_LABELS[plan.status as keyof typeof PRODUCTION_STATUS_LABELS]}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Cree par {plan.created_by_name}
            {plan.target_role && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                plan.target_role === 'baker' ? 'bg-amber-100 text-amber-800' :
                plan.target_role === 'pastry_chef' ? 'bg-pink-100 text-pink-800' :
                plan.target_role === 'viennoiserie' ? 'bg-orange-100 text-orange-800' :
                plan.target_role === 'beldi_sale' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
              }`}>
                {plan.target_role === 'baker' ? 'Boulanger' : plan.target_role === 'pastry_chef' ? 'Patissier' : plan.target_role === 'viennoiserie' ? 'Viennoiserie' : plan.target_role === 'beldi_sale' ? 'Beldi & Sale' : plan.target_role}
              </span>
            )}
            {plan.notes && ` — ${plan.notes}`}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          {plan.status === 'draft' && isChef && (
            <button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}
              className="btn-primary flex items-center gap-2">
              <CheckCircle size={18} /> {confirmMutation.isPending ? 'Confirmation...' : 'Confirmer le plan'}
            </button>
          )}
          {plan.status === 'confirmed' && (
            <>
              <button onClick={() => printBonDeCommande()} className="btn-secondary flex items-center gap-2">
                <Printer size={18} /> Bon de commande
              </button>
              {isChef && (
                <button onClick={() => startMutation.mutate()} disabled={startMutation.isPending}
                  className="btn-primary flex items-center gap-2">
                  <Play size={18} /> {startMutation.isPending ? 'Demarrage...' : 'Demarrer la production'}
                </button>
              )}
            </>
          )}
          {plan.status === 'in_progress' && isChef && (() => {
            const produciblePending = items.filter((it: Record<string, unknown>) => it.status === 'pending' && (it.waiting_status !== 'waiting'));
            const waitingCount = items.filter((it: Record<string, unknown>) => it.waiting_status === 'waiting').length;
            const allProduced = produciblePending.length === 0 && items.some((it: Record<string, unknown>) => it.status === 'produced' || it.status === 'transferred' || it.status === 'received');
            return (
              <>
                {produciblePending.length > 0 && (
                  <button onClick={() => setShowCompletion(true)} className="btn-primary flex items-center gap-2">
                    <Factory size={18} /> Produire ({produciblePending.length})
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
                    className="px-4 py-2 bg-amber-100 text-amber-700 hover:bg-amber-200 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                  >
                    <CheckCircle size={18} /> Cloture partielle
                  </button>
                )}
              </>
            );
          })()}
          {plan.status === 'completed' && isChef && (
            <button onClick={() => printFicheProduction()} className="btn-secondary flex items-center gap-2">
              <Printer size={18} /> Fiche de production
            </button>
          )}
        </div>
      </div>

      {/* Linked order info */}
      {plan.order_number && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package size={18} className="text-blue-600" />
            <h3 className="font-semibold text-blue-900">Commande liee : {plan.order_number}</h3>
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
              plan.order_status === 'in_production' ? 'bg-yellow-100 text-yellow-700' :
              plan.order_status === 'ready' ? 'bg-green-100 text-green-700' :
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {plan.order_customer_first_name && (
              <div className="flex items-center gap-2 text-blue-800">
                <User size={14} className="text-blue-500" />
                <span>{plan.order_customer_first_name} {plan.order_customer_last_name || ''}</span>
              </div>
            )}
            {plan.order_customer_phone && (
              <div className="flex items-center gap-2 text-blue-800">
                <Phone size={14} className="text-blue-500" />
                <span>{plan.order_customer_phone}</span>
              </div>
            )}
            {plan.order_pickup_date && (
              <div className="flex items-center gap-2 text-blue-800">
                <Calendar size={14} className="text-blue-500" />
                <span>Retrait: {format(new Date(plan.order_pickup_date), 'dd/MM/yyyy', { locale: fr })}</span>
              </div>
            )}
            {plan.order_total && (
              <div className="flex items-center gap-2 text-blue-800">
                <Banknote size={14} className="text-blue-500" />
                <span>Total: {parseFloat(plan.order_total).toFixed(2)} DH
                  {parseFloat(plan.order_advance_amount) > 0 && (
                    <span className="text-blue-500 ml-1">(Avance: {parseFloat(plan.order_advance_amount).toFixed(2)} DH)</span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Role filter banner */}
      {allowedSlugs && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
          <Filter size={16} className="text-amber-500" />
          <span className="text-sm text-amber-800">
            Affichage filtre selon votre profil — {items.length} produit(s) sur {allItems.length} au total
          </span>
        </div>
      )}

      {/* Two-column layout: Stock items (left) + Production items (right) */}
      {linkedReplenishment ? (() => {
        const repItems = (linkedReplenishment.items || []) as Record<string, unknown>[];
        // Filter replenishment items by plan's target_role categories (so admin sees only relevant items)
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
          <div className={`grid gap-4 ${hasStock && hasProduction ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
            {/* Left column — Stock items */}
            {hasStock && (
              <div className="bg-white rounded-xl shadow-sm border border-green-200 overflow-hidden self-start">
                <div className="bg-green-50 px-5 py-3 border-b border-green-200 flex items-center gap-2">
                  <Box size={18} className="text-green-600" />
                  <h3 className="font-semibold text-green-800 text-sm">Preleves du stock ({stockItems.length})</h3>
                </div>
                <div className="divide-y divide-green-50">
                  {stockItems.map((ri) => (
                    <div key={ri.id as string} className="px-5 py-3 flex items-center gap-3 bg-green-50/30">
                      {ri.product_image ? (
                        <img src={ri.product_image as string} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-green-100 flex items-center justify-center text-sm flex-shrink-0">📦</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{ri.product_name as string}</div>
                        <div className="text-xs text-gray-400">{ri.category_name as string}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="font-semibold text-green-700 text-sm">{(ri.fulfilled_from_stock as number) || 0}</span>
                        <span className="text-xs text-gray-400 ml-0.5">/ {(ri.requested_quantity as number) || 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-green-50 px-5 py-2 border-t border-green-200">
                  <span className="text-xs text-green-600">Transfert auto — Demande {linkedReplenishment.request_number as string}</span>
                </div>
              </div>
            )}

            {/* Right column — Production items */}
            {hasProduction && (
              <div className="bg-white rounded-xl shadow-sm border border-blue-200 overflow-hidden self-start">
                <div className="bg-blue-50 px-5 py-3 border-b border-blue-200 flex items-center gap-2">
                  <Factory size={18} className="text-blue-600" />
                  <h3 className="font-semibold text-blue-800 text-sm">A produire ({items.length})</h3>
                </div>
                <table className="w-full">
                  <thead className="border-b border-blue-100">
                    <tr>
                      <th className="text-left px-5 py-2 text-xs font-medium text-blue-700 uppercase">Produit</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-blue-700 uppercase">Planifie</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-blue-700 uppercase">Produit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-50">
                    {items.map((item: Record<string, unknown>) => (
                      <tr key={item.id as string} className="hover:bg-blue-50/30">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            {item.product_image ? (
                              <img src={item.product_image as string} alt="" className="w-8 h-8 rounded object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-blue-100 flex items-center justify-center text-sm">🥖</div>
                            )}
                            <div>
                              <span className="font-medium text-sm">{item.product_name as string}</span>
                              {(item.notes as string) && <div className="text-xs text-gray-400">{item.notes as string}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-sm">{item.planned_quantity as number}</td>
                        <td className="px-3 py-3 text-right text-sm">
                          {item.actual_quantity != null ? (
                            <span className={`font-semibold ${(item.actual_quantity as number) >= (item.planned_quantity as number) ? 'text-green-600' : 'text-amber-600'}`}>
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
        /* Non-replenishment plan: standard single-column items table */
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Articles du plan ({items.length})</h2>
            {plan.status === 'in_progress' && (() => {
              const produced = items.filter((it: Record<string, unknown>) => it.status === 'produced' || it.status === 'transferred' || it.status === 'received').length;
              const total = items.filter((it: Record<string, unknown>) => it.status !== 'cancelled').length;
              if (produced === 0) return null;
              const pct = Math.round((produced / total) * 100);
              return (
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500">{produced}/{total} ({pct}%)</span>
                </div>
              );
            })()}
          </div>
          <table className="w-full">
            <thead className="border-b">
              <tr>
                <th className="text-left py-2 text-sm font-medium text-gray-500">Produit</th>
                <th className="text-right py-2 text-sm font-medium text-gray-500">Qte planifiee</th>
                <th className="text-right py-2 text-sm font-medium text-gray-500">Qte produite</th>
                <th className="text-left py-2 text-sm font-medium text-gray-500">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item: Record<string, unknown>) => {
                const itemStatus = (item.status as string) || 'pending';
                const statusBadge = itemStatus === 'produced'
                  ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Produit</span>
                  : itemStatus === 'transferred'
                  ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">Transfere</span>
                  : itemStatus === 'received'
                  ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Recu</span>
                  : itemStatus === 'cancelled'
                  ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Annule</span>
                  : item.waiting_status === 'waiting'
                  ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">En attente</span>
                  : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">En cours</span>;
                return (
                  <tr key={item.id as string} className={(itemStatus === 'received' || itemStatus === 'cancelled') ? 'opacity-60' : ''}>
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        {item.product_image ? (
                          <img src={item.product_image as string} alt="" className="w-8 h-8 rounded object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-primary-100 flex items-center justify-center text-sm">🥖</div>
                        )}
                        <span className={`font-medium ${itemStatus === 'cancelled' ? 'line-through' : ''}`}>{item.product_name as string}</span>
                      </div>
                    </td>
                    <td className="py-3 text-right font-semibold">{item.planned_quantity as number}</td>
                    <td className="py-3 text-right">
                      {item.actual_quantity != null ? (
                        <span className={`font-semibold ${(item.actual_quantity as number) >= (item.planned_quantity as number) ? 'text-green-600' : 'text-amber-600'}`}>
                          {item.actual_quantity as number}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-3">{statusBadge}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ Modification 2: Waiting list — items blocked by insufficient ingredients ═══ */}
      {plan.status !== 'draft' && (() => {
        const waitingItems = items.filter((it: Record<string, unknown>) => it.waiting_status === 'waiting');
        const restoredItems = items.filter((it: Record<string, unknown>) => it.waiting_status === 'restored');
        if (waitingItems.length === 0 && restoredItems.length === 0) return null;
        return (
          <div className="card border-amber-200">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={20} className="text-amber-500" />
              <h2 className="text-lg font-semibold text-amber-800">
                Liste d'attente
                {waitingItems.length > 0 && <span className="ml-2 text-sm font-normal text-amber-600">({waitingItems.length} en attente)</span>}
              </h2>
            </div>

            {waitingItems.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle size={16} className="text-amber-500" />
                  <span className="text-sm font-medium text-amber-800">
                    Ces articles ne peuvent pas etre produits — ingredients insuffisants.
                    {plan.status === 'in_progress' && ' La production ne peut pas etre terminee tant que des articles sont en attente.'}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {waitingItems.map((item: Record<string, unknown>) => (
                <div key={item.id as string} className="flex items-center gap-3 p-3 bg-amber-50/50 rounded-lg border border-amber-100">
                  {item.product_image ? (
                    <img src={item.product_image as string} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-amber-100 flex items-center justify-center text-sm flex-shrink-0">⏳</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{item.product_name as string}</div>
                    <div className="text-xs text-amber-600">Qte planifiee: {item.planned_quantity as number}</div>
                  </div>
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">En attente</span>
                  {isChef && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => restoreMutation.mutate([item.id as string])}
                        disabled={restoreMutation.isPending}
                        className="px-3 py-1.5 text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 rounded-lg flex items-center gap-1 transition-colors"
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
                <div key={item.id as string} className="flex items-center gap-3 p-3 bg-green-50/50 rounded-lg border border-green-100">
                  {item.product_image ? (
                    <img src={item.product_image as string} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-green-100 flex items-center justify-center text-sm flex-shrink-0">✅</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{item.product_name as string}</div>
                    <div className="text-xs text-green-600">Qte planifiee: {item.planned_quantity as number}</div>
                  </div>
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Restaure</span>
                </div>
              ))}
            </div>

            {waitingItems.length > 1 && isChef && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => restoreMutation.mutate(waitingItems.map((it: Record<string, unknown>) => it.id as string))}
                  disabled={restoreMutation.isPending}
                  className="px-4 py-2 text-sm font-medium bg-green-600 text-white hover:bg-green-700 rounded-lg flex items-center gap-2 transition-colors"
                >
                  <RotateCcw size={14} /> Restaurer tous ({waitingItems.length})
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Ingredient Needs (only after confirmation) */}
      {plan.status !== 'draft' && needs.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Besoins en ingredients</h2>

          {insufficientNeeds.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3 mb-4">
              <AlertTriangle className="text-amber-500" size={20} />
              <span className="text-amber-800 font-medium">
                {insufficientNeeds.length} ingredient(s) en quantite insuffisante !
              </span>
            </div>
          )}

          <table className="w-full">
            <thead className="border-b">
              <tr>
                <th className="text-left py-2 text-sm font-medium text-gray-500">Ingredient</th>
                <th className="text-left py-2 text-sm font-medium text-gray-500">Unite</th>
                <th className="text-right py-2 text-sm font-medium text-gray-500">Besoin</th>
                <th className="text-right py-2 text-sm font-medium text-gray-500">Disponible</th>
                <th className="text-left py-2 text-sm font-medium text-gray-500">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {needs.map((need: Record<string, unknown>) => {
                const needed = parseFloat(need.needed_quantity as string);
                const available = parseFloat(need.available_quantity as string);
                const sufficient = need.is_sufficient as boolean;
                return (
                  <tr key={need.id as string} className={sufficient ? '' : 'bg-red-50/50'}>
                    <td className="py-3 font-medium">{need.ingredient_name as string}</td>
                    <td className="py-3 text-sm text-gray-500">{need.unit as string}</td>
                    <td className="py-3 text-right font-semibold">{needed.toFixed(2)}</td>
                    <td className="py-3 text-right">{available.toFixed(2)}</td>
                    <td className="py-3">
                      {sufficient ? (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Suffisant</span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          Manque {(needed - available).toFixed(2)} {need.unit as string}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Completion Modal */}
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
  items: Record<string, unknown>[]; // filtered items for this role
  allItems: Record<string, unknown>[]; // all items for submission
  onClose: () => void;
  onCompleted: () => void;
}) {
  const queryClient = useQueryClient();
  // Only show pending items (not waiting, not already produced/transferred/received)
  const producibleItems = items.filter((it) => it.status === 'pending' && it.waiting_status !== 'waiting');
  const producibleAllItems = allItems.filter((it) => it.status === 'pending' && it.waiting_status !== 'waiting');
  // Initialize actuals: planned qty for producible items
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
        result.warnings.forEach((w: string) => toast(w, { icon: '⚠️', duration: 5000 }));
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Fixed header */}
        <div className="p-6 pb-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-xl font-bold">Produire les articles</h2>
          <p className="text-sm text-gray-500 mt-1">Saisissez les quantites produites. Mettez 0 pour les articles non encore prets. Le stock sera mis a jour.</p>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 py-4">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-sm font-medium text-gray-500 border-b pb-2 sticky top-0 bg-white">
              <span>Produit</span>
              <span className="text-right">Planifie</span>
              <span className="text-right">Produit</span>
            </div>
            {producibleItems.map((item) => (
              <div key={item.id as string} className="grid grid-cols-3 gap-3 items-center">
                <span className="font-medium text-sm truncate">{item.product_name as string}</span>
                <span className="text-right text-gray-500">{item.planned_quantity as number}</span>
                <input
                  type="number" min="0"
                  value={actuals[item.id as string] || 0}
                  onChange={(e) => setActuals({ ...actuals, [item.id as string]: parseInt(e.target.value) || 0 })}
                  className="input text-right py-1"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Sticky footer */}
        <div className="p-6 pt-4 border-t border-gray-100 flex-shrink-0 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Annuler</button>
          <button onClick={() => produceMutation.mutate()} disabled={produceMutation.isPending || Object.values(actuals).every(q => q <= 0)}
            className="btn-primary flex-1">
            {produceMutation.isPending ? 'Production...' : 'Produire et mettre a jour le stock'}
          </button>
        </div>
      </div>
    </div>
  );
}
