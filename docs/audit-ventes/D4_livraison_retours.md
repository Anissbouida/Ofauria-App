# Audit Ventes — D4 « Logistique sortante, livraison et retours »

_Date : 2026-11-09 · Branche : `claude/kalum-sales-cycle-o2c-audit-f724ad` · Méthode : lecture du code seul (aucune exécution, aucun accès base)._
_Référentiel de comparaison : SAP S/4HANA (SD/LE, EWM, TM), Oracle Fusion (Shipping, WMS, Returns), Microsoft Dynamics 365 SCM, NetSuite, Sage X3, Odoo Enterprise (Inventory, Delivery)._

Légende — Statut : ✅ complet (serveur ET écran câblés) · 🟡 partiel · ❌ absent.
Priorité : P0 bloquant pour un ERP multi-secteur crédible ou obligation légale · P1 attendu par tout ERP de milieu de gamme · P2 avancé · P3 niche.

---

## 1. Périmètre et sources lues

**Périmètre.** Tout ce qui se passe entre la commande client prête et la marchandise chez le client, puis son éventuel retour : création du bon de livraison (BL), préparation, sortie de stock et lots, documents, transport, tournées, preuve de livraison, consignes, transferts liés à la vente, retours (caisse et professionnels), qualité/traçabilité à l'expédition, indicateurs logistiques. La facturation, l'encaissement et le crédit ne sont cités que là où ils touchent la livraison.

**Sources lues (intégralement sauf mention).**

| Couche | Fichiers |
|---|---|
| Migrations | `023_returns_exchanges`, `025_multi_store` (extraits), `092_customers_enrichment` (extraits), `105_product_lots` (extrait), `316_tracabilite_aval_rappel`, `331` (extrait `stores.kind`), `337_sale_item_lots`, `352_bons_livraison_clients`, `354` (extraits), `357_reclamations_clients` (extrait), `382_abonnements` (extrait), `384`/`385` (extraits), `387_tournees_livraison`, `389_reservation_stock_commande`, `424_stock_locations`, `426_etat_thermique_lots` (extrait), `440_o2c_expedition_lots_l1`, `441_o2c_flux_livraisons_partielles_l2`, `452_o2c_revenu_cout_cloture_l6` (extraits) |
| Serveur | `services/product-shipment.ts`, `services/order-fulfilment.ts`, `services/delivery-note-pdf.service.ts`, `repositories/delivery-note.repository.ts`, `repositories/delivery-route.repository.ts`, `repositories/return.repository.ts`, `repositories/credit-note.repository.ts`, `repositories/recall.repository.ts` (extraits), `repositories/traceability.repository.ts` (extraits), `controllers/delivery-note.controller.ts`, `controllers/delivery-route.controller.ts`, `controllers/return.controller.ts`, `routes/delivery-note.routes.ts`, `routes/delivery-route.routes.ts`, `routes/return.routes.ts`, `routes/traceability.routes.ts`, `routes/recall.routes.ts`, `routes/quality.routes.ts`, `routes/lot-thermal.routes.ts`, `validators/return.validator.ts`, `services/journal-generator.service.ts` (`fromSaleReturn`), `repositories/report-builder.repository.ts` (registre des sources) |
| Client | `features/sales/ProSalesTab.tsx`, `features/sales/RoutesTab.tsx`, `features/sales/SalesLayout.tsx`, `features/sales/SalesPage.tsx` (onglets), `features/orders/OrdersPage.tsx` (`ProDeliverModal`), `features/pos/POSPage.tsx` (retours), `features/sales/EmittedInvoicesTab.tsx` (avoirs, extraits), `features/traceability/*`, `features/controle/ControlePage.tsx`, `api/delivery-notes.api.ts`, `api/delivery-routes.api.ts`, `api/returns.api.ts` |
| Autre | `mobile/capacitor.config.ts` ; recherches par mots-clés sur `server/src`, `server/migrations`, `shared/src`, `client/src` (liste en § 3, colonne Preuve) |

Les documents `docs/AUDIT_O2C_GAP_ANALYSIS.md`, `docs/AUDIT_POS.md` et `docs/AUDIT_COUPLAGE_SECTORIEL.md` n'ont servi que de contexte ; chaque constat ci-dessous est revérifié dans le code actuel.

---

## 2. Ce qui existe (forces, avec preuves)

1. **Chaîne commande → BL → facture en place pour les professionnels.** BL depuis une commande ou en saisie libre, numérotation `BL-AAAA-NNNN`, facturation groupée par client ou immédiate selon `customers.billing_frequency` (mig 352, 354 ; `delivery-note.repository.ts:142-309`, `:384-443` ; écrans `ProSalesTab.tsx`, `OrdersPage.tsx:909` `ProDeliverModal`).
2. **Le BL vaut sortie de stock avec lots.** Affectation FEFO sur la DLC effective, réserve puis vitrine, lots périmés et surgelés exclus, mouvement `delivery` par lot et par produit, verrou `FOR UPDATE` (`product-shipment.ts:54-100`). Un produit suivi par lots non couvert bloque le BL (`:72-75`) et l'invariant est aussi porté par la base : trigger différé `trg_dn_assert_lots` (mig 440:51-72).
3. **Livraisons partielles et reliquat.** Cumuls `qty_delivered` / `qty_invoiced` / `qty_cancelled` par ligne de commande, statut `partially_delivered`, machine à états en base, solde du reliquat, plusieurs BL par commande (mig 441 ; `order-fulfilment.ts:75-98`).
4. **Annulation réversible.** Annuler un BL non facturé remet les quantités dans leurs lots, dans le stock, re-réserve et rouvre la commande (`delivery-note.repository.ts:312-353`, `product-shipment.ts:103-130`, `order-fulfilment.ts:101-124`).
5. **Réservation de stock à la commande**, consommée au fil des BL (mig 389 ; `order-fulfilment.ts:54-72`) ; indicateur « dont N réservé » (`ProductsPage.tsx:588`).
6. **Contrôle de crédit bloquant à l'expédition**, avec dérogation motivée de la direction (`delivery-note.repository.ts:224-230`, `delivery-note.controller.ts:8-12`) ; **coût figé** par ligne livrée (`fn_freeze_dn_costs`, mig 452:87-101).
7. **BL PDF** avec cadre « Livré par / Reçu par (client) », ICE/IF du client, pied légal (`delivery-note-pdf.service.ts`).
8. **Tournées** : regroupement de BL, ordre de passage, pointage livré par arrêt (mig 387 ; `delivery-route.repository.ts` ; `RoutesTab.tsx`).
9. **Retours et échanges en caisse** : montant recalculé côté serveur, contrôle du magasin d'origine, session de caisse exigée, lots recrédités, lot périmé passé en perte, écriture comptable, points de fidélité repris (`return.controller.ts:67-125`, `return.repository.ts:99-366`).
10. **Avoirs clients liés à la facture ligne à ligne**, dont le motif « retour de marchandise » par quantités (mig 450 ; `credit-note.repository.ts` ; `EmittedInvoicesTab.tsx:1110-1147`).
11. **Rappel de lot amont → aval jusqu'aux clients professionnels livrés** : lot matière → plans → lots produits → tickets et BL, nets des retours ; blocage des lots, notification interne, destination par lot, clôture (mig 316, 337, 440 ; `traceability.repository.ts:216-240`, `:412-449` ; `recall.repository.ts:329-348` ; écran `TraceabilityTab` monté dans `ControlePage.tsx:93`).
12. **Tests de base de données dédiés** : `server/src/__tests__/db/o2c-l1.db.test.ts`, `o2c-l2.db.test.ts`, `p2-f045-return-lot-sync.db.test.ts` (présence constatée, non exécutés).

