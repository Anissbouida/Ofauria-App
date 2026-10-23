# Audit fonctionnel & technique — Ofauria (système complet)

_Date : 2026-07-09 · Périmètre : achats/appro, production/recettes, ventes/POS/commandes, stocks/économat, comptabilité/finance/RH, interfaces client + mobile._
_Complément : la sécurité est traitée séparément dans [AUDIT_SECURITE.md](AUDIT_SECURITE.md) (13 vulnérabilités classées) — non dupliquée ici._

---

## Résumé exécutif

Le système couvre un périmètre fonctionnel remarquablement large pour une boulangerie-pâtisserie (traçabilité lots ONSSA, ledger CGNC en partie double, calcul inverse de production, FEFO, multi-zones économat/pesage). Le socle est bon. Les problèmes sont de trois natures :

1. **Doublons structurels** — presque chaque donnée clé (stock, CA, charges, reste-à-payer, nomenclatures, catégories) existe en 2 ou 3 exemplaires calculés différemment, avec réconciliation partielle ou absente. C'est la source n°1 des chiffres qui ne collent pas entre écrans.
2. **Bugs concrets identifiés** — 10 anomalies à corriger en priorité (coût matière = 0 sur produits composés, double décrément de stock, double comptage du CA dans le reporting, collision possible de numéros de BC, etc.).
3. **Écarts vs ERP du domaine** — les grands manques face aux ERP boulangerie (type Copilote, VIF, Infologic ou modules bakery de Sage/Odoo) : pas de valorisation de stock (CMP/COGS), pas de point de commande/MRP, pas de 3-way match achats, pas d'ordonnancement fournil, traçabilité rompue au niveau des semi-finis, pas de clôture annuelle.

---

## 1. Doublons de données (backend)

### 1.1 Stock : 7 notions, 5 journaux, 0 ledger central

| Stock | Table de solde | Journal de mouvements |
|---|---|---|
| Matières (agrégé) | `inventory` (cache dérivé des lots depuis mig 114) | `inventory_transactions` |
| Matières (par lot) | `ingredient_lots` (économat/pesage) | `ingredient_stock_zone_transfers`, `production_lot_usage` |
| Emballages/consommables | `packaging_store_stock` | `packaging_stock_transactions` |
| Produits finis | `products.stock_quantity` (legacy) **et** `product_store_stock` (backroom+vitrine) | `product_stock_transactions` |
| Produits finis (par lot) | `product_lots` (backroom/vitrine/sold/wasted) | — |
| Semi-finis | `semi_finished_stock` | `semi_finished_transactions` |
| Semi-finis frigo | `stock_semifini_frigo` | `stock_frigo_transactions` |

Conséquences :
- **Trois chemins de calcul du même total matières** : table cache `inventory`, vue `v_ingredient_stock`, requête ad hoc `inventory.repository.ts:12-27`. Un desync réel est documenté dans l'en-tête de la mig 114.
- **`product_lots` et `product_store_stock` comptent le même stock physique sans invariant DB** garantissant l'égalité des sommes.
- **`semi_finished_stock` + `stock_semifini_frigo` additionnés à la volée** (`stock-frigo.repository.ts:216-234`) pour reconstituer une quantité « autoritative » — aveu du doublon.
- `ingredient_lots.quantity_remaining` duplique `economat_quantity + pesage_quantity` (trigger de sync — 3 colonnes pour 2 valeurs).

### 1.2 Chiffre d'affaires : 4 voies d'entrée, dédoublonnage incomplet

Le CA entre par : **POS** (`sales`), **saisie manuelle matin/soir** (`manual_shift_entries`, registre déclaré « temporaire » en mig 149), **factures émises** (`invoices emitted`), **import Excel** (`importDailySales`, ventes `IMP-…`).

- Le seul anti-double-comptage vit dans le **ledger** (`journal-generator.service.ts:306-313` : la saisie manuelle est autoritaire et extourne le POS du jour).
- **Le reporting compte en double** : `saleRepository.summary` `groupBy='payment'` fait un `UNION ALL` ventes POS + montants manuels (`sale.repository.ts:701-737`).
- **Le registre de caisse legacy compte en double** : `caisseRepository.getRegister` fait le même `UNION ALL` (`accounting.repository.ts:72-101`).
- **Vente B2B saisissable deux fois** : vente spéciale (`sales.sale_type='special'`) ET facture émise, sans contrôle croisé → double CA possible.
- Anti-doublon de la vente issue d'une commande deferred : un `notes LIKE '%Livraison commande …%'` (`accounting.controller.ts:624-627`) — fragile.

