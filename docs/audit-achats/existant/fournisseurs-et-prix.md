# Existant — Référentiel fournisseurs, fiche article-fournisseur, prix (D1, D9)

Lecteur « fournisseurs-et-prix ». Audit du 2026-10-11 sur le dépôt `/Users/anissbouida/projets/Ofauria-app` (branche `main`, dernière migration appliquée en local : `303_foret_noire_10065_fiche_technique.sql`) et sur la base locale (copie récente de la prod, lecture seule).

Tous les chemins sont relatifs à la racine du dépôt. Les volumes viennent de la base locale.

---

## 0. Résumé exécutif

| Question posée | Réponse courte | Preuve |
|---|---|---|
| Fiche info article-fournisseur (prix négocié, délai, conditionnement, réf. fournisseur, fournisseur préféré) ? | **Non.** Il n'existe aucune table article×fournisseur. La mig 136 a ajouté `ingredients.supplier_id` + `supplier_reference` mais ces colonnes ne sont **jamais écrites ni lues** par le code (0/405 renseignées). Le seul lien est un **texte libre** `ingredients.supplier` (137/405). | §2.2, §3.1, SQL §6.2 |
| Comment le prix de l'ingrédient est mis à jour ? | **Dernier prix saisi écrase `ingredients.unit_cost`**, à 4 endroits : réception BC, mise à jour des prix a posteriori, édition admin des lignes BC, import Excel. Jamais à la création du BC. Pas de moyenne pondérée, pas de prix standard. | §4.1 |
| Historique de prix ? | **Pas de table dédiée.** Historique de fait = `purchase_order_items.unit_price`, `reception_voucher_items.unit_price`, `ingredient_lots.unit_cost`, `invoice_items.unit_price`. Aucun écran ne les restitue comme courbe/tableau de prix par article. | §4.3 |
| Multi-fournisseurs par article ? | **Non modélisé**, mais la réalité l'exige : 64 ingrédients sur 275 achetés l'ont été chez ≥ 2 fournisseurs (jusqu'à 6). | SQL §6.4 |
| Contrats / tarifs ? | **Aucun.** Pas de grille tarifaire, pas de validité, pas de remise, pas de minimum de commande. | §2.1 |
| Données fournisseur ? | 8 champs : `name, contact_name, phone, email, address, city, ice, notes` + `is_active`. **Manquent** : IF, RC, patente, CNSS, RIB/IBAN, conditions de paiement, délai de livraison, catégorie/type, devise, blocage, contacts multiples, `updated_at`. | §2.1 |
| Combien d'ingrédients ont un fournisseur de référence et un prix ? | `supplier_id` : **0/405**. Texte `supplier` : **137/405** (dont 54 « Générique », 13 « Marché local »). Prix > 0 : **378/405** (27 à 0, aucun utilisé en recette). | SQL §6.2 |

Les 5 problèmes dominants :

1. **Le référentiel article-fournisseur n'existe pas** (D1, critique côté pilotage) : mig 136 morte, texte libre non normalisé, 21/137 textes seulement correspondent à un fournisseur existant.
2. **Le prix catalogue est un « dernier prix » non qualifié** (D1/D8, critique) : écrasé à chaque réception quel que soit le fournisseur, l'unité ou le conditionnement ; il pilote directement le coût de toutes les recettes (`v_recipe_direct_cost`) et la valorisation du stock. Écart valorisation stock : 141 145 DH (coût des lots) vs 186 381 DH (coût catalogue).
3. **52 % des BC vont à deux fournisseurs génériques** (« Épicerie », « Marché aux puces »), ce qui rend toute analyse par fournisseur (D9) impossible et casse la logique d'auxiliaire comptable par tiers.
4. **Fiche fournisseur minimaliste, sans validation ni unicité** (D1) : pas de zod, doublons (`SONEPAL`/`SONEPALE`, `BIM ` avec espace), 2 fiches avec le même ICE, 5 fournisseurs sans auxiliaire 4411 (dont 2 avec factures).
5. **Aucune analytique fournisseur** (D9) : pas de dépenses par fournisseur sur période, pas de performance (OTIF, délai, écart prix), pas de volatilité ; le seul widget est « top fournisseurs créditeurs » (montant dû).

---

## 1. Périmètre et fichiers lus

### Migrations
| Fichier | Contenu utile |
|---|---|
| `server/migrations/019_accounting_module.sql:2-14` | Création `suppliers` (11 colonnes). Jamais modifiée depuis (aucune migration `ALTER TABLE suppliers`). |
| `server/migrations/136_ingredient_supplier_ref.sql` | `ingredients.supplier_reference`, `ingredients.supplier_id`, index unique partiel `(supplier_id, supplier_reference)`. |
| `server/migrations/147_reception_supplier_invoice.sql` | `reception_vouchers.supplier_invoice_number/date`. |
| `server/migrations/170_price_rounding.sql` | Arrondi du **prix de vente** (hors périmètre achat, cité par erreur dans la mission). |
| `server/migrations/207_purchase_consumable_routing.sql:44-70` | `fn_purchasable_kind(category_id)` : routage ingrédient vs consommable par catégorie. |
| `server/migrations/208_provision_missing_auxiliaries.sql` | Rattrapage des auxiliaires 4411 manquants, convention `4411-FOUR-<6 lettres>-<4 chars id>`. |
| `server/migrations/225_container_types_referentiel.sql`, `226_ingredient_container_type.sql` | Référentiel `container_types` (ref_entries) + `ingredients.container_type_id`/`container_size`. |
| `server/migrations/260/261/263` | Signal conversions d'unité, snapshot coût théorique plan, lien format→produit. Hors périmètre fournisseur ; aucune ne touche aux prix d'achat. |
| `server/migrations/264_bom_audit_trail.sql` | Journal d'audit SGBD sur la BOM (pattern existant, **non appliqué** aux fournisseurs/prix). |

### Serveur
- `server/src/routes/accounting.routes.ts:36-42` (routes `/suppliers`)
- `server/src/controllers/accounting.controller.ts:55-77` (`supplierController`)
- `server/src/repositories/accounting.repository.ts:311-350` (`supplierRepository`)
- `server/src/repositories/purchase-order.repository.ts` (prix : 172-181, 219-286, 404-453)
- `server/src/repositories/reception-voucher.repository.ts` (prix : 98-132, 380-467)
- `server/src/repositories/packaging-item.repository.ts:182-209`
- `server/src/repositories/inventory.repository.ts:305-378` (CRUD ingrédient, cascade prix), 165-262 (vue achats)
- `server/src/controllers/ingredient-import.controller.ts:226-260`
- `server/src/controllers/caisse-import.controller.ts:6, 28-62, 126-132`
- `server/src/services/journal-generator.service.ts:643-671` (auxiliaire à la volée)
- `server/src/services/purchase-order-pdf.service.ts:53-57, 188-213`
- `server/src/controllers/purchase-order.controller.ts:41-63, 164-174, 299-330`
- `server/src/repositories/purchase-request.repository.ts:44-86, 128-145`
- `server/src/repositories/dashboard.repository.ts:133-168`
- `server/src/services/container-rule.ts`
- `server/src/scripts/reconcile-po-item-prices.ts`

### Client
- `client/src/api/accounting.api.ts:14-19` (`suppliersApi`)
- `client/src/features/purchasing/PurchasingPage.tsx:103-363` (`SuppliersTab`)
- `client/src/features/accounting/PurchaseOrdersTab.tsx` (sélecteur fournisseur 1025-1035, prix 1079, 1153-1218, 1593-1690)
- `client/src/features/inventory/IngredientDetailPage.tsx` (312-320, 396-408, 776-840, 1113-1176)
- `client/src/features/inventory/InventoryPage.tsx` (32, 176-194, 606-612, 653)
- `client/src/features/packaging/PackagingPage.tsx:210, 248, 387-390`
- `client/src/features/purchasing/PurchaseRequestsPage.tsx:60-70`
- `client/src/features/inventory/IngredientImportModal.tsx:143`
- `client/src/api/ledger.api.ts:22-26` (`accountAuxiliariesApi`)

---

## 2. Modèle de données

### 2.1 Table `suppliers` (mig 019, inchangée depuis)

```
 id           uuid PK
 name         varchar(200) NOT NULL        -- aucune contrainte d'unicité
 contact_name varchar(100)
 phone        varchar(20)
 email        varchar(255)
 address      text
 city         varchar(100)
 ice          varchar(30)                  -- aucune contrainte de format ni d'unicité
 notes        text
 is_active    boolean DEFAULT true
 created_at   timestamptz DEFAULT now()
```
Index : PK seulement. Pas de `updated_at`, pas de `created_by`.

Référencée par (FK) : `account_auxiliaries`, `debts`, `fixed_assets`, `ingredient_lots`, `ingredients`, `invoices`, `payments`, `purchase_orders` (NOT NULL), `purchase_requests`, `recurring_charges`, `scheduled_payments`.

**Champs absents vs ERP standard (Odoo `res.partner` + `product.supplierinfo`, SAP `LFA1/LFB1/LFM1`, Dynamics `VendTable`)** :

| Donnée | Présent ? | Remarque |
|---|---|---|
| Raison sociale / nom commercial distincts | Non | un seul `name` |
| ICE | Oui (texte libre) | 17/40 renseignés, 0 contrôle de format (15 chiffres), 2 fiches partagent le même ICE |
| IF (identifiant fiscal), RC, patente, CNSS | **Non** | Obligatoire sur une facture conforme au Maroc (loi 9-88 / CGI art. 145) |
| Conditions de paiement (délai, mode par défaut) | **Non** | `due_date` NULL sur 283/317 factures reçues ; `expected_payment_mode` NULL sur 229/317 |
| RIB / IBAN / banque | **Non** | les virements/chèques n'ont pas de coordonnées bancaires fournisseur |
| Délai de livraison (lead time) | **Non** | seul `purchase_orders.expected_delivery_date` saisi au BC |
| Minimum de commande, franco | **Non** | |
| Catégorie / type fournisseur (MP, emballage, service, personnel) | **Non** | « Personnel – Avances caisse » est un fournisseur |
| Devise | **Non** | mono-devise implicite |
| Blocage (achat / paiement / tout) | Partiel | un seul `is_active` ; les BC/factures restent possibles côté API pour un inactif (filtre uniquement côté client) |
| Contacts multiples | **Non** | 1 `contact_name` + 1 `phone` + 1 `email` |
| Évaluation / notation | **Non** | |
| Compte collectif / auxiliaire par défaut | Indirect | `account_auxiliaries.supplier_id` (1 pour 1, `uq_aux_supplier`) |
| Piste d'audit | **Non** | pas de `updated_at`, pas de journal |

### 2.2 Lien article → fournisseur

| Table | Colonnes | Renseignement réel | Écrit par le code ? | Lu par le code ? |
|---|---|---|---|---|
| `ingredients.supplier` (varchar 200, legacy) | texte libre | 137/405 | oui : `inventory.repository.ts:312-313, 340`, `ingredient-import.controller.ts:229-230, 252-254`, `IngredientDetailPage.tsx:1176` (input texte) | oui : liste économat (`inventory.repository.ts:40`), filtre `InventoryPage.tsx:176-194`, auto-match par nom dans `IngredientDetailPage.tsx:788-790` |
| `ingredients.supplier_id` (uuid FK, mig 136) | | **0/405** | **non** (`grep -rn "supplierId\|supplier_id" server/src/repositories/inventory.repository.ts` → aucune écriture) | **non** |
| `ingredients.supplier_reference` (mig 136) | | **0/405** | **non** (`grep -rn "supplierReference\|supplier_reference" server/src client/src shared/src` → 0 résultat hors migrations) | **non** |
| `packaging_items.supplier` (varchar 200) | texte libre | **0/109** (108 NULL + 1 vide) | oui (`PackagingPage.tsx:387-390`, `inventory.repository.ts:524-526`) | affichage colonne `PackagingPage.tsx:248` |
| `packaging_items.supplier_id` | **n'existe pas** | | | |
| `ingredient_lots.supplier_id` | uuid FK | 634/669 | oui à la réception (`reception-voucher.repository.ts:429-435` : `po.supplier_id`) | oui (affichage lot, traçabilité ONSSA) |

Conclusion : **la mig 136 est du code mort** (schéma sans application). La seule « fiche article-fournisseur » est un texte libre, non lié, incohérent avec la réalité des achats (voir §6.3 : pour 275 ingrédients achetés, le texte `supplier` concorde avec le fournisseur majoritaire des BC dans **8 cas**, discorde dans 58, est vide dans 209).

### 2.3 Prix dans le modèle

| Colonne | Rôle réel |
|---|---|
| `ingredients.unit_cost numeric(12,4) NOT NULL` | **prix catalogue = dernier prix payé** (écrasé à la réception). Alimente `v_recipe_direct_cost` (coût recettes), `v_recipe_total_cost`, `v_recipe_format_cost`, la valorisation stock (`InventoryPage.tsx:183`), l'estimation des DA (`purchase-request.repository.ts:55`), le prix par défaut des lignes BC (`PurchaseOrdersTab.tsx:899-908, 964-973`). |
| `packaging_items.unit_cost numeric(10,4) NOT NULL DEFAULT 0` | idem pour les consommables |
| `purchase_order_items.unit_price` (nullable) | prix commandé, réécrit par la réception (`reception-voucher.repository.ts:393-396`) |
| `reception_voucher_items.unit_price` | prix constaté à la réception |
| `ingredient_lots.unit_cost` | prix figé par lot (= `effectiveCost` à la réception) ; 634/669 renseignés ; **1 lot à `NaN`** (Raisins secs golden, 2026-06-18, actif) |
| `invoice_items.unit_price` | prix facturé (dérivé de rvi puis poi par COALESCE, `reception-voucher.repository.ts:105-110`) |
| `packaging_stock_transactions.unit_cost` | coût par mouvement consommable |

Aucune table `supplier_price`, `price_history`, `price_list`, `tarif`, `contract` (grep migrations : 0 résultat pertinent).

### 2.4 Auxiliaires comptables (`account_auxiliaries`)
- 1 auxiliaire max par fournisseur (`uq_aux_supplier`), compte collectif 4411.
- Provision : seed mig 179, rattrapage mig 208, **à la volée** lors de `persistEntry` (`journal-generator.service.ts:650-671`) — c.-à-d. seulement quand une écriture est générée. La **création d'un fournisseur ne crée pas l'auxiliaire** (`accounting.repository.ts:321-333`).
- État : 35 auxiliaires pour 40 fournisseurs ; **5 fournisseurs sans auxiliaire** (sablés, MAGNATE EMBALLAGE, JAWDA, ALERTE NUISIBLE, BIOUGNACH), dont 2 ont déjà 1 facture.
- Code auxiliaire dérivé du nom (`4411-FOUR-<6 lettres>-<4 chars id>`) : renommer le fournisseur ne renomme pas l'auxiliaire (`label` figé).

---

## 3. Endpoints et écrans

### 3.1 Endpoints fournisseurs (`server/src/routes/accounting.routes.ts:36-42`)

| Méthode | Chemin | Rôles | Handler | Appelé par le client ? |
|---|---|---|---|---|
| GET | `/suppliers` | PRODUCTION (admin, manager, chefs) | `supplierController.list` → `SELECT * FROM suppliers ORDER BY name` (tous, actifs et inactifs) | **oui** : `client/src/api/accounting.api.ts:15`, utilisé dans 6 écrans |
| GET | `/suppliers/:id` | PRODUCTION | `getById` | **non** : `suppliersApi.getById` défini (`accounting.api.ts:16`) mais `grep -rn "suppliersApi.getById" client/src` → 0 |
| POST | `/suppliers` | ADMIN_MANAGER | `create` — **aucun validateur** (`req.body` passé tel quel, `accounting.controller.ts:65-68`) | oui : `PurchasingPage.tsx:116` |
| PUT | `/suppliers/:id` | ADMIN_MANAGER | `update` — mapping whitelist de 9 clés, aucun validateur, `""` stocké tel quel (FormData) | oui : `PurchasingPage.tsx:116, 135` |
| DELETE | `/suppliers/:id` | ADMIN | `remove` → **soft delete** `is_active=false` (`accounting.repository.ts:347-349`) | oui : `PurchasingPage.tsx:126` |

Aucun endpoint : fiche article-fournisseur, historique de prix par article, catalogue d'un fournisseur, fusion de doublons, statistiques fournisseur.

Endpoints connexes dans le périmètre prix :

| Méthode | Chemin | Effet prix | Appelé ? |
|---|---|---|---|
| POST | `/purchase-orders/:id/update-prices` | `purchase-order.repository.ts:219-286` : écrit `poi.unit_price` puis `UPDATE ingredients SET unit_cost` (**ignore `packaging_id`** : une ligne consommable passe `ingredient_id=NULL` → no-op, le prix du consommable n'est jamais mis à jour par ce chemin, l.267-276) | oui : `purchase-orders.api.ts:21` |
| POST | `/purchase-orders/:id/confirm-delivery` | via `receptionVoucherRepository.create` : écrase `poi.unit_price` (l.393-396), `packaging_items.unit_cost` (l.421-424), `ingredients.unit_cost` (l.462-466), fige `ingredient_lots.unit_cost` (l.429-435) | oui |
| PUT | `/purchase-orders/:id/items` | `replaceItems` : « le dernier prix saisi fait foi » (l.446-452) | oui |
| GET | `/inventory/purchases` | vue « Entrées (achats) » valorisée au prix de réception, **sans dimension fournisseur** (`inventory.repository.ts:188-261`) | oui : `inventory.api.ts:14` |
| GET | `/ledger/auxiliaries` | liste des tiers auxiliaires | **non** : `accountAuxiliariesApi` (`ledger.api.ts:22-26`) jamais importé dans `client/src/features` |
| GET | `/reports/finance-overview` | `topSuppliers` = fournisseurs créditeurs (dû) uniquement (`dashboard.repository.ts:133-168`) | oui |

### 3.2 Écrans

| Fichier | Lignes | Rôle | Fonction |
|---|---|---|---|
| `client/src/features/purchasing/PurchasingPage.tsx` | 103-363 | admin/manager | Onglet « Fournisseurs » : 3 tuiles (total/actifs/inactifs), filtre statut, recherche (nom, contact, tél, ville, ICE), table 7 colonnes, modal création/édition à 8 champs (`name*`, `contactName`, `phone`, `email`, `city`, `address`, `ice`, `notes`), désactivation/réactivation. **Pas de fiche détail** (pas d'onglets BC / factures / articles / prix du fournisseur). |
| `client/src/features/accounting/PurchaseOrdersTab.tsx` | 1025-1035 | admin/manager | Création BC : `<select>` fournisseur natif filtré `is_active !== false` ; prix unitaire pré-rempli depuis `unit_cost` catalogue (l.899-908, 964-973), sans suggestion de fournisseur habituel ni dernier prix chez ce fournisseur. |
| `client/src/features/accounting/PurchaseOrdersTab.tsx` | 1593-1690 | admin/manager | Réception : saisie prix unitaire par ligne (écrase le catalogue). |
| `client/src/features/inventory/IngredientDetailPage.tsx` | 396-408, 1113-1176 | tous (lecture), admin/manager (édition) | Smart button « DH / unité » = `unit_cost` ; fournisseur = texte libre (`<input>` l.1176) ; onglet Lots affiche `supplier_name` + `unit_cost` par lot (seul « historique de prix » visible). |
| `client/src/features/inventory/IngredientDetailPage.tsx` | 776-840 | chefs | `OrderRequestModal` : auto-match du fournisseur **par égalité de nom** entre `ingredients.supplier` (texte) et `suppliers.name` (l.788-790). |
| `client/src/features/inventory/InventoryPage.tsx` | 32, 176-194, 606-612, 653 | tous | Colonne « Dernier prix » (= `unit_cost`), filtre « Fournisseur » sur le texte libre. |
| `client/src/features/packaging/PackagingPage.tsx` | 210, 248, 387-390 | admin/manager | Consommables : fournisseur en texte libre (jamais renseigné : 0/109). |
| `client/src/features/purchasing/PurchaseRequestsPage.tsx` | 60-70 | admin/manager | Affectation (bulk) d'un fournisseur aux DA, groupées par fournisseur ; estimation = `qty × unit_cost` catalogue. |
| `client/src/features/inventory/IngredientImportModal.tsx` | 143 | admin | Import Excel : colonne « Fournisseur » texte → `ingredients.supplier`. |

Composant `SearchSelect` : utilisé pour les filtres (InventoryPage, AccountingPage) mais **pas** pour le choix du fournisseur à la création du BC (select natif).

---

## 4. Logique métier codée

### 4.1 Machine à états du prix catalogue (`ingredients.unit_cost` / `packaging_items.unit_cost`)

Il n'y a pas de machine à états à proprement parler : une seule valeur, écrasée. Transitions codées :

| # | Déclencheur | Code | Règle |
|---|---|---|---|
| 1 | Création ingrédient (fiche ou « Nouvel article » dans le BC) | `inventory.repository.ts:312-313` | `unit_cost` = saisie (0 autorisé) |
| 2 | Édition fiche ingrédient | `inventory.repository.ts:338-355` puis cascade l.357-378 : `syncProductPrice` + `recalcParents` pour chaque recette utilisant l'ingrédient | écrase ; répercute sur `products.price` via marge |
| 3 | Import Excel | `ingredient-import.controller.ts:250-254` | écrase `unit, unit_cost, supplier, allergens, category` ; cascade recettes après commit (l.277+) |
| 4 | Création BC | `purchase-order.repository.ts:172-181` | **n'écrit pas** le catalogue ; `poi.unit_price` = prix saisi (pré-rempli depuis le catalogue côté client) |
| 5 | Réception BC (`confirm-delivery` / `reception-vouchers`) | `reception-voucher.repository.ts:385-396` (`effectiveCost = item.unitPrice ?? poi.unit_price`), l.421-424 (consommable), l.462-466 (ingrédient) | si `effectiveCost > 0` → écrase le catalogue. Lot figé à `effectiveCost` (l.429-435). |
| 6 | Saisie des prix a posteriori (`update-prices`) | `purchase-order.repository.ts:267-276` | écrase `ingredients.unit_cost` pour chaque ligne, **sans tester `> 0`** ni `packaging_id` |
| 7 | Édition admin des lignes BC (`replaceItems`) | `purchase-order.repository.ts:446-452` | « le dernier prix saisi fait foi » (ingrédient ou consommable) |
| 8 | Conversion ingrédient → consommable | `inventory.repository.ts:523-526` | copie `unit_cost` et `supplier` texte |
| 9 | Restock direct (`/inventory/restock`) | `inventory.controller.ts:38-46` | **lit** `unit_cost` pour le lot, n'écrit pas le catalogue |

Observations :
- **Méthode = dernier prix (LIFO d'écriture)**, pas de CMUP, pas de prix standard/écart d'achat. Le coût matière des recettes (`v_recipe_direct_cost` : `ri.quantity * ing.unit_cost * fn_unit_conv(...)`) et donc le prix de vente suggéré bougent à chaque réception.
- **Le prix n'est pas qualifié** : ni fournisseur, ni date, ni conditionnement, ni unité de prix. Une saisie « par carton » ou « en g au lieu de kg » pollue immédiatement toutes les recettes (exemples §6.5 : Mangue 1 100 « kg » à 0,04 DH ; Crème fraîche chez le même fournisseur de 18,67 à 190 DH/l).
- **Absence de garde-fou** : aucune alerte d'écart entre prix BC et prix réception, aucune tolérance, aucun seuil de variation vs dernier prix.
- Le prix catalogue d'un ingrédient commandé à prix NULL (15 lignes BC) reste l'ancien : incohérence entre « Prix à définir » et le coût utilisé en recette.
- Le script `server/src/scripts/reconcile-po-item-prices.ts` existe pour re-synchroniser `poi.unit_price` depuis le dernier `rvi.unit_price` (bug historique corrigé par l.393-396) : il atteste que les 3 prix (BC, réception, facture) ont déjà divergé en prod.

### 4.2 Cycle de vie fournisseur

```
[création POST /suppliers] ──► is_active = true
      │  (aucun auxiliaire 4411 créé ici ; provision à la 1re écriture comptable)
      ▼
   actif ──DELETE /suppliers/:id (admin)──► inactif (is_active=false)
      ▲                                           │
      └───── PUT {isActive:true} (admin/manager) ─┘
```
- Pas d'état « bloqué achat », « bloqué paiement », « en validation », « archivé ».
- Un fournisseur inactif reste sélectionnable par l'API (aucun contrôle serveur sur `purchase_orders.create`, `invoices.create`) ; seul le client filtre.
- Création implicite par les imports : `caisse-import.controller.ts:126-132` (match par `UPPER(TRIM(name))`, sinon INSERT), `scripts/import-invoices-excel.ts:306`, `import-cheques-excel.ts:178`, `import-depenses-avril-mai-2026.ts:387` (aliasing codé en dur `SUPPLIER_ALIASES` l.85). La normalisation des noms vit dans les scripts, pas dans le référentiel.

### 4.3 Historique de prix (de fait)

| Source | Granularité | Restitution UI |
|---|---|---|
| `purchase_order_items.unit_price` + `purchase_orders.supplier_id/order_date` | ligne BC | détail BC seulement |
| `reception_voucher_items.unit_price` | ligne BR | détail BR |
| `ingredient_lots.unit_cost` + `supplier_id` + `received_at` | lot | onglet Lots de la fiche ingrédient (`IngredientDetailPage.tsx:941-956`) |
| `invoice_items.unit_price` | ligne facture (631 lignes liées à un ingrédient) | détail facture |

Aucune vue agrégée « prix de X dans le temps / par fournisseur », aucun calcul de volatilité, aucune comparaison inter-fournisseurs.

### 4.4 Conditionnement à l'achat (mig 225/226, `container-rule.ts`)
- `ingredients.container_type_id` + `container_size` (11/405 renseignés) : règle « contenant entier » appliquée à la création du BC (`purchase-order.repository.ts:174-177`) et aux DA.
- Le conditionnement est **par ingrédient**, pas par fournisseur : impossible de modéliser « Farine 25 kg chez A, 50 kg chez B ».
- Le prix reste exprimé dans l'unité de stock (kg) ; pas de « prix par contenant » stocké.

### 4.5 Routage ingrédient / consommable (mig 207)
`fn_purchasable_kind(category_id)` : branche Emballages / Entretien / Équipements → `packaging_items`, sinon `ingredients`. Pertinent pour la fiche article (deux référentiels d'articles achetables, deux colonnes `unit_cost`, un seul lien fournisseur texte sur chacun).

---

## 5. Analytique fournisseur existante (D9)

| Capacité | Existe ? | Où |
|---|---|---|
| Dettes par fournisseur (soldes ouverts) | oui | `AccountingPage.tsx:333-640` (vue agrégée par tiers), `dashboard.repository.ts:133-168` (top 10 créditeurs) |
| Dépenses par fournisseur sur période | partiel | filtre `supplierId` sur `invoiceRepository.findAll` / `findLineExpenses` (`accounting.repository.ts:508, 1472`) ; pas de tableau de bord dédié |
| Entrées d'achats par article (valorisées) | oui | GET `/inventory/purchases`, **sans fournisseur** |
| Performance fournisseur (OTIF, délai, taux de litige) | **non** | `expected_delivery_date` existe mais n'est agrégé nulle part |
| Écart prix BC/réception/facture par fournisseur | **non** | seulement le script ad hoc `reconcile-po-item-prices.ts` |
| Volatilité / historique de prix par article | **non** | |
| Part de dépenses par catégorie × fournisseur | **non** | |
| Balance âgée fournisseurs | non (hors périmètre, D7) | |

---

## 6. Requêtes SQL et résultats (base locale, lecture seule)

### 6.1 Fournisseurs — complétude et qualité
```sql
SELECT count(*) total, count(*) FILTER (WHERE is_active) actifs, count(ice) avec_ice, count(phone) avec_tel,
       count(email) avec_email, count(contact_name) avec_contact, count(address) avec_adresse,
       count(city) avec_ville, count(notes) avec_notes FROM suppliers;
-- 40 | 31 | 17 | 24 | 21 | 17 | 20 | 21 | 15
```
```sql
SELECT ice, count(*) FROM suppliers WHERE ice IS NOT NULL AND ice<>'' GROUP BY 1 HAVING count(*)>1;
-- 000078523000008 | 2      (Supeco et Carrefour : même entité juridique, deux « enseignes »)
SELECT '['||name||']' FROM suppliers WHERE name<>trim(name);
-- [BIM ]
-- Doublons visuels : SONEPAL / SONEPALE (2 BC chacun), Épicerie vs « Marché local » (texte ingrédient)
SELECT count(*) FROM suppliers s WHERE NOT EXISTS (SELECT 1 FROM account_auxiliaries a WHERE a.supplier_id=s.id);
-- 5   (sablés 1 facture, JAWDA 1 facture, MAGNATE EMBALLAGE, ALERTE NUISIBLE, BIOUGNACH)
SELECT min(created_at)::date, max(created_at)::date FROM suppliers;  -- 2026-04-05 | 2026-08-01
```
Fournisseurs génériques :
```sql
SELECT s.name, count(*) nb, round(100.0*count(*)/(SELECT count(*) FROM purchase_orders),1) pct,
       round(sum((SELECT sum(quantity_delivered*coalesce(unit_price,0)) FROM purchase_order_items WHERE purchase_order_id=po.id)),0) montant
FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id GROUP BY s.name ORDER BY nb DESC LIMIT 6;
-- Épicerie         | 87 | 28.6 | 19261
-- Marché aux puces | 72 | 23.7 | 17143
-- Abedlkrim        | 23 |  7.6 |  5246
-- Ecomab           | 18 |  5.9 | 40386
-- Supeco           | 14 |  4.6 |  4170
-- Abdelilah        | 11 |  3.6 |  6696
SELECT s.name, count(DISTINCT poi.ingredient_id) FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
JOIN purchase_order_items poi ON poi.purchase_order_id=po.id WHERE s.name IN ('Épicerie','Marché aux puces') GROUP BY 1;
-- Marché aux puces | 85 ingrédients distincts ; Épicerie | 76
```
Autres usages du référentiel : `debts` 0, `fixed_assets` 0, `recurring_charges` 0, `purchase_requests` 31/31 avec fournisseur. 12 fournisseurs sur 40 n'ont aucun BC ni facture (9 inactifs = seed de démo : Minoterie Atlas, Sucre du Maroc, Laiterie du Gharb…). 1 fournisseur inactif a des BC (Epices & Aromes du Sud).

### 6.2 Ingrédients / consommables — lien fournisseur et prix
```sql
SELECT count(*) total, count(supplier_id) avec_supplier_id, count(supplier) FILTER (WHERE supplier<>'') avec_supplier_texte,
       count(supplier_reference) avec_ref_fourn, count(*) FILTER (WHERE unit_cost>0) prix_positif,
       count(*) FILTER (WHERE unit_cost=0) prix_zero, count(container_type_id) avec_contenant, count(container_size) avec_taille
FROM ingredients;
-- 405 | 0 | 137 | 0 | 378 | 27 | 11 | 11
SELECT supplier, count(*) FROM ingredients WHERE supplier_id IS NULL AND supplier<>'' GROUP BY 1 ORDER BY 2 DESC LIMIT 8;
-- Générique 54 | Duchef 14 | Marché local 13 | DGF 10 | ECOMAB 8 | Ovotec 8 | VHP 3 | RICA MAROC 2 …
SELECT count(*) FILTER (WHERE s.id IS NOT NULL) match, count(*) total FROM ingredients i
LEFT JOIN suppliers s ON lower(trim(s.name))=lower(trim(i.supplier)) WHERE i.supplier<>'';
-- 21 | 137   (seuls 21 textes correspondent à une fiche fournisseur)
SELECT count(*) total, count(*) FILTER (WHERE unit_cost>0) prix_positif, count(supplier) FILTER (WHERE supplier<>'') avec_supplier FROM packaging_items;
-- 109 | 99 | 0
-- Ingrédients à prix 0 utilisés en recette : 0 (les 27 à 0 sont hors nomenclature : Herbe, Olives noires, Son de blé…)
```

### 6.3 Concordance texte fournisseur vs réalité des achats
```sql
WITH maj AS (SELECT DISTINCT ON (poi.ingredient_id) poi.ingredient_id, s.name sname, count(*) n
  FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.purchase_order_id JOIN suppliers s ON s.id=po.supplier_id
  WHERE poi.ingredient_id IS NOT NULL GROUP BY poi.ingredient_id, s.name ORDER BY poi.ingredient_id, n DESC)
SELECT count(*) total,
       count(*) FILTER (WHERE lower(trim(i.supplier))=lower(trim(m.sname))) concorde,
       count(*) FILTER (WHERE i.supplier<>'' AND lower(trim(i.supplier))<>lower(trim(m.sname))) discorde,
       count(*) FILTER (WHERE i.supplier IS NULL OR i.supplier='') sans_texte
FROM maj m JOIN ingredients i ON i.id=m.ingredient_id;
-- 275 | 8 | 58 | 209
```

### 6.4 Multi-fournisseurs
```sql
SELECT nf, count(*) FROM (SELECT poi.ingredient_id, count(DISTINCT po.supplier_id) nf FROM purchase_order_items poi
  JOIN purchase_orders po ON po.id=poi.purchase_order_id WHERE poi.ingredient_id IS NOT NULL GROUP BY 1) x GROUP BY 1 ORDER BY 1;
-- 1 fournisseur : 211 | 2 : 36 | 3 : 19 | 4 : 4 | 5 : 4 | 6 : 1   → 64/275 ingrédients multi-sourcés
-- Exemples : Filet de dinde fumé 6 fournisseurs (7,90 → 62,90) ; Lait 5 ; Amande poudre 5 (57,5 → 120) ; Crème fraîche 5
```

### 6.5 Prix — couverture, dérive, volatilité
```sql
SELECT count(*) total, count(*) FILTER (WHERE unit_price IS NULL) prix_null, count(*) FILTER (WHERE unit_price=0) prix_zero,
       count(packaging_id) consommable, count(ingredient_id) ingredient FROM purchase_order_items;
-- 810 | 15 | 1 | 152 | 658
SELECT count(*) total, count(*) FILTER (WHERE unit_price IS NULL) prix_null FROM reception_voucher_items;  -- 789 | 7
-- Dernier prix BC vs catalogue : 269 ingrédients comparés, 2 écarts (Amande poudre 99,5 vs 57,5 ; Mangue 40 vs 0,04)
-- → confirme que le catalogue EST le dernier prix (dérive réécrite en permanence)
```
Volatilité (ratio max/min des prix BC, ≥ 3 lignes) :
```
Eau de fleur d'oranger (unit)  6 lignes   4.00 → 235.00   ×58.75
Crème fraiche (l)              6          18.67 → 190.00  ×10.18
Filet de dinde fume (unit)    13           7.90 → 62.90   ×7.96
Huile de table (l)             4          17.00 → 81.95   ×4.82
Semoule kenz (kg)              4           2.24 → 10.19   ×4.55
Sésame décortiqué (kg)        12          22.00 → 64.00   ×2.91
Sucre semoule (kg)            23           5.00 → 10.40   ×2.08
```
Même fournisseur, même article : Crème fraiche chez Abedlkrim 18,67 → 190 ; Eau de fleur d'oranger chez Épicerie 4 → 22 ; Sucre semoule chez Supeco 5,17 → 10,40. Lignes aberrantes (unité) : `Mangue | kg | qty 1100 | 0.04 DH` (BC-2026-0035), `Crème fraîche | kg | 24 | 0.00` (BC-2026-0003), `Sirop de glucose | g | 500 | 0.024`.

### 6.6 Impact valorisation et lots
```sql
SELECT round(sum((economat_quantity+pesage_quantity)*coalesce(il.unit_cost,i.unit_cost)),0) val_lot,
       round(sum((economat_quantity+pesage_quantity)*i.unit_cost),0) val_catalogue
FROM ingredient_lots il JOIN ingredients i ON i.id=il.ingredient_id
WHERE il.status='active' AND (il.unit_cost IS NULL OR il.unit_cost<>'NaN'::numeric);
-- 141145 | 186381     (+32 % si l'on valorise au « dernier prix » plutôt qu'au coût d'entrée des lots)
SELECT count(*) FILTER (WHERE abs(il.unit_cost-i.unit_cost)/i.unit_cost>0.2), count(*) FROM ingredient_lots il
JOIN ingredients i ON i.id=il.ingredient_id WHERE il.status='active' AND il.quantity_remaining>0 AND il.unit_cost IS NOT NULL AND i.unit_cost>0;
-- 69 lots actifs sur 372 ont un coût d'entrée qui s'écarte de plus de 20 % du prix catalogue
SELECT count(*) FROM ingredient_lots WHERE unit_cost='NaN'::numeric;  -- 1 (Raisins secs golden, actif) ; 0 NaN ailleurs
```

### 6.7 Conditions de paiement / délais (données absentes du référentiel)
```sql
SELECT (due_date - invoice_date) delai_j, count(*) FROM invoices WHERE invoice_type='received' GROUP BY 1 ORDER BY 2 DESC LIMIT 3;
-- NULL 283 | 30 j 2 | 93 j 2
SELECT coalesce(expected_payment_mode,'NULL'), count(*) FROM invoices WHERE invoice_type='received' GROUP BY 1;
-- NULL 229 | cash 54 | check 24 | traite 10
-- Délai moyen commande→réception : 0 j pour Épicerie/Marché aux puces/Abedlkrim/Supeco (achats au comptoir), 0,8 j Ecomab, 2,3 j OVOTEC
```

---

## 7. Forces

1. Soft delete du fournisseur avec conservation de l'historique, réactivation possible (`accounting.repository.ts:347-349`, `PurchasingPage.tsx:126-140`).
2. ICE présent et imprimé sur les factures émises (`accounting.controller.ts:472`) ; PDF BC avec bloc fournisseur (nom, contact, tél, email, adresse — `purchase-order-pdf.service.ts:188-213`).
3. Auxiliaire 4411 par fournisseur, provisionné à la volée et idempotent (`journal-generator.service.ts:650-671`) ; plus de « facture sans écriture » pour cause d'auxiliaire manquant.
4. Traçabilité par lot : `ingredient_lots.supplier_id` + `unit_cost` + `received_at` figés à la réception (634/669) → base saine pour reconstruire un historique de prix et une valorisation au coût d'entrée.
5. Le prix saisi à la réception est propagé de façon cohérente vers BC (`poi.unit_price`), lot et facture (COALESCE rvi→poi) depuis la correction attestée par `reconcile-po-item-prices.ts`.
6. Routage ingrédient/consommable par catégorie (`fn_purchasable_kind`, mig 207) et règle « contenant entier » (`container-rule.ts`) : les bases du conditionnement à l'achat existent (type + quantité par contenant sur 11 ingrédients).
7. Lecture des fournisseurs ouverte aux chefs (DA) avec écriture réservée admin/manager, suppression admin : séparation des rôles correcte (`accounting.routes.ts:36-42`).
8. Pattern d'audit SGBD déjà éprouvé (mig 264 `recipe_bom_audit`, mig 239 `employee_salary_history`) réutilisable pour fournisseurs et prix.

---

## 8. Faiblesses (ordonnées par sévérité)

| # | Sév. | Domaine | Titre | Preuve | Impact |
|---|---|---|---|---|---|
| W1 | critique | D1, D8 | Prix catalogue = dernier prix écrasé sans qualification (fournisseur, unité, conditionnement) et sans garde-fou | `reception-voucher.repository.ts:385, 462-466` ; `purchase-order.repository.ts:267-276, 446-452` ; `v_recipe_direct_cost` = `ri.quantity * ing.unit_cost` ; SQL §6.5 (Crème fraiche 18,67→190 chez le même fournisseur, Mangue 0,04 DH/kg) | Une saisie erronée à la réception recalcule instantanément le coût de toutes les recettes, les prix de vente synchronisés (`syncProductPrice`) et la valorisation stock. Aucune alerte, aucune tolérance. |
| W2 | critique | D1, D2 | Pas de fiche article-fournisseur ; mig 136 (`supplier_id`, `supplier_reference`) jamais câblée | `grep supplier_reference server/src client/src` → 0 ; SQL §6.2 : 0/405 `supplier_id`, 0/405 `supplier_reference` ; texte libre `supplier` concorde avec le fournisseur réel dans 8/275 cas (§6.3) | Impossible de proposer le fournisseur habituel, la référence fournisseur sur le BC, le dernier prix chez ce fournisseur, le conditionnement par fournisseur ; les DA sont affectées à la main (`bulkAssignSupplier`). |
| W3 | critique | D1, D9, D8 | 52 % des BC rattachés à deux fournisseurs génériques (« Épicerie », « Marché aux puces ») | SQL §6.1 : 159/304 BC, 161 ingrédients distincts | Analyse par fournisseur, auxiliaire 4411, relances et balance âgée dénués de sens pour la moitié des achats ; mélange achats comptoir / vrais tiers. |
| W4 | critique | D8, D1 | Valorisation stock au « dernier prix » vs coût d'entrée des lots : +45 kDH (+32 %) | SQL §6.6 : 141 145 vs 186 381 DH ; 69/372 lots actifs à >20 % d'écart ; `InventoryPage.tsx:183` valorise à `unit_cost` | Valeur de stock et marge théorique surestimées/instables ; incohérence avec la vue « Entrées (achats) » qui valorise au prix de réception (`inventory.repository.ts:213`). |
| W5 | majeur | D1 | Fiche fournisseur sans IF, RC, patente, CNSS, RIB, conditions de paiement, délai, catégorie, contacts multiples, devise | `019_accounting_module.sql:2-14` ; `accounting.repository.ts:321-345` (8 champs) ; SQL §6.7 : `due_date` NULL sur 283/317 factures, `expected_payment_mode` NULL sur 229/317 | Factures non conformes aux mentions légales marocaines (IF/RC du fournisseur), échéances fournisseurs non calculables automatiquement, pas de données bancaires pour les virements. |
| W6 | majeur | D1, D10 | Aucune validation ni unicité sur `suppliers` (nom, ICE, email) ; `req.body` brut | `accounting.controller.ts:65-72` (pas de zod, aucun fichier dans `server/src/validators/` pour supplier) ; SQL §6.1 : `BIM ` avec espace, SONEPAL/SONEPALE, 2 fiches même ICE | Doublons de tiers → dettes et historiques éclatés ; ICE non vérifié (15 chiffres). |
| W7 | majeur | D1, D8 | Création d'un fournisseur ne crée pas son auxiliaire 4411 ; label d'auxiliaire figé | `accounting.repository.ts:321-333` ; provision seulement dans `journal-generator.service.ts:650-671` ; SQL : 5/40 sans auxiliaire dont 2 avec facture | Plan de tiers incomplet jusqu'à la première écriture ; renommage fournisseur non répercuté sur le label 4411. |
| W8 | majeur | D1 | Multi-sourcing réel non modélisé (64/275 ingrédients achetés chez 2 à 6 fournisseurs) | SQL §6.4 | Pas de comparatif prix par fournisseur, pas de fournisseur préféré/secondaire, pas de part d'achats par fournisseur par article. |
| W9 | majeur | D9 | Aucune analytique fournisseur : pas de dépenses par fournisseur/période, pas de performance (OTIF, délai, litiges), pas de volatilité/historique prix | `dashboard.repository.ts:133-168` (seul widget : dû par fournisseur) ; `inventory.repository.ts:188-261` sans dimension fournisseur ; aucune route `/reports/*supplier*` | Pas de négociation outillée, pas de détection des dérives (Eau de fleur d'oranger ×58, Sucre ×2). |
| W10 | majeur | D1, D5 | Conditionnement par ingrédient, pas par fournisseur ; prix non exprimé par contenant | `ingredients.container_type_id/container_size` (11/405) ; `container-rule.ts:38-51` ; aucune colonne « prix par contenant » | Saisies ambiguës (prix du sac vs du kg) → aberrations §6.5 ; impossible de gérer deux conditionnements pour un même article. |
| W11 | majeur | D1 | Consommables (`packaging_items`) sans `supplier_id` ni référence fournisseur ; texte `supplier` vide sur 109/109 | `\d packaging_items` ; SQL §6.2 ; `PackagingPage.tsx:387-390` | Les 152 lignes BC consommables n'ont aucun rattachement article-fournisseur. |
| W12 | majeur | D1, D10 | Fournisseur inactif non bloqué côté serveur ; filtre uniquement client | `purchase-order.controller.ts:41-56` (aucun test `is_active`) ; `PurchaseOrdersTab.tsx:1031` filtre côté client ; `GET /suppliers` renvoie tout (`accounting.repository.ts:313-315`) | Un appel API direct ou un écran oublié permet de commander/facturer chez un fournisseur désactivé. |
| W13 | majeur | D10 | Aucune piste d'audit sur fournisseurs et prix (pas de `updated_at`, pas de journal) alors que le pattern existe (mig 264) | `\d suppliers` ; `UPDATE ingredients SET unit_cost` sans journal (`reception-voucher.repository.ts:464`) | Impossible d'expliquer a posteriori un changement de coût ou de tiers (exigence traçabilité du projet). |
| W14 | majeur | D1, D10 | Création implicite de fournisseurs par les imports (caisse, chèques, factures Excel) avec matching par nom en majuscules ; aliasing codé en dur dans un script ; fournisseur « Personnel – Avances caisse » | `caisse-import.controller.ts:6, 38-57, 126-132` ; `import-depenses-avril-mai-2026.ts:85, 371-385` | Prolifération de doublons et détournement du référentiel fournisseurs pour des salariés. |
| W15 | mineur | D1 | `update-prices` ignore `packaging_id` : le prix catalogue d'un consommable n'est jamais mis à jour par ce chemin, et pas de test `> 0` | `purchase-order.repository.ts:267-276` | Incohérence mineure entre chemins de mise à jour ; un prix 0 saisi a posteriori écrase le catalogue. |
| W16 | mineur | D1, D10 | Endpoints/API morts : `GET /suppliers/:id` (jamais appelé), `accountAuxiliariesApi` (jamais utilisé) ; `PUT` stocke `""` au lieu de NULL (FormData) | `grep suppliersApi.getById client/src` → 0 ; `grep accountAuxiliariesApi client/src/features` → 0 ; `PurchasingPage.tsx:301-303` | Dette ; champs vides stockés en chaîne vide, recherche/unicité future faussée. |
| W17 | mineur | D1 | Sélecteur fournisseur = `<select>` natif à la création du BC, sans recherche ni fiche rapide ; pas de fiche détail fournisseur (onglets BC / factures / articles) | `PurchaseOrdersTab.tsx:1029-1035` ; `PurchasingPage.tsx:103-363` | Ergonomie faible avec 40+ tiers ; aucune vue 360° fournisseur. |
| W18 | mineur | D1, D8 | 1 lot actif avec `unit_cost = NaN` (Raisins secs golden) ; 27 ingrédients à prix 0 | SQL §6.6, §6.2 | Pollue les agrégats de valorisation (SUM → NaN) ; coût incomplet si ces ingrédients entrent en recette. |

---

## 9. Code mort / inutilisé

- `ingredients.supplier_id`, `ingredients.supplier_reference`, index `idx_ingredients_supplier_ref`, `idx_ingredients_supplier_id` (mig 136) : jamais écrits ni lus.
- `GET /suppliers/:id` (`accounting.routes.ts:39`) : `suppliersApi.getById` défini mais jamais appelé.
- `accountAuxiliariesApi.list` (`client/src/api/ledger.api.ts:22-26`) : jamais importé dans `client/src/features`.
- `packaging_items.supplier` : affiché et saisissable mais vide sur 109/109.
- 9 fournisseurs inactifs sans aucun mouvement (seed de démo : Minoterie Atlas, Sucre du Maroc, Laiterie du Gharb, Emballages Pro, Chocolaterie Aiguebelle, Ibrahim Fruit, légumes et fruits…).
- `server/src/scripts/reconcile-po-item-prices.ts` : script de réparation one-shot (le bug qu'il corrige est fixé en l.393-396 du repo réception).
- Aucun test unitaire ou d'intégration ne couvre fournisseurs ou prix (`server/src/__tests__/` : recipe-composition, smoke, tva, units-densite, container-rule).

---

## 10. Questions ouvertes

1. « Épicerie » et « Marché aux puces » : s'agit-il d'achats comptoir sans tiers identifiable (à modéliser comme « fournisseur divers / achat au comptant » avec justificatif) ou d'enseignes réelles à éclater ?
2. Supeco / Carrefour partagent l'ICE 000078523000008 (groupe Label'Vie) : faut-il une notion d'entité juridique (ICE/IF/RC) distincte des points de vente / enseignes ?
3. Méthode de coût cible pour `ingredients.unit_cost` : dernier prix (actuel), CMUP, ou prix standard + écarts d'achat ? La réponse conditionne D8 (GR/IR, écarts) et la stabilité des prix de vente synchronisés.
4. Les prix d'achat sont-ils HT ou TTC ? Rien dans le modèle ne le précise (TVA par ligne existe sur `invoice_items`, mig 189, mais pas sur `purchase_order_items`).
5. Doit-on backfiller `ingredients.supplier_id` depuis le fournisseur majoritaire des BC (275 ingrédients) ou depuis le texte (21 correspondances) avant de construire la fiche article-fournisseur ?
6. Le fournisseur « Personnel – Avances caisse » est-il encore utilisé par l'import caisse (il est inactif) ou remplacé par le module avances (mig 228) ?
7. Les 9 fournisseurs seed inactifs peuvent-ils être purgés ?
