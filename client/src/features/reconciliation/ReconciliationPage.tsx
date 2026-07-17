import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Upload, Plus, Trash2, Lock, Unlock, Download, Loader2, CalendarDays,
  ArrowLeftRight, ScrollText, Info, ClipboardPaste, ClipboardList, Printer, Check,
  Settings, Clock, Package,
} from 'lucide-react';
import { reconciliationApi, type ReconLine, type ReconProduct, type ReconReportRow, type SuggestProduct, type SupplySlot } from '../../api/reconciliation.api';
import { parseLoyverseFiles, parseLoyverseCatalogFiles } from './loyverseParser';
import { makeDarijaLookup, normalizeDarijaKey } from './darijaDictionary';
import { notify } from '../../components/ui/InlineNotification';

/** Rapprochement journalier (ISOLE, TEMPORAIRE) : vendu + invendu - recu = ecart (negatif = manque ; repli appro si recu non saisi). */

function nf(v: number, dec = 2) {
  return v.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function qf(v: number) {
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}
function num(v: string | number | null | undefined) {
  const n = typeof v === 'number' ? v : parseFloat(v || '0');
  return Number.isFinite(n) ? n : 0;
}
function ecartColor(e: number) {
  if (e < -0.0001) return '#b71c1c';  // manque (a expliquer)
  if (e > 0.0001) return '#b26a00';   // surplus (vendu plus que recu)
  return '#0e7c3a';
}

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(r => r.map(escape).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function ReconciliationPage() {
  const [tab, setTab] = useState<'fiche' | 'day' | 'catalog' | 'report' | 'settings'>('fiche');
  const tabLabel = { fiche: 'Fiche de besoin', day: 'Journée', catalog: 'Catalogue', report: 'Rapport période', settings: 'Paramètres' }[tab];
  return (
    <div className="odoo-scope">
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <ArrowLeftRight size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Contrôle des ventes</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">{tabLabel}</span>
        </div>
      </div>

      <div className="odoo-tabs">
        <button type="button" onClick={() => setTab('fiche')} className={`odoo-tab ${tab === 'fiche' ? 'active' : ''}`}>
          <ClipboardList size={13} /> <span>Fiche de besoin</span>
        </button>
        <button type="button" onClick={() => setTab('day')} className={`odoo-tab ${tab === 'day' ? 'active' : ''}`}>
          <CalendarDays size={13} /> <span>Journée</span>
        </button>
        <button type="button" onClick={() => setTab('catalog')} className={`odoo-tab ${tab === 'catalog' ? 'active' : ''}`}>
          <Package size={13} /> <span>Catalogue</span>
        </button>
        <button type="button" onClick={() => setTab('report')} className={`odoo-tab ${tab === 'report' ? 'active' : ''}`}>
          <ScrollText size={13} /> <span>Rapport période</span>
        </button>
        <button type="button" onClick={() => setTab('settings')} className={`odoo-tab ${tab === 'settings' ? 'active' : ''}`}>
          <Settings size={13} /> <span>Paramètres</span>
        </button>
      </div>

      <div style={{ padding: '1rem' }}>
        {tab === 'fiche' ? <FicheBesoinsView onValidated={() => setTab('day')} />
         : tab === 'day' ? <DayView />
         : tab === 'catalog' ? <CatalogView />
         : tab === 'report' ? <ReportView />
         : <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
             <SlotsSettingsView />
             <DarijaSettingsView />
           </div>}
      </div>
    </div>
  );
}

// ════════════════════════ FICHE DE BESOIN ══════════════════════

const PRINT_SECTIONS: Record<string, string> = {
  'VIENNOISERIES': 'VIENNOISERIE',
  'SALÉ': 'SALÉ',
  'SALÉ & SOIRÉE': 'SALÉ',
  'GÂTEAUX & COOKIES': 'PÂTISSERIE',
  'MACARON': 'PÂTISSERIE',
  'PIÈCES & PORTIONS': 'PÂTISSERIE',
  'PÂTISSERIE CLASSIQUE': 'PÂTISSERIE',
  'PÂTISSERIE PREMIUM': 'PÂTISSERIE',
  'CAKE ET MUFFINS': 'PÂTISSERIE',
  'BAGUETTE': 'BOULANGERIE',
  'BAGUETTE TRADITION': 'BOULANGERIE',
  'PAIN ROND': 'BOULANGERIE',
  'PAIN SANDWICH': 'BOULANGERIE',
  'GÂTEAUX BELDI – SACHETS': 'BELDI',
  'BARQUETTES 200G': 'BELDI',
  'PLATEAUX & SOIRÉE': 'BELDI',
};

const SECTION_CHEF: Record<string, string> = {
  'VIENNOISERIE': 'Chef Viennoisier',
  'SALÉ': 'Chef Salé',
  'PÂTISSERIE': 'Chef Pâtissier',
  'BOULANGERIE': 'Chef Boulanger',
  'BELDI': 'Chef Beldi',
};

function getSectionName(category: string): string {
  const upper = category.toUpperCase();
  for (const [key, section] of Object.entries(PRINT_SECTIONS)) {
    if (upper === key.toUpperCase()) return section;
  }
  if (upper.includes('VIENNOIS')) return 'VIENNOISERIE';
  if (upper.includes('PÂTISS') || upper.includes('CAKE') || upper.includes('COOKIE') || upper.includes('MACARON') || upper.includes('MUFFIN') || upper.includes('ÉCLAIR') || upper.includes('FINANCIER') || upper.includes('BROWNI')) return 'PÂTISSERIE';
  if (upper.includes('BAGUETTE') || upper.includes('PAIN') || upper.includes('BAG ')) return 'BOULANGERIE';
  if (upper.includes('BELDI') || upper.includes('BARQUETTE') || upper.includes('FEKKAS') || upper.includes('GHRIBA') || upper.includes('SABLÉ')) return 'BELDI';
  if (upper.includes('SALÉ') || upper.includes('MSEMEN') || upper.includes('HARCHA') || upper.includes('HARSHA')) return 'SALÉ';
  return category;
}

/** Echappe le HTML : les noms produits viennent d'un CSV importe (non fiable). */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function printCSS() {
  return `@page{size:A4 portrait;margin:8mm 10mm}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#000}
.section{page-break-after:always;page-break-inside:auto}
.section:last-child{page-break-after:auto}
.header{text-align:center;font-size:15pt;font-weight:bold;margin-bottom:2px;text-transform:capitalize;background:#222;color:#fff;padding:6px 8px;letter-spacing:1px}
.sub-header{text-align:center;font-size:9.5pt;color:#555;margin:5px 0 7px}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th,td{border:1px solid #444;padding:4px 7px;font-size:10.5pt;vertical-align:middle}
th{background:#e0e0e0;text-align:center;font-size:10pt;font-weight:700;text-transform:uppercase}
tbody tr:nth-child(even) td{background:#f7f7f7}
tbody tr.cat-row td{background:#d0d0d0;font-weight:700;font-size:10pt;text-transform:uppercase;letter-spacing:0.3px;padding:5px 7px;border-bottom:2px solid #888;text-align:center}
td.qty{text-align:center;font-weight:bold;font-size:13pt}
td.darija{color:#222;font-size:12.5pt;font-weight:bold;direction:rtl;text-align:right}
td:first-child{text-align:left;font-size:11pt}
td:nth-child(2),td:nth-child(3){text-align:center}
td:last-child{text-align:right}
tfoot td{font-weight:bold;border-top:2px solid #000}
.signatures{display:flex;justify-content:space-between;margin-top:12px}
.sig-box{border:1px solid #000;padding:8px 12px;width:48%;font-size:10pt;line-height:1.9}
.sig-box strong{font-size:10.5pt}
.toolbar{position:fixed;top:14px;right:18px;z-index:10;display:flex;gap:8px}
.toolbar button{font-family:inherit;font-size:14px;font-weight:600;padding:9px 18px;border:none;border-radius:6px;cursor:pointer;background:#1a56db;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.25)}
.toolbar button.secondary{background:#555}
@media screen{
  body{background:#9a9a9a;padding:24px 12px}
  .section{background:#fff;width:210mm;max-width:100%;margin:0 auto 22px;padding:10mm 12mm;box-shadow:0 3px 14px rgba(0,0,0,.35)}
}
@media print{
  .no-print{display:none!important}
}`;
}

const SECTION_ORDER = ['VIENNOISERIE', 'SALÉ', 'PÂTISSERIE', 'BOULANGERIE', 'BELDI'];

function printBonSection(
  date: string,
  grouped: Record<string, SuggestProduct[]>,
  slotsByCategory: Record<string, SupplySlot[]>,
  slotQty: Record<string, string>,
  darijaOf: (name: string) => string,
  filterSection?: string,
) {
  const d = new Date(date + 'T00:00:00');
  const dateFormatted = format(d, 'dd/MM/yyyy', { locale: fr });
  const jourSemaine = format(d, 'EEEE', { locale: fr });

  const bySection: Record<string, { cat: string; products: SuggestProduct[] }[]> = {};
  for (const [cat, products] of Object.entries(grouped)) {
    const section = getSectionName(cat);
    (bySection[section] ??= []).push({ cat, products });
  }

  const orderedSections = filterSection
    ? [filterSection].filter(s => bySection[s])
    : [
        ...SECTION_ORDER.filter(s => bySection[s]),
        ...Object.keys(bySection).filter(s => !SECTION_ORDER.includes(s)),
      ];

  function buildTableRows(
    groups: { cat: string; products: SuggestProduct[] }[],
    qtyKey: (p: SuggestProduct) => string,
    withReste: boolean,
  ): string {
    let rows = '';
    let hasAny = false;
    const colSpan = withReste ? 6 : 5;
    for (const { cat, products } of groups) {
      const active = products.filter(p => num(slotQty[qtyKey(p)]) > 0);
      if (active.length === 0) continue;
      hasAny = true;
      rows += `<tr class="cat-row"><td colspan="${colSpan}">${esc(cat)}</td></tr>`;
      for (const p of active) {
        const dj = darijaOf(p.product_name);
        rows += `<tr><td>${esc(p.product_name)}</td><td class="qty">${esc(slotQty[qtyKey(p)] || '')}</td><td></td><td></td>${withReste ? '<td></td>' : ''}<td class="darija">${esc(dj)}</td></tr>`;
      }
    }
    return hasAny ? rows : '';
  }

  function buildPage(section: string, slotLabel: string | null, jour: string, dateFmt: string, chef: string, rows: string, withReste: boolean): string {
    const title = slotLabel
      ? `${esc(section)} &mdash; ${esc(slotLabel)}`
      : esc(section);
    const restCol = withReste ? '<col style="width:68px">' : '';
    const restTh = withReste ? '<th>RESTE</th>' : '';
    const restTd = withReste ? '<td></td>' : '';
    return `<div class="section">
      <div class="header">${title}</div>
      <div class="sub-header">Commande Magasin &mdash; ${jour} ${dateFmt}</div>
      <table>
        <colgroup><col style="width:36%"><col style="width:68px"><col style="width:68px"><col style="width:68px">${restCol}<col style="width:auto"></colgroup>
        <thead><tr><th style="text-align:left">PRODUIT</th><th>QT&Eacute;</th><th>RE&Ccedil;U</th><th>TRANSF.</th>${restTh}<th style="text-align:right">بالدارجة</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td><strong>TOTAL</strong></td><td></td><td></td><td></td>${restTd}<td></td></tr></tfoot>
      </table>
      <div class="signatures">
        <div class="sig-box"><strong>${chef} (Production)</strong><br>Nom :<br>Signature :</div>
        <div class="sig-box"><strong>Responsable Magasin</strong><br>Nom :<br>Signature :</div>
      </div>
    </div>`;
  }

  const pages: string[] = [];
  for (const section of orderedSections) {
    const groups = bySection[section];
    const allSlots = new Map<number, SupplySlot>();
    for (const { cat } of groups) {
      for (const s of (slotsByCategory[cat] || [])) {
        if (!allSlots.has(s.slot_number)) allSlots.set(s.slot_number, s);
      }
    }
    const slotList = [...allSlots.values()].sort((a, b) => a.sort_order - b.sort_order || a.slot_number - b.slot_number);
    const hasSlots = slotList.length > 0;
    const chef = SECTION_CHEF[section] || `Chef ${section}`;

    const isLastSection = section === orderedSections[orderedSections.length - 1];

    if (hasSlots) {
      for (let si = 0; si < slotList.length; si++) {
        const slot = slotList[si];
        const isLastSlot = isLastSection && si === slotList.length - 1;
        const slotGroups = groups.map(({ cat, products }) => {
          const catSlots = slotsByCategory[cat] || [];
          const matchSlot = catSlots.find(s => s.slot_number === slot.slot_number);
          if (!matchSlot) return null;
          return { cat, products, slotNum: matchSlot.slot_number };
        }).filter(Boolean) as { cat: string; products: SuggestProduct[]; slotNum: number }[];

        const rows = buildTableRows(
          slotGroups.map(g => ({ cat: g.cat, products: g.products })),
          p => `${p.product_key}__${slot.slot_number}`,
          isLastSlot,
        );
        if (!rows) continue;

        pages.push(buildPage(section, `${slot.label.toUpperCase()}`, jourSemaine, dateFormatted, chef, rows, isLastSlot));
      }
    } else {
      const rows = buildTableRows(groups, p => `${p.product_key}__total`, isLastSection);
      if (!rows) continue;
      pages.push(buildPage(section, null, jourSemaine, dateFormatted, chef, rows, isLastSection));
    }
  }

  if (pages.length === 0) { notify.error('Aucun produit avec quantité > 0'); return; }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Bons de Transfert - ${dateFormatted}</title>
<style>${printCSS()}</style></head><body>
<div class="toolbar no-print">
  <button type="button" id="btn-print">&#128424; Imprimer</button>
  <button type="button" id="btn-close" class="secondary">Fermer</button>
</div>
${pages.join('')}
<script src="${window.location.origin}/print-helper.js"></script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { notify.error('Pop-up bloqué — autorisez les pop-ups pour imprimer.'); return; }
  w.document.write(html);
  w.document.close();
  // Cablage principal : /print-helper.js (script 'self', autorise par la CSP de
  // prod qui bloque le JS inline). Repli : listeners attaches depuis l'opener si
  // le script n'a pas charge (__printWired absent).
  setTimeout(() => {
    try {
      if (!(w as any).__printWired) {
        w.document.getElementById('btn-print')?.addEventListener('click', () => w.print());
        w.document.getElementById('btn-close')?.addEventListener('click', () => w.close());
      }
    } catch { /* fenetre fermee entre-temps */ }
  }, 1000);
}

function FicheBesoinsView({ onValidated }: { onValidated: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [slotQty, setSlotQty] = useState<Record<string, string>>({});
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Produits retires de la fiche du jour (masques meme si une suggestion J-7 existe).
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // Ajustement % global, persiste entre les sessions (localStorage).
  const [riskPct, setRiskPct] = useState(() => {
    const v = parseInt(localStorage.getItem('recon-risk-pct') || '0', 10);
    return Number.isFinite(v) ? v : 0;
  });
  // Ajustement % par categorie : prioritaire sur le global quand defini.
  const [catRiskPct, setCatRiskPct] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('recon-risk-pct-cats') || '{}'); }
    catch { return {}; }
  });
  // Produits dont l'utilisateur a modifie les quantites a la main :
  // le recalcul (changement d'ajustement %) ne doit pas les ecraser.
  const touchedRef = useRef<Set<string>>(new Set());

  // Application globale : remplace aussi les ajustements par categorie.
  const changeRisk = (delta: number) => {
    setCatRiskPct({});
    localStorage.setItem('recon-risk-pct-cats', '{}');
    setRiskPct(v => {
      const n = v + delta;
      localStorage.setItem('recon-risk-pct', String(n));
      return n;
    });
  };

  const changeCatRisk = (cat: string, delta: number) => setCatRiskPct(prev => {
    const next = { ...prev, [cat]: (prev[cat] ?? riskPct) + delta };
    localStorage.setItem('recon-risk-pct-cats', JSON.stringify(next));
    return next;
  });

  const { data, isLoading } = useQuery({
    queryKey: ['recon-suggest', date],
    queryFn: () => reconciliationApi.suggest(date),
  });

  const { data: slots = [] } = useQuery({
    queryKey: ['recon-slots'],
    queryFn: () => reconciliationApi.listSlots(),
  });

  const { data: darijaEntries = [] } = useQuery({
    queryKey: ['recon-darija'],
    queryFn: () => reconciliationApi.listDarija(),
  });
  const darijaOf = useMemo(() => makeDarijaLookup(darijaEntries), [darijaEntries]);

  const slotsByCategory = useMemo(() => {
    const m: Record<string, SupplySlot[]> = {};
    for (const s of slots) (m[s.category] ??= []).push(s);
    return m;
  }, [slots]);

  const allProducts = useMemo(() => data?.products || [], [data]);

  const grouped = useMemo(() => {
    if (allProducts.length === 0) return {} as Record<string, SuggestProduct[]>;
    const g: Record<string, SuggestProduct[]> = {};
    for (const p of allProducts) {
      const cat = p.category || 'Non classé';
      (g[cat] ??= []).push(p);
    }
    return g;
  }, [allProducts]);

  useEffect(() => {
    if (!data?.products) return;
    setSlotQty(prev => {
      const init: Record<string, string> = {};
      for (const p of data.products) {
        // Saisie manuelle : on garde les valeurs de l'utilisateur telles quelles.
        if (touchedRef.current.has(p.product_key)) {
          for (const [k, v] of Object.entries(prev)) {
            if (k.startsWith(`${p.product_key}__`)) init[k] = v;
          }
          continue;
        }
        const raw = num(p.suggested_qty);
        if (raw <= 0) continue;
        const cat = p.category || 'Non classé';
        const pct = catRiskPct[cat] ?? riskPct;
        const total = Math.round(raw * (1 + pct / 100));
        const catSlots = slotsByCategory[cat];
        if (catSlots && catSlots.length > 0) {
          let distributed = 0;
          for (let i = 0; i < catSlots.length; i++) {
            const s = catSlots[i];
            const isLast = i === catSlots.length - 1;
            const qty = isLast ? total - distributed : Math.round(total * s.default_pct / 100);
            init[`${p.product_key}__${s.slot_number}`] = String(qty);
            distributed += qty;
          }
          init[`${p.product_key}__total`] = String(total);
        } else {
          init[`${p.product_key}__total`] = String(total);
        }
      }
      return init;
    });
  }, [data, slotsByCategory, riskPct, catRiskPct]);

  const setSlotVal = (key: string, val: string, productKey: string, cat: string) => {
    touchedRef.current.add(productKey);
    setSlotQty(prev => {
      const next = { ...prev, [key]: val };
      const catSlots = slotsByCategory[cat];
      if (catSlots && catSlots.length > 0) {
        let sum = 0;
        for (const s of catSlots) sum += num(next[`${productKey}__${s.slot_number}`]);
        next[`${productKey}__total`] = String(sum);
      }
      return next;
    });
  };

  const setTotalVal = (productKey: string, val: string) => {
    touchedRef.current.add(productKey);
    setSlotQty(prev => ({ ...prev, [`${productKey}__total`]: val }));
  };

  /** Fixe la quantite d'un produit (repartie sur les creneaux de sa categorie). */
  const applyQty = (productKey: string, cat: string, total: number) => {
    touchedRef.current.add(productKey);
    setRemoved(prev => {
      if (!prev.has(productKey)) return prev;
      const n = new Set(prev); n.delete(productKey); return n;
    });
    setSlotQty(prev => {
      const next = { ...prev };
      const catSlots = slotsByCategory[cat] || [];
      if (catSlots.length > 0) {
        let distributed = 0;
        catSlots.forEach((s, i) => {
          const isLast = i === catSlots.length - 1;
          const q = isLast ? total - distributed : Math.round(total * s.default_pct / 100);
          next[`${productKey}__${s.slot_number}`] = String(q);
          distributed += q;
        });
      }
      next[`${productKey}__total`] = String(total);
      return next;
    });
  };

  /** Retire un produit de la fiche du jour : masque + quantites a zero. */
  const removeProduct = (productKey: string) => {
    touchedRef.current.add(productKey);
    setRemoved(prev => new Set(prev).add(productKey));
    setSlotQty(prev => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(`${productKey}__`)) next[k] = '0';
      }
      return next;
    });
  };

  /** Ajout depuis la modale : produit du catalogue, ou creation d'un nouveau. */
  const handleAddProduct = async (f: { name: string; qty: number; category?: string; price?: number }) => {
    const name = f.name.trim();
    const existing = allProducts.find(p => p.product_name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      applyQty(existing.product_key, existing.category || 'Non classé', f.qty);
      setShowAddProduct(false);
      return;
    }
    try {
      const prod = await reconciliationApi.upsertProduct({
        productName: name, category: f.category || undefined, unitPrice: f.price || 0,
      });
      applyQty(prod.product_key, prod.category || 'Non classé', f.qty);
      qc.invalidateQueries({ queryKey: ['recon-suggest'] });
      qc.invalidateQueries({ queryKey: ['recon-products'] });
      setShowAddProduct(false);
      notify.success('Produit créé au catalogue et ajouté à la fiche');
    } catch (e: any) {
      notify.error(e?.response?.data?.error?.message || 'Erreur');
    }
  };

  const activeCount = useMemo(
    () => allProducts.filter(p => num(slotQty[`${p.product_key}__total`]) > 0).length,
    [allProducts, slotQty],
  );

  const validateMut = useMutation({
    mutationFn: async () => {
      const day = await reconciliationApi.openDay(date);
      const rows = allProducts
        .filter(p => num(slotQty[`${p.product_key}__total`]) > 0)
        .map(p => ({
          productName: p.product_name,
          sku: p.sku || undefined,
          category: p.category || undefined,
          approQty: num(slotQty[`${p.product_key}__total`]),
          unitPrice: num(p.unit_price) || undefined,
        }));
      if (rows.length === 0) throw new Error('Aucun produit avec une quantité > 0');
      return reconciliationApi.bulkAppro(day.id, rows);
    },
    onSuccess: (r) => {
      notify.success(`Appro validé : ${r.upserted} produit(s)`);
      qc.invalidateQueries({ queryKey: ['recon-day', date] });
      qc.invalidateQueries({ queryKey: ['recon-suggest'] });
      onValidated();
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || e?.message || 'Erreur'),
  });

  const refLabel = data?.referenceDate
    ? format(new Date(data.referenceDate + 'T00:00:00'), 'EEEE d MMMM', { locale: fr })
    : null;

  const hasProducts = allProducts.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="odoo-alert" style={{ fontSize: '0.75rem', display: 'flex', gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Fiche de besoin d'approvisionnement par créneau.</strong> Le système propose les quantités vendues (J-7)
          réparties selon les créneaux configurés dans <strong>Paramètres</strong>. Ajustez par créneau, puis validez.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={e => { setDate(e.target.value); touchedRef.current.clear(); setRemoved(new Set()); }}
          className="odoo-input" style={{ width: 160 }} />
        <input className="odoo-input" placeholder="Rechercher un produit…" value={search}
          onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
        {refLabel && (
          <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
            Basé sur <strong>{refLabel}</strong>
          </span>
        )}
        {data && !data.referenceDate && data.products.length > 0 && (
          <span className="odoo-tag odoo-tag-orange" style={{ fontSize: '0.6875rem' }}>
            Pas de référence J-7/J-14
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--theme-bg-sidebar, #f5f5f5)', borderRadius: 6, padding: '3px 8px', border: '1px solid var(--theme-bg-separator)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 500, whiteSpace: 'nowrap' }}>Ajustement</span>
          <button type="button" onClick={() => changeRisk(-5)}
            style={{ width: 24, height: 24, border: 'none', borderRadius: 4, background: 'var(--theme-bg-separator)', cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem', lineHeight: 1 }}>−</button>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem', fontWeight: 600, minWidth: 40, textAlign: 'center',
            color: riskPct > 0 ? '#0e7c3a' : riskPct < 0 ? '#b71c1c' : 'var(--theme-text-primary)' }}>
            {riskPct > 0 ? '+' : ''}{riskPct}%
          </span>
          <button type="button" onClick={() => changeRisk(5)}
            style={{ width: 24, height: 24, border: 'none', borderRadius: 4, background: 'var(--theme-bg-separator)', cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem', lineHeight: 1 }}>+</button>
        </div>
        <div style={{ flex: 1 }} />
        <button className="odoo-btn-secondary" onClick={() => setShowAddProduct(true)}>
          <Plus size={14} /> Produit
        </button>
        <div style={{ position: 'relative' }}>
          <button className="odoo-btn-secondary"
            disabled={!hasProducts || activeCount === 0}
            onClick={() => setShowPrintMenu(v => !v)}>
            <Printer size={14} /> Imprimer les bons ▾
          </button>
          {showPrintMenu && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 50,
              background: 'var(--theme-bg-primary, #fff)', border: '1px solid var(--theme-bg-separator)',
              borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.15)', minWidth: 200, overflow: 'hidden',
            }}>
              {SECTION_ORDER.map(s => (
                <button key={s} style={{
                  display: 'block', width: '100%', padding: '8px 14px', border: 'none',
                  background: 'transparent', textAlign: 'left', cursor: 'pointer',
                  fontSize: '0.8125rem', fontWeight: 500,
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--theme-bg-sidebar, #f5f5f5)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => { setShowPrintMenu(false); printBonSection(date, grouped, slotsByCategory, slotQty, darijaOf, s); }}>
                  {s}
                </button>
              ))}
              <div style={{ borderTop: '1px solid var(--theme-bg-separator)' }} />
              <button style={{
                display: 'block', width: '100%', padding: '8px 14px', border: 'none',
                background: 'transparent', textAlign: 'left', cursor: 'pointer',
                fontSize: '0.8125rem', fontWeight: 600,
              }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--theme-bg-sidebar, #f5f5f5)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => { setShowPrintMenu(false); printBonSection(date, grouped, slotsByCategory, slotQty, darijaOf); }}>
                Toutes les sections
              </button>
            </div>
          )}
        </div>
        <button className="odoo-btn-primary"
          disabled={activeCount === 0 || validateMut.isPending}
          onClick={() => validateMut.mutate()}>
          {validateMut.isPending
            ? <><Loader2 size={14} className="animate-spin" /> Validation…</>
            : <><Check size={14} /> Valider l'appro ({activeCount})</>}
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /> Chargement…
        </div>
      ) : !hasProducts ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4 }}>
          Aucun produit dans le catalogue. Importez un CSV Loyverse depuis l'onglet <strong>Catalogue</strong>,
          ou utilisez l'onglet <strong>Journée</strong> pour saisir manuellement.
        </div>
      ) : (
        Object.entries(grouped).map(([cat, products]) => {
          const catSlots = slotsByCategory[cat] || [];
          const q = search.trim().toLowerCase();
          const visible = products.filter(p =>
            !removed.has(p.product_key)
            && (num(p.suggested_qty) > 0 || num(slotQty[`${p.product_key}__total`]) > 0)
            && (!q || p.product_name.toLowerCase().includes(q) || darijaOf(p.product_name).includes(search.trim()))
          );
          if (visible.length === 0) return null;
          // La recherche deplie tout ; sinon on respecte l'etat replie/deplie.
          const isCollapsed = !q && collapsed.has(cat);
          return (
            <div key={cat} style={{ marginBottom: 16 }}>
              <div
                onClick={() => setCollapsed(prev => {
                  const next = new Set(prev);
                  if (next.has(cat)) next.delete(cat); else next.add(cat);
                  return next;
                })}
                style={{
                  fontWeight: 700, padding: '6px 10px',
                  background: 'var(--theme-bg-sidebar, #f5f5f5)',
                  color: 'var(--theme-accent)', fontSize: '0.8125rem',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  borderRadius: isCollapsed ? 4 : '4px 4px 0 0', border: '1px solid var(--theme-bg-separator)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer', userSelect: 'none',
                }}>
                <span>{isCollapsed ? '▸' : '▾'} {cat} ({visible.length})</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} onClick={e => e.stopPropagation()}>
                  {(() => {
                    const pct = catRiskPct[cat] ?? riskPct;
                    const hasOverride = catRiskPct[cat] !== undefined && catRiskPct[cat] !== riskPct;
                    return (
                      <span title="Ajustement % de la catégorie (prioritaire sur le global)"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 3, textTransform: 'none',
                          background: hasOverride ? 'var(--theme-bg-card, #fff)' : 'transparent',
                          border: hasOverride ? '1px solid var(--theme-bg-separator)' : '1px solid transparent',
                          borderRadius: 4, padding: '1px 4px',
                        }}>
                        <button type="button" onClick={() => changeCatRisk(cat, -5)}
                          style={{ width: 18, height: 18, border: 'none', borderRadius: 3, background: 'var(--theme-bg-separator)', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem', lineHeight: 1, padding: 0 }}>−</button>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.6875rem', fontWeight: 600, minWidth: 34, textAlign: 'center',
                          color: pct > 0 ? '#0e7c3a' : pct < 0 ? '#b71c1c' : 'var(--theme-text-muted)' }}>
                          {pct > 0 ? '+' : ''}{pct}%
                        </span>
                        <button type="button" onClick={() => changeCatRisk(cat, 5)}
                          style={{ width: 18, height: 18, border: 'none', borderRadius: 3, background: 'var(--theme-bg-separator)', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem', lineHeight: 1, padding: 0 }}>+</button>
                      </span>
                    );
                  })()}
                  {catSlots.length > 0 && (
                    <span style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--theme-text-muted)', textTransform: 'none' }}>
                      {catSlots.length} créneau{catSlots.length > 1 ? 'x' : ''}
                    </span>
                  )}
                </div>
              </div>
              {!isCollapsed && (
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table" style={{ borderTop: 'none' }}>
                  <thead>
                    <tr>
                      <th>Produit</th>
                      <th style={{ width: 150 }}>Darija</th>
                      <th style={{ textAlign: 'right', width: 70 }}>J-7</th>
                      {catSlots.length > 0 ? (
                        catSlots.map(s => (
                          <th key={s.id} style={{ textAlign: 'right', width: 85 }}>
                            <div>{s.label}</div>
                            <div style={{ fontSize: '0.5625rem', fontWeight: 400, color: 'var(--theme-text-muted)' }}>
                              {s.default_pct}%{s.target_time ? ` · ${s.target_time.slice(0, 5)}` : ''}
                            </div>
                          </th>
                        ))
                      ) : (
                        <th style={{ textAlign: 'right', width: 95 }}>Besoin</th>
                      )}
                      <th style={{ textAlign: 'right', width: 70 }}>Total</th>
                      <th style={{ textAlign: 'right', width: 50 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(p => {
                      const suggested = num(p.suggested_qty);
                      const total = num(slotQty[`${p.product_key}__total`]);
                      return (
                        <tr key={p.product_key}>
                          <td>
                            <span style={{ fontWeight: 500 }}>{p.product_name}</span>
                            {p.sku && <div style={{ fontSize: '0.625rem', color: 'var(--theme-text-muted)', fontFamily: 'monospace' }}>{p.sku}</div>}
                          </td>
                          <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.8125rem', direction: 'rtl', textAlign: 'right' }}>
                            {darijaOf(p.product_name) || '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--theme-text-muted)' }}>
                            {suggested > 0 ? qf(suggested) : '—'}
                          </td>
                          {catSlots.length > 0 ? (
                            catSlots.map(s => {
                              const k = `${p.product_key}__${s.slot_number}`;
                              return (
                                <td key={s.id} style={{ textAlign: 'right' }}>
                                  <input
                                    type="text" inputMode="decimal"
                                    value={slotQty[k] ?? ''}
                                    onChange={e => setSlotVal(k, e.target.value, p.product_key, cat)}
                                    placeholder="0"
                                    style={{
                                      width: 64, textAlign: 'right', padding: '3px 5px',
                                      fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem',
                                      border: '1px solid var(--theme-bg-separator)', borderRadius: 3,
                                    }}
                                  />
                                </td>
                              );
                            })
                          ) : (
                            <td style={{ textAlign: 'right' }}>
                              <input
                                type="text" inputMode="decimal"
                                value={slotQty[`${p.product_key}__total`] ?? ''}
                                onChange={e => setTotalVal(p.product_key, e.target.value)}
                                placeholder="0"
                                style={{
                                  width: 74, textAlign: 'right', padding: '3px 6px',
                                  fontFamily: 'ui-monospace, monospace',
                                  border: '1px solid var(--theme-bg-separator)', borderRadius: 3,
                                }}
                              />
                            </td>
                          )}
                          <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: total > 0 ? 'var(--theme-accent)' : 'var(--theme-text-muted)' }}>
                            {total > 0 ? qf(total) : '—'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button title="Retirer de la fiche du jour"
                              onClick={() => removeProduct(p.product_key)}
                              style={{ color: '#b71c1c', padding: 2 }}>
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--theme-bg-sidebar, #f5f5f5)', fontWeight: 700 }}>
                      <td>Total {cat}</td>
                      <td></td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {qf(visible.reduce((s, p) => s + num(p.suggested_qty), 0))}
                      </td>
                      {catSlots.length > 0 ? (
                        catSlots.map(s => (
                          <td key={s.id} style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                            {qf(visible.reduce((sum, p) => sum + num(slotQty[`${p.product_key}__${s.slot_number}`]), 0))}
                          </td>
                        ))
                      ) : (
                        <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                          {qf(visible.reduce((s, p) => s + num(slotQty[`${p.product_key}__total`]), 0))}
                        </td>
                      )}
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--theme-accent)' }}>
                        {qf(visible.reduce((s, p) => s + num(slotQty[`${p.product_key}__total`]), 0))}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              )}
            </div>
          );
        })
      )}

      {showAddProduct && (
        <FicheAddProductModal
          products={allProducts}
          categories={[...new Set(allProducts.map(p => p.category).filter(Boolean))] as string[]}
          onClose={() => setShowAddProduct(false)}
          onSave={handleAddProduct}
        />
      )}
    </div>
  );
}

