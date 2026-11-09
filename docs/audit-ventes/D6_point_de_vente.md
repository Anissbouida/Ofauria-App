# D6 — Point de vente (caisse) et vente au détail

Audit du domaine Ventes de Kalum, sous-domaine D6. Date : 2026-11-09. Branche : `claude/kalum-sales-cycle-o2c-audit-f724ad`.
Audit en lecture seule : aucun serveur lancé, aucune base interrogée, aucun test exécuté. Tout constat est tiré de la lecture du code ; ce qui est une hypothèse est signalé comme tel.

Référentiel de comparaison : Microsoft Dynamics 365 Commerce, SAP Customer Checkout, Oracle Retail Xstore / Simphony, NetSuite SuitePOS, Odoo Point of Sale, Lightspeed, Loyverse, Square.

---

## 1. Périmètre et sources lues

**Périmètre** : encaissement au comptoir, prix et remises en caisse, moyens de paiement, taxes et conformité du ticket, retours et échanges, gestion de caisse (ouverture, fermeture, rapports), multi-magasin et multi-terminal, hors-ligne, matériel, sécurité de la caisse, restauration, fin de journée, pilotage.

**Hors périmètre** (autres sous-domaines) : cycle commande → BL → facture des professionnels, créances et relances, CRM, catalogue produits. Ils ne sont cités que là où la caisse les touche.

