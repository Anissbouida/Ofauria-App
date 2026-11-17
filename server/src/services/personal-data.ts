import { db } from '../config/database.js';

/**
 * Droit d'accès de la loi 09-08 (G3-11) : export des données d'une personne.
 *
 * Étend aux salariés et aux fournisseurs l'export qui existait pour les clients (mig 478).
 * Les tables à exporter sont lues dans le catalogue de la base : toute table qui porte
 * une clé étrangère vers `employees` (ou `suppliers`) est incluse, avec ses lignes pour
 * cette personne. Une table ajoutée plus tard est donc couverte sans toucher à ce code.
 *
 * Ce qui n'est PAS exporté :
 *   - les contenus binaires (pièces jointes du dossier du salarié) : remplacés par leur
 *     taille ; le fichier lui-même se télécharge depuis la fiche ;
 *   - les secrets du compte utilisateur (empreinte du mot de passe, code PIN, jetons).
 *
 * L'export ne modifie rien. Chaque export est tracé dans le journal des connexions
 * (auth_events, type `personal_data_export`).
 */
export type PersonKind = 'employee' | 'supplier';

const OWNER: Record<PersonKind, { table: string; label: string }> = {
  employee: { table: 'employees', label: 'Salarié' },
  supplier: { table: 'suppliers', label: 'Fournisseur' },
};
/** Au-delà, les lignes d'une table sont tronquées (l'export le signale). */
const MAX_ROWS = 10_000;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

type Ref = { table: string; column: string };
export type PersonExport = {
  exportedAt: string;
  kind: PersonKind;
  kindLabel: string;
  record: Record<string, unknown>;
  account?: Record<string, unknown> | null;
  connections?: Record<string, unknown>[];
  related: { table: string; column: string; count: number; truncated: boolean; rows: Record<string, unknown>[] }[];
};

async function references(table: string): Promise<Ref[]> {
  return (await db.query(
    `SELECT c.conrelid::regclass::text AS "table", a.attname AS "column"
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND c.conrelid <> $1::regclass
      ORDER BY 1, 2`, [table])).rows as Ref[];
}

/** Liste de colonnes d'une table, les colonnes binaires remplacées par leur taille en octets. */
async function selectList(table: string): Promise<string> {
  const cols = (await db.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table])).rows;
  return cols.map(c => (c.data_type === 'bytea'
    ? `octet_length(${ident(c.column_name)}) AS ${ident(`${c.column_name}_octets`)}`
    : ident(c.column_name))).join(', ');
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  return (await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, [table, column])).rows.length > 0;
}

export async function exportPersonalData(kind: PersonKind, id: string, actor?: { userId?: string | null }): Promise<PersonExport | null> {
  const owner = OWNER[kind];
  const record = (await db.query(`SELECT ${await selectList(owner.table)} FROM ${ident(owner.table)} WHERE id = $1`, [id])).rows[0];
  if (!record) return null;

  const related: PersonExport['related'] = [];
  for (const ref of await references(owner.table)) {
    const order = (await hasColumn(ref.table, 'created_at')) ? ' ORDER BY created_at' : '';
    const count = Number((await db.query(
      `SELECT COUNT(*) AS n FROM ${ident(ref.table)} WHERE ${ident(ref.column)} = $1`, [id])).rows[0].n);
    if (count === 0) continue;
    const rows = (await db.query(
      `SELECT ${await selectList(ref.table)} FROM ${ident(ref.table)} WHERE ${ident(ref.column)} = $1${order} LIMIT ${MAX_ROWS}`, [id])).rows;
    related.push({ table: ref.table, column: ref.column, count, truncated: count > MAX_ROWS, rows });
  }

  const out: PersonExport = { exportedAt: new Date().toISOString(), kind, kindLabel: owner.label, record, related };

  // Salarié : son compte utilisateur (sans secrets) et ses 500 dernières connexions.
  if (kind === 'employee' && record.user_id) {
    out.account = (await db.query(
      `SELECT id, email, first_name, last_name, role, is_active, store_id, created_at, updated_at, failed_login_count, locked_until, must_change_password
         FROM users WHERE id = $1`, [record.user_id])).rows[0] ?? null;
    out.connections = (await db.query(
      `SELECT event_type, ip, user_agent, success, created_at FROM auth_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [record.user_id])).rows;
  }

  // Trace de l'export : qui a exporté les données de qui, et quand.
  await db.query(
    `INSERT INTO auth_events (event_type, user_id, success, details) VALUES ('personal_data_export', $1, true, $2::jsonb)`,
    [actor?.userId ?? null, JSON.stringify({ kind, id, tables: related.length })]).catch(() => undefined);

  return out;
}

/**
 * Registre des traitements (G3-11, étape 3) : ce que l'application traite comme données
 * personnelles, pourquoi, et ce qu'elle permet d'exercer comme droits. Les durées de
 * conservation et la base légale restent à fixer par le responsable du traitement avec
 * son conseil (déclarations à la CNDP) : elles ne sont pas codées en dur.
 */
export const PROCESSING_REGISTER = [
  {
    key: 'customers', label: 'Clients', purpose: 'Ventes, commandes, facturation, recouvrement, fidélité et prospection (avec consentement).',
    data: 'Identité, coordonnées, adresses, identifiants fiscaux (professionnels), allergies déclarées, historique d\'achat, consentement marketing.',
    recipients: 'Personnel de vente et de direction ; comptable.',
    rights: { access: true, erasure: true, note: 'Export et anonymisation depuis la fiche client (la comptabilité est conservée).' },
  },
  {
    key: 'employees', label: 'Salariés', purpose: 'Gestion du personnel : contrats, plannings, pointage, congés, paie, déclarations sociales.',
    data: 'Identité, CIN, coordonnées, situation familiale, RIB, salaire, contrats, pointages, absences, bulletins, documents du dossier.',
    recipients: 'Direction et responsables RH ; CNSS et administration fiscale (déclarations) ; banque (virements).',
    rights: { access: true, erasure: false, note: 'Export depuis la fiche du salarié. Pas d\'effacement à la demande : bulletins et déclarations restent nominatifs pendant leur durée légale de conservation, à fixer.' },
  },
  {
    key: 'suppliers', label: 'Fournisseurs', purpose: 'Achats, réceptions, factures fournisseurs, règlements.',
    data: 'Raison sociale ou identité (personne physique), contact, coordonnées, identifiants fiscaux, RIB, historique d\'achat.',
    recipients: 'Personnel des achats, direction, comptable ; banque (règlements).',
    rights: { access: true, erasure: false, note: 'Export depuis la fiche du fournisseur. Pièces comptables conservées pendant leur durée légale.' },
  },
  {
    key: 'users', label: 'Comptes utilisateurs', purpose: 'Accès à l\'application, droits, traçabilité des actions.',
    data: 'Nom, e-mail, rôle, journal des connexions (adresse IP, navigateur), auteur des modifications.',
    recipients: 'Administrateurs de l\'application.',
    rights: { access: true, erasure: false, note: 'Inclus dans l\'export du salarié rattaché au compte.' },
  },
] as const;
