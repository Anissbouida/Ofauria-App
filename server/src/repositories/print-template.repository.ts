import { db } from '../config/database.js';
import {
  PRODUCTION_PRINT_DOCS, PRODUCTION_PRINT_DOC_TYPES, defaultPrintTemplate,
  type ProductionPrintDoc, type ResolvedPrintTemplate,
} from '@ofauria/shared';

/**
 * Gabarits d'impression du module de fabrication (M8-04, mig 582).
 * Résolution : défaut du code ← modèle général (document_templates, category 'production')
 * ← variante du type d'ordre (document_template_variants). Chaque champ NULL ou absent
 * est hérité du niveau précédent.
 */
type Layout = { columns?: string[]; signatures?: string[] };
interface Level { title: string | null; layout: Layout; footer_note: string | null }

export const isPrintDoc = (d: string): d is ProductionPrintDoc => (PRODUCTION_PRINT_DOC_TYPES as string[]).includes(d);

/** Fusion pure des niveaux (testée sans base). */
export function mergePrintTemplate(docType: ProductionPrintDoc, base?: Level | null, variant?: Level | null): ResolvedPrintTemplate {
  const t = defaultPrintTemplate(docType);
  const known = PRODUCTION_PRINT_DOCS[docType].columns.map(c => c.key);
  for (const [lvl, source] of [[base, 'base'], [variant, 'variant']] as const) {
    if (!lvl) continue;
    let touched = false;
    if (lvl.title?.trim()) { t.title = lvl.title.trim(); touched = true; }
    if (Array.isArray(lvl.layout?.columns)) {
      // Ordre du catalogue conservé ; clés inconnues ignorées (catalogue modifié depuis).
      const want = new Set(lvl.layout.columns);
      t.columns = known.filter(k => want.has(k)); touched = true;
    }
    if (Array.isArray(lvl.layout?.signatures)) {
      t.signatures = lvl.layout.signatures.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()); touched = true;
    }
    if (lvl.footer_note !== null && lvl.footer_note !== undefined) { t.footer = lvl.footer_note.trim() || null; touched = true; }
    if (touched) t.source = source;
  }
  return t;
}

/** Colonnes hors catalogue ou signatures sur un document qui n'en a pas → message, sinon null. */
export function checkLayout(docType: ProductionPrintDoc, layout: Layout): string | null {
  const def = PRODUCTION_PRINT_DOCS[docType];
  const known = new Set(def.columns.map(c => c.key));
  const bad = (layout.columns ?? []).filter(k => !known.has(k));
  if (bad.length) return `Colonne(s) inconnue(s) pour ${def.label} : ${bad.join(', ')}`;
  if (layout.signatures?.length && !def.hasSignatures) return `${def.label} : pas de signatures sur ce document`;
  return null;
}

export interface PrintTemplateInput { title?: string | null; columns?: string[] | null; signatures?: string[] | null; footer?: string | null }

/** null = revenir à l'héritage pour cette clé ; undefined = ne pas toucher. */
function layoutOf(cur: Layout, input: PrintTemplateInput): Layout {
  const next: Layout = { ...cur };
  for (const k of ['columns', 'signatures'] as const) {
    if (input[k] === null) delete next[k];
    else if (input[k] !== undefined) next[k] = input[k]!;
  }
  return next;
}

