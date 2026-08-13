/**
 * Parseur du CSV Loyverse "item-sales-summary" — copie ISOLEE (volontaire)
 * du parseur de la page Ventes, pour que le module Rapprochement soit
 * entierement auto-contenu et supprimable d'un bloc.
 *
 * Colonnes attendues (export Loyverse "Item sales summary") :
 *   [0] nom produit  [1] SKU  [3] quantite  [8] ventes nettes  [9] cout
 */
export type ParsedLoyverseDay = {
  date: string;
  items: { sku: string; productName: string; category: string; quantity: number; unitPrice: number; netSales: number }[];
};

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Decoupe une ligne CSV en respectant les guillemets : un champ comme
 * "Baguette normale 1,25" ne doit PAS etre coupe sur sa virgule interne.
 * Un guillemet double a l'interieur d'un champ quote ("") = guillemet echappe.
 */
export function splitCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export type LoyverseCatalogItem = { sku: string; productName: string; category: string; unitPrice: number };

/**
 * Parse un fichier Loyverse pour alimenter le CATALOGUE (pas de quantites).
 * Detecte automatiquement le format via l'en-tete :
 *  - export articles  "export_items*.csv" : Handle,SKU,Name,Category,...,Price [magasin]
 *  - item-sales-summary (repli)           : Nom,SKU,Categorie,Qte,...,Ventes nettes
 * Les prix "variable" deviennent 0 (a completer dans le catalogue).
 */
export function parseLoyverseCatalogFiles(files: FileList | File[]): Promise<LoyverseCatalogItem[]> {
  return Promise.all(Array.from(files).map(file => new Promise<LoyverseCatalogItem[]>((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = ((e.target?.result as string) || '').replace(/^﻿/, '');
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { resolve([]); return; }
      const header = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
      const isItemsExport = header.includes('handle') && header.includes('name');
      let items: LoyverseCatalogItem[];
      if (isItemsExport) {
        const iSku = header.indexOf('sku');
        const iName = header.indexOf('name');
        const iCat = header.indexOf('category');
        const iPrice = header.findIndex(h => h.startsWith('price'));
        items = lines.slice(1).map(line => {
          const cols = splitCSVLine(line);
          return {
            sku: iSku >= 0 ? (cols[iSku] || '').trim() : '',
            productName: (cols[iName] || '').trim(),
            category: iCat >= 0 ? (cols[iCat] || '').trim() : '',
            unitPrice: iPrice >= 0 ? Math.round((parseFloat(cols[iPrice]) || 0) * 100) / 100 : 0,
          };
        });
      } else {
        items = lines.slice(1).map(line => {
          const cols = splitCSVLine(line);
          const quantity = parseFloat(cols[3]) || 0;
          const netSales = parseFloat(cols[8]) || 0;
          return {
            productName: (cols[0] || '').trim(),
            sku: (cols[1] || '').trim(),
            category: (cols[2] || '').trim(),
            unitPrice: quantity > 0 ? Math.round((netSales / quantity) * 100) / 100 : 0,
          };
        });
      }
      resolve(items.filter(i => i.productName));
    };
    reader.readAsText(file);
  }))).then(arr => arr.flat());
}

// ─── Import par REÇUS PAR ARTICLE (transaction-level, avec heure) ─────────
// Le module Contrôle des ventes est par shift (mig 262). L'export « item-sales
// -summary » n'a pas d'horodatage. L'export « Reçus par article »
// (receipts-by-item) donne UNE ligne par (reçu, article) avec l'heure, l'UGS
// (SKU), la catégorie, la quantité et les ventes nettes — tout ce qu'il faut
// pour ventiler automatiquement le vendu entre Matin et Soir en un seul import,
// et pour matcher exactement les mêmes clés produit que l'export résumé.

export type ParsedReceiptItem = {
  date: string;      // AAAA-MM-JJ
  hour: number;      // 0-23, pour la ventilation Matin/Soir
  minute: number;
  sku: string;
  productName: string;
  category: string;
  quantity: number;  // négatif pour un remboursement (à soustraire du vendu)
  netSales: number;
};

