import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { parseCaisseWorkbook, type ParsedCaisse } from '../services/caisse-excel-parser.service.js';

const GENERIC_PERSONNEL_SUPPLIER_NAME = 'Personnel – Avances caisse';

// IDs connus depuis les seeds (migrations 019+)
const CAT_MATIERES_PREMIERES = '10000000-0000-0000-0000-000000000003';
const CAT_SALAIRES = '20000000-0000-0000-0000-000000000006';
const CAT_AVANCES_SALAIRE = '30000000-0000-0000-0000-000000000023';

function pickCategoryId(designation: string): string {
  const d = designation.toUpperCase();
  if (/\bSALAIRE/.test(d)) return CAT_SALAIRES;
  if (/\bAVANCE/.test(d)) return CAT_AVANCES_SALAIRE;
  return CAT_MATIERES_PREMIERES;
}

interface SupplierResolutionPlan {
  existing: Map<string, string>;   // key (uppercase) → id (déjà en DB)
  toCreate: { key: string; name: string; kind: 'real' | 'personnel' }[];
}

async function resolveSuppliers(parsed: ParsedCaisse): Promise<SupplierResolutionPlan> {
  const existing = new Map<string, string>();
  const toCreate: SupplierResolutionPlan['toCreate'] = [];

  // Collecte les clés uniques : vraies enseignes + un générique pour tout le personnel
  const realKeys = new Set<string>();
  let hasPersonnel = false;
  for (const op of parsed.operations) {
    if (op.supplierKind === 'real') realKeys.add(op.supplierKey);
    else hasPersonnel = true;
  }

  // Lookup existants
  const allSuppliers = await db.query('SELECT id, name FROM suppliers');
  const byUpperName = new Map<string, string>();
  for (const s of allSuppliers.rows) {
    byUpperName.set(String(s.name).trim().toUpperCase(), s.id);
  }

  // Supplier générique personnel
  if (hasPersonnel) {
    const id = byUpperName.get(GENERIC_PERSONNEL_SUPPLIER_NAME.toUpperCase());
    if (id) existing.set('__PERSONNEL__', id);
    else toCreate.push({ key: '__PERSONNEL__', name: GENERIC_PERSONNEL_SUPPLIER_NAME, kind: 'personnel' });
  }

  // Vrais fournisseurs
  for (const key of realKeys) {
    const id = byUpperName.get(key);
    if (id) existing.set(key, id);
    else toCreate.push({ key, name: key, kind: 'real' });
  }

  return { existing, toCreate };
}