### 1.3 Finance : mêmes totaux calculés 3 fois

- **Reste à payer** : `invoices.paid_amount` dénormalisé / `SUM(payments)` / solde tiers non-lettré du ledger. Seule la paire 1↔3 est réconciliée (`v_reconciliation_check`, mig 183).
- **Charges d'une période** : `SUM(payments)` par catégorie / lignes factures proratisées TTC (`findLineExpenses`) / ledger classe 6. Trois montants possibles, aucune réconciliation.
- **Trésorerie caisse** : la vue legacy `getRegister` ne partage rien avec les comptes 5161/5141 du ledger — aucun rapprochement caisse↔compta (seul le rapprochement **bancaire** existe).

### 1.4 Nomenclatures (BOM) : 3 générations superposées

`recipe_ingredients`+`recipe_sub_recipes` (legacy) / `recipe_format_components` (par format, mig 200) / `recipe_components` (miroir du format par défaut, mig 205). Le helper `recipe-composition.helper.ts` gère les 3 avec fallbacks en cascade ; les migrations de reprise répétées (202, 217, 218, 220, 221) montrent des bascules jamais finalisées.

### 1.5 Coûts de revient : ≥ 5 implémentations aux formules différentes

6 vues SQL (`v_recipe_total_cost`, `v_rcomp_cost`, …) + `computeFinance` JS (recette) + `calculateAndSave` JS (coût réel) + `production-markup` — avec des assiettes de frais indirects **incompatibles** (voir §3.6).

### 1.6 Catégories : 6 référentiels

`categories` (produits), `expense_categories` (hiérarchique, « unifié »), `revenue_categories`, `ref_entries` (générique), plus colonnes texte legacy synchronisées par triggers sur `ingredients` et `packaging_items`. Le référentiel doit faire du `CASE WHEN` sur 4 sources (`referentiel.repository.ts:9-22`).

### 1.7 Autres doublons backend

- **Restock ingrédient : 2 implémentations divergentes** — `inventoryRepository.restock` (sans lot) vs `inventoryController.restock` (avec lot).
- **Numéro de BC généré à 2 endroits** : `purchase-order.repository.ts:97-120` (MAX+1 + advisory lock, correct) vs `purchase-request.repository.ts:178-184` (**COUNT(*)+1 sans lock — le bug corrigé ailleurs y est réintroduit**, collision `duplicate key` possible).
- **Complétion de production dupliquée** : `complete` (`production.repository.ts:643`) et `produceItems` (`:916`) réimplémentent chacun déduction matières + stock produit + création de lots.
- N° de facture fournisseur stocké dans `reception_vouchers.supplier_invoice_number` ET `invoices.invoice_number` (assumé mais risqué).
- `ingredients.supplier` (texte) ET `ingredients.supplier_id` (FK).

---

## 2. Doublons d'interface (écrans différents, même fonction)

Bonne nouvelle préalable : **`mobile/` est une coquille Capacitor qui charge `client/dist`** — zéro écran dupliqué web/mobile.

| # | Doublon | Écrans | Risque |
|---|---|---|---|
| D1 | Bons de commande | `purchasing/PurchasingPage` onglet BC **et** `accounting/PurchaseOrdersTab` (même API) | Deux UIs pour créer/réceptionner un BC |
| D2 | Factures fournisseurs | Achats « Factures reçues » **et** Comptabilité | Statuts de règlement gérés des deux côtés |
| D3 | Déclaration de perte | 4 surfaces : `pos/LossDeclarationModal`, `InventoryPage`, `UnsoldDecisionsPage`, `InventoryCheckValidationPage` | **Vocabulaires de motifs incompatibles** (`damaged` vs `breakage`, `dlc_expired` sans équivalent, `waste` vs `undeclared_loss`) → pertes non réconciliables |
| D4 | Stock ingrédients | Économat, Pesage (`warehouse`), + `StockFrigoPage` (morte) | Règles d'unités/quantités propres à chaque écran |
| D5 | Demandes d'achat | `PurchaseRequestsPage` **et** `warehouse/RuptureRequestsList` (même API) | On ne sait pas quel écran fait foi |
| D6 | Réception marchandise | 3 formulaires : réception BC, réception BSI, `replenishment.confirmReception` | Conventions d'unités distinctes |