export const printTemplateRepository = {
  /** Gabarits résolus de tous les documents, pour un type d'ordre (ou le modèle général). */
  async resolveAll(orderTypeId?: string | null): Promise<Record<ProductionPrintDoc, ResolvedPrintTemplate>> {
    const base = await db.query(
      `SELECT doc_type, title, layout, footer_note FROM document_templates WHERE category = 'production'`);
    const variants = orderTypeId
      ? (await db.query(
          `SELECT doc_type, title, layout, footer_note FROM document_template_variants WHERE order_type_id = $1::uuid`,
          [orderTypeId])).rows
      : [];
    const by = (rows: any[]) => new Map(rows.map(r => [r.doc_type as string, r as Level]));
    const b = by(base.rows), v = by(variants);
    return Object.fromEntries(PRODUCTION_PRINT_DOC_TYPES.map(d => [d, mergePrintTemplate(d, b.get(d), v.get(d))])) as
      Record<ProductionPrintDoc, ResolvedPrintTemplate>;
  },

  async resolve(docType: ProductionPrintDoc, orderTypeId?: string | null): Promise<ResolvedPrintTemplate> {
    return (await this.resolveAll(orderTypeId))[docType];
  },

  /** Écran de paramétrage : modèles généraux et variantes enregistrées. */
  async listForSettings() {
    const base = await db.query(
      `SELECT d.doc_type, d.label, d.title, d.layout, d.footer_note, d.updated_at,
              concat_ws(' ', u.first_name, u.last_name) AS updated_by_name
         FROM document_templates d LEFT JOIN users u ON u.id = d.updated_by
        WHERE d.category = 'production' ORDER BY d.display_order`);
    const variants = await db.query(
      `SELECT v.doc_type, v.order_type_id, t.label AS order_type_label, v.title, v.layout, v.footer_note, v.updated_at
         FROM document_template_variants v JOIN production_order_types t ON t.id = v.order_type_id
        ORDER BY t.display_order, t.label`);
    return { base: base.rows, variants: variants.rows };
  },

  async updateBase(docType: ProductionPrintDoc, input: PrintTemplateInput, userId: string) {
    const cur = await db.query(
      `SELECT layout FROM document_templates WHERE doc_type = $1::text AND category = 'production'`, [docType]);
    if (!cur.rows[0]) return null;
    const layout = layoutOf(cur.rows[0].layout ?? {}, input);
    const r = await db.query(
      `UPDATE document_templates
          SET title = CASE WHEN $2::boolean THEN $3::text ELSE title END,
              footer_note = CASE WHEN $4::boolean THEN $5::text ELSE footer_note END,
              layout = $6::jsonb, updated_by = $7::uuid, updated_at = now()
        WHERE doc_type = $1::text RETURNING doc_type, title, layout, footer_note`,
      [docType, input.title !== undefined, input.title?.trim() || null, input.footer !== undefined, input.footer ?? null,
       JSON.stringify(layout), userId]);
    return r.rows[0];
  },

  async upsertVariant(docType: ProductionPrintDoc, orderTypeId: string, input: PrintTemplateInput, userId: string) {
    const cur = await db.query(
      `SELECT layout FROM document_template_variants WHERE doc_type = $1::text AND order_type_id = $2::uuid`,
      [docType, orderTypeId]);
    const layout = layoutOf(cur.rows[0]?.layout ?? {}, input);
    const r = await db.query(
      `INSERT INTO document_template_variants (doc_type, order_type_id, title, layout, footer_note, updated_by)
       VALUES ($1::text, $2::uuid, $3::text, $4::jsonb, $5::text, $6::uuid)
       ON CONFLICT (doc_type, order_type_id) DO UPDATE SET
         title = CASE WHEN $7::boolean THEN EXCLUDED.title ELSE document_template_variants.title END,
         footer_note = CASE WHEN $8::boolean THEN EXCLUDED.footer_note ELSE document_template_variants.footer_note END,
         layout = EXCLUDED.layout, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING doc_type, order_type_id, title, layout, footer_note`,
      [docType, orderTypeId, input.title?.trim() || null, JSON.stringify(layout), input.footer ?? null, userId,
       input.title !== undefined, input.footer !== undefined]);
    return r.rows[0];
  },

  async deleteVariant(docType: ProductionPrintDoc, orderTypeId: string): Promise<boolean> {
    const r = await db.query(
      `DELETE FROM document_template_variants WHERE doc_type = $1::text AND order_type_id = $2::uuid RETURNING 1`,
      [docType, orderTypeId]);
    return r.rows.length > 0;
  },
};
