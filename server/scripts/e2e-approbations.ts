// Test de bout en bout du lot 8 Parametres (circuits d'approbation, mig 333)
// sur la base LOCALE, dans une seule transaction annulee : rien n'est ecrit,
// migration 333 comprise.
//
// Usage :
//   npm run test:e2e-approbations         (depuis la racine)
//   npx tsx scripts/e2e-approbations.ts   (depuis server/)
import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) throw new Error('Base non locale : test refuse.');

const conn = new pg.Client({ connectionString: url });
await conn.connect();
await conn.query('BEGIN');
const txid = (await conn.query('SELECT txid_current() AS t')).rows[0].t;
let sp = 0;
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
};
const tx = {
  query: (text: any, params?: any) => serial(async () => {
    const t = typeof text === 'string' ? text.trim().toUpperCase() : '';
    if (t === 'BEGIN') { sp++; return conn.query(`SAVEPOINT s${sp}`); }
    if (t === 'COMMIT') return conn.query(`RELEASE SAVEPOINT s${sp--}`);
    if (t === 'ROLLBACK') return conn.query(`ROLLBACK TO SAVEPOINT s${sp--}`);
    return conn.query(text, params);
  }),
  release: () => undefined,
};
(pg.Pool.prototype as any).query = function (text: any, params?: any) { return tx.query(text, params); };
(pg.Pool.prototype as any).connect = async function () { return tx; };

let failures = 0;
const ok = (cond: boolean, label: string, detail?: unknown) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures++;
};
const q = async (text: string, params?: unknown[]) => (await conn.query(text, params)).rows;