**Limite structurante à garder en tête.** Le modèle de stock des produits finis est `product_store_stock` (une ligne par magasin, deux compartiments `stock_quantity` = réserve et `vitrine_quantity`) et `product_lots` (colonnes `backroom_qty` / `vitrine_qty`, lots créés uniquement par la production : seul `INSERT INTO product_lots` du code, `product-lot.repository.ts:143`, appelé par `production.repository.ts:1218` et `:1796`). Toute la logistique sortante en hérite : pas d'emplacement, pas d'entrepôt logique, pas de lot pour une marchandise achetée pour la revente. C'est un **couplage boulangerie** qui explique plusieurs P0 ci-dessous.

---

## 3. Tableau des capacités

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D4-01 | BL créé depuis une commande client | SAP VL01N, Odoo « Livraison » depuis SO, D365 « Bon de livraison » | ✅ | `delivery-note.repository.ts:248-309` ; `OrdersPage.tsx:909-945` | Réservé aux clients professionnels (`:257-259`) ; un particulier ne peut pas être livré sur BL | — | Tous |
| D4-02 | BL libre sans commande (livraison directe) | SAP livraison sans référence, Sage X3 livraison directe | ✅ | `delivery-note.repository.ts:142-239` ; `ProSalesTab.tsx:200-348` | Pas de validation de schéma (zod) sur le corps de la requête | — | Négoce, distribution |
| D4-03 | Livraison fractionnée, reliquat, solde du reliquat | SAP livraisons partielles, Odoo reliquat (backorder) | ✅ | mig 441 ; `order-fulfilment.ts:75-98` ; `OrdersPage.tsx:920,939,1027` | — | — | Tous |
| D4-04 | Livraison groupée : plusieurs commandes → un BL | SAP regroupement de livraisons, NetSuite « Fulfill multiple orders » | ❌ | `delivery_notes.order_id` unique (mig 352:26) ; `delivery-note.repository.ts:167-169` refuse un produit hors de la commande | Un client qui a trois commandes prêtes reçoit trois BL | P1 | Distribution, négoce, industrie |
| D4-05 | Tolérances de sur-livraison et de sous-livraison | SAP tolérances par poste, D365 sur/sous-livraison | 🟡 | `customers.over_delivery_tolerance_pct` (mig 441:83), lu en `delivery-note.repository.ts:214` | Serveur seul : aucune API ni écran n'écrit la colonne (recherche `over_delivery` : une seule occurrence, en lecture). Pas de tolérance de sous-livraison (clôture automatique) | P2 | Agro (pesée), industrie |
| D4-06 | Cycle de vie de la livraison : brouillon → préparé → expédié → livré | SAP statut de prélèvement / sortie de marchandises / POD, Odoo Brouillon-Prêt-Fait, Oracle Shipping | ❌ | Statuts `delivered`, `invoiced`, `cancelled` seulement (mig 352:28-29) ; le BL naît `delivered`, `shipped_at = now()` (`delivery-note.repository.ts:179-182`) | Le stock sort à la saisie ; pas de BL préparé d'avance, pas de distinction « parti » / « reçu » ; une date de livraison future est acceptée alors que le stock sort tout de suite | **P0** | Tous |
| D4-07 | Planification : date promise, date d'expédition, portefeuille « à livrer », création en masse | SAP liste des livraisons dues (VL10), Odoo planificateur, X3 plan de livraison | 🟡 | `orders.pickup_date` (mig 008:14) + `order_reschedules` (mig 354:47) ; filtre « Prêtes » / « Livrées en partie » (`OrdersPage.tsx:35,63`) | Une seule date par commande, pas de date par ligne, pas de date d'expédition distincte de la date de livraison, création des BL une à une | P1 | Distribution, industrie, traiteur |
| D4-08 | Adresses de livraison multiples par client (ship-to) | SAP partenaire « réceptionnaire », Odoo adresses de livraison, NetSuite Ship To | ❌ | `customers.address`, `city` uniques (mig 092:5-6) ; BL « LIVRÉ À » = adresse de la fiche (`delivery-note-pdf.service.ts:86-96`). Recherche `shipping_address`, `delivery_address`, `customer_addresses`, « adresse de livraison » : 0 fichier | Une chaîne d'hôtels ou un distributeur à plusieurs dépôts ne peut pas être livré correctement ; l'adresse se tape dans les notes (`ProSalesTab.tsx:319`) | **P0** | Tous sauf vente comptoir |
| D4-09 | Contrôle de disponibilité à l'expédition (ATP) | SAP contrôle de disponibilité, D365 réservation à la sortie | 🟡 | Lots : refus si non couverts (`product-shipment.ts:72-75`) | Produit sans lot : aucune vérification, le stock est borné à zéro en silence (`product-shipment.ts:86-94`) ; un BL libre ignore `reserved_quantity` et peut prendre le stock réservé à une autre commande | P1 | Négoce, distribution |
| D4-10 | Réservation de stock à la commande | SAP besoins et affectation, Odoo réservation | ✅ | mig 389 ; `sourcing.helper.ts:260` ; `order-fulfilment.ts:54-72` ; `ProductsPage.tsx:588` | Réserve la « réserve » du magasin seulement ; pas de réservation par lot | — | Tous |
| D4-11 | Bon de préparation (picking list) | SAP ordre de transfert, Odoo opération « Pick », X3 bon de préparation | ❌ | Recherche `picking`, `pick_list`, « bon de préparation » : seuls les bons de sortie de production (BSI) répondent | Le préparateur n'a aucun document avant le BL valorisé | P1 | Distribution, négoce, industrie |
| D4-12 | Préparation par vagues, par zones, au scan | SAP EWM vagues, Oracle WMS, Odoo lots de transferts + code-barres | ❌ | Recherche `wave`, « vague » : 0 ; code-barres côté caisse uniquement (`pos/BarcodeScannerModal.tsx`) | — | P3 | Logistique, grande distribution |
| D4-13 | Emplacements (allées, casiers) pour les produits finis | SAP emplacements de magasin, Odoo emplacements, D365 emplacements | ❌ | `stock_locations` ne concerne que `ingredient_lots.location_id` (mig 424:46-48) ; produits finis = `backroom_qty` / `vitrine_qty` | **Couplage boulangerie** (réserve / vitrine codées en dur, mig 440:42) | P1 | Distribution, négoce, industrie |
| D4-14 | Multi-entrepôts : choix du site d'expédition | SAP point d'expédition / magasin, Odoo entrepôt sur la commande, NetSuite location | 🟡 | `stores.kind` accepte `warehouse` (mig 331:60) ; magasin du BL = celui de l'utilisateur ou de la commande (`delivery-note.repository.ts:172-176`, `:293`) | Aucun sélecteur de site dans `ProSalesTab` ni `ProDeliverModal` ; un administrateur sans magasin avec plusieurs sites reçoit « Magasin expéditeur requis » (`:199`) ; pas de répartition d'une commande entre sites | **P0** | Distribution, négoce, retail multi-sites |
| D4-15 | Colisage, unités de manutention, liste de colisage | SAP unités de manutention, Odoo colis, Oracle LPN | ❌ | Recherche `colis`, `parcel`, `handling_unit`, `packing_list` : 0 fichier | — | P2 | Distribution, export, e-commerce |
| D4-16 | Pesée à l'expédition, poids du BL, étiquettes colis | SAP poids brut/net, Odoo poids et étiquettes transporteur | ❌ | Aucune colonne de poids sur `delivery_notes` / `delivery_note_items` (mig 352, 440) ; étiquettes Niimbot limitées à la production et au stock matière (`client/src/lib/niimbot`) | — | P2 | Agro (vente au poids), distribution |
| D4-17 | Sortie de stock à la validation du BL | SAP sortie de marchandises, Odoo validation du transfert | ✅ | `product-shipment.ts:76-99` (`product_stock_transactions` type `delivery`) ; aide à l'écran `ProSalesTab.tsx:327` | Liée à D4-06 : indissociable de la création | — | Tous |
| D4-18 | Affectation automatique des lots (FEFO) | SAP détermination des lots, Odoo stratégie FEFO | ✅ | `product-shipment.ts:26-38`, `:61-70` ; lots affichés (`ProSalesTab.tsx:378-382`) | — | — | Agro, pharma, cosmétique |
| D4-19 | Choix manuel du lot, substitution | SAP saisie manuelle du lot, Odoo lot modifiable sur l'opération | ❌ | `DeliveryLineInput` sans lot (`delivery-note.repository.ts:24-28`) | Impossible d'expédier le lot que le client exige ou celui réellement chargé | P1 | Agro, pharma, industrie |
| D4-20 | Exclusion des lots périmés (et non conformes) | SAP lots à stock restreint, Odoo alerte de péremption | ✅ | `product-shipment.ts:65-68` | Exclut aussi les lots surgelés (`etat_thermique`, mig 426) : **couplage boulangerie** ; pas de message détaillant les lots écartés | — | Agro |
| D4-21 | Règle de sortie paramétrable (FIFO, LIFO, FEFO) et durée de vie résiduelle minimale par client | SAP stratégie de recherche de lots + durée résiduelle, Odoo stratégie par catégorie | ❌ | FEFO en dur (`product-shipment.ts:69`) ; recherche `min_shelf`, `remaining_shelf`, « durée de vie résiduelle » : 0 | La grande distribution impose une DLC résiduelle contractuelle | P2 | Agro, distribution |
| D4-22 | Numéros de série | SAP numéros de série, Odoo suivi par n° de série | ❌ | Recherche `serial_number` : uniquement la maintenance (mig 359) | — | P1 | Électronique, équipement, industrie |
| D4-23 | Lots sur les marchandises de négoce (achetées pour revente) | Tous : lot reçu à l'achat, sorti à la vente | ❌ | `product_lots` alimentée par la seule production (`product-lot.repository.ts:143`) ; « Produit sans suivi (revente) : sortie du stock sans lot » (`product-shipment.ts:13-14`) | Un négociant ne trace aucun lot vendu ; le rappel de lot ne couvre que ce que l'entreprise fabrique. **Couplage boulangerie** | **P0** | Négoce, distribution, retail, pharma |
| D4-24 | Annulation / contre-passation de la sortie | SAP annulation de sortie de marchandises (VL09), Odoo retour du transfert | ✅ | `delivery-note.repository.ts:312-353` ; bouton `ProSalesTab.tsx:115-118` | Pas de motif d'annulation ; impossible après facturation sans annuler la facture | — | Tous |
| D4-25 | BL imprimable (PDF) numéroté | Tous | ✅ | `delivery-note-pdf.service.ts` ; route `delivery-note.routes.ts:18` ; série mig 352:59-61 | — | — | Tous |
| D4-26 | BL non valorisé (sans prix) au choix | SAP, Sage X3, Odoo : BL sans prix par défaut | ❌ | Colonnes « P.U. HT », « TVA », « MONTANT HT » et totaux toujours imprimés (`delivery-note-pdf.service.ts:100-101`, `:124-130`) | Le chauffeur et le réceptionnaire voient les prix négociés | P1 | Distribution, négoce, industrie |
| D4-27 | Lots et DLC imprimés sur le BL | Odoo « lots sur le BL », SAP lot sur le poste | ❌ | Lots renvoyés par l'API (`delivery-note.repository.ts:80-88`) et affichés à l'écran, mais absents du PDF (`delivery-note-pdf.service.ts:105-120`) | Le client ne peut pas rapprocher ce qu'il reçoit d'un rappel | P1 | Agro, pharma |
| D4-28 | Documents d'export, incoterms, douane | SAP GTS / commerce extérieur, Odoo incoterms, X3 | ❌ | Recherche `incoterm` : 0 ; « douane », DUM : rien dans les ventes | — | P2 | Export, industrie |
| D4-29 | Gabarit de BL paramétrable et envoi par e-mail (avis d'expédition) | Odoo modèle + e-mail à la validation, NetSuite formulaires | 🟡 | Mentions reprises du gabarit « facture » (`delivery-note-pdf.service.ts:47`) | Pas de gabarit propre au BL (mig 332 : pas de `doc_type` BL) ; couleurs brun/beige en dur (`:13-19`, **couplage boulangerie**) ; aucun envoi e-mail du BL (recherche sur `mailer` + BL : 0) | P2 | Tous |
| D4-30 | Référentiel transporteurs et modes de livraison | SAP TM transporteurs, Odoo méthodes de livraison, NetSuite Ship Via | ❌ | Recherche `carrier` : 0 ; « transporteur » : achats seulement (frais d'approche mig 361, champs personnalisés) | — | P1 | Distribution, négoce, e-commerce |
| D4-31 | Frais de port : calcul, ligne de port, refacturation | SAP conditions de fret, Odoo frais de livraison sur la commande | ❌ | Recherche `delivery_fee`, « frais de port », `shipping_cost` : appels d'offres fournisseurs seulement (`rfq.repository.ts`) | Le port se saisit en ligne libre, sans compte dédié ni règle | P1 | Distribution, e-commerce, traiteur |
| D4-32 | Suivi d'expédition (tracking), intégration transporteurs | Odoo connecteurs, NetSuite, D365 TMS | ❌ | Recherche `tracking_number`, « suivi colis » : 0 | — | P2 | E-commerce, distribution |
| D4-33 | Créneaux horaires et zones de livraison | Odoo créneaux, SAP itinéraires et zones | ❌ | Recherche `delivery_zone`, `delivery_slot` : 0 (« créneau » ne concerne que le contrôle des ventes en boutique) | Heure de livraison en texte libre dans les notes | P2 | Traiteur, distribution, e-commerce |
| D4-34 | Tournées : regroupement de BL, ordre de passage, pointage livré | ERPNext Delivery Trip, SAP transport, Odoo lots de livraison | ✅ | mig 387 ; `delivery-route.repository.ts` ; `RoutesTab.tsx` | Ne regroupe que des BL déjà sortis du stock ; pointage sans effet sur le BL (voir D4-39) | — | Distribution, agro, traiteur |
| D4-35 | Chauffeur et véhicule référencés, capacité | SAP TM ressources, ERPNext chauffeur et véhicule | 🟡 | `delivery_routes.driver_name` texte libre (mig 387:12) | Pas de lien avec la fiche employé, pas de véhicule, pas de capacité ni de poids chargé | P2 | Distribution |
| D4-36 | Feuille de route et bordereau de chargement imprimables | SAP documents de transport, Odoo bon de chargement | ❌ | Aucun service PDF pour la tournée (services PDF : BL, facture, BC, relance, paie, fiche) | Le chauffeur n'a que l'écran | P1 | Distribution, agro |
| D4-37 | Application chauffeur, carte, optimisation d'itinéraire | D365, Odoo (tiers), SAP TM | ❌ | `mobile/capacitor.config.ts` : simple enveloppe du client web (`webDir: '../client/dist'`) ; recherche `gps`, `latitude` : 0 | L'écran Tournées reste utilisable sur téléphone, sans parcours dédié | P2 | Distribution |
| D4-38 | Encaissement à la livraison (contre-remboursement) | Odoo paiement à la livraison, pratique dominante au Maroc | ❌ | `ProDeliverModal` : « Aucun encaissement » (`OrdersPage.tsx:970-972`) ; aucun champ d'encaissement sur l'arrêt de tournée (mig 387:21-29) | Le chauffeur qui encaisse n'a aucune trace ; pas de remise de fonds de tournée | P1 | Distribution, e-commerce, traiteur |
| D4-39 | Preuve de livraison : nom du réceptionnaire et date réelle | SAP POD, Odoo signature | 🟡 | `received_by_name`, `received_at` (mig 354:64-66) posés à la création seulement (`delivery-note.repository.ts:179-184`) ; saisis dans `ProDeliverModal`, pas dans « Nouveau bon de livraison » (`ProSalesTab.tsx:254-258`) | `received_at` = heure de saisie, pas de réception ; aucune route pour enregistrer la réception après coup ; `delivery_route_stops.delivered_at` n'est pas reporté sur le BL | P1 | Tous |
| D4-40 | Signature électronique, photo, BL signé scanné | Odoo signature sur tablette, D365 preuve de livraison | ❌ | Aucune colonne de pièce jointe sur `delivery_notes` (mig 352, 354, 440) ; « photo » n'existe que pour pertes, réclamations, maintenance | Litige sans preuve opposable | P1 | Tous |
| D4-41 | Litiges de livraison : manquants, casse, refus partiel | SAP réserves à la livraison, Oracle Returns | 🟡 | Réclamations (mig 357) avec liens vente, commande, facture, lot, photo ; écran `ComplaintsTab` | Aucun lien réclamation → BL (mig 357:26-63) ; pas de quantité refusée sur la ligne de BL ; la résolution ne crée ni retour ni avoir | P1 | Tous |
| D4-42 | Emballages consignés (caisses, palettes, bouteilles) : soldes par client | SAP emballages consignés, Sage X3 consignes, Odoo (module) | ❌ | Recherche `consign`, `deposit` : « consigne » ne désigne que des instructions de recette | — | P1 | Boissons, distribution, boulangerie industrielle |
| D4-43 | Transferts inter-magasins / inter-entrepôts de produits finis | SAP ordre de transfert de stock, Odoo transfert interne, NetSuite Transfer Order | ❌ | Réapprovisionnement = réserve → vitrine du même magasin (`replenishment.repository.ts:4`) ; recherche `from_store`, `to_store` : consolidation comptable seulement | Un entrepôt central ne peut pas alimenter ses points de vente ; **couplage boulangerie** (labo et boutique = même magasin) | **P0** | Retail multi-sites, distribution |
| D4-44 | Retour en caisse avec remboursement | Tous les POS | ✅ | `return.repository.ts:99-366` ; `return.controller.ts:49-149` ; `POSPage.tsx:2441+` | Remboursement comptabilisé en espèces quel que soit le paiement d'origine (`journal-generator.service.ts:519-527`) | — | Retail |
| D4-45 | Échange en caisse | Tous les POS | ✅ | `return.repository.ts:119-180`, `:305-334` | — | — | Retail |
| D4-46 | Motifs de retour codifiés et politique de retour (délai, approbation, plafond) | SAP motifs de commande, Odoo motifs, NetSuite politiques | 🟡 | Six motifs en dur à l'écran (`POSPage.tsx:2679-2688`), stockés en texte libre (`sale_returns.reason`, mig 023:8) | Pas de référentiel, pas de délai maximal, pas d'approbation : tout vendeur rembourse tout ticket (`return.routes.ts:13`, groupe SALES) | P2 | Retail |
| D4-47 | Autorisation de retour (RMA), suivi, remplacement | SAP commande de retour, Oracle RMA, Odoo retours | ❌ | Recherche `rma`, `return_authorization`, « autorisation de retour » : 0 | — | P1 | Négoce, industrie, électronique |
| D4-48 | Retour professionnel sur BL / facture avec réception physique et remise en stock | SAP livraison de retour, Odoo retour de transfert, D365 ordre de retour | ❌ | L'avoir « retour » est purement financier : aucune écriture de stock ni de lot dans `credit-note.repository.ts` ; `delivery_note_item_lots.returned_qty` (mig 440:44) n'est écrit nulle part (lu en `delivery-note.repository.ts:324`, `recall.repository.ts:331`, `traceability.repository.ts:227`) | Marchandise reprise : stock faux, lot toujours compté « livré » au client dans le rappel | **P0** | Tous les secteurs B2B |
| D4-49 | Contrôle qualité du retour et décision (stock, rebut, réparation) | Oracle Returns disposition, SAP contrôle du retour | 🟡 | Règle automatique en caisse : lot actif → remis en vitrine, lot périmé → perte (`return.repository.ts:248-290`) | Aucune décision humaine ; un produit alimentaire rendu est remis en vente par défaut ; pas de zone de quarantaine des retours | P1 | Agro, pharma, électronique |
| D4-50 | Lien retour → avoir | Tous | ✅ | Avoir « retour » par quantités, lié à la ligne de facture (`credit-note.repository.ts:104-113`) ; `EmittedInvoicesTab.tsx:1110-1147` ; retour caisse → écriture 7111 / 5161 | — | — | Tous |
| D4-51 | Retour au fournisseur | SAP retour fournisseur, Odoo retour de réception | ❌ | Seule trace : valeur `retourne_fournisseur` d'une destination de rappel (mig 316:75) ; recherche `supplier_return`, `purchase_return` : 0 | Ni pièce, ni sortie de stock, ni avoir fournisseur attendu | P1 | Tous |
| D4-52 | Rappel de lot amont → aval, clients livrés compris | SAP gestion des lots, Odoo traçabilité | ✅ | mig 316, 337, 440 ; `traceability.routes.ts:59-104` ; `TraceabilityTab` | Pas de message aux clients (liste de téléphones seulement) ; ne couvre pas le négoce (D4-23) | — | Agro, pharma |
| D4-53 | Blocage qualité d'un lot de produit fini (hors rappel) | SAP stock bloqué / en contrôle qualité, Odoo quarantaine | 🟡 | Statut `recalled` exclu du FEFO (mig 316:31-32 ; `product-shipment.ts:65`) | Pas de statut « en contrôle » ou « bloqué » sans ouvrir un rappel ; les non-conformités (mig 385) ne bloquent aucun lot | P1 | Agro, pharma, industrie |
| D4-54 | Chaîne du froid à la livraison (température départ / arrivée) | SAP, Oracle (modules agro), Odoo (tiers) | ❌ | Relevés de température par équipement seulement (mig 315:63) ; aucune colonne de température sur BL ou tournée | — | P2 | Agro, pharma |
| D4-55 | Indicateurs logistiques : taux de service (OTIF), reliquats, délais | SAP analyses de livraison, Odoo rapports de ponctualité | 🟡 | Reliquat visible commande par commande (`OrdersPage.tsx:35`, cumuls mig 441) | Aucun état des reliquats, aucun OTIF, aucun délai commande → livraison ; le générateur de rapports n'a pas de source « livraisons » (`report-builder.repository.ts:28,60,86`) | P1 | Tous |

---

## 4. Écarts détaillés P0 et P1

Effort : S = quelques jours · M = une à trois semaines · L = plus d'un mois.

### 4.1 Priorité P0

#### D4-06 — Le BL n'a pas de cycle de vie
- **Constat.** Trois statuts (`delivered`, `invoiced`, `cancelled`, mig 352:28-29). `create` insère le BL `delivered`, pose `shipped_at = now()` et sort le stock dans la même transaction (`delivery-note.repository.ts:179-209`). Le plan du lot L1 prévoyait `draft → picked → shipped → delivered` ; seul l'effet de stock a été livré.
- **Impact.** On ne peut ni préparer les BL de demain, ni charger un camion avant de valider, ni distinguer « parti » de « reçu ». La date de livraison saisie peut être future alors que le stock sort tout de suite. Les tournées (D4-34) ne regroupent que des BL déjà soldés en stock, et la preuve de livraison (D4-39) n'a pas d'étape où se poser.
- **Piste.** Étendre `delivery_notes.status` à `draft`, `ready`, `shipped`, `delivered`, `invoiced`, `cancelled`, avec une table de transitions comme `order_status_transitions` (mig 441). Déplacer l'appel `shipProduct` de `create` vers une action `ship`. Réserver les lots au statut `ready` (nouvelle colonne `reserved_qty` sur `delivery_note_item_lots` ou état de la ligne). Actions à l'écran : Préparer, Expédier, Confirmer la réception. Une option « expédier à l'enregistrement » garde le comportement actuel pour la vente au comptoir de gros.
- **Effort.** M.

#### D4-08 — Une seule adresse par client
- **Constat.** `customers.address` et `city` (mig 092) ; le PDF imprime cette adresse sous « LIVRÉ À ». Aucune table d'adresses, aucun champ d'adresse sur `orders` ni `delivery_notes`.
- **Impact.** Client à plusieurs sites, chantier, événement traiteur, livraison chez un tiers : impossible sans retaper l'adresse dans les notes. Les tournées affichent l'adresse de facturation.
- **Piste.** Table `customer_addresses` (type facturation / livraison, libellé, adresse, ville, contact, téléphone, zone, par défaut). Colonnes `ship_to_address_id` plus copie figée de l'adresse sur `orders`, `quotes`, `delivery_notes`. Sélecteur dans `OrderFormModal`, `ProDeliverModal`, `ProSalesTab` ; arrêt de tournée lu sur le BL.
- **Effort.** M.

#### D4-14 — Pas de choix du site d'expédition
- **Constat.** Le magasin du BL est celui de l'utilisateur, sinon celui de la commande, sinon l'unique magasin actif (`delivery-note.repository.ts:172-176`). Aucun écran ne le propose. Le stock de produits finis n'existe que par magasin, en deux compartiments.
- **Impact.** Une société avec un dépôt et des boutiques ne peut pas livrer un client depuis le dépôt si l'utilisateur est rattaché au siège ; un administrateur sans magasin est bloqué dès qu'il y a deux sites.
- **Piste.** Sélecteur « Expédié depuis » (sites de type `warehouse`, `shop`, `mixed`) sur le BL et la commande ; règle de proposition (site par défaut du client ou du canal) ; à terme, remplacer `backroom` / `vitrine` par des emplacements génériques (voir D4-13) dont « vitrine » ne serait qu'un type.
- **Effort.** S pour le sélecteur ; L pour le modèle d'emplacements.

#### D4-23 — Aucun lot pour les marchandises de négoce
- **Constat.** `product_lots` n'est alimentée que par la production. Pour un produit acheté et revendu, `requiresLots` renvoie faux tant qu'il n'a pas de durée de vie (`product-shipment.ts:41-46`) et la sortie se fait sans lot (`:86-87`). La réception d'achat n'alimente pas le stock de produits finis (recherche `product_store_stock` dans `reception-voucher.repository.ts` et `purchase-order.repository.ts` : 0).
- **Impact.** Un négociant, un distributeur alimentaire ou une pharmacie ne trace rien : ni DLC, ni lot fournisseur, ni rappel. C'est aussi une exigence de traçabilité sanitaire (ONSSA, loi 28-07) dès que l'entreprise revend des denrées qu'elle ne fabrique pas.
- **Piste.** Recevoir des articles « produit » sur le bon de commande d'achat (type de ligne à ajouter à ceux de la mig 349) et créer un `product_lots` à la réception (lot fournisseur, DLC, coût d'achat) ; colonne `origin` (`production`, `purchase`, `return`) sur `product_lots` ; drapeau `tracking` (`none`, `lot`, `serial`) sur `products` à la place de l'heuristique `shelf_life_days IS NOT NULL`.
- **Effort.** L (touche achats, stock et ventes).

#### D4-43 — Pas de transfert de produits finis entre sites
- **Constat.** Le réapprovisionnement déplace de la réserve à la vitrine du même magasin. Aucune pièce ne fait sortir un produit fini d'un site pour l'entrer dans un autre.
- **Impact.** Un atelier central ou un dépôt ne peut pas alimenter plusieurs points de vente ; les lots restent attachés au site de production, donc le FEFO et le rappel sont faux dès qu'il y a un transport interne.
- **Piste.** Tables `stock_transfers` / `stock_transfer_items` / `stock_transfer_item_lots` (site d'origine, site de destination, statuts brouillon → expédié → reçu, écart à la réception) ; à la réception, création d'un lot fils dans le site de destination avec le même numéro, la même DLC et le même coût ; écran Stock › Transferts ; la tournée accepte des transferts comme arrêts.
- **Effort.** L.

#### D4-48 — Le retour d'un professionnel ne touche pas le stock
- **Constat.** Le seul retour B2B est l'avoir de motif `return` (`credit-note.repository.ts:104-113`) : il crée la pièce comptable, rien d'autre. La colonne `delivery_note_item_lots.returned_qty` existe (mig 440:44) et est soustraite dans le rappel et l'annulation, mais aucun code ne l'incrémente.
- **Impact.** Stock physique et stock théorique divergent à chaque reprise. Le rappel compte toujours la quantité rendue chez le client. Aucune trace de ce qu'est devenue la marchandise (remise en stock, rebut).
- **Piste.** Pièce « bon de retour client » (`customer_returns`, `customer_return_items`, lots) liée au BL et à la ligne de BL : quantités, motif, état, décision par ligne (remise en stock sur le lot d'origine, rebut vers les pertes, réparation). Sa validation incrémente `returned_qty`, remet ou non en stock via `reverseAllocations`, puis propose l'avoir `return` pré-rempli. Écran dans Ventes › Retours, à côté des retours de caisse.
- **Effort.** M.

### 4.2 Priorité P1

| ID | Constat | Impact | Piste de solution | Effort |
|---|---|---|---|---|
| D4-04 | Un BL porte une seule commande (`delivery_notes.order_id`) | Autant de BL, de signatures et d'arrêts que de commandes | Lien au niveau ligne déjà présent (`order_item_id`) : lever le contrôle de `:158-169` pour accepter les lignes de plusieurs commandes du même client et du même site, `order_id` devenant facultatif ; `recordDelivered` par commande | S |
| D4-07 | Une date par commande, aucune vue des livraisons à faire | Pas de plan de charge d'expédition, promesses non suivies | `order_items.promised_date`, `delivery_notes.planned_ship_date` ; écran « À livrer » (lignes restantes par date et par client) avec création groupée de BL au statut `draft` (dépend de D4-06) | M |
| D4-09 | Produit sans lot : sortie sans vérification, stock borné à zéro ; BL libre aveugle aux réservations | Stock théorique faux sans alerte ; une commande réservée peut être dépouillée | Dans `shipProduct`, refuser (ou alerter selon un paramètre) si `stock_quantity − reserved_quantity` < quantité, hors réservation de la commande servie | S |
| D4-11 | Aucun bon de préparation | Préparation sur un BL valorisé, erreurs de prélèvement | PDF « bon de préparation » au statut `ready` : lignes triées par emplacement, lots proposés, cases à cocher, sans prix | S (après D4-06) |
| D4-13 | Emplacements réservés aux matières premières | Pas d'adressage en entrepôt, inventaire par zone impossible sur les produits finis | Étendre `stock_locations` aux lots de produits finis (`product_lot_locations` : lot, emplacement, quantité) ; `vitrine` et `backroom` deviennent des emplacements typés | L |
| D4-19 | Lots imposés par le FEFO | Écart entre le lot tracé et le lot chargé | Paramètre `lots?: {lotId, qty}[]` par ligne ; l'écran propose le FEFO et laisse corriger ; contrôles de DLC conservés | S |
| D4-22 | Pas de numéro de série | Garantie, SAV et retours impossibles à rattacher à un exemplaire | `product_serials` (statut en stock / vendu / retourné), saisie ou scan à l'expédition, lien ligne de BL et ticket | M |
| D4-26 | BL toujours valorisé | Prix négociés exposés | Paramètre société ou client « BL valorisé » + bouton d'impression « sans prix » ; variante du PDF sans les trois colonnes ni les totaux | S |
| D4-27 | Lots et DLC absents du PDF | Le client ne sait pas quels lots il détient | Sous-ligne « Lot … · DLC … » dans `delivery-note-pdf.service.ts`, données déjà chargées par `findById` | S |
| D4-30 | Aucun transporteur | Pas de suivi de qui transporte quoi, ni des coûts | Référentiel `carriers` (ou fournisseurs marqués transporteur) + `delivery_methods` (retrait, tournée interne, transporteur) ; champs sur commande et BL | S |
| D4-31 | Aucun frais de port | Port oublié ou saisi en ligne libre sans compte dédié | Article de service « port » rattaché au mode de livraison, règles (forfait, par zone, franco au-delà d'un montant), ligne ajoutée à la commande et reprise sur la facture ; compte de produits accessoires dédié | M |
| D4-36 | Tournée sans document | Chauffeur sans liste ni récapitulatif de chargement | PDF tournée : arrêts ordonnés (client, adresse, téléphone, BL) + récapitulatif des produits à charger | S |
| D4-38 | Pas d'encaissement à la livraison | Espèces collectées hors système | Sur l'arrêt : montant encaissé et mode ; clôture de tournée = remise de fonds rapprochée, créant les règlements clients (chemin L5 existant) | M |
| D4-39 | Réception figée à la création | Preuve sans valeur, heure fausse | Route `POST /delivery-notes/:id/receive` (nom, date et heure, réserves) ; `markStop` la déclenche ; champ dans « Nouveau bon de livraison » | S |
| D4-40 | Ni signature, ni photo, ni scan | Litiges perdus faute de preuve | Pièces jointes sur le BL (stockage objet, pas le disque éphémère de Cloud Run) : signature tracée à l'écran, photo, scan du BL signé | M |
| D4-41 | Réclamation sans lien au BL, sans effet | Manquants et casse traités hors système | `complaints.delivery_note_id` ; réserves saisies à la réception par ligne (quantité refusée, motif) ; depuis la réclamation, créer le bon de retour (D4-48) ou l'avoir | M |
| D4-42 | Pas de consigne | Caisses, palettes et bouteilles perdues, pas de facturation des manquants | Articles de type « emballage consigné » ; lignes sorties / rendues sur BL et bon de retour ; solde par client (`customer_deposit_balances`) ; relevé et facturation des non-rendus | M |
| D4-47 | Pas de RMA | Retours acceptés sans accord ni suivi | Statut « demandé → autorisé → reçu → clos » sur le bon de retour de D4-48, numéro RMA, durée de validité, remplacement = BL à prix nul lié | S (après D4-48) |
| D4-49 | Décision de retour automatique | Produit rendu remis en vente sans contrôle | Paramètre par catégorie « retour remis en stock : oui / non / après contrôle » ; emplacement de quarantaine des retours ; décision tracée | M |
| D4-51 | Pas de retour fournisseur | Marchandise non conforme renvoyée sans pièce ni avoir attendu | Pièce « retour fournisseur » liée à la réception : sortie du lot matière, avoir fournisseur attendu, PDF d'accompagnement | M |
| D4-53 | Blocage qualité seulement par rappel | Un lot douteux reste expédiable tant qu'aucun rappel n'est ouvert | Statut `on_hold` sur `product_lots` (motif, auteur, date), exclu de `shipProduct` et de la caisse ; lien avec les non-conformités (mig 385) | S |
| D4-55 | Aucun indicateur logistique | Taux de service inconnu, reliquats suivis à la main | Source « livraisons » dans le générateur de rapports (lignes de BL jointes aux lignes de commande) ; état des reliquats ; OTIF = livré complet à la date promise (dépend de D4-07) | M |

---

## 5. Compteurs

| | Nombre |
|---|---|
| **Capacités évaluées** | **55** |
| ✅ Complet | 14 |
| 🟡 Partiel | 12 |
| ❌ Absent | 29 |

Priorité des 41 écarts (🟡 et ❌) :

| Priorité | Nombre | Identifiants |
|---|---|---|
| **P0** | 6 | D4-06, D4-08, D4-14, D4-23, D4-43, D4-48 |
| **P1** | 22 | D4-04, 07, 09, 11, 13, 19, 22, 26, 27, 30, 31, 36, 38, 39, 40, 41, 42, 47, 49, 51, 53, 55 |
| **P2** | 12 | D4-05, 15, 16, 21, 28, 29, 32, 33, 35, 37, 46, 54 |
| **P3** | 1 | D4-12 |

Couplage boulangerie relevé sur : D4-13, D4-14, D4-20, D4-23, D4-29, D4-43 (réserve / vitrine en dur, lots issus de la seule production, lots surgelés, charte graphique du BL).

---

## 6. Anomalies rencontrées en chemin

Toutes constatées à la lecture du code ; aucune n'a été reproduite à l'exécution.

| # | Anomalie | Preuve | Gravité |
|---|---|---|---|
| A1 | **Routes `/returns` sans `asyncHandler`.** Express 4.21 sans `express-async-errors` : une erreur levée par `returnRepository.create` (stock d'échange insuffisant, magasin manquant, erreur SQL) n'atteint pas le gestionnaire d'erreurs ; la requête reste sans réponse et l'erreur finit dans `unhandledRejection`. Le caissier ne voit aucun message. | `return.routes.ts:11-13` ; `server/package.json:42` ; `server/src/index.ts:9` | Haute |
| A2 | **`delivery_note_item_lots.returned_qty` jamais écrit.** Colonne créée et soustraite dans trois requêtes, sans aucun `UPDATE`. Les « nets des retours » annoncés pour les BL dans le rappel sont toujours bruts. | mig 440:44 ; lectures `delivery-note.repository.ts:324`, `recall.repository.ts:331`, `traceability.repository.ts:227` | Haute (lié à D4-48) |
| A3 | **Sortie de stock sans contrôle pour un produit sans lot.** `GREATEST(stock − x, 0)` : livrer 100 avec 10 en stock passe, le stock tombe à 0, le mouvement enregistre −100 avec `stock_after = 0`. La somme des mouvements ne redonne plus le stock. | `product-shipment.ts:86-98` | Haute |
| A4 | **Tolérance de sur-livraison non paramétrable.** `over_delivery_tolerance_pct` n'a ni route ni écran ; elle vaut 0 partout sauf mise à jour directe en base. | Seule occurrence hors migration : `delivery-note.repository.ts:214` | Moyenne |
| A5 | **`RecallPage.tsx` orpheline.** L'écran (et son client `recall.api.ts`, sa route `GET /traceability/recall/ingredient-lot/:id`) n'est importé nulle part : `/traceability/recall` redirige vers l'onglet Traçabilité. Deux implémentations du rappel coexistent (`recall.repository.ts` 461 lignes, `traceability.repository.ts`). | `App.tsx:127` ; recherche `RecallPage`, `recallApi` : aucune importation hors de leurs fichiers | Moyenne (code mort) |
| A6 | **Écriture dans une lecture.** `GET /delivery-notes/to-invoice` exécute `releaseCancelledInvoices` (deux `UPDATE`) hors transaction. | `delivery-note.repository.ts:49-60`, `:357` | Moyenne |
| A7 | **Droits incohérents entre BL et tournées.** Les BL sont réservés à la direction, les tournées ouvertes au groupe SALES (caissier, vendeuse), qui lit ainsi la liste des BL et des clients et peut retirer, réordonner ou pointer les arrêts de n'importe quelle tournée : `getById`, `removeStop`, `markStop`, `reorder` ne filtrent pas par magasin. | `delivery-note.routes.ts:10` ; `delivery-route.routes.ts:10` ; `delivery-route.repository.ts:26-39`, `:77-99` | Moyenne |
| A8 | **Tournée : aucune règle de statut.** Passage libre entre `planned`, `in_progress`, `done` ; une tournée terminée peut contenir des arrêts non livrés ; un BL annulé reste un arrêt ; un BL ne peut appartenir qu'à une tournée pour toujours (livraison échouée non replanifiable sans retirer l'arrêt). | `delivery-route.repository.ts:48-51`, `:101-104` | Basse |
| A9 | **`received_at` = heure de création du BL**, posée dès qu'un nom de réceptionnaire est saisi, avant que la marchandise ait quitté le site. | `delivery-note.repository.ts:179-182` | Basse (lié à D4-39) |
| A10 | **Quantités de retour : validation décimale, colonne entière.** Le validateur accepte des décimaux, `sale_return_items.quantity` est `INT` et `getReturnedQuantities` lit en `parseInt` ; une quantité fractionnaire serait arrondie en silence. Sans effet tant que les ventes au poids sont stockées en grammes entiers. | `return.validator.ts:12-15` ; mig 023:21 ; `return.repository.ts:95` | Basse |
| A11 | **Remboursement toujours comptabilisé en caisse espèces (5161)**, même pour un ticket payé par carte. | `journal-generator.service.ts:519-527` | Basse |
| A12 | **Numéros de migration en double** : deux fichiers `426_`, deux `427_`, deux `428_`. L'ordre d'application dépend du tri alphabétique. | `server/migrations/426_etat_thermique_lots.sql` et `426_import_releves_bancaires.sql`, etc. | Basse |
| A13 | **Pas de validation de schéma sur les routes BL et tournées** (corps lus par conversion manuelle), contrairement aux retours. | `delivery-note.controller.ts:46-58` ; `delivery-route.controller.ts` ; absence de `delivery-note.validator.ts` | Basse |
| A14 | **Annulation d'un BL sans motif** : ni colonne ni saisie, alors que les commandes en ont un (`orders.cancel_reason`, mig 354). | `delivery-note.repository.ts:316-318` ; mig 352:34-35 | Basse |

---

### Ce qui est vérifié et ce qui est supposé

- **Vérifié dans le code** : tous les statuts, preuves et anomalies ci-dessus (fichiers et lignes cités), ainsi que les absences, établies par recherche de mots-clés sur `server/src`, `server/migrations`, `shared/src` et `client/src`.
- **Supposé, non vérifié** : le comportement réel à l'exécution des anomalies A1 et A3 (déduit de la lecture) ; l'état des données en base (valeurs de `over_delivery_tolerance_pct`, nombre de BL) ; l'application effective des migrations en production ; l'exigence réglementaire ONSSA citée en D4-23 (rappelée de mémoire, à confirmer par un juriste ou l'expert qualité).
