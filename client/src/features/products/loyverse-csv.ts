import type { ImportProductItem } from '../../api/products.api';

// ─── Parseur CSV minimal (RFC 4180) ────────────────────────────────────────
// Gere les champs entre guillemets (virgules et retours ligne inclus) sans
// dependance externe. Suffisant pour les exports Loyverse.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

export interface LoyverseMapping {
  items: ImportProductItem[];
  // Lignes non importables : prix « variable », nom introuvable...
  ignored: Array<{ line: number; name: string; reason: string }>;
}

// ─── Mapping export Loyverse -> produits ───────────────────────────────────
// Colonnes attendues (entetes) : Handle, Name, Category, Sold by weight, Cost,
// Price [<store>], Available for sale [<store>], Option 1 value.
// Les variantes (lignes sans Name, meme Handle) heritent du nom parent et
// recoivent le suffixe de l'option (ex : « AMANDINE PRS 8 »). Quand un handle
// a plusieurs lignes, le parent est aussi suffixe pour rester distinct.
export function mapLoyverseCsv(text: string): LoyverseMapping {
  const rows = parseCsv(text);
  if (rows.length < 2) return { items: [], ignored: [] };

  const header = rows[0].map(h => h.trim().toLowerCase());
  const startsWith = (prefix: string) => header.findIndex(h => h.startsWith(prefix));
  const iHandle = startsWith('handle');
  const iName = header.findIndex(h => h === 'name');
  const iCategory = startsWith('category');
  const iWeight = startsWith('sold by weight');
  const iCost = header.findIndex(h => h === 'cost');
  const iPrice = startsWith('price');
  const iAvailable = startsWith('available for sale');
  const iOptValue = startsWith('option 1 value');

  if (iName < 0 || iPrice < 0) {
    throw new Error('Colonnes « Name » et « Price » introuvables — est-ce bien un export Loyverse ?');
  }

  const cell = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? '').trim() : '');

  // 1re passe : nom de base + nombre de lignes par handle (pour les variantes).
  const groupCount = new Map<string, number>();
  const groupBaseName = new Map<string, string>();
  for (let r = 1; r < rows.length; r++) {
    const handle = cell(rows[r], iHandle);
    if (!handle) continue;
    groupCount.set(handle, (groupCount.get(handle) || 0) + 1);
    const name = cell(rows[r], iName);
    if (name && !groupBaseName.has(handle)) groupBaseName.set(handle, name);
  }
  // Categorie des variantes : heritee de la ligne parent.
  const groupCategory = new Map<string, string>();
  for (let r = 1; r < rows.length; r++) {
    const handle = cell(rows[r], iHandle);
    const cat = cell(rows[r], iCategory);
    if (handle && cat && !groupCategory.has(handle)) groupCategory.set(handle, cat);
  }

  const items: ImportProductItem[] = [];
  const ignored: LoyverseMapping['ignored'] = [];
  const seenNames = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const handle = cell(row, iHandle);
    const rawName = cell(row, iName);
    const baseName = rawName || (handle ? groupBaseName.get(handle) || '' : '');
    if (!baseName) {
      if (row.some(c => c.trim() !== '')) ignored.push({ line: r + 1, name: handle || '(vide)', reason: 'Nom introuvable' });
      continue;
    }

    const optValue = cell(row, iOptValue);
    const isVariantGroup = handle ? (groupCount.get(handle) || 0) > 1 : false;
    const name = isVariantGroup && optValue ? `${baseName} ${optValue}` : baseName;

    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      ignored.push({ line: r + 1, name, reason: 'Doublon dans le fichier' });
      continue;
    }

    const priceRaw = cell(row, iPrice).replace(',', '.');
    const price = parseFloat(priceRaw);
    if (!isFinite(price) || price < 0) {
      ignored.push({ line: r + 1, name, reason: priceRaw ? `Prix invalide (« ${priceRaw} »)` : 'Prix manquant' });
      continue;
    }

    const costRaw = cell(row, iCost).replace(',', '.');
    const cost = parseFloat(costRaw);

    seenNames.add(nameKey);
    items.push({
      name,
      category: cell(row, iCategory) || (handle ? groupCategory.get(handle) : '') || null,
      price,
      costPrice: isFinite(cost) && cost > 0 ? cost : null,
      saleUnit: cell(row, iWeight).toUpperCase() === 'Y' ? 'weight' : 'unit',
      isAvailable: iAvailable >= 0 ? cell(row, iAvailable).toUpperCase() !== 'N' : true,
    });
  }

  return { items, ignored };
}
