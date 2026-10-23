# Référentiel de capacités — Module Achats (procure-to-pay) façon Oracle NetSuite

**Objet** : inventaire des capacités du module Achats de NetSuite (Purchase Requisitions, Purchase Orders, Receiving, Vendor Bills, approbations SuiteFlow, Vendor Prepayments, Vendor Return Authorizations, Landed Cost, Inbound Shipment) pour servir de grille de référence à la refonte du module Achats d'un ERP interne de boulangerie-pâtisserie (Maroc, ~40 fournisseurs, ~300 BC/an, matières en sacs/cartons/bidons converties en kg/L, consommables d'emballage, charges).

**Lecteur cible** : développeur Oracle Forms / PL/SQL. Les analogies Oracle (EBS Purchasing, tables PO_HEADERS_ALL / PO_LINES_ALL / RCV_TRANSACTIONS, AP_INVOICES) sont données quand elles éclairent le modèle.

**Date** : 2026-10-11.

**Méthode et niveau de confiance** : vérification web effectuée (aide en ligne Oracle NetSuite + articles de partenaires). Les points marqués **[vérifié]** sont confirmés par la documentation Oracle (docs.oracle.com/en/cloud/saas/netsuite) ou plusieurs sources concordantes ; les points marqués **[confiance moyenne]** reposent sur la connaissance générale du produit ou sur des sources de partenaires/communauté ; **[faible]** = extrapolation. Les natifs NetSuite sont distingués des add-ons SuiteApp (SquareWorks, etc.) quand c'est pertinent.

**Niveaux** :
- **Socle** : indispensable, sans quoi la chaîne BC → réception → facture → paiement ne tient pas.
- **Standard** : attendu d'un ERP sérieux, à livrer dans la refonte.
- **Avancé** : différenciant ou lié à des volumes/contextes plus gros ; à juger au cas par cas pour 300 BC/an.

Chaque capacité porte un identifiant stable `Dx.n` pour être référencée dans les plans de refonte.

---

## Vue d'ensemble de la chaîne NetSuite

```
Purchase Requisition ──(approval)──► Purchase Order ──(approval)──► Item Receipt ──► Vendor Bill ──(approval)──► Bill Payment
      (demande)                         (BC)                      (réception)       (facture)                   (règlement)
                                          │                           │                 ▲
                                          │                           └── Landed Cost ──┘  (frais d'approche)
                                          ├── Vendor Prepayment ─────────────────────────► appliqué à la facture
                                          └── Vendor Return Authorization ──► Item Fulfillment ──► Vendor Credit
Inbound Shipment (conteneur / lot de BC) ──► Item Receipt(s)
```

Principes structurants de NetSuite à retenir :

