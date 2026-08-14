import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Upload, Plus, Trash2, Lock, Unlock, Download, Loader2, CalendarDays,
  ArrowLeftRight, ScrollText, Info, ClipboardPaste, ClipboardList, Printer, Check,
  Settings, Clock, Package, RotateCcw, Save, TrendingDown, TrendingUp, Minus, Copy,
} from 'lucide-react';
import { reconciliationApi, type ReconLine, type ReconShift, type ReconProduct, type ReconReportRow, type SuggestProduct, type SupplySlot, type ReconFicheLineInput } from '../../api/reconciliation.api';
import { parseLoyverseFiles, parseLoyverseCatalogFiles, parseLoyverseReceiptFiles, type ParsedReceiptItem } from './loyverseParser';
import { makeDarijaLookup, normalizeDarijaKey } from './darijaDictionary';
import { notify } from '../../components/ui/InlineNotification';
import { useAuth } from '../../context/AuthContext';

/** Rapprochement PAR SHIFT (ISOLE, TEMPORAIRE) : vendu + invendu - (recu + ouverture) = ecart (negatif = manque ; l'appro n'entre pas dans le calcul). */

/** Heure de passation Matin → Soir : les créneaux d'appro avant cette heure
 *  alimentent le shift Matin, les autres le Soir. Alignée sur la passation de
 *  caisse (~14h). Constante en dur : module jetable, comme OVEN_CAPACITY_PLAQUES. */
const SHIFT_SPLIT_TIME = '14:00';

// ─── Fuseau horaire du magasin (import des reçus) ─────────────────────────
// Les horodatages de l'export Loyverse sont dans le fuseau de l'ORDINATEUR qui
// télécharge (ex. Montréal), pas celui du magasin (Maroc). On convertit donc
// chaque heure de ticket depuis le fuseau du navigateur vers le fuseau du
// magasin avant de découper Matin/Soir : +5h l'été depuis Montréal, +6h l'hiver,
// +0h depuis le Maroc — géré automatiquement (changement d'heure compris).
const DEFAULT_STORE_TZ = 'Africa/Casablanca';
const LS_STORE_TZ = 'recon-store-tz';
const LS_PASSATION = 'recon-passation-time';

/** Fuseau détecté du navigateur (là où le fichier a été téléchargé). */
function browserTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; }
  catch { return 'local'; }
}

/**
 * Minute du jour (0-1439) d'un ticket EXPRIMÉE EN HEURE DU MAGASIN. L'heure du
 * fichier (date + hour + minute) est interprétée dans le fuseau du navigateur,
 * puis reprojetée dans `storeTz`. Repli sur l'heure brute si le fuseau est
 * invalide.
 */
function receiptStoreMinutes(date: string, hour: number, minute: number, storeTz: string): number {
  try {
    const [y, mo, d] = date.split('-').map(Number);
    const instant = new Date(y, (mo || 1) - 1, d || 1, hour, minute); // naïf = heure navigateur
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: storeTz, hour12: false, hour: '2-digit', minute: '2-digit',
    }).formatToParts(instant);
    const hh = Number(parts.find(p => p.type === 'hour')?.value) % 24;
    const mm = Number(parts.find(p => p.type === 'minute')?.value);
    if (Number.isFinite(hh) && Number.isFinite(mm)) return hh * 60 + mm;
  } catch { /* fuseau invalide → repli */ }
  return hour * 60 + minute;
}

