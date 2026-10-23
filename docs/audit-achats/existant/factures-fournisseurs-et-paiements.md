# Existant — Factures fournisseurs, rapprochement, paiements, échéancier (D6, D7)

Lecteur : « factures-fournisseurs-et-paiements ». Audit du 2026-10-11 sur le dépôt `/Users/anissbouida/projets/Ofauria-app` et la base locale (copie récente de la prod, port 5433, lecture seule). Toutes les lignes citées sont celles du working tree au moment de la lecture.

Sommaire
1. Périmètre et volumes
2. Modèle de données (tables, migrations, schéma effectif)
3. Chemins de création d'une facture fournisseur
4. Machine à états telle que codée
5. Rapprochement BC / BR / facture (3 voies)
6. Facture multi-BC et BC multi-factures
7. Avoirs / notes de crédit
8. TVA
9. Conditions de paiement, échéance, alertes
10. Paiements (modes, chèques/traites, partiels, sync paid_amount)
11. Échéancier (mig 258)
12. Comptabilisation (ledger) — ce qui touche D6/D7
13. Endpoints et usage client
14. Écrans client
15. Scripts
16. Statistiques réelles (SQL + résultats)
17. Rôles, audit, tests
18. Code mort / jamais appelé / jamais alimenté
19. Points forts
20. Faiblesses (étayées, par sévérité)
21. Questions ouvertes

---

## 1. Périmètre et volumes

Tables du périmètre et volumes en base locale :

| Table | Lignes | Détail |
|---|---|---|
| invoices | 326 | 317 `received` (fournisseurs), 9 `emitted` (clients, hors périmètre) |
| invoice_items | 870 | 816 rattachées à des factures reçues |
| invoice_purchase_orders | 35 | 34 factures, 35 BC ; une seule facture a 2 BC |
| payments | 689 | 289 liées à une facture (`invoice_id`), 37 chèques/traites |
| scheduled_payments / debts / recurring_charges | 0 / 0 / 0 | échéancier (mig 258) jamais alimenté |
| reception_vouchers.supplier_invoice_number | 46 / 307 | 15 % des BR portent le n° fournisseur |

```sql
SELECT invoice_type, status, count(*), round(sum(total_amount),2), round(sum(paid_amount),2) FROM invoices GROUP BY 1,2;
-- emitted|paid|2|6460.20|6460.20
-- emitted|pending|7|13430.45|0.00
-- received|paid|280|227407.60|227407.60
-- received|partial|1|3281.00|2532.00
-- received|pending|36|88797.37|0.00
```

Aucune facture en statut `overdue`, `disputed` ou `cancelled`.

## 2. Modèle de données

### 2.1 `invoices` (schéma effectif, `\d+ invoices`)

| Colonne | Type | Migration | Remarque |
|---|---|---|---|
| invoice_number | varchar(50) NOT NULL | 019 | **pas d'unicité** (ni seule, ni par fournisseur) |
| supplier_id | uuid NULL | 019 → nullable en 055 | |
| category_id | uuid | 019 | catégorie de charge au niveau facture ; repli pour les lignes (194) |
| invoice_date / due_date | date | 019 | due_date jamais posée par les flux auto |
| amount / tax_amount / total_amount / paid_amount | numeric(12,2) | 019 | paid_amount = cache de SUM(payments) |
| status | varchar(20) CHECK | 019, 137 | `pending, partial, paid, overdue, cancelled, disputed` |
| store_id | uuid | 034 | isolation magasin |
| attachment_url | text | 039 | 0 ligne renseignée |
| invoice_type | `received`/`emitted` | 055 | |
| purchase_order_id | uuid | 055 | lien BC « historique » (1er BC si fusion) |
| reception_voucher_id | uuid | 055 | dernier BR du BC |
| expected_payment_mode | varchar(20) | 137 (CHECK retiré en 184) | validé applicativement contre `ref_entries('payment_methods')` |
| reception_date | date | 137 | saisi par défaut = aujourd'hui ; jamais lu par une requête métier |
| check_number | varchar(50) | 146 | n° de chèque prévu, resynchronisé au paiement |

Pas de colonne `updated_at`, pas d'historique.

### 2.2 `invoice_items`

Mig 055 (base), 189 (`tva_rate`, `tva_amount`, CHECK 0..100), 194 (`category_id`), 207 (`packaging_id`). FK `invoice_id ON DELETE CASCADE`.

```sql
SELECT tva_rate, count(*) FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.invoice_type='received' GROUP BY 1;
-- NULL|768   20.00|42   10.00|6
SELECT count(*) total, count(ii.ingredient_id) ing, count(ii.packaging_id) pkg, count(ii.category_id) cat, count(ii.product_id) prod,
       count(*) FILTER (WHERE ii.ingredient_id IS NULL AND ii.packaging_id IS NULL AND ii.product_id IS NULL) free_text
FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.invoice_type='received';
-- 816|631|133|754|0|52
```

### 2.3 `invoice_purchase_orders` (mig 178)

PK (invoice_id, purchase_order_id), FK invoice ON DELETE CASCADE. Backfill depuis `invoices.purchase_order_id`. Source de vérité annoncée pour le multi-BC, mais `findAll`/`findById` (accounting.repository.ts:516-531, 538-556) affichent `purchase_order_number` via `inv.purchase_order_id` uniquement.

### 2.4 `payments`

| Colonne | Migration | Usage réel en base |
|---|---|---|
| type CHECK (`invoice, salary, expense, income, advance`) | 019, 228 | |
| invoice_id, supplier_id, employee_id, category_id | 019 | 289 paiements liés à une facture |
| payment_method (CHECK retiré en 177) | 019/177 | cash, check, traite, transfer, bank, **avoir** |
| purchase_order_id | 038 | **0 ligne** |
| import_source / import_source_row (index unique partiel) | 051 | 0 ligne |
| check_number / check_date / check_attachment_url | 055 | 37 / 37 / 0 |
| cashed_at / cashed_by / cashed_note | 154 | 37 (tous les chèques/traites sont encaissés) |
| withholding_type_id / withholding_amount | 212 | 0 |
| session_id | 253 | 0 |
| scheduled_payment_id (+ trigger `trg_sync_scheduled_payment`) | 258 | 0 |

```sql
SELECT type, payment_method, count(*), round(sum(amount),2) FROM payments GROUP BY 1,2 ORDER BY 1,3 DESC;
-- advance|cash|24|7352.00
-- expense|cash|311|252439.15
-- income|bank|2|6460.20 ; income|cash|1|12538.74
-- invoice|cash|248|76287.09
-- invoice|traite|22|70082.40
-- invoice|check|15|68942.61
-- invoice|avoir|1|1200.00
-- invoice|transfer|1|13427.50
-- salary|cash|64|51079.25
```

Référentiel des modes (`ref_entries` table `payment_methods`) : `cash, card, mobile, check, transfer, deferred, traite, mixed` — plus **une entrée au code vide libellée « Traite »** (donnée corrompue, visible dans tout `<select>` de mode).

### 2.5 `scheduled_payments`, `debts`, `recurring_charges` (mig 258)

Trois sources exclusives (CHECK `scheduled_payments_source_ck`), statut `pending/partial/paid/cancelled`, index unique (recurring_charge_id, period_label), fonctions `fn_recompute_scheduled_payment`, `fn_sync_scheduled_payment` (trigger AFTER I/U/D sur payments), `fn_generate_recurring_schedules(horizon)`. Compte CGNC 4481 ajouté. **0 ligne dans les trois tables.**