**Code lu en entier**
- `client/src/features/pos/POSPage.tsx` (5 400 lignes ; lignes 1 à 3318 et 3731 à 4893 lues, 3318-3730 = suite du tableau d'inventaire de fermeture, survolée), `BarcodeScannerModal.tsx`, `terminal-settings.ts`, `UnpaidCustomerPicker.tsx` (extraits), `ReceiptModal.tsx` (extraits), `POSSettingsModal.tsx` (plan).
- `server/src/routes/` : `sales.routes.ts`, `cash-register.routes.ts`, `return.routes.ts`, `pos-parked.routes.ts`, `printer.routes.ts`, `store.routes.ts`, `unsold-decision.routes.ts`, `reports.routes.ts` (liste), `promotions.routes.ts` (extrait).
- `server/src/controllers/` : `sale.controller.ts`, `cash-register.controller.ts`, `return.controller.ts`, `printer.controller.ts`, `order.controller.ts` (remise, remise de commande), `accounting.controller.ts` (rattachement des paiements espèces à la session).
- `server/src/repositories/` : `sale.repository.ts`, `cash-register.repository.ts`, `return.repository.ts`, `product-stock.helper.ts`, `unsold-decision.repository.ts` (extraits), `employee.repository.ts` (extrait), `report-builder.repository.ts` (source « ventes »).
- `server/src/services/` : `pos-pricing.ts`, `promotions.ts` (début), `printer.service.ts`, `journal-generator.service.ts` (ventes, retours, encaissement), `module-parameters.service.ts`, `parameters-catalog.ts` (extrait).
- `server/src/validators/` : `sale.validator.ts`, `return.validator.ts`.
- `shared/src/constants/roles.ts`, `server/src/middleware/role.middleware.ts`, `asyncHandler.ts`.
- Migrations : 011, 016, 023, 025, 026, 078, 116 (via 251), 117, 125, 170, 172, 173, 214, 237, 250, 251, 253, 331, 356, 372, 373, 374, 375, 376, 377, 415, 439, 443, 451, 452, 467 (en-têtes et DDL).
- `client/src/features/sales/SalesPage.tsx` (onglets, périodes de travail), `client/src/features/boutique/` (JourneeBoutiquePage, VentesIndicators), `mobile/package.json`, `client/index.html`, `server/package.json`.

**Recherches par mot-clé** (dans `server/src`, `server/migrations`, `client/src`, `shared/src`, `mobile`) pour établir les absences : code-barres/EAN/GTIN, cartes cadeaux/bons d'achat, pourboire, service worker/IndexedDB/PWA, afficheur client, cuisine/tables/plan de salle, Glovo, apports/retraits, rapport X, terminal/registre, TPE/CMI/NFC, coffre/remise en banque, prix libre, note de ligne, ticket par e-mail, étiquettes, variantes/modificateurs, balance/WebSerial, annulation de ticket, verrouillage/inactivité, ventes par heure.

**Documents antérieurs** (`docs/AUDIT_POS.md`, `AUDIT_O2C_GAP_ANALYSIS.md`, `AUDIT_COUPLAGE_SECTORIEL.md`) : utilisés comme contexte seulement, aucun statut n'en est repris sans vérification dans le code.

---

## 2. Ce qui existe (forces, avec preuves)

1. **Écran de caisse complet et rapide.** Grille par familles/catégories, « Top ventes » 30 jours, « Récents », recherche avec ajout par Entrée, raccourcis F2/F4/F8/F9, flèches, +/−, Suppr, brouillon de panier conservé au rechargement, sons, écran toujours allumé (`POSPage.tsx:199-221`, `:327-343`, `:1389-1435`, `:1740-1765`).
2. **Prix et totaux recalculés par le serveur.** Le client n'envoie que `productId` + quantité ; prix du canal, palier au poids, promotions, remise, points et total sont refaits au `checkout` (`sale.validator.ts:10-21`, `sale.controller.ts:94-174`, `pos-pricing.ts:11-37`). Un prix ou un remboursement ne peut pas être forgé depuis le navigateur.
3. **Trois modes de vente** : à la pièce, au poids (grammes, bascule g/kg, paliers de prix au kilo), par personne (`POSPage.tsx:1104-1159`, mig 377, `pos-pricing.ts:16-30`).
4. **Promotions, coupons et fidélité de bon niveau** : remises article/panier, prix spécial, « X achetés = Y offerts », conditions de période, jour, heure, magasin, type de client, niveau ; points avec niveaux, expiration, dette comptable 4491 (mig 372, `services/promotions.ts`, `services/loyalty.ts`, `POSPage.tsx:994-1022`, `:4531-4573`).
5. **Tickets en attente partagés entre les postes d'un magasin** (mig 373, `pos-parked.routes.ts`, `POSPage.tsx:1245-1300`).
6. **Vente à crédit sur compte client** avec contrôle d'encours/plafond, créance 3421 dès la vente, encaissement ultérieur lettré (`sale.controller.ts:69-72`, `:177-180`, `sale.repository.ts:337-351`, `:372-428`, mig 351/366/451).
7. **Commande client depuis la caisse, acompte, retrait avec solde intégral** (`POSPage.tsx:2096-2177`, `:2824-2883`, `order.controller.ts:536-553`, `sale.repository.ts:187-193`, `:242-252`).
8. **Stock vitrine par magasin, verrouillé à la vente** : `SELECT … FOR UPDATE` avant décrément, refus si insuffisant, ou vente sans stock selon un paramètre métier (`product-stock.helper.ts:71-95`, mig 374). Lots FEFO consommés et tracés par ligne de ticket (`sale.repository.ts:299-311`, mig 337), vente refusée si DLV/DDE atteinte (`:264-285`).
9. **Fermeture de caisse sérieuse** : gel des ventes pendant le comptage, comptage à l'aveugle (montant attendu non renvoyé), comptage par coupures, motif d'écart obligatoire au-delà de 5 DH, rapprochement du total TPE, numéro de clôture séquentiel, verrou `locked_at`, écarts espèces et carte comptabilisés (`cash-register.repository.ts:134-295`, `:297-427`, mig 251/253/467, `POSPage.tsx:3731-3906`).
10. **Passation de shift distincte de la fin de journée** (mig 078/251), onglet « Périodes de travail » avec état comptable de chaque session (`cash-register.repository.ts:59-72`, `SalesPage.tsx:999`).
11. **Comptabilité intégrée** : chaque ticket génère son écriture (caisse/banque, 7111, remise 7129, commission carte 6147), avance de commande en 4421, file de rejeu en cas d'échec (`journal-generator.service.ts:531-663`, mig 356, `sale.repository.ts:345-351`). Coût figé par ligne pour les marges (mig 452, `sale.repository.ts:335`).
12. **Impression thermique ESC/POS côté serveur** avec logo, copies, ouverture du tiroir, imprimante par poste, repli sur l'impression navigateur (mig 125/376, `printer.service.ts`, `ReceiptModal.tsx:120-205`).
13. **Numérotation continue paramétrable** des tickets, retours et clôtures, allouée dans la transaction (mig 329, `utils/document-number.ts`, `sale.repository.ts:791-794`).
14. **Retours et échanges avec ticket** : quantités déjà retournées contrôlées, prix repris du ticket (jamais du client), magasin d'origine imposé, lots recrédités ou passés en perte s'ils sont périmés, points de fidélité repris (`return.controller.ts:69-131`, `return.repository.ts:212-299`).
15. **Fin de journée outillée** : invendus avec suggestion de devenir, destruction des périmés, inventaire de vitrine, contrôle d'ouverture, rapprochement approvisionné/vendu/compté (`cash-register.controller.ts:100-141`, `POSPage.tsx:3000-3318`, `features/boutique/`).

---

## 3. Tableau des capacités

Statuts : ✅ complet (serveur et écran câblés) · 🟡 partiel · ❌ absent. Priorité indiquée pour les écarts seulement.
Abréviations de chemins : `POS` = `client/src/features/pos/POSPage.tsx` ; `ctl/` = `server/src/controllers/` ; `repo/` = `server/src/repositories/` ; `svc/` = `server/src/services/` ; `val/` = `server/src/validators/` ; `rt/` = `server/src/routes/`.

| ID | Capacité | Référence solutions | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D6-01 | Recherche rapide d'articles, raccourcis clavier, brouillon de panier | Toutes | ✅ | `POS:1705-1713`, `:1389-1435`, `:199-221` | Recherche sur le nom seulement (`repo/product.repository.ts:13`) | — | Tous |
| D6-02 | Grille familles/catégories, top ventes, récents, favoris | Loyverse, Square, Odoo | 🟡 | `POS:1740-1765`, mig 375 | Pas de favoris ni de disposition de touches paramétrables par poste ; icône par défaut « baguette » (`POS:1509`) | P2 | Tous |
| D6-03 | Lecture de code-barres | Toutes | 🟡 | `BarcodeScannerModal.tsx:48-67` ; `POS:1373-1385` | Aucune colonne code-barres (comparaison au seul `products.sku`, côté client) ; pas de codes multiples par article ; douchette USB inopérante dans la recherche ; scanner caméra désactivé par défaut (`terminal-settings.ts:66`) | **P0** | Retail alimentaire et non alimentaire, négoce |
| D6-04 | Articles au poids (saisie manuelle, paliers de prix) | Xstore, SAP CC, Odoo | ✅ | `POS:1104-1134`, `:4762-4856` ; `svc/pos-pricing.ts:16-24` | — | — | Alimentaire, vrac |
| D6-05 | Balance connectée, étiquettes poids-prix (EAN à prix/poids embarqué), tare | Odoo, Xstore, SAP CC | ❌ | Recherché `navigator.serial`, `scale`, `tare`, `plu` dans `client/src/features/pos` : rien | Poids tapé à la main | P1 | Boucherie, primeurs, épicerie, vrac |
| D6-06 | Prix libre / article divers | Loyverse, Square, Odoo | ❌ | `val/sale.validator.ts:10-21` (prix jamais accepté) | Impossible de vendre un article hors catalogue ou à prix saisi | P1 | Services, négoce, retail non alimentaire |
| D6-07 | Vente par portion / par personne | Simphony | ✅ | mig 377 ; `POS:1138-1159` ; `svc/pos-pricing.ts:25-30` | Couplage boulangerie : pensé pour les entremets, aucun stock mouvementé (`repo/sale.repository.ts:253-259`) | — | Pâtisserie, traiteur |
| D6-08 | Notes de ligne, commentaire de ticket | Toutes | 🟡 | `val/sale.validator.ts:27` | Commentaire de ticket accepté par le serveur mais jamais envoyé par la caisse (serveur seul) ; aucune note par ligne | P1 | Restauration, services |
| D6-09 | Variantes, options, modificateurs, formules/menus | Simphony, Lightspeed, Odoo, Square | ❌ | Panier indexé par `productId` (`POS:1085-1098`) ; recherché `variant`, `modifier`, `combo` | Une seule ligne par produit, pas de tailles/couleurs, pas de suppléments, pas de menus | P1 | Restauration, habillement, retail non alimentaire |
| D6-10 | Client rattaché au ticket, création rapide | Toutes | ✅ | `POS:1821-1873` ; `UnpaidCustomerPicker.tsx:38-41` | Création de fiche possible seulement depuis « À crédit » | — | Tous |
| D6-11 | Tickets en attente, repris sur un autre poste | Toutes | ✅ | mig 373 ; `rt/pos-parked.routes.ts` ; `POS:1245-1300` | Suppression non tracée (voir D6-36) | — | Tous |
| D6-12 | Commande client, acompte et retrait soldé en caisse | D365, NetSuite, Odoo | ✅ | `POS:2096-2177`, `:2824-2883` ; `ctl/order.controller.ts:536-553` | Solde en espèces ou carte seulement ; pas de canal de commande en ligne | — | Tous |
| D6-13 | Devis depuis la caisse | SAP CC, NetSuite | 🟡 | Écran `/quotes` (mig 365), hors caisse | Aucun accès ni conversion depuis la caisse | P2 | Négoce, services |
| D6-14 | Contrôle du stock et de la péremption à la vente | Xstore, D365 | ✅ | `ctl/sale.controller.ts:120-128` ; `repo/product-stock.helper.ts:71-95` ; `repo/sale.repository.ts:264-311` | — | — | Alimentaire |
| D6-15 | Vendeur distinct du caissier (attribution de la vente) | D365, Lightspeed | 🟡 | `val/sale.validator.ts:40-42` ; `ctl/sale.controller.ts:225-229` | Serveur seul : la caisse n'envoie jamais `employeeId` ; repli = dernier employé pointé du magasin, tous postes confondus | P2 | Retail, services |
| D6-16 | Remise sur le ticket (montant ou %) | Toutes | ✅ | `POS:2006-2020` ; `ctl/sale.controller.ts:157-163` | Sans motif ni plafond (D6-18) | — | Tous |
| D6-17 | Remise par ligne | Toutes | ❌ | `val/sale.validator.ts:10-21` | Seules les promotions automatiques agissent par ligne | P1 | Tous |
| D6-18 | Plafonds de remise par rôle, autorisation d'un responsable | D365, Xstore, SAP CC, Lightspeed | ❌ | `ctl/sale.controller.ts:157` borne seulement au sous-total ; plafond appliqué aux commandes seules (`ctl/order.controller.ts:90-94`) | Une caissière peut remiser 100 % ; le paramètre s'intitule pourtant « vente et caisse » (`svc/parameters-catalog.ts:127`) | **P0** | Tous |
| D6-19 | Dérogation de prix en caisse (avec motif) | D365, Xstore | ❌ | Existe sur commandes seulement (mig 443 `order_items.price_override_*`) | — | P1 | Négoce, retail |
| D6-20 | Promotions automatiques et coupons | Toutes | ✅ | mig 372 ; `svc/promotions.ts` ; `POS:994-1002`, `:4531-4548` | — | — | Tous |
| D6-21 | Programme de fidélité (gain, niveaux, utilisation) | D365, Lightspeed, Square, Loyverse | ✅ | `svc/loyalty.ts` ; `POS:4550-4573` ; `repo/sale.repository.ts:320-332` | Pas de carte de fidélité scannable | — | Retail, restauration |
| D6-22 | Cartes cadeaux, bons d'achat, avoirs utilisables en caisse | Toutes | ❌ | Recherché `gift_card`, `carte cadeau`, `bon d'achat`, `store_credit` : rien ; les avoirs AV (mig 450) ne visent que les factures | — | P1 | Retail non alimentaire, restauration |
| D6-23 | Prix par canal, paliers au poids | D365, NetSuite | ✅ | mig 172/173 ; `svc/pos-pricing.ts` | Pas de liste de prix par client ni par magasin (D6-50) | — | Tous |
| D6-24 | Espèces avec rendu de monnaie, carte saisie à la main | Toutes | ✅ | `POS:4624-4681` ; mig 356 (commission) | Montant reçu et rendu non conservés en base (`repo/sale.repository.ts:217`) | — | Tous |
| D6-25 | Intégration du terminal de paiement | Toutes | ❌ | `POS:4678` (« Passez la carte au TPE puis confirmez ») ; recherché `payment_terminal`, `cmi`, `naps`, `payzone` | Montant ressaisi sur le TPE ; rapprochement manuel en fin de session | P1 | Tous |
| D6-26 | Paiement mixte | Toutes | 🟡 | mig 250 ; `POS:4685-4736` | Espèces + carte uniquement, deux parts, pas de paiement partiel | P2 | Tous |
| D6-27 | Chèque, paiement mobile / portefeuille | D365, SAP CC, Square | 🟡 | `val/sale.validator.ts:8`, `:81` | Serveur seul : l'écran ne propose que espèces, carte, mixte (`POS:4598-4602`) ; ni n° de chèque, ni banque, ni échéance ; un chèque irait droit en banque 5141 (`svc/journal-generator.service.ts:544`) | P1 | Négoce, B2B au comptoir |
| D6-28 | Vente à crédit sur compte client, encaissement ultérieur | D365, NetSuite, SAP CC | ✅ | `POS:1344-1368`, `:2180-2237` ; `ctl/sale.controller.ts:69-72`, `:177-180` | Pas de règlement partiel d'un ticket | — | Négoce, B2B |
| D6-29 | Pourboires, arrondi de caisse | Square, Simphony, Odoo | ❌ | Recherché `tip`, `pourboire` : rien ; mig 170 arrondit le prix catalogue, pas le total à payer | — | P2 | Restauration, services |
| D6-30 | Multi-devises en caisse | D365, Xstore | ❌ | « DH » et coupures marocaines en dur (`POS:280-290`, `svc/printer.service.ts:397`) | La mig 431 ne couvre que les factures | P2 | Tourisme, zones frontalières |
| D6-31 | TVA au comptoir par article | Toutes | ❌ | `ctl/sale.controller.ts:143` (`taxAmount = 0`) ; aucun taux sur `products` ; `tax_codes` (mig 331) non relié ; mig 452 : « TVA des ventes comptoir : hors lot » | Tout le ticket part en 7111, sans TVA collectée | **P0** | Tous les assujettis |
| D6-32 | Ticket avec mentions légales | Toutes | 🟡 | mig 026 (en-tête/pied libres) ; `svc/printer.service.ts:348-447` | ICE, IF, RC, patente présents en base (`utils/company-legal.ts:35-38`) mais non imprimés d'office ; pas de ventilation HT/TVA | P1 | Tous |
| D6-33 | Facture depuis un ticket | Toutes | ❌ | Recherché `sale_id` dans les factures et migrations : rien ; vente spéciale retirée (`rt/sales.routes.ts:36-38`) | Un client de comptoir ne peut pas obtenir de facture de son ticket | **P0** | Tous, surtout B2B au comptoir |
| D6-34 | Numérotation continue | Toutes | ✅ | mig 329 ; `repo/sale.repository.ts:791-794` | Série unique tous magasins (pas par caisse) | — | Tous |
| D6-35 | Inaltérabilité, journal des tickets | SAP CC, Xstore, Odoo (certifiés) | 🟡 | Clôture verrouillée (`repo/cash-register.repository.ts:308-314`) ; aucun chemin de modification dans le code | Aucun trigger ni chaînage sur `sales`/`sale_items` (seul trigger : `sales_due_date`, mig 351) ; le chaînage n'existe qu'au grand livre (mig 413) | P1 | Tous |
| D6-36 | Piste d'audit des annulations (ligne retirée, panier vidé, ticket en attente supprimé, tiroir ouvert, réimpression) | D365, Xstore, Lightspeed | ❌ | Panier en mémoire du navigateur ; « Vider » `POS:2057` ; suppression `rt/pos-parked.routes.ts:56-60` sans journal | Aucun moyen de détecter la fraude par annulation | P1 | Tous |
| D6-37 | Retours et échanges avec ticket | Toutes | 🟡 | `ctl/return.controller.ts` ; `repo/return.repository.ts` ; `POS:2441-2757` | Remboursement au prix brut, remises ignorées ; échange au prix catalogue, faux pour le poids ; devenir de l'article non choisi (voir § 6) | P1 | Tous |
| D6-38 | Annulation de ticket et retours soumis à autorisation | Toutes | ❌ | Aucune route d'annulation (`rt/sales.routes.ts`) ; retour ouvert à tout le groupe SALES sans seuil ni délai (`rt/return.routes.ts:13`) | Toute caissière rembourse n'importe quel ticket du magasin, quel que soit son âge | **P0** | Tous |
| D6-39 | Remboursement par moyen d'origine, ou en avoir | Toutes | ❌ | `sale_returns` sans mode de remboursement (mig 023) ; écriture toujours en caisse 5161 (`svc/journal-generator.service.ts:519-527`) | Un ticket carte ou à crédit est remboursé comme des espèces en comptabilité | P1 | Tous |
| D6-40 | Recherche du ticket d'origine, retour sans ticket | Toutes | ❌ | Numéro exact exigé (`ctl/return.controller.ts:27`, `repo/sale.repository.ts:133-141`) | Pas de recherche par date, client, article, ni de code à scanner sur le ticket | P1 | Retail |
| D6-41 | Ouverture avec fond de caisse | Toutes | ✅ | `ctl/cash-register.controller.ts:62-91` ; `POS:1572-1589` | Fond libre, non comparé au dernier comptage | — | Tous |
| D6-42 | Apports, retraits, coffre, remise en banque | Toutes | 🟡 | Paiement espèces saisi en comptabilité rattaché à la session (`ctl/accounting.controller.ts:841-853`) ; versement en banque (`rt/accounting.routes.ts:166`) | Réservé à l'administrateur/gérant et hors caisse ; pas de bouton pour la caissière ; pas de coffre, pas de prélèvement en cours de journée, pas de bordereau | P1 | Tous |
| D6-43 | Fermeture avec comptage à l'aveugle, écarts espèces et carte | D365, Xstore, Lightspeed | ✅ | `repo/cash-register.repository.ts:134-427` ; `POS:3731-3906` ; mig 467 | Seuil d'écart de 5 DH en dur (`:329`) | — | Tous |
| D6-44 | Rapport Z | Toutes | 🟡 | Numéro + verrou (mig 253) ; impression `svc/printer.service.ts:469-566` | Le ticket Z n'imprime ni le numéro de clôture, ni le TPE et son écart, ni les remboursements, apports/retraits, remises, TVA (`ctl/cash-register.controller.ts:234-256`) | P1 | Tous |
| D6-45 | Rapport X (lecture en cours de session) | Toutes | ❌ | Recherché `x_report`, `rapport X` : rien | Le gérant ne peut pas lire la situation d'une caisse ouverte | P1 | Tous |
| D6-46 | Périodes de travail, passation entre caissiers | Toutes | ✅ | mig 078/251 ; `POS:2891-2937` ; `SalesPage.tsx:999` | — | — | Tous |
| D6-47 | Plusieurs caisses par magasin : entité caisse/terminal | D365, Xstore, Odoo, Lightspeed | 🟡 | Session par utilisateur (`uniq_cash_session_open_per_user`, mig 251) | Aucune table de caisses/terminaux (recherché `terminal_id`, `register_id`) ; réglages du poste en `localStorage` (`terminal-settings.ts`) ; deux caissières ne partagent pas un tiroir | P1 | Supérettes, chaînes |
| D6-48 | Cycle d'ouverture/fermeture indépendant du métier | Toutes | ❌ | Fermeture refusée sans décisions d'invendus dès qu'il reste du stock (`ctl/cash-register.controller.ts:107-141`) ; ouverture bloquée par trigger (mig 251 l. 83-130) | Couplage boulangerie : aucun paramètre pour le désactiver | **P0** | Tous sauf boulangerie-pâtisserie |
| D6-49 | Stock en temps réel par magasin, concurrence entre postes | Toutes | ✅ | `repo/product-stock.helper.ts:71-115` | — | — | Tous |
| D6-50 | Paramétrage, prix et assortiment par magasin | D365, Xstore, NetSuite | 🟡 | Promotions et imprimantes par magasin (mig 372, 125) | Ticket et règles de caisse globaux (mig 026, `module_parameters`) ; prix par canal, pas par magasin | P2 | Chaînes |
| D6-51 | Transferts entre magasins depuis la caisse | D365, Lightspeed | ❌ | Seul le réassort réserve → vitrine existe (`POS:1679-1680`) ; recherché `from_store`, `to_store` | À confirmer avec l'audit Stock | P2 | Chaînes |
| D6-52 | Mode hors-ligne et synchronisation | Toutes | ❌ | `POS:2765` (« Hors ligne — les encaissements échoueront ») ; recherché `serviceWorker`, `indexedDB`, `workbox` : rien | Une coupure réseau arrête la vente | **P0** | Tous |
| D6-53 | Application installée, caisse sur tablette | Loyverse, Square, Lightspeed | 🟡 | Coque Android Capacitor (`mobile/package.json`) | Pas de manifeste ni de service worker ; rendu tablette non vérifié à l'écran | P2 | Tous |
| D6-54 | Imprimante thermique et tiroir-caisse | Toutes | 🟡 | mig 125/376 ; `svc/printer.service.ts` ; `POS:788-797` | Voie réseau/USB directe cassée (récursion, § 6 A1) ; seule la voie CUPS fonctionne ; ouverture du tiroir hors vente réservée aux réglages et non tracée | P1 | Tous |
| D6-55 | Afficheur client | Toutes | ❌ | Recherché `customer display`, `afficheur`, `BroadcastChannel` : rien | — | P2 | Retail, restauration |
| D6-56 | Impression d'étiquettes (prix, poids, code-barres, DLC) | Odoo, Xstore, Lightspeed | ❌ | Type `label` déclaré (mig 125) mais jamais utilisé (`svc/printer.service.ts:277`) | — | P1 | Retail alimentaire et non alimentaire |
| D6-57 | Rôles de caisse, cloisonnement par magasin | Toutes | ✅ | `shared/src/constants/roles.ts:27-29` ; `ctl/sale.controller.ts:46-53` ; `ctl/return.controller.ts:72-84` | Incohérence vendeuse (§ 6 A7) | — | Tous |
| D6-58 | Code PIN/badge, changement rapide de caissier, verrouillage | Toutes | 🟡 | Connexion par PIN (`ctl/auth.controller.ts:182`) ; déconnexion après 15 min (`AuthContext.tsx:8`) | Pas de changement de caissier sans quitter la caisse, pas de verrou manuel, pas de badge | P2 | Tous |
| D6-59 | Restauration : tables, plan de salle, additions ouvertes, envoi en cuisine | Simphony, Lightspeed, Odoo, Square | ❌ | Type d'imprimante `kitchen` déclaré seulement (mig 125) ; recherché `table`, `kds`, `plan de salle` | — | P1 (P0 pour la restauration) | Restauration, cafés |
| D6-60 | Sur place / à emporter / livraison, plateformes (Glovo…) | Simphony, Lightspeed, Square | 🟡 | Canaux de vente et prix par canal (mig 172/173, `POS:1842-1848`) | Pas de type de service, pas d'intégration ni de commission de plateforme | P2 | Restauration |
| D6-61 | Fin de journée : invendus, inventaire de vitrine, rapprochement ventes/stock | Xstore (inventaire), spécifique | ✅ | `rt/unsold-decision.routes.ts` ; `POS:3000-3318` ; `features/boutique/` | Couplage boulangerie (vitrine, ré-exposition, recyclage en ingrédient, catalogue Loyverse) | — | Boulangerie, frais |
| D6-62 | Ventes par caissier, article, catégorie, paiement ; export | Toutes | ✅ | `repo/sale.repository.ts:502-672` ; `SalesPage.tsx:37-42`, `:315-395` | — | — | Tous |
| D6-63 | Ventes par heure, par magasin, par canal ; panier moyen ; tableau de bord de caisse | Toutes | 🟡 | `GET /sales/today` (`repo/sale.repository.ts:456-500`) | Serveur seul (`salesApi.todayStats` jamais appelé) ; aucune dimension heure, magasin ou canal (`repo/report-builder.repository.ts:37-43`) | P2 | Tous |
| D6-64 | Ticket électronique (e-mail, SMS, QR) | Square, Lightspeed, Odoo | ❌ | Recherché `sendReceipt`, `e-receipt` : rien (le service `mailer` n'est pas appelé par la caisse) | — | P2 | Tous |
| D6-65 | Réimpression, duplicata | Toutes | 🟡 | Dernier ticket (`POS:1683`, `:2768`) ; tout ticket depuis Ventes (`SalesPage.tsx:1144`) | Pas de mention « duplicata », réimpression non tracée | P2 | Tous |
| D6-66 | Enquête de satisfaction, borne libre-service | Square, Lightspeed, Simphony | ❌ | Recherché `satisfaction`, `kiosk`, `borne` : rien (seule la réclamation client existe, `POS:1682`) | — | P3 | Restauration rapide |

---

## 4. Écarts détaillés P0 et P1

Effort : S = quelques jours, M = une à trois semaines, L = plus d'un mois.

### 4.1 P0

**D6-03 — Code-barres réel**
- Constat : aucune colonne code-barres en base. Le scanner caméra charge jusqu'à 2 000 produits et compare le code à `products.sku` dans le navigateur (`POS:452-457`, `:1373-1385`). La recherche serveur ne porte que sur le nom (`repo/product.repository.ts:13`) : une douchette USB qui « tape » dans le champ de recherche ne trouve rien.
- Impact : un commerce de détail ne peut pas encaisser au scan ; un article à plusieurs conditionnements non plus.
- Piste : table `product_barcodes (product_id, barcode unique, unité, quantité)` ; route `GET /products/by-barcode/:code` ; écoute clavier globale dans la caisse (rafale de touches terminée par Entrée) ; recherche étendue au SKU et au code.
- Effort : M.

**D6-18 — Plafonds de remise et autorisation d'un responsable**
- Constat : `checkout` vérifie seulement que la remise ne dépasse pas le sous-total (`ctl/sale.controller.ts:157-163`). Les plafonds `sales.pricing` ne sont appliqués qu'aux commandes (`ctl/order.controller.ts:90-94`), alors que leur libellé dit « vente et caisse ».
- Impact : remise totale possible par n'importe quel rôle de caisse, sans motif ; fuite de marge et fraude non détectables.
- Piste : appliquer `sales.pricing` dans `checkout` ; motif de remise obligatoire (référentiel) ; table `pos_overrides (sale_id, action, demandé_par, approuvé_par, motif)` et saisie du PIN d'un gérant pour dépasser le plafond.
- Effort : S pour le plafond, M avec l'autorisation par PIN.

**D6-31 — TVA au comptoir**
- Constat : `taxAmount = 0` en dur (`ctl/sale.controller.ts:143`). Les produits n'ont pas de taux ; la table `tax_codes` existe mais n'est reliée ni aux produits ni aux tickets. L'écriture de vente crédite 7111 du montant encaissé (`svc/journal-generator.service.ts:653-658`). La mig 452 note le sujet « en attente de l'avis de l'expert-comptable ».
- Impact : un assujetti ne peut pas déclarer sa TVA collectée à partir de la caisse ; le chiffre d'affaires comptable est toutes taxes comprises. Bloquant hors régime exonéré.
- Piste : `products.tax_code_id` (et taux par défaut de catégorie) ; `sale_items.tva_rate`, `tva_amount`, `subtotal_ht` ; prix affichés TTC, TVA « en dedans » ; ventilation par taux sur le ticket et le rapport Z ; écriture 7111 HT + 4455.
- Effort : M à L (reprise des rapports et de la comptabilité).

**D6-33 — Facture depuis un ticket**
- Constat : aucun lien ticket → facture ; la « vente spéciale » qui en tenait lieu est retirée (`rt/sales.routes.ts:36-38`).
- Impact : un professionnel servi au comptoir n'obtient pas de facture ; il faut ressaisir une commande ou un BL.
- Piste : action « Facturer ce ticket » (caisse et écran Ventes) créant une facture client `invoices.sale_id`, sans nouvelle écriture de produit (reclassement de la contrepartie), fiche client obligatoire ; facture récapitulative de plusieurs tickets en option. Dépend de D6-31.
- Effort : M.

**D6-38 — Annulation de ticket et autorisation des retours**
- Constat : aucune route d'annulation. Le retour est ouvert à tout le groupe SALES (`rt/return.routes.ts:13`), sans seuil de montant, sans délai, sans approbation, sans motif obligatoire (`val/return.validator.ts:37`).
- Impact : contrôle interne absent sur la sortie d'espèces la plus exposée à la fraude.
- Piste : paramètres `sales.returns` (délai maximal, montant sans approbation, rôles) ; approbation par PIN gérant ou par le moteur d'approbations existant ; annulation du ticket du jour = retour total marqué `void`, tracé dans le rapport Z.
- Effort : M.

**D6-48 — Cycle de caisse découplé de la boulangerie**
- Constat : la fermeture « fin de journée » est refusée s'il reste du stock en vitrine sans décision d'invendus (`ctl/cash-register.controller.ts:121-141`) ou des périmés non détruits (`:107-119`) ; l'ouverture suivante exige un contrôle d'ouverture dès qu'un invendu a été ré-exposé (trigger `check_opening_inventory_required`, mig 251). Rien de cela n'est paramétrable. La caisse ne vend que la « vitrine », alimentée par réassort (`ctl/sale.controller.ts:81-87`).
- Impact : un magasin de 3 000 références devrait compter et décider le sort de tout son stock chaque soir. Couplage boulangerie bloquant pour tout autre secteur.
- Piste : paramètre `sales.pos_day_close` (`unsold_decisions` : obligatoire / facultatif / désactivé ; `opening_check` : idem) lu par le contrôleur et par le trigger ; mode « stock magasin unique » (vitrine = réserve) pour les commerces sans vitrine.
- Effort : M.

**D6-52 — Mode hors-ligne**
- Constat : la caisse affiche « Hors ligne — les encaissements échoueront » (`POS:2765`). Aucun service worker, aucun stockage local des ventes ; `checkout` n'a pas de clé d'idempotence (un renvoi après coupure peut doubler un ticket).
- Impact : toute coupure d'Internet arrête la vente, l'application étant hébergée dans le nuage.
- Piste : catalogue et prix en cache (IndexedDB), file locale de tickets avec numéro provisoire par poste et clé d'idempotence, synchronisation au retour du réseau, règles de conflit (stock, promotions à quota) ; PWA installable.
- Effort : L.

### 4.2 P1

**D6-05 — Balance connectée et étiquettes poids-prix.** Constat : poids saisi au clavier (`POS:4762-4856`). Impact : erreurs et lenteur en alimentaire. Piste : lecture WebSerial de la balance du poste ; décodage des EAN-13 à préfixe 2x (prix ou poids embarqué). Effort : M.

**D6-06 — Prix libre.** Constat : le prix n'est jamais accepté du client (`val/sale.validator.ts:10-21`). Impact : pas d'article divers ni de prestation à prix saisi. Piste : produit marqué `open_price`, prix saisi borné et tracé sur `sale_items`. Effort : S.

**D6-08 — Notes.** Constat : `notes` accepté mais jamais envoyé ; rien par ligne. Piste : `sale_items.note`, champ dans le panier, impression sur ticket et bon de préparation. Effort : S.

**D6-09 — Variantes, options, formules.** Constat : une ligne par produit, clé `productId` (`POS:1085-1098`). Impact : habillement et restauration impossibles. Piste : `product_variants`, `modifier_groups`/`modifiers`, `sale_item_modifiers` ; identifiant de ligne propre au panier. Effort : L.

**D6-17 — Remise par ligne.** Piste : `discountPct`/`discountAmount` par ligne dans le schéma de checkout, colonne `manual_discount` sur `sale_items`, mêmes plafonds que D6-18. Effort : S.

**D6-19 — Dérogation de prix en caisse.** Piste : reprendre le mécanisme des commandes (mig 443 : prix grille figé, auteur, motif) sur `sale_items`. Effort : S.

**D6-22 — Cartes cadeaux, bons d'achat, avoirs.** Constat : rien. Impact : pas de remboursement en avoir, pas de vente de cartes. Piste : `gift_cards (code, solde, expiration)`, `gift_card_transactions` ; vente = dette 4xxx, utilisation = moyen de paiement ; avoir de retour émis comme carte. Effort : M.

**D6-25 — Intégration TPE.** Piste : au minimum référence de transaction et quatre derniers chiffres saisis ; ensuite connecteur (protocole du prestataire) poussant le montant et recevant l'autorisation ; rapprochement automatique à la fermeture. Effort : M à L selon le prestataire.

**D6-27 — Chèque et paiement mobile.** Constat : acceptés par le serveur, absents de l'écran. Piste : boutons dans la fenêtre de paiement ; pour le chèque : numéro, banque, échéance, compte « chèques à encaisser » puis remise en banque. Effort : S à M.

**D6-32 — Mentions légales du ticket.** Piste : imprimer d'office raison sociale, ICE, IF, RC, patente, adresse du magasin ; bloc HT/TVA par taux (après D6-31). Effort : S.

**D6-35 — Inaltérabilité des tickets.** Constat : pas de garde en base. Piste : triggers interdisant `UPDATE`/`DELETE` sur `sales`, `sale_items`, `sale_returns` hors colonnes d'encaissement ; empreinte chaînée par ticket ; archive par clôture. Effort : M.

**D6-36 — Piste d'audit.** Piste : table `pos_events` (ligne retirée, panier vidé, ticket en attente supprimé, tiroir ouvert sans vente, réimpression, remise, retour) alimentée par la caisse ; totaux dans les rapports X/Z ; rapport par caissier. Effort : M.

**D6-37 — Retours et échanges.** Constat : voir § 6 A2 et A4. Piste : rembourser le net payé de la ligne (prix − remise promotionnelle − quote-part de remise ticket et de points) ; chiffrer l'échange avec `posLinePrice` ; choix du devenir (remise en rayon, rebut, SAV). Effort : S à M.

**D6-39 — Remboursement par moyen d'origine.** Piste : `sale_returns.refund_method` (espèces, carte, avoir, compte client), écriture selon le mode, déduction du bon compteur à la fermeture. Effort : S.

**D6-40 — Recherche du ticket.** Piste : liste des tickets récents filtrable (date, client, montant, article) ; code-barres ou QR du numéro sur le ticket ; retour sans ticket sous autorisation. Effort : S.

**D6-42 — Apports, retraits, coffre.** Piste : table `cash_movements (session_id, sens, motif, montant, pièce)` ; boutons en caisse avec impression d'un reçu ; prélèvement vers le coffre ; bordereau de remise en banque relié aux sessions. Effort : M.

**D6-44 — Rapport Z complet.** Piste : numéro de clôture, ventes par mode, TPE et écart, remboursements, remises, apports/retraits, TVA par taux, nombre de tickets annulés ; version PDF archivée. Effort : S.

**D6-45 — Rapport X.** Piste : `GET /cash-register/:id/x-report` réservé au gérant (le comptage reste à l'aveugle pour la caissière). Effort : S.

**D6-47 — Entité caisse/terminal.** Piste : table `pos_registers (store_id, nom, imprimante, tiroir)` ; `cash_register_sessions.register_id` ; session rattachée à la caisse, plusieurs caissiers par session ; réglages du poste enregistrés côté serveur. Effort : M.

**D6-54 — Imprimante thermique.** Constat : § 6 A1. Piste : corriger `send()` (appel à `printer.execute()` pour les interfaces non CUPS) ; journaliser l'ouverture du tiroir ; agent local d'impression pour un serveur hébergé. Effort : S pour le correctif.

**D6-56 — Étiquettes.** Piste : utiliser le type `label` déjà prévu ; gabarits prix, poids, code-barres, DLC, allergènes. Effort : M.

**D6-59 — Restauration.** Piste : `dining_tables`, `open_checks` (addition ouverte, lignes envoyées par service), partage d'addition, bons cuisine sur l'imprimante `kitchen`. Effort : L.

---

## 5. Compteurs

| | Nombre |
|---|---|
| Capacités auditées | 66 |
| ✅ Complet | 21 |
| 🟡 Partiel | 20 |
| ❌ Absent | 25 |

Priorité des 45 écarts (🟡 et ❌) :

| Priorité | Nombre | Identifiants |
|---|---|---|
| P0 | 7 | D6-03, 18, 31, 33, 38, 48, 52 |
| P1 | 22 | D6-05, 06, 08, 09, 17, 19, 22, 25, 27, 32, 35, 36, 37, 39, 40, 42, 44, 45, 47, 54, 56, 59 |
| P2 | 15 | D6-02, 13, 15, 26, 29, 30, 50, 51, 53, 55, 58, 60, 63, 64, 65 |
| P3 | 1 | D6-66 |

Capacités marquées « serveur seul » : D6-08 (commentaire de ticket), D6-15 (vendeur), D6-27 (chèque, mobile), D6-63 (statistiques du jour).
Capacités marquées « couplage boulangerie » : D6-02, D6-07, D6-48, D6-61 ; « couplage Maroc » : D6-30 (devise et coupures en dur).

---

## 6. Anomalies rencontrées en chemin

Toutes sont constatées à la lecture du code ; aucune n'a été reproduite par exécution.

**A1 — Impression réseau/USB directe : récursion infinie.** `svc/printer.service.ts:87-90` : la fonction `send()` s'appelle elle-même pour toute interface autre que `cups` (`await send(printer, config)` au lieu de l'envoi du tampon). Les quatre appelants (`:462`, `:562`, `:582`, `:628`) reçoivent donc une erreur de dépassement de pile, renvoyée comme échec d'impression. Seules les imprimantes CUPS impriment ; ticket, rapport Z, test et tiroir sont touchés en TCP/USB/série. Gravité : élevée.

**A2 — Remboursement supérieur au montant payé.** `ctl/return.controller.ts:120-133` : remboursement = prix unitaire × quantité, sans tenir compte de `sale_items.promo_discount`, de la remise du ticket ni des points utilisés. Un ticket remisé de 50 % est remboursé à 100 %. L'écran calcule de même (`POS:2525-2528`). Gravité : élevée (perte d'espèces, vecteur de fraude combiné à D6-18 et D6-38).

**A3 — Retour : comptabilité et tiroir divergent.** L'écriture de retour crédite toujours la caisse 5161 (`svc/journal-generator.service.ts:519-527`), alors que la fermeture ne déduit du tiroir que les retours de tickets payés en espèces ou mixtes (`repo/cash-register.repository.ts:171-182`). Un retour sur ticket carte ou à crédit fausse donc 5161 ; pour un ticket mixte, tout le remboursement est imputé aux espèces. Le total carte attendu n'est jamais diminué des retours.

**A4 — Échange mal chiffré.** `repo/return.repository.ts:127-135` : prix de l'article de remplacement = `products.price × quantité`, sans prix de canal ni palier ; pour un produit au poids la quantité est en grammes (prix au kilo multiplié par des grammes) ; `price_per_person` ignoré. Le complément est toujours encaissé en espèces, l'écran n'envoyant pas `exchangePaymentMethod` (`POS:2724-2738`). La vente d'échange n'a ni client, ni canal, ni vendeur (`:156-169`), et ne vérifie pas la DLV/DDE.

**A5 — Requêtes pendantes sur erreur (retours et caisse).** Express 4.21 (`server/package.json:42`) ; les routes de `rt/return.routes.ts:11-13` et `rt/cash-register.routes.ts:9-17` appellent des contrôleurs `async` sans `asyncHandler`, contrairement aux ventes (`rt/sales.routes.ts:14-17` explique ce défaut, F-037). Une exception (`repo/return.repository.ts:128`, `:190`, `:200` ; `ctl/cash-register.controller.ts:89`, `:203`) laisse la requête sans réponse. Côté écran, `createReturnMutation` n'a pas de `onError` (`POS:913-922`) : la caissière ne voit aucun message.

**A6 — Paramètre de remise non appliqué en caisse.** Libellé « Remise maximale — vente et caisse » (`svc/parameters-catalog.ts:127`), mais aucune lecture dans `ctl/sale.controller.ts` (voir D6-18).

**A7 — Rôle « vendeuse » incohérent.** `ROLE_GROUPS.SALES` inclut la vendeuse, `ROLE_GROUPS.CASH` non (`shared/src/constants/roles.ts:27-29`). L'encaissement exige une session ouverte par l'utilisateur lui-même (`ctl/sale.controller.ts:200-204`), or l'ouverture et la lecture de session exigent CASH (`rt/cash-register.routes.ts:9-14`). Une vendeuse voit l'écran de caisse (`POS:1518`) mais ne peut ni ouvrir ni vendre. Hypothèse : en pratique les vendeuses reçoivent aussi le rôle caissier (rôles multiples, mig 335) ; non vérifié en base.

**A8 — Vente attribuée au dernier employé pointé.** La caisse n'envoie jamais `employeeId` ; le repli prend le dernier pointage sans départ du magasin, sans filtre de poste (`repo/employee.repository.ts:675-691`). Le chiffre d'affaires par vendeur et les commissions peuvent être attribués à un salarié qui ne vend pas.

**A9 — Code mort ou inachevé.**
- Requête `lastClosedData` jamais utilisée (`POS:392-396`) : le fond de caisse n'est pas pré-rempli avec le dernier comptage, la route `GET /cash-register/last-amount` est sans effet.
- `salesApi.todayStats` jamais appelé (`client/src/api/sales.api.ts:13`).
- Types d'imprimante `kitchen` et `label` déclarés (mig 125) mais jamais employés.
- Trois routes `/sales/special` ne renvoient plus que 410 (`rt/sales.routes.ts:36-38`).
- Champ `label` des tickets en attente accepté par le serveur (`rt/pos-parked.routes.ts:25`) et affiché (`POS:2266`), jamais saisi.
- Commentaires périmés : « Payment popup removed — checkout is now inline » (`POS:2780-2781`) alors que la fenêtre de paiement existe (`:4502`) ; « Especes/Carte/Mobile » (`:4499-4500`) alors que le sélecteur propose Mixte et non Mobile.

**A10 — Entrées non validées à la caisse.** `openingAmount` pris tel quel du corps de requête (`ctl/cash-register.controller.ts:70`), `actualAmount` passé par `parseFloat` sans borne (`:169`), pagination de la liste des sessions non bornée (`:12`). Aucun schéma de validation sur ces routes.

**A11 — Onglet Commandes de la caisse : recherche limitée aux 50 dernières.** `orderSearch` figure dans la clé de requête mais n'est pas envoyé au serveur (`POS:491-495`) ; le filtre s'applique dans le navigateur (`:1029-1037`). Une commande plus ancienne est introuvable.

**A12 — « CA HT » affiché sur des montants TTC.** Mesure `revenue` du générateur de rapports libellée « CA HT » sur `SUM(si.subtotal)` (`repo/report-builder.repository.ts:46`), alors que les tickets ne portent aucune TVA (D6-31).

**A13 — Montant reçu et rendu non conservés.** Ils transitent par l'appel d'impression (`POS:792-795`) mais ne sont pas enregistrés (`repo/sale.repository.ts:217-219`) : une réimpression ultérieure ne les montre plus.

**A14 — Suppression et reprise d'un ticket en attente indistinctes.** Même route `DELETE` pour reprendre et pour abandonner (`rt/pos-parked.routes.ts:55-60`, `POS:1263-1282`) : impossible de savoir après coup si un panier a été vendu ou supprimé.

**A15 — Série de numéros unique et verrouillée jusqu'au COMMIT.** Le compteur des tickets est commun à tous les magasins et reste verrouillé pendant toute la transaction de vente (`utils/document-number.ts`). Hypothèse : goulot possible avec de nombreuses caisses simultanées ; non mesuré.

**A16 — Traces du métier d'origine dans la caisse générique.** Icône « baguette » par défaut (`POS:1509`), compteur de sachets et motifs (`POS:1973-2003`, `val/sale.validator.ts:45-49`), familles initialisées « Boulangerie » (mig 375), vocabulaire « vitrine » dans les messages d'erreur (`ctl/sale.controller.ts:85`, `:125`), paramétrage « Catalogue Loyverse » (`features/boutique/JourneeBoutiquePage.tsx:41`).