Navigation :
- **Deux menus codés en dur et désynchronisés** : Sidebar (17 entrées) vs grille HomePage (18 modules). « Emballages » et « Paramètres » n'existent que dans l'un des deux.
- **Écrans orphelins** : `/unsold` (aucun menu !), `/settings`, `/production/dashboard`, `/inventory-check/opening`.
- **Code mort** : `features/dashboard/DashboardPage.tsx` (114 l.) et `features/production/StockFrigoPage.tsx` (541 l.) — 0 import.

Duplication de code frontend :
- `formatCurrency` réimplémenté ≥ 6 fois en 3 variantes (`fr-MA`, `fr-FR`, `toFixed(2)`) + ~200 suffixes `" DH"` en dur → montants affichés différemment selon l'écran.
- Logique TVA réécrite côté client dans 4 features, sans util partagé (`shared/` ne contient que types/constantes).
- `SortableHeader` copié-collé dans 6 pages ; 3 modals d'import Excel quasi identiques ; 2 mécanismes concurrents de sélection de catégories (`CategoryCascadeSelector` vs implémentations maison POS/Products/Pipeline/Orders).
- Conversion d'unités dupliquée client/serveur (`client/src/utils/units.ts` = « miroir » manuel de `server/src/utils/units.ts`).

---

## 3. Incohérences et bugs concrets (à corriger en priorité)

1. **Coût matière = 0 pour tout produit composé.** `production-cout.repository.ts:355,445` filtre par `recipe_ingredients`, or `replaceForFormat` (`recipe-component.repository.ts:260`) **purge** cette table pour les recettes composées → `cout_matieres_item` et le dashboard coûts affichent 0.
2. **Double décrément possible du stock matières.** `complete`/`produceItems` décrémentent `inventory` en direct (`GREATEST(...-x,0)`, `production.repository.ts:717`) **puis** appellent `consumeFEFO` sur les lots, alors que `inventory` est déjà synchronisé depuis les lots par trigger (mig 114). Le clamp à 0 masque les ruptures.
3. **Double comptage du CA** dans `saleRepository.summary` et `getRegister` (POS + saisie manuelle additionnés) — le garde-fou n'existe que dans le ledger.
4. **Collision de numéros de BC** : `generatePurchaseOrder` utilise `COUNT(*)+1` sans lock (`purchase-request.repository.ts:178-184`).
5. **Écritures comptables « best-effort » silencieuses** : à la création de facture/paiement, l'échec de génération ledger est seulement loggué (`accounting.repository.ts:544-558, 1719-1729, 1812-1826`) → factures sans écriture jusqu'au prochain backfill.
6. **Coût prévu vs réel non comparables** : `cout_prevu` ignore `compo_par_piece` (`production-cout.repository.ts:235`) ; frais fixes réels = 40 % des matières **codé en dur**, énergie = 0, pertes = 0 — alors que le prévisionnel recette utilise `taux_frais_structure_pct` sur une autre assiette. L'`ecart_pct` n'a pas de sens métier.
7. **FEFO alloue des lots périmés** en fallback (`previewFEFO`, `ingredient-lot.repository.ts:421,435`).
8. **Conversions poids↔volume silencieusement fausses** tant que `densite_kg_l` est NULL (défaut) — le calcul continue avec un facteur 1 + simple warning (`recipe-composition.helper.ts:257-263`) ; densités et `container_size` seedés par regex sur le libellé.
9. **TVA incohérente selon la source** : `taxAmount = 0` codé en dur au POS (`sale.controller.ts:138`) et sur les commandes (`order.controller.ts:88`) ; facture auto de BC posée à TVA = 0 (`reception-voucher.repository.ts:165`) ; seule la facture saisie manuellement porte la TVA par ligne. Une facture à taux mixtes sans détail ligne est rabattue sur un seul compte TVA (`journal-generator.service.ts:79-98`).
10. **Traçabilité rompue aux semi-finis** : `semi_finished_stock` est un agrégat sans lot (`UNIQUE(recipe_id, store_id)`, un seul `expires_at`) → un produit fini fabriqué à partir de semi-finis ne remonte plus aux lots d'ingrédients. De plus `product_lots` est lié au **plan**, pas à l'item → rappel produit imprécis sur plan multi-produits ; et un produit sans `shelf_life_days` sort silencieusement de la traçabilité lot.