let server: import('node:http').Server | undefined;
try {
  if (!(await q(`SELECT to_regclass('public.approval_rules') AS t`))[0].t) {
    await conn.query(readFileSync(fileURLToPath(new URL('../migrations/350_approbations.sql', import.meta.url)), 'utf8'));
  }
  const { default: app } = await import('../src/app.js');
  const { generateToken } = await import('../src/utils/jwt.js');
  server = app.listen(0);
  // localhost plutôt que 127.0.0.1 : certains environnements n'ont que la boucle IPv6.
  const base = `http://localhost:${(server.address() as AddressInfo).port}/api/v1`;

  const STORE = '00000000-0000-0000-0000-000000000001';
  const admin = (await q(`SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY email = 'admin.test@kalum.local' DESC LIMIT 1`))[0];
  const manager = (await q(`SELECT id FROM users WHERE role = 'manager' AND is_active ORDER BY email = 'gerant.test@kalum.local' DESC LIMIT 1`))[0];
  await conn.query(`DELETE FROM user_permissions WHERE user_id = $1`, [manager.id]);
  await conn.query(`UPDATE users SET store_id = $2 WHERE id = $1`, [manager.id, STORE]);
  const cashier = (await q(
    `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, store_id)
     VALUES ('caissier.e2e@kalum.local', 'x', 'Caissière', 'E2E', 'cashier', true, $1) RETURNING id`, [STORE]))[0];
  const manager2 = (await q(
    `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, store_id)
     VALUES ('gerant2.e2e@kalum.local', 'x', 'Gérant', 'Deux', 'manager', true, $1) RETURNING id`, [STORE]))[0];
  // Les tests precedents n'ont pas de demandes : on repart d'une table vide.
  await conn.query(`DELETE FROM approval_requests`);

  const tok = async (u: { id: string }) => {
    const r = (await q(`SELECT role, token_version, store_id FROM users WHERE id = $1`, [u.id]))[0];
    return generateToken({ userId: u.id, role: r.role, tokenVersion: r.token_version ?? 0, storeId: r.store_id ?? undefined } as any);
  };
  const call = async (method: string, path: string, who: { id: string }, body?: unknown) => {
    const headers: Record<string, string> = { Origin: 'http://localhost:5173', Authorization: `Bearer ${await tok(who)}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) as any };
  };
  const err = (r: { json: any }) => r.json?.error?.message;

  console.log('1. Regles (Parametres > Approbations)');
  const rules = await call('GET', '/settings/approval-rules', admin);
  ok(rules.status === 200 && rules.json.data.map((r: any) => r.code).sort().join(',') === 'inventory_gap,invoice_cancel,po_over_threshold', '3 regles livrees', rules.json?.data?.map((r: any) => r.code));
  ok(rules.json.data.find((r: any) => r.code === 'inventory_gap').steps.map((s: any) => s.approver_role).join('>') === 'manager>admin', 'ecart d\'inventaire : gerant puis admin');
  // Depuis la gouvernance des droits (mig 330/335), le rôle Gérant porte par
  // défaut le droit « Paramètres » (toutes sections) : on vérifie donc le refus
  // avec un rôle qui n'a aucun droit Paramètres (la caissière).
  ok((await call('GET', '/settings/approval-rules', cashier)).status === 403, 'role sans droit Parametres : 403');
  ok((await call('PUT', '/settings/approval-rules/po_over_threshold', admin, { condition: { field: 'inconnu', op: 'gte', value: 1 } })).status === 400, 'champ de condition inconnu refuse');
  ok((await call('PUT', '/settings/approval-rules/po_over_threshold', admin, { escalateAfterHours: 1000 })).status === 400, 'escalade hors bornes refusee');
  ok((await call('PUT', '/settings/approval-rules/po_over_threshold', admin, { steps: [] })).status === 400, 'circuit sans approbateur refuse');
  const relabel = await call('PUT', '/settings/approval-rules/po_over_threshold', admin, { label: 'BC au-dessus du seuil (e2e)' });
  ok(relabel.status === 200 && relabel.json.data.label === 'BC au-dessus du seuil (e2e)' && relabel.json.data.updated_by_name, 'libelle modifie avec auteur');
  const dup = await call('POST', '/settings/approval-rules', admin, { code: 'po_over_threshold', label: 'x', docType: 'purchase_order', steps: [{ approverRole: 'admin' }] });
  ok(dup.status === 409, 'code en double refuse', err(dup));
  const created = await call('POST', '/settings/approval-rules', admin, { code: 'e2e_regle', label: 'Regle e2e', docType: 'purchase_order', enabled: false, condition: { field: 'amount', op: 'gte', value: '12000' }, steps: [{ approverRole: 'admin' }, { approverRole: 'manager' }], mode: 'parallel' });
  ok(created.status === 201 && created.json.data.condition.value === 12000 && created.json.data.steps.length === 2 && created.json.data.mode === 'parallel', 'regle creee (valeur numerique, 2 etapes, parallele)');
  const audit = await q(`SELECT table_name, operation FROM config_audit_log WHERE table_name IN ('approval_rules', 'approval_rule_steps') AND changed_by = $1`, [admin.id]);
  ok(audit.some(a => a.table_name === 'approval_rules' && a.operation === 'UPDATE') && audit.some(a => a.table_name === 'approval_rule_steps' && a.operation === 'INSERT'), 'regles et etapes tracees au journal', audit.length);

  console.log('2. Bon de commande au-dessus du seuil');
  const supplier = (await q(`SELECT id FROM suppliers LIMIT 1`))[0];
  const ingredient = (await q(`SELECT id FROM ingredients LIMIT 1`))[0];
  const newPo = async (qty: number, price = 60) => (await call('POST', '/purchase-orders', manager, { supplierId: supplier.id, items: [{ ingredientId: ingredient.id, quantityOrdered: qty, unitPrice: price }] })).json.data;
  // Règle décidée le 2026-10-25 (mig 350) : BC strictement au-dessus de 5 000 DH → administrateur.
  const poRule = rules.json.data.find((r: any) => r.code === 'po_over_threshold');
  ok(poRule.condition.op === 'gt' && Number(poRule.condition.value) === 5000 && poRule.steps.map((s: any) => s.approver_role).join('>') === 'admin',
    'regle BC : montant > 5 000 DH, approbation admin', { condition: poRule.condition, steps: poRule.steps.map((s: any) => s.approver_role) });
  const po = await newPo(100); // 6 000 DH
  const sent = await call('POST', `/purchase-orders/${po.id}/send`, manager);
  ok(sent.status === 202 && sent.json.approval?.status === 'pending' && sent.json.approval.steps[0].approver_role === 'admin', 'BC 6 000 DH envoye par le gerant : soumis a l\'admin (202)', sent.status);
  ok(Number(sent.json.approval.amount) === 6000 && sent.json.approval.summary.condition.includes('5'), 'montant et condition memorises', sent.json.approval.summary.condition);
  ok((await q(`SELECT status FROM purchase_orders WHERE id = $1`, [po.id]))[0].status === 'en_attente', 'le BC reste en attente');
  const list = await call('GET', '/purchase-orders', manager);
  ok(list.json.data.find((p: any) => p.id === po.id)?.approval_pending === true, 'liste des BC : drapeau approval_pending');
  const board = await call('GET', '/purchase-orders/board?view=open&limit=200&offset=0', manager);
  ok((board.json.data?.rows ?? board.json.data ?? []).find?.((p: any) => p.id === po.id)?.approval_pending === true, 'tableau des BC : drapeau approval_pending');
  ok((await call('POST', `/purchase-orders/${po.id}/send`, manager)).status === 409, 'second envoi refuse tant que la demande est en attente');
  const poDetail = (await call('GET', `/purchase-orders/${po.id}`, manager)).json.data;
  const recv = await call('POST', '/reception-vouchers', manager, { purchaseOrderId: po.id, items: [{ poItemId: poDetail.items[0].id, ingredientId: ingredient.id, quantityReceived: 1 }] });
  ok(recv.status === 409 && /approbation/.test(err(recv)), 'reception d\'un BC sous approbation refusee', err(recv));
  const reqId = sent.json.approval.id;
  const self = await call('POST', `/approvals/${reqId}/approve`, manager);
  ok(self.status === 403 && /propre demande/.test(err(self)), 'le demandeur ne peut pas approuver sa propre demande');
  const otherManager = await call('POST', `/approvals/${reqId}/approve`, manager2);
  ok(otherManager.status === 403, 'un autre gerant ne peut pas approuver (etape admin)', err(otherManager));
  const stranger = await call('POST', `/approvals/${reqId}/approve`, cashier);
  ok(stranger.status === 403, 'une caissiere ne peut pas approuver', err(stranger));
  ok(!(await call('GET', '/approvals/inbox', manager2)).json.data.some((r: any) => r.id === reqId), 'boite du gerant : la demande n\'y est pas');
  ok((await call('GET', '/approvals/inbox', admin)).json.data.some((r: any) => r.id === reqId), 'l\'admin voit la demande dans sa boite');
  const notifReq = await q(`SELECT target_role, target_user_id FROM notifications WHERE type = 'approval_requested' AND reference_id = $1`, [reqId]);
  ok(notifReq.length === 1 && notifReq[0].target_role === 'admin', 'notification « a approuver » au role admin', notifReq);
  const approved = await call('POST', `/approvals/${reqId}/approve`, admin, { reason: 'Fournisseur habituel' });
  ok(approved.status === 200 && approved.json.data.status === 'approved' && approved.json.data.applied_at && !approved.json.data.apply_error, 'approbation par l\'admin : demande approuvee et effet applique', err(approved) ?? approved.json?.data?.apply_error);
  ok((await q(`SELECT status FROM purchase_orders WHERE id = $1`, [po.id]))[0].status === 'envoye', 'le BC est passe a « envoye »');
  const v0 = await q(`SELECT created_by FROM purchase_order_versions WHERE purchase_order_id = $1 AND version_no = 0`, [po.id]);
  ok(v0.length === 1 && v0[0].created_by === admin.id, 'envoi journalise : version 0 figee au nom de l\'admin');
  ok(approved.json.data.steps[0].reason === 'Fournisseur habituel', 'etape signee et motivee');
  const notifOk = await q(`SELECT 1 FROM notifications WHERE type = 'approval_approved' AND target_user_id = $1 AND reference_id = $2`, [manager.id, reqId]);
  ok(notifOk.length === 1, 'le demandeur est prevenu de l\'approbation');
  const small = await newPo(10); // 600 DH
  const sentSmall = await call('POST', `/purchase-orders/${small.id}/send`, manager);
  ok(sentSmall.status === 200, 'BC 600 DH : envoye directement', sentSmall.status);
  const exact = await newPo(100, 50); // 5 000 DH pile
  ok((await call('POST', `/purchase-orders/${exact.id}/send`, manager)).status === 200, 'BC de 5 000 DH pile : envoye directement (seuil strict)');
  const byAdmin = await newPo(100); // 6 000 DH envoye par un admin
  const sentByAdmin = await call('POST', `/purchase-orders/${byAdmin.id}/send`, admin);
  ok(sentByAdmin.status === 200 && (await q(`SELECT status FROM purchase_orders WHERE id = $1`, [byAdmin.id]))[0].status === 'envoye', 'BC 6 000 DH envoye par un admin : son envoi vaut approbation', sentByAdmin.status);

  // Suite des scénarios génériques du moteur (refus, délégation, escalade) avec un
  // circuit « gérant » : on le paramètre comme le ferait un utilisateur.
  ok((await call('PUT', '/settings/approval-rules/po_over_threshold', admin, { steps: [{ approverRole: 'manager' }] })).status === 200, 'circuit BC repasse au gerant pour les scenarios suivants');

  console.log('3. Refus, delegation, escalade, retrait');
  const po2 = await newPo(100);
  const req2 = (await call('POST', `/purchase-orders/${po2.id}/send`, manager)).json.approval.id;
  const noReason = await call('POST', `/approvals/${req2}/reject`, admin, {});
  ok(noReason.status === 400, 'refus sans motif refuse');
  const deleg = await call('POST', '/approvals/delegations', manager2, { toUserId: cashier.id, endsOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) });
  ok(deleg.status === 201, 'le gerant 2 delegue a la caissiere', err(deleg));
  const delegates = await call('GET', '/approvals/delegates', manager2);
  ok(delegates.json.data.some((d: any) => d.id === cashier.id) === false && delegates.json.data.some((d: any) => d.id === admin.id), 'delegues proposes : admins et gerants, pas la caissiere');
  const inboxC = await call('GET', '/approvals/inbox', cashier);
  ok(inboxC.json.data.some((r: any) => r.id === req2), 'la caissiere deleguee voit la demande');
  const rejected = await call('POST', `/approvals/${req2}/reject`, cashier, { reason: 'Prix trop eleve' });
  ok(rejected.status === 200 && rejected.json.data.status === 'rejected' && rejected.json.data.steps[0].status === 'rejected', 'refus par la deleguee', err(rejected));
  ok((await q(`SELECT status FROM purchase_orders WHERE id = $1`, [po2.id]))[0].status === 'en_attente', 'BC refuse : reste en attente');
  ok((await q(`SELECT 1 FROM notifications WHERE type = 'approval_rejected' AND target_user_id = $1 AND reference_id = $2 AND message LIKE '%Prix trop eleve%'`, [manager.id, req2])).length === 1, 'le demandeur recoit le motif du refus');
  const resent = await call('POST', `/purchase-orders/${po2.id}/send`, manager);
  ok(resent.status === 202 && resent.json.approval.id !== req2, 'apres refus : nouvelle soumission possible');
  await conn.query(`UPDATE approval_steps SET due_at = now() - interval '1 hour' WHERE request_id = $1`, [resent.json.approval.id]);
  await call('GET', '/approvals/inbox', admin);
  const esc = await q(`SELECT escalated_at FROM approval_steps WHERE request_id = $1`, [resent.json.approval.id]);
  ok(!!esc[0].escalated_at && (await q(`SELECT 1 FROM notifications WHERE type = 'approval_escalated' AND target_role = 'admin' AND reference_id = $1`, [resent.json.approval.id])).length === 1, 'etape en retard : escalade a l\'administrateur, une seule fois');
  await call('GET', '/approvals/inbox', admin);
  ok((await q(`SELECT count(*) FROM notifications WHERE type = 'approval_escalated' AND reference_id = $1`, [resent.json.approval.id]))[0].count === '1', 'pas de seconde alerte');
  const cancelled = await call('POST', `/approvals/${resent.json.approval.id}/cancel`, manager, { reason: 'Je renegocie' });
  ok(cancelled.status === 200 && cancelled.json.data.status === 'cancelled', 'le demandeur retire sa demande');
  const req3 = (await call('POST', `/purchase-orders/${po2.id}/send`, manager)).json.approval.id;
  const edit = await call('PUT', `/purchase-orders/${po2.id}/items`, manager, { items: [{ id: poDetail.items[0].id ? undefined : undefined, ingredientId: ingredient.id, quantityOrdered: 50, unitPrice: 60 }] });
  ok(edit.status === 200 && (await q(`SELECT status FROM approval_requests WHERE id = $1`, [req3]))[0].status === 'cancelled', 'lignes modifiees : la demande en attente est retiree', edit.status);
  ok((await call('GET', '/approvals/history', cashier)).status === 403, 'historique reserve admin/gerant');
  const hist = await call('GET', '/approvals/history?status=rejected', admin);
  ok(hist.status === 200 && hist.json.total === 1 && hist.json.data[0].decided_by_name === 'Caissière E2E', 'historique filtre par statut');
  const mine = await call('GET', '/approvals/mine', manager);
  ok(mine.json.data.length === 4, 'mes demandes : 4 soumissions du gerant', mine.json.data.length);

  console.log('4. Annulation de facture (avoir)');
  const fe = (await q(
    `INSERT INTO invoices (invoice_number, invoice_type, invoice_date, amount, tax_amount, total_amount, status, created_by, store_id)
     VALUES ('FE-E2E-0001', 'emitted', CURRENT_DATE, 1000, 200, 1200, 'pending', $1, $2) RETURNING id`, [admin.id, STORE]))[0];
  const cancelFe = await call('POST', `/invoices/${fe.id}/cancel`, manager);
  ok(cancelFe.status === 202 && cancelFe.json.approval.rule_code === 'invoice_cancel' && cancelFe.json.approval.steps[0].approver_role === 'admin', 'facture emise : annulation soumise a l\'admin (202)', cancelFe.status);
  ok((await q(`SELECT status FROM invoices WHERE id = $1`, [fe.id]))[0].status === 'pending', 'la facture reste active en attendant');
  ok((await call('POST', `/approvals/${cancelFe.json.approval.id}/approve`, manager2)).status === 403, 'un gerant ne peut pas trancher l\'etape admin');
  const feOk = await call('POST', `/approvals/${cancelFe.json.approval.id}/approve`, admin);
  ok(feOk.status === 200 && feOk.json.data.status === 'approved' && !feOk.json.data.apply_error, 'admin approuve l\'avoir', feOk.json?.data?.apply_error);
  ok((await q(`SELECT status FROM invoices WHERE id = $1`, [fe.id]))[0].status === 'cancelled', 'la facture emise est annulee');
  ok((await call('POST', `/invoices/${fe.id}/cancel`, manager)).status === 409, 'facture deja annulee : 409');
  const fr = (await q(
    `INSERT INTO invoices (invoice_number, invoice_type, invoice_date, amount, tax_amount, total_amount, status, created_by, store_id, supplier_id)
     VALUES ('FR-E2E-0001', 'received', CURRENT_DATE, 1000, 200, 1200, 'pending', $1, $2, $3) RETURNING id`, [admin.id, STORE, supplier.id]))[0];
  const cancelReason = (await q(`SELECT id FROM ref_entries WHERE table_id = 'purchase_reason_codes' AND is_active AND metadata->'scope' ? 'cancel_invoice' LIMIT 1`))[0];
  const cancelFr = await call('POST', `/invoices/${fr.id}/cancel`, manager, { reasonCodeId: cancelReason.id, note: 'e2e' });
  ok(cancelFr.status === 200 && cancelFr.json.data.status === 'cancelled', 'facture fournisseur : annulee directement (hors condition)');

  console.log('5. Ecart de controle d\'ouverture');
  const products = await q(`SELECT p.id FROM products p JOIN product_store_stock s ON s.product_id = p.id AND s.store_id = $1 LIMIT 2`, [STORE]);
  ok(products.length === 2, 'deux produits en stock boutique pour le test');
  const check = await call('POST', '/inventory-checks/opening', cashier, {
    previousCheckId: null, notes: 'e2e',
    items: [
      { productId: products[0].id, expectedQty: 100, foundQty: 95, missingReason: 'theft' },
      { productId: products[1].id, expectedQty: 100, foundQty: 100 },
    ],
  });
  ok(check.status === 201 && check.json.data.status === 'awaiting_validation' && check.json.approval?.status === 'pending', 'ecart 2,5 % : controle sous circuit d\'approbation', err(check) ?? check.status);
  ok(check.json.approval?.summary?.values?.gap_pct === 2.5 && check.json.approval.steps.map((s: any) => s.approver_role).join('>') === 'manager>admin', 'valeurs : 2,5 %, circuit gerant puis admin', check.json.approval?.summary?.values);
  const awaiting = await call('GET', '/inventory-checks/opening/awaiting-validation', manager);
  const row = awaiting.json.data.find((c: any) => c.id === check.json.data.id);
  ok(row?.approval?.step_order === 1 && row.approval.approver_role === 'manager' && row.approval.total_steps === 2, 'liste des controles : etape 1/2 gerant');
  const step1 = await call('POST', `/inventory-checks/opening/${check.json.data.id}/validate`, manager, { action: 'approve' });
  ok(step1.status === 200 && step1.json.approval?.status === 'pending' && step1.json.data.status === 'awaiting_validation', 'gerant approuve : le controle attend encore l\'admin', err(step1));
  ok(step1.json.approval.steps[1].status === 'pending' && (await q(`SELECT 1 FROM notifications WHERE type = 'approval_requested' AND target_role = 'admin' AND reference_id = $1`, [step1.json.approval.id])).length === 1, 'etape 2 ouverte, admin prevenu');
  const step2 = await call('POST', `/inventory-checks/opening/${check.json.data.id}/validate`, admin, { action: 'approve' });
  ok(step2.status === 200 && step2.json.approval?.status === 'approved' && step2.json.data.status === 'validated' && step2.json.data.validated_by === admin.id, 'admin approuve : controle valide, ecart repercute', err(step2) ?? step2.json?.approval?.apply_error);
  const small2 = await call('POST', '/inventory-checks/opening', cashier, {
    previousCheckId: null, items: [{ productId: products[0].id, expectedQty: 100, foundQty: 99, missingReason: 'breakage' }, { productId: products[1].id, expectedQty: 100, foundQty: 100 }],
  });
  ok(small2.status === 201 && small2.json.approval === null, 'ecart 0,5 % : pas de circuit', err(small2));
  const direct = await call('POST', `/inventory-checks/opening/${small2.json.data.id}/validate`, manager, { action: 'reject', rejectionReason: 'A recompter' });
  ok(direct.status === 200 && direct.json.data.status === 'rejected' && direct.json.approval === undefined, 'validation directe inchangee sous le seuil');
  const check3 = await call('POST', '/inventory-checks/opening', cashier, {
    previousCheckId: null, items: [{ productId: products[0].id, expectedQty: 100, foundQty: 90, missingReason: 'theft' }, { productId: products[1].id, expectedQty: 100, foundQty: 100 }],
  });
  const rej = await call('POST', `/inventory-checks/opening/${check3.json.data.id}/validate`, manager, { action: 'reject', rejectionReason: 'Comptage douteux' });
  ok(rej.status === 200 && rej.json.approval?.status === 'rejected' && rej.json.data.status === 'rejected' && rej.json.data.rejection_reason === 'Comptage douteux', 'refus au circuit : controle rejete avec motif', err(rej));

  console.log('6. Suppression de regle');
  const po4 = await newPo(100);
  await call('POST', `/purchase-orders/${po4.id}/send`, manager);
  const delBusy = await call('DELETE', '/settings/approval-rules/po_over_threshold', admin);
  ok(delBusy.status === 409, 'regle avec demande en attente : suppression refusee', err(delBusy));
  ok((await call('DELETE', '/settings/approval-rules/e2e_regle', admin)).status === 200, 'regle sans demande : supprimee');
  await call('PUT', '/settings/approval-rules/po_over_threshold', admin, { enabled: false });
  const po5 = await newPo(100);
  ok((await call('POST', `/purchase-orders/${po5.id}/send`, manager)).status === 200, 'regle desactivee : BC 6 000 DH envoye directement');
} catch (e) {
  failures++;
  console.log('  ✗ exception :', (e as Error).message, (e as any).cause ?? '', (e as Error).stack?.split('\n').slice(1, 4).join(' | '));
} finally {
  server?.close();
  const still = (await conn.query('SELECT txid_current() AS t')).rows[0].t;
  if (still !== txid) console.log('  ✗ la transaction a change en cours de route');
  await conn.query('ROLLBACK');
  await conn.end();
  console.log(failures ? `\n${failures} echec(s)` : '\nTout est vert (transaction annulee, rien n\'est ecrit).');
  process.exit(failures ? 1 : 0);
}