1. **Une transaction = un en-tête + des lignes + un impact GL généré automatiquement.** Les transactions sont *posting* (réception, facture, paiement) ou *non-posting* (demande, BC, VRA). Analogie Oracle : table `TRANSACTION` + `TRANSACTION_LINE` + `TRANSACTION_ACCOUNTING_LINE`, soit un journal rattaché à la pièce source.
2. **Chaînage par « transform »** : chaque pièce aval se crée *depuis* la pièce amont (bouton « Receive », « Bill », « Create PO ») et copie les lignes avec un lien `createdfrom` + `orderline`. Le reste à recevoir / à facturer se calcule par différence sur ces liens. Jamais de ressaisie libre.
3. **Statuts dérivés** : le statut du BC (Pending Approval → Pending Receipt → Partially Received → Pending Billing/Partially Received → Pending Bill → Fully Billed → Closed) est calculé à partir des quantités reçues/facturées, pas saisi.
4. **Compte d'attente « Accrued Purchases »** (reçu non facturé) : la réception débite le stock et crédite un compte de régularisation ; la facture débite ce compte et crédite le fournisseur. L'écart éventuel passe par un « bill variance ».
5. **Workflow externalisé** : les approbations ne sont pas codées dans les transactions mais dans SuiteFlow (moteur d'états déclaratif) ou, à défaut, une approbation simple « superviseur + plafond ».

---

## D1 — Référentiel fournisseurs & données d'achat

| ID | Capacité | Description précise | Pourquoi c'est important | Niveau | Confiance |
|---|---|---|---|---|---|
| D1.1 | Fiche fournisseur (Vendor record) | Entité avec raison sociale, catégorie fournisseur, devise principale (+ devises secondaires en multi-devises), conditions de paiement par défaut (`terms`), **limite de crédit**, compte fournisseur par défaut (payables account), compte de charge par défaut, mode de paiement, statut inactif, pièces jointes, notes. Identifiants fiscaux (`taxidnum`/VAT reg., 1099 US) et numéro de compte client chez le fournisseur (`accountnumber`). | Toute la chaîne hérite de la fiche : conditions, compte, TVA. Au Maroc : ICE, IF, RC, patente, TP à stocker pour les factures et les déclarations. | Socle | vérifié |
| D1.2 | Adresses & contacts multiples | Carnet d'adresses (facturation, livraison, retours) avec adresse par défaut ; contacts rattachés avec rôle. | Les BC et VRA pointent vers une adresse précise ; les relances vers un contact. | Socle | vérifié |
| D1.3 | Conditions de paiement (Terms) | Référentiel `terms` : jours nets, escompte (% + jours), « date du mois », fin de mois. Appliqué à la facture pour calculer `duedate` et `discountdate`. | Pilote l'échéancier AP, l'aging et les escomptes. | Socle | vérifié |
| D1.4 | Article achetable (Item) avec paramètres achats | Sur l'article : unité d'achat ≠ unité de stock (**Units of Measure** : type d'unité avec facteurs de conversion, ex. sac 25 kg → kg), prix d'achat de référence (`cost`/`purchaseprice`), compte COGS/charge, compte d'actif stock, code taxe achat, `Track Landed Cost`, suivi lot/série, délai (lead time), stock de sécurité, point de commande. | C'est l'équivalent de votre `ingredients` + `packaging_items` : la conversion sac/carton/bidon → kg/L est **portée par l'article**, pas par la ligne. | Socle | vérifié |
| D1.5 | Fournisseurs multiples par article (Multiple Vendors) | Sous-onglet « Vendors » de l'article : liste de fournisseurs avec **code article fournisseur**, prix d'achat par fournisseur et par devise, fournisseur préféré (`preferredvendor`), sous-type d'unité d'achat. | Permet de pré-remplir le prix et la référence fournisseur sur la ligne de BC et de comparer les fournisseurs. | Standard | vérifié |
| D1.6 | Tarifs d'achat / contrats de prix (Purchase Contracts) | Transaction « Purchase Contract » (feature Purchase Contracts) : prix négocié par article pour une période, quantité/montant engagé, remises par palier (`Vendor Price Levels` dans certains setups). Les BC qui référencent le contrat héritent du prix et consomment l'engagement. | Fige un prix négocié (farine, beurre) et détecte les écarts prix facturés vs négociés. | Avancé | confiance moyenne |
| D1.7 | Approbation/activation du fournisseur | Fournisseur « inactif » bloqué en saisie ; via workflow, statut d'homologation (nouveau → validé → suspendu). Pas natif comme « vendor onboarding », se fait en custom field + SuiteFlow. | Évite de commander chez un fournisseur non référencé ou en litige. | Standard | confiance moyenne |
| D1.8 | Catégories et segments analytiques | Catégorie fournisseur ; sur les lignes : département, classe, localisation, segments personnalisés — hérités dans tout le flux pour l'analytique. | Vos « catégories de charges » et « familles d'économat » jouent ce rôle. | Standard | vérifié |
| D1.9 | Historique prix d'achat (Last Purchase Price) | `lastpurchaseprice` mis à jour automatiquement à chaque réception/facture ; coût moyen (average cost) recalculé selon la méthode de valorisation de l'article. | Détection de la dérive des prix, base pour le coût de revient des recettes. | Standard | vérifié |
| D1.10 | Pièces jointes & conformité | Fichiers (contrats, certificats sanitaires, fiches techniques) attachés à la fiche ; dates d'expiration en champs custom. | Traçabilité réglementaire (ONSSA au Maroc : agréments, fiches d'analyses). | Standard | confiance moyenne |

### Patterns PostgreSQL réutilisables (D1)

```sql
-- Identifiants fiscaux : colonnes nommées plutôt qu'un JSON, car ils sont imprimés et contrôlés
ALTER TABLE suppliers
  ADD COLUMN ice            text,            -- 15 chiffres
  ADD COLUMN identifiant_fiscal text,
  ADD COLUMN rc             text,
  ADD COLUMN patente        text,
  ADD COLUMN payment_terms_id int REFERENCES payment_terms(id),
  ADD COLUMN credit_limit   numeric(14,2),
  ADD COLUMN default_expense_account_id int REFERENCES accounts(id),
  ADD COLUMN is_active      boolean NOT NULL DEFAULT true;

-- Conditions de paiement (équivalent AP_TERMS)
CREATE TABLE payment_terms (
  id serial PRIMARY KEY,
  code text UNIQUE NOT NULL,            -- 'NET30', 'FDM45', 'COMPTANT'
  days_due int NOT NULL DEFAULT 0,
  end_of_month boolean NOT NULL DEFAULT false,
  day_of_month_due int,                 -- ex. le 10 du mois suivant
  discount_pct numeric(5,2),
  discount_days int
);

-- Fournisseur × article : référence et prix par fournisseur (équivalent sous-onglet Vendors)
CREATE TABLE supplier_items (
  id serial PRIMARY KEY,
  supplier_id int NOT NULL REFERENCES suppliers(id),
  purchasable_kind text NOT NULL,       -- 'ingredient' | 'packaging' (cf. fn_purchasable_kind)
  purchasable_id int NOT NULL,
  supplier_sku text,
  purchase_uom text,                    -- 'sac', 'carton', 'bidon'
  qty_per_uom numeric(12,4),            -- 25 (kg par sac) — redondant avec l'article, surchargeable
  unit_price numeric(14,4),             -- prix par UOM d'achat
  currency char(3) NOT NULL DEFAULT 'MAD',
  is_preferred boolean NOT NULL DEFAULT false,
  valid_from date, valid_to date,
  UNIQUE (supplier_id, purchasable_kind, purchasable_id, valid_from)
);
-- un seul préféré par article
CREATE UNIQUE INDEX supplier_items_one_preferred
  ON supplier_items (purchasable_kind, purchasable_id) WHERE is_preferred;
```

Analogie Oracle : `supplier_items` ≈ `PO_APPROVED_SUPPLIER_LIST` + `PO_ASL_ATTRIBUTES` ; `payment_terms` ≈ `AP_TERMS`.

---

## D2 — Besoins & demandes d'achat

| ID | Capacité | Description précise | Pourquoi c'est important | Niveau | Confiance |
|---|---|---|---|---|---|
| D2.1 | Demande d'achat (Purchase Requisition) | Transaction non-posting saisie par un demandeur (employé) : lignes article ou dépense libre, quantité, prix estimé, fournisseur suggéré, date de besoin, département/classe/localisation, justification. Statuts : Pending Approval → Approved → Rejected → (Partially) Ordered → Closed. | Sépare le *besoin* (production, boutique) de l'*acte d'achat* (acheteur). Vos `purchase_requests` jouent ce rôle. | Socle | vérifié |
| D2.2 | Conversion demande → BC (Order Requisitions) | Écran « Order Requisitions » : regroupe les lignes approuvées par fournisseur, l'acheteur affecte/modifie le fournisseur et crée un ou plusieurs BC ; chaque ligne garde `createdfrom` et la quantité commandée ; une demande peut alimenter N BC et un BC peut consolider N demandes. | Consolidation des petits besoins quotidiens en un BC hebdo par fournisseur (gros levier pour 40 fournisseurs). | Socle | vérifié |
| D2.3 | Réapprovisionnement automatique (Reorder Point / Demand Planning) | Sur article : point de commande, stock de sécurité, quantité préférée ; écran **Order Items** liste les articles sous le point de commande et génère les BC. Module Demand Planning (avancé) : prévisions à partir de l'historique de consommation/ventes, génération de « supply plan » puis BC. | Chez vous : les besoins viennent du plan de production (BSI) + minima d'économat. Le pattern « proposition de commande » à valider est le bon. | Standard | vérifié |
| D2.4 | Demande d'achat depuis la production (Special Order / Work Order) | Lignes de bon de travail marquées « special order » créent une demande/BC liée ; en WIP, les composants manquants remontent en besoins. | Lien plan de production → besoin net → BC. Vous l'avez déjà partiellement (plan confirmé → besoins). | Standard | confiance moyenne |
| D2.5 | Statut de couverture par ligne | Chaque ligne de demande connaît : quantité demandée, commandée (via BC), reçue (par transitivité), restante ; clôture manuelle possible (`isclosed`) pour les reliquats. | Votre statut `received` (mig 271) va dans ce sens ; il faut le calculer par **ligne** et non par entête. | Socle | vérifié |
| D2.6 | Budget check à la demande | Pas natif strict en NetSuite standard (le contrôle budgétaire est en reporting Budget vs Actual) ; souvent ajouté par workflow qui compare le cumul engagé (BC ouverts + factures) au budget du département. | Pour une boulangerie : plafond mensuel par catégorie (emballage, charges). | Avancé | confiance moyenne |

### Patterns PostgreSQL (D2)

```sql
-- Couverture d'une ligne de demande par les lignes de BC (jamais stocker "qty_ordered" en dur)
CREATE VIEW v_purchase_request_line_coverage AS
SELECT prl.id AS request_line_id,
       prl.quantity                                   AS qty_requested,
       COALESCE(SUM(pol.quantity), 0)                 AS qty_ordered,
       COALESCE(SUM(pol.quantity_received), 0)        AS qty_received,
       GREATEST(prl.quantity - COALESCE(SUM(pol.quantity),0), 0)::numeric AS qty_open,
       CASE WHEN prl.closed_at IS NOT NULL THEN 'closed'
            WHEN COALESCE(SUM(pol.quantity),0) = 0   THEN 'pending'
            WHEN COALESCE(SUM(pol.quantity),0) < prl.quantity THEN 'partially_ordered'
            ELSE 'ordered' END AS coverage_status
FROM purchase_request_lines prl
LEFT JOIN purchase_order_lines pol ON pol.request_line_id = prl.id
                                  AND pol.status <> 'cancelled'
GROUP BY prl.id;
```

Analogie Oracle : `PO_REQUISITION_LINES_ALL.LINE_LOCATION_ID` → `PO_LINE_LOCATIONS_ALL` ; le statut de la requisition est dérivé, exactement comme ici.

---

## D3 — Sourcing & approbation

| ID | Capacité | Description précise | Pourquoi c'est important | Niveau | Confiance |
|---|---|---|---|---|---|
| D3.1 | Approbation simple (Approval Routing basique) | Préférence « Purchase Orders / Requisitions require approval » : un BC au-dessus de la **limite d'achat** de l'employé (`purchaseorderlimit`, `purchaseorderapprovallimit`) remonte au **superviseur** de l'employé ; l'approbateur a lui-même une limite d'approbation, sinon ça remonte encore. | Hiérarchie d'approbation en 3 champs sur l'employé, sans moteur de workflow. Suffisant pour une PME. | Socle | vérifié |
| D3.2 | Workflow d'approbation SuiteFlow (routing par montant/département) | Moteur d'états déclaratif : états (Pending Approval, Approved, Rejected), transitions conditionnelles sur montant, département, classe, type d'article, fournisseur ; actions (envoyer e-mail, créer tâche, verrouiller champs, bouton Approve/Reject). Approbations multi-niveaux et parallèles. Journal des approbations (qui, quand, commentaire). | Externaliser les règles dans une table paramétrable : « BC ≥ 20 000 MAD → gérant », « emballage → responsable boutique ». | Standard | vérifié |
| D3.3 | Verrouillage après approbation | Après approbation, les champs monétaires sont verrouillés ; une modification significative remet la pièce en « Pending Approval » (comportement configurable via workflow). | Évite d'approuver 5 000 MAD puis de passer à 15 000. | Standard | vérifié |
| D3.4 | Délégation / approbation par e-mail et mobile | Centre d'approbation, approbation depuis l'e-mail (lien), app mobile ; délégation à un suppléant pendant une absence (via workflow). | Le gérant approuve depuis son téléphone ; sinon la chaîne bloque. | Standard | confiance moyenne |
| D3.5 | Comparaison de devis / RFQ | **Pas natif** dans NetSuite standard (pas de transaction RFQ). Pratique courante : plusieurs demandes « quote » en custom record ou SuiteApp de sourcing. | À 40 fournisseurs, une comparaison simple de 2-3 prix par article (table `supplier_items` + historique) suffit. | Avancé | vérifié (absence) |
| D3.6 | BC cadre / Blanket Purchase Order | Transaction **Blanket Purchase Order** (feature) : fournisseur, période de validité, lignes avec quantité et prix fermes ; les BC « release » référencent le blanket et en consomment la quantité ; suivi du reste à appeler ; génération planifiée de BC. | Farine, sucre, emballages : prix fixé au trimestre, appels de livraison hebdos. | Avancé | vérifié |
| D3.7 | Règles d'approbation des factures (Bill Approval) | Même mécanisme que les BC appliqué aux Vendor Bills : préférence « Vendor Bills require approval », workflow par montant, par écart avec le BC, par fournisseur. | Contrôle de la dépense avant paiement, surtout pour les charges sans BC. | Standard | vérifié |

### Patterns PostgreSQL (D3)

```sql
-- Règles de routage paramétrables (pas de if/else en dur)
CREATE TABLE approval_rules (
  id serial PRIMARY KEY,
  document_type text NOT NULL,          -- 'purchase_request' | 'purchase_order' | 'supplier_invoice'
  min_amount numeric(14,2) NOT NULL DEFAULT 0,
  max_amount numeric(14,2),             -- NULL = sans plafond
  category_root_id int REFERENCES expense_categories(id),  -- NULL = toutes
  store_id int,                         -- NULL = tous
  step_no int NOT NULL,                 -- 1 = premier approbateur, 2 = second...
  approver_role text,                   -- 'gerant', 'resp_boutique'
  approver_user_id int REFERENCES users(id),
  is_active boolean NOT NULL DEFAULT true
);

-- Journal des approbations (un état = une ligne ; l'état courant est le MAX)
CREATE TABLE approval_events (
  id bigserial PRIMARY KEY,
  document_type text NOT NULL,
  document_id int NOT NULL,
  step_no int NOT NULL,
  action text NOT NULL CHECK (action IN ('submitted','approved','rejected','reset','delegated')),
  acted_by int NOT NULL REFERENCES users(id),
  acted_at timestamptz NOT NULL DEFAULT now(),
  comment text,
  snapshot_amount numeric(14,2)         -- montant au moment de l'action (verrou D3.3)
);
CREATE INDEX ON approval_events (document_type, document_id, acted_at DESC);
```

Analogie Oracle : `approval_rules` ≈ AME (Approvals Management Engine) rules ; `approval_events` ≈ `PO_ACTION_HISTORY`. Pour le déclencheur « modification après approbation », un trigger `BEFORE UPDATE` compare `NEW.total` à `snapshot_amount` du dernier `approved` et repasse en `pending_approval` si écart > tolérance.

---

## D4 — Commande (bon de commande)

| ID | Capacité | Description précise | Pourquoi c'est important | Niveau | Confiance |
|---|---|---|---|---|---|
| D4.1 | Bon de commande (Purchase Order) | Transaction non-posting : fournisseur, date, date de livraison attendue, adresse de livraison (location), conditions, devise/taux, lignes **article** (quantité en unité d'achat, taux, montant, code taxe, date attendue par ligne) et lignes **dépense** (compte de charge, montant, mémo) sur deux sous-onglets distincts. Numérotation automatique. | Pièce centrale. La dualité « lignes article / lignes dépense » couvre vos ingrédients/emballages ET vos charges (électricité, maintenance). | Socle | vérifié |
| D4.2 | Unités d'achat et conversion | La ligne porte l'unité (sac 25 kg) et la quantité en cette unité ; le stock est mouvementé en unité de base via le facteur du type d'unité ; le prix s'exprime par unité d'achat. | C'est exactement votre besoin « sacs/cartons/bidons → kg/L ». Toujours stocker les deux : qty_uom + qty_base (snapshot du facteur). | Socle | vérifié |
| D4.3 | Statuts dérivés du BC | Pending Supervisor Approval → Pending Receipt → Partially Received → Pending Billing/Partially Received → Pending Bill → Fully Billed → Closed/Cancelled ; calculés d'après `quantityreceived` / `quantitybilled` des lignes. | Jamais de statut saisi à la main ; les tableaux de bord (reste à recevoir, reçu non facturé) en découlent. | Socle | vérifié |
| D4.4 | Clôture de ligne / de BC | Case `Closed` par ligne : ferme le reliquat non reçu sans le supprimer ; clôture du BC entier ; réouverture possible si période ouverte. | Reliquats de 2 cartons jamais livrés : les fermer plutôt que les laisser « en attente » éternellement. | Socle | vérifié |
| D4.5 | Impression / envoi | PDF via template (Advanced PDF/HTML), envoi e-mail au contact fournisseur avec journal d'envoi, impression en lot. | Vous l'avez (PDF BC avec logo). Ajouter la trace « envoyé le / à ». | Socle | vérifié |
| D4.6 | Modification et versions | Modification libre tant que non reçu ; après réception partielle, les lignes reçues sont verrouillées en quantité ; historique système (System Notes) de chaque champ modifié. | Audit : qui a changé le prix après envoi au fournisseur ? | Standard | vérifié |
| D4.7 | Drop ship / Special order | Commande expédiée directement du fournisseur au client ; liée à une commande client. | Peu pertinent pour une boulangerie (sauf sous-traitance événementielle). | Avancé | vérifié |
| D4.8 | Multi-devises & taux | Devise du fournisseur, taux de change figé sur la pièce, écart de change à la facture/paiement. | Import d'équipements ou matières (chocolat, fruits secs) en EUR/USD. | Avancé | vérifié |
| D4.9 | Taxes sur BC | Code taxe par ligne (TVA 20 %, 14 %, 10 %, 7 %, exonéré) ; totaux HT/TVA/TTC calculés ; par défaut depuis l'article puis le fournisseur. | Vous êtes déjà en TVA par ligne (mig 189). Le BC doit l'anticiper pour que la facture rapproche HT **et** TVA. | Socle | vérifié |
| D4.10 | Dates attendues et relances | `expectedreceiptdate` par ligne ; recherche sauvegardée « BC en retard » ; rappels par workflow. | Pour les matières périssables, savoir quoi relancer chaque matin. | Standard | vérifié |

### Patterns PostgreSQL (D4)

```sql
CREATE TABLE purchase_order_lines (
  id serial PRIMARY KEY,
  purchase_order_id int NOT NULL REFERENCES purchase_orders(id),
  line_no int NOT NULL,
  line_kind text NOT NULL CHECK (line_kind IN ('item','expense')),
  purchasable_kind text,                 -- 'ingredient' | 'packaging' (NULL si expense)
  purchasable_id int,
  expense_account_id int,                -- si line_kind = 'expense'
  category_id int REFERENCES expense_categories(id),
  request_line_id int REFERENCES purchase_request_lines(id),
  blanket_line_id int REFERENCES blanket_order_lines(id),
  -- quantités : toujours les deux
  purchase_uom text,                     -- 'sac'
  qty_uom numeric(12,3) NOT NULL,        -- 10 sacs
  factor_to_base numeric(14,6) NOT NULL DEFAULT 1,  -- 25 kg/sac, figé à la commande
  qty_base numeric(14,4) GENERATED ALWAYS AS (qty_uom * factor_to_base) STORED,
  unit_price_uom numeric(14,4) NOT NULL, -- prix par sac
  tax_rate numeric(5,2) NOT NULL DEFAULT 20,
  amount_ht numeric(14,2) GENERATED ALWAYS AS (round(qty_uom * unit_price_uom, 2)) STORED,
  expected_date date,
  is_closed boolean NOT NULL DEFAULT false,
  closed_reason text,
  UNIQUE (purchase_order_id, line_no)
);

-- Statut dérivé du BC : fonction, pas colonne saisie
CREATE OR REPLACE FUNCTION fn_po_status(p_po_id int) RETURNS text LANGUAGE sql STABLE AS $$
  WITH l AS (
    SELECT pol.qty_uom,
           COALESCE(r.qty, 0) AS qty_received,
           COALESCE(b.qty, 0) AS qty_billed,
           pol.is_closed
    FROM purchase_order_lines pol
    LEFT JOIN LATERAL (SELECT SUM(qty_uom) qty FROM goods_receipt_lines WHERE po_line_id = pol.id) r ON true
    LEFT JOIN LATERAL (SELECT SUM(qty_uom) qty FROM supplier_invoice_lines WHERE po_line_id = pol.id) b ON true
    WHERE pol.purchase_order_id = p_po_id
  )
  SELECT CASE
    WHEN (SELECT approval_status FROM purchase_orders WHERE id = p_po_id) <> 'approved' THEN 'pending_approval'
    WHEN bool_and(is_closed OR qty_received >= qty_uom) AND bool_and(is_closed OR qty_billed >= qty_uom) THEN 'fully_billed'
    WHEN bool_and(is_closed OR qty_received >= qty_uom) THEN 'pending_bill'
    WHEN bool_or(qty_received > 0) AND bool_or(qty_billed > 0) THEN 'partially_received_partially_billed'
    WHEN bool_or(qty_received > 0) THEN 'partially_received'
    ELSE 'pending_receipt' END
  FROM l;
$$;
```

Analogie Oracle : `PO_LINE_LOCATIONS_ALL.QUANTITY_RECEIVED / QUANTITY_BILLED` et `CLOSED_CODE` ; `fn_po_status` remplace le `PO_DOCUMENT_STATUS` recalculé par le concurrent program.

---

## D5 — Réception & qualité

| ID | Capacité | Description précise | Pourquoi c'est important | Niveau | Confiance |
|---|---|---|---|---|---|
| D5.1 | Réception depuis BC (Item Receipt) | Transaction posting créée par « Receive » sur le BC : pré-remplit le reste à recevoir par ligne ; l'utilisateur ajuste quantités, coche les lignes reçues, saisit la date de réception et la localisation. Comptabilité : Dr Stock / Cr Accrued Purchases (reçu non facturé) au prix du BC. | Fait entrer le stock **au moment physique**, indépendamment de la facture qui arrive plus tard. | Socle | vérifié |
| D5.2 | Réception partielle et multiple | N réceptions par BC ; chaque réception référence `orderline` ; reste à recevoir recalculé ; sur-réception autorisée ou bloquée selon préférence (tolérance). | Livraisons fractionnées de farine ; sur-livraison de 1 sac. | Socle | vérifié |
| D5.3 | Lots, numéros de série, DLC | Pour articles lot-tracked : saisie obligatoire **numéro de lot + quantité + date d'expiration** par ligne de réception (sous-fenêtre « Inventory Detail ») ; une ligne peut se répartir sur plusieurs lots ; mode « Bin » optionnel. | Traçabilité sanitaire : d'où vient le beurre du lot X ? Rappel produit. Vous avez `ingredient_lots` : la réception doit **créer** le lot avec DLC (audit W : DLC inerte). | Socle | vérifié |
| D5.4 | Réception en unité d'achat | Quantité reçue saisie en unité d'achat (sacs) avec conversion automatique en base ; possibilité de saisir en unité de base si l'emballage est ouvert/incomplet. | Le magasinier compte des sacs, pas des kg (cf. votre « saisie par contenant », mig 226). | Socle | vérifié |
| D5.5 | Contrôle qualité à réception (Quality Management) | Module Quality Management (SuiteApp Oracle) : plans d'inspection par article/fournisseur, échantillonnage, résultats pass/fail, mise en **quarantaine** (statut d'inventaire « Inventory Status » non disponible) jusqu'à libération. Sans le module : statut d'inventaire manuel (Quarantine / Available) via feature Inventory Status. | Température à l'arrivée des produits frais, aspect, DLC minimale acceptée ; refus de lot. | Avancé | vérifié |
| D5.6 | Statut d'inventaire (Inventory Status) | Feature : chaque quantité en stock porte un statut (Good, Damaged, Quarantine…) ; les statuts « non disponibles » excluent du stock engageable ; changement par transaction « Inventory Status Change ». | Séparer « reçu mais non contrôlé » de « disponible pour la production ». | Standard | vérifié |
| D5.7 | Réception sans BC | Possible via ajustement de stock ou facture directe avec lignes article (la facture fait entrer le stock). NetSuite décourage les réceptions orphelines. | Garder une porte étroite : un achat au souk sans BC passe par « facture directe » tracée, pas par ajustement de stock. | Standard | vérifié |
| D5.8 | Retour fournisseur (Vendor Return Authorization) | Transaction non-posting VRA : lignes à retourner (depuis la facture ou libre), motif, statut Pending Approval → Pending Return → Partially Returned → Pending Credit → Closed ; **expédition** du retour (Item Fulfillment) sort le stock ; **avoir fournisseur** (Vendor Credit) créé depuis la VRA solde la créance. Nécessite Advanced Shipping + VRA features. | Sacs de farine infestés, emballages non conformes : sortie de stock + avoir, tracés jusqu'à la facture d'origine. | Standard | vérifié |
| D5.9 | Expédition entrante (Inbound Shipment) | Transaction regroupant les lignes de plusieurs BC d'un même conteneur/transport : n° de connaissement, dates (expédition prévue, arrivée prévue/réelle), statut (To Be Shipped → In Transit → Partially Received → Received), coûts d'approche saisis au niveau du shipment et ventilés sur les réceptions créées depuis le shipment. | Pertinent uniquement pour vos imports (chocolat, matériel). Pour le local : inutile. | Avancé | vérifié |
| D5.10 | Documents de réception | Bon de livraison fournisseur numérisé attaché, numéro de BL fournisseur sur la réception, signature du réceptionnaire. | Le BL est la pièce de rapprochement en cas de litige quantités. | Standard | confiance moyenne |
| D5.11 | Annulation / correction de réception | Suppression ou modification de la réception si période ouverte et si non facturée ; sinon ajustement inverse. Journal système. | Erreur de saisie 10 sacs au lieu de 1. | Socle | vérifié |

### Patterns PostgreSQL (D5)

```sql
CREATE TABLE goods_receipts (
  id serial PRIMARY KEY,
  purchase_order_id int REFERENCES purchase_orders(id),
  supplier_id int NOT NULL REFERENCES suppliers(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by int NOT NULL REFERENCES users(id),
  supplier_delivery_note text,            -- n° BL fournisseur
  store_id int NOT NULL,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','reversed')),
  reversed_by_id int REFERENCES goods_receipts(id)
);

CREATE TABLE goods_receipt_lines (
  id serial PRIMARY KEY,
  goods_receipt_id int NOT NULL REFERENCES goods_receipts(id),
  po_line_id int REFERENCES purchase_order_lines(id),
  purchasable_kind text NOT NULL, purchasable_id int NOT NULL,
  qty_uom numeric(12,3) NOT NULL,
  factor_to_base numeric(14,6) NOT NULL,
  qty_base numeric(14,4) GENERATED ALWAYS AS (qty_uom * factor_to_base) STORED,
  unit_cost_base numeric(14,6) NOT NULL,  -- coût BC converti en /kg, base de l'accrual
  quality_status text NOT NULL DEFAULT 'available'
    CHECK (quality_status IN ('available','quarantine','rejected'))
);

-- Détail lots : une ligne de réception → N lots (équivalent Inventory Detail)
CREATE TABLE goods_receipt_lots (
  id serial PRIMARY KEY,
  receipt_line_id int NOT NULL REFERENCES goods_receipt_lines(id),
  lot_id int NOT NULL REFERENCES ingredient_lots(id),   -- créé à la réception
  qty_base numeric(14,4) NOT NULL,
  expiry_date date                                       -- copié sur ingredient_lots.expiry_date
);

-- Garde-fou : somme des lots = quantité de la ligne (trigger CONSTRAINT DEFERRABLE)
CREATE OR REPLACE FUNCTION trg_receipt_lots_sum() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_line numeric; v_lots numeric;
BEGIN
  SELECT qty_base INTO v_line FROM goods_receipt_lines WHERE id = COALESCE(NEW.receipt_line_id, OLD.receipt_line_id);
  SELECT COALESCE(SUM(qty_base),0) INTO v_lots FROM goods_receipt_lots WHERE receipt_line_id = COALESCE(NEW.receipt_line_id, OLD.receipt_line_id);
  IF abs(v_line - v_lots) > 0.0005 THEN
    RAISE EXCEPTION 'Lots (%) <> quantité reçue (%) pour la ligne %', v_lots, v_line, COALESCE(NEW.receipt_line_id, OLD.receipt_line_id);
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER goods_receipt_lots_sum
  AFTER INSERT OR UPDATE OR DELETE ON goods_receipt_lots
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_receipt_lots_sum();
```

Analogie Oracle : `goods_receipts` ≈ `RCV_SHIPMENT_HEADERS`, `goods_receipt_lines` ≈ `RCV_TRANSACTIONS (TRANSACTION_TYPE='RECEIVE')`, `goods_receipt_lots` ≈ `MTL_TRANSACTION_LOT_NUMBERS`. Le retour fournisseur est une `RCV_TRANSACTION` de type `RETURN TO VENDOR` → ici une table `supplier_returns` qui référence la ligne de réception et génère un mouvement de stock négatif + un avoir.

---

## D6 — Facturation & rapprochement

| ID | Capacité | Description précise | Pourquoi c'est important | Niveau | Confiance |
|---|---|---|---|---|---|
| D6.1 | Facture fournisseur depuis BC (Bill from PO) | « Bill » sur le BC : lignes pré-remplies avec les quantités **reçues non facturées** (préférence « Bill in Advance of Receipt » pour facturer avant réception) ; n° de facture fournisseur (`tranid`) unique par fournisseur (contrôle doublon), date facture, date d'échéance calculée par les terms, date de comptabilisation. Comptabilité : Dr Accrued Purchases (ou charge) / Dr TVA déductible / Cr Fournisseur. | Évite la double saisie et la double facture ; lie coût réel au stock reçu. | Socle | vérifié |
| D6.2 | Facture multi-BC / multi-réceptions | Une facture peut consolider plusieurs BC/réceptions du même fournisseur (« Bill Purchase Orders » en lot) ; une réception peut être facturée en plusieurs factures. | Facture mensuelle récapitulative d'un fournisseur local. | Standard | vérifié |
| D6.3 | Rapprochement 3 voies (3-way match) | Natif : la facture créée depuis le BC compare quantité et prix facturés à ceux du BC et de la réception ; l'écart de quantité est bloqué par la règle « ne pas facturer plus que reçu » (sauf préférence) ; l'écart de prix génère une **variance**. Tolérances fines, blocage de paiement automatique, règles par fournisseur = SuiteApps (ex. SquareWorks Automate, Charted) ou workflow custom. | Le cœur du contrôle AP : on ne paie que ce qui a été commandé **et** reçu. | Socle | vérifié (natif simple), SuiteApp pour les tolérances |
| D6.4 | Écarts de facturation (Vendor Bill Variances) | Les différences entre coût de réception (prix BC) et prix facturé sont stockées par ligne ; l'écran **Post Vendor Bill Variances** (par période, par BC) génère les écritures vers les comptes de variance (**Price Variance**, **Quantity Variance**, **Exchange Rate Variance**) définis dans les préférences comptables ou sur l'article. Jusqu'à la comptabilisation, l'accrued purchases porte le résidu. | Sans ce mécanisme, le compte « reçu non facturé » ne se solde jamais. Pour vous : un écart prix peut aussi réévaluer le coût du lot au lieu de passer en charge (choix de gestion). | Standard | vérifié |
| D6.5 | Facture sans BC (dépenses / charges) | Facture directe avec lignes de dépense (compte + montant + segment) ou lignes article (entrée en stock immédiate). Workflow d'approbation plus strict recommandé. | Électricité, loyer, maintenance : vos `invoices` avec catégorie par ligne (mig 194). | Socle | vérifié |
| D6.6 | Avoir fournisseur (Vendor Credit) | Transaction posting symétrique de la facture ; créé depuis la VRA ou libre ; appliqué à une ou plusieurs factures ouvertes ou laissé en crédit disponible ; peut aussi réduire le stock (lignes article) ou la charge (lignes dépense). | Retours, remises de fin d'année, erreurs de facturation. | Socle | vérifié |
| D6.7 | Capture de facture (Bill Capture) | Natif récent : upload PDF/scan ou e-mail → OCR → proposition de facture avec fournisseur, lignes, montants, suggestion de rapprochement avec BC ; validation humaine avant création. | 300 BC/an = plusieurs centaines de factures : l'OCR fait gagner du temps mais n'est pas prioritaire. | Avancé | vérifié |
| D6.8 | Factures récurrentes / mémorisées | Memorized transactions : répéter une facture (loyer, abonnement) à fréquence fixe, avec rappel ou création automatique. | Charges fixes mensuelles. | Standard | vérifié |
| D6.9 | Approbation des factures | Statut Pending Approval → Approved → Rejected ; seule une facture approuvée est payable ; workflow par montant/écart. | Déjà en D3.7 ; rappelé car il conditionne D7. | Standard | vérifié |
| D6.10 | Contrôle TVA à la facture | Codes TVA par ligne ; totaux HT/TVA/TTC ; écart toléré d'arrondi vs facture papier ; TVA non déductible sur certaines charges. | Déclaration de TVA mensuelle au Maroc, TVA déductible conditionnée au paiement (règle de l'encaissement) — à modéliser côté D8. | Socle | vérifié (générique) |
| D6.11 | Blocage de paiement (Payment Hold) | Case `paymenthold` sur la facture : exclut des propositions de paiement ; posée manuellement ou par workflow (écart, litige, document manquant). | Litige sur un lot, facture sans BL : on bloque sans supprimer. | Standard | vérifié |