export const caisseImportController = {
  async preview(req: AuthRequest, res: Response) {
    if (!req.file) { res.status(400).json({ success: false, error: { message: 'Aucun fichier envoyé' } }); return; }
    try {
      const parsed = parseCaisseWorkbook(req.file.buffer);
      const suppliers = await resolveSuppliers(parsed);

      const totalExpenses = parsed.operations.filter(o => o.type === 'expense').reduce((s, o) => s + o.amount, 0);
      const totalIncomeOps = parsed.operations.filter(o => o.type === 'income').reduce((s, o) => s + o.amount, 0);
      const totalRecettesCash = parsed.recettes.filter(r => r.paymentMethod === 'cash').reduce((s, r) => s + r.amount, 0);
      const totalRecettesCard = parsed.recettes.filter(r => r.paymentMethod === 'card').reduce((s, r) => s + r.amount, 0);

      // Check combien de lignes sont déjà importées
      const existingRows = await db.query(
        `SELECT COUNT(*)::int AS cnt FROM payments WHERE import_source = $1`,
        [parsed.meta.importSource]
      );
      const alreadyImported = existingRows.rows[0].cnt as number;

      // Échantillon (50 premières opérations) pour affichage
      const sample = parsed.operations.slice(0, 50).map(o => ({
        sourceRow: o.sourceRow,
        date: o.date,
        supplier: o.rawSupplier,
        supplierKind: o.supplierKind,
        designation: o.designation,
        type: o.type,
        amount: o.amount,
      }));

      res.json({
        success: true,
        data: {
          meta: parsed.meta,
          summary: {
            nbOperations: parsed.operations.length,
            nbRecettes: parsed.recettes.length,
            totalExpenses,
            totalIncomeOps,
            totalRecettesCash,
            totalRecettesCard,
          },
          suppliers: {
            existingCount: suppliers.existing.size,
            toCreate: suppliers.toCreate,
          },
          alreadyImported,
          warnings: parsed.warnings,
          sample,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur de parsing';
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },

  async commit(req: AuthRequest, res: Response) {
    if (!req.file) { res.status(400).json({ success: false, error: { message: 'Aucun fichier envoyé' } }); return; }
    const client = await db.getClient();
    try {
      const parsed = parseCaisseWorkbook(req.file.buffer);
      await client.query('BEGIN');

      // 1. Créer les fournisseurs manquants
      const suppliers = await resolveSuppliers(parsed);
      const supplierIdByKey = new Map<string, string>(suppliers.existing);
      for (const sup of suppliers.toCreate) {
        const inserted = await client.query(
          `INSERT INTO suppliers (name, notes) VALUES ($1, $2) RETURNING id`,
          [sup.name, sup.kind === 'personnel' ? 'Supplier générique pour les avances/achats effectués par le personnel' : null]
        );
        supplierIdByKey.set(sup.key, inserted.rows[0].id);
      }

      const createdBy = req.user!.userId;
      const storeId = req.user!.storeId ?? null;
      const importSource = parsed.meta.importSource;

      let created = 0;
      let skipped = 0;
      const errors: { row: number; message: string }[] = [];

      // 2. Insérer les opérations
      for (const op of parsed.operations) {
        const supplierId = op.supplierKind === 'real'
          ? supplierIdByKey.get(op.supplierKey)
          : supplierIdByKey.get('__PERSONNEL__');
        if (!supplierId) {
          errors.push({ row: op.sourceRow, message: `Supplier introuvable pour ${op.rawSupplier}` });
          continue;
        }

        const categoryId = op.type === 'expense' ? pickCategoryId(op.designation) : null;
        const description = op.supplierKind === 'personnel'
          ? `[${op.rawSupplier}] ${op.designation || '(sans désignation)'}`
          : op.designation || null;

        const result = await client.query(
          `INSERT INTO payments (
             type, category_id, supplier_id, amount, payment_method, payment_date,
             description, created_by, store_id, import_source, import_source_row
           ) VALUES ($1,$2,$3,$4,'cash',$5,$6,$7,$8,$9,$10)
           ON CONFLICT (import_source, import_source_row) WHERE import_source IS NOT NULL
           DO NOTHING
           RETURNING id`,
          [op.type === 'expense' ? 'expense' : 'income',
           categoryId, supplierId, op.amount, op.date,
           description, createdBy, storeId, importSource, op.sourceRow]
        );
        if (result.rowCount && result.rowCount > 0) created++;
        else skipped++;
      }

      // 3. Insérer les recettes (type=income). La table payments n'accepte pas 'card',
      //    on mappe carte bancaire → 'bank' (rangé côté encaissement bancaire).
      for (const rec of parsed.recettes) {
        const description = rec.paymentMethod === 'cash'
          ? 'Recette journalière — Espèces'
          : 'Recette journalière — Carte bancaire';
        const paymentMethod = rec.paymentMethod === 'cash' ? 'cash' : 'bank';

        const result = await client.query(
          `INSERT INTO payments (
             type, amount, payment_method, payment_date,
             description, created_by, store_id, import_source, import_source_row
           ) VALUES ('income',$1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (import_source, import_source_row) WHERE import_source IS NOT NULL
           DO NOTHING
           RETURNING id`,
          [rec.amount, paymentMethod, rec.date,
           description, createdBy, storeId, importSource, rec.sourceRow]
        );
        if (result.rowCount && result.rowCount > 0) created++;
        else skipped++;
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        data: {
          meta: parsed.meta,
          created,
          skipped,
          errors,
          newSuppliers: suppliers.toCreate.map(s => s.name),
          warnings: parsed.warnings,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : 'Erreur lors de l\'import';
      res.status(500).json({ success: false, error: { message: msg } });
    } finally {
      client.release();
    }
  },
};
