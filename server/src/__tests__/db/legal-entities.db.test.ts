/**
 * G6-03 (mig 608/609) — multi-société, phase 1.
 *
 *  - une installation existante a exactement UNE entité par défaut, miroir de company_settings ;
 *  - un établissement créé sans entité est rattaché à l'entité par défaut ;
 *  - mono-entité : l'identité lue via l'entité est identique à l'ancienne lecture de
 *    company_settings (en-têtes, pied de page légal des PDF) ;
 *  - la facture d'un établissement d'une 2ᵉ entité porte l'identité de cette entité ;
 *  - synchronisation dans les deux sens company_settings ↔ entité par défaut ;
 *  - numérotation : sans variante, next_document_number_v2 = série globale (numéros
 *    inchangés) ; avec une variante, compteur propre à l'entité.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import zlib from 'node:zlib';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';

type Legal = typeof import('../../utils/company-legal.js');
type Tpl = typeof import('../../utils/document-template.js');
type Repo = typeof import('../../repositories/legal-entity.repository.js');
type Builder = typeof import('../../services/invoice-pdf-builder.service.js');

/** Texte des flux d'un PDF pdfkit (flux décompressés), pour y chercher des chaînes. */
function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  let out = raw;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    try { out += zlib.inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1'); } catch { /* flux non compressé */ }
  }
  return out;
}
/** pdfkit écrit le texte des polices standard en hexadécimal (<3030…> Tj). */
const hex = (s: string) => Buffer.from(s, 'latin1').toString('hex');
const pdfHas = (buf: Buffer, s: string) => {
  const t = pdfText(buf).toLowerCase();
  return t.includes(hex(s).toLowerCase()) || t.includes(s.toLowerCase());
};