### Patterns PostgreSQL (D6)

```sql
-- Lien facture ↔ réception ↔ BC au niveau LIGNE (clé du 3-way)
CREATE TABLE supplier_invoice_lines (
  id serial PRIMARY KEY,
  invoice_id int NOT NULL REFERENCES supplier_invoices(id),
  line_kind text NOT NULL CHECK (line_kind IN ('item','expense')),
  po_line_id int REFERENCES purchase_order_lines(id),
  receipt_line_id int REFERENCES goods_receipt_lines(id),     -- NULL si facture avant réception
  purchasable_kind text, purchasable_id int,
  category_id int REFERENCES expense_categories(id),
  qty_uom numeric(12,3), factor_to_base numeric(14,6),
  unit_price_uom numeric(14,4) NOT NULL,
  tax_rate numeric(5,2) NOT NULL,
  amount_ht numeric(14,2) NOT NULL,
  amount_tva numeric(14,2) NOT NULL
);

-- Unicité du numéro de facture par fournisseur (anti-doublon NetSuite)
CREATE UNIQUE INDEX supplier_invoices_no_dup
  ON supplier_invoices (supplier_id, lower(supplier_invoice_number))
  WHERE status <> 'cancelled';

-- Écarts 3-way par ligne (vue, pas table : recalculable)
CREATE VIEW v_invoice_line_variances AS
SELECT sil.id AS invoice_line_id,
       pol.unit_price_uom                       AS po_price,
       sil.unit_price_uom                       AS invoiced_price,
       round((sil.unit_price_uom - pol.unit_price_uom) * sil.qty_uom, 2) AS price_variance,
       sil.qty_uom                              AS qty_invoiced,
       COALESCE(grl.qty_uom, 0)                 AS qty_received,
       sil.qty_uom - COALESCE(grl.qty_uom, 0)   AS qty_variance,
       CASE WHEN abs(sil.unit_price_uom - pol.unit_price_uom) > pol.unit_price_uom * 0.02
              OR sil.qty_uom > COALESCE(grl.qty_uom,0) THEN 'blocked'
            WHEN sil.unit_price_uom <> pol.unit_price_uom THEN 'warning'
            ELSE 'matched' END AS match_status
FROM supplier_invoice_lines sil
JOIN purchase_order_lines pol ON pol.id = sil.po_line_id
LEFT JOIN goods_receipt_lines grl ON grl.id = sil.receipt_line_id;

-- Table de tolérances paramétrables (ce que les SuiteApps vendent)
CREATE TABLE match_tolerances (
  id serial PRIMARY KEY,
  supplier_id int REFERENCES suppliers(id),      -- NULL = défaut global
  price_pct numeric(5,2) NOT NULL DEFAULT 2,
  price_abs numeric(14,2) NOT NULL DEFAULT 20,   -- MAD
  qty_over_pct numeric(5,2) NOT NULL DEFAULT 0,
  action text NOT NULL DEFAULT 'hold' CHECK (action IN ('hold','warn','accept'))
);
```