/**
 * Ajout d'un produit a la fiche du jour : produit existant du catalogue
 * (autocompletion), ou creation d'un nouveau produit (ajoute au catalogue).
 */
function FicheAddProductModal({ products, categories, onClose, onSave }: {
  products: SuggestProduct[];
  categories: string[];
  onClose: () => void;
  onSave: (f: { name: string; qty: number; category?: string; price?: number }) => void;
}) {
  const [f, setF] = useState({ name: '', qty: '', category: '', price: '' });
  const [catFilter, setCatFilter] = useState('');

  // Categories issues des produits (inclut « Non classé » si besoin).
  const cats = useMemo(
    () => [...new Set(products.map(p => p.category || 'Non classé'))].sort((a, b) => a.localeCompare(b, 'fr')),
    [products],
  );

  const inCategory = useMemo(
    () => catFilter ? products.filter(p => (p.category || 'Non classé') === catFilter) : products,
    [products, catFilter],
  );

  const q = f.name.trim().toLowerCase();
  const matches = q ? inCategory.filter(p => p.product_name.toLowerCase().includes(q)) : inCategory;
  const known = inCategory.find(p => p.product_name.trim().toLowerCase() === q);
  const isNew = q !== '' && !products.some(p => p.product_name.trim().toLowerCase() === q);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 460, borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', background: '#f9fafb', fontWeight: 600 }}>
          Ajouter un produit à la fiche
        </div>
        <form onSubmit={e => {
          e.preventDefault();
          const qty = parseFloat(f.qty.replace(',', '.'));
          if (!f.name.trim() || !(qty > 0)) return;
          onSave({
            name: f.name, qty,
            category: f.category.trim() || (catFilter !== 'Non classé' ? catFilter : '') || undefined,
            price: parseFloat(f.price) || undefined,
          });
        }} style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 12, background: '#fff' }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Catégorie</label>
            <select className="input" value={catFilter}
              onChange={e => { setCatFilter(e.target.value); setF(prev => ({ ...prev, name: '' })); }}>
              <option value="">Toutes les catégories ({products.length})</option>
              {cats.map(c => (
                <option key={c} value={c}>
                  {c} ({products.filter(p => (p.category || 'Non classé') === c).length})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Produit *</label>
            <input className="input" autoFocus required value={f.name}
              placeholder="Tape pour chercher…"
              onChange={e => setF({ ...f, name: e.target.value })} />
            {/* Resultats de recherche cliquables (limites a 8) */}
            {q !== '' && !known && matches.length > 0 && (
              <div style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 4, marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
                {matches.slice(0, 8).map(p => (
                  <button key={p.product_key} type="button"
                    onClick={() => setF(prev => ({ ...prev, name: p.product_name }))}
                    style={{
                      display: 'flex', justifyContent: 'space-between', width: '100%',
                      padding: '6px 10px', border: 'none', background: 'transparent',
                      textAlign: 'left', cursor: 'pointer', fontSize: '0.8125rem',
                      borderBottom: '1px solid var(--theme-bg-separator)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--theme-bg-sidebar, #f5f5f5)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span style={{ fontWeight: 500 }}>{p.product_name}</span>
                    <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>{p.category || 'Non classé'}</span>
                  </button>
                ))}
                {matches.length > 8 && (
                  <div style={{ padding: '4px 10px', fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>
                    … {matches.length - 8} autre{matches.length - 8 > 1 ? 's' : ''} — affine la recherche
                  </div>
                )}
              </div>
            )}
            {known && (
              <div style={{ fontSize: '0.6875rem', color: '#0e7c3a', marginTop: 3 }}>
                <Check size={11} style={{ display: 'inline', verticalAlign: -1 }} /> Produit du catalogue — {known.category || 'Non classé'}
              </div>
            )}
            {isNew && matches.length === 0 && (
              <div style={{ fontSize: '0.6875rem', color: '#b26a00', marginTop: 3 }}>
                Nouveau produit : il sera ajouté au catalogue.
              </div>
            )}
          </div>
          {isNew && matches.length === 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Catégorie du produit</label>
                <input className="input" value={f.category || (catFilter !== 'Non classé' ? catFilter : '')} list="fiche-add-categories"
                  onChange={e => setF({ ...f, category: e.target.value })} />
                <datalist id="fiche-add-categories">
                  {categories.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Prix unitaire (DH)</label>
                <input type="number" step="0.01" min="0" className="input" value={f.price}
                  onChange={e => setF({ ...f, price: e.target.value })} />
              </div>
            </div>
          )}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Quantité *</label>
            <input type="text" inputMode="decimal" required className="input" value={f.qty}
              placeholder="0"
              onChange={e => setF({ ...f, qty: e.target.value })} />
            <div style={{ fontSize: '0.625rem', color: 'var(--theme-text-muted)', marginTop: 3 }}>
              Répartie automatiquement sur les créneaux de la catégorie.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 6, borderTop: '1px solid var(--theme-bg-separator)' }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" className="odoo-btn-primary">Ajouter</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ════════════════════════ ONGLET JOURNÉE ════════════════════════

type EditField = 'approQty' | 'recuQty' | 'venduQty' | 'invenduQty' | 'unitPrice';

/**
 * Cellule numerique editable. Composant defini au niveau module (et non dans
 * DayView) : sinon React recree son type a chaque rendu et remonte l'input,
 * ce qui fait perdre le focus a chaque frappe.
 */
function NumCell({ value, locked, onDraft, onCommit }: {
  value: string; locked: boolean;
  onDraft: (v: string) => void; onCommit: (raw: string) => void;
}) {
  return (
    <input
      type="text" inputMode="decimal" disabled={locked}
      value={value}
      onChange={e => onDraft(e.target.value)}
      onBlur={e => onCommit(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{
        width: 74, textAlign: 'right', padding: '3px 6px', fontFamily: 'ui-monospace, monospace',
        border: '1px solid var(--theme-bg-separator)', borderRadius: 3, background: locked ? '#f5f5f5' : '#fff',
      }}
    />
  );
}

function DayView() {
  const qc = useQueryClient();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  // Ouvre (ou recupere) la journee pour la date choisie — idempotent cote serveur.
  const { data: day, isLoading } = useQuery({
    queryKey: ['recon-day', date],
    queryFn: () => reconciliationApi.openDay(date),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['recon-day', date] });

  const updateLineMut = useMutation({
    mutationFn: ({ lineId, patch }: { lineId: string; patch: Record<string, number> }) =>
      reconciliationApi.updateLine(lineId, patch),
    onSuccess: invalidate,
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });
  const deleteLineMut = useMutation({
    mutationFn: (lineId: string) => reconciliationApi.deleteLine(lineId),
    onSuccess: invalidate,
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });
  const addLineMut = useMutation({
    mutationFn: (data: any) => reconciliationApi.upsertLine(day!.id, data),
    onSuccess: () => { invalidate(); setShowAdd(false); notify.success('Produit ajouté'); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });
  const importMut = useMutation({
    mutationFn: async (files: File[]) => {
      const parsed = await parseLoyverseFiles(files);
      const items = parsed.flatMap(p => p.items.map(i => ({
        sku: i.sku, productName: i.productName, category: i.category || undefined, quantity: i.quantity, unitPrice: i.unitPrice,
      })));
      if (items.length === 0) throw new Error('Aucune vente exploitable dans le fichier');
      return reconciliationApi.importSales(day!.id, items);
    },
    onSuccess: (r) => { invalidate(); notify.success(`Ventes importées : ${r.upserted} produit(s)`); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || e?.message || 'Erreur import'),
  });
  const bulkApproMut = useMutation({
    mutationFn: (rows: any[]) => reconciliationApi.bulkAppro(day!.id, rows),
    onSuccess: (r) => { invalidate(); setShowPaste(false); notify.success(`Appro importé : ${r.upserted} produit(s)`); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });
  const statusMut = useMutation({
    mutationFn: (v: { action: 'open' | 'closed'; force?: boolean }) =>
      v.action === 'closed' ? reconciliationApi.close(day!.id, v.force) : reconciliationApi.reopen(day!.id),
    onSuccess: invalidate,
    onError: (e: any) => {
      const err = e?.response?.data?.error;
      // Garde-fou : aucune vente importee -> on propose de forcer.
      if (err?.code === 'NO_SALES') {
        if (window.confirm(`${err.message}\n\nClôturer quand même ?`)) {
          statusMut.mutate({ action: 'closed', force: true });
        }
        return;
      }
      notify.error(err?.message || 'Erreur');
    },
  });

  const locked = day?.status === 'closed';
  const lines = day?.lines || [];

  // Regroupement par categorie : le serveur trie deja par categorie puis nom,
  // on decoupe donc la liste en sections consecutives.
  const groupedLines = useMemo(() => {
    const groups: { cat: string; items: ReconLine[] }[] = [];
    for (const l of lines) {
      const cat = l.category || 'Aucune catégorie';
      const last = groups[groups.length - 1];
      if (last && last.cat === cat) last.items.push(l);
      else groups.push({ cat, items: [l] });
    }
    return groups;
  }, [lines]);

  const totals = useMemo(() => {
    return lines.reduce((a, l) => {
      const price = num(l.unit_price);
      a.appro += num(l.appro_qty); a.recu += num(l.recu_qty); a.vendu += num(l.vendu_qty); a.invendu += num(l.invendu_qty);
      a.ecartQty += num(l.ecart_qty); a.ecartVal += num(l.ecart_value);
      a.approVal += num(l.appro_qty) * price; a.recuVal += num(l.recu_qty) * price;
      a.venduVal += num(l.vendu_qty) * price; a.invenduVal += num(l.invendu_qty) * price;
      return a;
    }, { appro: 0, recu: 0, vendu: 0, invendu: 0, ecartQty: 0, ecartVal: 0, approVal: 0, recuVal: 0, venduVal: 0, invenduVal: 0 });
  }, [lines]);

  const commit = (l: ReconLine, field: EditField, raw: string) => {
    const parsed = parseFloat(raw.replace(',', '.'));
    const value = Number.isFinite(parsed) ? parsed : 0;
    setEdits(s => { const c = { ...s }; if (c[l.id]) delete c[l.id][field]; return c; });
    updateLineMut.mutate({ lineId: l.id, patch: { [field]: value } });
  };

  const numCell = (l: ReconLine, field: EditField, serverField: keyof ReconLine) => (
    <NumCell
      value={edits[l.id]?.[field] ?? String(l[serverField] ?? '')}
      locked={locked}
      onDraft={v => setEdits(s => ({ ...s, [l.id]: { ...s[l.id], [field]: v } }))}
      onCommit={raw => { if (edits[l.id]?.[field] !== undefined) commit(l, field, raw); }}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Bandeau explicatif */}
      <div className="odoo-alert" style={{ fontSize: '0.75rem', display: 'flex', gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Écart = Vendu + Invendu − Reçu.</strong> Négatif = manque à expliquer (perte / vol / erreur),
          positif = surplus. Si le reçu n'est pas saisi, l'appro sert de base de calcul.
          Ordre conseillé : saisir l'appro → confirmer le <strong>reçu</strong> → <strong>importer Loyverse</strong> → saisir l'invendu compté.
          Module isolé et temporaire — aucune donnée n'est écrite dans le système de production.
        </div>
      </div>

      {/* Barre d'action */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={e => { setDate(e.target.value); setEdits({}); }}
          className="odoo-input" style={{ width: 160 }} />
        {day && (
          <span className={`odoo-tag ${locked ? 'odoo-tag-red' : 'odoo-tag-green'}`}>
            {locked ? 'Clôturée' : 'Ouverte'}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) importMut.mutate(Array.from(e.target.files)); e.target.value = ''; }} />
        <button className="odoo-btn-secondary" disabled={!day || locked || importMut.isPending}
          onClick={() => fileRef.current?.click()}>
          {importMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Importer Loyverse
        </button>
        <button className="odoo-btn-secondary" disabled={!day || locked} onClick={() => setShowPaste(true)}>
          <ClipboardPaste size={14} /> Coller l'appro
        </button>
        <button className="odoo-btn-secondary" disabled={!day || locked} onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Produit
        </button>
        {day && (locked
          ? <button className="odoo-btn-secondary" onClick={() => statusMut.mutate({ action: 'open' })}><Unlock size={14} /> Rouvrir</button>
          : <button className="odoo-btn-secondary" onClick={() => statusMut.mutate({ action: 'closed' })}><Lock size={14} /> Clôturer</button>
        )}
      </div>

      {/* Grille */}
      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /> Chargement…
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th style={{ textAlign: 'right' }}>Appro</th>
                <th style={{ textAlign: 'right' }}>Reçu</th>
                <th style={{ textAlign: 'right' }}>Vendu</th>
                <th style={{ textAlign: 'right' }}>Invendu</th>
                <th style={{ textAlign: 'right' }}>Prix (DH)</th>
                <th style={{ textAlign: 'right' }}>Écart (u)</th>
                <th style={{ textAlign: 'right' }}>Écart (DH)</th>
                <th style={{ width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
                  Aucune ligne. Ajoute un produit ou importe le CSV Loyverse du jour.
                </td></tr>
              ) : groupedLines.map(({ cat, items }) => {
                const isCollapsed = collapsed.has(cat);
                return (
                <Fragment key={cat}>
                  <tr
                    onClick={() => setCollapsed(prev => {
                      const next = new Set(prev);
                      if (next.has(cat)) next.delete(cat); else next.add(cat);
                      return next;
                    })}
                    style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <td colSpan={7} style={{
                      background: 'var(--theme-bg-sidebar, #f5f5f5)', fontWeight: 700,
                      color: 'var(--theme-accent)', fontSize: '0.75rem',
                      textTransform: 'uppercase', letterSpacing: 0.5,
                    }}>
                      {isCollapsed ? '▸' : '▾'} {cat} ({items.length})
                    </td>
                    <td colSpan={2} style={{
                      background: 'var(--theme-bg-sidebar, #f5f5f5)', fontWeight: 700,
                      textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem',
                      color: ecartColor(items.reduce((s, l) => s + num(l.ecart_value), 0)),
                    }}>
                      {nf(items.reduce((s, l) => s + num(l.ecart_value), 0))} DH
                    </td>
                  </tr>
                  {!isCollapsed && items.map(l => {
                const eQty = num(l.ecart_qty), eVal = num(l.ecart_value);
                return (
                  <tr key={l.id}>
                    <td>
                      <span style={{ fontWeight: 500 }}>{l.product_name}</span>
                      {l.source_vendu === 'loyverse_import' && (
                        <span className="odoo-tag odoo-tag-blue" style={{ marginLeft: 6 }}>Loyverse</span>
                      )}
                      {l.sku && <div style={{ fontSize: '0.625rem', color: 'var(--theme-text-muted)', fontFamily: 'monospace' }}>{l.sku}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{numCell(l, 'approQty', 'appro_qty')}</td>
                    <td style={{ textAlign: 'right' }}>
                      {numCell(l, 'recuQty', 'recu_qty')}
                      {num(l.recu_qty) > 0 && num(l.recu_qty) !== num(l.appro_qty) && (
                        <div style={{ fontSize: '0.5625rem', color: '#b26a00', fontWeight: 600 }}>≠ appro</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{numCell(l, 'venduQty', 'vendu_qty')}</td>
                    <td style={{ textAlign: 'right' }}>{numCell(l, 'invenduQty', 'invendu_qty')}</td>
                    <td style={{ textAlign: 'right' }}>{numCell(l, 'unitPrice', 'unit_price')}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: ecartColor(eQty) }}>
                      {eQty > 0 ? '+' : ''}{qf(eQty)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: ecartColor(eVal) }}>
                      {eVal > 0 ? '+' : ''}{nf(eVal)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {!locked && (
                        <button onClick={() => deleteLineMut.mutate(l.id)} title="Supprimer la ligne"
                          style={{ color: '#b71c1c', padding: 2 }}><Trash2 size={13} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
                </Fragment>
                );
              })}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--theme-bg-separator)' }}>
                  <td>Total ({lines.length})</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{qf(totals.appro)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: totals.recu !== totals.appro && totals.recu > 0 ? '#b26a00' : undefined }}>{qf(totals.recu)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{qf(totals.vendu)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{qf(totals.invendu)}</td>
                  <td></td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: ecartColor(totals.ecartQty) }}>{qf(totals.ecartQty)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: ecartColor(totals.ecartVal) }}>{nf(totals.ecartVal)} DH</td>
                  <td></td>
                </tr>
                <tr style={{ fontWeight: 600, color: 'var(--theme-text-muted)', background: 'var(--theme-bg-sidebar, #f5f5f5)' }}>
                  <td>Montants (DH)</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{nf(totals.approVal)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{nf(totals.recuVal)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{nf(totals.venduVal)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{nf(totals.invenduVal)}</td>
                  <td></td>
                  <td></td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: ecartColor(totals.ecartVal) }}>{nf(totals.ecartVal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {showAdd && day && (
        <AddLineModal
          onClose={() => setShowAdd(false)}
          isLoading={addLineMut.isPending}
          onSave={(data) => addLineMut.mutate(data)}
        />
      )}

      {showPaste && day && (
        <PasteApproModal
          onClose={() => setShowPaste(false)}
          isLoading={bulkApproMut.isPending}
          onSave={(rows) => bulkApproMut.mutate(rows)}
        />
      )}
    </div>
  );
}

/**
 * Collage de l'appro depuis Excel. Une ligne par produit, colonnes separees
 * par TABULATION (copier-coller Excel) dans l'ordre :
 *   Nom  [TAB]  Quantité  [TAB]  Prix(opt)  [TAB]  SKU(opt)  [TAB]  Catégorie(opt)
 * Les lignes d'en-tete (quantite non numerique) sont ignorees.
 */
function parseAppro(text: string) {
  return text.split('\n').map(raw => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) return null;
    const c = line.split('\t');
    const name = (c[0] || '').trim();
    const qty = parseFloat((c[1] || '').trim().replace(',', '.'));
    if (!name || !Number.isFinite(qty)) return null;   // saute en-tete / ligne vide
    const price = parseFloat((c[2] || '').trim().replace(',', '.'));
    return {
      productName: name,
      approQty: qty,
      unitPrice: Number.isFinite(price) ? price : undefined,
      sku: (c[3] || '').trim() || undefined,
      category: (c[4] || '').trim() || undefined,
    };
  }).filter(Boolean) as { productName: string; approQty: number; unitPrice?: number; sku?: string; category?: string }[];
}

function PasteApproModal({ onClose, onSave, isLoading }: {
  onClose: () => void; onSave: (rows: any[]) => void; isLoading: boolean;
}) {
  const [text, setText] = useState('');
  const rows = useMemo(() => parseAppro(text), [text]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 560, borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', background: '#f9fafb', fontWeight: 600 }}>
          Coller l'approvisionnement depuis Excel
        </div>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10, background: '#fff' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
            Une ligne par produit — colonnes Excel dans l'ordre :{' '}
            <strong>Nom · Quantité · Prix(opt) · SKU(opt) · Catégorie(opt)</strong>. Le vendu et l'invendu déjà saisis
            sont préservés.
          </div>
          <textarea
            value={text} onChange={e => setText(e.target.value)} rows={9} autoFocus
            placeholder={'Tarte citron\t20\t12\tTARTE-CITRON\tPâtisserie\nPain complet\t35\t3.5'}
            className="input" style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}
          />
          <div style={{ fontSize: '0.8125rem', color: rows.length ? '#0e7c3a' : 'var(--theme-text-muted)' }}>
            {rows.length} ligne{rows.length > 1 ? 's' : ''} détectée{rows.length > 1 ? 's' : ''}.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 6, borderTop: '1px solid var(--theme-bg-separator)' }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="button" disabled={isLoading || rows.length === 0} onClick={() => onSave(rows)} className="odoo-btn-primary">
              {isLoading ? 'Import…' : `Importer ${rows.length || ''}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddLineModal({ onClose, onSave, isLoading }: {
  onClose: () => void; onSave: (d: any) => void; isLoading: boolean;
}) {
  const [f, setF] = useState({ productName: '', sku: '', category: '', approQty: '', unitPrice: '' });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 440, borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', background: '#f9fafb', fontWeight: 600 }}>
          Ajouter un produit
        </div>
        <form onSubmit={e => {
          e.preventDefault();
          if (!f.productName.trim()) return;
          onSave({
            productName: f.productName.trim(), sku: f.sku.trim() || undefined, category: f.category.trim() || undefined,
            approQty: parseFloat(f.approQty) || 0, unitPrice: parseFloat(f.unitPrice) || 0,
          });
        }} style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 12, background: '#fff' }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Produit *</label>
            <input className="input" autoFocus value={f.productName} onChange={e => setF({ ...f, productName: e.target.value })} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>SKU</label>
              <input className="input" value={f.sku} onChange={e => setF({ ...f, sku: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Catégorie</label>
              <input className="input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Approvisionné</label>
              <input type="number" step="0.001" className="input" value={f.approQty} onChange={e => setF({ ...f, approQty: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Prix unitaire (DH)</label>
              <input type="number" step="0.01" className="input" value={f.unitPrice} onChange={e => setF({ ...f, unitPrice: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 6, borderTop: '1px solid var(--theme-bg-separator)' }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" disabled={isLoading} className="odoo-btn-primary">{isLoading ? 'Enregistrement…' : 'Ajouter'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ════════════════════════ PARAMÈTRES CRÉNEAUX ══════════════════
function SlotsSettingsView() {
  const qc = useQueryClient();
  const { data: slots = [], isLoading } = useQuery({
    queryKey: ['recon-slots'],
    queryFn: () => reconciliationApi.listSlots(),
  });

  const [editing, setEditing] = useState<Partial<SupplySlot> | null>(null);

  const saveMut = useMutation({
    mutationFn: (data: any) => reconciliationApi.upsertSlot(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recon-slots'] }); setEditing(null); notify.success('Créneau enregistré'); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => reconciliationApi.deleteSlot(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recon-slots'] }); notify.success('Créneau supprimé'); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });

  const byCategory = useMemo(() => {
    const m: Record<string, SupplySlot[]> = {};
    for (const s of slots) (m[s.category] ??= []).push(s);
    return m;
  }, [slots]);

  const categories = useMemo(() => Object.keys(byCategory).sort(), [byCategory]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="odoo-alert" style={{ fontSize: '0.75rem', display: 'flex', gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Créneaux d'approvisionnement.</strong> Configurez les périodes de livraison par section.
          Le pourcentage indique la répartition par défaut des quantités suggérées (J-7).
          Les catégories doivent correspondre exactement aux catégories Loyverse (majuscules).
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="odoo-btn-primary" onClick={() => setEditing({ category: '', slot_number: 1, label: '', target_time: '', default_pct: 0, sort_order: 0 })}>
          <Plus size={14} /> Nouveau créneau
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /> Chargement…
        </div>
      ) : categories.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4 }}>
          Aucun créneau configuré. Exécutez la migration 233 pour charger les valeurs par défaut.
        </div>
      ) : (
        categories.map(cat => (
          <div key={cat}>
            <div style={{
              fontWeight: 700, padding: '6px 10px',
              background: 'var(--theme-bg-sidebar, #f5f5f5)',
              color: 'var(--theme-accent)', fontSize: '0.8125rem',
              textTransform: 'uppercase', letterSpacing: 0.5,
              borderRadius: '4px 4px 0 0', border: '1px solid var(--theme-bg-separator)',
            }}>
              {cat} ({byCategory[cat].length} créneau{byCategory[cat].length > 1 ? 'x' : ''})
            </div>
            <table className="odoo-table" style={{ borderTop: 'none' }}>
              <thead>
                <tr>
                  <th style={{ width: 50 }}>N°</th>
                  <th>Libellé</th>
                  <th style={{ width: 90 }}>Heure</th>
                  <th style={{ width: 70, textAlign: 'right' }}>%</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {byCategory[cat].map(s => (
                  <tr key={s.id}>
                    <td style={{ textAlign: 'center', fontFamily: 'ui-monospace, monospace' }}>{s.slot_number}</td>
                    <td style={{ fontWeight: 500 }}>
                      <Clock size={12} style={{ marginRight: 4, verticalAlign: -1, color: 'var(--theme-text-muted)' }} />
                      {s.label}
                    </td>
                    <td style={{ fontFamily: 'ui-monospace, monospace' }}>{s.target_time?.slice(0, 5) || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{s.default_pct}%</td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="odoo-btn-secondary" style={{ padding: '2px 6px', marginRight: 4 }}
                        onClick={() => setEditing({ ...s })}>
                        Modifier
                      </button>
                      <button style={{ color: '#b71c1c', padding: 2 }}
                        onClick={() => { if (confirm(`Supprimer « ${s.label} » ?`)) deleteMut.mutate(s.id); }}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--theme-bg-sidebar, #f5f5f5)', fontWeight: 600 }}>
                  <td></td>
                  <td>Total</td>
                  <td></td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: byCategory[cat].reduce((s, x) => s + x.default_pct, 0) === 100 ? '#0e7c3a' : '#b71c1c' }}>
                    {byCategory[cat].reduce((s, x) => s + x.default_pct, 0)}%
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        ))
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 440, borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', background: '#f9fafb', fontWeight: 600 }}>
              {editing.id ? 'Modifier le créneau' : 'Nouveau créneau'}
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              saveMut.mutate({
                id: editing.id, category: editing.category, slotNumber: editing.slot_number,
                label: editing.label, targetTime: editing.target_time || null,
                defaultPct: editing.default_pct, sortOrder: editing.sort_order,
              });
            }} style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 12, background: '#fff' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Catégorie *</label>
                <input className="input" required value={editing.category || ''}
                  list="slot-categories"
                  onChange={e => setEditing(p => ({ ...p!, category: e.target.value }))} />
                <datalist id="slot-categories">
                  {categories.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Libellé *</label>
                  <input className="input" required value={editing.label || ''}
                    onChange={e => setEditing(p => ({ ...p!, label: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>N° créneau</label>
                  <input type="number" min="1" className="input" value={editing.slot_number || 1}
                    onChange={e => setEditing(p => ({ ...p!, slot_number: parseInt(e.target.value) || 1 }))} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Heure cible</label>
                  <input type="time" className="input" value={editing.target_time?.slice(0, 5) || ''}
                    onChange={e => setEditing(p => ({ ...p!, target_time: e.target.value || null }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>% par défaut</label>
                  <input type="number" min="0" max="100" className="input" value={editing.default_pct ?? 0}
                    onChange={e => setEditing(p => ({ ...p!, default_pct: parseInt(e.target.value) || 0 }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Ordre</label>
                  <input type="number" min="0" className="input" value={editing.sort_order ?? 0}
                    onChange={e => setEditing(p => ({ ...p!, sort_order: parseInt(e.target.value) || 0 }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 6, borderTop: '1px solid var(--theme-bg-separator)' }}>
                <button type="button" onClick={() => setEditing(null)} className="odoo-btn-secondary">Annuler</button>
                <button type="submit" disabled={saveMut.isPending} className="odoo-btn-primary">
                  {saveMut.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════ PARAMÈTRES TRADUCTIONS DARIJA ═════════════
/**
 * Edition des traductions darija. La base a priorite sur le dictionnaire
 * statique ; les produits du catalogue sans traduction remontent en tete.
 */
function DarijaSettingsView() {
  const qc = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: suggestData } = useQuery({
    queryKey: ['recon-suggest', today],
    queryFn: () => reconciliationApi.suggest(today),
  });
  const { data: darijaEntries = [], isLoading } = useQuery({
    queryKey: ['recon-darija'],
    queryFn: () => reconciliationApi.listDarija(),
  });

  const darijaOf = useMemo(() => makeDarijaLookup(darijaEntries), [darijaEntries]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [showTranslated, setShowTranslated] = useState(false);

  const saveMut = useMutation({
    mutationFn: ({ name, darija }: { name: string; darija: string }) =>
      reconciliationApi.upsertDarija(normalizeDarijaKey(name), darija),
    onSuccess: (_r, { name }) => {
      qc.invalidateQueries({ queryKey: ['recon-darija'] });
      setDrafts(d => { const c = { ...d }; delete c[normalizeDarijaKey(name)]; return c; });
      notify.success('Traduction enregistrée');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });

  // Catalogue deduplique par nom normalise.
  const products = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of suggestData?.products || []) {
      const k = normalizeDarijaKey(p.product_name);
      if (!seen.has(k)) seen.set(k, p.product_name);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [suggestData]);

  const missing = products.filter(n => !darijaOf(n));
  const translated = products.filter(n => !!darijaOf(n));
  const q = filter.trim().toLowerCase();
  const match = (n: string) => !q || n.toLowerCase().includes(q);

  const row = (name: string, isMissing: boolean) => {
    const key = normalizeDarijaKey(name);
    const current = drafts[key] ?? (isMissing ? '' : darijaOf(name));
    const dirty = drafts[key] !== undefined && drafts[key] !== (isMissing ? '' : darijaOf(name));
    return (
      <tr key={key}>
        <td style={{ fontWeight: 500 }}>{name}</td>
        <td>
          <input
            value={current} dir="rtl"
            onChange={e => setDrafts(d => ({ ...d, [key]: e.target.value }))}
            placeholder="الترجمة بالدارجة"
            style={{
              width: '100%', padding: '3px 8px', fontSize: '0.875rem', direction: 'rtl', textAlign: 'right',
              border: `1px solid ${isMissing && !current ? '#e0a000' : 'var(--theme-bg-separator)'}`, borderRadius: 3,
            }}
          />
        </td>
        <td style={{ textAlign: 'center' }}>
          <button className="odoo-btn-secondary" style={{ padding: '2px 8px' }}
            disabled={!dirty || saveMut.isPending}
            onClick={() => saveMut.mutate({ name, darija: drafts[key] ?? '' })}>
            <Check size={12} />
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="odoo-alert" style={{ fontSize: '0.75rem', display: 'flex', gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Traductions darija.</strong> Les produits sans traduction apparaissent en premier.
          Une traduction saisie ici a priorité sur le dictionnaire intégré et apparaît immédiatement
          sur les bons de transfert. Vider le champ et enregistrer supprime la traduction personnalisée.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="odoo-input" placeholder="Rechercher un produit…" value={filter}
          onChange={e => setFilter(e.target.value)} style={{ width: 240 }} />
        {missing.length > 0 && (
          <span className="odoo-tag odoo-tag-orange" style={{ fontSize: '0.6875rem' }}>
            {missing.length} sans traduction
          </span>
        )}
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showTranslated} onChange={e => setShowTranslated(e.target.checked)} />
          Afficher les produits déjà traduits ({translated.length})
        </label>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /> Chargement…
        </div>
      ) : missing.length === 0 && !showTranslated ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#0e7c3a', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4, fontSize: '0.8125rem' }}>
          <Check size={14} style={{ display: 'inline', verticalAlign: -2 }} /> Tous les produits du catalogue ont une traduction.
        </div>
      ) : (
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Produit</th>
              <th style={{ width: '40%', textAlign: 'right' }}>Darija</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {missing.filter(match).map(n => row(n, true))}
            {showTranslated && translated.filter(match).map(n => row(n, false))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ════════════════════════ ONGLET CATALOGUE ══════════════════════
/**
 * Gestion du catalogue produits (recon_products). Les imports Loyverse / appro
 * enregistrent automatiquement les nouveaux produits ; cet onglet permet de
 * corriger un nom, une categorie, un prix, ou de supprimer un produit obsolete.
 */
function CatalogView() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<(Partial<ReconProduct> & { darija?: string }) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['recon-products'],
    queryFn: () => reconciliationApi.listProducts(),
  });

  const { data: darijaEntries = [] } = useQuery({
    queryKey: ['recon-darija'],
    queryFn: () => reconciliationApi.listDarija(),
  });
  const darijaOf = useMemo(() => makeDarijaLookup(darijaEntries), [darijaEntries]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recon-products'] });
    qc.invalidateQueries({ queryKey: ['recon-suggest'] });
    qc.invalidateQueries({ queryKey: ['recon-darija'] });
  };

  const saveMut = useMutation({
    mutationFn: async (data: { id?: string; productName: string; sku?: string; category?: string; unitPrice?: number; darija?: string }) => {
      const prod = await reconciliationApi.upsertProduct(data);
      // La traduction n'est ecrite que si elle a change (evite les ecritures inutiles).
      if (data.darija !== undefined && data.darija !== darijaOf(data.productName)) {
        await reconciliationApi.upsertDarija(normalizeDarijaKey(data.productName), data.darija);
      }
      return prod;
    },
    onSuccess: () => { invalidate(); setEditing(null); notify.success('Produit enregistré'); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => reconciliationApi.deleteProduct(id),
    onSuccess: () => { invalidate(); notify.success('Produit supprimé'); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });

  const importMut = useMutation({
    mutationFn: async (files: File[]) => {
      const items = await parseLoyverseCatalogFiles(files);
      const rows = items.map(i => ({
        sku: i.sku || undefined, productName: i.productName,
        category: i.category || undefined, unitPrice: i.unitPrice || undefined,
      }));
      if (rows.length === 0) throw new Error('Aucun produit exploitable dans le fichier');
      return reconciliationApi.bulkProducts(rows);
    },
    onSuccess: (r) => { invalidate(); notify.success(`${r.upserted} produit(s) importés au catalogue`); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || e?.message || 'Erreur import'),
  });

  const categories = useMemo(
    () => [...new Set(products.map(p => p.category).filter(Boolean))].sort() as string[],
    [products],
  );

  const q = filter.trim().toLowerCase();
  const visible = products.filter(p =>
    !q || p.product_name.toLowerCase().includes(q)
    || (p.sku || '').toLowerCase().includes(q)
    || (p.category || '').toLowerCase().includes(q)
  );

  const grouped = useMemo(() => {
    const g: Record<string, ReconProduct[]> = {};
    for (const p of visible) (g[p.category || 'Non classé'] ??= []).push(p);
    return g;
  }, [visible]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="odoo-alert" style={{ fontSize: '0.75rem', display: 'flex', gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Catalogue produits.</strong> Source de la fiche de besoin. Les imports Loyverse
          enregistrent automatiquement les nouveaux produits ; un produit supprimé ici ne reviendra
          que s'il réapparaît dans un import.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="odoo-input" placeholder="Rechercher (nom, SKU, catégorie)…" value={filter}
          onChange={e => setFilter(e.target.value)} style={{ width: 260 }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
          {visible.length} / {products.length} produit{products.length > 1 ? 's' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) importMut.mutate(Array.from(e.target.files)); e.target.value = ''; }} />
        <button className="odoo-btn-secondary" disabled={importMut.isPending} onClick={() => fileRef.current?.click()}>
          {importMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Importer le catalogue
        </button>
        <button className="odoo-btn-primary" onClick={() => setEditing({})}>
          <Plus size={14} /> Nouveau produit
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /> Chargement…
        </div>
      ) : products.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4 }}>
          Catalogue vide. Importe un CSV Loyverse (Fiche de besoin ou Journée) ou ajoute un produit manuellement.
        </div>
      ) : (
        Object.entries(grouped).map(([cat, prods]) => (
          <div key={cat}>
            <div style={{
              fontWeight: 700, padding: '6px 10px',
              background: 'var(--theme-bg-sidebar, #f5f5f5)',
              color: 'var(--theme-accent)', fontSize: '0.8125rem',
              textTransform: 'uppercase', letterSpacing: 0.5,
              borderRadius: '4px 4px 0 0', border: '1px solid var(--theme-bg-separator)',
            }}>
              {cat} ({prods.length})
            </div>
            <table className="odoo-table" style={{ borderTop: 'none' }}>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th style={{ width: 120 }}>SKU</th>
                  <th style={{ width: 200, textAlign: 'right' }}>Darija</th>
                  <th style={{ width: 100, textAlign: 'right' }}>Prix (DH)</th>
                  <th style={{ width: 130 }}></th>
                </tr>
              </thead>
              <tbody>
                {prods.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.product_name}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{p.sku || '—'}</td>
                    <td style={{ direction: 'rtl', textAlign: 'right', color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
                      {darijaOf(p.product_name) || '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{nf(num(p.unit_price))}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="odoo-btn-secondary" style={{ padding: '2px 8px', marginRight: 4 }}
                        onClick={() => setEditing({ ...p, darija: darijaOf(p.product_name) })}>
                        Modifier
                      </button>
                      <button style={{ color: '#b71c1c', padding: 2 }} title="Supprimer du catalogue"
                        onClick={() => { if (confirm(`Supprimer « ${p.product_name} » du catalogue ?\n\nL'historique des journées passées est conservé.`)) deleteMut.mutate(p.id); }}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 440, borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', background: '#f9fafb', fontWeight: 600 }}>
              {editing.id ? 'Modifier le produit' : 'Nouveau produit'}
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              if (!editing.product_name?.trim()) return;
              saveMut.mutate({
                id: editing.id,
                productName: editing.product_name.trim(),
                sku: editing.sku?.trim() || undefined,
                category: editing.category?.trim() || undefined,
                unitPrice: num(editing.unit_price) || 0,
                darija: editing.darija?.trim() ?? '',
              });
            }} style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 12, background: '#fff' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Produit *</label>
                <input className="input" autoFocus required value={editing.product_name || ''}
                  onChange={e => setEditing(p => ({ ...p!, product_name: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>SKU</label>
                  <input className="input" value={editing.sku || ''}
                    onChange={e => setEditing(p => ({ ...p!, sku: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Prix unitaire (DH)</label>
                  <input type="number" step="0.01" min="0" className="input" value={editing.unit_price ?? ''}
                    onChange={e => setEditing(p => ({ ...p!, unit_price: e.target.value }))} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Catégorie</label>
                <input className="input" value={editing.category || ''} list="catalog-categories"
                  onChange={e => setEditing(p => ({ ...p!, category: e.target.value }))} />
                <datalist id="catalog-categories">
                  {categories.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Nom en darija</label>
                <input className="input" dir="rtl" value={editing.darija || ''}
                  placeholder="الترجمة بالدارجة"
                  style={{ direction: 'rtl', textAlign: 'right' }}
                  onChange={e => setEditing(p => ({ ...p!, darija: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 6, borderTop: '1px solid var(--theme-bg-separator)' }}>
                <button type="button" onClick={() => setEditing(null)} className="odoo-btn-secondary">Annuler</button>
                <button type="submit" disabled={saveMut.isPending} className="odoo-btn-primary">
                  {saveMut.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════ ONGLET RAPPORT ════════════════════════
function ReportView() {
  const now = new Date();
  const [from, setFrom] = useState(format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(now, 'yyyy-MM-dd'));

  const { data: rows = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['recon-report', from, to],
    queryFn: () => reconciliationApi.report({ from, to }),
    enabled: false,
  });

  const totals = useMemo(() => (rows as ReconReportRow[]).reduce((a, r) => {
    a.appro += num(r.appro_qty); a.vendu += num(r.vendu_qty); a.invendu += num(r.invendu_qty);
    a.ecartVal += num(r.ecart_value);
    return a;
  }, { appro: 0, vendu: 0, invendu: 0, ecartVal: 0 }), [rows]);

  const handleExport = () => {
    const headers = ['Produit', 'Categorie', 'Appro', 'Vendu', 'Invendu', 'Ecart (u)', 'Ecart (DH)', 'Jours'];
    const data = (rows as ReconReportRow[]).map(r => [
      r.product_name, r.category || '', qf(num(r.appro_qty)), qf(num(r.vendu_qty)),
      qf(num(r.invendu_qty)), qf(num(r.ecart_qty)), nf(num(r.ecart_value)), r.days_count,
    ]);
    exportCSV(`rapprochement-${from}_${to}.csv`, headers, data);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="odoo-input" style={{ width: 150 }} />
        <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
        <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="odoo-input" style={{ width: 150 }} />
        <button className="odoo-btn-primary" onClick={() => refetch()}>
          {isFetching ? <Loader2 size={14} className="animate-spin" /> : <ScrollText size={14} />} Générer
        </button>
        <div style={{ flex: 1 }} />
        <button className="odoo-btn-secondary" disabled={rows.length === 0} onClick={handleExport}>
          <Download size={13} /> Export CSV
        </button>
      </div>

      {rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {([
            ['Appro (u)', qf(totals.appro)], ['Vendu (u)', qf(totals.vendu)],
            ['Invendu (u)', qf(totals.invendu)], ['Écart total (DH)', nf(totals.ecartVal)],
          ] as [string, string][]).map(([lbl, val], i) => (
            <div key={lbl} style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-card)' }}>
              <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{lbl}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 4, color: i === 3 ? ecartColor(totals.ecartVal) : 'var(--theme-accent)' }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {isLoading || isFetching ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /> Calcul…
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4 }}>
          Choisis une période et clique « Générer ».
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th className="hidden md:table-cell">Catégorie</th>
                <th style={{ textAlign: 'right' }}>Appro</th>
                <th style={{ textAlign: 'right' }}>Vendu</th>
                <th style={{ textAlign: 'right' }}>Invendu</th>
                <th style={{ textAlign: 'right' }}>Écart (u)</th>
                <th style={{ textAlign: 'right' }}>Écart (DH)</th>
                <th style={{ textAlign: 'right' }}>Jours</th>
              </tr>
            </thead>
            <tbody>
              {(rows as ReconReportRow[]).map(r => {
                const eQty = num(r.ecart_qty), eVal = num(r.ecart_value);
                return (
                  <tr key={r.product_key}>
                    <td style={{ fontWeight: 500 }}>{r.product_name}</td>
                    <td className="hidden md:table-cell" style={{ color: 'var(--theme-text-muted)' }}>{r.category || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{qf(num(r.appro_qty))}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{qf(num(r.vendu_qty))}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{qf(num(r.invendu_qty))}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: ecartColor(eQty) }}>{eQty > 0 ? '+' : ''}{qf(eQty)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: ecartColor(eVal) }}>{eVal > 0 ? '+' : ''}{nf(eVal)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{r.days_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
