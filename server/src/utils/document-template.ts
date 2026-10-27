import { db } from '../config/database.js';
import { loadCompanyLegal, type CompanyLegal } from './company-legal.js';

/**
 * Mise en page commune des pièces envoyées aux tiers (audit Paramètres, lot 6,
 * mig 332) : pied de page légal tiré de la fiche société, compte bancaire par
 * défaut, conditions de paiement, mention des pénalités de retard et note de
 * pied de page, réglables dans Paramètres › Documents.
 */

export type DocumentType = 'invoice' | 'purchase_order' | 'quote';

export interface DocumentTemplate {
  legal: CompanyLegal;
  bank: { bankName: string; rib: string } | null;
  paymentTerms: string | null;
  latePenalty: string | null;
  footerNote: string | null;
  showBank: boolean;
  showLegalForm: boolean;
}

const LEGAL_FORM_LABELS: Record<string, string> = {
  'SARL AU': 'SARL à associé unique', EI: 'Entreprise individuelle', AUTO_ENTREPRENEUR: 'Auto-entrepreneur',
  COOPERATIVE: 'Coopérative', AUTRE: '',
};

/** RIB par blocs : banque (3), localité (3), compte (16), clé (2). */
export const formatRib = (rib: string) => `${rib.slice(0, 3)} ${rib.slice(3, 6)} ${rib.slice(6, 22)} ${rib.slice(22)}`;

async function tableExists(name: string): Promise<boolean> {
  return (await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`])).rows[0].ok as boolean;
}

/** Modèle d'un type de pièce ; valeurs neutres si les migrations 331/332 ne sont pas passées. */
export async function loadDocumentTemplate(docType: DocumentType): Promise<DocumentTemplate> {
  const legal = await loadCompanyLegal();
  let tpl: Record<string, unknown> | undefined;
  if (await tableExists('document_templates')) {
    tpl = (await db.query(`SELECT * FROM document_templates WHERE doc_type = $1`, [docType])).rows[0];
  }
  let bank: DocumentTemplate['bank'] = null;
  if (await tableExists('company_bank_accounts')) {
    const b = (await db.query(
      `SELECT bank_name, rib FROM company_bank_accounts
        WHERE is_active AND show_on_invoices ORDER BY is_default DESC, created_at LIMIT 1`)).rows[0];
    if (b) bank = { bankName: b.bank_name, rib: b.rib };
  }
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    legal,
    bank,
    paymentTerms: text(tpl?.payment_terms),
    latePenalty: text(tpl?.late_penalty),
    footerNote: text(tpl?.footer_note),
    showBank: tpl ? tpl.show_bank !== false : docType === 'invoice',
    showLegalForm: tpl ? tpl.show_legal_form !== false : true,
  };
}

/**
 * Lignes du pied de page légal, communes à toutes les pièces :
 *   1. raison sociale, forme juridique et capital, siège ;
 *   2. téléphone, e-mail, site ;
 *   3. RC, patente, IF, ICE.
 */
export function legalFooterLines(t: Pick<DocumentTemplate, 'legal' | 'showLegalForm'>): string[] {
  const l = t.legal;
  let company = l.name;
  if (t.showLegalForm && l.legalForm) {
    const form = LEGAL_FORM_LABELS[l.legalForm] ?? l.legalForm;
    const capital = l.capital
      ? `au capital de ${l.capital.toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')} DH`
      : '';
    // Forme déjà dans la raison sociale (« … SARL ») : on ne la répète pas.
    const formInName = !!form && l.name.toUpperCase().split(/[^A-Z0-9]+/).includes(form.toUpperCase());
    company = formInName
      ? [company, capital].filter(Boolean).join(' ')
      : [company, [form, capital].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }
  const line1 = [company, l.address && `Siège social : ${[l.address, l.city].filter(Boolean).join(', ')}`];
  const line2 = [l.phone && `Tél : ${l.phone}`, l.email && `E-mail : ${l.email}`, l.website && l.website];
  const line3 = [l.rc && `RC : ${l.rc}`, l.patente && `Patente : ${l.patente}`, l.if && `IF : ${l.if}`, l.ice && `ICE : ${l.ice}`];
  return [line1, line2, line3]
    .map(parts => parts.filter((x): x is string => !!x).join(' | '))
    .filter(Boolean);
}