Analogie Oracle : `AP_INVOICE_LINES_ALL.PO_LINE_LOCATION_ID` + `RCV_TRANSACTION_ID`, `AP_HOLDS_ALL` (holds QTY ORD / PRICE / QTY REC), `AP_TOLERANCE_TEMPLATES`. Les écritures de variance ≈ `PURCHASE PRICE VARIANCE` / `INVOICE PRICE VARIANCE` d'EBS.

---

## D7 — Paiements & trésorerie fournisseurs

| ID | Capacité | Description précise | Pourquoi c'est important | Niveau | Confiance |
|---|---|---|---|---|---|
| D7.1 | Règlement fournisseur (Bill Payment) | Transaction posting : fournisseur, compte bancaire, mode (virement, chèque, espèces, carte), date, montant ; application à une ou plusieurs factures avec montant partiel par facture ; application d'avoirs et d'escomptes dans la même opération. Dr Fournisseur / Cr Banque. | Le lettrage facture ↔ paiement, partiel ou multiple, est la base de l'AP. Vous avez déjà le ledger + `paid_amount` synchronisé. | Socle | vérifié |
| D7.2 | Paiement en lot (Pay Bills) | Écran listant les factures approuvées, échues ou à échoir, filtrables par fournisseur/date/compte ; sélection multiple ; génère N paiements en une fois ; impression de chèques ou fichier de virement. | Campagne de paiement hebdo : 15 fournisseurs d'un coup. | Standard | vérifié |
| D7.3 | Acomptes fournisseurs (Vendor Prepayments) | Feature : transaction **Vendor Prepayment** (sortie de banque vers compte « Prepayment » = créance) liée optionnellement à un BC ; **Vendor Prepayment Application** applique l'acompte à une ou plusieurs factures (manuel) ou **auto-apply** du plus ancien au plus récent quand la facture est créée depuis le BC lié ; solde non appliqué suivi ; même fournisseur/devise/subsidiary requis ; pièce bloquée après application. | Fournisseurs exigeant 30-50 % à la commande (équipement, matières importées, fêtes). Compte 3411 « Fournisseurs débiteurs, avances et acomptes » au PCM. | Standard | vérifié |
| D7.4 | Balance âgée fournisseurs (AP Aging) | Rapport standard : solde par fournisseur réparti en tranches (courant, 1-30, 31-60, 61-90, >90) par date d'échéance ou de facture ; détail ou résumé ; à une date donnée (as-of). | Pilotage de trésorerie et des relations fournisseurs. | Socle | vérifié |
| D7.5 | Échéancier / prévision de décaissement | Recherche sauvegardée sur factures ouvertes par `duedate` ; rapport « Cash Flow » ; escompte à saisir si paiement avant `discountdate`. | Savoir combien sortir cette semaine, la semaine prochaine. | Standard | vérifié |
| D7.6 | Fichiers bancaires / EFT | SuiteApp Electronic Bank Payments : génération de fichiers de virement au format banque, lots, statuts de transmission, rapprochement. | Au Maroc : fichiers de virements de masse selon format bancaire ; souvent fait hors ERP au début. | Avancé | vérifié |
| D7.7 | Annulation / contre-passation de paiement | Void (annule, inverse les écritures) ou suppression si période ouverte ; la facture redevient ouverte. | Chèque perdu, virement rejeté. | Socle | vérifié |
| D7.8 | Lettrage et écarts de règlement | Petit écart toléré passé en charge/produit lors de l'application (write-off) ; écart de change pour devises. | Fournisseur payé 10 000 pour 10 003,50. | Standard | confiance moyenne |
| D7.9 | Limite de crédit et alerte | Avertissement (non bloquant) sur le BC/facture quand l'encours fournisseur dépasse `creditlimit`. | Suivi de l'encours accordé par le fournisseur. | Standard | vérifié |

