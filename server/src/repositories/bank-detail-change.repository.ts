/**
 * Changement de RIB d'un fournisseur sous contrôle (plan compta, étape 22, audit C-09, mig 681).
 *
 * Le RIB d'un fournisseur DÉJÀ pourvu d'un RIB ne se change plus d'un seul clic : le changement
 * devient une demande que quelqu'un d'autre approuve (moteur d'approbation, type de pièce
 * « bank_detail_change »), et le RIB courant reste en place jusque-là. Un administrateur est
 * l'approbateur final de tous les circuits : son propre changement s'applique tout de suite, tracé.
 * Le premier RIB saisi pour un fournisseur sans RIB s'applique sans approbation.
 */
import { db } from '../config/database.js';
import { approvalService } from '../services/approval.service.js';
import { getParameter } from '../services/module-parameters.service.js';
import { normalizeRib } from '../services/salary-transfer.js';

export type RibDecision =
  | { action: 'apply'; changeId: string | null }          // appliquer maintenant (avec trace)
  | { action: 'hold'; changeId: string };                  // en attente d'approbation : ne pas écrire

type Change = { rib?: string | null; bankName?: string | null };

export const bankDetailChangeRepository = {
  /**
   * Décide du sort d'une modification de RIB demandée sur la fiche d'un fournisseur.
   * Aucune écriture sur la fiche : l'appelant applique (ou pas) selon la décision.
   */
  async decideSupplierChange(supplierId: string, change: Change, userId: string): Promise<RibDecision> {
    if (change.rib === undefined) return { action: 'apply', changeId: null };
    const cur = (await db.query(`SELECT name, rib, bank_name FROM suppliers WHERE id = $1`, [supplierId])).rows[0];
    if (!cur) return { action: 'apply', changeId: null };
    const oldRib = normalizeRib(cur.rib);
    const newRib = normalizeRib(change.rib);
    if (oldRib === newRib) return { action: 'apply', changeId: null };      // RIB inchangé
    if (!oldRib) return { action: 'apply', changeId: null };                // premier RIB saisi
    if (!newRib) return { action: 'apply', changeId: null };                // RIB effacé : aucun virement ne partira

    const mode = (await getParameter<{ mode?: string }>('payment.rib_change_control'))?.mode ?? 'approval';
    if (mode === 'off') return { action: 'apply', changeId: null };

    // Une seule demande en attente par fournisseur : la nouvelle remplace l'ancienne.
    const previous = (await db.query(
      `SELECT id FROM bank_detail_changes WHERE party_kind = 'supplier' AND party_id = $1 AND status = 'pending'`, [supplierId])).rows[0];
    if (previous) {
      await db.query(
        `UPDATE bank_detail_changes SET status = 'cancelled', decided_by = $2, decided_at = now(), decision_note = 'Remplacée par une nouvelle demande' WHERE id = $1`,
        [previous.id, userId]);
      await approvalService.cancelPending('bank_detail_change', previous.id, userId, 'Remplacée par une nouvelle demande');
    }

    const changeId = (await db.query(
      `INSERT INTO bank_detail_changes (party_kind, party_id, old_rib, new_rib, old_bank_name, new_bank_name, requested_by)
       VALUES ('supplier', $1, $2, $3, $4, $5, $6) RETURNING id`,
      [supplierId, oldRib, newRib, cur.bank_name ?? null, change.bankName ?? cur.bank_name ?? null, userId])).rows[0].id as string;

    const sub = await approvalService.submit({
      docType: 'bank_detail_change', docId: changeId, docLabel: `RIB de ${cur.name}`,
      values: { party_kind: 'supplier' }, requestedBy: userId,
    });
    if (sub.outcome === 'not_required') {
      // Administrateur (approbateur final) ou règle désactivée : appliqué, avec trace de la décision.
      await db.query(
        `UPDATE bank_detail_changes SET status = 'approved', decided_by = $2, decided_at = now(), decision_note = 'Appliqué sans approbation (administrateur ou règle désactivée)' WHERE id = $1`,
        [changeId, userId]);
      return { action: 'apply', changeId };
    }
    return { action: 'hold', changeId };
  },

  /** Effet de l'approbation : le nouveau RIB devient le RIB courant du fournisseur. */
  async apply(changeId: string, approverId: string) {
    const c = (await db.query(`SELECT * FROM bank_detail_changes WHERE id = $1 AND status = 'pending'`, [changeId])).rows[0];
    if (!c) throw new Error('Demande de changement de RIB introuvable ou déjà traitée');
    await db.query(
      `UPDATE suppliers SET rib = $2, bank_name = COALESCE($3, bank_name), rib_changed_at = now(), updated_by = $4 WHERE id = $1`,
      [c.party_id, c.new_rib, c.new_bank_name, approverId]);
    await db.query(`UPDATE bank_detail_changes SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1`, [changeId, approverId]);
  },

  async reject(changeId: string, approverId: string, reason: string) {
    await db.query(
      `UPDATE bank_detail_changes SET status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3
        WHERE id = $1 AND status = 'pending'`, [changeId, approverId, reason]);
  },

  /** Demande en attente d'un fournisseur (bandeau de la fiche). */
  async pendingForSupplier(supplierId: string) {
    const r = await db.query(
      `SELECT id, new_rib, new_bank_name, requested_at FROM bank_detail_changes
        WHERE party_kind = 'supplier' AND party_id = $1 AND status = 'pending'`, [supplierId]);
    return r.rows[0] ?? null;
  },
};
