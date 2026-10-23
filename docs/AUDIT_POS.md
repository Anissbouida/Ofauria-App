# Audit — Module POS (vente, approvisionnement, inventaire fin de journée, caisse & shifts)

_Date : 2026-07-14 · Périmètre : POS (checkout, commandes, retours/échanges), approvisionnement vitrine (réassort labo → boutique), inventaire de fin de journée & invendus, fermeture de caisse & passation de shift, saisie manuelle des shifts._
_Complément des audits existants : [AUDIT_FONCTIONNEL.md](AUDIT_FONCTIONNEL.md) (système complet), [AUDIT_SECURITE.md](AUDIT_SECURITE.md). Les 3 constats les plus critiques (V2, N1, C2) ont été re-vérifiés dans le code au moment de la rédaction._

---

## Résumé exécutif

Le POS est **fonctionnellement riche** (FEFO dual-clock DLC/DLV, blocage des périmés à la fermeture, contrôle d'inventaire d'ouverture avec validation manager, sourcing automatique du réassort, comptage par dénominations) et le cœur transactionnel du checkout est **sain** : transaction unique, `FOR UPDATE` sur la vitrine, refus explicite du stock négatif, advisory lock sur la numérotation.

Mais il n'est **pas prêt pour la mise en production** en l'état, pour quatre raisons :