### 2.6 Vue `v_reconciliation_check` (mig 183)

Compare `total_amount - paid_amount` (legacy) au solde non lettré 4411/3421 (ledger).

```sql
SELECT count(*) total, count(*) FILTER (WHERE abs(legacy_remaining-ledger_remaining)>0.01) diverge,
       count(*) FILTER (WHERE NOT has_ledger_entries) no_ledger FROM v_reconciliation_check WHERE invoice_type='received';
-- 317|5|23
SELECT invoice_number, status, total_amount, legacy_remaining, ledger_remaining, has_ledger_entries FROM v_reconciliation_check
 WHERE invoice_type='received' AND abs(legacy_remaining-ledger_remaining)>0.01;
-- 2605464|pending|3104.40|3104.40|0.00|f
-- FR-2026-0059|paid|2500.00|0.00|2500.00|t
-- 20260430|paid|3486.00|0.00|-3486.00|t
-- 20260522|partial|3281.00|749.00|-1510.50|t
-- 26F22927|pending|1615.63|1615.63|0.00|f
```

## 3. Chemins de création d'une facture fournisseur

### 3.1 Automatique depuis le BC, à la réception complète (chemin dominant : 294 / 317)

`server/src/repositories/reception-voucher.repository.ts`
- 536-545 : dans `receptionVoucherRepository.create`, après recalcul du statut BC, `if (newStatus === 'livre_complet') autoInvoice = await createInvoiceFromPo(client, poId, rv.id, receivedBy, storeId)`.
- Le statut `livre_complet` exige toutes les lignes livrées **et** toutes les lignes avec prix ; sinon `en_attente_facturation` (purchase-order.repository.ts:470 ; même règle dans reception-voucher.repository.ts:520-523).
- `createInvoiceFromPo` (77-207) :
  - 85-89 : idempotence « une seule facture non annulée par BC » (`SELECT id FROM invoices WHERE purchase_order_id = $1 AND status != 'cancelled'`).
  - 101-116 : lignes = `purchase_order_items` avec `quantity_delivered` × prix effectif (dernier `reception_voucher_items.unit_price` non nul, sinon `poi.unit_price`).
  - 138-149 : numéro = `reception_vouchers.supplier_invoice_number` le plus récent du BC, sinon `generateInvoiceNumber('received')` → `FR-YYYY-NNNN`.
  - 168-176 : `INSERT INTO invoices (... invoice_date, amount, tax_amount, total_amount ...) VALUES (..., COALESCE($5::date, CURRENT_DATE), $6, 0, $6, ...)` → **tax_amount = 0 et total = HT**, pas de due_date, pas de mode prévu.
  - 180-185 : `invoice_items` avec `category_id` de l'article figée (mig 255) mais **sans `tva_rate`**.
  - 189-205 : écriture comptable si `FLAGS.LEDGER_AUTOGEN` (SAVEPOINT, échec journalisé seulement).
- `generateInvoiceNumber` (accounting.repository.ts:577-589) : `COUNT(*)` des factures du type/année + 1 sous `pg_advisory_xact_lock` ; une suppression physique d'une facture rend donc un numéro réattribuable.

### 3.2 Manuelle « Générer la facture » sur un BC `livre_complet` sans facture

`POST /purchase-orders/:id/invoice` (purchase-order.routes.ts:23) → `purchaseOrderRepository.generateInvoice` (purchase-order.repository.ts:564-605) : verrou `FOR UPDATE`, statut `livre_complet` requis, 0 ligne sans prix, puis `createInvoiceFromPo(client, id, null, ...)`. Bouton dans `PurchaseOrdersTab.tsx` (l. 507-523 du fichier, visible si `status === 'livre_complet' && !po.has_invoice`).

### 3.3 Fusion de BC (facture unique pour N BC)

`POST /invoices/merge` → `invoiceRepository.mergeForPurchaseOrders` (accounting.repository.ts:767-920) :
- 792-795 : pré-génère une facture pour chaque BC via `createInvoiceFromPo` (les BC **partiels** y passent : la facture porte alors les quantités livrées).
- 813-827 : garde-fous : ≥ 2 factures, même fournisseur, **aucun paiement**.
- 836-846 : maître = plus ancienne ; déplacement des `invoice_items` ; 849-860 : `amount = SUM(subtotal)`, `tax_amount = Σ tax_amount` ; 877-886 : jonction `invoice_purchase_orders` ; 890-897 : propage le n° fournisseur sur les BR ; 901-905 : `DELETE FROM invoices WHERE id = ANY(otherIds)`.
- **Aucune ligne ne touche le ledger** (pas de `reverseEntriesForSource` ni `regenerateInvoiceEntry` dans 767-920) : avec `LEDGER_AUTOGEN`, les écritures des factures supprimées restent au grand livre et l'écriture du maître garde l'ancien montant.

### 3.4 Saisie libre

`POST /invoices` (accounting.controller.ts:183-188 → repository `create` 591-678). Formulaire `ReceivedInvoiceFormModal` (PurchasingPage.tsx:1244-1531) : n°, date, fournisseur, catégorie, HT/TVA (taux 0/7/10/14/20 ou libre)/TTC synchronisés, échéance, date de réception, mode prévu, n° chèque, notes. **Aucun champ BC/BR** : la facture libre ne peut pas être rattachée à un BC. Aucun contrôle de doublon.

```sql
SELECT count(*), round(sum(total_amount),2) FROM invoices WHERE invoice_type='received' AND purchase_order_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM invoice_purchase_orders ipo WHERE ipo.invoice_id=invoices.id);
-- 23|76129.21     (toutes sans invoice_items ni BR)
```

### 3.5 Import Excel (script)

`server/src/scripts/import-invoices-excel.ts` : PO rétroactif `IMPORT-<n°>` en `livre_complet`, facture `pending` avec HT/TVA/TTC du récap, BR + lots ingrédients, stock emballages. Idempotent par (invoice_number, supplier_id) (l. 446-449). 0 BC `IMPORT-%` dans la base locale.

Répartition d'origine observée :

```sql
SELECT CASE WHEN notes LIKE 'Facture auto-generee depuis%' THEN 'auto BC (num interne)'
            WHEN notes LIKE 'Facture fournisseur % — reception depuis%' THEN 'auto BC (num fournisseur)'
            WHEN purchase_order_id IS NULL THEN 'saisie libre' ELSE 'autre' END origine, count(*), round(sum(total_amount),2)
FROM invoices WHERE invoice_type='received' GROUP BY 1;
-- auto BC (num interne)|253|111206.92
-- auto BC (num fournisseur)|41|132149.84
-- saisie libre|23|76129.21
```

**80 % des factures fournisseurs portent un numéro interne `FR-…`** et non le numéro du fournisseur.

## 4. Machine à états telle que codée

États CHECK : `pending, partial, paid, overdue, cancelled, disputed`.

