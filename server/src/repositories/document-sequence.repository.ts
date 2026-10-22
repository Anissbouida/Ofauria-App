import { db } from '../config/database.js';
import { auditedQuery } from '../utils/audit-context.js';

export const DOCUMENT_PATTERN_TOKENS = ['{YYYY}', '{YY}', '{MM}', '{DD}', '{SEQ}'] as const;
export type ResetPeriod = 'never' | 'year' | 'month' | 'day';

/**
 * Contrôle applicatif du modèle, avant les contraintes CHECK de la mig 329,
 * pour renvoyer un message clair. Retourne null si le modèle est valide.
 */
export function validatePattern(pattern: string, padding: number, reset: ResetPeriod): string | null {
  if (!pattern || pattern.length > 60) return 'Modèle requis (60 caractères maximum).';
  if (!/^[A-Za-z0-9{}/._ -]+$/.test(pattern)) return 'Caractères autorisés : lettres, chiffres, - _ / . espace et les jetons.';
  const unknown = (pattern.match(/\{[^}]*\}/g) ?? []).filter(t => !(DOCUMENT_PATTERN_TOKENS as readonly string[]).includes(t));
  if (unknown.length) return `Jeton inconnu : ${unknown[0]}. Jetons : ${DOCUMENT_PATTERN_TOKENS.join(' ')}.`;
  if ((pattern.match(/\{SEQ\}/g) ?? []).length !== 1) return 'Le modèle doit contenir {SEQ} une seule fois.';
  if (!Number.isInteger(padding) || padding < 1 || padding > 10) return 'Nombre de chiffres : entre 1 et 10.';
  const hasYear = pattern.includes('{YYYY}') || pattern.includes('{YY}');
  if (reset === 'year' && !hasYear) return 'Une remise à zéro annuelle exige {YYYY} ou {YY} dans le modèle.';
  if (reset === 'month' && !(hasYear && pattern.includes('{MM}'))) return 'Une remise à zéro mensuelle exige l\'année et {MM}.';
  if (reset === 'day' && !(hasYear && pattern.includes('{MM}') && pattern.includes('{DD}'))) return 'Une remise à zéro quotidienne exige l\'année, {MM} et {DD}.';
  return null;
}

export const documentSequenceRepository = {
  /** Séries avec le prochain numéro (sans le consommer) et le dernier attribué. */
  async list() {
    const r = await db.query(
      `SELECT s.doc_type, s.label, s.module, s.pattern, s.padding, s.reset_period, s.gapless,
              s.updated_at, concat_ws(' ', u.first_name, u.last_name) AS updated_by_name,
              preview_document_number(s.doc_type) AS next_number,
              (SELECT max(c.updated_at) FROM document_sequence_counters c WHERE c.doc_type = s.doc_type) AS last_used_at
         FROM document_sequences s
         LEFT JOIN users u ON u.id = s.updated_by
        ORDER BY s.display_order, s.doc_type`,
    );
    return r.rows;
  },

  async exists(docType: string) {
    const r = await db.query(`SELECT 1 FROM document_sequences WHERE doc_type = $1`, [docType]);
    return r.rows.length > 0;
  },

  async update(docType: string, data: { pattern: string; padding: number; resetPeriod: ResetPeriod }, actorId?: string) {
    const r = await auditedQuery(actorId,
      `UPDATE document_sequences
          SET pattern = $2, padding = $3, reset_period = $4, updated_by = $5, updated_at = now()
        WHERE doc_type = $1
        RETURNING doc_type`,
      [docType, data.pattern, data.padding, data.resetPeriod, actorId ?? null],
    );
    if (!r.rows[0]) return null;
    // Requete distincte : dans l'UPDATE, la fonction verrait encore l'ancien modele.
    const p = await db.query(`SELECT preview_document_number($1) AS next_number`, [docType]);
    return { doc_type: docType, next_number: p.rows[0].next_number as string };
  },

  /** Aperçu d'un modèle non enregistré (numéro 1 de la période courante). */
  async sample(pattern: string, padding: number) {
    const r = await db.query(
      `SELECT replace(render_document_pattern($1, (now() AT TIME ZONE 'Africa/Casablanca')::date), '{SEQ}', lpad('1', $2, '0')) AS sample`,
      [pattern, padding],
    );
    return String(r.rows[0].sample);
  },
};
