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