Autres incohérences notables : anti-cycle des recettes partiel (CHECK sur `recipe_components` seulement, absent de `recipe_format_components` ; `duplicateFormat` ne revalide pas ; les vues récursives tronquent à profondeur 12 au lieu de refuser) · `purchase_requests` sans `packaging_id` (les consommables ne passent pas par la liste d'attente) · statut `ordered` jamais utilisé · mapping catégories→comptes rabattu massivement sur `6181`, avec `equipements` mappé en charge au lieu d'immobilisation · écart de caisse (`difference`) jamais comptabilisé (pas de boni/mali) · encaissement d'impayé hors session → hors `expected_cash` · cession d'immobilisation sans écriture de sortie · barème de retenue à la source en table mais non câblé au calcul · `transferBackroomToVitrine` = simple UPDATE sans traçabilité (vs table de transferts côté ingrédients) · 3 notions de « contenant » non reliées · enums d'unités incohérents (`unit` vs `piece`).

---

## 4. Validation des workflows vs ERP boulangerie-pâtisserie

Référentiel de comparaison : pratiques des ERP spécialisés boulangerie/pâtisserie industrielle et artisanale (VIF, Copilote, Infologic-Copilote, modules bakery Sage X3/Odoo) : procure-to-pay avec 3-way match, GPAO avec ordonnancement, traçabilité lot bidirectionnelle HACCP/ONSSA, valorisation CMP/FIFO, POS avec Z de caisse, comptabilité avec clôture.

### 4.1 Achats (procure-to-pay) — structure conforme, contrôles absents
**Conforme** : chaîne demande → BC → réception (partielle gérée, `forceComplete`) → facture auto → paiement (partiel, retenue à la source) ; création de lots + DLC à réception ; fusion multi-BC en une facture ; garde-fous à l'annulation.
**Non conforme** :
- **Pas de 3-way match** : le montant de la facture papier fournisseur n'est jamais saisi ni comparé — la facture auto « matche » par construction (qté livrée × dernier prix). Aucun écart prix/quantité remonté.
- **Court-circuit total possible** : `POST /inventory/restock` crée du stock sans fournisseur/BC/réception/facture (`achat_direct`).
- **Pas d'avoir fournisseur** (`invoice_type` ∈ {received, emitted} seulement) ; l'annulation de réception **supprime physiquement la facture** — perte de piste d'audit.
- **Fiche fournisseur squelettique** : ni délais de livraison, ni minimum de commande, ni tarifs/catalogue par fournisseur, ni conditions de paiement par défaut.
- **Aucune suggestion de réappro matières** (pas de point de commande, pas de MRP), alors que `avg_daily_consumption` est déjà calculé.
- Aucune étape d'approbation (demande ou BC).

### 4.2 Production (GPAO) — calculs riches, ordonnancement absent
**Conforme** : machine à états claire (draft → confirmed → awaiting_ingredients → in_progress → completed), calcul inverse par contenant, besoins via helper unique, BSI auto avec FEFO, plans enfants semi-finis avec dépendances bloquantes, rendement réel, coût réel matières FIFO via `production_lot_usage`.
**Non conforme** :
- **Pas d'ordonnancement fournil** : aucun séquencement four/pousse/repos, pas de jalons horaires ni capacité machine (les équipements ne servent qu'au coût).
- **Pas de pesée guidée** (workflow pas-à-pas avec tolérances par ingrédient, balance connectée) — le BSI liste les quantités, c'est tout.
- **Pas de fiche technique imprimable normée** (poids pâton, étapes, allergènes) — seulement l'impression d'étiquettes NIIMBOT et un `@media print` sur la feuille de plan.
- **Semi-finis non lotés** → traçabilité ONSSA rompue à chaque étage (voir §3.10) ; les ERP du domaine lotissent chaque fournée de semi-fini.
- Réintégration des invendus (pain rassis → chapelure) : le schéma le permet (`recycled_ingredient_lot_id`) mais n'alimente ni nomenclature ni coût.