| Transition | Où | Condition |
|---|---|---|
| (création) → `pending` | défaut colonne ; `createInvoiceFromPo`, `create`, import | — |
| `pending`/`partial` → `partial`/`paid` | `invoiceRepository.updatePaidAmount` (accounting.repository.ts:934-976) | `SUM(payments.amount) >= total_amount` → paid ; `> 0` → partial ; sinon pending. **Ignore `cashed_at`** : un chèque émis solde la facture. Appelé dans la transaction de `paymentRepository.create/update/delete`, et après `replaceItems`/`update` si le total change |
| `disputed`/`cancelled` préservés | 956-958 | tant que `status !== 'paid'` : un paiement partiel ne lève pas le litige, mais un paiement complet transforme une facture `cancelled` en `paid` |
| → `cancelled` | `POST /invoices/:id/cancel` (controller 224-227 → `updateStatus`) | **aucune vérification** (paiements existants, store, période) ; `regenerateInvoiceEntry` extourne l'écriture si LEDGER_AUTOGEN |
| → n'importe quel statut | `PUT /invoices/:id/status` (controller 384-397) | liste blanche des 6 statuts, aucune garde de transition (`paid` → `pending` possible à la main) |
| → `overdue` | **jamais calculé côté serveur** (`grep "status = 'overdue'" server/src` → 0) | le client affiche `is_overdue` calculé par `due_date < CURRENT_DATE` dans `findOpenDebts`/`findPaymentAlerts` ; l'onglet « En retard » de PurchasingPage filtre sur `inv.status === 'overdue'` → toujours vide |
| suppression physique | `DELETE /invoices/:id[?force=true]` (repository 1248-1308) | force cascade les paiements ; réservé ADMIN_MANAGER |

Client : `INVOICE_STATUS_TABS` (PurchasingPage.tsx:45-51) : Toutes / Non réglées (pending+partial) / Payées / En retard / En litige ; menu « Statut » manuel limité à pending/partial/paid/disputed (34-40).

## 5. Rapprochement BC / BR / facture

**Il n'existe aucun rapprochement 3 voies.** La facture auto est *dérivée* du BR (quantités livrées × prix de réception), donc égale par construction au moment de la création. Ensuite :
- `PUT /invoices/:id` (repository 1142-1240) modifie n°, fournisseur, dates, HT/TVA/TTC sans aucune comparaison avec le BC ou le BR ; seule garde : `total >= paid_amount` (1180-1183).
- `PUT /invoices/:id/items` (`replaceItems`, 1069-1140) remplace les lignes librement (ingredientId libre, pas de lien `purchase_order_item_id`), recalcule HT/TVA/TTC ; même garde unique.
- Aucune tolérance prix/quantité, aucun blocage, aucun statut « bloquée pour écart » (le statut `disputed` existe mais est purement manuel).
- Aucune provision « reçu non facturé » : un BC `livre_partiel` ne produit rien ; un BC `en_attente_facturation` (prix manquants) non plus.

Écarts constatés :

```sql
-- facture vs Σ BR (qty_received × unit_price) pour les factures liées à un BC
SELECT count(*) FILTER (WHERE abs(diff)<=0.01) ok, count(*) FILTER (WHERE abs(diff)>0.01) ecart, round(sum(abs(diff)) FILTER (WHERE abs(diff)>0.01),2)
FROM (SELECT inv.id, inv.amount - COALESCE((SELECT sum(rvi.quantity_received*COALESCE(rvi.unit_price,0)) FROM reception_vouchers rv
      JOIN reception_voucher_items rvi ON rvi.reception_voucher_id=rv.id WHERE rv.purchase_order_id=inv.purchase_order_id),0) diff
      FROM invoices inv WHERE inv.invoice_type='received' AND inv.purchase_order_id IS NOT NULL) x;
-- 258|36|16662.75
-- facture vs Σ BC (qty_ordered × unit_price) : 259 ok | 35 écart
-- Exemples : 516624 amount 7250 vs BR 0 (prix saisis sur la facture, BR sans prix) ; 26F17969 7854.54 vs 6294.90 ; FR-2026-0065 1091.10 vs 291.00
SELECT count(*) FILTER (WHERE unit_price IS NULL) null_price, count(*) FROM reception_voucher_items;  -- 7|789
```

Le seul contrôle « d'écart » existant est côté BC (audit A1, prix BC vs prix réception — hors périmètre de ce lecteur).

## 6. Facture multi-BC et BC multi-factures

- Multi-BC : supporté uniquement par la fusion (§3.3). En base : 1 facture avec 2 BC. L'UI (`PurchaseOrdersTab.tsx` 116-117, 245-267, 285-295) propose la sélection multi-BC du même fournisseur et le `MergeInvoicesModal` (1580-1660 du fichier).
- BC multi-factures (une facture par livraison partielle) : **non supporté**. `createInvoiceFromPo` refuse une 2ᵉ facture (85-89) et ne se déclenche qu'en `livre_complet`. 8 BC ont ≥ 2 BR :

```sql
SELECT n_rv, count(*) FROM (SELECT po.id, count(rv.id) n_rv FROM purchase_orders po JOIN reception_vouchers rv ON rv.purchase_order_id=po.id GROUP BY po.id) x GROUP BY 1;
-- 1|290   2|7   3|1
```

Un fournisseur qui facture chaque livraison ne peut pas être reflété : le n° fournisseur saisi sur le 1ᵉʳ BR est écrasé par celui du dernier (`ORDER BY created_at DESC LIMIT 1`, reception-voucher.repository.ts:138-144). Le garde anti-doublon de la réception (reception-voucher.repository.ts:318-338) bloque d'ailleurs la ressaisie d'un même n° fournisseur sur un autre BR du même fournisseur.

## 7. Avoirs / notes de crédit

Pas d'entité « avoir ». Un avoir est un `payments.payment_method = 'avoir'` créé **uniquement** dans la transaction d'un paiement chèque/traite d'une facture (accounting.repository.ts:1986-2011 ; UI PurchasingPage.tsx:1188-1211 et DettesTab). Pas d'avoir autonome, pas d'avoir sur paiement cash/virement, pas d'avoir reportable sur une autre facture, pas de lien à une ligne/retour fournisseur.

Comptabilisation : `fromPaymentEmission` (journal-generator.service.ts:441-549) ne connaît pas `avoir` → `default: creditCode = '5161'; journal = 'CA'` (512-513). Vérifié en base :

```sql
SELECT a.code, jel.debit, jel.credit, je.description FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.journal_entry_id
 JOIN accounts a ON a.id=jel.account_id WHERE je.source_id IN (SELECT id FROM payments WHERE payment_method='avoir');
-- 5161|0.00|1200.00|Avoir déduit du traite AAA  5100009
-- 4411|1200.00|0.00|Avoir déduit du traite AAA  5100009
```

→ l'avoir de 1 200 DH est comptabilisé comme une **sortie de caisse** (5161) alors qu'aucun cash n'est sorti ; la charge et la TVA ne sont pas réduites. `paymentRepository.findAll` (ChargesTab) et `summary` le comptent aussi comme dépense.

## 8. TVA

- En-tête : `tax_amount` ; taux unique déduit du ratio dans `fromInvoice` (`computeTvaRate`, journal-generator.service.ts:95-99) → compte `tvaAccountForRate(rate,'deductible')`.
- Par ligne (mig 189) : `tva_rate`/`tva_amount` ; si au moins une ligne a un taux, l'en-tête est recalculé depuis les lignes (`headerTotalsFromLines`, utils/tva.ts:26-35 ; repository `create` 606-615, `replaceItems` 1083-1089). Écriture : une ligne TVA par taux (`tvaGroupsForInvoice`, 106-128).
- **Les factures auto depuis BC naissent sans TVA** (§3.1) : 263 factures / 167 353 DH HT liées à un BC ont `tax_amount = 0` ; seules 31 ont été reprises ensuite.