1. **Deux blocages fonctionnels P0 à la fermeture de caisse** : la suggestion `retour_stock` viole une contrainte CHECK jamais mise à jour (rollback de toute la clôture — N1), et la condition d'affichage du motif d'écart est inversée côté POS (fermeture impossible dès qu'il manque 1 unité — N2).
2. **Deux vecteurs de fraude directs sur les retours** : montant de remboursement contrôlé par le client sans recoupement serveur (V2), retours non scopés au magasin (V6).
3. **Le modèle de caisse fausse structurellement le Solde Cash** : le comptage tiroir (`actual_amount`, un stock) est traité comme une recette du jour (un flux) — le fond de caisse est recompté chaque jour, la passation double le tiroir du matin (C2). C'est très probablement la cause racine qui a nécessité l'override de la mig 237. Et dès que le POS entrera en prod en parallèle de la saisie manuelle, la vue Caisse comptera le CA **deux fois** (C1) — le ledger est protégé, la vue Caisse non.
4. **La traçabilité par lot se casse à plusieurs endroits** : destructions d'expirés, retours, pertes en journée et inventaire de clôture ne mirrorent pas `product_lots` — les lots gardent des quantités fantômes et l'invariant lots ↔ `product_store_stock` dérive chaque jour.

Aucune décision d'invendu, aucun écart de caisse, aucune perte n'est **comptabilisée** (pas de 658/758, pas de valorisation ledger) — le module est analytique, pas comptable.

---

## 1. POS — vente (checkout, commandes, retours)

### 1.1 Flux constaté

- **Catalogue** : 3 sources ([POSPage.tsx:270](../client/src/features/pos/POSPage.tsx:270)) — liste par catégorie (`strictStore=true`, le serveur aliase `stock_quantity = vitrine_quantity`, [product.repository.ts:30](../server/src/repositories/product.repository.ts:30)), « Top ventes », « Récents » (localStorage).
- **Checkout** ([sale.controller.ts:52-206](../server/src/controllers/sale.controller.ts:52)) : recalcul complet des prix côté serveur (override canal → palier tarifaire poids → prix produit), caisse ouverte obligatoire. Transaction unique ([sale.repository.ts:166-289](../server/src/repositories/sale.repository.ts:166)) : numéro `VNT-` sous advisory lock → items → par item : check DLV/DDE, décrément `product_store_stock.vitrine_quantity` (`FOR UPDATE` + refus 409 si insuffisant, [product-stock.helper.ts:77-93](../server/src/repositories/product-stock.helper.ts:77)), miroir FEFO sur `product_lots` → fidélité → écriture ledger (SAVEPOINT non bloquant) → COMMIT.
- **Commandes** : avance = vente `advance` sans stock ; livraison = vente `delivery` (avec avance) ou `standard` (décrémente la vitrine) ([order.controller.ts:283-353](../server/src/controllers/order.controller.ts:283)).
- **Retours/échanges** ([return.repository.ts:94-246](../server/src/repositories/return.repository.ts:94)) : retour = re-crédit vitrine ; échange = nouvelle vente + décrément du produit de remplacement. **Aucun void/annulation de ticket n'existe.**

### 1.2 Bugs

| ID | Sév. | Constat |
|---|---|---|
| **V1** | **Critique** | **Produits au poids vendus ~0 DH depuis « Top ventes » (onglet par défaut).** `findTopSelling` ne sélectionne ni `sale_unit` ni `price_per_kg` ([product.repository.ts:113-134](../server/src/repositories/product.repository.ts:113)) → `addToCart` ([POSPage.tsx:724](../client/src/features/pos/POSPage.tsx:724)) le traite comme unitaire, qty 1 → le serveur interprète 1 = **1 gramme** → prix facturé ≈ `price_per_kg/1000` (0,08 DH pour un produit à 80 DH/kg). Le ticket client affiche un autre prix. `is_expired`/`nearest_dlv` manquent aussi. |
| **V2** | **Critique** | **Remboursement contrôlé par le client.** `POST /returns` sans aucun schéma Zod ([return.routes.ts:12](../server/src/routes/return.routes.ts:12)) ; `refundAmount = Σ items[].subtotal` envoyés par le client, jamais recoupés avec `sale_items.unit_price` ([return.controller.ts:96](../server/src/controllers/return.controller.ts:96)). Une caissière (rôle SALES) peut poster `subtotal: 5000` sur le retour d'un croissant → réduit d'autant l'`expected_cash` de sa session → **vecteur de détournement direct**. Quantités négatives/décimales acceptées. |
| **V3** | **Critique** | **Échange : CA et caisse systématiquement faux.** La vente d'échange est créée avec `total = exchangeTotal` (valeur totale des nouveaux produits) et `payment_method='cash'` en dur ([return.repository.ts:145-157](../server/src/repositories/return.repository.ts:145)), alors que le client ne paie que la différence. Ni `todayStats` ni la clôture ne déduisent les `sale_returns type='exchange'` → CA du jour et `expected_cash` surévalués → déficit artificiel imputé à la caissière. |
| **V4** | Majeur | **Collision de numéro sur la vente d'échange** : générée par `COUNT(*)+1` ([return.repository.ts:136-140](../server/src/repositories/return.repository.ts:136)) au lieu du `MAX` sous advisory lock du checkout → après un hard delete de vente spéciale, violation UNIQUE → 500 après que le client a déjà rendu la marchandise. |
| **V5** | Majeur | **Ticket imprimé ≠ vente enregistrée.** Le reçu est construit depuis le panier client ([POSPage.tsx:534-554](../client/src/features/pos/POSPage.tsx:534)) alors que le serveur recalcule (paliers tarifaires poids, prix par canal — jamais appliqués au front). Rendu-monnaie calculé sur le mauvais total ; la réponse serveur est ignorée hormis `sale_number`/`id`. |
| **V6** | Majeur | **Retour non scopé au magasin** : pas de contrôle `sale.store_id` vs `req.user.storeId` ([return.controller.ts:20-46](../server/src/controllers/return.controller.ts:20)) → retour d'un ticket du magasin B remboursé sur la caisse du magasin A, stock re-crédité dans la vitrine A. |
| **V7** | Majeur | **`markPaid` (encaissement d'impayé) ne génère aucune écriture ledger** ([sale.repository.ts:452-501](../server/src/repositories/sale.repository.ts:452)), contrairement au checkout. Idem la vente d'échange. Visible en compta seulement après un `ledger-backfill` manuel. |
| **V8** | Majeur | **`amountPaid` à la livraison de commande : décoratif** — parsé, jamais validé ni stocké ([order.controller.ts:284,308](../server/src/controllers/order.controller.ts:284)) ; la vente est créée pour `remaining` quoi que saisisse la caissière, le champ UI laisse croire l'inverse. |
| **V9** | Majeur | **Retour = remise en vitrine inconditionnelle**, même pour motif « périmé/abîmé » ([return.repository.ts:204-208](../server/src/repositories/return.repository.ts:204)) : le produit redevient vendable, sans lot ni DLV. |
| **V10** | Majeur | **Pas d'idempotence checkout/livraison/retour** : seul `isPending` protège ([POSPage.tsx:835-849](../client/src/features/pos/POSPage.tsx:835)) ; double tap ou retry réseau = 2 ventes, 2 décréments. Livraison de commande sans transaction ni `FOR UPDATE` ([order.controller.ts:295-349](../server/src/controllers/order.controller.ts:295)) : 2 livraisons simultanées = 2 ventes. |
| **V11** | Mineur | **Deadlock inter-caissières possible** : items verrouillés dans l'ordre du panier ([sale.repository.ts:194-252](../server/src/repositories/sale.repository.ts:194)) ; trier par `product_id` l'éliminerait. |
| **V12** | Mineur | **Quantités panier corrompues** quand le produit n'est plus dans la liste affichée : `getProductStock` cherche dans la liste filtrée courante ([POSPage.tsx:713-716](../client/src/features/pos/POSPage.tsx:713)) → « Max 0 en stock », numpad → ligne à quantité 0 → Zod rejette au checkout. Même cause : « Modifier le poids » no-op ([POSPage.tsx:1236](../client/src/features/pos/POSPage.tsx:1236)). |
| **V13** | Mineur | Routes orders sans validator Zod, `updateStatus` sans machine à états ([order.controller.ts:252-255](../server/src/controllers/order.controller.ts:252)) — une commande `completed` peut repasser `pending`. |
| **V14** | Mineur | `LossDeclarationModal` charge le catalogue sans `strictStore` ([LossDeclarationModal.tsx:66-69](../client/src/features/pos/LossDeclarationModal.tsx:66)) : le « Stock » affiché est le stock global, pas la vitrine. `sachetsGiven` = compteur analytique jamais décrémenté de `packaging_items`. |

### 1.3 Retour lots ↔ vitrine (asymétrie structurelle)

À la vente, vitrine et lots sont décrémentés ensemble (miroir FEFO, sous-consommation silencieuse si les lots ne couvrent pas — [product-lot.repository.ts:141-151](../server/src/repositories/product-lot.repository.ts:141)). **Au retour et à l'échange, seule la vitrine bouge** : `product_lots` n'est jamais restauré → chaque retour creuse la divergence lots/vitrine et casse la traçabilité HACCP pourtant annoncée en commentaire ([sale.repository.ts:241-244](../server/src/repositories/sale.repository.ts:241)). L'échange ne passe pas non plus par `checkSaleability` (échange possible contre un produit DLV expirée).

### 1.4 UX notable

- **Piège du billet rapide** : billets 20/50/100/200 masqués si `total > 200` ([POSPage.tsx:1401](../client/src/features/pos/POSPage.tsx:1401)), **aucune saisie libre du montant donné** ; un billet sélectionné puis un total qui monte désactive « Encaisser » sans moyen de désélectionner. Pas de calcul de monnaie au-delà de 200 DH.
- Stock non rafraîchi après vente (`onSuccess` n'invalide que `sales`/`dashboard`, [POSPage.tsx:556](../client/src/features/pos/POSPage.tsx:556)).
- Brouillon panier en localStorage **par navigateur, pas par utilisateur** : à la passation, la caissière suivante hérite du panier de la précédente ([POSPage.tsx:108-130](../client/src/features/pos/POSPage.tsx:108)).
- Retour au poids : stepper +1 par clic — un article vendu 500 g demande 500 clics ([POSPage.tsx:1903-1911](../client/src/features/pos/POSPage.tsx:1903)).
- Arrondis : le serveur arrondit chaque ligne à 2 décimales, le front non → écarts d'un centime sur paniers au poids.

---

## 2. Approvisionnement (réassort labo → vitrine)

### 2.1 Flux constaté

Cycle en 5 étapes ([replenishment.routes.ts:16-45](../server/src/routes/replenishment.routes.ts:16)) : **création** par la caissière (demande éclatée en sous-demandes par rôle chef, numéro `DRA-YYYYMMDD-nnn-SUFFIXE`) → **acknowledge** par le chef (sourcing backroom / frigo semi-fini / production, plan de production lié) → **préparation** (`qty_to_store`/`qty_to_stock`, partielle autorisée) → **transfert** (marquage `ready`, aucun mouvement) → **réception** par la caissière : **seul point où le stock bouge** — `transferBackroomToVitrine` ([product-stock.helper.ts:113-146](../server/src/repositories/product-stock.helper.ts:113)) avec miroir FEFO sur `product_lots` et pose de la DLV à la première exposition. FEFO effectif à la réception et à la vente, dual-clock DLC/DLV avec auto-expire.

### 2.2 Bugs

| ID | Sév. | Constat |
|---|---|---|
| **A1** | **Critique** | **`confirmReception` sans garde d'état → double réception.** Ne vérifie jamais que la demande est `transferred` ni l'item `ready` ([replenishment.repository.ts:439-546](../server/src/repositories/replenishment.repository.ts:439)) ; le passage `transferred → closed` no-op silencieusement mais la transaction **commit quand même les mouvements de stock**. Rejeu (double-clic, retry) → 2e transfert backroom → vitrine, stock vendable gonflé sans marchandise physique. |
| **A2** | Majeur | **Pas de contrôle multi-magasin** sur `acknowledge`/`prepare`/`transfer`/`confirmReception` ([replenishment.controller.ts:239-270](../server/src/controllers/replenishment.controller.ts:239)) : une caissière du magasin A peut confirmer la réception d'une demande du magasin B. |
| **A3** | Majeur | **Collision de numéros DRA** : `generateRequestNumber()` appelé sans le client de transaction ([replenishment.repository.ts:216](../server/src/repositories/replenishment.repository.ts:216)) → le `pg_advisory_xact_lock` s'exécute en autocommit sur une autre connexion du pool (relâché immédiatement) → deux créations simultanées = même numéro = violation UNIQUE = 500. |
| **A4** | Majeur | **Sélection ALÉATOIRE de produits** sans historique : le formulaire pré-sélectionne 12 produits au hasard avec quantités aléatoires ([ReplenishmentPage.tsx:391-393](../client/src/features/replenishment/ReplenishmentPage.tsx:391)) — code de démo resté en place. |
| **A5** | Majeur | **Validation des quantités absente côté serveur** : `qtyReceived` négatif ou > `qty_to_store` accepté ([replenishment.repository.ts:466-475](../server/src/repositories/replenishment.repository.ts:466)) ; `qtyToStore`/`qtyToStock` non bornés vs demandé. |
| **A6** | Majeur | **Blocage opérationnel indéfini** : `partial_deadline` (24 h) écrite mais jamais lue ; combinée à « une seule demande en cours par magasin » ([replenishment.controller.ts:100-109](../server/src/controllers/replenishment.controller.ts:100)), une sous-demande `partially_received` dont la production traîne bloque toute nouvelle demande — seule issue : annuler et perdre le reliquat. |
| **A7** | Moyen | **Règle « invendus » morte** : `checkUnsoldItems` lit `stock_deliveries`, table **jamais alimentée** (aucun INSERT dans le code) → le garde-fou client ne se déclenche jamais. |
| **A8** | Moyen | **Markup serveur ignoré, traçabilité suggéré/demandé perdue** : le client recalcule avec `MARGIN = 1.10` en dur et n'envoie jamais `suggestedQuantity` ([ReplenishmentPage.tsx:358,494,632](../client/src/features/replenishment/ReplenishmentPage.tsx:358)) → `suggested_quantity` toujours NULL. |
| **A9** | Moyen | **Inventaire de clôture (côté réassort) : pertes/recyclage non mirrorés sur `product_lots`** ([replenishment.repository.ts:789-855](../server/src/repositories/replenishment.repository.ts:789)) ; et réexposition avec `ON CONFLICT (…, first_displayed_at=NOW())` qui ne matche jamais ([replenishment.repository.ts:858-864](../server/src/repositories/replenishment.repository.ts:858)) → lignes `product_display_tracking` dupliquées. |
| **A10** | Moyen | **Shortfall silencieux** : aucune réservation entre acknowledge et réception ; `transferBackroomToVitrine` déplace `min(disponible, reçu)` mais l'item enregistre `qty_received` complet — l'écart est invisible. |
| **A11** | Mineur | Un chef peut préparer/transférer la demande d'un autre rôle (contrôle de rôle uniquement sur `acknowledge`, [replenishment.controller.ts:158-167](../server/src/controllers/replenishment.controller.ts:158)). |

### 2.3 Traçabilité & manques

- **Aucun lien `replenishment_request_item ↔ product_lot`** : impossible de dire quelle DRA a mis quel lot en vitrine.
- Produits sans `shelf_life_days` : aucun lot créé en production → toute la chaîne lot est aveugle pour eux (l'écran « stock orphelin » est l'aveu de cette dérive).
- `stock_min_threshold` existe (mig 035) mais n'alerte ni ne déclenche aucun réassort automatique ; pas de seuil max.
- Le contrôle « appro − vendu − restant » de la clôture ne liste que `vitrine_quantity > 0` : un produit vendu (ou volé) à 100 % n'apparaît jamais.
- **Module recon (migs 232-236) étanche** : l'« approvisionné » y est ressaisi à la main alors que `qty_received` existe — brancher `bulkUpsertAppro` sur les réceptions clôturées supprimerait la double saisie.

---

## 3. Inventaire de fin de journée & invendus

### 3.1 Flux constaté

En `fin_journee` : blocage 409 si lots DLC/DLV dépassés → modal de destruction obligatoire (`POST /unsold-decisions/destroy-expired`) → écran d'inventaire alimenté par `GET /unsold-decisions/suggestions` (fenêtre cloisonnée par shift, cap 24 h) avec suggestion automatique parmi `reexpose` / `recycle` (→ ingrédient) / `waste` / `retour_stock` → `POST /unsold-decisions` (batch) applique les effets stock. En `passation` : tout est neutralisé à `reexpose` sans effet stock. Le lendemain, un **trigger DB** (mig 116) bloque l'ouverture de caisse tant que les `reexpose` n'ont pas fait l'objet d'un contrôle d'ouverture validé (validation manager si écart).

### 3.2 Bugs

| ID | Sév. | Constat |
|---|---|---|
| **N1** | **P0 — bloquant** | **`retour_stock` viole le CHECK de `unsold_decisions`.** [062_unsold_decisions.sql:25,27](../server/migrations/062_unsold_decisions.sql) : `CHECK IN ('reexpose','recycle','waste')`, jamais étendu (la mig 106 n'ajoute que le label `ref_entries`). Or le serveur **suggère** `retour_stock` ([unsold-decision.repository.ts:106-110](../server/src/repositories/unsold-decision.repository.ts:106)) et le POS propose le bouton ([POSPage.tsx:2699](../client/src/features/pos/POSPage.tsx:2699)). Dès qu'un produit éligible existe (DLV, non réexposable, DLC > 24 h), l'INSERT viole le CHECK → **rollback du batch entier** → la caissière ne peut plus clôturer (même en override, `suggested_destination` reste `retour_stock`). Vérifié : aucune migration n'étend ce CHECK. |
| **N2** | **P0 — bloquant** | **Condition du motif d'écart inversée côté POS.** `discrepancy = théorique − compté` (manquant ⇒ > 0, [POSPage.tsx:2572](../client/src/features/pos/POSPage.tsx:2572)) mais le sélecteur de motif ne s'affiche que si `discrepancy < 0` ([POSPage.tsx:2759](../client/src/features/pos/POSPage.tsx:2759)) = surplus. Le serveur exige le motif quand il **manque** ([unsold-decision.controller.ts:95-105](../server/src/controllers/unsold-decision.controller.ts:95)). Dès qu'il manque 1 unité : aucun champ pour saisir le motif, 400 en boucle → fermeture bloquée (contournement : mentir sur le comptage). |
| **N3** | **Critique** | **Décider 2× le même invendu : possible.** Aucune contrainte unique `(session_id, product_id)`, aucune garde serveur (`findBySession` existe mais n'est jamais utilisé, [unsold-decision.repository.ts:782](../server/src/repositories/unsold-decision.repository.ts:782)). Retry réseau ou usage combiné `UnsoldDecisionsPage` + fermeture POS = double décrément vitrine + doubles pertes. |
| **N4** | Majeur | **Destruction des expirés sans miroir `product_lots`** : `destroyExpiredItems` ([unsold-decision.repository.ts:873-924](../server/src/repositories/unsold-decision.repository.ts:873)) décrémente la vitrine et insère la perte mais ne consomme jamais les lots → `vitrine_qty` fantôme, lots `active`, perte sans `source_product_lot_id`. Même défaut pour les pertes en journée ([product-loss.controller.ts:87-98](../server/src/controllers/product-loss.controller.ts:87)). |
| **N5** | Majeur | **Écart approuvé à l'ouverture jamais répercuté sur le stock** : `validateOpeningCheck` = simple UPDATE de statut ([opening-inventory-check.repository.ts:159-181](../server/src/repositories/opening-inventory-check.repository.ts:159)). « 5 manquants (vol) » approuvé : ni vitrine, ni lots, ni perte — le manquant réapparaît en écart à la fermeture suivante. |
| **N6** | Majeur | **Passation ⇒ contrôle d'ouverture forcé au shift suivant** : le check est inséré sans `check_type` → défaut `'closing'` ([unsold-decision.repository.ts:333-338](../server/src/repositories/unsold-decision.repository.ts:333)) → le trigger mig 116 bloque l'ouverture du shift d'après-midi en pleine journée, alors que toute l'UX parle « des invendus de la veille ». |
| **N7** | Majeur | **Gardes de comptage mortes** : le POS pré-remplit tous les comptages à 0 ([POSPage.tsx:446-450](../client/src/features/pos/POSPage.tsx:446)) → la garde « produits non comptés » ne se déclenche jamais ; le contrôle d'ouverture pré-remplit `found = expected` et auto-remplit le motif ([OpeningInventoryCheckPage.tsx:78,98,104](../client/src/features/inventory-check/OpeningInventoryCheckPage.tsx:78)) → validation sans compter en 1 clic. |
| **N8** | Moyen | **`UnsoldDecisionsPage` : écarts structurellement impossibles** (`initialQty = remaining + sold` ⇒ discrepancy toujours 0, [UnsoldDecisionsPage.tsx:202-211](../client/src/features/unsold/UnsoldDecisionsPage.tsx:202)) + **crash rendu** si suggestion `retour_stock` (`DEST_CONFIG` ne la connaît pas, l.27-52). |
| **N9** | Moyen | **`DELETE /product-losses/:id` supprime une perte sans restituer le stock ni journaliser** — effacement d'audit possible par un manager. Divergence validator (`casse`/`non_vendu` acceptés) vs CHECK DB (refusés) → 500 au lieu de 400. |
| **N10** | Moyen | **Écart fantôme** : clamp `GREATEST(0,…)` sur `initial_stock` ([unsold-decision.repository.ts:226](../server/src/repositories/unsold-decision.repository.ts:226)) → des pertes déjà déclarées en journée peuvent être re-comptabilisées en `ecart_inventaire`. Le **surplus** (compté > théorique) n'a aucun traitement. |
| **N11** | Mineur | **`yield_ratio` de recyclage ignoré** : défini en mig 116 (baguette→chapelure 0,7), exposé dans les suggestions, mais l'incrément d'inventaire est 1:1 ([unsold-decision.repository.ts:421-425](../server/src/repositories/unsold-decision.repository.ts:421)). |

### 3.3 Manques

- **Aucune écriture comptable** pour pertes/destructions/écarts (`journal-generator` ignore `product_losses`) ; `unit_cost` fourni par le client, non revérifié serveur.
- **Registre de destruction ONSSA non opposable** : pas de n° de lot sur `destroy-expired`, photo facultative, pas de PV/signature, pas d'export, et les pertes sont supprimables (N9).
- Pas de destination **« don »** (associations) — fréquente en boulangerie, utile fiscalement.
- Pas de seuil d'alerte sur les écarts (montant/%) ; motif d'override auto-rempli `'Decision operateur'` ([POSPage.tsx:2903](../client/src/features/pos/POSPage.tsx:2903)) → traçabilité d'override vide.
- **Pas de pont invendus → module recon** : `recon_lines.invendu_qty` ressaisi à la main alors que `unsold_decisions` contient déjà le comptage.

---

## 4. Fermeture de caisse & passation de shift

### 4.1 Flux constaté

- **Ouverture** : `POST /cash-register/open` — session **par utilisateur** (pas par caisse physique), fond de caisse saisi librement, trigger mig 116 exige le contrôle d'inventaire d'ouverture.
- **Fermeture en 2 temps** : `POST /close` calcule `expected_cash = opening + cash net` et le `close_type` mais **laisse la session `open`** ; `POST /:id/submit` enregistre le compté, calcule l'écart, ferme. Entre les deux : inventaire vitrine + comptage (mode direct ou dénominations MAD).
- **Passation** : ne transmet **que** l'inventaire produits. Le shift suivant rouvre une session et retape le fond de caisse à la main — le pré-remplissage depuis la dernière clôture est du code mort ([POSPage.tsx:262-266](../client/src/features/pos/POSPage.tsx:262)). La table `shifts` (migs 151/152) est un catalogue RH sans aucun lien avec la caisse.
- **Saisie manuelle** (mig 149, le flux réel en prod) : 1 ligne/(magasin, jour), 8 montants matin/soir × cash/carte × réel/système ; chaque upsert régénère l'écriture ledger et reverse les écritures POS du jour.
- **L'écart de caisse ne va nulle part** : stocké sur la session, affiché, **jamais comptabilisé** (pas de 658/758). Pour la saisie manuelle, le ledger enregistre le « réel » : un manque de caisse est silencieusement absorbé dans le CA (7111 minoré).

### 4.2 Bugs

| ID | Sév. | Constat |
|---|---|---|
| **C1** | **Critique** | **Double comptage POS + saisie manuelle dans la vue Caisse et Ventes.** `getRegister` UNION-ALL `sales` + `manual_shift_entries` **sans le garde-fou du ledger** ([accounting.repository.ts:72-103](../server/src/repositories/accounting.repository.ts:72), idem report `:157-177` ; [SalesPage.tsx:208-221](../client/src/features/sales/SalesPage.tsx:208)). Le jour où le POS entre en prod avec la saisie manuelle encore active, le CA est compté 2× dans le Solde Cash — le ledger, protégé ([journal-generator.service.ts:306-313](../server/src/services/journal-generator.service.ts:306)), divergera de la vue Caisse. **À corriger avant la mise en prod du POS.** |
| **C2** | **Critique** | **Le comptage tiroir est traité comme une recette du jour.** `cash_caissiere = SUM(actual_amount)` ([accounting.repository.ts:51-64,144-151,189](../server/src/repositories/accounting.repository.ts:51), [AccountingPage.tsx:162,178](../client/src/features/accounting/AccountingPage.tsx:162)) : (a) le fond de caisse est recompté chaque jour comme du cash entrant (1 000 DH de fond × 30 j = +30 000 DH fictifs au report) ; (b) passation + fin_journee le même jour → le tiroir du soir contient celui du matin → sommé 2×. **Probable cause racine de l'override mig 237** (et du fond initial injecté en `payments` par la mig 214). Le bon modèle : `actual_amount − opening_amount` (flux), pas `actual_amount` (stock). |
| **C3** | Majeur | **`prevCash` tout-ou-rien** : `prevSessionCash > 0 ? prevSessionCash : prevSalesCash` ([accounting.repository.ts:189](../server/src/repositories/accounting.repository.ts:189)) — une seule session POS de test dans l'historique fait ignorer toutes les ventes/saisies manuelles antérieures dans le report du mois. |
| **C4** | Majeur | **Fausses alertes de réconciliation** : `ecart = SUM(actual_amount) − SUM(cash_revenue)` ignore `opening_amount` ([accounting.repository.ts:193-209](../server/src/repositories/accounting.repository.ts:193)) → alerte structurelle ≈ fond de caisse chaque jour dès que le POS sert (seuil 5 DH). |
| **C5** | Majeur | **Réécriture post-clôture** : `submitActualAmount` sans `AND status='open'` ([cash-register.repository.ts:206-212](../server/src/repositories/cash-register.repository.ts:206)) — une caissière peut « corriger » son écart après coup, indéfiniment. Et `submit` sans `close` préalable → `difference = NaN` stocké (`expected_cash` NULL non validé). |
| **C6** | Majeur | **Ventes pendant le comptage non bloquées** : entre `close()` (stats figées) et `submit()`, la session est encore `open` → le checkout accepte des ventes → `expected_cash` périmé → faux excédent. |
| **C7** | Majeur | **Fuseau UTC dans l'anti-double-comptage ledger** : `DATE(paid_at)` sans `AT TIME ZONE` ([journal-generator.service.ts:307-312,1041-1046](../server/src/services/journal-generator.service.ts:307)) vs `entry_date` locale — une vente encaissée entre 00h et 01h (Casablanca, UTC+1) échappe au reverse → double comptage ledger possible. |
| **C8** | Moyen | **Race à l'ouverture** : check-then-insert non transactionnel, aucun index unique partiel `(user_id) WHERE status='open'` → 2 sessions ouvertes possibles ; et 2 utilisateurs peuvent chacun avoir une session sur le même tiroir (pas de notion de caisse physique). |
| **C9** | Moyen | **Remboursements toujours soustraits du cash** quel que soit le moyen d'origine ([cash-register.repository.ts:133-164](../server/src/repositories/cash-register.repository.ts:133)) : un retour d'une vente carte fait baisser `expected_cash` comme s'il était sorti du tiroir. |
| **C10** | Moyen | **`closeType` non validé** (toute chaîne ≤ 20 car., pas de CHECK en mig 078) — une valeur inattendue fausse les fenêtres d'inventaire des invendus qui filtrent sur `close_type`. |
| **C11** | Moyen | **Échec compta silencieux à l'upsert manuel** : si la génération d'écriture échoue, simple `console.error` ([manual-shift-entry.repository.ts:98-104](../server/src/repositories/manual-shift-entry.repository.ts:98)) — saisie enregistrée, ledger désynchronisé sans signal. |
| **C12** | Mineur | **Suppression de saisie manuelle impossible via l'API** (routes GET/PUT seulement ; `repository.delete` avec reverse ledger propre = code mort) — une saisie sur le mauvais jour ne peut être qu'écrasée. |

### 4.3 Manques vs un vrai POS

- **Z/X report** : rien — pas de numérotation séquentielle inviolable des clôtures, `submit` réécrivable (C5) : aucune irrévocabilité.
- **Blind count partiel** : l'UI cache l'attendu, mais l'API `close` le renvoie au client avant la saisie ; dénominations non persistées (seul le total part) et absentes à l'ouverture.
- **Dépôt banque / coffre** : inexistants — le cash s'accumule fictivement en 5161 ; les ventes carte débitent 5141 sans rapprochement TPE.
- **Passation contradictoire** : pas de double signature (sortant compte / entrant vérifie), fond de caisse non contrôlé à la reprise — l'intégrité repose sur la confiance.
- **Paid-out/paid-in** : les `payments` cash ne sont pas rattachés à la session → une dépense payée depuis le tiroir pendant le shift crée un faux déficit.
- **Multi-caisses** : session par utilisateur, pas de table `registers` ; `manual_shift_entries` = 1 ligne/jour/magasin (impossible : 2 caisses ou 3 shifts).
- Écarts : pas de motif obligatoire, pas de seuil d'approbation manager, jamais comptabilisés.

---

## 5. Constats transverses

1. **Lots fantômes** : 4 chemins décrémentent la vitrine sans mirrorer `product_lots` (retours V9/I-1, destructions N4, pertes en journée N4, inventaire clôture côté réassort A9). L'invariant lots ↔ `product_store_stock` dérive chaque jour d'exploitation ; les CHECK ≥ 0 et les clamps `GREATEST(0,…)` masquent la dérive au lieu de la signaler.
2. **Montants client-driven** : remboursements (V2), coûts unitaires des pertes/décisions (`unitCost` du front), `amountPaid` livraison (V8) — le serveur doit re-résoudre systématiquement depuis ses propres tables.
3. **Gardes d'état manquantes** : réception réassort (A1), submit de caisse (C5), décisions d'invendus (N3), livraison de commande (V10) — le pattern commun est l'absence de `WHERE status=…` dans l'UPDATE ou de contrainte DB, avec commit des effets de bord malgré le no-op.
4. **Double saisie structurelle** : invendus (POS + recon), approvisionné (réceptions + recon), CA (POS + saisie manuelle) — chaque doublon est une source d'écart « inexpliqué » de plus.
5. **Le pattern advisory-lock-hors-transaction** (A3) est le même piège que les collisions de numéros déjà vues sur les BC (cf. AUDIT_FONCTIONNEL) : tout `pg_advisory_xact_lock` doit s'exécuter sur le client de la transaction, jamais sur le pool.

---

## 6. Plan d'action priorisé

| Prio | Actions | Pourquoi |
|---|---|---|
| **P0 — avant toute utilisation** | N1 (migration étendant les CHECK à `retour_stock`), N2 (inverser la condition `discrepancy > 0` dans POSPage) | Fermeture de caisse **bloquée** dès le premier cas réel |
| **P0 — avant mise en prod POS** | V2 + V6 (Zod sur `/returns`, remboursement recalculé serveur, scope magasin), C1 (garde-fou anti-double-comptage POS/manuel dans `getRegister`, même règle que le ledger) | Fraude directe ; Solde Cash faux dès le jour 1 |
| **P1** | V1 (colonnes manquantes de `findTopSelling`), C2/C4 (modèle flux `actual_amount − opening_amount`), V3/V4 (échanges) | Ventes à ~0 DH ; cause racine du Solde Cash (mig 237) ; caisse fausse à chaque échange |
| **P2** | Gardes d'état + contraintes DB : A1, C5, N3, V10 (idempotence, `AND status='open'`, index unique partiel session ouverte, unique `(session_id, product_id)`) | Intégrité sous concurrence et retry |
| **P3** | Miroir lots sur les 4 chemins manquants (V9, N4, A9), N5 (répercuter l'écart approuvé sur le stock), V7 (ledger sur `markPaid`) | Traçabilité HACCP/ONSSA, compta complète |
| **P4** | Ponts recon (invendus + appro auto-alimentés), A4 (retirer le code de démo aléatoire), N7 (gardes de comptage réelles), UX billet rapide/saisie libre du montant | Réduction des doubles saisies et des écarts artificiels |
