import { db } from '../config/database.js';
import { invoiceRepository } from '../repositories/accounting.repository.js';
import { settingsRepository } from '../repositories/settings.repository.js';
import { loadCompanyLegal } from '../utils/company-legal.js';
import { generateInvoicePdf } from './invoice-pdf.service.js';

/**
 * Phase 10.3 — construction du PDF d'une facture à partir de son identifiant.
 *
 * Source unique : le téléchargement interne (accounting.controller) ET le
 * portail client passent par ici, pour que le PDF soit strictement le même des
 * deux côtés. Renvoie null si la facture n'existe pas. La logique (lignes,
 * mentions, logo, devise, ventilation TVA) est reprise telle quelle de l'ancien
 * handler de téléchargement.
 */
export async function invoicePdfById(
  invoiceId: string,
  opts: { locale?: 'fr' | 'ar' } = {},
): Promise<{ buffer: Buffer; filename: string } | null> {
  const invoice = await invoiceRepository.findById(invoiceId);
  if (!invoice) return null;

  const itemsResult = await db.query(
    `SELECT COALESCE(NULLIF(ii.description, ''), p.name, p2.name, '') AS description,
            ii.quantity, ii.unit_price, ii.subtotal, ii.tva_rate, ii.tva_amount,
            COALESCE(cat.name, cat2.name, '') AS category_name
     FROM invoice_items ii
     LEFT JOIN products p ON p.id = ii.product_id
     LEFT JOIN categories cat ON cat.id = p.category_id
     LEFT JOIN products p2 ON p2.name = ii.description AND ii.product_id IS NULL
     LEFT JOIN categories cat2 ON cat2.id = p2.category_id
     WHERE ii.invoice_id = $1 ORDER BY ii.id`,
    [invoiceId],
  );

  let items = itemsResult.rows;
  if (items.length === 0) {
    items = [{
      description: (invoice as Record<string, unknown>).notes || 'Prestation',
      quantity: 1,
      unit_price: parseFloat((invoice as Record<string, unknown>).amount as string) || 0,
      subtotal: parseFloat((invoice as Record<string, unknown>).total_amount as string) || 0,
      category_name: '',
    }];
  }

  const settings = await settingsRepository.get();

  let customerName = 'Client';
  let customerAddress = '';
  let customerICE = '';
  const inv = invoice as Record<string, unknown>;
  const isMoral = ['professionnel', 'association', 'revendeur'].includes(inv.customer_type as string);
  if (isMoral && inv.customer_company_name) {
    customerName = inv.customer_company_name as string;
  } else if (inv.customer_first_name || inv.customer_last_name) {
    customerName = `${inv.customer_first_name || ''} ${inv.customer_last_name || ''}`.trim();
  } else if (inv.supplier_name) {
    customerName = inv.supplier_name as string;
  }
  const addrParts: string[] = [];
  if (inv.customer_address) addrParts.push(inv.customer_address as string);
  if (inv.customer_city) addrParts.push(inv.customer_city as string);
  if (addrParts.length === 0 && inv.supplier_address) {
    addrParts.push(inv.supplier_address as string);
    if (inv.supplier_city) addrParts.push(inv.supplier_city as string);
  }
  customerAddress = addrParts.join(', ');
  customerICE = (inv.customer_ice as string) || (inv.customer_if as string) || (inv.supplier_ice as string) || '';

  const totalAmount = parseFloat(inv.total_amount as string) || 0;
  let amount = parseFloat(inv.amount as string) || 0;
  let taxAmount = parseFloat(inv.tax_amount as string) || 0;
  let tvaRate = 20;
  if (amount <= 0 && totalAmount > 0) {
    amount = Math.round((totalAmount / (1 + tvaRate / 100)) * 100) / 100;
    taxAmount = Math.round((totalAmount - amount) * 100) / 100;
  } else if (amount > 0 && taxAmount > 0) {
    tvaRate = Math.round((taxAmount / amount) * 100);
  } else {
    tvaRate = 0;
  }

  const invoiceDate = new Date(inv.invoice_date as string);
  const dateStr = invoiceDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  let dueDateStr = '';
  if (inv.due_date) {
    dueDateStr = new Date(inv.due_date as string).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } else {
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + 30);
    dueDateStr = dueDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  let logoPath: string | undefined;
  const pathMod = await import('path');
  const fsMod = await import('fs');
  const { fileURLToPath } = await import('url');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = pathMod.dirname(__filename);
  const projectRoot = pathMod.resolve(__dirname, '..', '..', '..');
  if (settings?.logo_url && settings.logo_url.startsWith('data:')) {
    logoPath = settings.logo_url;
  } else {
    const logoCandidates = [
      settings?.logo_url ? pathMod.join(projectRoot, 'uploads', settings.logo_url) : '',
      settings?.logo_url ? pathMod.join(projectRoot, settings.logo_url) : '',
      pathMod.join(projectRoot, 'client', 'public', 'images', 'logo-horizontal.png'),
      pathMod.join(projectRoot, 'uploads', 'logos', 'logo-1775319515435.png'),
    ].filter(Boolean);
    for (const candidate of logoCandidates) {
      if (fsMod.existsSync(candidate)) { logoPath = candidate; break; }
    }
  }

  const tvaBreakdownMap = new Map<number, number>();
  for (const it of items as Record<string, unknown>[]) {
    if (it.tva_rate === null || it.tva_rate === undefined) continue;
    const rate = parseFloat(it.tva_rate as string);
    if (!Number.isFinite(rate)) continue;
    const amt = it.tva_amount != null ? (parseFloat(it.tva_amount as string) || 0) : 0;
    tvaBreakdownMap.set(rate, (tvaBreakdownMap.get(rate) || 0) + amt);
  }
  const tvaBreakdown = [...tvaBreakdownMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, amt]) => ({ rate, amount: Math.round(amt * 100) / 100 }));

  const curCode = String(inv.currency_code ?? 'MAD').trim();
  const fxRate = curCode !== 'MAD' ? Number(inv.exchange_rate) || 1 : 1;
  const toCur = (v: number) => Math.round((v / fxRate) * 100) / 100;
  const ttcCur = curCode !== 'MAD' && inv.foreign_total_amount != null ? Number(inv.foreign_total_amount) : toCur(totalAmount);
  const htCur = toCur(amount);

  const legal = await loadCompanyLegal();
  const isCreditNote = inv.kind === 'credit_note';
  const buffer = await generateInvoicePdf({
    kind: isCreditNote ? 'credit_note' : 'invoice',
    invoiceNumber: inv.invoice_number as string,
    invoiceDate: dateStr,
    dueDate: isCreditNote ? String(inv.credited_invoice_number ?? '') : dueDateStr,
    paymentMethod: '',
    customerName,
    customerAddress,
    customerICE,
    items: (items as Record<string, unknown>[]).map((it) => ({
      description: (it.description as string) || '',
      category: (it.category_name as string) || '',
      quantity: parseFloat(it.quantity as string) || 1,
      unit_price: curCode !== 'MAD' ? Math.round(((parseFloat(it.unit_price as string) || 0) / fxRate) * 10000) / 10000 : parseFloat(it.unit_price as string) || 0,
      subtotal: toCur(parseFloat(it.subtotal as string) || 0),
    })),
    totalHT: htCur,
    tvaRate,
    totalTVA: Math.round((ttcCur - htCur) * 100) / 100,
    totalTTC: ttcCur,
    tvaBreakdown: tvaBreakdown.map(b => ({ rate: b.rate, amount: toCur(b.amount) })),
    currency: curCode !== 'MAD' ? { code: curCode, rate: fxRate, totalDh: totalAmount } : undefined,
    companyName: legal.name,
    companyAddress: legal.address,
    companyPhone: legal.phone,
    companyEmail: legal.email,
    companyRC: legal.rc,
    companyPatente: legal.patente,
    companyIF: legal.if,
    companyICE: legal.ice,
    companyCNSS: '',
    companyBankAccount: '',
    logoPath,
    locale: opts.locale === 'ar' ? 'ar' : 'fr',
  });

  const filename = `${inv.invoice_number || 'facture'}.pdf`.replace(/[/\\]/g, '-');
  return { buffer, filename };
}