```sql
SELECT (purchase_order_id IS NOT NULL) from_po, (tax_amount>0) has_tax, count(*), round(sum(amount),2) ht FROM invoices WHERE invoice_type='received' GROUP BY 1,2;
-- f|f|5|31845.50   f|t|18|36903.09   t|f|263|167352.90   t|t|31|63399.42
```

- Pas de notion de déductibilité partielle/non déductible, pas de date d'exigibilité (encaissement vs débit), pas de taux par article/fournisseur dans le référentiel (le BC ne porte pas de TVA).

## 9. Conditions de paiement, échéance, alertes

- `suppliers` n'a **aucune colonne de conditions de paiement** (`\d suppliers` : name, contact, phone, email, address, city, ice, notes, is_active). `due_date` et `expected_payment_mode` sont saisis facture par facture (formulaire libre ou `PUT /invoices/:id`). Les factures auto n'en reçoivent jamais.

```sql
SELECT count(*) total, count(due_date) with_due, count(*) FILTER (WHERE due_date < CURRENT_DATE) overdue_by_date, count(expected_payment_mode) with_mode
FROM invoices WHERE invoice_type='received' AND status NOT IN ('paid','cancelled');
-- 37|0|0|1
```

→ **aucune des 37 factures ouvertes (89 546 DH) n'a d'échéance** : la branche `kind='invoice'` de `findPaymentAlerts` (accounting.repository.ts:1316-1409, filtre `inv.due_date IS NOT NULL`) est vide, le KPI dashboard « en retard » (dashboard.repository.ts:118-128, basé sur `inv.due_date`) aussi.

- Alertes : `GET /invoices/payment-alerts?days=` (3 familles : factures à échéance, chèques/traites non encaissés à `COALESCE(check_date, due_date)`, échéances mig 258) consommé par `PaymentAlertsWidget` (HomePage + AccountingPage, refetch 60 s). Pas de notification (notification.repository.ts ne mentionne pas les factures), pas d'e-mail/relance fournisseur, pas de rappel planifié.
- Échelonnement d'une facture : `POST /invoices/:id/schedule` (payment-schedule.repository.ts:160-238) ; la dernière échéance devient `due_date` de la facture (228-232). Jamais utilisé en base (0 `scheduled_payments`).

## 10. Paiements

### 10.1 Création (`POST /payments`, controller 637-731 → repository 1832-2070)

Cas facture liée (1929-2070) : `SELECT ... FOR UPDATE` sur la facture ; **garde sur-paiement** `currentPaid + amount + avoir > total + 0.01` → 409 ; **garde doublon de chèque** (même `check_number` sur la même facture) → 409 ; `UPDATE invoices SET check_number` (1976-1983) ; avoir (1986-2011) ; écriture d'émission + `autoLettrer` ; `updatePaidAmount(invoiceId, client)` **dans la même transaction** (2033). Cas sans facture (1869-1927) : INSERT direct (+ écriture), garde sur-paiement d'échéance si `scheduledPaymentId`.

Côté contrôleur : rattachement automatique d'un paiement cash à la session de caisse ouverte (647-652), héritage catégorie/fournisseur depuis l'échéance (657-663), `ENFORCE_PO_REQUIREMENT = false` (668-679) — le contrôle « BC obligatoire » (mig 038, `expense_categories.requires_po`) est **désactivé des deux côtés** (AccountingPage.tsx ChargesTab, `const ENFORCE_PO_REQUIREMENT = false`). `payments.purchase_order_id` : 0 ligne.

### 10.2 Modification / suppression

- `PUT /payments/:id` (repository 2072-2107) : categoryId, description, amount, paymentMethod, paymentDate. **Pas de garde sur-paiement** quand `amount` change ; impossible de corriger `check_number`, `check_date`, `invoice_id`, `supplier_id`. Regénère les écritures et resync `paid_amount`.
- `DELETE /payments/:id` (2109-2140) : ADMIN_MANAGER, extourne les écritures (bloqué si période close), resync `paid_amount`. UI : `InvoicePaymentsModal` (PurchasingPage.tsx:1977-2145), ChequesTab, ChargesTab.

### 10.3 Modes, chèques, traites

- Le `<select>` de mode des formulaires « Payer » liste **tout** le référentiel (`useReferentiel('payment_methods')`, PurchasingPage.tsx:1173-1177), y compris `card`, `mobile`, `deferred`, `mixed` (modes POS) et l'entrée au code vide. `fromPaymentEmission` mappe tout mode inconnu sur 5161/CA (512-513).
- Chèque/traite : `check_number` obligatoire, `check_date` pré-remplie avec `due_date` sinon aujourd'hui (1186), `cashed_at` posé via `POST /payments/:id/mark-cashed` (ADMIN_MANAGER) / `unmark-cashed` (ADMIN). Vue trésorerie (`paymentRepository.findAll` 1656-1702, `caisseRepository.getRegister` 24-37 & 92-99, `findLineExpenses` 1452-1638) : date effective = `cashed_at` pour check/traite, exclus tant que non encaissés.
- Un chèque pour N factures = N lignes `payments` partageant `check_number` ; `ChequesTab` regroupe côté client (AccountingPage.tsx:3113-3135) et `markCashed` appelle l'endpoint N fois (`Promise.all`, 2971-2973) — non atomique.

```sql
SELECT check_number, count(DISTINCT invoice_id), round(sum(amount),2) FROM payments WHERE check_number IS NOT NULL AND invoice_id IS NOT NULL GROUP BY 1 HAVING count(DISTINCT invoice_id)>1 ORDER BY 2 DESC LIMIT 3;
-- 5100006|7|12688.39   AAA 5100009|5|19623.40   AAA  5100009|4|11346.39   (même chèque saisi avec 1 et 2 espaces)
SELECT count(*) FILTER (WHERE check_date IS NULL) no_check_date, count(*) FILTER (WHERE check_date > payment_date) postdated,
       count(*) FILTER (WHERE cashed_at < check_date) cashed_before_check_date FROM payments WHERE payment_method IN ('check','traite');
-- 0|35|7
```

7 effets « encaissés » avant leur date d'échéance (ex. AAA 1550002 : check_date 2026-08-17, cashed_at 2026-08-10) — probable effet du script `fix-cheque-dates-and-numbers.ts` (check_date := due_date) combiné à un encaissement saisi manuellement.

### 10.4 Sync `paid_amount`

Atomique dans la transaction du paiement (create/update/delete) via `updatePaidAmount(id, client)`. Script `reconcile-invoice-payments.ts` (diag/dédoublonnage/recalcul, dry-run par défaut). État actuel : **0 dérive**, 0 sur-paiement, 0 écart statut/derivé.

```sql
SELECT count(*) FROM invoices inv WHERE abs(COALESCE(paid_amount,0) - (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id=inv.id)) > 0.01;  -- 0
```

### 10.5 Partiels, dates

6 factures ont 2 paiements, 277 un seul. 13 paiements sont datés **avant** la date de facture (ex. FR-2026-0092 facture 2026-06-24, paiement cash 2026-06-20) : la facture auto prend `CURRENT_DATE` de la réception quand le n°/date fournisseur manquent, et le paiement est saisi à une date antérieure. Aucun contrôle de cohérence de dates.

## 11. Échéancier (mig 258)