### Patterns PostgreSQL (D7)

```sql
-- Lettrage N↔N paiements/factures/avoirs/acomptes (équivalent AP_INVOICE_PAYMENTS + applications)
CREATE TABLE ap_applications (
  id bigserial PRIMARY KEY,
  source_type text NOT NULL CHECK (source_type IN ('payment','credit_note','prepayment')),
  source_id int NOT NULL,
  invoice_id int NOT NULL REFERENCES supplier_invoices(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  discount_taken numeric(14,2) NOT NULL DEFAULT 0,
  write_off numeric(14,2) NOT NULL DEFAULT 0,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by int NOT NULL REFERENCES users(id),
  reversed_at timestamptz
);

-- Solde facture = total - applications actives (toujours dérivé, paid_amount = cache)
CREATE VIEW v_supplier_invoice_balance AS
SELECT si.id, si.total_ttc,
       COALESCE(SUM(a.amount + a.discount_taken + a.write_off) FILTER (WHERE a.reversed_at IS NULL), 0) AS applied,
       si.total_ttc - COALESCE(SUM(a.amount + a.discount_taken + a.write_off) FILTER (WHERE a.reversed_at IS NULL), 0) AS balance
FROM supplier_invoices si LEFT JOIN ap_applications a ON a.invoice_id = si.id
GROUP BY si.id;

-- Acomptes : solde non appliqué
CREATE TABLE supplier_prepayments (
  id serial PRIMARY KEY,
  supplier_id int NOT NULL REFERENCES suppliers(id),
  purchase_order_id int REFERENCES purchase_orders(id),  -- optionnel, permet l'auto-apply
  paid_at date NOT NULL, bank_account_id int NOT NULL,
  amount numeric(14,2) NOT NULL,
  ledger_entry_id bigint                                 -- Dr 3411 / Cr 5141
);

-- Aging : tranches calculées à une date donnée
CREATE OR REPLACE FUNCTION fn_ap_aging(p_asof date) RETURNS TABLE
  (supplier_id int, current numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, over_90 numeric)
LANGUAGE sql STABLE AS $$
  SELECT si.supplier_id,
    SUM(b.balance) FILTER (WHERE p_asof <= si.due_date),
    SUM(b.balance) FILTER (WHERE p_asof - si.due_date BETWEEN 1 AND 30),
    SUM(b.balance) FILTER (WHERE p_asof - si.due_date BETWEEN 31 AND 60),
    SUM(b.balance) FILTER (WHERE p_asof - si.due_date BETWEEN 61 AND 90),
    SUM(b.balance) FILTER (WHERE p_asof - si.due_date > 90)
  FROM supplier_invoices si JOIN v_supplier_invoice_balance b ON b.id = si.id
  WHERE si.status = 'posted' AND si.invoice_date <= p_asof AND b.balance > 0
  GROUP BY si.supplier_id;
$$;
```