describe.skipIf(!hasTestDb)('G6-03 — entités juridiques (phase 1)', () => {
  const p = () => testPool();
  let legal: Legal; let tpl: Tpl; let repo: Repo; let builder: Builder;
  let storeA: string; let storeB: string; let entityB: string;
  let invA: string; let invB: string;
  const iceB = `9${String(RUN).replace(/\D/g, '').slice(-14).padStart(14, '7')}`.slice(0, 15);
  const nameB = `Filiale Test ${RUN} SARL`;
  const codeB = `T${String(RUN).replace(/\D/g, '').slice(-8).padStart(8, '0')}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    legal = await import('../../utils/company-legal.js');
    tpl = await import('../../utils/document-template.js');
    repo = await import('../../repositories/legal-entity.repository.js');
    builder = await import('../../services/invoice-pdf-builder.service.js');

    storeA = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Mag LE-A ${RUN}`])).rows[0].id;
    storeB = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Mag LE-B ${RUN}`])).rows[0].id;
    const e = await repo.legalEntityRepository.save(null, {
      code: codeB, legalName: nameB, tradeName: 'Filiale', ice: iceB, ifNumber: '99887766', rc: 'RC-B-1',
      address: '1 rue de la Filiale', city: 'Tanger', cnss: '7654321', currencyCode: 'MAD', countryCode: 'MA',
    });
    entityB = e!.id;
    await repo.legalEntityRepository.assignStore(storeB, entityB);

    const mk = async (store: string, n: string) => (await p().query(
      `INSERT INTO invoices (invoice_number, invoice_date, amount, tax_amount, total_amount, invoice_type, store_id, notes)
       VALUES ($1, CURRENT_DATE, 100, 20, 120, 'received', $2, 'Prestation test') RETURNING id`, [n, store])).rows[0].id;
    invA = await mk(storeA, `LE-A-${RUN}`.slice(0, 30));
    invB = await mk(storeB, `LE-B-${RUN}`.slice(0, 30));
  });

  afterAll(async () => {
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM invoice_items WHERE invoice_id IN ($1, $2)`, [invA, invB]).catch(() => undefined);
      await cc.query(`DELETE FROM invoices WHERE id IN ($1, $2)`, [invA, invB]).catch(() => undefined);
      await cc.query(`DELETE FROM stores WHERE id IN ($1, $2)`, [storeA, storeB]).catch(() => undefined);
      await cc.query(`DELETE FROM legal_entities WHERE id = $1`, [entityB]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    await closeTestPool();
  });

  it('une seule entité par défaut, active, miroir de company_settings', async () => {
    const r = await p().query(`SELECT count(*)::int AS n FROM legal_entities WHERE is_default`);
    expect(r.rows[0].n).toBe(1);
    const cs = (await p().query(`SELECT * FROM company_settings WHERE id = 1`)).rows[0];
    const d = (await p().query(`SELECT * FROM legal_entities WHERE is_default`)).rows[0];
    expect(d.is_active).toBe(true);
    expect(d.legal_name).toBe((cs.legal_name && String(cs.legal_name).trim()) || cs.company_name);
    expect(d.trade_name).toBe(cs.company_name);
    expect(d.ice).toBe(cs.legal_ice);
    expect(d.if_number).toBe(cs.legal_if);
    expect(d.rc).toBe(cs.legal_rc);
  });

  it('un établissement créé sans entité est rattaché à l\'entité par défaut', async () => {
    const r = await p().query(
      `SELECT s.legal_entity_id = fn_default_legal_entity() AS ok FROM stores s WHERE s.id = $1`, [storeA]);
    expect(r.rows[0].ok).toBe(true);
    const nulls = await p().query(`SELECT count(*)::int AS n FROM stores WHERE legal_entity_id IS NULL`);
    expect(nulls.rows[0].n).toBe(0);
  });

  it('mono-entité : identité et modèle de pièce identiques à la lecture de company_settings', async () => {
    const cs = (await p().query(`SELECT * FROM company_settings WHERE id = 1`)).rows[0];
    const before = legal.companyLegalFromRow(cs);   // ancienne lecture
    expect(await legal.loadCompanyLegal()).toEqual(before);
    expect(await legal.loadCompanyLegal({ storeId: storeA })).toEqual(before);
    expect(await legal.loadCompanyLegal({ storeId: null })).toEqual(before);
    expect((await tpl.loadDocumentTemplate('invoice', { storeId: storeA })).legal).toEqual(before);
    expect((await tpl.loadDocumentTemplate('invoice')).legal).toEqual(before);
    // établissement inconnu → entité par défaut
    expect(await legal.loadCompanyLegal({ storeId: '00000000-0000-0000-0000-000000000000' })).toEqual(before);
  });

  it('la facture d\'un établissement de la 2ᵉ entité porte l\'identité de cette entité', async () => {
    const lb = await legal.loadCompanyLegal({ storeId: storeB });
    expect(lb.name).toBe(nameB);
    expect(lb.ice).toBe(iceB);
    expect(lb.city).toBe('Tanger');
    const tb = await tpl.loadDocumentTemplate('invoice', { storeId: storeB });
    expect(tb.legal.ice).toBe(iceB);

    const pdfB = await builder.invoicePdfById(invB);
    const pdfA = await builder.invoicePdfById(invA);
    expect(pdfB && pdfA).toBeTruthy();
    expect(pdfHas(pdfB!.buffer, iceB)).toBe(true);
    expect(pdfHas(pdfA!.buffer, iceB)).toBe(false);
    const cs = (await p().query(`SELECT legal_ice FROM company_settings WHERE id = 1`)).rows[0];
    if (cs.legal_ice) {
      expect(pdfHas(pdfA!.buffer, cs.legal_ice)).toBe(true);
      expect(pdfHas(pdfB!.buffer, cs.legal_ice)).toBe(false);
    }
  });

  it('employeur : CNSS de l\'entité pour une 2ᵉ entité, celui de la paie pour l\'entité par défaut', async () => {
    const b = await legal.loadEmployerLegal({ storeId: storeB }, '1111111');
    expect(b.cnss).toBe('7654321');
    const a = await legal.loadEmployerLegal({ storeId: storeA }, '1111111');
    expect(a.cnss).toBe('1111111');
  });

  it('synchronisation company_settings ↔ entité par défaut (dans les deux sens)', async () => {
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE company_settings SET legal_city = 'Ville G603' WHERE id = 1`);
      expect((await c.query(`SELECT city FROM legal_entities WHERE is_default`)).rows[0].city).toBe('Ville G603');
      await c.query(`UPDATE legal_entities SET phone = '0522000603' WHERE is_default`);
      expect((await c.query(`SELECT legal_phone FROM company_settings WHERE id = 1`)).rows[0].legal_phone).toBe('0522000603');
      // une 2ᵉ entité ne touche pas company_settings
      await c.query(`UPDATE legal_entities SET city = 'Ailleurs' WHERE id = $1`, [entityB]);
      expect((await c.query(`SELECT legal_city FROM company_settings WHERE id = 1`)).rows[0].legal_city).toBe('Ville G603');
      // changement d'entité par défaut : company_settings prend l'identité de la nouvelle
      await c.query(`UPDATE legal_entities SET is_default = false WHERE is_default`);
      await c.query(`UPDATE legal_entities SET is_default = true WHERE id = $1`, [entityB]);
      expect((await c.query(`SELECT legal_ice FROM company_settings WHERE id = 1`)).rows[0].legal_ice).toBe(iceB);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('numérotation : sans variante, la série globale (numéros inchangés)', async () => {
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`SELECT fn_default_legal_entity() AS id`)).rows[0].id;
      const preview = (await c.query(`SELECT preview_document_number('quote') AS n`)).rows[0].n;
      expect((await c.query(`SELECT preview_document_number_v2('quote', NULL, $1) AS n`, [d])).rows[0].n).toBe(preview);
      expect((await c.query(`SELECT preview_document_number_v2('quote', NULL, $1) AS n`, [entityB])).rows[0].n).toBe(preview);
      const n1 = (await c.query(`SELECT next_document_number_v2('quote', NULL, $1) AS n`, [d])).rows[0].n;
      expect(n1).toBe(preview);
      const n2 = (await c.query(`SELECT next_document_number_v2('quote', NULL, NULL) AS n`)).rows[0].n;
      expect(n2).not.toBe(n1);
      expect((await c.query(`SELECT preview_document_number('quote') AS n`)).rows[0].n).not.toBe(n2);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('numérotation : variante d\'entité = compteur propre, série globale intacte', async () => {
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      const globalBefore = (await c.query(`SELECT preview_document_number('quote') AS n`)).rows[0].n;
      await c.query(
        `INSERT INTO document_sequence_entity_series (doc_type, legal_entity_id, pattern, padding, reset_period)
         VALUES ('quote', $1, $2, 4, 'year')`, [entityB, `DVX${codeB.slice(-4)}-{YYYY}-{SEQ}`]);
      const n1 = (await c.query(`SELECT next_document_number_v2('quote', NULL, $1) AS n`, [entityB])).rows[0].n;
      const n2 = (await c.query(`SELECT next_document_number_v2('quote', NULL, $1) AS n`, [entityB])).rows[0].n;
      expect(n1).toMatch(new RegExp(`^DVX${codeB.slice(-4)}-\\d{4}-0001$`));
      expect(n2).toMatch(/-0002$/);
      expect((await c.query(`SELECT preview_document_number('quote') AS n`)).rows[0].n).toBe(globalBefore);
      // même modèle que la série globale : refusé
      await c.query(`SAVEPOINT s`);
      await c.query(`UPDATE document_sequence_entity_series SET pattern = (SELECT pattern FROM document_sequences WHERE doc_type = 'quote') WHERE legal_entity_id = $1`, [entityB]);
      await expect(c.query(`SELECT next_document_number_v2('quote', NULL, $1)`, [entityB])).rejects.toThrow(/modèle différent/);
      await c.query(`ROLLBACK TO SAVEPOINT s`);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