Routes `/payment-schedules`, `/debts`, `/recurring-charges` (payment-schedule.routes.ts) + `POST /invoices/:id/schedule`. Repository complet (découpe `splitInstallments`, `addMonthsClamped`, génération idempotente des charges fixes à l'ouverture de l'onglet et dans `findPaymentAlerts`). UI `EcheancierView.tsx` (onglet Dettes → « Échéancier » ; paiement d'une échéance, saisie du montant variable, dettes autonomes, charges fixes). **Jamais utilisé** : 0 ligne dans les 3 tables ; 0 paiement avec `scheduled_payment_id`.

## 12. Comptabilisation (ce qui concerne D6/D7)

- `FLAGS.LEDGER_AUTOGEN` (feature-flags.ts:33) : **défaut ON en dev, OFF en production** sauf variable d'env. `.env` local : `NODE_ENV=development`, aucun `LEDGER_*`. Aucun fichier de déploiement du dépôt ne fixe `LEDGER_AUTOGEN` → en prod la génération auto dépend d'une variable Cloud Run non versionnée (question ouverte). `LEDGER_BACKED_DEBTS`/`LEDGER_SHADOW_MODE` déclarés mais **jamais lus** hors feature-flags.ts.
- Facture fournisseur : 6xxx (compte résolu par la cascade des catégories, repli 6181) D / 3455x D / 4411 (auxiliaire fournisseur, créé à la volée depuis mig 208) C, journal AC (`fromInvoice` 177-271). Paiement : 4411 D / 5161|5141|5111|4415 C, lettrage `inv-<id>` et `autoLettrer` quand D = C (700-760). Encaissement chèque : 5111 D / 5141 C à `cashed_at`.
- Couverture en base : 292/317 factures reçues et 648/689 paiements ont une écriture ; 994 écritures `backfill`, 14 `invoice`, 46 `payment`. 5 divergences legacy/ledger (§2.6) ; mémoire projet : « SUIVI PROD à faire sur 2 factures déjà en base ».
- Pas de GR/IR (marchandises reçues non facturées), pas de coût d'acquisition complet, pas de rattachement analytique au-delà de la catégorie de charge.

## 13. Endpoints et usage client

Montage : `/api/v1/invoices`, `/api/v1/payments`, `/api/v1/payment-schedules`, `/api/v1/debts`, `/api/v1/recurring-charges`, `/api/v1/purchase-orders/:id/invoice`. Rôles : `ROLE_GROUPS.ADMIN_MANAGER` = admin + manager sauf mention. « Appelé » = grep du chemin/méthode dans `client/src/api/*.ts` **et** usage de la fonction dans `client/src/features|components`.

| Méthode | Chemin | Handler (fichier:ligne) | Rôle | Appelé par le client |
|---|---|---|---|---|
| GET | /invoices | invoiceController.list (accounting.controller.ts:138) | ADMIN_MANAGER | oui — PurchasingPage.tsx:456, sales/EmittedInvoicesTab |
| GET | /invoices/line-expenses | lineExpenses (147) | ADMIN_MANAGER | oui — AccountingPage ChargesTab |
| GET | /invoices/payment-alerts | paymentAlerts (302) | ADMIN_MANAGER | oui — PaymentAlertsWidget.tsx:51 |
| GET | /invoices/debts | debts (316) | ADMIN_MANAGER | oui — AccountingPage DettesTab:397 |
| GET | /invoices/:id | getById (175) | ADMIN_MANAGER | oui — PurchasingPage (lignes, paiements), EmittedInvoicesTab |
| PUT | /invoices/line/:id/category | updateLineCategory (167) | ADMIN_MANAGER | oui — ChargesTab |
| PUT | /invoices/:id/category | updateCategory (154) | ADMIN_MANAGER | **non** (`invoicesApi.updateCategory` défini, 0 usage) |
| PUT | /invoices/:id/items | replaceItems (329) | ADMIN_MANAGER | oui — PurchasingPage InvoiceLinesEditorModal, EmittedInvoicesTab |
| PUT | /invoices/:id/payment-terms | updatePaymentTerms (368) | ADMIN_MANAGER | **non** (`invoicesApi.updatePaymentTerms` défini, 0 usage ; l'UI passe par PUT /invoices/:id) |
| PUT | /invoices/:id/status | updateStatusManual (384) | ADMIN_MANAGER | oui — PurchasingPage.tsx:527 |
| PUT | /invoices/:id | update (233) | ADMIN_MANAGER | oui — PurchasingPage.tsx:467, EmittedInvoicesTab |
| POST | /invoices | create (183) | ADMIN_MANAGER | oui — PurchasingPage.tsx:461 |
| POST | /invoices/from-order/:orderId | createFromOrder (189) | ADMIN_MANAGER | oui — EmittedInvoicesTab (hors périmètre) |
| POST | /invoices/merge | merge (200) | ADMIN_MANAGER | oui — PurchaseOrdersTab.tsx:177 |
| POST | /invoices/:id/schedule | paymentScheduleController.createInvoiceSchedule (payment-schedule.controller.ts:88) | ADMIN_MANAGER | oui — PurchasingPage.tsx:1565 |
| POST | /invoices/:id/cancel | cancel (224) | ADMIN_MANAGER | oui — PurchasingPage.tsx:498 |
| DELETE | /invoices/:id[?force] | remove (283) | ADMIN_MANAGER | oui — PurchasingPage.tsx:483 |
| POST | /invoices/:id/attachment | uploadAttachment (399) | ADMIN_MANAGER | oui — PurchasingPage.tsx:556 |
| DELETE | /invoices/:id/attachment | removeAttachment (408) | ADMIN_MANAGER | oui — PurchasingPage.tsx:562 |
| GET | /invoices/:id/download-pdf | downloadDocx (412) | ADMIN_MANAGER | oui — EmittedInvoicesTab via `invoicesApi.downloadDocx` |
| GET | /invoices/:id/download-docx | downloadDocx (alias, routes.ts:81) | ADMIN_MANAGER | **non** |
| GET | /payments | paymentController.list (588) | ADMIN_MANAGER | oui — ChargesTab |
| GET | /payments/summary | summary (740) | ADMIN_MANAGER | **non** (`paymentsApi.summary` 0 usage) |
| GET | /payments/checks | listChecks (597) | ADMIN_MANAGER | oui — ChequesTab |
| POST | /payments | create (637) | ADMIN_MANAGER | oui — PurchasingPage (Payer), DettesTab, ChargesTab, EcheancierView, EmittedInvoicesTab |
| PUT | /payments/:id | update (732) | ADMIN_MANAGER | oui — ChargesTab |
| POST | /payments/:id/mark-cashed | markCashed (612) | ADMIN_MANAGER | oui — ChequesTab |
| POST | /payments/:id/unmark-cashed | unmarkCashed (628) | ADMIN | oui — ChequesTab |
| DELETE | /payments/:id | remove (736) | ADMIN_MANAGER | oui — InvoicePaymentsModal, ChequesTab, ChargesTab |
| GET | /payment-schedules | paymentScheduleController.list (37) | ADMIN_MANAGER | oui — EcheancierView.tsx:115 |
| GET | /payment-schedules/by-source/:kind/:id | bySource (50) | ADMIN_MANAGER | **non** |
| PATCH | /payment-schedules/:id | update (65) | ADMIN_MANAGER | oui — EcheancierView.tsx:135 |
| GET | /debts | listDebts (118) | ADMIN_MANAGER | **non** (le client lit `standaloneDebts` via GET /invoices/debts) |
| POST | /debts | createDebt (132) | ADMIN_MANAGER | oui — EcheancierView.tsx:558 |
| PATCH | /debts/:id | updateDebt (175) | ADMIN_MANAGER | **non** |
| DELETE | /debts/:id | removeDebt (187) | ADMIN_MANAGER | **non** |
| GET/POST/PATCH/DELETE | /recurring-charges[/:id] | listRecurring/createRecurring/updateRecurring/removeRecurring (199-288) | ADMIN_MANAGER | oui — EcheancierView.tsx:691-836 |
| POST | /purchase-orders/:id/invoice | purchaseOrderController.generateInvoice (purchase-order.controller.ts:253) | ADMIN_MANAGER | oui — PurchaseOrdersTab.tsx:165 |
| POST | /purchase-orders/:id/confirm-delivery | confirmDelivery (crée la facture auto) | ADMIN_MANAGER | oui — PurchaseOrdersTab DeliveryModal:1414 |

## 14. Écrans client

| Fichier | Lignes | Rôle | Contenu réel |
|---|---|---|---|
| client/src/features/purchasing/PurchasingPage.tsx | 383-1240 (`InvoicesTab`/`ReceivedInvoicesSection`), 1244-1531 (`ReceivedInvoiceFormModal`), 1531-1665 (`InvoiceScheduleModal`), 1665-1977 (`InvoiceLinesEditorModal`), 1977-2145 (`InvoicePaymentsModal`) | admin, manager | **L'écran « Factures reçues »** : liste toutes les factures `received` (chargement intégral, filtres client par statut/fournisseur/catégorie/mois/recherche, tri), totaux facturé/payé/reste, actions : payer (modal cash/chèque/traite + avoir), voir/supprimer paiements, modifier (en-tête), lignes (qty × prix × TVA), échelonner, statut manuel, pièce jointe, annuler, supprimer (force si payée) |
| client/src/features/accounting/PurchaseOrdersTab.tsx | 101-600 (liste BC), 1393-1770 (`DeliveryModal`), 1580-1660 (`MergeInvoicesModal`) | admin, manager (annulation réception : admin) | **Onglet BC** (importé par PurchasingPage, pas par AccountingPage) : ce sont les **bons de commande**, pas les factures. Il porte toutefois trois actions facture : saisie du n°/date de facture fournisseur à la réception (1406-1407, 1443-1470), « Générer la facture » (507-523), sélection multi-BC + « Fusionner les factures » (116-117, 243-267, 285-295) |
| client/src/features/accounting/AccountingPage.tsx | 381-1032 `DettesTab` ; 2043-2944 `ChargesTab` ; 2944-3720 `ChequesTab` ; 3720-3809 `ConfirmCashedModal` | admin, manager (section Comptabilité : admin) | Dettes : « Ils nous doivent / Nous leur devons / Échéancier », agrégation par tiers (total, en retard, plus ancienne échéance), paiement direct avec RAS et avoir, export CSV. Charges : paiements hors facture (formulaire dépense avec BC optionnel) + lignes des factures intégralement payées (date = dernier encaissement), catégorisation par ligne. Chèques et Traites : KPIs retard/7j/30j, regroupement par effet, confirmation/annulation d'encaissement, suppression |
| client/src/features/accounting/EcheancierView.tsx | 103-365 vue ; 366-541 modals paiement/édition ; 541-683 dette ; 683-969 charges fixes | admin, manager | Calendrier des échéances (mig 258), jamais alimenté en prod |
| client/src/components/PaymentAlertsWidget.tsx | 38-282 | admin, manager (HomePage + AccountingPage) | Échéances ≤ N jours : factures (si due_date), chèques/traites non encaissés, échéances ; regroupe les chèques multi-factures ; liens vers /purchasing et /accounting |
| client/src/features/sales/EmittedInvoicesTab.tsx | — | — | Factures **émises** (clients) : hors périmètre, partage `invoicesApi` |

## 15. Scripts

| Script | Rôle | Remarques |
|---|---|---|
| server/src/scripts/reconcile-invoice-payments.ts | diagnostic drift `paid_amount` vs SUM(payments), sur-paiements, doublons ; `--dedupe`, `--recompute`, `--commit` | dry-run par défaut ; traite la cause (doublons) et le symptôme |
| server/src/scripts/import-invoices-excel.ts | import factures + PO rétroactif + BR + lots depuis « Entrées Économat » | hard-codé store `0000…0001`, règles DLC par mot-clé, matching flou des articles, idempotence (n°, fournisseur) |
| server/src/scripts/import-cheques-excel.ts | import « TALON CHQ » → payments, 3 rapprochements chèque→factures **codés en dur** (n° 1237397, 1237393, 1237406) | one-shot, marque `paid` sans passer par `updatePaidAmount` |
| server/src/scripts/cleanup-cheques-payments.ts | annule l'import précédent | one-shot |
| server/src/scripts/fix-cheque-dates-and-numbers.ts | `check_date := due_date`, `invoices.check_number := dernier chèque` | correctif de données ; explique une partie des 7 « encaissés avant échéance » |

## 16. Statistiques réelles

| Mesure | Résultat | SQL |
|---|---|---|
| Délai BR → facture | 292 factures liées à un BR ; moyenne −0,2 j, médiane 0, min −19, max 1 ; écart `created_at` 0,07 j | `SELECT count(*), round(avg(inv.invoice_date - rv.reception_date),1), percentile_cont(0.5) WITHIN GROUP (ORDER BY inv.invoice_date - rv.reception_date), min(...), max(...) FROM invoices inv JOIN reception_vouchers rv ON rv.id=inv.reception_voucher_id WHERE inv.invoice_type='received'` |
| Délai facture → dernier paiement (factures payées) | 280 ; moyenne 3,9 j, médiane 0, min −4, max 81 | `SELECT count(*), round(avg(d),1), percentile_cont(0.5) WITHIN GROUP (ORDER BY d), min(d), max(d) FROM (SELECT inv.id, max(p.payment_date) - inv.invoice_date d FROM invoices inv JOIN payments p ON p.invoice_id=inv.id WHERE inv.invoice_type='received' AND inv.status='paid' GROUP BY 1, inv.invoice_date) x` |
| Paiements datés avant la facture | 13 | `SELECT count(*) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.payment_date < i.invoice_date` |
| Factures sans BC | 23 (76 129,21 DH), toutes sans lignes ni BR | §3.4 |
| BC livrés sans facture | `livre_complet` 4 (4 346,20 DH), `en_attente_facturation` 1 (BC-2026-0230, 3 lignes sans prix), `envoye` 3, `annule` 1 | `SELECT po.status, count(*) FROM purchase_orders po WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.purchase_order_id=po.id AND i.status<>'cancelled') AND NOT EXISTS (SELECT 1 FROM invoice_purchase_orders ipo WHERE ipo.purchase_order_id=po.id) GROUP BY 1` |
| Dettes fournisseurs ouvertes | 37 factures, 89 546,37 DH ; âge moyen 74 j, max 142 j | `SELECT count(*), round(sum(total_amount-paid_amount),2) FROM invoices WHERE invoice_type='received' AND status NOT IN ('paid','cancelled') AND total_amount-paid_amount>0.01` |
| Balance âgée (par date de facture) | 0-30 j : 5 (3 189,63) ; 31-60 : 4 (5 655,46) ; 61-90 : 17 (58 008,71) ; > 90 : 11 (22 692,57) | `SELECT CASE WHEN CURRENT_DATE-invoice_date<=30 THEN '0-30' WHEN ...<=60 THEN '31-60' WHEN ...<=90 THEN '61-90' ELSE '>90' END, count(*), round(sum(total_amount-paid_amount),2) FROM invoices WHERE invoice_type='received' AND status NOT IN ('paid','cancelled') GROUP BY 1` |
| Top dettes par fournisseur | Ecomab 11 fact. 35 614,38 ; OVOTEC 9 / 19 976,33 ; MAGHREBLAC 1 / 17 100,00 | `... GROUP BY s.name ORDER BY 3 DESC` |
| Doublons (fournisseur, n°) | 0 — mais 253/317 numéros internes | `SELECT supplier_id, invoice_number, count(*) FROM invoices WHERE invoice_type='received' GROUP BY 1,2 HAVING count(*)>1` |
| Pièces jointes | 0 / 317 | `count(attachment_url)` |
| Factures créées par rôle | manager 272, admin 45 ; paiements manager 535, admin 153, créateur NULL 1 | join users |
| Facturation mensuelle | 2026-07 : 177 fact. / 154 255,60 ; 2026-06 : 107 / 110 858,05 ; 2026-08 : 11 / 9 006,34 ; 2026-10 : 5 / 3 189,63 | `to_char(invoice_date,'YYYY-MM')` |

## 17. Rôles, audit, tests

- Tous les endpoints facture/paiement : `ADMIN_MANAGER` (shared/src/constants/roles.ts:25). Exceptions ADMIN : `unmark-cashed`, `cancel-reception`, suppression BC. **Aucune séparation des tâches** : le même rôle réceptionne, génère la facture, la modifie, la paie, supprime le paiement ou la facture.
- Contrôle magasin : `findAll`, `getById`, `update`, `remove`, `replaceItems`, `updatePaymentTerms`, `updateStatusManual` vérifient `store_id` ; `cancel` (controller 224-227), `updateLineCategory`, `uploadAttachment`, `merge`, `payments.update/remove` ne le font pas.
- Piste d'audit : aucune pour `invoices`/`payments` (pas de `updated_at`, pas de table d'historique ; des audit trails existent ailleurs : mig 239 RH, 264 BOM, 298 BSI). Suppressions physiques possibles (`DELETE /invoices/:id?force=true`, `DELETE /payments/:id`, fusion).
- Tests : `server/src/__tests__/tva.test.ts` (helpers purs) uniquement ; aucun test sur `invoiceRepository`/`paymentRepository`/`createInvoiceFromPo`/`mergeForPurchaseOrders`.
- Pièces jointes stockées sur le FS local `/uploads/invoices` (accounting.routes.ts:13-28) — éphémère sur Cloud Run (cf. mémoire projet « Uploads Cloud Run éphémère »).

## 18. Code mort / jamais appelé / jamais alimenté

Endpoints sans appel client : `PUT /invoices/:id/category`, `PUT /invoices/:id/payment-terms`, `GET /invoices/:id/download-docx`, `GET /payments/summary`, `GET /payment-schedules/by-source/:kind/:id`, `GET /debts`, `PATCH /debts/:id`, `DELETE /debts/:id` (fonctions `invoicesApi.updateCategory`, `updatePaymentTerms`, `paymentsApi.summary`, `paymentSchedulesApi.bySource`, `debtsApi.list/setStatus/remove` définies mais 0 usage).

Colonnes / mécanismes jamais alimentés : `payments.purchase_order_id` (0), `payments.check_attachment_url` (0, aucun code client), `payments.import_source` (0), `payments.withholding_*` (0, UI présente dans DettesTab), `payments.session_id` (0), `payments.scheduled_payment_id` (0), `invoices.attachment_url` (0), tables `scheduled_payments`/`debts`/`recurring_charges` (0), statut `overdue` (jamais produit), `expense_categories.requires_po` + `ENFORCE_PO_REQUIREMENT` (désactivé serveur et client), `FLAGS.LEDGER_BACKED_DEBTS`/`LEDGER_SHADOW_MODE` (jamais lus), `invoices.reception_date` (écrit, jamais lu par une requête métier), entrée `ref_entries` payment_methods au code vide.

Scripts one-shot avec données codées en dur : `import-cheques-excel.ts`, `cleanup-cheques-payments.ts`, `fix-cheque-dates-and-numbers.ts`.

## 19. Points forts

1. Création de facture atomique avec la réception (même transaction, `createInvoiceFromPo`), idempotente, avec n° fournisseur si saisi et catégorie par ligne figée (mig 255).
2. Paiement de facture robuste : verrou `FOR UPDATE`, garde sur-paiement (tolérance 0,01), garde doublon de chèque, `paid_amount` resynchronisé dans la même transaction, 0 dérive en base ; script de réconciliation disponible.
3. Distinction émission / encaissement des chèques et traites (`cashed_at`), appliquée de façon cohérente dans la caisse, les charges et les alertes ; onglet dédié avec regroupement par effet.
4. TVA par ligne (mig 189) avec ventilation par taux dans les écritures, et helpers purs testés.
5. Génération comptable intégrée (4411 auxiliaire, lettrage automatique, extourne à la suppression, blocage si période close) et vue de réconciliation legacy↔ledger.
6. Échéancier complet (facture échelonnée, dette autonome, charges récurrentes idempotentes) prêt à l'emploi, même s'il n'est pas encore utilisé.
7. Fusion multi-BC avec garde-fous (même fournisseur, aucun paiement) et jonction M:N persistée.
8. Retenue à la source et avoir intégrés au flux de paiement fournisseur (DettesTab).

## 20. Faiblesses (étayées, par sévérité)

### Critiques

W1 — **Aucun rapprochement 3 voies ni verrou facture ↔ BR/BC** (D6, D5). `PUT /invoices/:id` et `PUT /invoices/:id/items` (accounting.repository.ts:1142-1240, 1069-1140) modifient montants et lignes sans comparer au BC/BR ; seule garde `total >= paid`. 36 factures liées à un BC divergent de leur BR (16 662,75 DH), 35 du BC. Impact : paiement de montants non livrés/non commandés possible sans alerte ; pas de statut « bloquée pour écart ».

W2 — **Les factures auto depuis BC n'ont jamais de TVA** (D6, D8). `createInvoiceFromPo` insère `tax_amount = 0` et `total = HT` (reception-voucher.repository.ts:168-176), lignes sans `tva_rate` (180-185). 263 factures / 167 352,90 DH HT sans TVA. Impact : TVA déductible non enregistrée, TTC payé ≠ total facture système (le fournisseur facture TTC), écritures 3455 absentes ; corrections manuelles au cas par cas (31 reprises).

W3 — **Aucune échéance sur les dettes ouvertes → suivi des retards inopérant** (D7). `due_date` n'est jamais posée par les flux auto ni dérivée de conditions fournisseur (table `suppliers` sans conditions) ; 0/37 factures ouvertes (89 546 DH) ont une échéance ; statut `overdue` jamais calculé (grep) ; branche « factures » de `findPaymentAlerts` (1341-1352) et KPI dashboard (dashboard.repository.ts:118-128) vides par construction. 11 factures ont > 90 jours.

W4 — **Fusion de factures sans mise à jour du ledger** (D6, D8). `mergeForPurchaseOrders` (767-920) supprime physiquement les factures absorbées (901-905) et modifie le montant du maître (863-875) sans `reverseEntriesForSource`/`regenerateInvoiceEntry` (aucune référence `FLAGS`/ledger dans la fonction). Avec `LEDGER_AUTOGEN`, les écritures 4411 des factures supprimées subsistent et celle du maître reste à l'ancien montant → solde fournisseur et TVA faux.

W5 — **Avoir comptabilisé comme sortie de caisse** (D6, D8). `payment_method='avoir'` tombe dans `default: creditCode='5161'` de `fromPaymentEmission` (journal-generator.service.ts:512-513) ; vérifié : écriture 4411 D / 5161 C 1 200 DH. Il est aussi compté comme dépense dans `paymentRepository.findAll/summary`. Pas d'entité avoir (pas de réduction de charge/TVA, pas d'avoir autonome ni reportable).