### 4.3 Ventes/POS — flux couverts, conformité fiscale et caisse incomplètes
**Conforme** : blocage d'ouverture de caisse sans contrôle d'inventaire validé (trigger DB — très bon), vérif stock vitrine, prix par canal au POS, acompte de commande encaissé en caisse, retours/échanges avec contrôle des quantités, décisions d'invendus obligatoires en fin de journée, destruction des périmés bloquant la clôture.
**Non conforme** :
- **Pas de Z de caisse** : pas de billetage, pas de numérotation Z, `difference` jamais comptabilisée en boni/mali.
- **TVA absente du POS et des commandes** (0 en dur) — bases CA divergentes selon la source ; ticket non normalisé fiscalement.
- Prix par canal non appliqué aux commandes ni aux ventes spéciales ; promotions inexistantes (seule remise globale manuelle) ; fidélité = cumul de points sans utilisation possible.
- Acomptes limités à 2 versements (création + livraison), pas d'échéancier.
- 3 notions de « client » non réconciliées (fiche `customers`, `unpaid_customer_name` libre, walk-in sur commande).

### 4.4 Stocks — traçabilité forte, valorisation absente
**Conforme** : lots ONSSA avec DLC + DLC post-ouverture, FEFO, zones économat/pesage avec transferts tracés, dual-clock DLC/DLV produits finis avec jobs d'expiration, contrôles qualité réception (température, visuel), inventaire ouverture/clôture avec double validation.
**Non conforme** :
- **Aucune valorisation de stock** : ni CMP ni FIFO comptable ; consommation valorisée au **prix catalogue courant** et non au coût du lot sorti (reconnu dans le code) ; COGS jamais figé ; produits finis et semi-finis sans valeur de stock.
- **Pas de campagne d'inventaire matières** (comptage figé + rapprochement global) — seulement des ajustements ligne à ligne ; écarts d'inventaire non valorisés, sans mouvement ni écriture.
- Quarantaine = simple statut sans workflow de levée ; pas de fiche de non-conformité ; pas de relevés de température des zones de stockage (HACCP partiel).
- Pas de stock maxi/point de commande.

### 4.5 Comptabilité — socle excellent, cycle incomplet
**Conforme** : partie double CGNC avec trigger d'équilibre, journaux AC/VE/BQ/CA/OD, numérotation sans trou, périodes verrouillables, idempotence des écritures, lettrage auto, extournes, rapprochement bancaire, avances salaire 3431 + retenue FIFO, amortissements idempotents, réconciliation legacy↔ledger sur les factures.
**Non conforme** :
- **Pas de clôture annuelle** : ni report à nouveau (1161/1169 jamais mouvementés), ni affectation du résultat, ni solde des classes 6/7.
- **Pas d'écriture de liquidation TVA** (déclaration = simple état ; pas de crédit reportable).
- **Pas d'export comptable réglementaire** (FEC/EDI, liasse, ETIC).
- Réconciliation caisse 5161 ↔ registre legacy inexistante.

---

## 5. Plan d'améliorations priorisé

### P0 — Corrections de bugs (1-2 semaines)
1. Coût matière des produits composés : baser `production-cout` sur le helper de composition (ou `production_lot_usage` par item), plus sur `recipe_ingredients` purgée.
2. Supprimer le décrément direct d'`inventory` dans `complete`/`produceItems` (laisser le trigger lots faire foi) — et fusionner les deux chemins de complétion en un seul.
3. Corriger le `UNION ALL` de `saleRepository.summary` et `getRegister` : exclure les ventes POS des jours ayant une saisie manuelle (même règle que le ledger).
4. Faire pointer `generatePurchaseOrder` vers `generateOrderNumber` (advisory lock).
5. Rendre la génération ledger bloquante (ou file de reprise + alerte), au lieu du SAVEPOINT silencieux.
6. Exclure les lots expirés de `previewFEFO`/`consumeFEFO` (blocage explicite avec dérogation).
7. Anti-doublon de la vente deferred : lien structurel `sale.order_id` au lieu du `LIKE` sur notes.
8. Anti-cycle : CHECK sur `recipe_format_components`, revalidation dans `duplicateFormat`, refus (pas troncature) dans les vues récursives.
9. Bloquer (ou exiger la densité) quand une conversion poids↔volume est demandée sans `densite_kg_l`.
10. Supprimer le code mort (`DashboardPage.tsx`, `StockFrigoPage.tsx`) et le restock sans lot de `inventoryRepository.restock`.