Remarque : pour un as-of strict (solde tel qu'il était à la date), filtrer aussi `a.applied_at <= p_asof` dans la vue — faire une fonction paramétrée plutôt qu'une vue.

---

## D8 — Comptabilité des achats

| ID | Capacité | Description précise | Pourquoi c'est important | Niveau | Confiance |
|---|---|---|---|---|---|
| D8.1 | Écritures automatiques par transaction | Chaque pièce posting génère ses lignes GL (`TransactionAccountingLine`) de façon déterministe : réception = Dr Stock / Cr Accrued Purchases ; facture article = Dr Accrued Purchases / Dr TVA / Cr 4411 ; facture dépense = Dr Charge / Dr TVA / Cr 4411 ; paiement = Dr 4411 / Cr Banque ; acompte = Dr 3411 / Cr Banque ; application = Dr 4411 / Cr 3411 ; VRA crédit = Dr 4411 / Cr Stock. | Le journal est un **sous-produit** de la pièce, jamais saisi à part ; une pièce = une écriture équilibrée, réversible avec elle. | Socle | vérifié |
| D8.2 | Reçu non facturé (Accrued Purchases) | Compte de passif transitoire alimenté par les réceptions, soldé par les factures ; rapport **Accrued Purchase Receipts** (ou saved search « received not billed ») liste, à une date, les réceptions sans facture avec montant au prix BC ; ne couvre que les articles stockés (les services sont chargés à la facture). | Clôture mensuelle : charge/stock de la période même si la facture arrive le mois suivant. Indispensable pour un coût matière mensuel juste. | Standard | vérifié |
| D8.3 | Variances de facturation | Cf. D6.4 : comptes Price/Quantity/Exchange Rate Variance paramétrés dans Accounting Preferences (« Default Vendor Bill Variance Accounts ») ; écran Post Vendor Bill Variances par période. | Nettoie l'accrued purchases ; isole les dérives de prix en analytique. | Standard | vérifié |
| D8.4 | Valorisation du stock et coût d'entrée | Méthodes : Average, FIFO, LIFO, Standard, Lot Numbered (coût par lot), Specific. La réception entre au prix BC ; la facture ajuste (si Average) ou passe en variance ; les landed costs s'ajoutent au coût d'entrée. | Chez vous : coût par lot (vous avez les lots) ou moyen pondéré par ingrédient pour les recettes. Décider explicitement. | Socle | vérifié |
| D8.5 | Frais d'approche (Landed Cost) | Feature : sur l'article `Track Landed Cost` ; **catégories** de landed cost (fret, douane, assurance…) chacune avec un compte et une **méthode de ventilation** (Quantity, Value, Weight) ; saisie sur l'Item Receipt (montant par catégorie, source = facture tiers ou estimation) ou via Inbound Shipment ; le coût est réparti sur les lignes et **augmente le coût unitaire du stock**. La facture du transporteur se lie ensuite à la réception. | Transport de la farine depuis la minoterie, droits de douane sur chocolat : coût réel au kg, pas seulement le prix facturé. | Avancé | vérifié |
| D8.6 | Périodes comptables et verrous | Périodes ouvertes/fermées ; une pièce dans une période close ne peut être modifiée ; contre-passation dans la période courante. | Protège la clôture et la déclaration TVA déjà déposée. | Socle | vérifié |
| D8.7 | TVA achats et déclaration | Codes taxe, comptes TVA déductible par taux, rapports TVA par période ; régime d'encaissement = TVA déductible à la **date de paiement** (préférence/report spécifiques par pays — pour le Maroc, à construire : la déductibilité suit le règlement). | Déclaration mensuelle de TVA au Maroc : état des déductions basé sur les factures **payées**. | Standard | confiance moyenne |
| D8.8 | Multi-entités / subsidiaries | OneWorld : chaque transaction appartient à une subsidiary ; fournisseurs partagés ou non ; consolidation. | Vous préparez tenants → stores : même logique de cloisonnement par `tenant_id`. | Avancé | vérifié |
| D8.9 | Comptabilisation différée et lots d'écritures | Les écritures sont postées en temps réel ; pas de « batch » à lancer (contrairement à EBS). Les variances et landed costs sont les seules étapes manuelles périodiques. | Simplifie : pas de programme concurrent, mais tout doit être exact à la saisie. | — | vérifié |

### Patterns PostgreSQL (D8)

```sql
-- Journal rattaché à la pièce : (source_type, source_id) + lignes équilibrées
CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  source_type text NOT NULL,     -- 'goods_receipt','supplier_invoice','supplier_payment','prepayment','credit_note','variance','landed_cost'
  source_id int NOT NULL,
  entry_date date NOT NULL,
  period_id int NOT NULL REFERENCES accounting_periods(id),
  reversed_by_id bigint REFERENCES ledger_entries(id),
  UNIQUE (source_type, source_id, reversed_by_id)   -- idempotence : une écriture par pièce
);
CREATE TABLE ledger_lines (
  id bigserial PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  account_code text NOT NULL,            -- '3111','4411','34552','4481' (accrued), '6121', '3411'
  debit numeric(14,2) NOT NULL DEFAULT 0,
  credit numeric(14,2) NOT NULL DEFAULT 0,
  supplier_id int, category_id int, store_id int,
  CHECK (debit = 0 OR credit = 0)
);
-- Équilibre par écriture (CONSTRAINT TRIGGER DEFERRABLE comme en D5)

-- Verrou de période
CREATE OR REPLACE FUNCTION trg_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounting_periods WHERE id = NEW.period_id AND closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Période % close', NEW.period_id;
  END IF; RETURN NEW;
END $$;

-- Reçu non facturé à une date (équivalent Accrued Purchase Receipts)
CREATE OR REPLACE FUNCTION fn_received_not_billed(p_asof date) RETURNS TABLE
  (supplier_id int, receipt_line_id int, qty_open numeric, amount_open numeric)
LANGUAGE sql STABLE AS $$
  SELECT gr.supplier_id, grl.id,
         grl.qty_uom - COALESCE(SUM(sil.qty_uom),0),
         round((grl.qty_uom - COALESCE(SUM(sil.qty_uom),0)) * pol.unit_price_uom, 2)
  FROM goods_receipt_lines grl
  JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id AND gr.received_at::date <= p_asof AND gr.status='posted'
  JOIN purchase_order_lines pol ON pol.id = grl.po_line_id
  LEFT JOIN supplier_invoice_lines sil ON sil.receipt_line_id = grl.id
  LEFT JOIN supplier_invoices si ON si.id = sil.invoice_id AND si.invoice_date <= p_asof AND si.status='posted'
  GROUP BY gr.supplier_id, grl.id, grl.qty_uom, pol.unit_price_uom
  HAVING grl.qty_uom - COALESCE(SUM(sil.qty_uom),0) > 0;
$$;

-- Landed cost : catégories + ventilation figée par ligne de réception
CREATE TABLE landed_cost_categories (
  id serial PRIMARY KEY, code text UNIQUE, label text,
  account_code text NOT NULL,
  allocation_method text NOT NULL CHECK (allocation_method IN ('quantity','value','weight'))
);
CREATE TABLE landed_costs (
  id serial PRIMARY KEY,
  goods_receipt_id int NOT NULL REFERENCES goods_receipts(id),
  category_id int NOT NULL REFERENCES landed_cost_categories(id),
  amount numeric(14,2) NOT NULL,
  source_invoice_id int REFERENCES supplier_invoices(id)   -- facture transporteur
);
CREATE TABLE landed_cost_allocations (
  landed_cost_id int REFERENCES landed_costs(id),
  receipt_line_id int REFERENCES goods_receipt_lines(id),
  amount numeric(14,4) NOT NULL,
  PRIMARY KEY (landed_cost_id, receipt_line_id)
);
-- coût d'entrée du lot = unit_cost_base + SUM(allocations)/qty_base
```

Analogie Oracle : `ledger_entries/ledger_lines` ≈ `GL_JE_HEADERS/GL_JE_LINES` + `XLA_AE_HEADERS` (SLA) avec `source_type/source_id` à la place des `XLA_TRANSACTION_ENTITIES`. `fn_received_not_billed` ≈ rapport « Uninvoiced Receipts » d'EBS / `RCV_RECEIVING_SUB_LEDGER`.

---

## D9 — Pilotage & analytique

| ID | Capacité | Description précise | Pourquoi c'est important | Niveau | Confiance |
|---|---|---|---|---|---|
| D9.1 | Recherches sauvegardées (Saved Searches) | Requêtes paramétrables sur toute transaction : critères, colonnes, formules, regroupements, alertes e-mail planifiées, export CSV, affichage en portlet. Ex. : BC en retard, reçu non facturé, factures à échéance 7 j, écarts prix > 2 %. | Le « rapport ad hoc sans développeur ». Pour vous : vues SQL nommées + un écran générique de liste filtrable. | Standard | vérifié |
| D9.2 | Rapports standards achats/AP | Purchase by Vendor / by Item, Open Purchase Orders, Purchase Order Register, AP Aging, AP Register, Vendor Bill Variances, Accrued Purchase Receipts, Purchases Journal. | Jeu minimal de 8 rapports à reproduire. | Socle | vérifié |
| D9.3 | Tableaux de bord & KPI | Portlets KPI (montant achats période vs N-1, factures en attente d'approbation, BC ouverts), scorecards, graphes, « reminders » (à approuver, à recevoir, à payer). | Vue gérant : quoi approuver aujourd'hui, quoi payer cette semaine, où le coût matière dérive. | Standard | vérifié |
| D9.4 | Analyse prix d'achat | Rapport/recherche : évolution du prix par article et fournisseur (last purchase price, moyenne), écart vs prix standard, écart vs contrat. | Dérive prix farine/beurre = premier levier de marge d'une boulangerie. Vous avez déjà « lien produit + écart prix » (mig 260/261/263). | Standard | vérifié |
| D9.5 | Performance fournisseur | Pas de scorecard natif riche ; construit par saved search : retards (date reçue vs attendue), taux de lignes complètes, retours (VRA) par fournisseur, écarts de facturation. | Choisir qui garder parmi 40 fournisseurs. | Avancé | confiance moyenne |
| D9.6 | Engagements et budget | Rapport Budget vs Actual ; engagements (BC ouverts) non natifs dans le budget → saved search « commitments » par département/période. | Suivre « engagé + réalisé » vs budget emballage mensuel. | Avancé | confiance moyenne |
| D9.7 | Analytique multi-axes | Département, classe, localisation, segments custom sur chaque ligne ; SuiteAnalytics Workbook (datasets, pivots) pour l'analyse croisée. | Achats par boutique × catégorie × mois. | Standard | vérifié |
| D9.8 | Alertes et rappels | Reminders de page d'accueil (« 3 BC à approuver »), e-mails planifiés de saved search, notifications de workflow. | Vous avez `NotificationBell` + `PaymentAlertsWidget` : brancher les événements achats. | Standard | vérifié |

### Patterns PostgreSQL (D9)

- Une **vue SQL par KPI** nommée `kpi_*` (ex. `kpi_open_po_amount`, `kpi_received_not_billed`, `kpi_invoices_due_7d`, `kpi_price_drift_30d`) ; le dashboard ne fait que `SELECT`.
- Un **catalogue de rapports** : table `report_definitions (code, label, sql_view, params jsonb, default_sort)` + un écran de liste générique (filtres, colonnes, export CSV) = équivalent des saved searches.
- Vues matérialisées rafraîchies la nuit pour l'historique prix (`mv_purchase_price_history (purchasable, supplier, month, avg_price_base, min, max, qty)`).

```sql
CREATE MATERIALIZED VIEW mv_purchase_price_history AS
SELECT sil.purchasable_kind, sil.purchasable_id, si.supplier_id,
       date_trunc('month', si.invoice_date)::date AS month,
       SUM(sil.amount_ht) / NULLIF(SUM(sil.qty_uom * sil.factor_to_base),0) AS avg_price_base,  -- MAD/kg
       MIN(sil.unit_price_uom / sil.factor_to_base) AS min_price_base,
       MAX(sil.unit_price_uom / sil.factor_to_base) AS max_price_base,
       SUM(sil.qty_uom * sil.factor_to_base) AS qty_base
FROM supplier_invoice_lines sil JOIN supplier_invoices si ON si.id = sil.invoice_id
WHERE sil.line_kind = 'item' AND si.status = 'posted'
GROUP BY 1,2,3,4;
```

---

## D10 — Transverse

| ID | Capacité | Description précise | Pourquoi c'est important | Niveau | Confiance |
|---|---|---|---|---|---|
| D10.1 | Rôles & permissions par transaction | Permission par type de transaction et niveau (View / Create / Edit / Full) ; rôles Purchasing Agent, Receiving, AP Clerk, Approver ; restriction par département/localisation. | Séparation des tâches : qui commande ne réceptionne pas ; qui réceptionne ne paie pas. Votre « Pesage = magasinier strict » va dans ce sens. | Socle | vérifié |
| D10.2 | Journal système (System Notes) & piste d'audit | Chaque modification de champ : ancien/nouveau, qui, quand, contexte (UI, script, import). Non modifiable. | Audits, litiges fournisseurs, QA. Correspond à votre exigence de traçabilité complète. | Socle | vérifié |
| D10.3 | Numérotation automatique | Préfixe + séquence par type de transaction (PO-000123, BILL-…), réinitialisable par période, par subsidiary. | Références stables imprimées sur les documents. | Socle | vérifié |
| D10.4 | Pièces jointes & communication | Fichiers sur toute transaction ; messages e-mail envoyés depuis la pièce et archivés sous « Communication ». | BL scanné sur la réception, facture PDF sur la facture. En Cloud Run éphémère : stockage objet, pas FS (cf. votre mémoire uploads). | Standard | vérifié |
| D10.5 | Champs et enregistrements personnalisés | Custom fields sur en-têtes et lignes ; custom records (ex. « Agrément sanitaire ») ; sourcing/filtrage de valeurs. | Vos `ref_entries` jouent ce rôle. Prévoir `jsonb extra` + table de définition pour les champs non critiques. | Standard | vérifié |
| D10.6 | Import/export CSV & API | Import CSV assisté (fournisseurs, articles, BC, factures) ; SuiteTalk REST/SOAP ; SuiteScript (événements before/after submit = triggers applicatifs). | Reprise des 40 fournisseurs et tarifs ; intégration banque/compta externe. | Standard | vérifié |
| D10.7 | Modèles d'impression | Advanced PDF/HTML Templates (FreeMarker) par type de transaction, par langue ; logo, mentions légales. | BC bilingue FR/AR, mentions ICE/IF obligatoires. | Standard | vérifié |
| D10.8 | Multi-langue / localisation | Interface et libellés traduits ; formats de date/nombre ; pack pays (tax, formats). | Darija/arabe pour les opérateurs, FR pour la gestion : vos champs `_ar`. | Avancé | vérifié |
| D10.9 | Mode hors ligne / mobile | App mobile NetSuite (approbations, consultations) ; pas de réception offline native (SuiteApps WMS). | Réception sur tablette à la porte arrière ; réseau instable → file d'attente locale. | Avancé | confiance moyenne |
| D10.10 | Suppression vs annulation | Les pièces posting ne sont jamais supprimées une fois la période close ; on **annule/contre-passe** ; les non-posting (demande, BC) peuvent passer en Cancelled/Closed. | Règle d'or de la traçabilité : `cancelled_at` + écriture inverse, jamais de `DELETE`. | Socle | vérifié |

### Patterns PostgreSQL (D10)

```sql
-- Piste d'audit générique par trigger (équivalent System Notes)
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL, row_id int NOT NULL,
  action text NOT NULL,                 -- 'I','U','D'
  changed_by int, changed_at timestamptz NOT NULL DEFAULT now(),
  diff jsonb                            -- {col: {old, new}} uniquement pour les colonnes modifiées
);
CREATE OR REPLACE FUNCTION trg_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(k, jsonb_build_object('old', o.v, 'new', n.v))
      INTO d
      FROM jsonb_each(to_jsonb(OLD)) o(k, v) JOIN jsonb_each(to_jsonb(NEW)) n(k, v) USING (k)
     WHERE o.v IS DISTINCT FROM n.v;
    IF d IS NULL THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO audit_log(table_name,row_id,action,changed_by,diff)
  VALUES (TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), left(TG_OP,1),
          NULLIF(current_setting('app.user_id', true),'')::int, d);
  RETURN COALESCE(NEW, OLD);
END $$;
-- côté Node : SET LOCAL app.user_id = $1 au début de chaque transaction (pattern VPD/contexte applicatif)

-- Séquences par type de pièce et par an
CREATE TABLE document_sequences (doc_type text, year int, last_no int NOT NULL DEFAULT 0, PRIMARY KEY (doc_type, year));
CREATE OR REPLACE FUNCTION fn_next_doc_no(p_type text, p_prefix text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v int; y int := extract(year FROM current_date);
BEGIN
  INSERT INTO document_sequences(doc_type, year, last_no) VALUES (p_type, y, 1)
  ON CONFLICT (doc_type, year) DO UPDATE SET last_no = document_sequences.last_no + 1
  RETURNING last_no INTO v;
  RETURN format('%s-%s-%s', p_prefix, y, lpad(v::text, 5, '0'));
END $$;
```

---

## Synthèse : ce qu'il faut retenir pour la refonte

### Les 12 invariants NetSuite à reproduire tels quels

1. **Chaînage par ligne** : `request_line → po_line → receipt_line → invoice_line`, avec des FK explicites. Toute quantité « restante » est une différence calculée, jamais un compteur maintenu à la main.
2. **Statuts dérivés** du BC et de la demande (fonction SQL), pas des colonnes saisies.
3. **Deux quantités par ligne** : unité d'achat + facteur figé + base (kg/L). Le prix s'exprime en unité d'achat, le coût stock en base.
4. **Réception = entrée en stock + création du lot avec DLC** (pas la facture).
5. **Compte reçu non facturé** (4481/« accrued purchases ») entre réception et facture ; fonction `fn_received_not_billed(asof)`.
6. **Variances** prix/quantité isolées dans des comptes dédiés, comptabilisées périodiquement.
7. **Une pièce posting = une écriture équilibrée**, identifiée par `(source_type, source_id)`, contre-passée et jamais supprimée.
8. **Lettrage N↔N** paiements/avoirs/acomptes ↔ factures dans une table d'applications ; `paid_amount` est un cache dérivé.
9. **Approbation** = règles en table + journal d'événements + verrou du montant approuvé.
10. **Anti-doublon** : numéro de facture unique par fournisseur.
11. **Périodes comptables** verrouillées par trigger.
12. **Piste d'audit** par trigger générique avec `app.user_id` en contexte de session.

### Priorisation suggérée pour 300 BC/an

| Priorité | Capacités | Commentaire |
|---|---|---|
| **P0 (socle)** | D1.1-1.4, D2.1-2.2, D2.5, D3.1, D4.1-4.5, D4.9, D5.1-5.4, D5.11, D6.1, D6.3 (natif), D6.5, D6.6, D7.1, D7.4, D7.7, D8.1, D8.4, D8.6, D9.2, D10.1-10.3, D10.10 | Sans ça, la chaîne ne tient pas. Plusieurs existent déjà chez vous (BC, réception, facture, ledger, catégories par ligne). |
| **P1 (standard)** | D1.5, D1.9, D2.3, D3.2, D3.3, D3.7, D4.6, D4.10, D5.6, D5.8, D5.10, D6.2, D6.4, D6.9, D6.11, D7.2, D7.3, D7.5, D8.2, D8.3, D8.7, D9.1, D9.3, D9.4, D9.8, D10.2, D10.4-10.7 | Rapprochement 3 voies avec tolérances, reçu non facturé, acomptes, retours, approbation paramétrable, aging/échéancier. |
| **P2 (avancé)** | D1.6, D2.6, D3.6, D5.5, D5.9, D6.7, D7.6, D8.5, D9.5-9.6, D10.8-10.9 | BC cadre et landed cost dès qu'il y a des imports ; qualité à réception si ONSSA l'exige ; OCR plus tard. |
| **Hors périmètre** | D4.7, D8.8 (sauf tenants), D4.8 (si aucun import) | — |

### Points de vigilance spécifiques à votre contexte

- **TVA sur encaissement** (Maroc) : la déductibilité suit le paiement ; prévoir `tva_deductible_at` alimentée par `ap_applications`, pas par la date de facture.
- **Identifiants fiscaux** (ICE, IF, RC, patente) en colonnes nommées, imprimés sur BC et contrôlés sur facture.
- **Consommables vs ingrédients** : NetSuite n'a qu'un type « Item » ; vous avez deux tables (`ingredients`, `packaging_items`) routées par `fn_purchasable_kind`. Garder `(purchasable_kind, purchasable_id)` partout dans la chaîne achats plutôt que deux jeux de colonnes.
- **Charges** (lignes `expense`) et **articles** (lignes `item`) dans le même BC et la même facture, comme NetSuite, avec `category_id` par ligne.
- **Densité** : pour les bidons (L) d'un ingrédient géré en kg, le facteur `factor_to_base` doit intégrer `densite_kg_l` (mig 227) au moment de la commande et être figé sur la ligne.

---

## Sources consultées (2026-10-11)

- Oracle NetSuite Help — Vendor Prepayments Overview : https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156378588624.html
- Oracle NetSuite Help — Applying Vendor Prepayments With Auto-Apply : https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157372109804.html
- Oracle NetSuite Help — Entering Vendor Prepayments : https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156395631899.html
- Oracle NetSuite Help — Vendor Return Authorization : https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3696445.html
- Oracle NetSuite Help — Receiving Orders : https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2410585.html
- Oracle NetSuite Help — Receiving Inventory in Advance of a Bill : https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2370995.html
- Oracle NetSuite Help — Using Inbound Shipment Management : https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1490823161.html
- Sikich — NetSuite Vendor Prepayments : https://www.sikich.com/insight/netsuite-vendor-prepayments/
- Tim Dietrich — NetSuite 3-way matching : https://timdietrich.me/blog/netsuite-3way-matching/
- SquareWorks — Real-Time 3-Way Match (SuiteApp, pour distinguer natif / add-on) : https://docs.squareworks.com/squareworks-automate/automate-configuration/real-time-3-way-match
- Houseblend — NetSuite three-way match tolerances & exceptions : https://www.houseblend.io/articles/pdfs/netsuite-three-way-match-tolerances-exceptions.pdf
- Six Lakes Consulting — Landed costs and tariffs in NetSuite : https://www.sixlakesconsulting.com/netsuite-tips/how-to-manage-landed-costs-and-tariffs-in-netsuite.html
- Broken Rubik — NetSuite landed cost guide : https://www.brokenrubik.com/blog/netsuite-landed-cost-guide
- NetSuite Professionals (archive) — Accrued purchase receipts / received not billed : https://archive.netsuiteprofessionals.com/t/26925510/what-report-should-i-use-for-inventory-received-that-is-not-
- NetSuite Professionals (archive) — Where to view purchase accruals : https://archive.netsuiteprofessionals.com/t/27128861/where-to-view-purchase-accruals

Les capacités d'approbation (D3), de BC cadre (D3.6), de Bill Capture (D6.7), de Quality Management (D5.5) et de Purchase Contracts (D1.6) n'ont pas pu être recoupées par une page Oracle dans cette session ; elles s'appuient sur la connaissance du produit et sont marquées en conséquence.