function parseHHMM(s: string): number {
  const m = (s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 14 * 60;
  return (Number(m[1]) % 24) * 60 + Number(m[2]);
}

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

// Palette badge : tinte plus soutenue au-dela du seuil "gros ecart" (defaut 20 DH).
type EcartTone = 'ok' | 'neg' | 'pos';
function ecartTone(v: number): EcartTone {
  if (v < -0.5) return 'neg';
  if (v > 0.5) return 'pos';
  return 'ok';
}
function ecartTheme(v: number, strong = false) {
  const tone = ecartTone(v);
  if (tone === 'neg') return { fg: '#b71c1c', bg: strong ? '#fbd5d5' : '#fdecec', border: '#e53935' };
  if (tone === 'pos') return { fg: '#8a4b00', bg: strong ? '#ffddb0' : '#fff4e0', border: '#e69138' };
  return { fg: '#0e7c3a', bg: '#e9f7ef', border: '#66bb6a' };
}

/** Chip d'ecart : icone directionnelle + valeur signee, fond colore. */
function EcartBadge({ value, format, strong, minWidth = 62 }: { value: number; format: (n: number) => string; strong?: boolean; minWidth?: number }) {
  const tone = ecartTone(value);
  const t = ecartTheme(value, strong);
  const Icon = tone === 'neg' ? TrendingDown : tone === 'pos' ? TrendingUp : Minus;
  const sign = value > 0.0001 ? '+' : '';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999,
      background: t.bg, color: t.fg,
      fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: '0.75rem',
      minWidth, justifyContent: 'flex-end', lineHeight: 1.4,
    }}>
      <Icon size={12} strokeWidth={2.5} />
      {sign}{format(value)}
    </span>
  );
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
             <CarryOverSettingsView />
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
  'ENTREMETS': 'PÂTISSERIE',
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
  if (upper.includes('PÂTISS') || upper.includes('ENTREMET') || upper.includes('CAKE') || upper.includes('COOKIE') || upper.includes('MACARON') || upper.includes('MUFFIN') || upper.includes('ÉCLAIR') || upper.includes('FINANCIER') || upper.includes('BROWNI')) return 'PÂTISSERIE';
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
.copy-tag{text-align:center;margin:4px 0 7px}
.copy-tag span{display:inline-block;border:1.5px solid #000;padding:2px 14px;font-size:9.5pt;font-weight:700;letter-spacing:1px;text-transform:uppercase}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th,td{border:1px solid #444;padding:4px 7px;font-size:10.5pt;vertical-align:middle}
th{background:#e0e0e0;text-align:center;font-size:10pt;font-weight:700;text-transform:uppercase}
tbody tr:nth-child(even) td{background:#f7f7f7}
tbody tr.cat-row td{background:#d0d0d0;font-weight:700;font-size:10pt;text-transform:uppercase;letter-spacing:0.3px;padding:5px 7px;border-bottom:2px solid #888;text-align:center}
tbody tr.section-row td{background:#222;color:#fff;font-weight:700;font-size:11pt;text-transform:uppercase;letter-spacing:1px;padding:6px 7px;text-align:center}
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

// ─── Capacité chariot four (BOULANGERIE) ─────────────────────────
// 1 chariot = 18 plaques. Une plaque contient N pièces selon la catégorie
// (baguette: 10, pain rond: 20). Le total baguette+pain d'un même créneau
// (= une cuisson) ne doit pas dépasser 18 plaques. Constantes en dur : module
// jetable, à déplacer en ref_entries si le paramétrage devient utile.
const OVEN_CAPACITY_PLAQUES = 18;
const CATEGORY_PIECES_PAR_PLAQUE: Record<string, number> = {
  'BAGUETTE': 10,
  'BAGUETTE TRADITION': 10,
  'PAIN ROND': 20,
  'PAIN SANDWICH': 20,
};
function piecesParPlaque(category: string | null | undefined): number {
  if (!category) return 0;
  return CATEGORY_PIECES_PAR_PLAQUE[category.toUpperCase()] || 0;
}

/** Clé de regroupement horaire d'un créneau : les bons d'une même section se
 *  regroupent par heure réelle, pas par numéro de créneau — le n°1 peut être
 *  6h30 pour BAGUETTE mais 9h30 pour BAGUETTE TRADITION. */
function slotTimeKey(s: SupplySlot): string {
  return s.target_time ? s.target_time.slice(0, 5) : s.label.trim().toUpperCase();
}

type ChariotItem = { name: string; qty: number };
type Chariot = { plaques: number; items: ChariotItem[] };

/** Plan de cuisson d'un créneau : chariots de 18 plaques max. Les plaques se
 *  comptent PAR FAMILLE : les variétés d'une même catégorie partagent les
 *  plaques (ex. 4 variétés de tradition à 5 pièces = 2 plaques mélangées). */
function packSlotChariots(
  products: SuggestProduct[],
  slotQty: Record<string, string>,
  slotNumOf: (p: SuggestProduct) => number | undefined,
): Chariot[] {
  const byCat = new Map<string, { pcs: number; qty: number; items: ChariotItem[] }>();
  for (const p of products) {
    const pcs = piecesParPlaque(p.category);
    if (pcs === 0) continue;
    const sn = slotNumOf(p);
    if (sn === undefined) continue;
    const q = num(slotQty[`${p.product_key}__${sn}`]);
    if (q <= 0) continue;
    const cat = p.category || '';
    if (!byCat.has(cat)) byCat.set(cat, { pcs, qty: 0, items: [] });
    const e = byCat.get(cat)!;
    e.qty += q;
    e.items.push({ name: p.product_name, qty: q });
  }
  const groups = [...byCat.values()]
    .map(e => ({ ...e, plaques: Math.ceil(e.qty / e.pcs) }))
    .sort((a, b) => b.plaques - a.plaques);

  const chariots: Chariot[] = [];
  let cur: Chariot = { plaques: 0, items: [] };
  for (const g of groups) {
    let plaquesLeft = g.plaques;
    const queue = g.items.map(i => ({ ...i }));
    while (plaquesLeft > 0) {
      if (cur.plaques >= OVEN_CAPACITY_PLAQUES) {
        chariots.push(cur);
        cur = { plaques: 0, items: [] };
      }
      const take = Math.min(plaquesLeft, OVEN_CAPACITY_PLAQUES - cur.plaques);
      // Dernier lot de la famille : embarque tout le reliquat (plaque partielle).
      let qtyTake = take === plaquesLeft
        ? queue.reduce((t, i) => t + i.qty, 0)
        : take * g.pcs;
      while (qtyTake > 0 && queue.length > 0) {
        const it = queue[0];
        const t = Math.min(it.qty, qtyTake);
        cur.items.push({ name: it.name, qty: t });
        it.qty -= t;
        qtyTake -= t;
        if (it.qty <= 0) queue.shift();
      }
      cur.plaques += take;
      plaquesLeft -= take;
    }
  }
  if (cur.plaques > 0) chariots.push(cur);
  return chariots;
}

/** Optimisation des fournées : le four ne doit jamais tourner à moitié vide.
 *  1. Le total de chaque famille par cuisson est arrondi à la plaque entière
 *     (les variétés partagent les plaques).
 *  2. Fournées de la journée = ceil(total plaques / 18) ; chaque cuisson vise
 *     des chariots PLEINS (18 plaques) ; la cuisson la plus chargée absorbe
 *     l'unique fournée partielle.
 *  3. Les plaques sont déplacées entre cuissons (famille la plus chargée l'abord)
 *     pour atteindre ces cibles. Les produits « touched » (saisis à la main)
 *     comptent dans les charges mais ne sont jamais modifiés. */
function optimizeFournees(
  products: SuggestProduct[],
  slotQty: Record<string, string>,
  slotsByCategory: Record<string, SupplySlot[]>,
  touched?: Set<string>,
): Record<string, string> {
  const next = { ...slotQty };
  const bou = products.filter(p => piecesParPlaque(p.category) > 0);
  if (bou.length === 0) return next;
  const isMovable = (p: SuggestProduct) => !touched || !touched.has(p.product_key);
  const cats = [...new Set(bou.map(p => p.category || ''))]
    .filter(c => (slotsByCategory[c] || []).length > 0);
  // Cuissons = heures réelles : deux catégories peuvent partager la même heure.
  const timeInfo = new Map<string, string>();
  const snOf = new Map<string, number>(); // `${cat}|${timeKey}` → slot_number
  for (const cat of cats) {
    for (const s of slotsByCategory[cat] || []) {
      const tk = slotTimeKey(s);
      if (!timeInfo.has(tk)) timeInfo.set(tk, s.target_time || '99:99');
      snOf.set(`${cat}|${tk}`, s.slot_number);
    }
  }
  const timeKeys = [...timeInfo.keys()]
    .sort((a, b) => timeInfo.get(a)!.localeCompare(timeInfo.get(b)!));
  if (timeKeys.length === 0) return next;

  const prodsOf = (cat: string) => bou.filter(p => (p.category || '') === cat);
  const qtyAt = (p: SuggestProduct, sn: number) => num(next[`${p.product_key}__${sn}`]);
  const setQty = (p: SuggestProduct, sn: number, v: number) => { next[`${p.product_key}__${sn}`] = String(v); };
  const catTotal = (cat: string, tk: string) => {
    const sn = snOf.get(`${cat}|${tk}`);
    return sn === undefined ? 0 : prodsOf(cat).reduce((t, p) => t + qtyAt(p, sn), 0);
  };
  /** Écart entre la quantité d'une famille sur une cuisson et sa part théorique
   *  selon les % du paramétrage. Positif = la famille dépasse sa part (candidate
   *  au délestage), négatif = en dessous (candidate au remplissage). Préserve
   *  le profil horaire voulu : baguettes dominantes au petit-déjeuner, etc. */
  const devFromShare = (cat: string, tk: string) => {
    const catSlots = slotsByCategory[cat] || [];
    const s = catSlots.find(x => slotTimeKey(x) === tk);
    if (!s) return 0;
    const totPct = catSlots.reduce((t, x) => t + num(x.default_pct), 0) || 100;
    const dayTotal = timeKeys.reduce((t, k) => t + catTotal(cat, k), 0);
    return catTotal(cat, tk) - dayTotal * num(s.default_pct) / totPct;
  };

  // 1. Quantification PAR PRODUIT : chaque ligne de cuisson est un multiple de
  // plaque entière (10/20/30… baguettes, 20/40/60… pains) — jamais 97 ou 42 —
  // avec minimum une plaque par ligne. Le total du jour est converti en
  // plaques (arrondi, min 1) puis les plaques sont réparties sur les créneaux
  // selon leurs % (plus fort reste) ; une plaque unique va au créneau principal.
  for (const cat of cats) {
    const pcs = piecesParPlaque(cat);
    const catSlots = slotsByCategory[cat] || [];
    if (catSlots.length === 0) continue;
    const totalPct = catSlots.reduce((t, s) => t + num(s.default_pct), 0);
    const mainSlot = [...catSlots].sort((a, b) => num(b.default_pct) - num(a.default_pct))[0];
    for (const p of prodsOf(cat)) {
      if (!isMovable(p)) continue;
      const total = catSlots.reduce((t, s) => t + qtyAt(p, s.slot_number), 0);
      if (total <= 0) continue;
      const plaques = Math.max(1, Math.round(total / pcs));
      const alloc = new Map<number, number>();
      if (plaques === 1) {
        alloc.set(mainSlot.slot_number, 1);
      } else {
        const shares = catSlots.map(s =>
          plaques * (totalPct > 0 ? num(s.default_pct) / totalPct : 1 / catSlots.length));
        const baseAlloc = shares.map(x => Math.floor(x));
        let remP = plaques - baseAlloc.reduce((a, b) => a + b, 0);
        shares
          .map((x, i) => ({ i, frac: x - Math.floor(x) }))
          .sort((a, b) => b.frac - a.frac)
          .forEach(o => { if (remP > 0) { baseAlloc[o.i] += 1; remP -= 1; } });
        catSlots.forEach((s, i) => alloc.set(s.slot_number, baseAlloc[i]));
      }
      for (const s of catSlots) setQty(p, s.slot_number, (alloc.get(s.slot_number) || 0) * pcs);
    }
  }

  // 1bis. Plafond par famille : une famille ne dépasse jamais un chariot plein
  // par cuisson (18 plaques = 180 baguettes / 360 pains) — pas de baguettes
  // orphelines sur le chariot des pains. L'excédent part vers la cuisson de la
  // même famille ayant le plus de marge.
  for (const cat of cats) {
    const pcs = piecesParPlaque(cat);
    const catSlots = slotsByCategory[cat] || [];
    if (catSlots.length < 2) continue;
    const capQty = OVEN_CAPACITY_PLAQUES * pcs;
    for (const tk of timeKeys) {
      const sn = snOf.get(`${cat}|${tk}`);
      if (sn === undefined) continue;
      let capGuard = 60;
      while (catTotal(cat, tk) > capQty && capGuard-- > 0) {
        const others = catSlots
          .map(s => ({ s, tk2: slotTimeKey(s) }))
          .filter(o => o.tk2 !== tk && catTotal(cat, o.tk2) + pcs <= capQty)
          // La cuisson la plus en dessous de sa part % reçoit d'abord.
          .sort((a, b) => devFromShare(cat, a.tk2) - devFromShare(cat, b.tk2));
        const dest = others[0];
        if (!dest) break;
        // Une plaque ENTIÈRE d'un seul produit : les multiples restent intacts.
        const donor = prodsOf(cat)
          .filter(p => isMovable(p) && qtyAt(p, sn) >= pcs)
          .sort((a, b) => qtyAt(b, sn) - qtyAt(a, sn))[0];
        if (!donor) break;
        setQty(donor, sn, qtyAt(donor, sn) - pcs);
        setQty(donor, dest.s.slot_number, qtyAt(donor, dest.s.slot_number) + pcs);
      }
    }
  }

  // 2. Charges (plaques par famille, variétés mélangées) et cibles par cuisson.
  const loadOf = (tk: string) => cats.reduce((t, cat) => {
    const q = catTotal(cat, tk);
    return q > 0 ? t + Math.ceil(q / piecesParPlaque(cat)) : t;
  }, 0);
  const loads = timeKeys.map(loadOf);
  const totalPlaques = loads.reduce((a, b) => a + b, 0);
  if (totalPlaques === 0) return next;
  const fournees = Math.ceil(totalPlaques / OVEN_CAPACITY_PLAQUES);
  // Règle métier : les cuissons du petit-déjeuner (les 2 premières) font UNE
  // fournée maximum — le matin c'est la baguette fraîche, pas la production de
  // masse. Les fournées supplémentaires partent en réassort de mi-journée /
  // après-midi (cf. planification manuelle du chef : 11h30 à 2 chariots).
  const morningIdx = new Set<number>(
    timeKeys.length > 2 ? timeKeys.slice(0, 2).map((_, i) => i) : [],
  );
  const base = loads.map((l, i) => {
    const f = Math.floor(l / OVEN_CAPACITY_PLAQUES);
    return morningIdx.has(i) ? Math.min(1, f) : f;
  });
  let rem = fournees - base.reduce((a, b) => a + b, 0);
  loads
    .map((l, i) => ({ i, frac: l % OVEN_CAPACITY_PLAQUES }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(o => {
      if (rem > 0 && !(morningIdx.has(o.i) && base[o.i] >= 1)) { base[o.i] += 1; rem -= 1; }
    });
  // Reliquat (tout le monde plafonné) : sur les cuissons hors matin.
  while (rem > 0) {
    let idx = -1;
    for (let i = 0; i < timeKeys.length; i++) {
      if (morningIdx.has(i)) continue;
      if (idx === -1 || base[i] < base[idx]) idx = i;
    }
    if (idx === -1) break;
    base[idx] += 1;
    rem -= 1;
  }
  const targets = base.map(f => f * OVEN_CAPACITY_PLAQUES);
  const partial = targets.reduce((a, b) => a + b, 0) - totalPlaques;
  if (partial > 0) {
    // La fournée partielle va sur une cuisson hors matin (la plus chargée) ;
    // à défaut, n'importe laquelle.
    let idx = -1;
    for (let i = 0; i < timeKeys.length; i++) {
      if (morningIdx.has(i)) continue;
      if (targets[i] >= partial && (idx === -1 || loads[i] > loads[idx])) idx = i;
    }
    if (idx === -1) {
      for (let i = 0; i < timeKeys.length; i++) {
        if (targets[i] >= partial && (idx === -1 || loads[i] > loads[idx])) idx = i;
      }
    }
    if (idx >= 0) targets[idx] -= partial;
  }

  // 3. Rééquilibrage : déplace une plaque à la fois de la cuisson excédentaire
  // vers la déficitaire, via la famille la plus chargée couvrant les deux.
  let guard = 500;
  while (guard-- > 0) {
    const cur = timeKeys.map(loadOf);
    let from = -1, to = -1;
    for (let i = 0; i < timeKeys.length; i++) {
      if (from === -1 && cur[i] > targets[i]) from = i;
      if (to === -1 && cur[i] < targets[i]) to = i;
    }
    if (from === -1 || to === -1) break;
    const tkFrom = timeKeys[from], tkTo = timeKeys[to];
    const cands = cats
      .filter(cat => snOf.has(`${cat}|${tkFrom}`) && snOf.has(`${cat}|${tkTo}`)
        // Plafond famille à destination : jamais plus d'un chariot plein.
        && catTotal(cat, tkTo) + piecesParPlaque(cat) <= OVEN_CAPACITY_PLAQUES * piecesParPlaque(cat)
        // Donneur = une plaque ENTIÈRE d'un seul produit (multiples intacts).
        && prodsOf(cat).some(p => isMovable(p) && qtyAt(p, snOf.get(`${cat}|${tkFrom}`)!) >= piecesParPlaque(cat)))
      // Priorité à la famille qui dépasse le plus sa part % sur la cuisson
      // source ET qui est le plus en dessous sur la destination — le profil
      // horaire (baguettes au petit-déjeuner…) est préservé.
      .sort((a, b) =>
        (devFromShare(b, tkFrom) - devFromShare(b, tkTo)) / piecesParPlaque(b)
        - (devFromShare(a, tkFrom) - devFromShare(a, tkTo)) / piecesParPlaque(a));
    const cat = cands[0];
    if (!cat) break; // Rien de déplaçable entre ces cuissons : best effort.
    const pcs = piecesParPlaque(cat);
    const snFrom = snOf.get(`${cat}|${tkFrom}`)!;
    const snTo = snOf.get(`${cat}|${tkTo}`)!;
    const donor = prodsOf(cat)
      .filter(p => isMovable(p) && qtyAt(p, snFrom) >= pcs)
      .sort((a, b) => qtyAt(b, snFrom) - qtyAt(a, snFrom))[0];
    if (!donor) break;
    setQty(donor, snFrom, qtyAt(donor, snFrom) - pcs);
    setQty(donor, snTo, qtyAt(donor, snTo) + pcs);
  }

  // 4. Totaux par produit recalculés.
  for (const p of bou) {
    const sns = (slotsByCategory[p.category || ''] || []).map(s => s.slot_number);
    if (sns.length === 0) continue;
    next[`${p.product_key}__total`] = String(sns.reduce((t, sn) => t + qtyAt(p, sn), 0));
  }
  return next;
}

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
    withTransf: boolean,
  ): string {
    let rows = '';
    let hasAny = false;
    const colSpan = withTransf ? 5 : 4;
    for (const { cat, products } of groups) {
      const active = products.filter(p => num(slotQty[qtyKey(p)]) > 0);
      if (active.length === 0) continue;
      hasAny = true;
      rows += `<tr class="cat-row"><td colspan="${colSpan}">${esc(cat)}</td></tr>`;
      for (const p of active) {
        const dj = darijaOf(p.product_name);
        rows += `<tr><td>${esc(p.product_name)}</td><td class="qty">${esc(slotQty[qtyKey(p)] || '')}</td><td></td>${withTransf ? '<td></td>' : ''}<td class="darija">${esc(dj)}</td></tr>`;
      }
    }
    return hasAny ? rows : '';
  }

  function buildPage(section: string, slotLabel: string | null, jour: string, dateFmt: string, chef: string, rows: string, copie: string, withTransf: boolean): string {
    const title = slotLabel
      ? `${esc(section)} &mdash; ${esc(slotLabel)}`
      : esc(section);
    const transfCol = withTransf ? '<col style="width:68px">' : '';
    const transfTh = withTransf ? '<th>TRANSF.</th>' : '';
    const transfTd = withTransf ? '<td></td>' : '';
    // Copie Production (sans TRANSF.) : la colonne a remplir s'appelle APPRO ; copie Magasin : RECU.
    const col3Th = withTransf ? 'RE&Ccedil;U' : 'APPRO';
    return `<div class="section">
      <div class="header">${title}</div>
      <div class="sub-header">Commande Magasin &mdash; ${jour} ${dateFmt}</div>
      <div class="copy-tag"><span>${esc(copie)}</span></div>
      <table>
        <colgroup><col style="width:36%"><col style="width:90px"><col style="width:68px">${transfCol}<col style="width:auto"></colgroup>
        <thead><tr><th style="text-align:left">PRODUIT</th><th>COMMANDE</th><th>${col3Th}</th>${transfTh}<th style="text-align:right">بالدارجة</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td><strong>TOTAL</strong></td><td></td><td></td>${transfTd}<td></td></tr></tfoot>
      </table>
      <div class="signatures">
        <div class="sig-box"><strong>${chef} (Production)</strong><br>Nom :<br>Signature :</div>
        <div class="sig-box"><strong>Responsable Magasin</strong><br>Nom :<br>Signature :</div>
      </div>
    </div>`;
  }

  /** Fiche globale de fin de journee : tous les produits commandes de la journee
      (total tous creneaux), avec colonne vide RESTE a remplir par la vendeuse. */
  function buildRestePage(section: string, groups: { cat: string; products: SuggestProduct[] }[], jour: string, dateFmt: string): string {
    let rows = '';
    let hasAny = false;
    for (const { cat, products } of groups) {
      const active = products.filter(p => num(slotQty[`${p.product_key}__total`]) > 0);
      if (active.length === 0) continue;
      hasAny = true;
      rows += `<tr class="cat-row"><td colspan="3">${esc(cat)}</td></tr>`;
      for (const p of active) {
        const dj = darijaOf(p.product_name);
        rows += `<tr><td>${esc(p.product_name)}</td><td></td><td class="darija">${esc(dj)}</td></tr>`;
      }
    }
    if (!hasAny) return '';
    return `<div class="section">
      <div class="header">${esc(section)} &mdash; RESTE FIN DE JOURN&Eacute;E</div>
      <div class="sub-header">Produits command&eacute;s de la journ&eacute;e &mdash; ${jour} ${dateFmt} &mdash; noter le reste non vendu</div>
      <div class="copy-tag"><span>Copie Magasin</span></div>
      <table>
        <colgroup><col style="width:44%"><col style="width:110px"><col style="width:auto"></colgroup>
        <thead><tr><th style="text-align:left">PRODUIT</th><th>RESTE</th><th style="text-align:right">بالدارجة</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td><strong>TOTAL</strong></td><td></td><td></td></tr></tfoot>
      </table>
      <div class="signatures">
        <div class="sig-box"><strong>Vendeuse (Magasin)</strong><br>Nom :<br>Signature :</div>
        <div class="sig-box"><strong>Responsable Magasin</strong><br>Nom :<br>Signature :</div>
      </div>
    </div>`;
  }

  const pages: string[] = [];
  for (const section of orderedSections) {
    const groups = bySection[section];
    const allSlots = new Map<string, SupplySlot>();
    for (const { cat } of groups) {
      for (const s of (slotsByCategory[cat] || [])) {
        const k = slotTimeKey(s);
        if (!allSlots.has(k)) allSlots.set(k, s);
      }
    }
    const slotList = [...allSlots.values()].sort((a, b) =>
      (a.target_time || '99:99').localeCompare(b.target_time || '99:99') || a.sort_order - b.sort_order || a.slot_number - b.slot_number);
    const hasSlots = slotList.length > 0;
    const chef = SECTION_CHEF[section] || `Chef ${section}`;

    if (hasSlots) {
      // La fiche de passation s'intercale à la frontière des shifts : juste avant
      // le premier créneau ≥ SHIFT_SPLIT_TIME (14h), donc entre le 11h30 (Midi) et
      // le 15h30 (Après-midi). Comptage vierge du stock transféré entre équipes.
      let passationDone = false;
      for (const slot of slotList) {
        const k = slotTimeKey(slot);
        // Le numéro de créneau correspondant à cette heure varie par catégorie :
        // on résout la clé de quantité produit par produit.
        const slotNumByProduct = new Map<string, number>();
        const flatGroups: { cat: string; products: SuggestProduct[] }[] = [];
        for (const { cat, products } of groups) {
          const matchSlot = (slotsByCategory[cat] || []).find(s => slotTimeKey(s) === k);
          if (!matchSlot) continue;
          for (const p of products) slotNumByProduct.set(p.product_key, matchSlot.slot_number);
          flatGroups.push({ cat, products });
        }

        const slotKey = (p: SuggestProduct) => `${p.product_key}__${slotNumByProduct.get(p.product_key)}`;
        // Deux exemplaires par bon : production (sans colonne TRANSF.) et magasin.
        const rowsProd = buildTableRows(flatGroups, slotKey, false);
        if (!rowsProd) continue;
        const rowsMag = buildTableRows(flatGroups, slotKey, true);

        // Créneau d'après-midi (≥ 14h) : la passation vient juste avant.
        if (!passationDone && (slot.target_time || '99:99').slice(0, 5) >= SHIFT_SPLIT_TIME) {
          const passationPage = buildPassationPage([section], bySection, slotQty, darijaOf, jourSemaine, dateFormatted);
          if (passationPage) pages.push(passationPage);
          passationDone = true;
        }

        pages.push(buildPage(section, `${slot.label.toUpperCase()}`, jourSemaine, dateFormatted, chef, rowsProd, 'Copie Production', false));
        pages.push(buildPage(section, `${slot.label.toUpperCase()}`, jourSemaine, dateFormatted, chef, rowsMag, 'Copie Magasin', true));
      }
      // Catégories de la section sans créneau configuré (ex. ENTREMETS) : elles
      // n'ont qu'une quantité totale — bon unique sur la journée, sinon elles
      // n'apparaîtraient que sur la fiche Reste.
      const noSlotGroups = groups.filter(({ cat }) => (slotsByCategory[cat] || []).length === 0);
      const totalKey = (p: SuggestProduct) => `${p.product_key}__total`;
      const rowsProdTotal = buildTableRows(noSlotGroups, totalKey, false);
      if (rowsProdTotal) {
        pages.push(buildPage(section, 'JOURNÉE', jourSemaine, dateFormatted, chef, rowsProdTotal, 'Copie Production', false));
        pages.push(buildPage(section, 'JOURNÉE', jourSemaine, dateFormatted, chef, buildTableRows(noSlotGroups, totalKey, true), 'Copie Magasin', true));
      }
    } else {
      const totalKey = (p: SuggestProduct) => `${p.product_key}__total`;
      const rowsProd = buildTableRows(groups, totalKey, false);
      if (rowsProd) {
        pages.push(buildPage(section, null, jourSemaine, dateFormatted, chef, rowsProd, 'Copie Production', false));
        pages.push(buildPage(section, null, jourSemaine, dateFormatted, chef, buildTableRows(groups, totalKey, true), 'Copie Magasin', true));
      }
    }

    const restePage = buildRestePage(section, groups, jourSemaine, dateFormatted);
    if (restePage) pages.push(restePage);
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

/**
 * Dernière page des bons : fiche de transfert de passation MIDI → APRÈS-MIDI.
 * Comptage vierge listant les produits imprimés (total tous créneaux), groupés
 * par section puis famille — dans la même portée que les bons (section filtrée
 * ou toutes). L'équipe midi (sortante) compte le stock réellement passé,
 * l'équipe après-midi (entrante) vérifie et co-signe. Une seule colonne
 * (STOCK PASSATION), signée une fois. Renvoie '' si aucun produit > 0.
 */
function buildPassationPage(
  orderedSections: string[],
  bySection: Record<string, { cat: string; products: SuggestProduct[] }[]>,
  slotQty: Record<string, string>,
  darijaOf: (name: string) => string,
  jourSemaine: string,
  dateFormatted: string,
): string {
  let rows = '';
  let hasAny = false;
  for (const section of orderedSections) {
    let sectionRows = '';
    for (const { cat, products } of bySection[section]) {
      const active = products.filter(p => num(slotQty[`${p.product_key}__total`]) > 0);
      if (active.length === 0) continue;
      sectionRows += `<tr class="cat-row"><td colspan="3">${esc(cat)}</td></tr>`;
      for (const p of active) {
        const dj = darijaOf(p.product_name);
        sectionRows += `<tr><td>${esc(p.product_name)}</td><td></td><td class="darija">${esc(dj)}</td></tr>`;
      }
    }
    if (!sectionRows) continue;
    hasAny = true;
    rows += `<tr class="section-row"><td colspan="3">${esc(section)}</td></tr>${sectionRows}`;
  }

  if (!hasAny) return '';

  return `<div class="section">
    <div class="header">Passation Midi &rarr; Apr&egrave;s-midi</div>
    <div class="sub-header">Transfert de stock entre &eacute;quipes &mdash; ${jourSemaine} ${dateFormatted}</div>
    <div class="copy-tag"><span>Fiche de passation</span></div>
    <table>
      <colgroup><col style="width:44%"><col style="width:120px"><col style="width:auto"></colgroup>
      <thead><tr><th style="text-align:left">PRODUIT</th><th>STOCK PASSATION</th><th style="text-align:right">بالدارجة</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td><strong>TOTAL</strong></td><td></td><td></td></tr></tfoot>
    </table>
    <div class="signatures">
      <div class="sig-box"><strong>&Eacute;quipe Midi (sortante)</strong><br>Nom :<br>Signature :</div>
      <div class="sig-box"><strong>&Eacute;quipe Apr&egrave;s-midi (entrante)</strong><br>Nom :<br>Signature :</div>
    </div>
  </div>`;
}

function FicheBesoinsView({ onValidated }: { onValidated: () => void }) {
  const qc = useQueryClient();
  // La fiche de besoin prépare la production du LENDEMAIN : date par défaut J+1.
  const [date, setDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
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

  // Fiche enregistrée en base (partagée entre utilisateurs). Pas de refetch au
  // focus : une saisie en cours ne doit pas être écrasée en changeant de fenêtre.
  const { data: fiche } = useQuery({
    queryKey: ['recon-fiche', date],
    queryFn: () => reconciliationApi.getFiche(date),
    refetchOnWindowFocus: false,
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
      // Boulangerie : quantités arrondies à la plaque par famille et cuissons
      // à chariots pleins (18 plaques), une seule fournée partielle par jour.
      return optimizeFournees(data.products, init, slotsByCategory, touchedRef.current);
    });
  }, [data, slotsByCategory, riskPct, catRiskPct]);

  // Applique la fiche enregistrée par-dessus les suggestions : les lignes
  // sauvées sont marquées « touchées » pour que le recalcul (J-7, ajustement %)
  // ne les écrase pas. Tous les utilisateurs voient ainsi les mêmes chiffres.
  useEffect(() => {
    const lines = fiche?.lines;
    if (!lines || lines.length === 0) return;
    const saved: Record<string, string> = {};
    const rem = new Set<string>();
    for (const l of lines) {
      touchedRef.current.add(l.product_key);
      if (l.removed) rem.add(l.product_key);
      for (const [slot, v] of Object.entries(l.slot_qty || {})) {
        saved[`${l.product_key}__${slot}`] = String(v);
      }
      saved[`${l.product_key}__total`] = String(num(l.total_qty));
    }
    setRemoved(rem);
    setSlotQty(prev => ({ ...prev, ...saved }));
  }, [fiche]);

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

  // Copie J-1 : null = aucune copie en cours, ALL_CATS = copie globale,
  // sinon le nom de la categorie en cours de copie (bouton du bandeau).
  const ALL_CATS = ' all';
  const [copyingJ1, setCopyingJ1] = useState<string | null>(null);

  /**
   * Reprend les quantites de la fiche de la veille. Avec `category`, ne copie
   * que cette section : le chef peut refaire une seule famille (« la patisserie
   * classique comme hier ») sans ecraser le reste de la fiche du jour.
   * La categorie retenue est celle du catalogue actuel (celle affichee dans le
   * bandeau), pas celle figee dans la fiche J-1 : un produit reclasse depuis
   * suit sa nouvelle section.
   */
  const copyFromYesterday = async (category?: string) => {
    const yesterday = format(addDays(new Date(date + 'T00:00:00'), -1), 'yyyy-MM-dd');
    const veille = format(new Date(yesterday + 'T00:00:00'), 'd MMMM', { locale: fr });
    setCopyingJ1(category ?? ALL_CATS);
    try {
      const prev = await reconciliationApi.getFiche(yesterday);
      if (!prev?.lines || prev.lines.length === 0) {
        notify.error(`Aucune fiche enregistrée pour le ${format(new Date(yesterday + 'T00:00:00'), 'd MMMM yyyy', { locale: fr })}`);
        return;
      }
      const catOf = new Map(allProducts.map(p => [p.product_key, p.category || 'Non classé']));
      const copied: Record<string, string> = {};
      let count = 0;
      for (const l of prev.lines) {
        if (l.removed || num(l.total_qty) <= 0) continue;
        const cat = catOf.get(l.product_key);
        if (cat === undefined) continue;                 // absent du catalogue actuel
        if (category !== undefined && cat !== category) continue;
        touchedRef.current.add(l.product_key);
        for (const [slot, v] of Object.entries(l.slot_qty || {})) {
          copied[`${l.product_key}__${slot}`] = String(v);
        }
        copied[`${l.product_key}__total`] = String(num(l.total_qty));
        count++;
      }
      if (count === 0) {
        notify.error(category !== undefined
          ? `Aucun produit de « ${category} » dans la fiche du ${veille}`
          : 'Aucun produit commun entre la fiche J-1 et le catalogue actuel');
        return;
      }
      setRemoved(prev => {
        const next = new Set(prev);
        for (const l of prev) {
          if (copied[`${l}__total`]) next.delete(l);
        }
        return next;
      });
      setSlotQty(prev => ({ ...prev, ...copied }));
      notify.success(category !== undefined
        ? `${category} : ${count} produit(s) repris de la fiche du ${veille}`
        : `${count} produit(s) copiés depuis la fiche du ${veille}`);
    } catch (e: any) {
      notify.error(e?.response?.data?.error?.message || 'Erreur lors de la copie');
    } finally {
      setCopyingJ1(null);
    }
  };

  /** Plan de cuisson par créneau boulangerie : plaques totales + dispatching
   *  baguette/pain en chariots de 18 plaques. */
  const bouCuissons = useMemo(() => {
    // Regroupement par heure réelle (slotTimeKey), pas par numéro de créneau :
    // deux catégories peuvent avoir des horaires différents pour le même n°.
    const slotMap = new Map<string, { label: string; time: string | null }>();
    for (const [cat, catSlots] of Object.entries(slotsByCategory)) {
      if (piecesParPlaque(cat) === 0) continue;
      for (const s of catSlots) {
        const k = slotTimeKey(s);
        if (!slotMap.has(k)) slotMap.set(k, { label: s.label, time: s.target_time || null });
      }
    }
    if (slotMap.size === 0) return [];
    const bouProds = allProducts.filter(p => piecesParPlaque(p.category) > 0);
    return Array.from(slotMap.entries())
      .map(([k, info]) => {
        const slotNumOf = (p: SuggestProduct) =>
          (slotsByCategory[p.category || 'Non classé'] || []).find(s => slotTimeKey(s) === k)?.slot_number;
        const chariots = packSlotChariots(bouProds, slotQty, slotNumOf);
        const plaques = chariots.reduce((s, c) => s + c.plaques, 0);
        return { key: k, ...info, plaques, chariots };
      })
      .filter(c => c.plaques > 0)
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  }, [slotsByCategory, allProducts, slotQty]);

  const [showCuissonPlan, setShowCuissonPlan] = useState(false);

  /** Lignes de la fiche courante (quantités par créneau + produits retirés). */
  const buildFicheLines = (): ReconFicheLineInput[] =>
    allProducts
      .filter(p => removed.has(p.product_key) || slotQty[`${p.product_key}__total`] !== undefined)
      .map(p => {
        const cat = p.category || 'Non classé';
        const sq: Record<string, number> = {};
        for (const s of slotsByCategory[cat] || []) {
          sq[String(s.slot_number)] = num(slotQty[`${p.product_key}__${s.slot_number}`]);
        }
        return {
          productName: p.product_name,
          sku: p.sku || undefined,
          category: p.category || undefined,
          unitPrice: num(p.unit_price) || undefined,
          slotQty: sq,
          totalQty: num(slotQty[`${p.product_key}__total`]),
          removed: removed.has(p.product_key),
        };
      });

  const saveMut = useMutation({
    mutationFn: () => reconciliationApi.saveFiche(date, buildFicheLines()),
    onSuccess: (r) => {
      notify.success(`Fiche enregistrée (${r.saved} ligne(s)) — visible par tous les utilisateurs`);
      qc.invalidateQueries({ queryKey: ['recon-fiche', date] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || e?.message || 'Erreur'),
  });

  const validateMut = useMutation({
    mutationFn: async () => {
      // La validation enregistre aussi la fiche : l'état validé reste partagé.
      await reconciliationApi.saveFiche(date, buildFicheLines());
      const day = await reconciliationApi.openDay(date);
      const shifts = day.shifts || [];
      const matin = shifts.find(s => s.shift_number === 1) ?? shifts[0];
      const soir = shifts.find(s => s.shift_number === 2);
      if (!matin) throw new Error('Journée sans shift : rouvrir la journée');

      const row = (p: SuggestProduct, qty: number) => ({
        productName: p.product_name,
        sku: p.sku || undefined,
        category: p.category || undefined,
        approQty: qty,
        unitPrice: num(p.unit_price) || undefined,
      });

      // Ventilation de l'appro par shift : les créneaux avant l'heure de
      // passation vont au Matin, les autres au Soir. Sans créneaux (ou sur une
      // journée mono-shift, antérieure à la mig 262), tout part au 1er shift.
      const rowsMatin: ReturnType<typeof row>[] = [];
      const rowsSoir: ReturnType<typeof row>[] = [];
      for (const p of allProducts) {
        const total = num(slotQty[`${p.product_key}__total`]);
        if (total <= 0) continue;
        const catSlots = slotsByCategory[p.category || 'Non classé'] || [];
        if (!soir || catSlots.length === 0) {
          rowsMatin.push(row(p, total));
          continue;
        }
        let qMatin = 0, qSoir = 0;
        for (const s of catSlots) {
          const q = num(slotQty[`${p.product_key}__${s.slot_number}`]);
          if ((s.target_time || '00:00').slice(0, 5) < SHIFT_SPLIT_TIME) qMatin += q;
          else qSoir += q;
        }
        // Écart éventuel entre le total saisi et la somme des créneaux : au Matin.
        qMatin += total - (qMatin + qSoir);
        if (qMatin > 0) rowsMatin.push(row(p, qMatin));
        if (qSoir > 0) rowsSoir.push(row(p, qSoir));
      }
      if (rowsMatin.length + rowsSoir.length === 0) throw new Error('Aucun produit avec une quantité > 0');
      let upserted = 0;
      if (rowsMatin.length > 0) upserted += (await reconciliationApi.bulkAppro(matin.id, rowsMatin)).upserted;
      if (soir && rowsSoir.length > 0) upserted += (await reconciliationApi.bulkAppro(soir.id, rowsSoir)).upserted;
      return { upserted };
    },
    onSuccess: (r) => {
      notify.success(`Appro validé : ${r.upserted} produit(s)`);
      qc.invalidateQueries({ queryKey: ['recon-day', date] });
      qc.invalidateQueries({ queryKey: ['recon-suggest'] });
      qc.invalidateQueries({ queryKey: ['recon-fiche', date] });
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input type="date" value={date} onChange={e => { setDate(e.target.value); touchedRef.current.clear(); setRemoved(new Set()); }}
            className="odoo-input" style={{ width: 160 }} />
          {fiche?.savedAt && (
            <span className="odoo-tag odoo-tag-green" style={{ fontSize: '0.6875rem', alignSelf: 'flex-start' }}
              title={fiche.savedBy ? `Enregistrée par ${fiche.savedBy}` : undefined}>
              <Check size={11} /> Enregistrée{fiche.savedBy ? ` par ${fiche.savedBy}` : ''} le{' '}
              {format(new Date(fiche.savedAt), 'd MMM à HH:mm', { locale: fr })}
            </span>
          )}
        </div>
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
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'nowrap' }}>
        <button className="odoo-btn-secondary" onClick={() => setShowAddProduct(true)}>
          <Plus size={14} /> Produit
        </button>
        <button className="odoo-btn-secondary"
          disabled={copyingJ1 !== null}
          title="Copier toute la fiche de la veille (uniquement les produits du catalogue). Pour une seule famille, utilise le bouton J-1 du bandeau de catégorie."
          onClick={() => copyFromYesterday()}>
          {copyingJ1 === ALL_CATS
            ? <><Loader2 size={14} className="animate-spin" /> Copie…</>
            : <><Copy size={14} /> Copier J-1</>}
        </button>
        <button className="odoo-btn-secondary"
          disabled={!hasProducts || saveMut.isPending}
          title="Enregistre la fiche en base : les autres utilisateurs verront les mêmes quantités et produits"
          onClick={() => saveMut.mutate()}>
          {saveMut.isPending
            ? <><Loader2 size={14} className="animate-spin" /> Enregistrement…</>
            : <><Save size={14} /> Enregistrer</>}
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
      </div>

      {bouCuissons.length > 0 && (
        <div style={{
          border: '1px solid var(--theme-bg-separator)', borderRadius: 6,
          padding: '8px 12px', background: 'var(--theme-bg-sidebar, #f5f5f5)',
          fontSize: '0.75rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setShowCuissonPlan(v => !v)}
            title="Cliquez pour afficher le plan de cuisson détaillé (dispatching par chariot)">
            <strong style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Package size={13} /> {showCuissonPlan ? '▾' : '▸'} Cuissons boulangerie
            </strong>
            <span style={{ color: 'var(--theme-text-muted)' }}>
              1 chariot = {OVEN_CAPACITY_PLAQUES} plaques par cuisson · baguette 10/plaque · pain 20/plaque
            </span>
            <div style={{ flex: 1 }} />
            {bouCuissons.map(c => (
              <span key={c.key}
                title={`${c.plaques} plaques à cuire → ${c.chariots.length} fournée(s) de ${OVEN_CAPACITY_PLAQUES} plaques max — cliquez pour le détail`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '3px 8px', borderRadius: 4, fontWeight: 600,
                  fontFamily: 'ui-monospace, monospace',
                  background: 'var(--theme-bg-card, #fff)', color: 'var(--theme-text-primary)',
                  border: '1px solid var(--theme-bg-separator)',
                }}>
                <span style={{ opacity: 0.7 }}>{c.label}{c.time ? ` · ${c.time.slice(0, 5)}` : ''}</span>
                <span>{c.plaques} pl</span>
                <span style={{
                  padding: '0 6px', borderRadius: 3, fontWeight: 700,
                  background: c.chariots.length > 1 ? '#fff4e0' : '#e9f7ef',
                  color: c.chariots.length > 1 ? '#8a4b00' : '#0e7c3a',
                }}>
                  {c.chariots.length} chariot{c.chariots.length > 1 ? 's' : ''}
                </span>
              </span>
            ))}
          </div>
          {showCuissonPlan && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
              {bouCuissons.map(c => (
                <div key={c.key} style={{ flex: '1 1 260px', minWidth: 240 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    {c.label}{c.time ? ` · ${c.time.slice(0, 5)}` : ''} — {c.plaques} plaques
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {c.chariots.map((ch, i) => (
                      <div key={i} style={{
                        background: 'var(--theme-bg-card, #fff)',
                        border: '1px solid var(--theme-bg-separator)', borderRadius: 4,
                        padding: '5px 8px',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: 2 }}>
                          <span>Chariot {i + 1}</span>
                          <span style={{ fontFamily: 'ui-monospace, monospace',
                            color: ch.plaques === OVEN_CAPACITY_PLAQUES ? '#8a4b00' : '#0e7c3a' }}>
                            {ch.plaques}/{OVEN_CAPACITY_PLAQUES} pl
                          </span>
                        </div>
                        {ch.items.map((it, j) => (
                          <div key={j} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span>{it.name}</span>
                            <span style={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                              {it.qty} pcs
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
                  <button type="button"
                    disabled={copyingJ1 !== null}
                    title={`Reprendre les quantités de « ${cat} » sur la fiche de la veille, sans toucher aux autres catégories`}
                    onClick={() => copyFromYesterday(cat)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, textTransform: 'none',
                      fontSize: '0.6875rem', fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                      border: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-card, #fff)',
                      color: 'var(--theme-text-muted)',
                      cursor: copyingJ1 !== null ? 'default' : 'pointer',
                      opacity: copyingJ1 !== null && copyingJ1 !== cat ? 0.5 : 1,
                    }}>
                    {copyingJ1 === cat
                      ? <><Loader2 size={11} className="animate-spin" /> Copie…</>
                      : <><Copy size={11} /> J-1</>}
                  </button>
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
// Teintes par colonne pour distinguer visuellement Appro / Reçu / Vendu.
// « report » (reste de la veille) est volontairement hors palette — gris ardoise :
// c'est la seule colonne qui ne décrit pas la journée en cours, et la seule
// non saisissable.
const COL_TINTS = {
  report:  { bg: '#eceff1', input: '#f5f7f8', text: '#455a64', border: '#cfd8dc' },
  appro:   { bg: '#e8f1fb', input: '#f4f9ff', text: '#1565c0', border: '#bbdefb' },
  recu:    { bg: '#f3ebf9', input: '#faf5ff', text: '#6a1b9a', border: '#e1bee7' },
  vendu:   { bg: '#e6f4ea', input: '#f3fbf5', text: '#2e7d32', border: '#c8e6c9' },
  invendu: { bg: '#fdf0e2', input: '#fff8ef', text: '#e65100', border: '#ffe0b2' },
} as const;

type ColTint = { bg: string; input: string; text: string; border: string };

function NumCell({ value, locked, onDraft, onCommit, tint }: {
  value: string; locked: boolean;
  onDraft: (v: string) => void; onCommit: (raw: string) => void;
  tint?: ColTint;
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
        fontWeight: tint ? 600 : undefined,
        border: `1px solid ${tint?.border || 'var(--theme-bg-separator)'}`, borderRadius: 3,
        background: locked ? '#f5f5f5' : (tint?.input || '#fff'),
        color: tint?.text,
      }}
    />
  );
}

/**
 * Stock d'ouverture reporte de J-1. Volontairement rendu comme un texte et non
 * comme un champ : c'est une valeur calculee par le serveur, la caissiere ne
 * doit jamais avoir a la corriger ici (elle corrige le reste du soir de J-1).
 * Meme gabarit que NumCell pour que les colonnes restent alignees.
 */
function ReportVeilleCell({ qty, passation }: { qty: number; passation?: boolean }) {
  const t = COL_TINTS.report;
  return (
    <div
      title={qty > 0
        ? (passation
          ? `${qf(qty)} en vitrine à l'ouverture du shift (comptage de passation). Pour corriger, modifier le reste du shift précédent.`
          : `${qf(qty)} en vitrine à l'ouverture (reste du soir de la veille). Pour corriger, modifier le reste du soir de J-1.`)
        : (passation
          ? 'Aucun stock d\'ouverture : rien ne restait à la passation.'
          : 'Aucun report : catégorie sans report, ou rien ne restait la veille.')}
      style={{
        display: 'inline-block', width: 74, textAlign: 'right', padding: '3px 6px',
        fontFamily: 'ui-monospace, monospace', fontWeight: qty > 0 ? 600 : 400,
        border: '1px dashed', borderColor: qty > 0 ? t.border : 'transparent', borderRadius: 3,
        background: qty > 0 ? t.input : 'transparent',
        color: qty > 0 ? t.text : 'var(--theme-text-muted)',
      }}>
      {qty > 0 ? qf(qty) : '—'}
    </div>
  );
}

function DayView() {
  const qc = useQueryClient();
  const { user } = useAuth();
  // L'appro est la reference du rapprochement : seul l'admin peut la modifier.
  const canEditAppro = user?.role === 'admin';
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  // Onglet de shift : 'auto' = choisi selon l'heure (avant 14h → Matin),
  // 'total' = vue Journée agrégée (lecture seule), sinon id du shift.
  const [shiftSel, setShiftSel] = useState<string>('auto');
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

  const shifts = day?.shifts ?? [];
  // Journees anterieures a la mig 262 : shift unique « Journée », pas d'onglets.
  const multiShift = shifts.length > 1;
  const activeShift: ReconShift | null = (() => {
    if (shifts.length === 0) return null;
    if (shiftSel === 'total') return multiShift ? null : shifts[0];
    const found = shifts.find(s => s.id === shiftSel);
    if (found) return found;
    if (!multiShift) return shifts[0];
    // auto : Matin avant l'heure de passation, dernier shift ensuite
    return format(new Date(), 'HH:mm') < SHIFT_SPLIT_TIME ? shifts[0] : shifts[shifts.length - 1];
  })();
  // Vue Journée = agrégat serveur (ouverture du 1er shift, reste du dernier,
  // sommes ailleurs), toujours en lecture seule.
  const isTotalView = multiShift && shiftSel === 'total';
  const firstSn = shifts[0]?.shift_number;
  const lastSn = shifts[shifts.length - 1]?.shift_number;

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
    mutationFn: (data: any) => reconciliationApi.upsertLine(activeShift!.id, data),
    onSuccess: () => { invalidate(); setShowAdd(false); notify.success('Produit ajouté'); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });
  /** Cle produit identique au serveur (mig 262) : SKU s'il existe, sinon nom. */
  const productKeyOf = (sku: string, name: string) =>
    (sku.trim() || name.trim()).toUpperCase();

  /**
   * Ventile les reçus par shift selon l'heure DU MAGASIN (conversion de fuseau)
   * comparée à l'heure de passation, agrège par produit puis POST à chaque shift.
   * Un shift clôturé est signalé et sauté (l'autre s'importe quand même).
   */
  const doImportReceipts = async (rows: ParsedReceiptItem[], storeTz: string, passationMin: number) => {
    const single = shifts.length === 1 ? shifts[0] : null;
    const matin = single ?? shifts.find(s => s.shift_number === 1) ?? shifts[0];
    const soir = single ? null : (shifts.find(s => s.shift_number === 2) ?? shifts[shifts.length - 1]);

    type Agg = { sku: string; productName: string; category: string; quantity: number; netSales: number };
    const buckets = new Map<string, Map<string, Agg>>();
    for (const r of rows) {
      // « <= » : la passation est l'heure de fermeture de la caisse du matin ;
      // le ticket saisi à cette heure appartient encore au Matin.
      const target = (single || !soir) ? matin
        : receiptStoreMinutes(r.date, r.hour, r.minute, storeTz) <= passationMin ? matin : soir;
      let m = buckets.get(target.id);
      if (!m) { m = new Map(); buckets.set(target.id, m); }
      const key = productKeyOf(r.sku, r.productName);
      const a = m.get(key);
      if (a) { a.quantity += r.quantity; a.netSales += r.netSales; }
      else m.set(key, { sku: r.sku, productName: r.productName, category: r.category, quantity: r.quantity, netSales: r.netSales });
    }

    const parts: string[] = [];
    for (const s of shifts) {
      const agg = buckets.get(s.id);
      if (!agg || agg.size === 0) continue;
      const items = [...agg.values()]
        .filter(a => a.quantity > 0)  // un produit net remboursé (≤0) est ignoré
        .map(a => ({
          sku: a.sku || undefined, productName: a.productName, category: a.category || undefined,
          quantity: a.quantity,
          // Prix = ventes nettes / quantité (même base que l'import résumé).
          unitPrice: a.quantity > 0 ? Math.round((a.netSales / a.quantity) * 100) / 100 : 0,
          netSales: a.netSales,
        }));
      if (items.length === 0) continue;
      try {
        const r = await reconciliationApi.importSales(s.id, items);
        parts.push(`${s.label} : ${r.upserted}`);
      } catch (e: any) {
        if (e?.response?.status === 409) parts.push(`${s.label} clôturé (ignoré)`);
        else throw e;
      }
    }
    return { message: parts.length ? `Reçus ventilés — ${parts.join(' · ')} produit(s)` : 'Aucune vente exploitable' };
  };

  // Reçus parsés en attente de confirmation (aperçu Matin/Soir avant écriture).
  const [receiptPreview, setReceiptPreview] = useState<ParsedReceiptItem[] | null>(null);

  /** Import du résumé item-sales-summary (sans heure) dans le shift affiché. */
  const importSummaryMut = useMutation({
    mutationFn: async (files: File[]) => {
      if (!activeShift || isTotalView) {
        throw new Error('Choisir un shift (Matin ou Soir) avant d\'importer un résumé sans heure — ou utiliser l\'export « Reçus par article ».');
      }
      const parsed = await parseLoyverseFiles(files);
      const items = parsed.flatMap(p => p.items.map(i => ({
        sku: i.sku, productName: i.productName, category: i.category || undefined, quantity: i.quantity, unitPrice: i.unitPrice,
        netSales: i.netSales,
      })));
      if (items.length === 0) throw new Error('Aucune vente exploitable dans le fichier');
      const r = await reconciliationApi.importSales(activeShift.id, items);
      return { message: `Ventes importées (${activeShift.label}) : ${r.upserted} produit(s)` };
    },
    onSuccess: (r) => { invalidate(); notify.success(r.message); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || e?.message || 'Erreur import'),
  });

  /** Import des reçus ventilés (déclenché depuis l'aperçu, après confirmation). */
  const importReceiptsMut = useMutation({
    mutationFn: ({ rows, storeTz, passationMin }: { rows: ParsedReceiptItem[]; storeTz: string; passationMin: number }) =>
      doImportReceipts(rows, storeTz, passationMin),
    onSuccess: (r) => { invalidate(); setReceiptPreview(null); notify.success(r.message); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || e?.message || 'Erreur import'),
  });

  const [parsingFile, setParsingFile] = useState(false);
  /** Sélection de fichier : reçus horodatés → aperçu ; résumé → shift affiché. */
  const handleImportFiles = async (files: File[]) => {
    if (!day) return;
    setParsingFile(true);
    try {
      const receipts = await parseLoyverseReceiptFiles(files);
      if (receipts.length > 0) {
        // Journée mono-shift (historique) : pas de découpage → import direct.
        // Sinon on ouvre l'aperçu Matin/Soir avant écriture.
        if (multiShift) setReceiptPreview(receipts);
        else importReceiptsMut.mutate({ rows: receipts, storeTz: DEFAULT_STORE_TZ, passationMin: parseHHMM(SHIFT_SPLIT_TIME) });
        return;
      }
      importSummaryMut.mutate(files);
    } catch (e: any) {
      notify.error(e?.message || 'Erreur de lecture du fichier');
    } finally {
      setParsingFile(false);
    }
  };
  const importPending = parsingFile || importSummaryMut.isPending || importReceiptsMut.isPending;
  const bulkApproMut = useMutation({
    mutationFn: (rows: any[]) => reconciliationApi.bulkAppro(activeShift!.id, rows),
    onSuccess: (r) => { invalidate(); setShowPaste(false); notify.success(`Appro importé (${activeShift?.label}) : ${r.upserted} produit(s)`); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });
  const resetSalesMut = useMutation({
    mutationFn: () => reconciliationApi.resetSales(activeShift!.id),
    onSuccess: (r) => { invalidate(); notify.success(`Ventes remises à zéro : ${r.reset} ligne(s)`); },
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
  // Cloture / reouverture d'un seul shift (a la passation).
  const shiftStatusMut = useMutation({
    mutationFn: (v: { shiftId: string; action: 'open' | 'closed'; force?: boolean }) =>
      v.action === 'closed' ? reconciliationApi.closeShift(v.shiftId, v.force) : reconciliationApi.reopenShift(v.shiftId),
    onSuccess: invalidate,
    onError: (e: any, v) => {
      const err = e?.response?.data?.error;
      if (err?.code === 'NO_SALES') {
        if (window.confirm(`${err.message}\n\nClôturer quand même ?`)) {
          shiftStatusMut.mutate({ ...v, force: true });
        }
        return;
      }
      notify.error(err?.message || 'Erreur');
    },
  });

  const dayLocked = day?.status === 'closed';
  // Saisie verrouillee : journee cloturee, shift cloture, ou vue Journée (agrégat).
  const locked = dayLocked || isTotalView || !activeShift || activeShift.status === 'closed';
  const lines = (isTotalView ? day?.lines : activeShift?.lines) || [];

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
      a.report += num(l.report_veille_qty);
      a.appro += num(l.appro_qty); a.recu += num(l.recu_qty); a.vendu += num(l.vendu_qty); a.invendu += num(l.invendu_qty);
      a.ecartQty += num(l.ecart_qty); a.ecartVal += num(l.ecart_value);
      a.reportVal += num(l.report_veille_qty) * price;
      a.approVal += num(l.appro_qty) * price; a.recuVal += num(l.recu_qty) * price;
      // Montant vendu : ventes nettes reelles Loyverse si importees, sinon qte x prix.
      a.venduVal += num(l.vendu_amount) > 0 ? num(l.vendu_amount) : num(l.vendu_qty) * price;
      a.invenduVal += num(l.invendu_qty) * price;
      return a;
    }, { report: 0, appro: 0, recu: 0, vendu: 0, invendu: 0, ecartQty: 0, ecartVal: 0, reportVal: 0, approVal: 0, recuVal: 0, venduVal: 0, invenduVal: 0 });
  }, [lines]);

  const commit = (l: ReconLine, field: EditField, raw: string) => {
    if (!l.id) return;  // ligne agrégée (vue Journée) : jamais éditable
    const lineId = l.id;
    const parsed = parseFloat(raw.replace(',', '.'));
    const value = Number.isFinite(parsed) ? parsed : 0;
    setEdits(s => { const c = { ...s }; if (c[lineId]) delete c[lineId][field]; return c; });
    updateLineMut.mutate({ lineId, patch: { [field]: value } });
  };

  const numCell = (l: ReconLine, field: EditField, serverField: keyof ReconLine, tint?: ColTint, extraLocked = false) => {
    const eid = l.id ?? l.product_key;
    return (
      <NumCell
        value={edits[eid]?.[field] ?? String(l[serverField] ?? '')}
        locked={locked || extraLocked}
        tint={tint}
        onDraft={v => setEdits(s => ({ ...s, [eid]: { ...s[eid], [field]: v } }))}
        onCommit={raw => { if (edits[eid]?.[field] !== undefined) commit(l, field, raw); }}
      />
    );
  };

  const exportMut = useMutation({
    mutationFn: () => reconciliationApi.exportDayXlsx(day!.id, day!.business_date),
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur export'),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Bandeau explicatif */}
      <div className="odoo-alert" style={{ fontSize: '0.75rem', display: 'flex', gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Écart d'un shift = Vendu + Reste fin − (Ouverture + Reçu).</strong> Négatif = manque à expliquer
          (perte / vol / erreur), positif = surplus. L'appro n'entre pas dans le calcul.
          L'<strong>ouverture</strong> ne se saisit jamais : reste du soir de J-1 pour le <strong>Matin</strong>
          (catégories à report, Paramètres), <strong>comptage de passation</strong> (reste compté à 14h) pour le <strong>Soir</strong>.
          Ordre conseillé : saisir l'appro → confirmer le <strong>reçu</strong> → <strong>importer Loyverse</strong> (export
          « Reçus par article », horodaté → ventilé automatiquement Matin/Soir en un seul import) → saisir le reste compté (passation à 14h, ou reste du soir).
          La somme des écarts Matin + Soir = l'écart de la journée : le découpage sert à localiser le manque.
          Module isolé et temporaire — aucune donnée n'est écrite dans le système de production.
        </div>
      </div>

      {/* Barre d'action */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={e => { setDate(e.target.value); setEdits({}); setShiftSel('auto'); }}
          className="odoo-input" style={{ width: 160 }} />
        {day && multiShift && (
          <div style={{ display: 'inline-flex', border: '1px solid var(--theme-bg-separator)', borderRadius: 6, overflow: 'hidden' }}>
            {shifts.map(s => {
              const active = !isTotalView && activeShift?.id === s.id;
              return (
                <button key={s.id} type="button" onClick={() => setShiftSel(s.id)}
                  title={s.status === 'closed' ? `${s.label} clôturé` : `Saisie du shift ${s.label}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px',
                    border: 'none', borderRight: '1px solid var(--theme-bg-separator)', cursor: 'pointer',
                    fontSize: '0.8125rem', fontWeight: active ? 700 : 500,
                    background: active ? 'var(--theme-accent)' : 'var(--theme-bg-card, #fff)',
                    color: active ? '#fff' : 'var(--theme-text-primary)',
                  }}>
                  {s.status === 'closed' && <Lock size={11} />}
                  {s.label}
                </button>
              );
            })}
            <button type="button" onClick={() => setShiftSel('total')}
              title="Vue agrégée de la journée (lecture seule) : sommes des shifts, ouverture du matin, reste du soir"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px',
                border: 'none', cursor: 'pointer',
                fontSize: '0.8125rem', fontWeight: isTotalView ? 700 : 500,
                background: isTotalView ? 'var(--theme-accent)' : 'var(--theme-bg-card, #fff)',
                color: isTotalView ? '#fff' : 'var(--theme-text-primary)',
              }}>
              Journée
            </button>
          </div>
        )}
        {day && (
          <span className={`odoo-tag ${dayLocked ? 'odoo-tag-red' : 'odoo-tag-green'}`}>
            {dayLocked ? 'Journée clôturée' : 'Ouverte'}
          </span>
        )}
        {day && !dayLocked && !isTotalView && activeShift && multiShift && activeShift.status === 'closed' && (
          <span className="odoo-tag odoo-tag-red">{activeShift.label} clôturé</span>
        )}
        <div style={{ flex: 1 }} />
        <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) handleImportFiles(Array.from(e.target.files)); e.target.value = ''; }} />
        <button className="odoo-btn-secondary" disabled={!day || locked || resetSalesMut.isPending || totals.vendu === 0}
          title="Remet vendu et montant vendu à 0 sur toutes les lignes (appro, reçu et reste conservés) avant un réimport propre"
          onClick={() => {
            if (window.confirm('Remettre toutes les ventes du jour à zéro ?\n\nAppro, reçu et reste sont conservés. À utiliser avant un réimport Loyverse propre.')) {
              resetSalesMut.mutate();
            }
          }}>
          {resetSalesMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Ventes à 0
        </button>
        <button className="odoo-btn-secondary" disabled={!day || dayLocked || importPending}
          title={'Deux formats acceptés :\n• « Reçus par article » (horodaté) → aperçu Matin/Soir puis import, un seul fichier pour toute la journée.\n• « Item sales summary » (sans heure) → importé dans le shift affiché ; sélectionner Matin ou Soir avant.'}
          onClick={() => fileRef.current?.click()}>
          {importPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Importer Loyverse
        </button>
        <button className="odoo-btn-secondary" disabled={!day || locked} onClick={() => setShowPaste(true)}>
          <ClipboardPaste size={14} /> Coller l'appro
        </button>
        <button className="odoo-btn-secondary" disabled={!day || locked} onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Produit
        </button>
        <button className="odoo-btn-secondary" disabled={!day || lines.length === 0 || exportMut.isPending}
          onClick={() => exportMut.mutate()}
          title="Télécharger la journée au format Excel : synthèse par catégorie, détail commenté, écarts significatifs">
          {exportMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export Excel
        </button>
        {day && multiShift && !isTotalView && activeShift && !dayLocked && (
          activeShift.status === 'closed'
            ? <button className="odoo-btn-secondary"
                onClick={() => shiftStatusMut.mutate({ shiftId: activeShift.id, action: 'open' })}>
                <Unlock size={14} /> Rouvrir {activeShift.label}
              </button>
            : <button className="odoo-btn-secondary"
                title={activeShift.shift_number === firstSn
                  ? 'Clôture de la passation : fige le comptage de 14h qui devient l\'ouverture du Soir'
                  : 'Clôture du shift'}
                onClick={() => shiftStatusMut.mutate({ shiftId: activeShift.id, action: 'closed' })}>
                <Lock size={14} /> Clôturer {activeShift.label}
              </button>
        )}
        {day && (dayLocked
          ? <button className="odoo-btn-secondary" onClick={() => statusMut.mutate({ action: 'open' })}><Unlock size={14} /> Rouvrir la journée</button>
          : <button className="odoo-btn-secondary" onClick={() => statusMut.mutate({ action: 'closed' })}><Lock size={14} /> {multiShift ? 'Clôturer la journée' : 'Clôturer'}</button>
        )}
      </div>

      {/* Résumé rapide — compte de lignes par tone d'écart */}
      {lines.length > 0 && (() => {
        const c = lines.reduce((a, l) => {
          const t = ecartTone(num(l.ecart_value));
          a[t]++;
          return a;
        }, { ok: 0, neg: 0, pos: 0 } as Record<EcartTone, number>);
        const Chip = ({ tone, label, count }: { tone: EcartTone; label: string; count: number }) => {
          const t = ecartTheme(tone === 'neg' ? -1 : tone === 'pos' ? 1 : 0);
          const Icon = tone === 'neg' ? TrendingDown : tone === 'pos' ? TrendingUp : Check;
          return (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', borderRadius: 6,
              background: t.bg, color: t.fg,
              border: `1px solid ${t.border}`,
              fontSize: '0.75rem', fontWeight: 600,
              opacity: count === 0 ? 0.5 : 1,
            }}>
              <Icon size={14} strokeWidth={2.5} />
              <span>{label}</span>
              <strong style={{ fontSize: '0.875rem', fontFamily: 'ui-monospace, monospace' }}>{count}</strong>
            </div>
          );
        };
        return (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Chip tone="neg" label="Manque à expliquer" count={c.neg} />
            <Chip tone="pos" label="Surplus (vendu > disponible)" count={c.pos} />
            <Chip tone="ok" label="OK" count={c.ok} />
          </div>
        );
      })()}

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
                {(() => {
                  // Libelles des colonnes ouverture / reste selon le shift affiche.
                  const isPassationOpen = !isTotalView && multiShift && activeShift != null && activeShift.shift_number !== firstSn;
                  const isPassationClose = !isTotalView && multiShift && activeShift != null && activeShift.shift_number !== lastSn;
                  return (
                    <>
                      <th style={{ textAlign: 'right', background: COL_TINTS.report.bg, color: COL_TINTS.report.text }}
                          title={isPassationOpen
                            ? 'Stock d\'ouverture du shift : reste compté à la passation (fin du shift précédent), reporté automatiquement. Non modifiable.'
                            : 'Stock d\'ouverture : reste du soir de la veille, reporté automatiquement. Non modifiable.'}>
                        {isPassationOpen ? 'Ouverture' : 'Reste veille'}
                        <div style={{ fontSize: '0.5625rem', fontWeight: 500, opacity: 0.75 }}>
                          {isPassationOpen ? 'passation · auto' : 'J-1 · auto'}
                        </div>
                      </th>
                      <th style={{ textAlign: 'right', background: COL_TINTS.appro.bg, color: COL_TINTS.appro.text }}>Appro</th>
                      <th style={{ textAlign: 'right', background: COL_TINTS.recu.bg, color: COL_TINTS.recu.text }}>Reçu</th>
                      <th style={{ textAlign: 'right', background: COL_TINTS.vendu.bg, color: COL_TINTS.vendu.text }}>Vendu</th>
                      <th style={{ textAlign: 'right', background: COL_TINTS.invendu.bg, color: COL_TINTS.invendu.text }}
                          title={isPassationClose
                            ? 'Comptage physique de la passation (~14h) : tout ce qui reste en vitrine à la fin du shift. Devient l\'ouverture du shift suivant.'
                            : 'Comptage physique de fin de journée : un seul chiffre, tout ce qui reste en vitrine.'}>
                        {isPassationClose ? 'Reste passation' : 'Reste soir'}
                        <div style={{ fontSize: '0.5625rem', fontWeight: 500, opacity: 0.75 }}>
                          {isPassationClose ? 'comptage 14h' : 'comptage'}
                        </div>
                      </th>
                    </>
                  );
                })()}
                <th style={{ textAlign: 'right' }}>Prix (DH)</th>
                <th style={{ textAlign: 'right' }}>Écart (u)</th>
                <th style={{ textAlign: 'right' }}>Écart (DH)</th>
                <th style={{ width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
                  Aucune ligne. Ajoute un produit ou importe le CSV Loyverse du jour.
                </td></tr>
              ) : groupedLines.map(({ cat, items }) => {
                const isCollapsed = collapsed.has(cat);
                const catReport = items.reduce((s, l) => s + num(l.report_veille_qty), 0);
                const catAppro = items.reduce((s, l) => s + num(l.appro_qty), 0);
                const catRecu = items.reduce((s, l) => s + num(l.recu_qty), 0);
                const catVendu = items.reduce((s, l) => s + num(l.vendu_qty), 0);
                const catInvendu = items.reduce((s, l) => s + num(l.invendu_qty), 0);
                const catEcartQty = items.reduce((s, l) => s + num(l.ecart_qty), 0);
                const catEcartVal = items.reduce((s, l) => s + num(l.ecart_value), 0);
                const catTheme = ecartTheme(catEcartVal, Math.abs(catEcartVal) >= 50);
                const catBg = ecartTone(catEcartVal) === 'ok' ? 'var(--theme-bg-sidebar, #f5f5f5)' : catTheme.bg;
                const catCellBase = { background: catBg, fontWeight: 700, textAlign: 'right' as const, fontFamily: 'ui-monospace, monospace', padding: '4px 8px' };
                return (
                <Fragment key={cat}>
                  <tr
                    onClick={() => setCollapsed(prev => {
                      const next = new Set(prev);
                      if (next.has(cat)) next.delete(cat); else next.add(cat);
                      return next;
                    })}
                    style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <td style={{
                      background: catBg, fontWeight: 700,
                      color: 'var(--theme-accent)', fontSize: '0.75rem',
                      textTransform: 'uppercase', letterSpacing: 0.5,
                      borderLeft: `3px solid ${ecartTone(catEcartVal) === 'ok' ? 'transparent' : catTheme.border}`,
                    }}>
                      {isCollapsed ? '▸' : '▾'} {cat} ({items.length})
                    </td>
                    <td style={{ ...catCellBase, color: COL_TINTS.report.text }}>{catReport > 0 ? qf(catReport) : '—'}</td>
                    <td style={{ ...catCellBase, color: COL_TINTS.appro.text }}>{qf(catAppro)}</td>
                    <td style={{ ...catCellBase, color: catRecu > 0 && catRecu !== catAppro ? '#b26a00' : COL_TINTS.recu.text }}>{qf(catRecu)}</td>
                    <td style={{ ...catCellBase, color: COL_TINTS.vendu.text }}>{qf(catVendu)}</td>
                    <td style={{ ...catCellBase, color: COL_TINTS.invendu.text }}>{qf(catInvendu)}</td>
                    <td style={{ background: catBg }}></td>
                    <td style={{ ...catCellBase }}>
                      <EcartBadge value={catEcartQty} format={qf} strong={Math.abs(catEcartVal) >= 50} minWidth={54} />
                    </td>
                    <td style={{ ...catCellBase }}>
                      <EcartBadge value={catEcartVal} format={v => `${nf(v)} DH`} strong={Math.abs(catEcartVal) >= 50} minWidth={90} />
                    </td>
                    <td style={{ background: catBg }}></td>
                  </tr>
                  {!isCollapsed && items.map(l => {
                const eQty = num(l.ecart_qty), eVal = num(l.ecart_value);
                const isSignificant = Math.abs(eVal) >= 20;
                const rowTheme = ecartTheme(eVal, isSignificant);
                const rowBorder = isSignificant ? rowTheme.border : 'transparent';
                return (
                  <tr key={l.id ?? l.product_key}>
                    <td style={{ borderLeft: `3px solid ${rowBorder}` }}>
                      <span style={{ fontWeight: 500 }}>{l.product_name}</span>
                      {l.source_vendu === 'loyverse_import' && (
                        <span className="odoo-tag odoo-tag-blue" style={{ marginLeft: 6 }}>Loyverse</span>
                      )}
                      {l.sku && <div style={{ fontSize: '0.625rem', color: 'var(--theme-text-muted)', fontFamily: 'monospace' }}>{l.sku}</div>}
                    </td>
                    <td style={{ textAlign: 'right', background: COL_TINTS.report.bg }}>
                      <ReportVeilleCell qty={num(l.report_veille_qty)}
                        passation={!isTotalView && multiShift && activeShift != null && activeShift.shift_number !== firstSn} />
                    </td>
                    <td style={{ textAlign: 'right', background: COL_TINTS.appro.bg }}>{numCell(l, 'approQty', 'appro_qty', COL_TINTS.appro, !canEditAppro)}</td>
                    <td style={{ textAlign: 'right', background: COL_TINTS.recu.bg }}>
                      {numCell(l, 'recuQty', 'recu_qty', COL_TINTS.recu)}
                      {num(l.report_veille_qty) > 0 && (
                        <div style={{ fontSize: '0.5625rem', color: COL_TINTS.report.text, fontWeight: 600 }}
                             title="Reste de la veille qui s'ajoute au reçu du jour pour le calcul de l'écart">
                          +{qf(num(l.report_veille_qty))}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', background: COL_TINTS.vendu.bg }}>{numCell(l, 'venduQty', 'vendu_qty', COL_TINTS.vendu, l.source_vendu === 'loyverse_import')}</td>
                    <td style={{ textAlign: 'right', background: COL_TINTS.invendu.bg }}>{numCell(l, 'invenduQty', 'invendu_qty', COL_TINTS.invendu)}</td>
                    <td style={{ textAlign: 'right' }}>{numCell(l, 'unitPrice', 'unit_price')}</td>
                    <td style={{ textAlign: 'right', padding: '4px 8px' }}>
                      <EcartBadge value={eQty} format={qf} minWidth={54} />
                    </td>
                    <td style={{ textAlign: 'right', padding: '4px 8px' }}>
                      <EcartBadge value={eVal} format={nf} strong={isSignificant} minWidth={72} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {!locked && l.id && (
                        <button onClick={() => deleteLineMut.mutate(l.id!)} title="Supprimer la ligne"
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
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', background: COL_TINTS.report.bg, color: COL_TINTS.report.text }}>{totals.report > 0 ? qf(totals.report) : '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', background: COL_TINTS.appro.bg, color: COL_TINTS.appro.text }}>{qf(totals.appro)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', background: COL_TINTS.recu.bg, color: totals.recu !== totals.appro && totals.recu > 0 ? '#b26a00' : COL_TINTS.recu.text }}>
                    {qf(totals.recu)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', background: COL_TINTS.vendu.bg, color: COL_TINTS.vendu.text }}>{qf(totals.vendu)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', background: COL_TINTS.invendu.bg, color: COL_TINTS.invendu.text }}>{qf(totals.invendu)}</td>
                  <td></td>
                  <td style={{ textAlign: 'right', padding: '4px 8px' }}>
                    <EcartBadge value={totals.ecartQty} format={qf} strong minWidth={62} />
                  </td>
                  <td style={{ textAlign: 'right', padding: '4px 8px' }}>
                    <EcartBadge value={totals.ecartVal} format={v => `${nf(v)} DH`} strong minWidth={96} />
                  </td>
                  <td></td>
                </tr>
                <tr style={{ fontWeight: 600, color: 'var(--theme-text-muted)', background: 'var(--theme-bg-sidebar, #f5f5f5)' }}>
                  <td>Montants (DH)</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', background: COL_TINTS.report.bg, color: COL_TINTS.report.text }}>{totals.report > 0 ? nf(totals.reportVal) : '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', background: COL_TINTS.appro.bg, color: COL_TINTS.appro.text }}>{nf(totals.approVal)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', background: COL_TINTS.recu.bg, color: COL_TINTS.recu.text }}>{nf(totals.recuVal)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', background: COL_TINTS.vendu.bg, color: COL_TINTS.vendu.text }}>{nf(totals.venduVal)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', background: COL_TINTS.invendu.bg, color: COL_TINTS.invendu.text }}>{nf(totals.invenduVal)}</td>
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

      {receiptPreview && multiShift && (
        <ReceiptImportModal
          receipts={receiptPreview}
          isLoading={importReceiptsMut.isPending}
          onClose={() => setReceiptPreview(null)}
          onImport={(storeTz, passationMin) => importReceiptsMut.mutate({ rows: receiptPreview, storeTz, passationMin })}
        />
      )}
    </div>
  );
}

/**
 * Aperçu de la ventilation des reçus avant écriture. Les heures du fichier sont
 * dans le fuseau de l'ordinateur qui a téléchargé (ex. Montréal) ; on les
 * convertit en heure du magasin (ex. Casablanca) avant de couper à l'heure de
 * passation. L'utilisateur vérifie les totaux Matin/Soir contre ses Z de caisse
 * et ajuste l'heure si besoin — robuste à tout décalage horaire.
 */
function ReceiptImportModal({ receipts, isLoading, onClose, onImport }: {
  receipts: ParsedReceiptItem[];
  isLoading: boolean;
  onClose: () => void;
  onImport: (storeTz: string, passationMin: number) => void;
}) {
  const [storeTz, setStoreTz] = useState(() => localStorage.getItem(LS_STORE_TZ) || DEFAULT_STORE_TZ);
  const [passation, setPassation] = useState(() => localStorage.getItem(LS_PASSATION) || SHIFT_SPLIT_TIME);
  const detectedTz = browserTz();
  const passationMin = parseHHMM(passation);

  const tzValid = useMemo(() => {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: storeTz }); return true; }
    catch { return false; }
  }, [storeTz]);

  // Totaux Matin / Soir recalculés en direct selon fuseau + heure de passation.
  const stats = useMemo(() => {
    const acc = {
      matin: { net: 0, qty: 0, tickets: new Set<string>() },
      soir: { net: 0, qty: 0, tickets: new Set<string>() },
    };
    for (const r of receipts) {
      const mins = tzValid ? receiptStoreMinutes(r.date, r.hour, r.minute, storeTz) : r.hour * 60 + r.minute;
      const b = mins <= passationMin ? acc.matin : acc.soir;
      b.net += r.netSales; b.qty += r.quantity;
    }
    return acc;
  }, [receipts, storeTz, passationMin, tzValid]);

  const total = stats.matin.net + stats.soir.net;

  const confirm = () => {
    localStorage.setItem(LS_STORE_TZ, storeTz);
    localStorage.setItem(LS_PASSATION, passation);
    onImport(storeTz, passationMin);
  };

  const box = (label: string, s: { net: number; qty: number }, color: string) => (
    <div style={{ flex: 1, border: '1px solid var(--theme-bg-separator)', borderRadius: 6, padding: '10px 14px' }}>
      <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--theme-text-muted)' }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, fontFamily: 'ui-monospace, monospace', color }}>{nf(s.net)} <span style={{ fontSize: '0.8rem' }}>DH</span></div>
      <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{qf(s.qty)} article{s.qty > 1 ? 's' : ''}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 540, borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', background: '#f9fafb', fontWeight: 600 }}>
          Importer les reçus — répartition Matin / Soir
        </div>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 14, background: '#fff' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', display: 'flex', gap: 8 }}>
            <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              {receipts.length} ligne{receipts.length > 1 ? 's' : ''} de reçu. Fichier téléchargé depuis <strong>{detectedTz}</strong> ;
              les heures sont converties en heure du magasin (<strong>{storeTz}</strong>) avant le découpage.
              Vérifie que les montants ci-dessous correspondent à tes Z de caisse et ajuste l'heure de passation si besoin.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 2 }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Fuseau du magasin</label>
              <input className="input" value={storeTz} list="recon-tz-list"
                onChange={e => setStoreTz(e.target.value.trim())}
                style={{ borderColor: tzValid ? undefined : '#e53935' }} />
              <datalist id="recon-tz-list">
                <option value="Africa/Casablanca" />
                <option value="Europe/Paris" />
                <option value="America/Toronto" />
                <option value="America/Montreal" />
                <option value="UTC" />
              </datalist>
              {!tzValid && <div style={{ fontSize: '0.6875rem', color: '#b71c1c', marginTop: 3 }}>Fuseau invalide — heures du fichier utilisées telles quelles.</div>}
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Fermeture caisse matin</label>
              <input type="time" className="input" value={passation}
                onChange={e => setPassation(e.target.value || '14:00')} />
              <div style={{ fontSize: '0.625rem', color: 'var(--theme-text-muted)', marginTop: 3 }}>
                Heure du magasin. Tickets jusqu'à cette heure = Matin.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            {box('Matin', stats.matin, '#1565c0')}
            {box('Soir', stats.soir, '#2e7d32')}
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
            Total : <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{nf(total)} DH</strong>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 6, borderTop: '1px solid var(--theme-bg-separator)' }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary" disabled={isLoading}>Annuler</button>
            <button type="button" onClick={confirm} className="odoo-btn-primary" disabled={isLoading}>
              {isLoading ? <><Loader2 size={14} className="animate-spin" /> Import…</> : 'Importer'}
            </button>
          </div>
        </div>
      </div>
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
            <strong>Nom · Quantité · Prix(opt) · SKU(opt) · Catégorie(opt)</strong>. Le vendu et le reste déjà saisis
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

/**
 * Ajout d'un produit manquant a la journee : recherche dans le catalogue
 * (recon_products) avec prefill SKU/categorie/prix, ou creation d'un nouveau
 * produit (le serveur l'enregistre aussi au catalogue).
 */
function AddLineModal({ onClose, onSave, isLoading }: {
  onClose: () => void; onSave: (d: any) => void; isLoading: boolean;
}) {
  const [f, setF] = useState({ productName: '', sku: '', category: '', approQty: '', recuQty: '', unitPrice: '' });
  const [catFilter, setCatFilter] = useState('');

  const { data: products = [] } = useQuery({
    queryKey: ['recon-products'],
    queryFn: () => reconciliationApi.listProducts(),
  });

  const cats = useMemo(
    () => [...new Set(products.map(p => p.category || 'Non classé'))].sort((a, b) => a.localeCompare(b, 'fr')),
    [products],
  );

  const inCategory = useMemo(
    () => catFilter ? products.filter(p => (p.category || 'Non classé') === catFilter) : products,
    [products, catFilter],
  );

  const q = f.productName.trim().toLowerCase();
  const matches = q ? inCategory.filter(p => p.product_name.toLowerCase().includes(q)) : inCategory;
  const known = products.find(p => p.product_name.trim().toLowerCase() === q);
  const isNew = q !== '' && !known;

  const pickProduct = (p: ReconProduct) => setF(prev => ({
    ...prev,
    productName: p.product_name,
    sku: p.sku || '',
    category: p.category || '',
    unitPrice: num(p.unit_price) > 0 ? String(p.unit_price) : prev.unitPrice,
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 460, borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', background: '#f9fafb', fontWeight: 600 }}>
          Ajouter un produit à la journée
        </div>
        <form onSubmit={e => {
          e.preventDefault();
          if (!f.productName.trim()) return;
          onSave({
            productName: f.productName.trim(), sku: f.sku.trim() || undefined, category: f.category.trim() || undefined,
            approQty: parseFloat(f.approQty.replace(',', '.')) || 0,
            recuQty: parseFloat(f.recuQty.replace(',', '.')) || 0,
            unitPrice: parseFloat(f.unitPrice.replace(',', '.')) || 0,
          });
        }} style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 12, background: '#fff' }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Catégorie</label>
            <select className="input" value={catFilter}
              onChange={e => { setCatFilter(e.target.value); setF(prev => ({ ...prev, productName: '' })); }}>
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
            <input className="input" autoFocus required value={f.productName}
              placeholder="Tape pour chercher…"
              onChange={e => setF({ ...f, productName: e.target.value })} />
            {/* Resultats de recherche cliquables (limites a 8) */}
            {q !== '' && !known && matches.length > 0 && (
              <div style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 4, marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
                {matches.slice(0, 8).map(p => (
                  <button key={p.product_key} type="button"
                    onClick={() => pickProduct(p)}
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
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>SKU</label>
                <input className="input" value={f.sku} onChange={e => setF({ ...f, sku: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Catégorie du produit</label>
                <input className="input" value={f.category || (catFilter !== 'Non classé' ? catFilter : '')} list="day-add-categories"
                  onChange={e => setF({ ...f, category: e.target.value })} />
                <datalist id="day-add-categories">
                  {cats.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Approvisionné</label>
              <input type="text" inputMode="decimal" className="input" value={f.approQty}
                placeholder="0"
                onChange={e => setF({ ...f, approQty: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Reçu</label>
              <input type="text" inputMode="decimal" className="input" value={f.recuQty}
                placeholder="0"
                onChange={e => setF({ ...f, recuQty: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Prix (DH)</label>
              <input type="text" inputMode="decimal" className="input" value={f.unitPrice}
                placeholder="0"
                onChange={e => setF({ ...f, unitPrice: e.target.value })} />
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
/**
 * Catégories dont le reste du soir devient le stock d'ouverture du lendemain.
 * Pâtisserie : oui (la vitrine n'est pas vidée). Viennoiserie / boulangerie :
 * non, ces produits sont jetés — un report y créerait des manques fictifs.
 */
function CarryOverSettingsView() {
  const qc = useQueryClient();
  const { data: cats = [], isLoading } = useQuery({
    queryKey: ['recon-carryover'],
    queryFn: () => reconciliationApi.listCarryOver(),
  });

  const toggleMut = useMutation({
    mutationFn: ({ category, enabled }: { category: string; enabled: boolean }) =>
      reconciliationApi.setCarryOver(category, enabled),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['recon-carryover'] });
      // La journee affichee resynchronise son report a la prochaine ouverture.
      qc.invalidateQueries({ queryKey: ['recon-day'] });
      notify.success(v.enabled ? `Report activé : ${v.category}` : `Report désactivé : ${v.category}`);
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });

  const enabledCount = cats.filter(c => c.enabled).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="odoo-alert" style={{ fontSize: '0.75rem', display: 'flex', gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Report du reste de la veille.</strong> Pour les catégories cochées, le reste du soir
          devient le <strong>stock d'ouverture</strong> du lendemain : il s'ajoute au reçu pour le calcul
          de l'écart (<em>Écart = Vendu + Reste soir − (Reste veille + Reçu)</em>), tout en restant affiché
          dans sa propre colonne. À réserver aux produits qui ne sont pas jetés le soir — cocher
          viennoiseries ou baguettes ferait apparaître des manques fictifs le lendemain.
          Le report est recalculé à chaque ouverture de la journée : corriger le reste du soir de J-1
          met à jour le stock d'ouverture d'aujourd'hui tant que la journée n'est pas clôturée.
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /> Chargement…
        </div>
      ) : cats.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4 }}>
          Aucune catégorie au catalogue. Importe d'abord le catalogue Loyverse.
        </div>
      ) : (
        <>
          <div style={{
            fontWeight: 700, padding: '6px 10px',
            background: 'var(--theme-bg-sidebar, #f5f5f5)',
            color: 'var(--theme-accent)', fontSize: '0.8125rem',
            textTransform: 'uppercase', letterSpacing: 0.5,
            borderRadius: '4px 4px 0 0', border: '1px solid var(--theme-bg-separator)',
          }}>
            Report du reste ({enabledCount} catégorie{enabledCount > 1 ? 's' : ''} sur {cats.length})
          </div>
          <table className="odoo-table" style={{ borderTop: 'none', marginTop: -14 }}>
            <thead>
              <tr>
                <th style={{ width: 70, textAlign: 'center' }}>Report</th>
                <th>Catégorie</th>
              </tr>
            </thead>
            <tbody>
              {cats.map(c => (
                <tr key={c.category}>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={c.enabled}
                      disabled={toggleMut.isPending}
                      onChange={e => toggleMut.mutate({ category: c.category, enabled: e.target.checked })} />
                  </td>
                  <td style={{ fontWeight: c.enabled ? 600 : 400, color: c.enabled ? undefined : 'var(--theme-text-muted)' }}>
                    {c.category}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

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

  const clearMut = useMutation({
    mutationFn: () => reconciliationApi.clearProducts(),
    onSuccess: (r) => { invalidate(); notify.success(`Catalogue vidé (${r.deleted} produit(s) supprimé(s))`); },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || e?.message || 'Erreur'),
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
        <button className="odoo-btn-secondary" disabled={products.length === 0 || clearMut.isPending}
          title="Supprime tous les produits du catalogue avant un réimport propre. L'historique des journées est conservé."
          style={{ color: '#b71c1c', borderColor: '#e5b4b4' }}
          onClick={() => {
            if (window.confirm(`Vider le catalogue ?\n\n${products.length} produit(s) seront supprimés.\nL'historique des journées passées est conservé.\n\nÀ utiliser avant un réimport propre du catalogue Loyverse.`)) {
              clearMut.mutate();
            }
          }}>
          {clearMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Vider le catalogue
        </button>
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
    const headers = ['Produit', 'Categorie', 'Appro', 'Vendu', 'Reste', 'Ecart (u)', 'Ecart (DH)', 'Jours'];
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
            ['Reste (u)', qf(totals.invendu)], ['Écart total (DH)', nf(totals.ecartVal)],
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
                <th style={{ textAlign: 'right' }}>Reste</th>
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