### P1 — Unifications structurelles (1-2 mois)
1. **Journal de mouvements de stock unifié** (une table `stock_movements` polymorphe ou a minima une vue consolidée) + **valorisation** : figer le coût du lot à chaque sortie FEFO (COGS), valoriser les écarts d'inventaire, publier une valeur de stock par magasin.
2. **Loter les semi-finis** (lot par fournée avec DLC propre + lien `production_lot_usage`) et lier `product_lots` à l'**item** de plan → chaîne de rappel complète amont↔aval.
3. **Référentiel de catégories unique** (achever la migration vers `expense_categories`/`ref_entries`, supprimer les colonnes texte + triggers de sync) ; **référentiel unique de motifs de perte** partagé par les 4 écrans.
4. **Un seul écran BC** (le garder dans Achats, la Compta n'en garde qu'une vue lecture), un seul point d'entrée « demandes d'achat », et ajouter `packaging_id` à `purchase_requests`.
5. **TVA de bout en bout** : TVA par ligne au POS/commandes/BC (les taux existent déjà côté factures), tickets ventilés, un seul module de calcul TVA partagé (`shared/`).
6. **Caisse** : comptabiliser l'écart de clôture (boni/mali), réconcilier `manual_shift_entries` avec les sessions, rapprochement caisse 5161 ↔ registre.
7. **Achats** : saisie du montant facture fournisseur + 3-way match avec écarts ; avoirs fournisseurs (`invoice_type='credit'`) au lieu de suppression physique ; encadrer `achat_direct` (fournisseur obligatoire, réservé admin).
8. **Frontend** : utilitaires partagés (`formatCurrency`, TVA, `SortableHeader`, modal d'import), source unique de navigation (Sidebar = grille HomePage), rattacher les orphelins (`/unsold` notamment), généraliser `CategoryCascadeSelector`.
9. Aligner prévu/réel des coûts de production : même assiette, mêmes postes (énergie, pertes réelles), taux de frais paramétré (supprimer le 40 % en dur).

### P2 — Fonctionnalités ERP différenciantes (3-6 mois, par valeur métier)
1. **Réappro matières automatique** : point de commande par ingrédient (conso moyenne × délai fournisseur + stock sécurité) → suggestions de BC groupées par fournisseur. Les briques existent (`avg_daily_consumption`, liste d'attente).
2. **Fiche fournisseur complète** : délais, minimum de commande, tarifs par fournisseur (historisés), conditions de paiement par défaut, comparateur.
3. **Ordonnancement fournil** : planning horaire des plans (pétrissage/pousse/cuisson), capacité four, feuille de fournée imprimable.
4. **Pesée guidée** au BSI (pas-à-pas, tolérance par ingrédient, compatible balance).
5. **Fiches techniques imprimables** (photo, étapes, poids pâton, allergènes, coûts) — obligatoire pour normes/audits qualité.
6. **Clôture comptable annuelle** (report à nouveau, affectation résultat) + écriture de liquidation TVA + export réglementaire.
7. **Commercial** : promotions/remises par ligne, utilisation des points fidélité, prix par canal sur commandes et ventes spéciales, échéanciers d'acomptes, unification de l'identité client.
8. **Qualité/HACCP** : workflow de quarantaine (blocage/levée), fiches de non-conformité liées aux écarts, relevés de température des zones.

---

## Points forts confirmés (à préserver)

- Ledger CGNC en partie double : équilibre par trigger, numérotation sans trou, idempotence, lettrage, extournes, verrous de période — au-dessus de ce qu'on trouve dans beaucoup de gestions commerciales.
- Traçabilité lots ONSSA amont (réception → lot → DLC post-ouverture → consommation FEFO) et chaîne de recyclage produit→ingrédient.
- Trigger DB bloquant l'ouverture de caisse sans contrôle d'inventaire validé, et la clôture sans destruction des périmés.
- Calcul inverse de production par contenant + plans enfants semi-finis avec dépendances.
- Mobile = Capacitor sur le build web : une seule base de code UI.
- Sécurité déjà auditée avec plan de remédiation ([AUDIT_SECURITE.md](AUDIT_SECURITE.md)).