/** Enlève les accents pour comparer des en-têtes (« Catégorie » → « categorie »). */
function deburr(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Reconnaît l'en-tête « Reçus par article » (date horodatée + UGS + article + quantité). */
function isReceiptItemsHeader(header: string[]): boolean {
  const h = header.map(x => deburr(x).toLowerCase());
  return h.includes('date')
    && (h.includes('ugs') || h.includes('sku'))
    && h.includes('article')
    && h.some(x => x.startsWith('quantite'));
}

/**
 * Parse un ou plusieurs exports « Reçus par article » Loyverse. Les fichiers
 * qui ne sont PAS à ce format sont ignorés (retour vide) : l'appelant se rabat
 * alors sur le parseur item-sales-summary. Les remboursements (type contenant
 * « rembours »/« refund »/« retour ») sortent en quantités et montants négatifs
 * pour être soustraits du vendu.
 */
export function parseLoyverseReceiptFiles(files: FileList | File[]): Promise<ParsedReceiptItem[]> {
  return Promise.all(Array.from(files).map(file => new Promise<ParsedReceiptItem[]>((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = ((e.target?.result as string) || '').replace(/^﻿/, '');
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { resolve([]); return; }
      const header = splitCSVLine(lines[0]).map(h => h.trim());
      if (!isReceiptItemsHeader(header)) { resolve([]); return; }

      const norm = header.map(x => deburr(x).toLowerCase());
      const col = (name: string) => norm.indexOf(name);
      const iDate = col('date');
      const iType = norm.findIndex(x => x.startsWith('type'));
      const iCat = col('categorie');
      const iSku = col('ugs') >= 0 ? col('ugs') : col('sku');
      const iName = col('article');
      const iQty = norm.findIndex(x => x.startsWith('quantite'));
      const iNet = col('ventes nettes');

      const items = lines.slice(1).map(line => {
        const cols = splitCSVLine(line);
        const dt = (cols[iDate] || '').trim();
        // « 2026-08-12 17 h 10 » (ou « 17:10 ») → date + heure + minute.
        const m = dt.match(/(\d{4}-\d{2}-\d{2}).*?(\d{1,2})\s*[h:]\s*(\d{2})/);
        if (!m) return null;
        const productName = (cols[iName] || '').trim();
        const quantity = parseFloat((cols[iQty] || '').replace(',', '.')) || 0;
        if (!productName || quantity === 0) return null;
        const type = iType >= 0 ? deburr(cols[iType] || '').toLowerCase() : '';
        const sign = /rembours|refund|retour/.test(type) ? -1 : 1;
        return {
          date: m[1],
          hour: parseInt(m[2], 10),
          minute: parseInt(m[3], 10),
          sku: iSku >= 0 ? (cols[iSku] || '').trim() : '',
          productName,
          category: iCat >= 0 ? (cols[iCat] || '').trim() : '',
          quantity: quantity * sign,
          netSales: iNet >= 0 ? (parseFloat(cols[iNet]) || 0) * sign : 0,
        };
      }).filter(Boolean) as ParsedReceiptItem[];

      resolve(items);
    };
    reader.readAsText(file);
  }))).then(arr => arr.flat());
}

export function parseLoyverseFiles(files: FileList | File[]): Promise<ParsedLoyverseDay[]> {
  return Promise.all(Array.from(files).map(file => {
    return new Promise<ParsedLoyverseDay>((resolve) => {
      // La date vient du nom de fichier : item-sales-summary-YYYY-MM-DD-...csv
      const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : todayISO();

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = (e.target?.result as string) || '';
        const lines = text.split('\n').filter(l => l.trim());
        const items = lines.slice(1).map(line => {
          const cols = splitCSVLine(line);
          const quantity = parseFloat(cols[3]) || 0;
          const netSales = parseFloat(cols[8]) || 0;
          const unitPrice = quantity > 0 ? netSales / quantity : 0;
          return {
            productName: cols[0]?.trim() || '',
            sku: cols[1]?.trim() || '',
            category: cols[2]?.trim() || '',
            quantity,
            unitPrice: Math.round(unitPrice * 100) / 100,
            netSales,
          };
        }).filter(i => i.quantity > 0 && i.productName);
        resolve({ date, items });
      };
      reader.readAsText(file);
    });
  }));
}