W6 — **Numéro de facture fournisseur non maîtrisé et pas d'unicité** (D6, D10). 253/317 factures portent un n° interne `FR-…` (notes `Facture auto-generee…`) ; aucune contrainte unique (supplier_id, invoice_number) ; `POST /invoices` et `PUT /invoices/:id` ne testent pas le doublon (seule la réception le fait, reception-voucher.repository.ts:318-338) ; `generateInvoiceNumber` (577-589) réattribue un numéro après suppression physique. Impact : double saisie/paiement indétectable, piste fiscale faible.

### Majeures

W7 — **Transitions de statut sans règles** (D6). `PUT /invoices/:id/status` accepte tout statut de la liste (controller 384-397) ; `POST /invoices/:id/cancel` sans vérification des paiements ni du magasin (224-227) ; `updatePaidAmount` transforme une facture `cancelled` en `paid` si on la paie (956-958). Suppression physique facture + paiements (`force=true`) ouverte au manager.

W8 — **Modification d'un paiement sans garde sur-paiement et sans correction possible du chèque** (D7). `paymentRepository.update` (2072-2107) accepte un nouveau `amount` sans comparer au reste dû ; `check_number`/`check_date`/`invoice_id` non modifiables → la seule voie est supprimer/recréer (perte de `cashed_at`).

