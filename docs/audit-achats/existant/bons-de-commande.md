# Existant — Bon de commande fournisseur (BC) — domaines D3 (sourcing/approbation) et D4 (commande)

Audit en lecture seule du 2026-10-11. Dépôt `/Users/anissbouida/projets/Ofauria-app`. Base locale (copie récente de la prod, dernière migration appliquée : `303_foret_noire_10065_fiche_technique.sql`).

Convention : les chemins sont relatifs au dépôt, `fichier:ligne`. Les requêtes SQL ont été exécutées avec `PGOPTIONS='-c default_transaction_read_only=on'`.

---

## 0. Périmètre et fichiers lus

| Couche | Fichier | Lignes | Rôle |
|---|---|---|---|
| Migrations | `server/migrations/033_purchase_orders.sql` | 44 | Création `purchase_orders` + `purchase_order_items`, 6 statuts |
| | `server/migrations/036_align_decimal_precision.sql:69` | — | `unit_price` → `DECIMAL(12,4)` |
| | `server/migrations/038_expense_po_control.sql` | 32 | `payments.purchase_order_id`, `expense_categories.requires_po` |
| | `server/migrations/055_po_invoice_payment_refactor.sql` | 86 | `unit_price` nullable, statut `en_attente_facturation`, tables `reception_vouchers(_items)`, `invoices.purchase_order_id` |
| | `server/migrations/057_purchase_requests.sql` | 24 | DA → `purchase_requests.purchase_order_id` (ON DELETE SET NULL) |
| | `server/migrations/110_packaging_po_bsi.sql` | 38 | `purchase_order_items.packaging_id`, CHECK exclusif ingrédient/consommable |
| | `server/migrations/156_backfill_invoice_category_from_po.sql` | 58 | Backfill catégorie des factures auto-créées depuis BC |
| | `server/migrations/178_invoice_purchase_orders_junction.sql` | 29 | Jonction M:N facture ↔ BC |
| | `server/migrations/188_widen_purchase_orders_status.sql` | 18 | `status` VARCHAR(20) → VARCHAR(30) (bug `en_attente_facturation` 22 car.) |
| | `server/migrations/207_purchase_consumable_routing.sql` | 74 | `fn_purchasable_kind`, `reception_voucher_items.packaging_id` |
| | `server/migrations/271_purchase_request_received.sql` | 51 | Statut `received` sur DA, backfill |
| Serveur | `server/src/routes/purchase-order.routes.ts` | 30 | 16 routes |
| | `server/src/controllers/purchase-order.controller.ts` | 403 | Handlers (dont PDF) |
| | `server/src/repositories/purchase-order.repository.ts` | 610 | SQL BC |
| | `server/src/repositories/reception-voucher.repository.ts` | 780 | **Transitions de statut à la réception** + `createInvoiceFromPo` + `cancelForPurchaseOrder` |
| | `server/src/controllers/reception-voucher.controller.ts` | 53 | Endpoint BR direct (jamais appelé par le client) |
| | `server/src/repositories/purchase-request.helper.ts` | 48 | `closePurchaseRequestsForOrder` |
| | `server/src/repositories/purchase-request.repository.ts:161-251` | — | `generatePO` (BC depuis DA) |
| | `server/src/services/container-rule.ts` | 89 | Règle « contenant entier » |
| | `server/src/services/purchase-order-pdf.service.ts` | 328 | PDF BC (PDFKit) |
| | `server/src/repositories/accounting.repository.ts:770-905` | — | `invoicesApi.merge` (fusion factures multi-BC) |
| | `server/src/controllers/accounting.controller.ts:665-680` | — | Garde `requires_po` (désactivée) |
| | `shared/src/constants/roles.ts` | 40 | `ROLE_GROUPS.ADMIN_MANAGER = [admin, manager]` |
| Client | `client/src/api/purchase-orders.api.ts` | 57 | `purchaseOrdersApi` + `receptionVouchersApi` |
| | `client/src/features/purchasing/PurchasingPage.tsx` | 2145 | Page Achats : onglets ; **délègue l'onglet BC à** `PurchaseOrdersTab` (l.18, l.95) |
| | `client/src/features/accounting/PurchaseOrdersTab.tsx` | 2164 | **Toute l'UI BC** (liste, création, détail, réception, édition admin, fusion) |
| | `client/src/features/accounting/AccountingPage.tsx:2099-2116` | — | Usage de `eligible` + flag `ENFORCE_PO_REQUIREMENT = false` |
| | `client/src/utils/container.ts` | — | Règle contenant côté client (dupliquée) |

Montage : `server/src/routes/index.ts:85` → `router.use('/purchase-orders', purchaseOrderRoutes)` ; `client/src/App.tsx:88` → route `/purchasing`.

---

## 1. Modèle de données

### 1.1 `purchase_orders` (état réel, `\d+`)

| Colonne | Type | Null | Défaut | Remarques |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | |
| order_number | varchar(50) | non | — | UNIQUE `purchase_orders_order_number_key` |
| supplier_id | uuid | non | — | FK suppliers |
| status | varchar(30) | non | 'en_attente' | CHECK 7 valeurs (mig 055/188) |
| order_date | date | non | CURRENT_DATE | **jamais saisi par l'utilisateur** (= created_at::date sur 304/304) |
| expected_delivery_date | date | oui | | |
| delivery_date | date | oui | | écrasée à chaque réception (CURRENT_DATE) |
| notes | text | oui | | 0/304 renseignée |
| store_id | uuid | oui | | FK stores ; 304/304 renseigné (1 seul store en base) |
| created_by | uuid | oui | | FK users |
| created_at / updated_at | timestamptz | | now() | pas de trigger sur updated_at (mis à jour à la main) |

Absents vs ERP standard : `approved_by/approved_at`, `sent_at`, `sent_by`, `version/revision`, `currency`, `payment_terms`, `tax_amount`, `discount`, `shipping_cost`, `closed_at/closed_reason`, `supplier_reference`, `confirmed_at` (accusé).

Index : `idx_po_supplier`, `idx_po_status`, `idx_po_date (order_date DESC)`, `idx_po_store`.

