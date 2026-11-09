# Audit Ventes — D2 « Catalogue de vente, prix, remises, promotions et taxes »

> Date : 2026-11-09 · Branche : `claude/kalum-sales-cycle-o2c-audit-f724ad` · Migrations lues jusqu'à 467.
> Méthode : lecture seule du code (migrations, serveur, paquet partagé, client). Aucune base interrogée, aucun serveur lancé.
> Référentiels de comparaison : SAP S/4HANA SD (technique des conditions), Oracle Fusion Pricing / Order Management, Microsoft Dynamics 365 (Sales, SCM, Commerce), NetSuite, Sage X3, Odoo Enterprise.

Légende des statuts : ✅ Complet (serveur **et** écran câblés) · 🟡 Partiel · ❌ Absent.
Priorités : **P0** bloquant pour un ERP multi-secteur crédible ou obligation légale au Maroc · **P1** attendu par tout ERP de milieu de gamme · **P2** avancé · **P3** niche.

---

## 1. Périmètre et sources lues

**Périmètre** : données de vente de l'article, listes de prix, remises et majorations, contrôle des prix, ristournes de fin d'année, promotions / coupons / fidélité / cartes cadeaux, taxes à la vente (TVA, timbre, retenue à la source, devises), coût de revient et marge à la vente.
Hors périmètre (autres domaines) : flux commande → livraison → facture, encaissement, crédit client (cités seulement quand ils portent un prix ou une taxe).

