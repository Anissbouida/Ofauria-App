import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

/**
 * Gabarits d'impression du plan de production (ticket de lot, bon de sortie
 * papier, fiche de production). Fonctions pures : elles rendent le HTML, la
 * page l'affiche via PrintOverlay. Sorties de PlanDetailPage (lot 4).
 */
export interface PrintSettings {
  companyName: string;
  subtitle?: string | null;
}

export function buildTicketHtml(plan: Record<string, any>, item: Record<string, any>, settings: PrintSettings): string {
  const prodTs = item.production_timestamp || item.produced_at;
  const prodDate = prodTs ? new Date(prodTs as string) : new Date(plan.plan_date);
  const sld = item.shelf_life_days as number;
  const dlcDate = item.expires_at ? new Date(item.expires_at as string) : sld ? new Date(prodDate.getTime() + sld * 86400000) : null;
  const prodBy = item.produced_by_first_name ? `${item.produced_by_first_name} ${item.produced_by_last_name}` : '—';
  const planDate = new Date(plan.plan_date as string);
  const lotNumber = (item.lot_number as string) || `LOT-${format(planDate, 'yyMMdd')}-${String(1).padStart(3, '0')}`;
  // Audit P1.6 : libelle derive de sale_type (voir buildPrintPayload).
  const saleType = (item.sale_type as string) || 'jour';
  const cycleVie =
    saleType === 'dlv' ? (sld ? `DLC ${sld}j` : 'Multi-jours')
    : saleType === 'commande' ? 'Sur commande'
    : 'Vente du jour';
  const now = format(new Date(), 'dd/MM/yyyy HH:mm');

  return (`<!DOCTYPE html><html><head><title>Ticket - ${item.product_name}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; padding: 15px; color: #333; font-size: 12px; }
.ticket { border: 2px solid #333; padding: 12px; border-radius: 6px; max-width: 80mm; margin: 0 auto; }
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
</style></head><body>
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
  <span class="value">${plan.is_semi_finished_plan && (plan.dependency_of as Record<string, any>[])?.length > 0
    ? ((plan.dependency_of as Record<string, any>[])[0].parent_short_id as string || '').toUpperCase()
    : (plan.id as string).slice(0, 8).toUpperCase()}</span>
</div>
<div class="row">
  <span class="label">Role</span>
  <span class="value">${plan.target_role === 'baker' ? 'Boulanger' : plan.target_role === 'pastry_chef' ? 'Patissier' : plan.target_role === 'viennoiserie' ? 'Viennoiserie' : plan.target_role === 'beldi_sale' ? 'Beldi & Sale' : '—'}</span>
</div>

<div class="cycle ${saleType === 'dlv' ? 'dlv' : saleType === 'commande' ? 'recyclable' : 'vdj'}">
  ${cycleVie}
</div>

<div class="barcode">${lotNumber}</div>

<div class="footer">
  Imprime le ${now}<br/>
  Conservez ce ticket pour la tracabilite
</div>
</div>
</body></html>`);
}


export function buildBsiHtml(plan: Record<string, any>, needs: Record<string, any>[], settings: PrintSettings, planLotPrefix: string): string {
  const dateStr = format(new Date(plan.plan_date as string), 'dd/MM/yyyy');
  const now = format(new Date(), 'dd/MM/yyyy HH:mm');
  const planDate = new Date(plan.plan_date as string);
  const bsiDateStr = `${String(planDate.getFullYear() % 100).padStart(2, '0')}${String(planDate.getMonth() + 1).padStart(2, '0')}${String(planDate.getDate()).padStart(2, '0')}`;
  const hour = new Date().getHours();
  const shift = hour < 14 ? 'Matin' : 'Apres-midi';

  // Build ingredient rows — l'allocation par lot (FEFO) est maintenant geree
  // dans le BSI / module Warehouse. Ici on imprime juste la liste des besoins
  // bruts du plan, sans info de lot.
  const needsForPrint = needs;

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
    const ingredientName = need.ingredient_name as string;
    const neededQty = parseFloat(need.needed_quantity as string);
    const unit = (need.unit as string) || '';
    {
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

  return (`<!DOCTYPE html><html><head><title>BSI - ${dateStr}</title>
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
.back-btn { position: fixed; top: 10px; left: 10px; background: #6b7280; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; z-index: 10; }
@media print { .print-btn, .back-btn { display: none; } body { padding: 15px; } }
</style></head><body>

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
  <strong>N\u00b0 Plan :</strong> ${planLotPrefix}
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
}

export function buildFicheHtml(p: Record<string, any>, planItems: Record<string, any>[], settings: PrintSettings, planLotPrefix: string): string {
  const dateStr = format(new Date(p.plan_date as string), 'dd/MM/yyyy');
  const now = format(new Date(), 'dd/MM/yyyy HH:mm');

  let totalPlanned = 0, totalProduced = 0;
  planItems.forEach((it) => {
    totalPlanned += (it.planned_quantity as number) || 0;
    totalProduced += (it.actual_quantity as number) || 0;
  });
  const globalRate = totalPlanned > 0 ? Math.round((totalProduced / totalPlanned) * 100) : 0;

  return (`<!DOCTYPE html><html><head><title>Fiche de production - ${dateStr}</title>
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
@media print { body { padding: 10px; } .print-btn, .back-btn { display: none; } }
.print-btn { position: fixed; top: 10px; right: 10px; background: #2f855a; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; }
.back-btn { position: fixed; top: 10px; left: 10px; background: #6b7280; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; }
</style></head><body>

<div class="header">
<h1>${settings.companyName}</h1>
<h2>${settings.subtitle}</h2>
<div class="subtitle">Fiche de production</div>
</div>

<div class="info">
<div>
  <strong>N\u00b0 Lot :</strong> ${planLotPrefix}<br/>
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
    ${planItems.map((it: Record<string, any>) => {
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
}
