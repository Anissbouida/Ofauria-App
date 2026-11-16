/**
 * Utilisateur technique « Système » (mig 530, G0-28) : auteur des documents créés par
 * les tâches planifiées. Compte inactif, sans connexion possible.
 */
import { db } from '../config/database.js';

let cached: string | null = null;

export async function systemUserId(): Promise<string> {
  if (cached) return cached;
  const r = await db.query(`SELECT id FROM users WHERE is_system LIMIT 1`);
  if (!r.rows[0]) throw new Error('Utilisateur technique « Système » absent : la migration 530 n\'est pas appliquée');
  cached = r.rows[0].id as string;
  return cached;
}