**Migrations lues** (`server/migrations/`) : 003 (products), 008 (orders), 011 (sales), 052/061/245 (cycle de vie produit), 063 (sku), 069 (remise personnel), 128 (sale_unit, price_per_kg), 170 (arrondi), 171 (paliers au poids), 172 (canaux), 173 (prix par canal), 189 (TVA par ligne de facture), 210/212 (retenues à la source), 242 (remise client, exonération TVA), 250 (paiement mixte), 309 et 331 (`tax_codes`), 328 (journal d'audit du paramétrage), 337 (lots vendus), 354/355 (commandes pro, remise %), 363/368/431 (devises), 365 (devis), 369/370 (champs personnalisés, import), 372 (promotions, fidélité), 375 (familles de catégories), 377 (vente par personne), 382 (abonnements), 393 (commissions), 443 (prix grille, dérogation), 450 (avoirs), 451 (encaissement), 452 (coût figé).

**Serveur** (`server/src/`) : `validators/product.validator.ts`, `validators/sale.validator.ts`, `controllers/product.controller.ts`, `controllers/sale.controller.ts`, `controllers/order.controller.ts`, `controllers/subscription.controller.ts`, `repositories/product.repository.ts`, `repositories/product-channel-pricing.repository.ts`, `repositories/product-pricing-tier.repository.ts`, `repositories/delivery-note.repository.ts`, `repositories/quote.repository.ts`, `repositories/recipe.repository.ts` (synchronisation du prix), `services/pos-pricing.ts`, `services/promotions.ts`, `services/loyalty.ts`, `services/credit-control.ts`, `services/parameters-catalog.ts`, `services/module-parameters.service.ts`, `services/journal-generator.service.ts`, `services/data-import.ts`, `services/data-export.ts`, `routes/products.routes.ts`, `routes/promotions.routes.ts`, `routes/quotes.routes.ts`, `routes/currencies.routes.ts`.

**Partagé** : `shared/src/types/product.types.ts`, `shared/src/constants/units.ts`, `shared/src/constants/approvals.ts`.

**Client** : `features/products/ProductsPage.tsx`, `features/promotions/PromotionsPage.tsx`, `features/pos/POSPage.tsx`, `features/pos/BarcodeScannerModal.tsx`, `features/quotes/QuotesPage.tsx`, `features/sales/{ProSalesTab,EmittedInvoicesTab,SalesChannelsManager,SubscriptionsTab}.tsx`, `components/orders/OrderFormModal.tsx`, `features/customers/CustomersPage.tsx`, `features/settings/ImportSection.tsx`.

**Recherches négatives** (aucune occurrence utile dans `server/src`, `server/migrations`, `client/src`, `shared/src`) : `timbre|stamp_duty`, `gift_card|carte cadeau|bon d'achat`, `ristourne|rebate|rfa|remise arrière`, `price_list|pricelist|liste de prix|grille tarifaire`, `prix_plancher|floor_price|min_margin|marge minimale`, `min_order_qty|multiple de commande`, `delivery_fee|shipping|frais de port` (côté ventes), `consigne|écotaxe` (côté ventes), `name_ar|description_ar|translations` (sur produits), `price_history|price_audit`.

Les documents `docs/AUDIT_O2C_GAP_ANALYSIS.md`, `AUDIT_POS.md`, `AUDIT_PRODUITS.md`, `AUDIT_COUPLAGE_SECTORIEL.md` n'ont servi que de contexte ; tous les constats ci-dessous sont repris du code.

---

## 2. Ce qui existe (forces, avec preuves)

| Force | Preuve |
|---|---|
| **Moteur de promotions** : remise %, montant, prix spécial, « X achetés = Y offerts », sur articles ou panier ; conditions de période, jours, heures, magasin, type de client, niveau de fidélité, quantité ou montant minimum, code promo, nombre maximal d'utilisations ; trois canaux (caisse, commandes, devis) ; trace par pièce. | mig 372 (`promotions`, `document_promotions`) ; `server/src/services/promotions.ts:139` (`evaluate`) ; `server/src/routes/promotions.routes.ts:85-157` ; `client/src/features/promotions/PromotionsPage.tsx` ; caisse `POSPage.tsx:995` |
| **Fidélité complète** : points par dirham, valeur du point, seuil et plafond d'utilisation, expiration (lots FIFO), niveaux sur 12 mois glissants avec multiplicateur, écritures comptables (dette 4491 / 7129), tâche planifiée d'expiration. | mig 372 (`loyalty_settings`, `loyalty_tiers`, `loyalty_transactions`) ; `server/src/services/loyalty.ts:124-248` ; `sale.repository.ts:331` ; `routes/promotions.routes.ts:196-258` |
| **Prix par canal de vente** avec canaux paramétrables et écran dédié. | mig 172/173 ; `product-channel-pricing.repository.ts:30` ; `products.routes.ts:53-57` ; `ProductsPage.tsx:1409` (`ChannelPricingPanel`) ; `SalesChannelsManager.tsx` |
| **Prix caisse calculé par le serveur** : le client n'envoie ni prix ni sous-total. | `validators/sale.validator.ts:10-21` ; `services/pos-pricing.ts:11-36` ; `sale.controller.ts:131` |
| **Prix grille figé sur la ligne de commande et dérogation tracée** (auteur, motif, écart maximal par rôle) ; plafond de remise par rôle sur les commandes. | mig 443 (`order_items.list_price`, `price_override_by`, `price_override_reason`) ; `order.controller.ts:76-97` et `125-166` ; paramètre `sales.pricing` (`parameters-catalog.ts:123-133`) ; `OrderFormModal.tsx:899` |
| **Remise client** (taux sur la fiche) et **exonération de TVA** par client, appliquées aux commandes pro et aux BL ; **remise personnel** imposée par le serveur. | mig 242 (`customers.remise_pct`, `tva_exonere`) ; `delivery-note.repository.ts:97-109` ; mig 069 ; `order.controller.ts:78-82` |
| **TVA par ligne** sur commandes pro, devis, BL, factures clients ; TVA calculée après remise ; ventilation par taux dans l'écriture comptable. | mig 189, 354, 355, 365 ; `order.controller.ts:113-117` ; `journal-generator.service.ts:131-148`, `377-386` |
| **Référentiel de codes TVA datés** par pays, avec garde anti-chevauchement et journal d'audit. | mig 309/331 (`tax_codes`, trigger `tax_codes_no_overlap`) — utilisé aux achats seulement |
| **Vente au poids** (grammes, paliers dégressifs) et **vente par personne** (tailles paramétrables). | mig 128, 171, 377 ; `pos-pricing.ts:16-30` ; `ProductsPage.tsx:1399` (`PricingTiersPanel`) |
| **Lots vendus tracés** (caisse et BL) jusqu'au rappel de lot. | mig 337 (`sale_item_lots`), mig 440 ; `sale.repository.ts`, `recall.repository.ts` |
| **Champs personnalisés** sur la fiche produit, repris à l'export. | mig 369 ; `ProductsPage.tsx:1344` ; `data-export.ts:71` |
| **Coût de revient figé sur la ligne vendue** ; rapports de coût matière et matrice de rentabilité. | mig 452 (`sale_items.unit_cost`, `delivery_note_items.unit_cost`) ; `reports.controller.ts:240-293`, `386-447` |
| **Factures clients en devise** avec écart de change réalisé et réévaluation de clôture. | mig 363/368/431 ; `EmittedInvoicesTab.tsx:115-118`, `634-641` |
| **Import générique** de mise à jour des produits (prix, référence, catégorie, disponibilité) avec aperçu, journal et annulation. | `services/data-import.ts:112-123` ; `features/settings/ImportSection.tsx` |

---

## 3. Tableau des capacités

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| **A. Données de vente de l'article** | | | | | | | |
| D2-01 | Fiche article de vente autonome (créée et tarifée sans fiche technique) | SAP MM01 vue Ventes ; Odoo Produit ; NetSuite Item | 🟡 | `ProductsPage.tsx:1007-1010` (recette obligatoire à la création) ; `ProductsPage.tsx:1352` (prix de vente en lecture seule) ; `recipe.repository.ts:664-671` (prix écrit par la recette) | Un article ne se crée à l'écran qu'avec une recette et son prix n'est pas saisissable ; seul l'import CSV crée un article sans recette (`product.controller.ts:381`). **Couplage boulangerie.** | P0 | Négoce, distribution, retail, services |
| D2-02 | Types d'article : stocké, non stocké, service, abonnement, numérique, frais | SAP type de poste / groupe d'articles ; D365 Product type ; Odoo type de produit | 🟡 | Aucune colonne de type sur `products` (colonnes relevées : mig 003, 028, 029, 050, 052, 061, 063, 128, 377) ; abonnements au montant : mig 382 (`subscriptions`), `subscription.controller.ts:14-28` | Pas de type d'article ; l'abonnement est un contrat « libellé + montant » hors catalogue ; tout article est supposé fabriqué et stocké en vitrine. | P0 | Services, logiciel, location, traiteur |
| D2-03 | Unités de vente et conversions (pièce, kg, carton, palette, heure…) | SAP unités alternatives (MARM) ; D365 Unit conversions ; Sage X3 US/UV | 🟡 | CHECK `products_sale_unit_check` = unit / weight / person (mig 377) ; `sale_items.unit` = unit / g / person ; `shared/src/constants/units.ts` (5 unités fixes) | Trois modes codés en dur, pas de table d'unités ni de facteur de conversion (carton de 12, palette, heure) ; les commandes et devis ignorent le mode de vente. **Couplage boulangerie** (« par personne »). | P0 | Distribution, négoce, industrie, services |
| D2-04 | Quantités décimales à la vente | Standard partout | 🟡 | `sale_items.quantity INT` (mig 011:24), `order_items.quantity INT` (mig 008:23), `quote_items.quantity INTEGER` (mig 365:72) ; `sale.controller.ts:106` ; `quote.repository.ts:65` | Le poids passe par des grammes entiers en caisse ; impossible de commander 2,5 kg, 1,5 m ou 0,5 h sur commande ou devis. | P1 | Négoce, industrie, services |
| D2-05 | Variantes et attributs (taille, couleur, matrice) | SAP article configurable / variantes ; Odoo variantes ; D365 Product masters | 🟡 | Formats de recette liés à un produit (mig 263) ; tailles « par personne » (`sales.person_sizes`, mig 377) | Pas de modèle article → variantes ni d'attributs de vente ; chaque déclinaison est un article distinct ou un format de fiche technique. | P1 | Retail, textile, ameublement |
| D2-06 | Kits, lots de vente, nomenclature de vente | SAP nomenclature de vente (BOM SD) ; NetSuite Kit/Package ; Odoo Kit | ❌ | Recherché `bundle|kit|coffret|assortiment` : seules des fiches techniques de production (mig 283, 285, 290) | Un coffret est une recette de production, pas un kit commercial éclaté à la vente (prix de l'ensemble, stock des composants). | P1 | Distribution, retail, traiteur |
| D2-07 | Articles de substitution, vente croisée, montée en gamme | SAP détermination d'articles / cross-selling ; D365 Related products ; Odoo produits optionnels | ❌ | Recherché `substitut|cross-sell|up-sell|vente croisée` : seule la substitution d'ingrédient en production (mig 084) | Rien côté vente. | P2 | Distribution, retail, e-commerce |
| D2-08 | Codes-barres / GTIN (plusieurs par article, par conditionnement) | SAP EAN par unité ; D365 Bar codes ; Odoo codes-barres + nomenclature GS1 | 🟡 | `products.sku VARCHAR(20)` unique (mig 063) ; scan caméra en caisse : `BarcodeScannerModal.tsx:51`, `POSPage.tsx:1375` | La référence n'est ni dans le formulaire produit ni dans le validateur (`product.validator.ts`, `product.repository.ts:210-229`) : elle ne s'écrit que par l'import générique. Un seul code, pas de GTIN par conditionnement, pas de code à poids ou prix variable, pas de lecteur clavier dédié. | P1 | Retail, distribution |
| D2-09 | Suivi par lot à la vente | SAP gestion par lots ; D365 Batch | ✅ | mig 337 (`sale_item_lots`) ; mig 440 (lots sur BL) ; `recall.repository.ts` ; `ProSalesTab.tsx` | — | — | Agroalimentaire, pharmacie, chimie |
| D2-10 | Numéro de série à la vente | SAP numéros de série ; NetSuite Serialized items | ❌ | Recherché `serial|numero_serie` : uniquement équipements de maintenance et imprimantes | Aucun suivi unitaire des articles vendus. | P1 | Électronique, équipement, automobile |
| D2-11 | Images et descriptions multilingues | Tous (textes de vente par langue) | 🟡 | Une image : `products.image_url`, `products.routes.ts:19-29` (disque local) ; description unique | Une seule image, stockée sur le disque du serveur ; aucune traduction du nom ou de la description (les champs `_ar` n'existent que sur les étapes de recette). | P2 | Export, e-commerce, retail |
| D2-12 | Statuts de cycle de vie de l'article (nouveau, actif, fin de vie, bloqué à la vente) | SAP statut article inter-division / par canal ; D365 Product lifecycle state | 🟡 | `products.is_available` ; `sale_type` jour / dlv / commande (mig 245) ; circuit de lancement : mig 060 | Un simple booléen, sans date ni motif ; `sale_type` est propre à la boulangerie ; le serveur ne vérifie pas `is_available` à la vente (voir anomalie A-10). | P1 | Tous |
| D2-13 | Quantité minimale et multiples de commande à la vente | SAP quantité minimale de commande / de livraison ; Odoo colisage | ❌ | Recherché `min_order_qty|order_multiple` : côté achats seulement (`to-order.repository.ts`) | `min_production_quantity` existe (mig 050) mais concerne la production. | P2 | Distribution, industrie |
| D2-14 | Poids, volume, dimensions de l'article vendu | SAP poids brut/net, volume ; D365 dimensions physiques | ❌ | Aucune colonne sur `products` ; `ingredients.poids_piece_kg` côté achats | Pas de base pour le calcul du port, du colisage ou des documents de transport. | P1 | Distribution, négoce, industrie |
| D2-15 | Garantie | SAP garantie ; NetSuite Warranty | ❌ | Recherché `warranty|garantie` : maintenance interne seulement (mig 359) | — | P3 | Équipement, électronique |
| D2-16 | Champs personnalisés sur l'article | Odoo Studio ; NetSuite custom fields | ✅ | mig 369 (`products.custom_fields`) ; `ProductsPage.tsx:1344` | — | — | Tous |
| D2-17 | Catégories et hiérarchie d'articles de vente | SAP hiérarchie de produits ; D365 Category hierarchy | 🟡 | `categories` à plat (mig 002) + `family` (mig 375) ; promotions par catégorie (`promotions.category_ids`) | Deux niveaux fixes ; pas de hiérarchie libre servant aux prix, remises et statistiques. | P2 | Distribution, retail |
| **B. Listes de prix** | | | | | | | |
| D2-18 | Base de prix explicite HT ou TTC | SAP conditions nettes/brutes ; Odoo « taxe incluse dans le prix » | 🟡 | Caisse : `sale.controller.ts:143` (`taxAmount = 0`, prix encaissé tel quel) ; pro : `order.controller.ts:113-117` (TVA ajoutée au même `products.price`) | Le même prix catalogue est traité TTC en caisse et HT pour un professionnel ; aucune indication de base fiscale sur l'article ni sur le canal. | P0 | Tous |
| D2-19 | Listes de prix multiples (en-tête, lignes, affectation) | SAP PR00 + listes de prix ; Oracle Price Lists ; D365 Trade agreements ; Odoo Listes de prix | ❌ | Recherché `price_list|pricelist|liste de prix|grille tarifaire` : aucune table | Le prix est une colonne de l'article, plus une surcharge par canal. | P0 | Négoce, distribution, industrie |
| D2-20 | Prix par canal | SAP canal de distribution ; D365 Commerce channels | 🟡 | mig 173 ; `pos-pricing.ts:12` ; écran `ProductsPage.tsx:1409` | Appliqué uniquement en caisse : `priceLines` (commandes, devis) lit `products.price` (`order.controller.ts:137`) alors que commandes et devis portent un canal (mig 443). | P1 | Distribution, retail |
| D2-21 | Prix par client ou groupe de clients (prix d'accord négocié) | SAP conditions client/article (VK11) ; Oracle Price Agreements ; D365 Trade agreements | ❌ | Seul `customers.remise_pct` existe (mig 242) ; aucune table client × article | Pas de prix négocié par article, ni de groupe tarifaire de clients. | P0 | Négoce, distribution, industrie |
| D2-22 | Prix par magasin / établissement | D365 Commerce ; Odoo liste de prix par point de vente | ❌ | `product_store_stock` ne porte que du stock ; pas de prix par `store_id` | Les promotions peuvent viser un magasin (`promotions.store_id`), pas le prix de base. | P1 | Retail, franchise |
| D2-23 | Dates de validité des prix | SAP périodes de validité des conditions | ❌ | `product_channel_pricing` et `product_pricing_tiers` n'ont ni début ni fin (mig 171, 173) | Impossible de préparer un tarif à date d'effet ; seule une promotion est datée. | P1 | Tous |
| D2-24 | Paliers de prix par quantité | SAP barèmes ; Odoo règles par quantité minimale | 🟡 | mig 171 (`product_pricing_tiers`, en grammes) ; `pos-pricing.ts:20` ; écran `ProductsPage.tsx:1648` | Réservé aux articles au poids et à la caisse ; pas de barème à l'unité ni sur commande. **Couplage boulangerie.** | P1 | Négoce, distribution |
| D2-25 | Prix promotionnel daté | SAP prix promotionnel ; Odoo liste de prix datée | ✅ | Promotion `fixed_price` avec `starts_on` / `ends_on` (mig 372) ; `promotions.ts:104` ; `PromotionsPage.tsx:294` | — | — | Retail |
| D2-26 | Ordre de priorité entre prix (technique des conditions, schéma de calcul) | SAP séquences d'accès + schéma de calcul ; Oracle Pricing Strategy | 🟡 | Ordre codé : canal > palier > catalogue (`pos-pricing.ts:4-9`) ; commandes : prix saisi > catalogue remisé (`order.controller.ts:120-138`) | Deux moteurs distincts (caisse, commandes) à l'ordre figé dans le code ; rien n'est paramétrable. | P1 | Tous |
| D2-27 | Règles d'arrondi des prix | SAP arrondi de conditions ; Odoo arrondi de liste de prix | 🟡 | mig 170 (`apply_price_rounding`, `company_settings.prix_arrondi_*`) | Ne s'applique qu'au prix calculé des formats de recette ; pas d'arrondi d'encaissement en espèces. | P2 | Retail |
| **C. Remises et majorations** | | | | | | | |
| D2-28 | Remise par ligne et remises en cascade | SAP conditions de poste en cascade ; Sage X3 remises 1 à 9 | ❌ | Caisse : aucune remise de ligne (`sale.validator.ts:10-21`) ; commandes : seul le prix unitaire se modifie (`order.controller.ts:138`) | Pas de colonne remise % par ligne, pas d'enchaînement de remises. | P1 | Négoce, distribution |
| D2-29 | Remise en pied de pièce | Standard | ✅ | Caisse en DH ou % (`POSPage.tsx:2015-2016`, `sale.controller.ts:157`) ; commandes `orders.discount_pct` (mig 355) ; devis `quotes.discount_pct` | Plafond par rôle absent en caisse (anomalie A-04). | — | Tous |
| D2-30 | Remise par client et remise personnel | SAP remise client (K007) | ✅ | `customers.remise_pct` → `delivery-note.repository.ts:108` ; `CustomersPage.tsx` ; mig 069 | Remise client appliquée aux professionnels seulement. | — | Tous |
| D2-31 | Remise par famille d'articles × client, remises conditionnelles | SAP K020 / K029 ; D365 remises multilignes | 🟡 | Promotions par catégorie, par type de client ou niveau de fidélité, avec minimum (mig 372, `promotions.ts:65-74`) | Pas de remise pour un client ou un groupe nommé sur une famille ; pas de remise sur volume cumulé. | P1 | Négoce, distribution |
| D2-32 | Majorations, frais de port, frais annexes, écotaxes, consignes | SAP conditions de fret et suppléments ; Odoo frais de livraison ; consignes (boissons) | ❌ | Recherché `delivery_fee|shipping|frais de port|consigne|écotaxe` côté ventes : rien | Aucune ligne de frais ni d'emballage consigné sur commande, BL ou facture. | P1 | Distribution, boissons, e-commerce |
| **D. Contrôle des prix** | | | | | | | |
| D2-33 | Dérogation de prix et de remise avec seuils et approbation | SAP blocage et libération ; D365 Price override workflow | 🟡 | Commandes : `order.controller.ts:143-156` (rôle, écart maximal, motif) et `76-97` (plafond de remise) ; `sales.pricing` | Refus sec, sans circuit d'approbation (`shared/src/constants/approvals.ts` ne connaît aucune pièce de vente) ; non appliqué aux devis (`quote.repository.ts:67`, `76`) ni à la remise de caisse. | P1 | Tous |
| D2-34 | Prix plancher et marge minimale | SAP prix minimum (PMIN) ; Odoo marge sur vente | ❌ | Recherché `prix_plancher|floor_price|min_margin` : rien | Une vente sous le coût de revient n'est ni signalée ni bloquée. | P1 | Négoce, distribution |
| D2-35 | Simulation de prix | SAP simulation de prix ; Oracle Pricing simulation | 🟡 | `POST /promotions/evaluate` (`promotions.routes.ts:157`), aperçu en caisse (`POSPage.tsx:995`) | Pas de simulateur « client × article × quantité × date » expliquant le prix obtenu. | P2 | Négoce |
| D2-36 | Historique et piste d'audit des prix | SAP documents de modification des conditions ; NetSuite System Notes | ❌ | `products`, `product_channel_pricing`, `product_pricing_tiers`, `promotions` absents de la liste des tables auditées (mig 328:130-141) ; aucune table d'historique | Seule la ligne de commande garde son prix grille (mig 443) ; un changement de tarif ne laisse aucune trace. | P1 | Tous |
| D2-37 | Mise à jour en masse, import et export du tarif | SAP VK12 en masse ; Odoo import ; NetSuite CSV | 🟡 | Import « Produits (mise à jour) » : `data-import.ts:112-123` ; export : `data-export.ts:71` ; import Loyverse : `product.controller.ts:381-446` | Pas de hausse en % par famille ; l'import ne couvre ni les prix par canal, ni les paliers, ni le prix au kg ou par personne. | P2 | Tous |
| **E. Ristournes** | | | | | | | |
| D2-38 | Ristournes de fin d'année, remises arrière, provisions | SAP Condition Contract Settlement ; D365 Rebate management ; Sage X3 RFA | ❌ | Recherché `ristourne|rebate|rfa|remise arrière` : rien | Ni accord, ni calcul sur chiffre d'affaires cumulé, ni provision, ni avoir de ristourne. | P1 | Distribution, négoce, industrie |
| **F. Promotions, fidélité, moyens commerciaux** | | | | | | | |
| D2-39 | Moteur de promotions | SAP promotions ; D365 Commerce discounts ; Odoo Promotions | ✅ | Voir § 2 | Sur commande et devis, toutes les lignes sont évaluées « à l'unité » (`order.controller.ts:107`). | — | Retail |
| D2-40 | Règles de cumul, exclusions, limites | D365 concurrency modes ; Odoo cumul | 🟡 | Meilleure promotion par ligne puis meilleure promotion panier (`promotions.ts:149-167`) ; `max_uses` global | Pas de limite par client, pas d'exclusion entre promotions, pas de budget, pas d'articles exclus. | P2 | Retail |
| D2-41 | Codes promo et coupons | D365 Coupons ; Odoo codes à usage unique | 🟡 | `promotions.coupon_code` unique (mig 372) ; saisie en caisse (`POSPage.tsx`) | Un seul code partagé par promotion ; pas de coupons uniques générés, ni à usage unique par client. | P2 | Retail, e-commerce |
| D2-42 | Fidélité (points, niveaux) | D365 Loyalty ; Odoo Fidélité | ✅ | Voir § 2 ; `CustomerLoyalty.tsx` | Gain et utilisation en caisse seulement. | — | Retail |
| D2-43 | Cartes cadeaux, bons d'achat, avoirs utilisables en paiement | D365 Gift cards ; Odoo Cartes cadeaux / eWallet | 🟡 | Avoir client imputable sur une facture (mig 450, `payments.credit_note_id`) | Aucune carte cadeau ni bon d'achat (recherche vide) ; un avoir ne sert pas de moyen de paiement en caisse. | P1 | Retail |
| **G. Taxes** | | | | | | | |
| D2-44 | Code TVA porté par l'article | SAP classification fiscale article ; Odoo taxes à la vente ; D365 Item sales tax group | ❌ | Aucune colonne de taxe sur `products` ; taux par défaut = dernier taux utilisé sur un BL : `delivery-note.repository.ts:94-109` | Le taux se choisit à la main, ligne par ligne ; la première vente d'un article part sans taux. | P0 | Tous |
| D2-45 | Référentiel de taux datés appliqué aux ventes | SAP codes TVA ; pack pays | 🟡 | `tax_codes` (mig 309/331) ; listes codées en dur côté ventes : `ProSalesTab.tsx:33`, `QuotesPage.tsx:33`, `OrderFormModal.tsx:55` | Le référentiel n'alimente que les achats ; les écrans de vente proposent 0/7/10/14/20 en dur. | P1 | Tous, multi-pays |
| D2-46 | Détermination de la TVA par client (exonération, régime) | SAP classification fiscale client ; Odoo positions fiscales | 🟡 | `customers.tva_exonere` → taux 0 (`order.controller.ts:160`) | Un booléen : pas d'attestation d'exonération (numéro, validité), pas de régime (export, zone franche, suspension). | P1 | Export, industrie, B2B |
| D2-47 | Détermination par lieu (export, zones, multi-pays) | SAP pays de départ / destination ; Odoo positions fiscales par pays | ❌ | `tax_codes.country_code` existe mais aucune règle de détermination ; pas de pays sur la vente | — | P1 | Export, multi-pays |
| D2-48 | TVA au comptoir (caisse) | D365 Commerce tax ; Odoo PdV taxes incluses | ❌ | `sale.controller.ts:143` (`const taxAmount = 0`) ; écriture : `journal-generator.service.ts:578-590` (TVA seulement si `tax > 0`) | Tout l'encaissement de caisse est comptabilisé en chiffre d'affaires, sans TVA collectée ni ventilation par taux. | P0 | Retail, restauration |
| D2-49 | Prix TTC ↔ HT et arrondis de TVA | Standard | 🟡 | Devis `with_tax` (mig 365) ; facture : saisie HT ou TTC par ligne (`EmittedInvoicesTab.tsx:199-202`) ; arrondi par ligne (`order.controller.ts:116`) | Pas de règle d'arrondi paramétrable (par ligne ou par pièce) ; pas de saisie TTC sur commande. | P1 | Retail, B2C |
| D2-50 | Droit de timbre sur paiement en espèces (Maroc) | Localisation Maroc (Sage, Odoo l10n_ma) | ❌ | Recherché `timbre|stamp_duty|droit_de_timbre` : aucune occurrence | Ni calcul, ni ligne sur la facture ou le reçu, ni compte, ni état déclaratif. | P0 | Tous (Maroc) |
| D2-51 | Retenue à la source subie sur les ventes | Localisation ; SAP Withholding tax côté client | ❌ | mig 210/212 : retenues opérées sur les fournisseurs seulement ; aucun traitement à l'encaissement client | Un client qui retient une part de TVA ou d'honoraires ne peut pas être soldé proprement. | P1 | Services, B2B (Maroc) |
| D2-52 | Taxes parafiscales et spécifiques | Localisation | ❌ | Aucune notion de taxe autre que la TVA sur les pièces de vente | — | P2 | Boissons, tabac, hôtellerie |
| D2-53 | Devises et taux de change à la vente | SAP devise du document ; NetSuite Multi-Currency | 🟡 | `currencies`, `exchange_rates` (mig 363) ; facture client en devise (mig 431, `EmittedInvoicesTab.tsx:634`) | Ni devis, ni commande, ni BL, ni prix catalogue en devise ; pas de devise par défaut du client. | P1 | Export, négoce |
| D2-54 | Détermination des comptes de produits et de TVA par article / famille | SAP détermination des comptes (VKOA) ; Odoo compte de revenus par catégorie | ❌ | Compte 7111 en dur (`journal-generator.service.ts:363`) ; comptes de TVA en dur par taux (`104-117`) | Marchandises, produits finis et services tombent dans le même compte ; taux et comptes propres au Maroc codés dans le service. | P1 | Tous, multi-pays |
| **H. Coût et marge** | | | | | | | |
| D2-55 | Coût de revient et marge visibles à la vente | SAP VPRS + marge ; Odoo Marges sur ventes | 🟡 | Coût figé : mig 452 ; rapports : `reports.controller.ts:240-293` | Aucune marge affichée à la saisie d'une commande ou d'un devis (`OrderFormModal.tsx`, `QuotesPage.tsx` : aucune référence au coût). | P1 | Négoce, distribution |

---

## 4. Écarts détaillés P0 et P1

### 4.1 P0

**D2-01 — Fiche article de vente autonome** (effort M)
- *Constat* : le formulaire refuse un nouvel article sans recette (`ProductsPage.tsx:1007-1010`) et affiche le prix de vente en lecture seule, « calculé depuis la recette » (`:1352`). Le prix est écrit par `syncProductPrice` (`recipe.repository.ts:664-671`).
- *Impact* : un négociant ou un prestataire ne peut ni créer ni tarifer un article depuis l'écran.
- *Piste* : rendre la recette facultative selon le type d'article (D2-02) ; prix saisissable, la recette ne proposant qu'un prix conseillé ; ajouter au validateur et au formulaire la référence, le prix au kg et la base fiscale.

**D2-02 — Types d'article** (effort M)
- *Constat* : `products` n'a aucun type ; le stock vitrine est contrôlé pour tout article sauf « par personne » (`sale.controller.ts:120-121`).
- *Impact* : pas de prestation, de frais, d'article numérique ou d'abonnement vendus comme lignes de catalogue.
- *Piste* : `products.item_type` (stocké, non stocké, service, abonnement, frais) pilotant stock, lots, comptes et fréquence ; rattacher `subscriptions` à un article.

**D2-03 — Unités de vente et conversions** (effort L)
- *Constat* : modes `unit / weight / person` en contrainte CHECK ; unités fixes dans `shared/src/constants/units.ts`.
- *Impact* : pas de vente au carton, à la palette, au mètre, à l'heure ; pas de prix par unité de vente.
- *Piste* : tables `units_of_measure` et `product_units` (unité de base, unités de vente, facteur, code-barres, prix facultatif) ; `unit_id` sur les lignes de commande, devis, BL, facture, ticket ; « par personne » devient une unité comme une autre.

**D2-18 — Base de prix HT ou TTC** (effort M)
- *Constat* : `products.price` est encaissé tel quel en caisse et majoré de TVA pour un professionnel.
- *Impact* : pour un article taxé, le professionnel paie 20 % de plus que le particulier sur le même prix, ou la caisse sous-déclare la TVA.
- *Piste* : indicateur « prix TTC » par liste de prix (ou par canal) ; fonction unique de conversion HT ↔ TTC à partir du code TVA de l'article.

**D2-19 — Listes de prix multiples** et **D2-21 — Prix par client ou groupe** (effort L, à traiter ensemble)
- *Constat* : aucune table de liste de prix ; seul `customers.remise_pct` différencie un client.
- *Impact* : pas de tarif grossiste, revendeur, export, ni de prix négocié par article — cœur du négoce et de la distribution.
- *Piste* : `price_lists` (code, devise, base HT/TTC, validité), `price_list_items` (article, unité, quantité minimale, prix ou remise, dates), affectation par client, groupe de clients, canal et magasin ; `customers.price_list_id` et `customer_groups` ; un seul service de résolution remplaçant `pos-pricing.ts` et `priceLines`, avec ordre de recherche paramétrable (D2-26) ; `product_channel_pricing` et `product_pricing_tiers` migrés en lignes de liste. Écran « Tarifs » dans Ventes › Paramétrage.

**D2-44 — Code TVA par article** (effort M)
- *Constat* : le taux par défaut est « le dernier utilisé sur un BL » (`delivery-note.repository.ts:94-109`).
- *Impact* : erreurs de taux, factures sans TVA à la première vente, aucun contrôle possible.
- *Piste* : `products.tax_code` (et valeur par défaut par catégorie) référencé sur `tax_codes` ; taux résolu à la date de la pièce ; sélecteurs de vente alimentés par `tax_codes` (D2-45).

**D2-48 — TVA au comptoir** (effort M)
- *Constat* : `const taxAmount = 0` en caisse ; l'écriture de vente ne porte de TVA que si `tax > 0`.
- *Impact* : pour une société assujettie, la TVA collectée sur les ventes de caisse n'est ni calculée ni comptabilisée ; la déclaration repose sur un retraitement manuel. Obligation légale.
- *Piste* : avec D2-44 et D2-18, calculer la TVA « en dedans » par ligne de ticket (`sale_items.tva_rate`, `tva_amount`), ventiler l'écriture par taux, afficher le détail sur le ticket et le rapport Z.

**D2-50 — Droit de timbre sur paiement en espèces** (effort S à M)
- *Constat* : aucune occurrence dans le code.
- *Impact* : le droit de timbre de quittance dû sur les règlements en espèces n'est ni facturé, ni comptabilisé, ni déclaré. Obligation légale au Maroc — taux et champ d'application à confirmer avec l'expert-comptable.
- *Piste* : paramètre par pays (taux, moyens de paiement visés), calcul à l'encaissement en espèces d'une facture ou d'un ticket, ligne distincte sur la pièce, compte de dette envers l'État, état mensuel.

### 4.2 P1

| ID | Constat | Impact | Piste de solution | Effort |
|---|---|---|---|---|
| D2-04 | Quantités entières sur tickets, commandes, devis. | Pas de 2,5 kg ni de 0,5 h hors caisse. | Passer `quantity` en `NUMERIC(12,3)` avec précision par unité (D2-03). | M |
| D2-05 | Pas de variantes. | Catalogue dupliqué par taille ou couleur. | `product_templates`, `product_attributes`, `product_variants` ; les formats de recette deviennent des variantes. | L |
| D2-06 | Pas de kit commercial. | Coffrets et offres groupées impossibles sans fabrication. | `product_kit_components` ; éclatement à la vente (stock, coût) et prix de l'ensemble. | M |
| D2-08 | Référence non saisissable, code unique. | Lecture code-barres inutilisable sans import ; pas de multi-conditionnement. | Champ dans la fiche et le validateur ; table `product_barcodes` (article, unité, code) ; codes à poids ou prix variable ; écoute d'un lecteur clavier. | S à M |
| D2-10 | Pas de numéro de série. | Garantie et SAV unitaires impossibles. | `product_serials` et saisie au BL et au ticket, sur le modèle des lots (mig 440). | M |
| D2-12 | Booléen de disponibilité. | Pas de fin de vie ni de blocage motivé ; contrôle absent côté serveur. | `products.sales_status` (brouillon, actif, fin de vie, bloqué) avec dates et motif ; contrôle dans `priceLines` et `checkout`. | S |
| D2-14 | Pas de poids ni de volume. | Port, colisage, documents de transport. | Colonnes par unité de vente (D2-03). | S |
| D2-20 | Prix par canal ignoré hors caisse. | Le tarif « gros » ne s'applique pas à une commande de gros. | Résolu par le service de prix unique (D2-19). | S |
| D2-22 | Pas de prix par magasin. | Enseignes à tarifs locaux. | Affectation de liste de prix au magasin (D2-19). | S |
| D2-23 | Prix sans date d'effet. | Hausse tarifaire à préparer la veille au soir. | Dates sur les lignes de liste (D2-19). | S |
| D2-24 | Paliers au poids seulement. | Pas de dégressif à l'unité ni sur commande. | Quantité minimale sur les lignes de liste (D2-19). | S |
| D2-26 | Deux moteurs, ordre figé. | Comportement différent entre caisse et commande, non paramétrable. | Schéma de calcul : étapes ordonnées (prix de base, remises, majorations, taxes) et ordre de recherche ; trace du calcul par ligne. | L |
| D2-28 | Pas de remise par ligne ni en cascade. | Négociation ligne à ligne impossible. | `discount_pct` (et second taux) sur les lignes de commande, devis, BL, facture, ticket ; plafonds de `sales.pricing` appliqués par ligne. | M |
| D2-31 | Pas de remise client × famille. | Conditions commerciales de la distribution. | Lignes de liste portant une catégorie et un groupe de clients (D2-19). | M |
| D2-32 | Ni frais, ni consignes. | Port refacturé hors système ; consignes non suivies. | Articles de type « frais » (D2-02), règles de port (barème poids, franco), articles consignés avec solde par client. | M |
| D2-33 | Dérogation sans approbation, absente des devis et de la caisse. | Contournement par devis ou par la remise de caisse. | Types `sales_order` et `quote` dans `APPROVAL_DOC_TYPES` (champs : remise %, écart au prix grille, marge) ; même contrôle sur devis ; plafond de remise en caisse. | M |
| D2-34 | Pas de prix plancher. | Ventes à perte non détectées. | Paramètre de marge minimale (global, par catégorie) ; alerte ou blocage à la saisie, sur la base du coût figé (mig 452). | S |
| D2-36 | Aucun historique de prix. | Litiges, audit, analyse des hausses. | Poser le trigger d'audit de la mig 328 sur les tables de prix et de promotions ; onglet « Historique » sur l'article. | S |
| D2-38 | Pas de ristournes. | Accords annuels gérés sur tableur ; provisions absentes. | `rebate_agreements` (client ou groupe, période, base, paliers), calcul périodique, provision mensuelle, avoir de ristourne à l'échéance. | L |
| D2-43 | Pas de carte cadeau ; avoir inutilisable en caisse. | Retail : moyen de paiement attendu. | `gift_cards` et mouvements, dette au passif, moyen de paiement « carte cadeau » et « avoir » en caisse. | M |
| D2-45 | Taux en dur dans les écrans de vente. | Taux échus encore proposés ; pas de multi-pays. | Sélecteurs alimentés par `tax_codes` à la date de la pièce ; `tax_code` sur les lignes de vente. | S |
| D2-46 | Exonération booléenne. | Pas de justificatif ni d'échéance. | Régime fiscal du client et attestations (numéro, validité, pièce jointe). | S |
| D2-47 | Pas de détermination par lieu. | Export et multi-pays. | Positions fiscales : (pays ou régime du client, code TVA article) → code TVA appliqué. | M |
| D2-49 | Arrondis non paramétrés, pas de saisie TTC sur commande. | Écarts de centimes entre pièces. | Paramètre d'arrondi (ligne ou pièce) appliqué par une fonction unique. | S |
| D2-51 | Retenue à la source subie non gérée. | Factures clients jamais soldées, créance d'impôt non suivie. | À l'encaissement : part retenue vers un compte de créance sur l'État, par type de retenue, avec attestation. | M |
| D2-53 | Devise sur facture seulement. | Devis et commandes export hors système. | Devise et taux sur devis, commande, BL ; listes de prix en devise ; devise par défaut du client. | M |
| D2-54 | Comptes en dur. | Ventilation du chiffre d'affaires fausse hors marchandises ; pas de multi-pays. | Comptes de produits par catégorie d'articles et type d'article via `posting_profiles` ; comptes de TVA portés par `tax_codes`. | M |
| D2-55 | Marge invisible à la saisie. | Le vendeur négocie à l'aveugle. | Colonne coût et marge (réservée à la direction) sur commande et devis, à partir du coût courant. | S |

---

## 5. Compteurs

| | Nombre |
|---|---|
| **Capacités auditées** | **55** |
| ✅ Complet | 7 |
| 🟡 Partiel | 26 |
| ❌ Absent | 22 |

| Priorité (48 capacités non complètes) | Nombre | IDs |
|---|---|---|
| **P0** | 9 | D2-01, 02, 03, 18, 19, 21, 44, 48, 50 |
| **P1** | 28 | D2-04, 05, 06, 08, 10, 12, 14, 20, 22, 23, 24, 26, 28, 31, 32, 33, 34, 36, 38, 43, 45, 46, 47, 49, 51, 53, 54, 55 |
| **P2** | 10 | D2-07, 11, 13, 17, 27, 35, 37, 40, 41, 52 |
| **P3** | 1 | D2-15 |

Couplage boulangerie relevé sur : D2-01, D2-03, D2-05, D2-12, D2-24.

---

## 6. Anomalies rencontrées en chemin

Toutes vérifiées par lecture du code, sauf mention contraire.

| # | Anomalie | Preuve | Gravité |
|---|---|---|---|
| A-01 | **La suppression d'un produit efface l'historique de ventes, hors transaction.** `delete` supprime successivement les lignes de retour, de ticket, de commande, de plan de production, etc., chaque requête étant validée seule. Les lots vendus disparaissent en cascade (`sale_item_lots … ON DELETE CASCADE`, mig 337:14). Si une clé étrangère restante bloque ensuite (par exemple `quote_items.product_id`, mig 365:70, sans cascade), l'erreur 409 « désactivez-le plutôt » s'affiche alors que les lignes de vente sont déjà détruites. Réservé à l'administrateur, y compris en masse. | `product.repository.ts:253-277` ; `product.controller.ts:334-345`, `351-373` | Haute |
| A-02 | **Même prix catalogue TTC en caisse et HT pour un professionnel** (voir D2-18). | `sale.controller.ts:143` ; `order.controller.ts:113-117`, `137` | Haute |
| A-03 | **Prix par canal ignoré par les commandes et les devis**, qui portent pourtant un canal depuis la mig 443. | `order.controller.ts:137` ; `quote.repository.ts:67` | Moyenne |
| A-04 | **Remise manuelle de caisse sans plafond par rôle**, alors que le paramètre s'intitule « Remise maximale — vente et caisse ». Le contrôle ne borne la remise que par le sous-total. | `parameters-catalog.ts:127` ; `sale.controller.ts:157` ; plafond appliqué seulement dans `order.controller.ts:89-93` | Moyenne |
| A-05 | **Commandes et devis ignorent le mode de vente.** Un article au poids y est chiffré avec `products.price`, alors que la recette tient à jour `price_per_kg` et laisse `price` intact ; les promotions y traitent toute ligne comme « à l'unité ». | `order.controller.ts:107`, `137` ; `recipe.repository.ts:660-667` | Moyenne |
| A-06 | **Taux de TVA codés en dur côté ventes** (0/7/10/14/20) alors que `tax_codes` clôt les taux 7 % et 14 % au 31/12/2025 ; comptes de TVA collectée codés par taux dans le service comptable. | `ProSalesTab.tsx:33` ; `QuotesPage.tsx:33` ; `OrderFormModal.tsx:55` ; mig 309:78-80 ; `journal-generator.service.ts:104-117` | Moyenne |
| A-07 | **Taux de TVA par défaut = dernier taux utilisé sur un BL** pour l'article ; aucun taux à la première vente. | `delivery-note.repository.ts:94-109` | Moyenne |
| A-08 | **Référence article (`sku`) non modifiable depuis la fiche** : absente du validateur, de la table de correspondance de mise à jour et du formulaire, alors que le lecteur de codes-barres de la caisse s'appuie dessus. L'import générique l'accepte jusqu'à 60 caractères pour une colonne `VARCHAR(20)`. | mig 063 ; `product.validator.ts:40-55` ; `product.repository.ts:210-229` ; `POSPage.tsx:1375` ; `data-import.ts:117` | Moyenne |
| A-09 | **Devis sans contrôle de dérogation ni plafond de remise** : `priceLines` y est appelé sans contexte et la remise n'est bornée qu'entre 0 et 100 %. L'accès est limité à la direction. *Supposé* : la conversion en commande ne rejoue pas ces contrôles (non vérifié). | `quote.repository.ts:67`, `76`, `335` | Faible |
| A-10 | **Disponibilité non vérifiée par le serveur** : aucune lecture de `is_available` dans les chemins caisse, commande et devis ; un article désactivé reste vendable par l'API. | `sale.controller.ts`, `order.controller.ts`, `quote.repository.ts`, `sale.repository.ts` (aucune occurrence) | Faible |
| A-11 | **Type partagé en retard** : `SaleUnit = 'unit' \| 'weight'` sans `person`, alors que la base et le validateur l'acceptent. | `shared/src/types/product.types.ts:10` ; `product.validator.ts:52` ; mig 377 | Faible |
| A-12 | **Code mort** : `productRepository.create` n'est appelé nulle part (le contrôleur fait son propre `INSERT`) et n'écrit ni `price_per_person` ni le cycle de vie. | `product.repository.ts:191-207` ; `product.controller.ts:207-221` | Faible |
| A-13 | **Prix au kg non saisissable** : le formulaire n'envoie jamais `pricePerKg` ; en l'absence de recette, la caisse retombe sur `products.price`. | `ProductsPage.tsx` (aucun champ) ; `pos-pricing.ts:21` | Faible |
| A-14 | **Synchronisation du prix depuis la recette pour un article « par personne »** : traité comme « à l'unité », elle écrit `products.price` et non `price_per_person`, que la caisse lit en priorité. | `recipe.repository.ts:631` ; `pos-pricing.ts:28` | Faible |
| A-15 | **Recherche produit par nom uniquement** côté serveur (pas par référence). | `product.repository.ts:13` | Faible |
| A-16 | **Image produit sur le disque local du serveur.** *Supposé* (contexte de déploiement, non vérifié ici) : perdue à chaque redémarrage sur un hébergement à système de fichiers éphémère. | `products.routes.ts:19-25` ; `product.controller.ts:453-458` | Moyenne |
| A-17 | **Paliers au poids sans contrôle de chevauchement** : chaque palier est validé isolément ; en cas de recouvrement, le palier au seuil le plus élevé l'emporte silencieusement. | `product.controller.ts:63-78` ; `product-pricing-tier.repository.ts:28-38` | Faible |