W9 — **BC multi-factures et livraisons partielles facturées non supportés** (D6, D5). Une seule facture non annulée par BC (reception-voucher.repository.ts:85-89), créée seulement en `livre_complet` ; 8 BC ont ≥ 2 BR ; le n° fournisseur du BR le plus récent écrase les autres (138-144). Pas de provision « reçu non facturé » pour les BC `livre_partiel`/`en_attente_facturation` (BC-2026-0230 attend depuis le 2026-07-21).

W10 — **Pas de balance âgée ni de relevé fournisseur** (D7, D9). `findOpenDebts` (1411-1450) renvoie une liste plate ; DettesTab agrège total/retard/plus ancienne échéance sans tranches 30/60/90 ; aucun endpoint ledger de balance âgée ; export CSV seulement. Les 4411 par auxiliaire existent mais ne sont pas exploités par vieillissement.

W11 — **Pas de conditions de paiement fournisseur ni de calcul d'échéance** (D1, D7). `suppliers` : aucune colonne terme/mode ; `expected_payment_mode`, `due_date`, `check_number` ressaisis à chaque facture ; `updatePaymentTerms` existe mais n'est pas appelé.

W12 — **Chèque multi-factures géré côté client** (D7). N lignes `payments` par chèque ; regroupement par normalisation du n° (AccountingPage.tsx:3126) — « AAA 5100009 » et « AAA  5100009 » coexistent ; `markCashed` en `Promise.all` de N appels (2971-2973) non atomique ; `check_number` libre, pas de carnet de chèques, pas de contrôle inter-fournisseurs.