Référencée par : `invoice_purchase_orders`, `invoices.purchase_order_id`, `payments.purchase_order_id` (**0 ligne** l'utilise), `purchase_order_items` (CASCADE), `purchase_requests.purchase_order_id` (SET NULL), `reception_vouchers.purchase_order_id` (RESTRICT).

### 1.2 `purchase_order_items`

| Colonne | Type | Null | Remarques |
|---|---|---|---|
| id | uuid | non | |
| purchase_order_id | uuid | non | FK CASCADE |
| ingredient_id | uuid | oui | CHECK `po_item_kind_check` : exactement un de (ingredient_id, packaging_id) |
| packaging_id | uuid | oui | FK packaging_items ON DELETE **SET NULL** (viole potentiellement le CHECK si un consommable est supprimé) |
| quantity_ordered | numeric(12,4) | non | CHECK > 0 |
| quantity_delivered | numeric(12,4) | non | défaut 0 ; **aucune contrainte ≤ quantity_ordered** |
| unit_price | numeric(12,4) | oui | NULL = « prix à définir » (mig 055) |
| created_at | timestamptz | | |

Absents : `unit` (figé), `tva_rate`, `discount`, `line_notes`, `container_type_id/container_qty` (snapshot), `expected_date` par ligne, `quantity_cancelled`, `category_id` (snapshot), `description` libre (une ligne « charge/dépense » n'est pas possible : la ligne DOIT être un ingrédient OU un consommable).

### 1.3 Historique des migrations du périmètre

| Mig | Apport |
|---|---|
| 033 | Création, statuts `en_attente, envoye, livre_complet, livre_partiel, non_livre, annule` ; `inventory_transactions.purchase_order_item_id` ; type `purchase_order` (jamais utilisé : 0 transaction de ce type en base, cf. §2.8) |
| 036 | `unit_price` DECIMAL(10,4) → (12,4) |
| 038 | « BC dépense » : `payments.purchase_order_id`, `expense_categories.requires_po` (48 catégories à true aujourd'hui) |
| 055 | `unit_price` nullable ; statut `en_attente_facturation` ; tables BR ; `invoices.purchase_order_id` |
| 110 | Lignes consommables (`packaging_id`) |
| 178 | Jonction `invoice_purchase_orders` (fusion de factures multi-BC) |
| 188 | Correctif : colonne trop courte pour `en_attente_facturation` (bug prod) |
| 207 | `fn_purchasable_kind` ; routage réception consommable |
| 271 | DA → `received` à la réception du BC |

---

## 2. Volumes et faits (base locale)

### 2.1 Statuts

```sql
SELECT status, COUNT(*), MIN(order_date), MAX(order_date) FROM purchase_orders GROUP BY status;
```
| status | n | min | max |
|---|---|---|---|
| livre_complet | 299 | 2026-06-04 | 2026-10-09 |
| envoye | 3 | 2026-07-07 | 2026-07-28 |
| en_attente_facturation | 1 | 2026-07-21 | 2026-07-21 |
| annule | 1 | 2026-07-02 | 2026-07-02 |

Jamais observés en base : `en_attente` (0), `livre_partiel` (0), `non_livre` (0).

### 2.2 BC non terminés (« jamais livrés »)

```sql
SELECT po.order_number, po.status, CURRENT_DATE - po.order_date AS age_days, (rvs), (invs), (prs) ...
```
| N° | statut | âge (j) | fournisseur | lignes | montant | BR | factures | DA |
|---|---|---|---|---|---|---|---|---|
| BC-2026-0147 | envoye | **96** | Abdelilah | 3 | 0,00 (prix NULL) | 0 | 0 | 0 |
| BC-2026-0269 | envoye | **75** | RICA MAROC | 7 | 9 455,00 | 0 | 0 | 0 |
| BC-2026-0270 | envoye | **75** | SMCP-E | 4 | 740,00 | 0 | 0 | 0 |
| BC-2026-0230 | en_attente_facturation | 82 | BS2M | 3 | 0,00 (prix NULL) | 1 | 0 | 0 |
| BC-2026-0117 | annule | 101 | Ecomab | 6 | 0,00 | 0 | 0 | 0 |

Les 3 `envoye` datent de juillet 2026 (75 à 96 jours). Deux (0147, 0269) n'ont pas de date de livraison prévue → **jamais remontés par `findOverdue`** (filtre `expected_delivery_date IS NOT NULL`, `purchase-order.repository.ts:537`). Aucun mécanisme de clôture/relance.

### 2.3 Numérotation

```sql
SELECT CASE WHEN order_number ~ '^BC-[0-9]{4}-[0-9]{4}$' THEN 'BC-YYYY-NNNN' ELSE 'autre' END, COUNT(*), MIN(order_number), MAX(order_number) FROM purchase_orders GROUP BY 1;
-- BC-YYYY-NNNN | 304 | BC-2026-0001 | BC-2026-0305
SELECT s FROM generate_series(1,305) s WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE order_number='BC-2026-'||lpad(s::text,4,'0'));
-- 4   (BC-2026-0004 supprimé)
```
Un trou (0004), cohérent avec le commentaire `purchase-order.repository.ts:105-110` (passage de COUNT+1 à MAX+1 après collision).

### 2.4 Dates — le BC est saisi a posteriori

```sql
SELECT COUNT(*) FILTER (WHERE order_date <> created_at::date), COUNT(*) FROM purchase_orders;         -- 0 | 304
SELECT COUNT(*) FROM purchase_orders po JOIN reception_vouchers rv ON rv.purchase_order_id=po.id
 WHERE rv.created_at - po.created_at < INTERVAL '10 minutes';                                          -- 261
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY d), AVG(d), MAX(d), COUNT(*) FILTER (WHERE d=0), COUNT(*)
  FROM (SELECT MIN(rv.reception_date)-po.order_date d FROM purchase_orders po JOIN reception_vouchers rv ... GROUP BY po.id) t;
-- médiane 0 j | moyenne 0,15 j | max 7 j | même jour : 266/298
SELECT CASE WHEN expected_delivery_date IS NULL THEN 'null' WHEN expected_delivery_date < order_date THEN 'avant'
            WHEN expected_delivery_date = order_date THEN 'jour meme' ELSE 'apres' END, COUNT(*) FROM purchase_orders GROUP BY 1;
-- jour meme 142 | apres 2 | avant 59 | null 101
```
Lecture : 261 BC sur 298 sont réceptionnés **moins de 10 minutes après leur création** ; 59 ont une « livraison prévue » **antérieure** à la date de commande (l'utilisateur y saisit la date réelle d'achat, faute de champ `order_date` éditable). Le BC fonctionne comme un formulaire de saisie d'achat/réception, pas comme un document de commande envoyé en amont. Seuls 2 BC ont une livraison prévue postérieure.

### 2.5 Lignes

```sql
SELECT kind, COUNT(*), no_price, zero_price, over_delivered, under_delivered FROM purchase_order_items ... GROUP BY kind;
```
| kind | n | prix NULL | prix 0 | sur-livrées | sous-livrées |
|---|---|---|---|---|---|
| ingredient | 658 | 12 | 1 | **12** | 20 |
| consumable | 152 | 3 | 0 | 0 | 0 |

Moyenne 2,72 lignes/BC (min 1, max 17). 0 doublon d'article dans un même BC. 64 ingrédients achetés chez ≥ 2 fournisseurs.

Exemples de sur-livraison (aucune garde serveur, cf. §10) :
| BC | article | commandé | livré |
|---|---|---|---|
| BC-2026-0297 | Prép. poudre crème pâtissière MAB | 0,0035 | 5,0000 |
| BC-2026-0297 | Oeufs entiers liquides | 1,5593 | 5,0000 |
| BC-2026-0295 | Semoule kenz | 4,0000 | 20,0000 |
| BC-2026-0017 | Créme cuisson | 4,0000 | 12,0000 |

### 2.6 Cohérence BC ↔ BR ↔ facture

```sql
-- quantity_delivered vs somme des BR
SELECT COUNT(*), COUNT(*) FILTER (WHERE ABS(poi.quantity_delivered - COALESCE(r.sum_rcv,0)) > 0.0001) FROM purchase_order_items poi LEFT JOIN (...) r ON ...;
-- 810 | 16 écarts  (ex. BC-2026-0216 livré 300 / BR 600 ; BC-2026-0124 5 lignes livrées sans aucun BR)
SELECT COUNT(*) FROM purchase_orders po WHERE status='livre_complet' AND NOT EXISTS (SELECT 1 FROM reception_vouchers WHERE purchase_order_id=po.id);
-- 2  (BC-2026-0015, BC-2026-0124 : delivery_date NULL → passés livre_complet par replaceItems)
SELECT COUNT(*) FROM purchase_orders po WHERE status='livre_complet' AND NOT EXISTS (facture non annulée liée);
-- 4  (BC-2026-0051 208,20 ; 0070 188,00 ; 0108 1 600,00 ; 0109 2 350,00)
-- montant livré BC vs facture (BC livre_complet avec 1 facture)
-- 293 BC | 4 sans facture | 0 multi-facture | 53 écarts > 0,01
--   dont 27 : HT identique, TVA ajoutée sur la facture (BC sans TVA, facture auto créée avec tax_amount=0 puis corrigée)
--   dont 26 : HT différent (lignes de facture éditées après coup, ex. BC-2026-0215 BC 90,00 / facture 70,00)
SELECT COUNT(*) FILTER (WHERE tax_amount=0), COUNT(*) FILTER (WHERE tax_amount>0), COUNT(*) FROM invoices WHERE invoice_type='received' AND purchase_order_id IS NOT NULL;
-- 263 | 31 | 294
SELECT COUNT(*) FROM inventory_transactions WHERE note LIKE 'Admin edit BC%';   -- 16 (2026-06-10 → 2026-07-18)
SELECT COUNT(*) FROM packaging_stock_transactions WHERE note LIKE 'Admin edit BC%'; -- 6
SELECT COUNT(*) FROM invoices i JOIN purchase_orders po ON po.id=i.purchase_order_id WHERE i.supplier_id<>po.supplier_id; -- 0
```

### 2.7 BC « dépense » (mig 038)

```sql
SELECT COUNT(*) FILTER (WHERE purchase_order_id IS NOT NULL), COUNT(*) FROM payments;        -- 0 | 689
SELECT requires_po, COUNT(*) FROM expense_categories GROUP BY 1;                           -- f 87 | t 48
SELECT COUNT(*) links, COUNT(DISTINCT invoice_id), COUNT(DISTINCT purchase_order_id) FROM invoice_purchase_orders; -- 35 | 34 | 35
SELECT COUNT(*) FROM (SELECT invoice_id FROM invoice_purchase_orders GROUP BY 1 HAVING COUNT(*)>1) t;        -- 1 fusion réelle
```

### 2.8 Divers

```sql
SELECT type, COUNT(*), COUNT(*) FILTER (WHERE purchase_order_item_id IS NOT NULL) FROM inventory_transactions GROUP BY 1;
-- restock 640 (634 liés à une ligne BC) | adjustment 251 (0) | production 119 | waste 6   → type 'purchase_order' (mig 033) jamais utilisé
SELECT u.role, COUNT(*) FROM purchase_orders po JOIN users u ON u.id=po.created_by GROUP BY 1;  -- manager 289 | admin 15
SELECT COUNT(*) FROM stores;  -- 1
SELECT COUNT(*) FILTER (WHERE reception_date <> created_at::date), COUNT(*) FROM reception_vouchers; -- 0 | 307 (aucune réception antidatée possible)
SELECT COUNT(*) FILTER (WHERE supplier_invoice_number IS NOT NULL), COUNT(*) FROM reception_vouchers; -- 46 | 307
-- Volume mensuel : 2026-06 103 BC (68 399 DH) ; 2026-07 185 (149 466) ; 2026-08 11 (9 006) ; 2026-10 5 (3 190)
-- Top fournisseurs par nb de BC : Épicerie 87, Marché aux puces 72, Abedlkrim 23, Ecomab 18 (40 386 DH), Supeco 14, OVOTEC 11 (19 664 DH)
-- Volatilité prix (≥5 achats) : Kiwi 0,0444→53 ; Mangue 0,04→40 ; Eau de fleur d'oranger 4→235 ; Filet de dinde fumé 7,9→155 (erreurs d'unité/saisie non détectées)
-- ingredients.unit_cost vs dernier prix BC : 269 ingrédients, 2 divergent (le « dernier prix fait foi » est bien appliqué)
```

---

## 3. Machine à états telle que CODÉE

Les statuts sont des chaînes libres côté code (aucun enum TS partagé ; la seule liste fermée est le CHECK SQL). Aucune table d'historique de statut.

```
                 POST /:id/send (ctrl:65-74, guard status==='en_attente' l.68)
  en_attente ───────────────────────────────────────────────► envoye
     │  ▲                                                        │
     │  │ (aucune transition retour codée)                       │ POST /:id/confirm-delivery (ctrl:76-100, guard ['envoye','livre_partiel'] l.80)
     │  │                                                        │   → receptionVoucherRepository.create (rv-repo:284-560)
     │  │                                                        │       status calculé rv-repo:508-524 :
     │  │                                                        │         allDelivered && prixManquants → en_attente_facturation
     │  │                                                        │         allDelivered                  → livre_complet (+ facture auto l.541-544)
     │  │                                                        │         someDelivered                 → livre_partiel
     │  │                                                        │         sinon                         → non_livre (inatteignable : items filtrés qty>0)
     │  │                                                        ▼
     │  │        ┌──────────────── livre_partiel ◄──────────────┤
     │  │        │ confirm-delivery (boucle)      │              │
     │  │        │                                ▼              ▼
     │  │        │                        livre_complet    en_attente_facturation
     │  │        │                             ▲                  │
     │  │        │   PUT /:id/items resync (po-repo:462-488) ─────┘  (tous prix saisis → livre_complet, po-repo:470-471)
     │  │        │   POST /:id/update-prices (po-repo:243-262) ───┘  (idem, endpoint jamais appelé par le client)
     │  │        │
     │  │        │   POST /:id/cancel-reception (ADMIN, ctrl:127-137 → rv-repo:586-760)
     │  │        │   depuis livre_complet | livre_partiel | en_attente_facturation (guard rv-repo:602) ──► envoye (rv-repo:749)
     │  │        │
     │  │        └── POST /:id/not-delivered (ctrl:104-109) : AUCUNE garde de statut → non_livre depuis n'importe quel statut (y compris livre_complet)
     │  │
     │  └── POST /:id/cancel (ctrl:111-120) : refusé seulement si status ∈ {livre_complet, annule} (l.114)
     │      → annule depuis en_attente, envoye, livre_partiel, en_attente_facturation, non_livre  (sans extourne du stock reçu)
     │
     └── DELETE /:id (ADMIN, ctrl:141-162 ; guard ['en_attente','annule'] l.144 ; po-repo:545-550) : suppression physique (lignes CASCADE, DA SET NULL)
```

Table des transitions codées :

| De | Vers | Déclencheur | Code | Garde | Effets de bord |
|---|---|---|---|---|---|
| (création) | en_attente | POST / | ctrl:41-63 → repo:125-170 | fournisseur + ≥1 ligne | numéro BC, règle contenant (repo:153) |
| (création) | en_attente | POST /purchase-requests/generate-po | purchase-request.repository.ts:161-251 | DA `pending` même fournisseur | DA → `assigned` |
| (création) | livre_complet | script `server/src/scripts/import-invoices-excel.ts:464-468` | — | — | numéro `IMPORT-…` (0 en base locale) |
| en_attente | envoye | POST /:id/send | ctrl:65-74 → repo:172-178 | status==='en_attente' | **rien d'autre** : pas de PDF généré, pas d'email, pas de `sent_at` |
| envoye / livre_partiel | livre_partiel / livre_complet / en_attente_facturation | POST /:id/confirm-delivery | ctrl:76-100 → repo:180-221 → rv-repo:284-560 | status ∈ {envoye, livre_partiel} **vérifié hors transaction** | BR, lots, stock, prix BC écrasés (rv-repo:392-396), unit_cost, DA `received`, facture auto, `delivery_date=CURRENT_DATE` |
| en_attente / envoye / livre_partiel | idem | POST /reception-vouchers | reception-voucher.controller.ts:25-46 (guard l.34 **inclut `en_attente`**) | — | **jamais appelé par le client** |
| en_attente_facturation | livre_complet | POST /:id/update-prices | repo:223-290 | tous prix saisis ET allDelivered | unit_cost ; **pas de facture auto** ; endpoint non appelé par le client |
| tout statut | recalculé | PUT /:id/items | repo:328-500 | FOR UPDATE PO + lignes (repo:339, 351) | stock ajusté sans BR ni lot (repo:506-527), DA fermées ; conserve en_attente/envoye/annule si rien livré (repo:473-478) ; **ne positionne pas `delivery_date`** |
| tout statut sauf livre_complet/annule | annule | POST /:id/cancel | ctrl:111-120 | — | **aucune extourne** si livre_partiel/en_attente_facturation (stock et BR restent) ; DA liées restent `assigned` |
| tout statut | non_livre | POST /:id/not-delivered | ctrl:104-109 | **aucune** | aucun |
| livre_complet / livre_partiel / en_attente_facturation | envoye | POST /:id/cancel-reception (ADMIN) | rv-repo:586-760 | pas de paiement ; lots non entamés | **suppression physique** des BR (l.743), factures (l.666), lots, transactions ; stock −qty avec `GREATEST(…,0)` (l.714) |
| en_attente / annule | (supprimé) | DELETE /:id (ADMIN) | ctrl:141-162 → repo:545-550 | — | DA `purchase_requests.purchase_order_id` → NULL mais statut inchangé |

États terminaux de fait : `livre_complet` (sauf cancel-reception admin et édition admin), `annule` (sauf DELETE ; aucune réactivation), `non_livre` (sortie uniquement via cancel ou PUT /items).

`livre_partiel` n'a jamais existé en base (0) : les BC sont saisis à la réception et clos d'un coup (`forceComplete` aligne `quantity_ordered` sur le livré, rv-repo:486-498).

---

## 4. Numérotation

`purchase-order.repository.ts:100-123` :
- `pg_advisory_xact_lock(hashtext('po_number'))` dans la transaction du client (l.103) ; `generateOrderNumber` DOIT recevoir le client transactionnel (commentaire repo:141-145 : sinon deadlock de pool).
- Format `BC-YYYY-NNNN`, `YYYY = getLocalYear()` (timezone utilisateur, `server/src/utils/timezone.ts:109`), `NNNN = MAX(suffixe) + 1` sur les BC de l'année (`EXTRACT(YEAR FROM order_date) = $1`).
- Réutilisé par `generatePO` des DA (purchase-request.repository.ts:194).
- Conséquence du MAX+1 : si le **dernier** BC de l'année est supprimé (DELETE autorisé sur `en_attente`/`annule`), son numéro est réattribué au prochain BC → un numéro peut désigner successivement deux documents (un BC `annule` a pu être téléchargé en PDF : bouton PDF visible dès que `status !== 'en_attente'`, PurchaseOrdersTab.tsx:498).
- Pas de séquence PostgreSQL (`seq_reception_voucher` créée en mig 055 mais BR aussi en MAX+1, rv-repo:267-281). Pas de préfixe par store ni par type (stock vs dépense).

---

## 5. Endpoints

Tous sous `authenticate` + `authorize(...ROLE_GROUPS.ADMIN_MANAGER)` sauf mention. Aucun validateur (zod) : `server/src/validators/` ne contient rien pour les achats, aucun `validate(` dans `purchase-order.routes.ts`. Aucun `asyncHandler` (0 occurrence) alors que le serveur est en **Express ^4.21** (`server/package.json:22`) : les handlers sans try/catch (list, eligible, getById, send, markNotDelivered, cancel, updatePrices, overdue) laissent une promesse rejetée sans réponse HTTP (commentaire explicite ctrl:46-49).

| Méthode | Chemin | Handler | Rôle | Garde statut | Filtre store | Tx / verrou | Appelé par le client ? |
|---|---|---|---|---|---|---|---|
| GET | /purchase-orders | list (ctrl:18) | A/M | — | oui (l.21) | — | **oui** `purchaseOrdersApi.list` → PurchaseOrdersTab.tsx:121 |
| GET | /purchase-orders/eligible | eligible (ctrl:26) | A/M | statuts repo:57 (inclut en_attente/envoye) | oui | — | **oui** AccountingPage.tsx:2099 (formulaire paiement, contrôle désactivé) |
| GET | /purchase-orders/overdue | overdue (ctrl:293) | A/M | — | **non** | — | **oui** PurchaseOrdersTab.tsx:126 (bandeau) |
| GET | /purchase-orders/:id | getById (ctrl:31) | A/M | — | oui | — | **oui** (4 usages : ExpandedPORow, PODetailModal, DeliveryModal, EditPOModal) |
| POST | /purchase-orders | create (ctrl:41) | A/M | — | store = user | BEGIN/COMMIT + advisory lock | **oui** CreatePOModal:881 |
| POST | /purchase-orders/:id/send | send (ctrl:65) | A/M | en_attente | **non** | **aucune** (read puis UPDATE séparés) | **oui** :137 |
| POST | /purchase-orders/:id/confirm-delivery | confirmDelivery (ctrl:76) | A/M | envoye/livre_partiel (**hors tx**) | **non** | tx dans rv-repo ; FOR UPDATE lignes (rv:378) et inventory (rv:447) ; **pas de FOR UPDATE sur le BC** | **oui** DeliveryModal:1414 |
| POST | /purchase-orders/:id/not-delivered | markNotDelivered (ctrl:104) | A/M | **aucune** | **non** | aucune | **oui** :171 (UI limite à envoye/livre_partiel) |
| POST | /purchase-orders/:id/cancel | cancel (ctrl:111) | A/M | ≠ livre_complet/annule | **non** | aucune | **oui** :141 |
| POST | /purchase-orders/:id/cancel-reception | cancelReception (ctrl:127) | **ADMIN** | livre_* / en_attente_facturation | non | tx + FOR UPDATE BC et BR | **oui** :151 |
| POST | /purchase-orders/:id/update-prices | updatePrices (ctrl:164) | A/M | **aucune** | **non** | tx | **NON — code mort** (0 usage de `purchaseOrdersApi.updatePrices`) |
| POST | /purchase-orders/:id/invoice | generateInvoice (ctrl:253) | A/M | livre_complet (repo:575) | oui | tx + FOR UPDATE BC | **oui** :178 |
| PUT | /purchase-orders/:id | updateHeader (ctrl:180) | A/M | **aucune** (fournisseur modifiable après facturation) | oui | aucune | **oui** EditPOModal:1850 |
| PUT | /purchase-orders/:id/items | replaceItems (ctrl:206) | A/M | aucune (« dispo sur tous statuts » :541) | oui | tx + FOR UPDATE | **oui** EditPOModal:1856 |
| GET | /purchase-orders/:id/download-pdf | downloadPdf (ctrl:299) | A/M | — | **non** | — | **oui** :192 |
| DELETE | /purchase-orders/:id | remove (ctrl:141) | **ADMIN** | en_attente/annule | **non** | — | **oui** :145 |
| GET/POST | /reception-vouchers, /:id, /purchase-order/:poId | reception-voucher.controller.ts | A/M | create : envoye/livre_partiel/**en_attente** | — | — | **NON** : `receptionVouchersApi` défini (purchase-orders.api.ts:48-57) mais 0 usage ; 0 chemin brut `/reception-vouchers` dans client/src |

Incohérence de filtre store : `effectiveStoreFilter` (ctrl:13-15, admin = tous, manager = son store) est appliqué sur list/eligible/getById/updateHeader/replaceItems/generateInvoice mais **pas** sur send/confirmDelivery/cancel/markNotDelivered/updatePrices/downloadPdf/remove/overdue. Sans impact aujourd'hui (1 store) ; bloquant pour le multi-magasin/multi-tenant prévu.

Rôles : seuls `admin` et `manager` touchent aux BC. Le `magasinier` (qui réceptionne physiquement) n'a aucun accès. Pas de distinction créateur / approbateur / expéditeur : le manager fait tout (289/304 BC créés par un manager).

---

## 6. Création d'un BC — trois chemins

### 6.1 UI « Nouveau BC » (`CreatePOModal`, PurchaseOrdersTab.tsx:861-1252)
- En-tête : fournisseur (actifs seulement), livraison prévue, notes (:1012-1045). **Pas de date de commande saisissable.**
- Lignes : recherche ingrédients + consommables (:1051-1084) ; création d'article à la volée routée par catégorie (`kindOf`, :896-947 ; payload snake_case vs camelCase selon l'API, commentaire :924-926) ; quantité par contenant si l'ingrédient a un contenant défini (:1159-1178) ; prix optionnel (pré-rempli avec `unit_cost`).
- Soumission (:1197-1213) : `unitPrice` 0 → `null`. Erreur générique `notify.error('Erreur lors de la création')` (:893) : le message serveur n'est pas affiché.
- Serveur `repo:125-170` : une transaction ; règle contenant appliquée (:153) ; aucune validation de `expectedDeliveryDate`, `unitPrice` (négatif accepté), `quantityOrdered` (≤ 0 → violation CHECK → 500).
- Pas de clé d'idempotence : un double-submit réseau crée deux BC (le bouton est seulement `disabled` pendant `isPending`, :1240).

### 6.2 Depuis les demandes d'achat (`generatePO`, purchase-request.repository.ts:161-251)
- Sélectionne les DA `pending` du fournisseur (`FOR UPDATE`, :175-182), regroupe par ingrédient, prix = `ingredients.unit_cost`, règle contenant (:225), DA → `assigned` (:237-241).
- **Ingrédients uniquement** (`JOIN ingredients`) : une DA de consommable n'existe pas (purchase_requests.ingredient_id NOT NULL, mig 057).
- UI `PurchaseRequestsPage.tsx:92-102, 236, 591`.
- En base : 31 DA, toutes `received`, toutes liées à un BC → le flux DA a servi (mig 271 a débloqué la fermeture).

### 6.3 Script d'import Excel (`server/src/scripts/import-invoices-excel.ts:464-468`)
- Insère des BC `livre_complet` rétroactifs numérotés `IMPORT-<n° facture>` (hors séquence ; ignorés par le MAX+1 grâce à la regex). 0 en base locale.

---

## 7. Lignes : contenu et règles

| Besoin ERP | Existant | Preuve |
|---|---|---|
| Article | ingrédient OU consommable (CHECK exclusif) | mig 110 ; repo:65-98 (`kind`) |
| Ligne « charge/dépense » (texte libre, immobilisation) | **impossible** sur un BC ; les charges passent par factures/paiements directs | `po_item_kind_check` ; mig 038 n'ajoute qu'un lien `payments.purchase_order_id` (0 usage) |
| Quantité | `quantity_ordered > 0` ; arrondi au contenant supérieur si contenant défini | `container-rule.ts:63-72` ; repo:153, 408 |
| Unité | **non figée** : lue dynamiquement sur `ingredients.unit` / `packaging_items.unit` | repo:77-78 (`COALESCE(ing.unit, pkg.unit)`) |
| Contenant | `ingredients.container_size` / `container_type_id` lus à l'affichage ; pas de snapshot sur la ligne | repo:79-81 ; DeliveryModal :1619-1660 |
| Prix | `unit_price` nullable ; « dernier prix fait foi » → écrase `ingredients.unit_cost` / `packaging_items.unit_cost` à la réception (rv-repo:395-396, 413-416, 459-462) et à l'édition (repo:449-451) ; le prix saisi en réception **écrase le prix du BC** (rv-repo:392-396) → le prix négocié d'origine est perdu | |
| TVA | **aucune** sur le BC ; facture auto créée avec `tax_amount = 0` (rv-repo:168-170) | 263/294 factures auto à TVA 0 |
| Remise / frais de port / escompte | aucun | schéma |
| Totaux | calculés à la volée : SQL `SUM(quantity_ordered × COALESCE(unit_price,0))` (repo:26-27) et recalculés côté client (PODetailModal:1274-1276) ; `COALESCE(unit_price,0)` fait apparaître **0,00 DH** pour un BC sans prix (ex. BC-2026-0147) | |
| Date de livraison par ligne, qté annulée, notes ligne | aucun | schéma |

---

## 8. Envoi au fournisseur

- `POST /:id/send` = `UPDATE status='envoye'` (repo:172-178). **Pas de PDF attaché, pas d'email, pas de WhatsApp, pas d'horodatage `sent_at`, pas d'accusé de réception.** Aucune bibliothèque mail côté serveur (`grep nodemailer|sendMail|whatsapp` → seul `client/src/features/customers/CustomersPage.tsx`).
- PDF (`GET /:id/download-pdf`, ctrl:299-402 → `purchase-order-pdf.service.ts`) :
  - Colonnes **Désignation / Unité / Qté seulement** (pdf:222) ; « sans totaux » (pdf:261). `totalHT` est calculé (ctrl:368) et passé (`POData.totalHT`, pdf:59) mais **jamais rendu** → le fournisseur reçoit un BC sans prix (choix possible, mais non paramétrable).
  - Identité société **codée en dur** dans le contrôleur (ctrl:382-389 : `TRIANGLE D'ORIENT SARL`, adresse, RC, patente, IF, ICE) alors que `settingsRepository` est déjà chargé pour le logo (ctrl:323).
  - Logo : data URI base64 en base ou fichiers candidats, dont un chemin absolu de machine de dev (`pdf:14`).
  - Bouton PDF masqué en `en_attente` (PurchaseOrdersTab.tsx:498) : impossible de prévisualiser avant envoi.
  - Ouvert via `window.open(blob)` (:198).

---

## 9. Modification après envoi

- Aucune notion de version/avenant/révision. `updated_at` seul.
- `PUT /:id` (`updateHeader`, repo:292-318) : fournisseur, date prévue, notes modifiables **quel que soit le statut** → un BC `livre_complet` facturé peut changer de fournisseur sans toucher la facture (0 cas en base, mais aucune garde).
- `PUT /:id/items` (`replaceItems`, repo:328-500), bouton « Modifier le BC » visible sur **tous** les statuts (:541-543) :
  - diff delete/update/insert ; refuse la suppression d'une ligne référencée par un BR (repo:371-381) ;
  - **modifie `quantity_delivered` directement** → ajustement `inventory` + `inventory_transactions type='adjustment'` **sans `purchase_order_item_id`, sans BR, sans `ingredient_lots`** (repo:506-527) → stock sans lot (trou de traçabilité ONSSA) ; 16 ajustements « Admin edit BC » en base ;
  - `_adjustInventory` : `UPDATE inventory … WHERE ingredient_id=$2 AND store_id=$3` sans vérifier `rowCount` → si la ligne d'inventaire n'existe pas, transaction enregistrée mais stock inchangé ;
  - resync statut (repo:462-488) **ne pose pas `delivery_date`** → BC-2026-0015 et BC-2026-0124 `livre_complet` avec `delivery_date NULL` et 0 BR, invisibles du widget dashboard « reçu non facturé » (`dashboard.repository.ts:87-90` filtre `delivery_date BETWEEN`) ;
  - ne répercute rien sur une facture déjà créée (26 BC avec HT facture ≠ HT BC).
- Réception : le prix saisi écrase `purchase_order_items.unit_price` (rv-repo:392-396) → perte du prix commandé, impossible de mesurer l'écart prix commandé/facturé.
- `forceComplete` (rv-repo:486-498) : **supprime physiquement** les lignes non livrées et **réécrit** `quantity_ordered = quantity_delivered` → annulation partielle non tracée (aucune `quantity_cancelled`), reconnu « non restaurable » (rv-repo:583-585).

---

## 10. Réception → statut (délégation)

`confirmDelivery` (repo:180-221) ne fait que mapper les lignes puis appelle `receptionVoucherRepository.create` : toute la logique de statut est dans `reception-voucher.repository.ts:284-560`.

Points saillants :
- Garde de doublon de N° de facture fournisseur par fournisseur (rv:305-322, 409).
- `quantity_delivered += quantity_received` sans borne (rv:382) ; le client met `max={remaining}` (:1663) mais rien côté serveur → 12 lignes sur-livrées (§2.5), `allDelivered` utilise `>=` donc le BC passe `livre_complet`.
- Facture auto quand `livre_complet` (rv:541-544) via `createInvoiceFromPo` (rv:77-215) : prix effectif = dernier prix BR sinon prix BC (rv:107-120) ; `tax_amount = 0` ; catégorie dérivée des articles (rv:28-70) ; idempotence par `SELECT id FROM invoices WHERE purchase_order_id=$1 AND status != 'cancelled'` (rv:85-88) **sans verrou** → deux réceptions concurrentes peuvent créer deux factures.
- Si `en_attente_facturation` puis prix saisis via `PUT /items` → `livre_complet` **sans facture** ; rattrapage manuel `POST /:id/invoice` (bouton « Générer la facture » :509). 4 BC `livre_complet` sans facture en base (§2.6).
- `invoicesApi.merge` (accounting.repository.ts:770-905) pré-crée une facture sur un BC **partiel** (l.780-789) ; une réception ultérieure du reliquat trouvera la facture existante → `createInvoiceFromPo` retourne `null` → **le reliquat n'est jamais facturé** (chemin théorique : 0 `livre_partiel` en base).

---

## 11. Annulation, suppression, annulation de réception

| Action | Qui | Garde | Problème |
|---|---|---|---|
| Annuler le BC (`cancel`) | A/M | refusé si livre_complet/annule | **livre_partiel / en_attente_facturation → annule sans extourne** : stock, lots, BR et facture éventuelle restent ; DA liées restent `assigned` à vie (seul `closePurchaseRequestsForOrder` existe, helper:36-47, et il ne traite que la réception). UI propose « Annuler le BC » sur ces statuts (:700-704). |
| Non livré (`markNotDelivered`) | A/M | aucune | API accepte depuis `livre_complet` ; UI limite à envoye/livre_partiel (:684-690) ; depuis livre_partiel la part livrée reste en stock sous un BC « non livré ». |
| Supprimer (`remove`) | ADMIN | en_attente/annule | Suppression physique, pas de corbeille ni de journal ; DA → `purchase_order_id NULL` mais statut `assigned` conservé (mig 057 SET NULL) → DA orpheline non ré-ordonnable. Numéro réattribuable (§4). |
| Annuler la réception (`cancelReception`) | ADMIN | pas de paiement ; lots non entamés | Extourne complète mais par **DELETE physique** des BR, lots, transactions et factures (rv:666, 735-744) ; `GREATEST(current_quantity − qty, 0)` (rv:714) absorbe silencieusement un stock négatif ; numéros BR réutilisables (MAX+1). Aucun journal d'audit. |

Pas d'annulation partielle de ligne (hors `forceComplete` destructif). Pas de réactivation d'un BC annulé. Pas de motif d'annulation stocké.

---

## 12. BC « dépense » (mig 038) vs BC stock

- Intention (mig 038) : toute dépense d'une catégorie `requires_po` doit référencer un BC (`payments.purchase_order_id`).
- Réalité : garde serveur **désactivée** (`ENFORCE_PO_REQUIREMENT = false`, accounting.controller.ts:668-680) et client (AccountingPage.tsx:2113-2116, bannière « BC non exigé ») ; `payments.purchase_order_id` = **0/689** ; `GET /purchase-orders/eligible` liste des BC de tous statuts non annulés (repo:57), y compris `en_attente`/`envoye` (un paiement pourrait être lié à un BC non livré).
- Un BC ne peut porter que des articles de stock (§7) : il n'existe pas de BC « service / charge / immobilisation ». 48 catégories `requires_po = true` sans aucun moyen de produire un BC pour la plupart d'entre elles (Entretien, Équipements… sont routées en consommables `packaging_items`).
- Conclusion : le contrôle « dépense sous BC » est **dormant** ; `requires_po` n'est qu'un libellé « (BC requis) » dans `CategoryCascadeSelector.tsx:208`.

---

## 13. Cohérence montants BC / réception / facture — où c'est calculé

| Montant | Calcul | Lieu |
|---|---|---|
| Total BC (commandé) | `SUM(quantity_ordered × COALESCE(unit_price,0))` | repo:26 (liste), repo:533 (overdue), client PODetailModal:1274, EditPOModal:1825, PDF ctrl:368 (non rendu) |
| Livré BC | `SUM(quantity_delivered × COALESCE(unit_price,0))` | repo:27, repo:54 (eligible), dashboard.repository.ts:84-86 |
| Total BR | `SUM(quantity_received × COALESCE(rvi.unit_price,0))` | rv-repo:245, 770 |
| Facture auto | `Σ quantity_delivered × prix_effectif` (dernier prix BR sinon BC), TVA 0 | rv-repo:107-131, 168-176 |
| Après fusion | `SUM(invoice_items.subtotal)` + Σ TVA | accounting.repository.ts:841-852 |

Aucun rapprochement 3 voies (BC ↔ BR ↔ facture) n'est calculé ni affiché : pas de colonne d'écart, pas de tolérance, pas de blocage. Le seul « rapprochement » est implicite : la facture est générée depuis le BC. Toute édition postérieure (lignes facture, lignes BC) désynchronise sans alerte (53 écarts, §2.6). Aucune provision « reçu non facturé » hors widget dashboard (basé sur `delivery_date`, défaillant pour les BC clos via édition admin).

---

## 14. Verrous, transactions, idempotence

| Opération | Transaction | Verrou | Idempotence | Risque |
|---|---|---|---|---|
| create | oui (repo:134-168) | advisory lock numéro | aucune clé | double BC sur double-submit |
| send / cancel / markNotDelivered | **non** (read `findById` puis `updateStatus`) | aucun | — | TOCTOU : deux `send` concurrents OK (idempotent de fait), mais `cancel` après `confirmDelivery` concurrent → BC `annule` avec stock reçu |
| confirmDelivery | garde statut **hors** tx (ctrl:80) ; tx dans rv-repo | FOR UPDATE lignes (rv:378) et inventory (rv:447) ; **BC non verrouillé** | facture : check sans verrou (rv:85-88) | double réception concurrente → sur-livraison + 2 factures |
| updateItemPrices | oui | aucun | — | — |
| replaceItems | oui | FOR UPDATE BC + lignes (repo:339, 351) | — | OK |
| generateInvoice | oui | FOR UPDATE BC (repo:571) | check facture existante | OK |
| cancelReception | oui | FOR UPDATE BC + BR (rv:594, 610) | — | OK |
| remove | **non** | aucun | — | FK RESTRICT sur BR protège |

Erreurs : `create` renvoie le `err.message` brut en 500 (ctrl:58-61) ; `replaceItems` mappe tout en 400 (ctrl:245-248).

---

## 15. Relances et retards

- `GET /overdue` (repo:529-543) : BC `en_attente/envoye/livre_partiel` avec `expected_delivery_date < today − N jours` (N=3 par défaut). Ignore le store, ignore les 101 BC sans date prévue, aucune relance (email/notification), aucune escalade. Affiché en bandeau rouge (PurchaseOrdersTab.tsx:293-299) sans lien ni filtre « en retard ».
- `NotificationBell.tsx` : aucune entrée BC. Aucun job/cron serveur sur les BC.
- Les 3 `envoye` de juillet ne sont pas remontés (2 sans date prévue ; le 3e a une date prévue antérieure à la commande → remonté comme « en retard » depuis 96 jours sans action possible autre que réception/annulation).

---

## 16. Écrans client

### 16.1 Architecture
- Route `/purchasing` → `PurchasingPage` (4 onglets : Liste d'attente = `PurchaseRequestsPage`, Fournisseurs = `SuppliersTab`, Bons de commande = `PurchaseOrdersTab` **importé depuis `features/accounting/`** (l.18), Factures reçues = `ReceivedInvoicesSection`).
- L'UI BC complète vit donc dans `client/src/features/accounting/PurchaseOrdersTab.tsx` (2164 l.) : mauvais dossier, nom « Tab » pour un module entier.

### 16.2 `PurchaseOrdersTab.tsx` (2164 lignes, 8 composants dans un fichier)

| Composant | Lignes | Rôle |
|---|---|---|
| PurchaseOrdersTab | 101-598 | liste, stats, filtres, 8 mutations, sélection multi-BC pour fusion |
| ExpandedPORow | 601-728 | lignes inline + boutons d'action (dupliqués avec la colonne Actions :486-560) |
| CategoryQuickEdit | 731-858 | correction catégorie référentiel depuis le BC (+ conversion ingrédient→consommable) |
| CreatePOModal | 861-1252 | création (quasi plein écran) |
| PODetailModal | 1255-1390 | détail (tableau articles dupliqué avec ExpandedPORow) |
| DeliveryModal | 1393-1775 | réception : contenants, prix, lot/DLC/date prod, N° facture fournisseur, forceComplete |
| EditPOModal | 1778-2080 | édition admin en-tête + lignes (éditeur de lignes dupliqué avec CreatePOModal) |
| MergeInvoicesModal | 2083-2164 | fusion factures |

Métriques : 35 `useState`, 13 `useMutation`, 6 `confirm()` natifs, 18 `Record<string, any>`, 191 `className=` Tailwind + 274 `style={{…}}` inline + 158 classes `odoo-*` (3 systèmes de style mélangés), 3 copies du snippet d'extraction d'erreur `'response' in err`. Statuts représentés 4 fois : `STATUS_LABELS/COLORS/ICONS` (:37-63) + ternaires `statusTag`/`dotClass` (:423-434) + `statusTabs` (:276-285) + stat tiles. Chargement de **tous** les BC puis filtrage client (recherche, fournisseur) ; stats calculées sur la liste filtrée par statut seulement (:206-216). Détail refetché à chaque expansion (query par id).

### 16.3 `PurchasingPage.tsx` (2145 lignes, 8 composants)

| Composant | Lignes |
|---|---|
| PurchasingPage | 55-102 |
| SuppliersTab | 105-380 (formulaire fournisseur : nom, contact, tél, email, ville, adresse, ICE, notes — pas de conditions de paiement, délai, devise) |
| InvoicesTab → ReceivedInvoicesSection | 383-1241 (≈860 lignes, ~20 `useState`, 9 mutations) |
| ReceivedInvoiceFormModal | 1244-1528 |
| InvoiceScheduleModal | 1531-1662 (style Tailwind « rounded-2xl/gradient » différent du reste) |
| InvoiceLinesEditorModal | 1665-1974 |
| InvoicePaymentsModal | 1977-2145 |

Métriques : 43 `useState`, 14 `useMutation`, 7 `confirm()`, 25 `Record<string, any>`, 202 `className=` + 262 `style={{…}}` + 126 `odoo-*`, 6 copies du snippet d'erreur. Le fichier ne contient **aucune** logique BC : il porte Fournisseurs + Factures reçues (hors périmètre D4) ; le nom « PurchasingPage » est trompeur.

Dette commune : aucun typage partagé des entités (BC, ligne, statut) entre client et serveur (`shared/src` n'a pas de type `PurchaseOrder`) ; parsing `parseFloat(String)` partout ; styles inline ; `confirm()` ; pas de pagination ; pas de tests (le seul test serveur du périmètre est `server/src/__tests__/container-rule.test.ts`).

---

## 17. Code mort / jamais appelé / dormant

| Élément | Preuve |
|---|---|
| `POST /purchase-orders/:id/update-prices` + `purchaseOrderRepository.updateItemPrices` (repo:223-290) | `purchaseOrdersApi.updatePrices` défini (api:21) mais 0 usage dans `client/src` |
| Routes `/reception-vouchers/*` + `receptionVouchersApi` (api:48-57) | 0 usage ; 0 chemin brut dans client ; la réception passe exclusivement par `/purchase-orders/:id/confirm-delivery` |
| `payments.purchase_order_id` (mig 038) | 0/689 renseigné ; garde `ENFORCE_PO_REQUIREMENT=false` |
| `expense_categories.requires_po` | seulement affiché (« BC requis ») ; aucune règle active |
| `inventory_transactions` type `'purchase_order'` (mig 033) | 0 ligne ; les réceptions utilisent `'restock'` |
| `POData.totalHT` (pdf:59) | calculé (ctrl:368) jamais rendu |
| Statut `non_livre` | 0 en base ; branche `else newStatus='non_livre'` (rv:522-523) inatteignable depuis `create` (items filtrés `quantityReceived>0`, repo:195) |
| `purchase_orders.notes` | 0/304 renseigné |
| `seq_reception_voucher`, `seq_invoice_received` (mig 055) | jamais utilisées (numérotation MAX+1) |
| Chemin absolu `/Users/anissbouida/...` dans `purchase-order-pdf.service.ts:14` | résidu de dev |
| `reception-voucher.controller.ts` autorise la réception depuis `en_attente` (l.34) | contradiction avec `confirmDelivery` (envoye/livre_partiel), jamais exercée |

---

## 18. Forces

1. Transaction + `pg_advisory_xact_lock` pour la numérotation, réutilisée par le flux DA (repo:100-123 ; purchase-request.repository.ts:194) ; correction documentée du bug COUNT+1.
2. `FOR UPDATE` sur BC et lignes dans `replaceItems`, `generateInvoice`, `cancelForPurchaseOrder` ; garde-fous métier explicites (facture payée, lot entamé, ligne référencée par un BR).
3. Règle « contenant entier » centralisée serveur (`container-rule.ts`) et appliquée aux 3 chemins de création/édition ; test unitaire présent.
4. Routage ingrédient/consommable par catégorie cohérent de bout en bout (BC → BR → facture → stock), CHECK exclusif en base.
5. Réception riche : lot fournisseur, DLC, date de production, saisie par contenant, prix réel, N° facture fournisseur avec détection de doublon, `forceComplete` pour clore un reliquat.
6. Facture fournisseur auto-générée avec catégorie dérivée, lien BR, écriture comptable (SAVEPOINT) ; rattrapage manuel ; fusion multi-BC (mig 178).
7. Fermeture automatique des DA (`closePurchaseRequestsForOrder`) sur les 3 chemins de réception.
8. Annulation de réception complète (stock, lots, facture, écritures) réservée à l'admin.
9. UX de réception soignée (contenants × taille, « Tout reçu », alerte N° facture manquant, progression par ligne).

---

## 19. Faiblesses (ordonnées par sévérité)

| # | Sév. | Dom. | Titre | Preuve | Impact |
|---|---|---|---|---|---|
| 1 | critique | D4, D5 | Annulation d'un BC partiellement reçu sans extourne | ctrl:111-120 (seuls livre_complet/annule bloqués) ; UI :700-704 ; `updateStatus` sans effet de bord ; `markNotDelivered` ctrl:104-109 sans garde | BC `annule`/`non_livre` avec stock, lots, BR et éventuelle facture vivants ; DA liées bloquées `assigned` à vie (helper:36-47 ne couvre que la réception) |
| 2 | critique | D4, D5, D10 | Édition admin des lignes = stock sans lot ni BR, facture non resynchronisée | repo:328-500, `_adjustInventory` repo:506-527 (transactions `adjustment` sans `purchase_order_item_id`, pas d'`ingredient_lots`) ; 16 + 6 ajustements « Admin edit BC » ; 26 BC avec HT facture ≠ HT BC ; BC-2026-0015/0124 `livre_complet` sans BR et `delivery_date NULL` | Trou de traçabilité ONSSA, divergence BC/facture silencieuse, BC invisibles du widget « reçu non facturé » |
| 3 | critique | D4, D6 | Concurrence : garde de statut hors transaction, BC non verrouillé à la réception, idempotence facture sans verrou | ctrl:80 (check avant tx) ; rv:284-560 sans `FOR UPDATE` sur `purchase_orders` ; rv:85-88 check facture sans verrou ; aucune borne `quantity_delivered ≤ quantity_ordered` (rv:382) ; 12 lignes sur-livrées (ex. 0,0035 commandé / 5 reçu) | Double réception → double stock et double facture ; sur-livraisons passent `livre_complet` |
| 4 | critique | D3, D8 | Contrôle « dépense sous BC » (mig 038) totalement dormant | `ENFORCE_PO_REQUIREMENT=false` (accounting.controller.ts:668 ; AccountingPage.tsx:2113) ; `payments.purchase_order_id` 0/689 ; BC limité aux articles de stock (CHECK mig 110) ; `eligible` inclut en_attente/envoye (repo:57) | Aucun engagement/approbation avant dépense ; 48 catégories « BC requis » sans effet ; pas de BC de service/immobilisation |
| 5 | majeur | D4 | Pas de date de commande ni de workflow amont : le BC est saisi à la réception | `order_date` = `created_at::date` 304/304 ; 261/298 réceptions < 10 min après création ; 59 « livraison prévue » < date de commande ; 0 `livre_partiel`, 0 `en_attente` en base ; CreatePOModal:1012-1045 sans champ date | Le module ne pilote pas les achats ; impossible de mesurer délais fournisseur (OTIF) ; dates faussées |
| 6 | majeur | D4 | « Envoi » = simple changement de statut | repo:172-178 ; pas de `sent_at`, email, WhatsApp, accusé ; aucune lib mail serveur ; PDF sans prix (pdf:222, 261) et masqué en `en_attente` (:498) ; identité société codée en dur (ctrl:382-389) | Pas de preuve d'envoi, pas de confirmation fournisseur, pas de prix engagé sur le document |
| 7 | majeur | D4 | Aucune version/avenant ; prix commandé écrasé par le prix reçu ; `forceComplete` destructif | rv:392-396 écrase `unit_price` ; rv:486-498 supprime lignes et réécrit `quantity_ordered` (« non restaurable » rv:583-585) ; `updateHeader` sans garde de statut (repo:292-318) | Perte de l'engagement initial ; écart prix commandé/facturé non mesurable ; annulation partielle non tracée ; fournisseur modifiable après facturation |
| 8 | majeur | D4, D6 | BC sans TVA, remise, frais ; totaux à la volée avec `COALESCE(unit_price,0)` | schéma §1.2 ; repo:26-27 ; rv:168-170 `tax_amount=0` ; 263/294 factures auto TVA 0 ; 27 écarts TVA, 26 écarts HT (§2.6) | Montant engagé faux (0,00 DH pour BC sans prix) ; facture auto incomplète ; pas de 3-way match |
| 9 | majeur | D4, D10 | Suppressions physiques et numéros réattribuables, aucune piste d'audit | `remove` repo:545-550 ; `cancelForPurchaseOrder` DELETE BR/factures/lots (rv:666, 735-744) ; numérotation MAX+1 (repo:112-120, rv:275-280) ; trou BC-2026-0004 ; pas de table d'historique de statut ; `GREATEST(…,0)` masque stock négatif (rv:714) | Documents (BC, BR) disparaissent ; un numéro peut désigner deux documents ; non conforme à une piste d'audit comptable |
| 10 | majeur | D4, D2 | BC `envoye` jamais clos, relance inexistante | 3 BC `envoye` de 75-96 j ; `findOverdue` ignore 101 BC sans date prévue (repo:537) et le store ; bandeau sans action (:293-299) ; aucune notification/cron ; DA orphelines sur DELETE (mig 057 SET NULL, statut inchangé) | Encours fournisseur fantôme (10 195 DH) ; DA potentiellement bloquées |
| 11 | majeur | D4, D10 | Pas de validation d'entrée, pas d'`asyncHandler`, erreurs serveur masquées côté client | 0 validateur achats ; Express 4 (`server/package.json:22`), 0 `asyncHandler` dans les routes BC, handlers list/send/cancel/... sans try/catch (commentaire ctrl:46-49) ; `notify.error('Erreur lors de la création')` (:893) ; `create` renvoie `err.message` brut en 500 (ctrl:58-61) | Requêtes qui pendent, messages d'erreur inexploitables, quantité ≤ 0 → 500 |
| 12 | majeur | D1, D4 | Ligne sans unité ni contenant figés ; prix catalogue écrasé par le dernier prix | repo:77-81 (unité/contenant lus dynamiquement) ; rv:413-416, 459-462, repo:449-451 (`unit_cost` = dernier prix) ; volatilité absurde non détectée (Kiwi 0,04→53 ; Eau de fleur d'oranger 4→235) | Historique réécrit si l'article change d'unité ; erreurs de saisie propagées au coût des recettes |
| 13 | majeur | D10 | Code mort et chemins contradictoires | `update-prices` (repo:223-290) et `/reception-vouchers` (ctrl RV) jamais appelés ; RV ctrl autorise réception depuis `en_attente` (l.34) vs `confirmDelivery` non ; `non_livre` inatteignable à la réception ; type `purchase_order` (mig 033) 0 usage ; `totalHT` PDF non rendu | Surface d'API non testée exposée aux rôles A/M, maintenance confuse |
| 14 | mineur | D10 | Fichiers client monolithiques et mal rangés | `PurchaseOrdersTab.tsx` 2164 l. dans `features/accounting/` (8 composants, 35 useState, 3 systèmes de style, statuts définis 4 fois, éditeur de lignes dupliqué Create/Edit, tableau articles dupliqué Expanded/Detail) ; `PurchasingPage.tsx` 2145 l. sans logique BC | Coût de maintenance, régressions, impossibilité de tester |
| 15 | mineur | D10 | Filtre store incohérent entre endpoints ; magasinier exclu | `effectiveStoreFilter` absent de send/confirmDelivery/cancel/markNotDelivered/remove/downloadPdf/overdue ; `ROLE_GROUPS.ADMIN_MANAGER` partout | Bloquant pour multi-magasin/multi-tenant ; réception physique faite par un rôle qui n'y a pas accès |
| 16 | mineur | D4, D9 | Liste non paginée, N+1 SQL, stats partielles | repo:24-45 : 5 sous-requêtes corrélées par BC, pas de LIMIT ; client charge tout et filtre ; stats sur liste filtrée par statut (:206-216) | Dégradation au-delà de quelques milliers de BC ; pas d'analytique (dépense par fournisseur/catégorie, OTIF) |
| 17 | mineur | D4 | `delivery_date` écrasée à chaque réception et non posée par l'édition admin | rv:527 `delivery_date = CURRENT_DATE` ; repo:482-485 sans delivery_date ; aucune réception antidatée (307/307 `reception_date = created_at`) | Date de première/dernière livraison non fiable ; pas de saisie rétroactive |
| 18 | mineur | D4 | Pas de double-submit guard serveur ni d'idempotency key | repo:125-170 ; CreatePOModal:1240 (`disabled` seulement) | Doublons de BC possibles |

---

## 20. Questions ouvertes

1. Les 3 BC `envoye` de juillet (BC-2026-0147, 0269, 0270 — 10 195 DH) : commandes réellement passées et jamais livrées, ou saisies de test à annuler ? Qui décide de la clôture ?
2. Le BC est-il destiné à redevenir un **document amont** (envoyé avant livraison, avec prix engagés) ou faut-il assumer un flux « achat direct / réception sans BC » et réserver le BC aux vrais fournisseurs à délai (Ecomab, OVOTEC, RICA MAROC) ?
3. Le PDF doit-il porter les prix (politique d'achat) ? Les identifiants société doivent-ils venir de `settings` ?
4. Faut-il un circuit d'approbation (seuil montant, rôle approbateur) avant envoi, et par qui (admin vs manager) ? Aujourd'hui 289/304 BC sont créés et clos par un manager.
5. BC « dépense » (mig 038) : réactiver `ENFORCE_PO_REQUIREMENT` suppose des lignes de BC non-stock (service, immobilisation, texte libre). Est-ce voulu ?
6. Les 59 BC dont la « livraison prévue » précède la commande et les 101 sans date : faut-il un backfill (`order_date := expected_delivery_date`) avant toute analytique OTIF ?
7. Les 26 BC dont le HT facturé diffère du HT BC et les 4 `livre_complet` sans facture : à régulariser en prod ou considérés comme l'état voulu (facture corrigée manuellement) ?
8. `cancelReception` et `remove` suppriment physiquement : la future refonte doit-elle introduire soft-delete + journal d'audit (statuts `annule` sur BR, table `purchase_order_events`) ? Contrainte comptable marocaine à confirmer.
9. Multi-magasin / SaaS (plan mig 296+) : les endpoints sans filtre store doivent-ils être corrigés avant la refonte ou dans la refonte ?