W13 — **Référentiel des modes de paiement non filtré pour les fournisseurs** (D7, D10). Les formulaires « Payer » listent `card`, `mobile`, `deferred`, `mixed` et une entrée au code vide « Traite » ; tout mode inconnu est comptabilisé en 5161 cash (journal-generator.service.ts:512-513).

W14 — **Génération comptable dépendante d'un flag d'environnement non versionné** (D8, D10). `LEDGER_AUTOGEN` OFF par défaut hors dev (feature-flags.ts:29-33), aucun fichier de déploiement ne le fixe ; échecs de génération seulement journalisés (SAVEPOINT). 23 factures reçues sans écriture, 5 divergences legacy/ledger (§2.6).

### Mineures

W15 — **Pas de piste d'audit ni d'horodatage de modification** (D10) sur `invoices`/`payments` (pas d'`updated_at`, pas d'historique), alors que RH/BOM/BSI en ont (mig 239/264/298).

W16 — **Code mort et fonctionnalités dormantes** (D10) : 8 endpoints sans appel client, échéancier mig 258 non utilisé (0 ligne), `requires_po` désactivé, `purchase_order_id`/`check_attachment_url`/`import_source`/`withholding` sur payments à 0, flags `LEDGER_BACKED_DEBTS`/`SHADOW` jamais lus, `reception_date` jamais lu.

W17 — **Incohérences de dates** (D7) : 13 paiements antérieurs à la date de facture (facture auto datée du jour de réception), 7 effets encaissés avant `check_date`, `reception_date` défaut = aujourd'hui.

W18 — **Pièces jointes inexistantes et stockage éphémère** (D10) : 0 facture avec `attachment_url` ; upload sur FS local `/uploads/invoices` (accounting.routes.ts:13-28) perdu à chaque déploiement Cloud Run.

W19 — **Écran « Factures reçues » charge l'intégralité** des factures et filtre côté client (PurchasingPage.tsx:451-457) ; pas de pagination ni de recherche serveur (acceptable à 317 lignes, pas à 5 000).

W20 — **Aucun test** sur les dépôts facture/paiement (seul `tva.test.ts`).

## 21. Questions ouvertes

1. `LEDGER_AUTOGEN` est-il activé sur Cloud Run en production ? (non visible dans le dépôt). Si non, les 292 écritures observées viennent du backfill et toute l'intégration comptable « temps réel » est inactive en prod.
2. Les 36 écarts facture/BR sont-ils des corrections de prix légitimes (facture fournisseur ≠ BR) ou des saisies incomplètes (BR sans prix) ? Le cas 516624 (7 250 DH vs BR 0) suggère la seconde hypothèse.
3. Les fournisseurs facturent-ils TTC ? Si oui, les 263 factures auto sans TVA sous-estiment la dette de 7 à 20 % et le `paid_amount` a été aligné sur un total HT.
4. Qui doit pouvoir supprimer physiquement une facture ou un paiement (aujourd'hui : manager) ? Faut-il réserver la suppression à l'admin et imposer l'annulation tracée ?
5. L'échéancier (mig 258) est-il destiné à être utilisé pour les fournisseurs d'exploitation (échéances à 30/60 j) ou seulement pour le matériel à crédit et les charges fixes ?
6. Le script `import-cheques-excel.ts` et ses rapprochements codés en dur doivent-ils être conservés ?
7. Les 5 factures en divergence legacy/ledger (2605464, FR-2026-0059, 20260430, 20260522, 26F22927) ont-elles été traitées en prod (mémoire : « SUIVI PROD à faire sur 2 factures ») ?
