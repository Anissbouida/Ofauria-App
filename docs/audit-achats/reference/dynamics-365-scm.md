# Référentiel de capacités — Achats (procure-to-pay) selon Microsoft Dynamics 365 Supply Chain Management

> **Source de référence** : Dynamics 365 Supply Chain Management (module *Procurement and sourcing*) + Dynamics 365 Finance (module *Accounts payable*), avec les modules satellites *Landed cost*, *Inventory management* (quality orders, batch), *Master planning*.
> **Public** : équipe de refonte du module Achats d'un ERP interne de boulangerie-pâtisserie (Maroc, ~40 fournisseurs, ~300 BC/an, ingrédients en sacs/cartons/bidons convertis en kg/L, consommables d'emballage, charges).
> **Date** : 2026-10-11.
> **Vérification** : les points marqués ✅ ont été recoupés sur learn.microsoft.com (docs produit et modules de formation) le jour de la rédaction ; les points marqués ◐ reposent sur une connaissance solide du produit mais n'ont pas été re-vérifiés en ligne ; les points marqués ⚠ sont incertains ou issus de sources tierces.

---

## 0. Comment lire ce document

### 0.1 Vocabulaire D365 ↔ vocabulaire interne

| D365 (EN) | Terme interne / FR | Remarque |
|---|---|---|
| Vendor | Fournisseur | `VendTable` |
| Purchase requisition | Demande d'achat (DA) | `PurchReqTable` / `PurchReqLine` |
| Request for quotation (RFQ) | Appel d'offres / demande de prix | `PurchRFQCaseTable` |
| Purchase agreement | Contrat-cadre / accord d'achat | `PurchAgreementHeader` |
| Purchase order (PO) | Bon de commande (BC) | `PurchTable` / `PurchLine` |
| Product receipt | Réception (bon de réception) | `VendPackingSlipJour` / `VendPackingSlipTrans` |
| Registration / arrival | Enregistrement d'arrivée (pré-réception) | `WMSJournalTable` (arrival journal) |
| Quality order | Contrôle qualité | `InventQualityOrderTable` |
| Vendor invoice | Facture fournisseur | `VendInvoiceInfoTable` (pending) → `VendInvoiceJour` (posted) |
| Invoice matching | Rapprochement facture (2/3 voies) | `VendInvoiceMatching*` |
| Charges code | Code de frais (transport, douane, emballage…) | `MarkupTable` / `MarkupTrans` |
| Vendor payment journal | Journal de règlement fournisseur | `LedgerJournalTable` type *Vendor disbursement* |
| Settlement | Lettrage | `VendSettlement` |
| Cash discount | Escompte de règlement | `CashDisc` |
| Vendor hold | Blocage fournisseur | `VendTable.Blocked` |
| Procurement category | Catégorie d'achat (arbre) | `EcoResCategory` hiérarchie *Procurement* |
| Coverage group | Groupe de couverture (règles de réappro) | `ReqGroup` |
| Planned purchase order | BC planifié (proposition) | `ReqPO` |

### 0.2 Niveaux

- **Socle** : sans cela, le module n'est pas un module Achats crédible.
- **Standard** : ce qu'un ERP de taille moyenne offre ; attendu par un auditeur ou un expert-comptable.
- **Avancé** : spécifique D365 / grandes organisations ; à ne retenir que si le cas d'usage boulangerie le justifie.

### 0.3 Lecture pour un ancien développeur Oracle Forms / PL/SQL

D365 est bâti sur un schéma relationnel très classique : chaque document est une paire **en-tête / lignes** (`PurchTable`/`PurchLine`), chaque mouvement physique ou financier produit des **transactions** (`InventTrans`, `VendTrans`, `GeneralJournalAccountEntry`) qui ne sont jamais mises à jour en place mais **compensées** par des contre-écritures. Les statuts sont des **enums** stockés sur l'en-tête et recalculés depuis les lignes. C'est exactement le pattern des blocs maître/détail de Forms et des triggers *POST-INSERT* qui alimentent des tables de mouvements : rien d'exotique, seulement une discipline stricte de « jamais d'UPDATE destructif sur une pièce comptabilisée ».

---

## D1 — Référentiel fournisseurs & données d'achat

| # | Capacité | Description précise (objets, statuts, règles) | Pourquoi c'est important | Niveau | Vérif. |
|---|---|---|---|---|---|
| D1.1 | **Fiche fournisseur (VendTable) adossée à un tiers global (DirParty)** | Le fournisseur est un *rôle* d'une partie (DirPartyTable) : raison sociale, adresses multiples typées (facturation, livraison, commande), contacts, identifiants fiscaux. Un même tiers peut être client ET fournisseur. Statut `Blocked` : `No / Invoice / All / Payment / Requisition / Never`. | Évite les doublons, permet l'historique d'adresses, porte les règles de blocage. | Socle | ◐ |
| D1.2 | **Groupes fournisseurs (VendGroup)** | Regroupement obligatoire portant les valeurs par défaut : compte collectif (poste 4411 fournisseurs), conditions de paiement, profil d'affichage. | Centralise le paramétrage comptable ; un changement de compte collectif se fait en un point. | Socle | ◐ |
| D1.3 | **Profils de comptabilisation fournisseur (Vendor posting profile)** | Mappe {groupe fournisseur \| fournisseur \| tous} → compte collectif 4411, compte d'acomptes (prepayments 3421/4417), compte de factures en attente (arrival). Profil « acompte » distinct. | Permet le lettrage et le grand livre auxiliaire ; au Maroc : séparer 4411 fournisseurs et 4417 avances. | Socle | ◐ |
| D1.4 | **Conditions de paiement (Terms of payment)** | Méthode de calcul : `Net / COD / Current month / Current quarter / Current year / Current week` + N jours ou mois ; option *paiement à la réception*. Associée au fournisseur, surchargée sur le BC et la facture. | Donne la date d'échéance exacte, base de l'ageing et des propositions de paiement. | Socle | ◐ |
| D1.5 | **Escompte de règlement (Cash discount)** | Code avec % + N jours ; peut **chaîner** vers un escompte suivant (ex : 2 % à 10 j, puis 1 % à 20 j). Comptes de produits d'escompte paramétrés. | Standard mondial ; peu utilisé au Maroc mais utile pour les remises « paiement comptant ». | Standard | ◐ |
| D1.6 | **Méthodes de paiement fournisseur (Method of payment)** | Code : type (chèque, virement, espèces, LCN/effet, prélèvement), compte bancaire par défaut, périodicité de regroupement (`Invoice / Date / Week / Total`), format d'export bancaire, exigence de **remise d'effet** (bill of exchange). | Sépare le *comment payer* du *quand payer* ; pilote les journaux. | Socle | ◐ |
| D1.7 | **Comptes bancaires fournisseur** | N fois par fournisseur (RIB, SWIFT, devise), un compte par défaut, actif/inactif. Dans les versions récentes : workflow d'approbation des changements de RIB (anti-fraude). | Fraude au changement de RIB = premier risque P2P. | Standard | ◐ |
| D1.8 | **Accords commerciaux d'achat (Trade agreements / Price-discount journals)** | Prix et remises par {fournisseur, groupe de fournisseurs, tous} × {article, groupe d'articles, tous} × quantité min/max × période de validité × devise × unité. Saisis dans un **journal** posté (historisé). Recherche « meilleur prix » lors de la saisie du BC. | Le prix du BC n'est jamais tapé à la main : il est trouvé. Trace d'évolution de prix par fournisseur. | Socle | ◐ |
| D1.9 | **Informations article-fournisseur (External item description)** | Référence article côté fournisseur, désignation fournisseur, code-barres, délai (lead time) par couple article/fournisseur, fournisseur par défaut sur l'article. | Les BC sortent avec la référence du fournisseur ; le délai alimente la planification. | Socle | ◐ |
| D1.10 | **Unités de mesure & conversions par article (UnitOfMeasureConversion)** | Classes d'unités (masse, volume, quantité), conversions **inter-classe spécifiques à l'article** (ex : 1 sac = 25 kg pour la farine T55, 1 bidon = 5 L d'huile, densité huile 0,92 kg/L). Unité d'achat ≠ unité de stock ≠ unité de vente, chacune paramétrée sur l'article. | C'est exactement le problème « sacs/cartons/bidons → kg/L ». D365 stocke la qté dans l'unité d'achat **et** dans l'unité de stock sur chaque ligne (`PurchQty` + `QtyOrdered` en unité stock). | Socle | ◐ |
| D1.11 | **Catégories d'achat (Procurement categories)** | Hiérarchie de catégories distincte de la hiérarchie produit ; une ligne de DA/BC/facture porte soit un article soit une catégorie (achat « non stocké » : prestations, charges). La catégorie porte : compte de charge par défaut, fournisseurs autorisés, politiques, questionnaires, attributs. | Permet d'acheter de l'électricité, du nettoyage, de la maintenance **dans le même flux** que les ingrédients, avec compte de charge automatique. | Socle | ✅ |
| D1.12 | **Fournisseurs approuvés par article (Approved vendor list)** | Par article : méthode `No check / Warning only / Not allowed` + liste des fournisseurs approuvés avec période de validité. | Qualité/traçabilité : un allergène ou une matière sensible ne vient que de sources validées. | Standard | ◐ |
| D1.13 | **Blocage fournisseur (Vendor hold)** | `Blocked = Invoice` (on peut encore commander/recevoir, pas facturer), `Payment` (on peut facturer, pas payer), `All`, `Requisition`, `Never`. Date de fin de blocage optionnelle. | Litige en cours, fournisseur radié : empêche les étapes ciblées sans tout casser. | Socle | ◐ |
| D1.14 | **Portail / collaboration fournisseur (Vendor collaboration)** | Accès externe où le fournisseur **confirme ou rejette un BC**, propose des modifications, consulte les réceptions, dépose ses factures, répond aux RFQ, met à jour sa fiche. Statut BC `In external review`. | Hors périmètre probable pour 40 fournisseurs locaux ; mais le **statut « envoyé / accusé »** vaut d'être repris (cf. D4.7). | Avancé | ✅ |
| D1.15 | **Onboarding / demande de création fournisseur** | Formulaire (prospective vendor) soumis à workflow, puis conversion en fournisseur. Questionnaires. | Gouvernance : qui a le droit de créer un fournisseur. | Avancé | ◐ |

### Patterns PostgreSQL réutilisables (D1)

```sql
-- Tiers global + rôle fournisseur (évite les doublons client/fournisseur)
CREATE TABLE parties (
  id            bigserial PRIMARY KEY,
  legal_name    text NOT NULL,
  ice           text,           -- Identifiant Commun de l'Entreprise (Maroc)
  if_number     text,           -- Identifiant fiscal
  rc            text,           -- Registre de commerce
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE vendor_hold AS ENUM ('none','invoice','payment','all','requisition','never');

CREATE TABLE vendors (
  id                bigint PRIMARY KEY REFERENCES parties(id),
  vendor_group_id   bigint NOT NULL REFERENCES vendor_groups(id),
  payment_term_id   bigint REFERENCES payment_terms(id),
  cash_discount_id  bigint REFERENCES cash_discounts(id),
  payment_method_id bigint REFERENCES payment_methods(id),
  hold              vendor_hold NOT NULL DEFAULT 'none',
  hold_until        date,
  currency          char(3) NOT NULL DEFAULT 'MAD'
);

-- Conditions de paiement : règle, pas date figée
CREATE TYPE payment_term_method AS ENUM ('net','cod','current_month','current_quarter','current_week');
CREATE TABLE payment_terms (
  id bigserial PRIMARY KEY, code text UNIQUE NOT NULL,
  method payment_term_method NOT NULL, days int NOT NULL DEFAULT 0, months int NOT NULL DEFAULT 0
);
-- Fonction équivalente d'un package PL/SQL : due_date(term, base_date)
CREATE FUNCTION fn_due_date(p_term_id bigint, p_base date) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT CASE t.method
           WHEN 'net' THEN p_base + t.days + (t.months * interval '1 month')
           WHEN 'current_month' THEN (date_trunc('month', p_base) + interval '1 month' - interval '1 day')::date + t.days
           WHEN 'cod' THEN p_base
           ELSE p_base + t.days END::date
  FROM payment_terms t WHERE t.id = p_term_id $$;

-- Accords de prix : versionnés par période, résolus par spécificité (fournisseur > groupe > tous)
CREATE TABLE purchase_price_agreements (
  id bigserial PRIMARY KEY,
  vendor_id bigint REFERENCES vendors(id),           -- NULL = tous
  vendor_group_id bigint REFERENCES vendor_groups(id), -- NULL = tous
  item_id bigint NOT NULL REFERENCES ingredients(id),
  uom_id bigint NOT NULL REFERENCES units(id),
  qty_from numeric(14,3) NOT NULL DEFAULT 0, qty_to numeric(14,3),
  unit_price numeric(14,4) NOT NULL, currency char(3) NOT NULL DEFAULT 'MAD',
  valid_from date NOT NULL, valid_to date,
  EXCLUDE USING gist (item_id WITH =, coalesce(vendor_id,0) WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);

-- Conversions d'unités spécifiques à l'article (sac → kg, bidon → L → kg via densité)
CREATE TABLE item_uom_conversions (
  item_id bigint NOT NULL REFERENCES ingredients(id),
  from_uom bigint NOT NULL, to_uom bigint NOT NULL,
  factor numeric(18,6) NOT NULL CHECK (factor > 0),
  PRIMARY KEY (item_id, from_uom, to_uom)
);
```

*Analogie Oracle* : `fn_due_date` = une fonction de package `PKG_ECHEANCES.DATE_ECHEANCE` ; la contrainte `EXCLUDE USING gist` remplace le trigger *BEFORE INSERT* qu'on écrivait pour interdire les chevauchements de périodes.

---

## D2 — Besoins & demandes d'achat

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Vérif. |
|---|---|---|---|---|---|
| D2.1 | **Demande d'achat (Purchase requisition)** | En-tête (demandeur, préparateur, date requise, motif, « au nom de ») + lignes (article **ou** catégorie, qté, unité, prix estimé, fournisseur suggéré, dimensions financières, site/entrepôt). Statuts : `Draft → In review → Approved / Rejected → Closed` (+ `Cancelled`). Deux **objets** : *Consumption* (besoin interne) et *Replenishment* (réappro). | Sépare « l'atelier a besoin de 200 kg de farine » de « on commande chez X » ; le workflow d'approbation vit ici, pas sur le BC. | Socle | ✅ |
| D2.2 | **Workflow d'approbation de DA** | Moteur de workflow générique : étapes d'approbation, affectation par hiérarchie managériale ou par limite de signature (**signing limit policies**), conditions sur montant/catégorie, escalade, délégation, approbation par ligne ou par en-tête. | Les auditeurs demandent *qui a approuvé quoi, quand*. | Standard | ✅ |
| D2.3 | **Politiques d'achat (Purchasing policies)** | Ensemble de règles par organisation : accès aux catégories (qui peut demander quoi), **catalogue** obligatoire, règle de **regroupement en BC** (par fournisseur / par date / par catégorie), règle de prix/remise (prix modifiable ou non), questionnaires obligatoires, contrôle budgétaire, « RFQ requis au-dessus de N MAD ». | Transforme des pratiques orales en règles exécutées. Pour une boulangerie : *tout achat hors catalogue > X MAD passe par devis*. | Avancé | ✅ |
| D2.4 | **Consolidation DA → BC (Release approved requisitions)** | Les lignes de DA approuvées arrivent dans une liste de travail ; l'acheteur les **regroupe** (manuellement ou par règle de consolidation : même fournisseur, même date de livraison) en un ou plusieurs BC ; lien conservé ligne DA ↔ ligne BC. | Le BC est la réponse à N besoins ; on garde la traçabilité inverse (quel atelier a généré quelle commande). | Socle | ◐ |
| D2.5 | **Catalogue d'achat interne (Procurement catalog)** | Catalogue d'articles/catégories visible des demandeurs, avec images, descriptions, fournisseur préféré ; catalogues externes (punch-out) possibles. | Simplifie la saisie pour les non-acheteurs (chef de production). | Avancé | ◐ |
| D2.6 | **Planification des besoins (Master planning : coverage groups)** | Par article (ou groupe de couverture) : méthode `Requirement / Period / Min-Max / Manual`, stock de sécurité, délai d'achat, multiples de commande, horizon, délais de regroupement. Le plan génère des **planned purchase orders** (`ReqPO`) avec date de commande = date besoin − délai. Statuts `Unprocessed → Approved → Firmed`. Marge négative/positive, messages d'action (« avancer », « retarder », « annuler »). | C'est le « besoin net » : stock − engagements + commandes en cours vs. consommation prévue par les plans de production. Pour un plan de production d'un entremets, c'est la nomenclature × quantité − stock. | Standard | ◐ |
| D2.7 | **Firming des BC planifiés** | Transformer un ou N `ReqPO` en vrais BC (regroupement par fournisseur), avec option « agrément d'achat à utiliser », « marquer les besoins ». | Point de bascule planification → engagement. | Standard | ◐ |
| D2.8 | **Prévision de la demande (Demand forecasting)** | Modèles de prévision (historique de consommation), consommation de la prévision par les commandes réelles. | Avancé ; pour une boulangerie la prévision vient surtout des plans de production. | Avancé | ◐ |

### Patterns PostgreSQL (D2)

```sql
CREATE TYPE pr_status AS ENUM ('draft','in_review','approved','rejected','closed','cancelled');
CREATE TYPE pr_line_kind AS ENUM ('item','category'); -- article stocké OU catégorie (charge)

CREATE TABLE purchase_requisitions (
  id bigserial PRIMARY KEY, number text UNIQUE NOT NULL,
  requester_id bigint NOT NULL REFERENCES users(id),
  on_behalf_of_id bigint REFERENCES users(id),
  purpose text, status pr_status NOT NULL DEFAULT 'draft',
  required_date date, created_at timestamptz DEFAULT now()
);
CREATE TABLE purchase_requisition_lines (
  id bigserial PRIMARY KEY,
  requisition_id bigint NOT NULL REFERENCES purchase_requisitions(id),
  kind pr_line_kind NOT NULL,
  item_id bigint REFERENCES ingredients(id),
  category_id bigint REFERENCES expense_categories(id),
  qty numeric(14,3) NOT NULL, uom_id bigint NOT NULL,
  est_unit_price numeric(14,4), suggested_vendor_id bigint REFERENCES vendors(id),
  po_line_id bigint REFERENCES purchase_order_lines(id),  -- lien DA→BC (rempli à la consolidation)
  CHECK ((kind='item' AND item_id IS NOT NULL) OR (kind='category' AND category_id IS NOT NULL))
);

-- Historique d'approbation générique (réutilisé par DA, BC, facture)
CREATE TABLE approval_steps (
  id bigserial PRIMARY KEY,
  document_type text NOT NULL,      -- 'purchase_requisition' | 'purchase_order' | 'vendor_invoice'
  document_id bigint NOT NULL,
  step_no int NOT NULL,
  assigned_to bigint REFERENCES users(id),
  decision text CHECK (decision IN ('pending','approved','rejected','delegated','escalated')),
  decided_at timestamptz, comment text,
  UNIQUE (document_type, document_id, step_no)
);

-- Limites de signature : montant max approuvable par rôle/utilisateur
CREATE TABLE signing_limits (
  user_id bigint REFERENCES users(id), role_code text,
  document_type text NOT NULL, max_amount numeric(14,2) NOT NULL
);
```

---

## D3 — Sourcing & approbation

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Vérif. |
|---|---|---|---|---|---|
| D3.1 | **Appel d'offres (RFQ case)** | En-tête (date limite, type de sollicitation, critères de notation) + lignes (article/catégorie, qté, date de livraison) + **N fournisseurs invités** → une **réponse (RFQ reply)** par fournisseur, saisie par l'acheteur ou par le portail. Statuts : `Created → Sent → Received → Accepted / Rejected → Cancelled`. Acceptation partielle par ligne possible ; l'acceptation **génère un BC ou un accord d'achat**. | Même sans portail, le tableau comparatif « 3 devis farine » est un besoin réel et un contrôle interne classique. | Standard | ✅ |
| D3.2 | **Comparaison et notation des réponses** | Vue tabulaire des réponses par ligne, critères de notation pondérés (prix, délai, qualité), raison d'acceptation/rejet obligatoire (codes motif). | Justifie le choix d'un fournisseur plus cher. | Standard | ◐ |
| D3.3 | **Accord d'achat (Purchase agreement)** | Contrat-cadre fournisseur avec lignes d'engagement : type `Product quantity / Product value / Product category value / Value` (quantité ou montant), période de validité, prix négocié, remise, **quantité/montant restant** mis à jour par les BC de « déstockage » (release orders). Statuts `On hold / Effective / Closed`. Classification d'accord. | Un prix de farine négocié pour 12 mois / 50 tonnes : les BC le consomment et l'écran montre le reliquat. | Standard | ◐ |
| D3.4 | **Approbation du BC (workflow BC)** | Si *change management* activé : BC `Draft → In review → Approved / Rejected → Confirmed → Finalized`. Sinon : BC créé directement `Approved`. Workflow par en-tête ou par ligne. | Deuxième barrière (après la DA) ; nécessaire si le BC est créé sans DA. | Socle | ✅ |
| D3.5 | **Évaluation fournisseur (Vendor evaluation criteria)** | Groupes de critères et critères notés (1–5) par fournisseur, par catégorie d'achat ; notes agrégées visibles sur la fiche et dans la recherche de fournisseurs par catégorie. | Base d'une revue fournisseurs annuelle (exigence ISO 22000 / HACCP : fournisseurs évalués). | Standard | ✅ |
| D3.6 | **Codes motif (Reason codes) sur rejet / annulation / retour** | Référentiel de codes avec libellé et champs d'application (achats, retours, règlements). | Analyse des causes ; obligatoire pour un retour fournisseur. | Socle | ◐ |

### Patterns PostgreSQL (D3)

```sql
CREATE TABLE rfq_cases (id bigserial PRIMARY KEY, number text UNIQUE, deadline timestamptz, status text NOT NULL);
CREATE TABLE rfq_lines (id bigserial PRIMARY KEY, rfq_id bigint REFERENCES rfq_cases(id), item_id bigint, category_id bigint, qty numeric(14,3), uom_id bigint, need_date date);
CREATE TABLE rfq_vendors (rfq_id bigint REFERENCES rfq_cases(id), vendor_id bigint REFERENCES vendors(id), sent_at timestamptz, PRIMARY KEY (rfq_id, vendor_id));
CREATE TABLE rfq_replies (
  id bigserial PRIMARY KEY, rfq_line_id bigint REFERENCES rfq_lines(id), vendor_id bigint REFERENCES vendors(id),
  unit_price numeric(14,4), lead_days int, valid_until date, score numeric(5,2),
  decision text CHECK (decision IN ('pending','accepted','rejected')), reason_code text,
  generated_po_line_id bigint, UNIQUE (rfq_line_id, vendor_id)
);

-- Accord d'achat : engagement + reliquat calculé (jamais stocké en dur)
CREATE TABLE purchase_agreement_lines (
  id bigserial PRIMARY KEY, agreement_id bigint NOT NULL,
  item_id bigint, category_id bigint, commitment_kind text CHECK (commitment_kind IN ('qty','value','category_value','value_total')),
  committed_qty numeric(14,3), committed_value numeric(14,2), unit_price numeric(14,4),
  valid_from date, valid_to date
);
CREATE VIEW v_agreement_remaining AS
SELECT al.id, al.committed_qty - coalesce(sum(pol.qty_ordered_stock_uom),0) AS remaining_qty
FROM purchase_agreement_lines al LEFT JOIN purchase_order_lines pol ON pol.agreement_line_id = al.id AND pol.status <> 'cancelled'
GROUP BY al.id, al.committed_qty;
```

---

## D4 — Commande (bon de commande)

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Vérif. |
|---|---|---|---|---|---|
| D4.1 | **BC en-tête/lignes avec types** | Types : `Purchase order` (standard), `Journal` (brouillon non engageant), `Returned order` (retour fournisseur, avec RMA). En-tête : fournisseur commande ≠ fournisseur facture (`InvoiceAccount`), adresse de livraison, devise, conditions, mode de livraison, site/entrepôt par défaut, acheteur. Ligne : article ou catégorie, qté en **unité d'achat** + qté convertie en unité de stock, prix, remise %, montant net, date de livraison demandée/confirmée, dimensions (site, entrepôt, lot), texte. | Le cœur du module ; la double quantité (achat/stock) résout le problème sacs→kg nativement. | Socle | ✅ |
| D4.2 | **Deux axes de statut indépendants** | **Approval status** (`Draft / In review / Rejected / Approved / In external review / Confirmed / Finalized`) et **Document status** (= dernier document posté : `None / Purchase inquiry / Purchase order / Receipts list / Product receipt / Invoice`) + **Purchase status** calculé depuis les lignes (`Open order / Received / Invoiced / Cancelled`). | Évite le statut unique fourre-tout : « confirmé mais partiellement reçu et non facturé » s'exprime proprement. | Socle | ✅ |
| D4.3 | **Confirmation du BC (Confirm)** | Action explicite qui fige la version, génère le document PDF/EDI envoyé au fournisseur, crée les **engagements** (budget, accrued) et verrouille la modification sans *change request*. Pré-confirmation possible (`Purchase inquiry` = pro forma). | Un BC non confirmé n'est pas un engagement ; les réceptions ne sont autorisées que sur BC confirmé. | Socle | ✅ |
| D4.4 | **Gestion des modifications avec versions (Change management)** | Activée par paramètre global, par fournisseur, ou surchargée par BC. Après confirmation, toute modification crée une **demande de changement** qui repasse par le workflow ; chaque approbation crée une **version** (`PurchTableHistory` / `PurchLineHistory`) ; comparaison version N vs N−1 ; le vendeur voit la version confirmée. ✅ *La version est enregistrée à l'approbation, pas à l'envoi.* | Traçabilité : qui a changé la quantité de 500 à 800 kg après envoi ? Indispensable pour auditer les écarts facture/BC. | Standard | ✅ |
| D4.5 | **Échéancier de livraison (Delivery schedule)** | Une ligne de BC peut être éclatée en N sous-lignes de livraison (dates et quantités différentes) tout en gardant une seule ligne de prix ; la ligne mère devient « ligne de regroupement ». | Commander 1 000 kg livrés en 4 fois sur le mois : un seul prix négocié, quatre réceptions attendues. | Standard | ◐ |
| D4.6 | **Dates : demandée / confirmée / délais** | `Requested receipt date`, `Confirmed receipt date`, `Requested ship date`, délai d'achat par article-fournisseur, calendrier fournisseur (jours ouvrés), jours de transport par mode. | Les retards se mesurent sur la date **confirmée**, pas sur la date demandée. | Standard | ◐ |
| D4.7 | **Envoi au fournisseur et accusé** | Impression/e-mail/EDI à la confirmation (print management par fournisseur) ; statut `In external review` → accepté/rejeté/modifié par le portail ; option *auto-confirm* par fournisseur. | Même sans portail : tracer *envoyé le / par / accusé le*. | Standard | ✅ |
| D4.8 | **Frais sur BC (Charges on PO)** | Codes de frais (transport, emballage, douane, assurance) en en-tête ou ligne, type `Fixed / Pct / Per unit`, débit fournisseur/charge/article, **allocation automatique** (par montant net, qté, nombre de lignes) ; frais **automatiques** par fournisseur/groupe/article. Ventilés dans le coût d'achat de l'article (`Debit = Item`) ou en charge. | Le transport facturé par le livreur doit entrer dans le prix de revient du kg de farine. | Standard | ✅ |
| D4.9 | **Remises (ligne, multi-ligne, totale)** | Remise % et montant par ligne, remise multi-ligne (seuils cumulés), remise totale ; issues des accords commerciaux ou saisies. | Mécanique simple mais à ne pas improviser dans les calculs de rapprochement. | Socle | ◐ |
| D4.10 | **Taxes** | Groupes de taxe (fournisseur) × groupes de taxe article → taux ; TVA récupérable/non récupérable ; TVA sur frais ; **taxe à l'encaissement vs. débit** (pertinent Maroc : TVA récupérable sur paiement). | Montant TVA par ligne, pas globalisé — cohérent avec la TVA par ligne déjà en place. | Socle | ◐ |
| D4.11 | **Annulation / réduction de reliquat (Cancel remaining quantity)** | Sur ligne partiellement reçue : annuler le reliquat (`Deliver remainder`) sans supprimer l'historique ; `Finalize` ferme financièrement le BC (plus aucune facture possible). | Les reliquats fantômes faussent le besoin net et l'engagement. | Socle | ✅ |
| D4.12 | **Acompte sur BC (Prepayment)** | Définition d'un acompte (montant ou %) sur le BC → facture d'acompte → paiement → application de l'acompte sur la facture finale. | Fréquent avec les petits fournisseurs marocains (avance avant livraison). | Standard | ◐ |
| D4.13 | **Marquage / réservation (Marking)** | Lier une ligne de BC à un besoin spécifique (ligne de plan de production, ligne de vente) pour que la réception alimente ce besoin et son coût. | Traçabilité besoin → BC → lot reçu → plan de production. | Avancé | ◐ |
| D4.14 | **Copie / modèle de BC** | « Copier depuis » un BC, un journal, une facture ; lignes récurrentes. | Confort acheteur : 300 BC/an, très répétitifs. | Standard | ◐ |

### Patterns PostgreSQL (D4)

```sql
CREATE TYPE po_approval_status AS ENUM ('draft','in_review','rejected','approved','in_external_review','confirmed','finalized');
CREATE TYPE po_doc_status      AS ENUM ('none','inquiry','purchase_order','receipts_list','product_receipt','invoice');
CREATE TYPE po_line_status     AS ENUM ('open','received','invoiced','cancelled');

CREATE TABLE purchase_orders (
  id bigserial PRIMARY KEY, number text UNIQUE NOT NULL,
  order_vendor_id bigint NOT NULL REFERENCES vendors(id),
  invoice_vendor_id bigint NOT NULL REFERENCES vendors(id),   -- peut différer (facturé par la maison mère)
  approval_status po_approval_status NOT NULL DEFAULT 'draft',
  doc_status po_doc_status NOT NULL DEFAULT 'none',
  change_management boolean NOT NULL DEFAULT false,
  current_version int NOT NULL DEFAULT 0,
  confirmed_at timestamptz, sent_at timestamptz, sent_by bigint, acknowledged_at timestamptz,
  payment_term_id bigint, currency char(3) NOT NULL DEFAULT 'MAD', delivery_site_id bigint
);

CREATE TABLE purchase_order_lines (
  id bigserial PRIMARY KEY, po_id bigint NOT NULL REFERENCES purchase_orders(id),
  line_no int NOT NULL,
  item_id bigint, category_id bigint,
  purchase_qty numeric(14,3) NOT NULL, purchase_uom bigint NOT NULL,       -- 20 sacs
  qty_ordered_stock_uom numeric(14,3) NOT NULL, stock_uom bigint NOT NULL,  -- 500 kg (via item_uom_conversions)
  unit_price numeric(14,4) NOT NULL, discount_pct numeric(5,2) DEFAULT 0, line_amount numeric(14,2) NOT NULL,
  vat_rate numeric(5,2), requested_date date, confirmed_date date,
  status po_line_status NOT NULL DEFAULT 'open',
  remaining_qty numeric(14,3) NOT NULL,   -- reliquat à recevoir (unité stock) ; mis à jour par la réception
  agreement_line_id bigint, requisition_line_id bigint,
  UNIQUE (po_id, line_no)
);

-- Versions : snapshot JSONB à chaque approbation (pattern "PurchTableHistory")
CREATE TABLE purchase_order_versions (
  po_id bigint NOT NULL REFERENCES purchase_orders(id), version int NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(), approved_by bigint,
  header jsonb NOT NULL, lines jsonb NOT NULL,         -- copie intégrale ; diff calculé à la lecture
  change_reason text, PRIMARY KEY (po_id, version)
);

-- Échéancier de livraison : sous-lignes rattachées à la ligne de prix
CREATE TABLE purchase_order_delivery_schedule (
  id bigserial PRIMARY KEY, po_line_id bigint NOT NULL REFERENCES purchase_order_lines(id),
  qty_stock_uom numeric(14,3) NOT NULL, requested_date date NOT NULL, confirmed_date date
);

-- Frais (charges) : en-tête ou ligne, allocation dans le coût ou en charge
CREATE TABLE charge_codes (code text PRIMARY KEY, label text, debit_target text CHECK (debit_target IN ('item','ledger','vendor')), default_account text);
CREATE TABLE document_charges (
  id bigserial PRIMARY KEY, document_type text NOT NULL, document_id bigint NOT NULL, line_id bigint,
  charge_code text REFERENCES charge_codes(code), calc_kind text CHECK (calc_kind IN ('fixed','pct','per_unit')),
  value numeric(14,4) NOT NULL, amount numeric(14,2) NOT NULL, vat_rate numeric(5,2)
);
```

*Garde-fou façon PL/SQL* : un trigger `BEFORE UPDATE` sur `purchase_orders` qui lève `RAISE EXCEPTION` si `OLD.approval_status IN ('confirmed','finalized')` et qu'un champ métier change sans incrément de `current_version` — l'équivalent d'un `WHEN-VALIDATE-RECORD` côté base, infranchissable par l'API.

---

## D5 — Réception & qualité

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Vérif. |
|---|---|---|---|---|---|
| D5.1 | **Enregistrement d'arrivée (Registration / Arrival journal)** | Étape **physique non comptable** : le magasinier enregistre ce qui arrive (qté, lot, DLC, emplacement) → transaction d'inventaire au statut `Registered`. Pas d'écriture GL. Peut passer par un **journal d'arrivée** (`Arrival overview`) qui liste les BC attendus du jour. | Sépare « c'est dans l'entrepôt » de « c'est reçu administrativement » ; le lot est déjà consommable en production avec le statut *Registered*. | Standard | ◐ |
| D5.2 | **Réception (Product receipt posting)** | Document posté par BC (ou multi-BC d'un même fournisseur) : numéro du BL fournisseur, date, quantités reçues par ligne (en unité d'achat, converties). Transactions d'inventaire passent `Received` ; **écriture comptable d'accrual** (stock / charges à payer 4081-4088 « factures non parvenues ») si *Post product receipt in ledger* activé. Statut ligne → `Received` si qté reçue = commandée (avec tolérance). | C'est la pièce qui rend le stock *réel et valorisé* avant la facture, et qui porte les FNP en clôture. | Socle | ✅ |
| D5.3 | **Réception partielle et sur/sous-livraison** | Par article ou ligne : `Over-delivery %` et `Under-delivery %`. Si reçu < commandé − tolérance → ligne reste `Open` avec reliquat ; sinon on peut *fermer* la ligne. Over-delivery au-delà du % refusé. | 20 sacs commandés, 19 livrés : la ligne doit garder un reliquat de 1 sac ou être fermée explicitement, jamais oubliée. | Socle | ◐ |
| D5.4 | **Lots / numéros de lot & DLC (Batch dimension, shelf life)** | Dimension de suivi *Batch* sur l'article ; à la réception : numéro de lot fournisseur, date de fabrication, **date d'expiration / best-before**, pays d'origine ; durée de vie calculée ; attributs de lot (humidité, taux…). Règles FEFO à la sortie. Blocage de lot (`Inventory blocking`). | Traçabilité alimentaire obligatoire (ONSSA) ; rappel produit = lot fournisseur → productions → ventes. | Socle | ◐ |
| D5.5 | **Ordres de qualité (Quality orders)** | *Quality associations* déclenchent automatiquement un ordre qualité à un événement (registration, product receipt) pour {article, groupe, fournisseur} : tests, échantillonnage, résultats, **acceptation / rejet** ; en cas d'échec, quarantaine (`Quarantine order`) ou blocage du lot ; non-conformité (`Non-conformance`) avec actions correctives. | Contrôle à réception (température, aspect, DLC résiduelle) tracé par lot. | Standard | ◐ |
| D5.6 | **Retour fournisseur (Vendor return / Returned order)** | BC de type `Returned order` avec **RMA** du fournisseur ; lignes négatives, souvent créées par « *Credit note* : copier depuis facture » (reprend prix, frais). **Return action** : `Credit only` (crédit sans retour physique), `Credit` (retour + crédit), `Replace and credit`, `Replace and scrap`, `Scrap` (rebut sans retour). Puis réception négative (product receipt) et **facture négative = avoir** avec lettrage sur la facture d'origine. | Un carton de beurre rance : reprend-on le stock, qui paie, à quel prix, quel lot est concerné ? La return action répond. | Standard | ✅ |
| D5.7 | **Liste de réception attendue (Receipts list / Arrival overview)** | Document intermédiaire listant ce qui est attendu d'un fournisseur sur une période ; sert de check-list au quai. | Le magasinier sait quoi attendre, et le BC est le référentiel. | Standard | ◐ |
| D5.8 | **Correction / annulation de réception** | Un product receipt posté se corrige par une **nouvelle réception corrective** (pas d'UPDATE), ou s'annule intégralement si non facturé ; journal des corrections. | Immutabilité des pièces ; audit. | Socle | ◐ |
| D5.9 | **Statuts d'inventaire (Inventory status)** | Dimension `Available / Blocked / Quarantine` sur chaque transaction ; la réception place le lot en *Blocked* si contrôle qualité requis, puis *Available*. | Un lot bloqué ne doit pas être prélevable par un bon de sortie. | Standard | ◐ |
| D5.10 | **Quantité de catch weight (poids variable)** | Articles « CW » : quantité nominale (cartons) + quantité réelle pesée (kg) sur chaque transaction ; facturation au poids réel. | Pertinent pour beurre/fromage/fruits achetés au carton et payés au kg. | Avancé | ◐ |

### Patterns PostgreSQL (D5)

```sql
CREATE TYPE inv_status AS ENUM ('registered','received','available','blocked','quarantine','consumed');
CREATE TYPE return_action AS ENUM ('credit_only','credit','replace_and_credit','replace_and_scrap','scrap');

CREATE TABLE product_receipts (
  id bigserial PRIMARY KEY, number text UNIQUE NOT NULL,
  vendor_id bigint NOT NULL, vendor_delivery_note text, received_at date NOT NULL,
  posted_at timestamptz, posted_by bigint,
  corrects_receipt_id bigint REFERENCES product_receipts(id),  -- correction = nouvelle pièce
  is_return boolean NOT NULL DEFAULT false
);
CREATE TABLE product_receipt_lines (
  id bigserial PRIMARY KEY, receipt_id bigint NOT NULL REFERENCES product_receipts(id),
  po_line_id bigint NOT NULL REFERENCES purchase_order_lines(id),
  purchase_qty numeric(14,3) NOT NULL, qty_stock_uom numeric(14,3) NOT NULL,   -- 19 sacs / 475 kg (négatif si retour)
  lot_id bigint REFERENCES ingredient_lots(id),
  closes_line boolean NOT NULL DEFAULT false   -- "fermer le reliquat" explicite
);
-- Lot : traçabilité alimentaire
CREATE TABLE ingredient_lots (
  id bigserial PRIMARY KEY, item_id bigint NOT NULL, vendor_lot_no text, vendor_id bigint,
  manufactured_on date, expires_on date, received_via_line_id bigint,
  status inv_status NOT NULL DEFAULT 'registered', blocked_reason text
);
-- Ordre qualité déclenché par règle (quality association)
CREATE TABLE quality_associations (id bigserial PRIMARY KEY, trigger_event text CHECK (trigger_event IN ('registration','product_receipt')), item_id bigint, vendor_id bigint, test_group_id bigint, blocks_lot boolean DEFAULT true);
CREATE TABLE quality_orders (id bigserial PRIMARY KEY, lot_id bigint REFERENCES ingredient_lots(id), receipt_line_id bigint, test_group_id bigint, result text CHECK (result IN ('pending','passed','failed')), decided_at timestamptz, decided_by bigint);

-- Retour fournisseur = BC de type retour
ALTER TABLE purchase_orders ADD COLUMN order_kind text NOT NULL DEFAULT 'purchase' CHECK (order_kind IN ('purchase','journal','return'));
ALTER TABLE purchase_orders ADD COLUMN rma_number text, ADD COLUMN return_action return_action, ADD COLUMN returns_invoice_id bigint;
```

*Règle d'or* : `remaining_qty` de la ligne de BC est **recalculé** par trigger `AFTER INSERT` sur `product_receipt_lines` (somme des réceptions), jamais décrémenté « à la main » dans le code applicatif. Même esprit que le `current_quantity` qui dérive aujourd'hui : D365 ne stocke pas le stock, il additionne `InventTrans` (avec une table de somme `InventSum` entretenue par trigger pour la performance).

---

## D6 — Facturation & rapprochement

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Vérif. |
|---|---|---|---|---|---|
| D6.1 | **Facture fournisseur en attente (Pending vendor invoice)** | Objet `VendInvoiceInfoTable` : saisie manuelle, import OCR/EDI (*Invoice capture*), ou portail. Rattachée à un ou **plusieurs BC** (même fournisseur de facturation) ; lignes rattachées à des réceptions (product receipt) ou à des lignes de BC, ou **sans BC** via catégorie d'achat. Statuts : `Draft → In review → Approved / Rejected → Posted`. Workflow configurable. | Zone tampon : la facture existe (date de réception, délai légal de paiement court) mais n'est pas encore comptabilisée. | Socle | ✅ |
| D6.2 | **Rapprochement 2 voies / 3 voies (Invoice matching)** | Politique `None / Two-way (prix) / Three-way (prix + quantité reçue)`, définie au niveau **entité légale**, surchargée par **article**, par **fournisseur**, par **couple article-fournisseur**, et enfin sur la **ligne de BC**. Three-way : qté facturée ≤ qté reçue non encore facturée. Résultat par ligne : icônes de variance ; option *Autoriser avec écart* (approbation) ou *Bloquer*. | C'est LE contrôle anti-surfacturation. Pour une boulangerie : 3 voies pour les ingrédients stockés, 2 voies pour les charges/prestations. | Socle | ✅ |
| D6.3 | **Tolérances de prix (Price tolerance)** | % par défaut entité (0 % strict), puis par article, groupe de tolérance article, fournisseur, groupe de tolérance fournisseur, couple. Tolérance **unitaire** et tolérance sur **totaux de prix** (`Match price totals` : `None / Percentage / Amount / Both`) pour N factures sur une ligne de BC. | Écart de 0,02 MAD/kg : on ne bloque pas ; écart de 8 % : on bloque. Paramétrable sans code. | Standard | ✅ |
| D6.4 | **Rapprochement des frais (Charges matching)** | Les frais facturés (transport) sont comparés aux frais attendus du BC ; tolérance ; **montant maximum** par code de frais validé à la facture. | Le transport surfacturé est un écart courant. | Standard | ✅ |
| D6.5 | **Rapprochement des totaux (Invoice totals matching)** | Comparaison facture saisie (total HT, TVA, TTC, frais, remise) vs. totaux calculés depuis les lignes ; tolérance. | Détecte les erreurs d'arrondi et de TVA du fournisseur avant comptabilisation. | Standard | ◐ |
| D6.6 | **Journal des factures (Invoice journal) — hors BC** | Facture sans BC : lignes = comptes de charge (ou catégorie) + dimensions ; TVA ; comptabilisation directe au 4411. Journal **d'enregistrement** (*Invoice register*) + **journal d'approbation** (*Invoice approval*) en deux temps : la facture est portée en compte d'attente dès réception, ventilée à l'approbation. | Loyer, électricité, honoraires : flux simplifié mais tracé ; le 2 temps garantit que la dette existe dès réception du papier. | Socle | ✅ |
| D6.7 | **Avoir fournisseur (Credit note)** | Facture négative, rattachée ou non à un retour ; **lettrage** (settlement) possible sur la facture d'origine ; motif. | Le retour de D5.6 se termine ici. | Socle | ✅ |
| D6.8 | **Comptabilisation (Post)** | Génère `VendInvoiceJour` (immutable), `VendTrans` (dette ouverte, échéance, escompte), reprise des accruals de réception (contre-passation FNP), valorisation définitive du stock (ajustement coût si prix facture ≠ prix BC), TVA. Numéro de pièce (voucher). | Une facture postée ne se modifie jamais ; on l'annule ou on la corrige par avoir. | Socle | ✅ |
| D6.9 | **Prépaiement appliqué** | Application d'un acompte posté sur la facture finale lors de la comptabilisation. | Suite de D4.12. | Standard | ◐ |
| D6.10 | **Doublon de facture (Duplicate invoice check)** | Paramètre : numéro de facture fournisseur unique par fournisseur (`Reject / Warn / Accept`). | Évite de payer deux fois la même facture. Trivial, très efficace. | Socle | ◐ |
| D6.11 | **Factures par catégorie / ligne mixte** | Une même facture peut mélanger lignes BC (3 voies) et lignes catégorie (frais annexes). | Le fournisseur de farine facture aussi la palette consignée. | Standard | ◐ |
| D6.12 | **Pièce jointe / image et capture automatique (Invoice capture)** | PDF/scan attaché, extraction OCR, pré-rapprochement automatique au BC par numéro. | Zéro ressaisie ; dossier d'audit complet. | Avancé | ◐ |

### Patterns PostgreSQL (D6)

```sql
CREATE TYPE match_policy AS ENUM ('none','two_way','three_way');
-- Résolution hiérarchique : ligne BC > article×fournisseur > fournisseur > article > entité
CREATE TABLE matching_policies (
  id bigserial PRIMARY KEY, item_id bigint, vendor_id bigint, policy match_policy NOT NULL,
  price_tolerance_pct numeric(5,2) NOT NULL DEFAULT 0, price_tolerance_amount numeric(14,2),
  UNIQUE NULLS NOT DISTINCT (item_id, vendor_id)
);
CREATE FUNCTION fn_match_policy(p_item bigint, p_vendor bigint) RETURNS matching_policies LANGUAGE sql STABLE AS $$
  SELECT * FROM matching_policies
  WHERE (item_id = p_item OR item_id IS NULL) AND (vendor_id = p_vendor OR vendor_id IS NULL)
  ORDER BY (item_id IS NOT NULL)::int + (vendor_id IS NOT NULL)::int DESC LIMIT 1 $$;

CREATE TYPE vi_status AS ENUM ('draft','in_review','approved','rejected','posted','cancelled');
CREATE TABLE vendor_invoices (
  id bigserial PRIMARY KEY, vendor_id bigint NOT NULL REFERENCES vendors(id),
  vendor_invoice_no text NOT NULL, invoice_date date NOT NULL, received_on date,
  due_date date, status vi_status NOT NULL DEFAULT 'draft',
  total_ht numeric(14,2), total_vat numeric(14,2), total_ttc numeric(14,2),   -- saisis (à comparer aux lignes)
  is_credit_note boolean NOT NULL DEFAULT false, settles_invoice_id bigint,
  posted_at timestamptz, voucher_no text,
  UNIQUE (vendor_id, vendor_invoice_no)      -- D6.10 : anti-doublon
);
CREATE TABLE vendor_invoice_lines (
  id bigserial PRIMARY KEY, invoice_id bigint NOT NULL REFERENCES vendor_invoices(id),
  po_line_id bigint REFERENCES purchase_order_lines(id),
  receipt_line_id bigint REFERENCES product_receipt_lines(id),   -- 3 voies : rattachée à la réception
  category_id bigint,                                             -- hors BC
  qty numeric(14,3), unit_price numeric(14,4), amount numeric(14,2), vat_rate numeric(5,2),
  match_status text CHECK (match_status IN ('ok','price_variance','qty_variance','not_matched','approved_with_variance')),
  variance_approved_by bigint, variance_approved_at timestamptz
);
-- Vue "reste à facturer" par ligne de BC (base du 3 voies)
CREATE VIEW v_po_line_invoiceable AS
SELECT pol.id, coalesce(sum(prl.qty_stock_uom),0) - coalesce((SELECT sum(vil.qty) FROM vendor_invoice_lines vil JOIN vendor_invoices vi ON vi.id=vil.invoice_id WHERE vil.po_line_id=pol.id AND vi.status='posted'),0) AS qty_received_not_invoiced
FROM purchase_order_lines pol LEFT JOIN product_receipt_lines prl ON prl.po_line_id=pol.id GROUP BY pol.id;
```

*Analogie* : `fn_match_policy` est une fonction « cascade de défauts » comme on en écrivait pour les paramètres hiérarchiques (site > société > global) ; `UNIQUE NULLS NOT DISTINCT` (PG 15+) évite le trigger qu'il fallait écrire sous Oracle pour unicité avec NULL.

---

## D7 — Paiements & trésorerie fournisseurs

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Vérif. |
|---|---|---|---|---|---|
| D7.1 | **Transactions fournisseur ouvertes (Open vendor transactions)** | Chaque facture postée = `VendTrans` avec montant, **montant restant** (`AmountMUR`), date d'échéance, date limite d'escompte, statut lettrage. Vue « factures ouvertes » filtrable. | Base de l'ageing, de la proposition de paiement, du solde fournisseur. | Socle | ✅ |
| D7.2 | **Journal de règlement (Vendor payment journal)** | En-tête de journal + lignes {fournisseur, montant, méthode, compte bancaire, date} ; **statut de paiement** : `None → Sent → Received/Approved → Rejected` ; génération du fichier banque / impression chèque ; **comptabilisation** → mouvement de banque + lettrage. | Le paiement est une pièce comptable en soi, distincte de la facture. | Socle | ◐ |
| D7.3 | **Proposition de paiement (Payment proposal)** | Sélection automatique des `VendTrans` ouvertes selon : `Due date / Cash discount date / Both`, plage de dates, fournisseurs, méthodes, montant min ; **regroupement** par fournisseur selon la périodicité de la méthode ; lignes éditables avant comptabilisation. Exclut les fournisseurs bloqués `Payment/All`. | Remplace la liste Excel du vendredi « qui paie-t-on ». | Standard | ✅ |
| D7.4 | **Lettrage (Settlement) manuel et automatique** | Rapprochement paiement ↔ factures/avoirs : total, partiel, sur-paiement (tolérance d'arrondi), lettrage croisé fournisseur/client (netting), **dé-lettrage**. Table `VendSettlement` avec date de lettrage et différence de change. | Sans lettrage, impossible de dire quelle facture est payée ; le partiel est la règle avec les petits fournisseurs. | Socle | ◐ |
| D7.5 | **Paiement partiel et paiement anticipé** | Un règlement peut couvrir une partie d'une facture (reste ouvert) ou être un **acompte non affecté** lettré plus tard. | Cas réel : « j'ai avancé 5 000 MAD au fournisseur de fruits ». | Socle | ◐ |
| D7.6 | **Escompte pris / perdu** | À la comptabilisation du paiement : si date ≤ date d'escompte, écriture automatique sur compte « escomptes obtenus » ; sinon escompte perdu tracé. | Standard comptable. | Standard | ◐ |
| D7.7 | **Effets à payer (Bills of exchange / Promissory notes)** | Cycle : `Draft → Remitted → Honored / Protested`, journal de remise, compte 4415 effets à payer. | **Important au Maroc** (LCN / effets). | Standard | ◐ |
| D7.8 | **Retenue à la source (Withholding tax)** | Codes et groupes de retenue par fournisseur ; calcul au paiement ; déclaration. | Maroc : retenue à la source 10 %/20 % sur prestataires non résidents / honoraires selon cas. | Standard | ◐ |
| D7.9 | **Blocage de paiement ciblé** | `Vendor hold = Payment` ou blocage d'une **facture individuelle** (`On hold` sur la VendTrans) avec motif et date. | Litige sur une facture sans bloquer tout le fournisseur. | Socle | ◐ |
| D7.10 | **Rapprochement bancaire des paiements** | Les paiements comptabilisés attendent le rapprochement avec le relevé (bank reconciliation). | Boucle avec la trésorerie ; hors Achats stricto sensu. | Standard | ◐ |
| D7.11 | **Prévision de trésorerie (Cash flow forecast)** | Les BC confirmés (engagements) et les factures ouvertes alimentent les sorties prévisionnelles par date d'échéance. | Savoir en début de mois ce que les achats vont décaisser. | Avancé | ◐ |

### Patterns PostgreSQL (D7)

```sql
-- Sous-ledger fournisseur : une ligne par pièce (facture +, avoir −, paiement −)
CREATE TABLE vendor_transactions (
  id bigserial PRIMARY KEY, vendor_id bigint NOT NULL REFERENCES vendors(id),
  kind text NOT NULL CHECK (kind IN ('invoice','credit_note','payment','prepayment','bill_of_exchange')),
  source_table text NOT NULL, source_id bigint NOT NULL,
  posted_on date NOT NULL, due_date date, cash_discount_date date,
  amount numeric(14,2) NOT NULL,                 -- signé : dette +, règlement −
  on_hold boolean NOT NULL DEFAULT false, hold_reason text,
  UNIQUE (source_table, source_id)
);
-- Lettrage : lignes de rapprochement many-to-many ; "reste" calculé
CREATE TABLE vendor_settlements (
  id bigserial PRIMARY KEY, settled_on date NOT NULL,
  debit_trans_id bigint NOT NULL REFERENCES vendor_transactions(id),   -- facture
  credit_trans_id bigint NOT NULL REFERENCES vendor_transactions(id),  -- paiement / avoir
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  cash_discount_taken numeric(14,2) DEFAULT 0, unsettled_at timestamptz   -- dé-lettrage soft
);
CREATE VIEW v_vendor_open_items AS
SELECT t.*, t.amount - coalesce((SELECT sum(s.amount) FROM vendor_settlements s WHERE s.unsettled_at IS NULL AND (s.debit_trans_id=t.id OR s.credit_trans_id=t.id)),0) * sign(t.amount) AS remaining
FROM vendor_transactions t;
-- Journal de règlement
CREATE TABLE payment_journals (id bigserial PRIMARY KEY, number text UNIQUE, bank_account_id bigint, status text CHECK (status IN ('draft','proposed','approved','sent','posted','rejected')), posted_at timestamptz);
CREATE TABLE payment_journal_lines (id bigserial PRIMARY KEY, journal_id bigint REFERENCES payment_journals(id), vendor_id bigint, method_id bigint, amount numeric(14,2), pay_date date, reference text);
CREATE TABLE payment_journal_line_targets (line_id bigint REFERENCES payment_journal_lines(id), vendor_trans_id bigint REFERENCES vendor_transactions(id), amount numeric(14,2), PRIMARY KEY (line_id, vendor_trans_id));
```

*Lien avec l'existant* : la mémoire *Réconciliation legacy↔ledger* note un `paid_amount` synchronisé atomiquement ; le pattern D365 va plus loin en **ne stockant pas** `paid_amount` du tout : il est la somme des lettrages. Garder `paid_amount` comme cache matérialisé est acceptable, à condition qu'un seul trigger l'écrive.

---

## D8 — Comptabilité des achats

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Vérif. |
|---|---|---|---|---|---|
| D8.1 | **Profils de comptabilisation stock (Inventory posting)** | Matrice {groupe d'articles / article / tous} × {fournisseur / groupe / tous} → comptes : *Purchase expenditure, un-invoiced* (accrual), *Purchase, inventory receipt*, *Purchase expenditure for product*, *Purchase, accrual* (FNP), *Discount*, *Fixed receipt price variance*. Pour les catégories d'achat : compte de charge par catégorie. | Toute la mécanique comptable est **du paramétrage**, pas du code : changer un compte ne touche pas l'application. | Socle | ◐ |
| D8.2 | **Comptabilisation de la réception (Accrued purchases)** | Si `Post product receipt in ledger` : à la réception, débit stock (ou charge) / crédit **4081 fournisseurs – factures non parvenues** au prix du BC. À la facture : contre-passation et écriture définitive 4411. Rapport « Accrued purchases » = réceptions non facturées à une date. | **Clôture mensuelle** : les FNP sont justifiées par pièce (réception × prix BC) et non estimées. C'est ce que l'expert-comptable demande. | Standard | ✅ |
| D8.3 | **Écarts prix facture / BC (Purchase price variance)** | À la facturation, différence entre prix BC (déjà dans le stock) et prix facture : ajustement du coût du stock si l'article est encore en stock, sinon compte d'écart ; en coût standard : compte *purchase price variance*. | Le prix de revient du kg de farine est **réel** (facture), pas le prix commandé. Rejoint l'audit « écart prix » déjà mené (mig 263). | Standard | ◐ |
| D8.4 | **Dimensions financières** | Chaque ligne (DA, BC, réception, facture) porte des dimensions (centre de coût, atelier, site, projet) ; héritage fournisseur → BC → facture ; règles de validation de combinaisons (*account structures*). | Analyse des achats par atelier/boutique sans table dédiée. | Standard | ◐ |
| D8.5 | **Engagements / contrôle budgétaire (Budget control, encumbrance)** | Le BC confirmé crée un **engagement** (pre-encumbrance à la DA, encumbrance au BC) vérifié contre le budget par dimension ; blocage ou avertissement en dépassement. | Avancé pour une PME, mais la notion « reste à engager sur le budget emballages » est utile. | Avancé | ◐ |
| D8.6 | **Coût au débarquement (Landed cost module)** | *Voyages*, conteneurs, **cost types** (fret, douane, assurance), estimation à la commande, imputation au coût du stock au prorata (poids, valeur, volume), régularisation à la facture du transitaire (*cost accrual* puis *actual*). ✅ | Import de chocolat/fruits secs : le prix d'achat seul sous-estime le coût de 15–30 %. | Avancé | ✅ |
| D8.7 | **TVA : déclaration et récupération** | Codes TVA par ligne, TVA non récupérable passée en coût, livre des achats, régime encaissement/débit, prorata. | Déclaration de TVA marocaine (mensuelle/trimestrielle) alimentée par pièce. | Socle | ◐ |
| D8.8 | **Numérotation des pièces et vouchers** | Séquences par type de pièce (BC, réception, facture, paiement), par année/exercice, continues et sans trou pour les pièces fiscales. | Exigence légale ; sous Oracle = `SEQUENCE` + verrou ; en PG = table de compteurs avec `SELECT … FOR UPDATE`. | Socle | ◐ |
| D8.9 | **Rapport de clôture achats (Vendor invoice / purchase reconciliation)** | Rapprochement sous-ledger fournisseur ↔ grand livre 4411 ; rapprochement stock ↔ GL ; liste des réceptions non facturées ; liste des factures non reçues. | C'est précisément ce que la mémoire *Réconciliation legacy↔ledger* couvre. | Standard | ◐ |

### Patterns PostgreSQL (D8)

```sql
-- Matrice de comptabilisation : résolue par spécificité comme les prix (D1.8)
CREATE TABLE posting_profiles (
  id bigserial PRIMARY KEY, posting_type text NOT NULL,   -- 'receipt_accrual','inventory_receipt','purchase_expense','price_variance','charge'
  item_group_id bigint, item_id bigint, vendor_group_id bigint, vendor_id bigint, category_id bigint,
  account text NOT NULL
);
-- Écritures : une pièce = N lignes équilibrées ; immutables
CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY, voucher_no text NOT NULL, posted_on date NOT NULL,
  source_table text NOT NULL, source_id bigint NOT NULL,
  account text NOT NULL, debit numeric(14,2) DEFAULT 0, credit numeric(14,2) DEFAULT 0,
  cost_center_id bigint, site_id bigint, reversal_of bigint REFERENCES ledger_entries(id)
);
-- Numérotation sans trou (équivalent SEQUENCE + verrou)
CREATE TABLE number_sequences (code text, fiscal_year int, last_no int NOT NULL DEFAULT 0, PRIMARY KEY (code, fiscal_year));
CREATE FUNCTION fn_next_number(p_code text, p_year int) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v int; BEGIN
  INSERT INTO number_sequences VALUES (p_code, p_year, 0) ON CONFLICT DO NOTHING;
  UPDATE number_sequences SET last_no = last_no + 1 WHERE code=p_code AND fiscal_year=p_year RETURNING last_no INTO v;
  RETURN format('%s-%s-%s', p_code, p_year, lpad(v::text, 5, '0'));
END $$;
-- FNP à une date : réceptions postées non facturées, valorisées au prix BC
CREATE VIEW v_accrued_purchases AS
SELECT prl.id, pr.received_at, pol.po_id, (prl.qty_stock_uom - coalesce(inv.qty,0)) * (pol.line_amount / nullif(pol.qty_ordered_stock_uom,0)) AS accrued_amount
FROM product_receipt_lines prl JOIN product_receipts pr ON pr.id=prl.receipt_id JOIN purchase_order_lines pol ON pol.id=prl.po_line_id
LEFT JOIN LATERAL (SELECT sum(vil.qty) qty FROM vendor_invoice_lines vil JOIN vendor_invoices vi ON vi.id=vil.invoice_id WHERE vil.receipt_line_id=prl.id AND vi.status='posted') inv ON true
WHERE pr.posted_at IS NOT NULL;
```

---

## D9 — Pilotage & analytique

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Vérif. |
|---|---|---|---|---|---|
| D9.1 | **Balance âgée fournisseurs (Vendor aging)** | Par fournisseur : montants ouverts répartis en tranches (`Non échu / 0-30 / 31-60 / 61-90 / >90`) sur **date d'échéance ou date de pièce**, à une date de référence ; snapshot stocké (*aging period definitions*). | Priorise les paiements ; indicateur de tension fournisseur. | Socle | ◐ |
| D9.2 | **Espace de travail Achats (Purchase order preparation / receipt / follow-up workspaces)** | Listes d'action : BC à confirmer, en attente d'approbation, en retard de livraison, réceptions du jour, lignes avec reliquat, factures en attente de rapprochement, factures avec écart. | Le « bureau » de l'acheteur : tout ce qui bloque, sans requête. | Standard | ◐ |
| D9.3 | **Analyse des dépenses (Spend analysis)** | Montants engagés/reçus/facturés par catégorie, fournisseur, période, dimension ; Power BI embarqué (*Purchase spend analysis*). | Top 10 fournisseurs, part des ingrédients vs emballages vs charges. | Standard | ◐ |
| D9.4 | **Performance fournisseur (OTIF, qualité)** | Taux de livraison à l'heure (date confirmée vs reçue), taux de complétude, taux de rejet qualité, écarts prix factures ; combiné à l'évaluation D3.5. | Base objective de la revue fournisseurs. | Standard | ◐ |
| D9.5 | **Historique des prix d'achat par article** | Toutes les lignes de facture d'un article : prix unitaire ramené à l'unité de stock (MAD/kg), par fournisseur, tendance. | « La farine a pris 12 % en 6 mois » : utile au coût de revient des recettes. | Socle | ◐ |
| D9.6 | **Rapport des engagements ouverts (Open purchase orders / committed cost)** | Montant des BC confirmés non reçus et des réceptions non facturées, par fournisseur et par compte. | Dette réelle = 4411 + FNP + engagements. | Standard | ◐ |
| D9.7 | **Statistiques de délais (Lead time analysis)** | Délai réel commande→réception par article-fournisseur, mise à jour suggérée du délai paramétré. | Nourrit la planification (D2.6). | Avancé | ◐ |
| D9.8 | **Alertes et notifications (Alert rules)** | Règles « quand champ X change / date Y approche » → notification : BC en retard, facture échue, stock sous minimum, lot proche DLC. | Pattern générique (règle + événement) plutôt que N widgets ad hoc. | Standard | ◐ |

### Patterns PostgreSQL (D9)

```sql
-- Balance âgée à une date : fonction table (pas de table de snapshot tant que le volume est faible)
CREATE FUNCTION fn_vendor_aging(p_asof date) RETURNS TABLE (vendor_id bigint, not_due numeric, d0_30 numeric, d31_60 numeric, d61_90 numeric, d90p numeric) LANGUAGE sql STABLE AS $$
  SELECT vendor_id,
    sum(remaining) FILTER (WHERE due_date >= p_asof),
    sum(remaining) FILTER (WHERE p_asof - due_date BETWEEN 1 AND 30),
    sum(remaining) FILTER (WHERE p_asof - due_date BETWEEN 31 AND 60),
    sum(remaining) FILTER (WHERE p_asof - due_date BETWEEN 61 AND 90),
    sum(remaining) FILTER (WHERE p_asof - due_date > 90)
  FROM v_vendor_open_items WHERE posted_on <= p_asof AND remaining <> 0 GROUP BY vendor_id $$;

-- Prix d'achat normalisé par unité de stock (MAD/kg) — vue matérialisée rafraîchie après post facture
CREATE MATERIALIZED VIEW mv_item_purchase_prices AS
SELECT pol.item_id, vi.vendor_id, vi.invoice_date, vil.amount / nullif(vil.qty,0) AS price_per_stock_uom
FROM vendor_invoice_lines vil JOIN vendor_invoices vi ON vi.id=vil.invoice_id JOIN purchase_order_lines pol ON pol.id=vil.po_line_id
WHERE vi.status='posted' AND NOT vi.is_credit_note;
```

---

## D10 — Transverse

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Vérif. |
|---|---|---|---|---|---|
| D10.1 | **Moteur de workflow unique** | Un seul moteur (types : DA, BC, facture, fiche fournisseur, RIB) : étapes, conditions, affectation (utilisateur, rôle, hiérarchie, limite), escalade, délégation, historique, rappels. | Ne pas coder 3 systèmes d'approbation différents. | Standard | ✅ |
| D10.2 | **Pièces immutables + corrections par contre-pièce** | Toute pièce postée (réception, facture, paiement) est en lecture seule ; la correction crée une pièce de sens inverse liée à l'origine (`reversal_of`). | Audit, réconciliation, confiance comptable. | Socle | ◐ |
| D10.3 | **Journal d'audit des champs (Database log / audit trail)** | Journalisation configurable des modifications de champs sensibles (RIB, conditions de paiement, prix, blocage) : ancien/nouveau, qui, quand. | Anti-fraude ; demande récurrente des auditeurs. | Standard | ◐ |
| D10.4 | **Gestion documentaire (Document attachments)** | Notes, fichiers, URL attachés à tout enregistrement (BC, facture, lot) ; types de documents ; restrictions. | Le PDF du fournisseur à côté de la facture saisie. | Socle | ◐ |
| D10.5 | **Gestion d'impression / modèles (Print management)** | Modèle de BC/retour par fournisseur, destination (e-mail, imprimante, archive), copies, langue du fournisseur. | Le BC envoyé est une pièce formelle ; il doit être reproductible à l'identique (version). | Standard | ◐ |
| D10.6 | **Sécurité par rôle et séparation des tâches (Segregation of duties)** | Rôles (acheteur, approbateur, magasinier, comptable AP, trésorier) ; règles SoD : « celui qui crée le BC ne peut pas l'approuver », « celui qui saisit la facture ne peut pas payer ». | Contrôle interne de base ; coût nul si prévu dès le départ. | Socle | ◐ |
| D10.7 | **Multi-sites / entrepôts / entités légales** | Dimension site/entrepôt sur toute ligne ; achats intersociétés (BC → commande de vente miroir). | Lien avec le plan SaaS multi-tenants (tenant → stores). | Standard | ◐ |
| D10.8 | **Codes motif et textes de pièce** | Référentiel unique de motifs (annulation, retour, écart approuvé, blocage) obligatoire sur les actions sensibles. | Analysable, contrairement au champ libre. | Socle | ◐ |
| D10.9 | **Intégration / API (OData, Data entities, Business events)** | Chaque table exposée comme entité ; événements métiers (BC confirmé, facture postée) émis vers l'extérieur. | Permet un mini-portail ou un flux WhatsApp vers le fournisseur sans toucher au cœur. | Avancé | ◐ |
| D10.10 | **Paramètres par module (Procurement parameters / AP parameters)** | Table de paramètres : change management on/off, tolérances par défaut, règle de doublon, post receipt in ledger, règles de numérotation. | Rendre les règles **paramétrables** plutôt que codées. | Socle | ✅ |

### Patterns PostgreSQL (D10)

```sql
-- Audit de champs sensibles : trigger générique JSONB (équivalent d'un trigger d'audit PL/SQL par table, mais écrit une fois)
CREATE TABLE field_audit (id bigserial PRIMARY KEY, table_name text, row_id bigint, changed_at timestamptz DEFAULT now(), changed_by bigint, old_row jsonb, new_row jsonb);
CREATE FUNCTION trg_field_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO field_audit(table_name,row_id,changed_by,old_row,new_row)
  VALUES (TG_TABLE_NAME, NEW.id, current_setting('app.user_id', true)::bigint, to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END $$;
CREATE TRIGGER vendors_audit AFTER UPDATE ON vendors FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION trg_field_audit();

-- Paramètres de module : une ligne par clé, typée
CREATE TABLE module_parameters (module text, key text, value jsonb NOT NULL, PRIMARY KEY (module, key));
INSERT INTO module_parameters VALUES
 ('procurement','change_management_enabled','true'),
 ('ap','default_match_policy','"three_way"'),
 ('ap','price_tolerance_pct','0'),
 ('ap','duplicate_invoice_check','"reject"'),
 ('ap','post_product_receipt_in_ledger','true');

-- Séparation des tâches : contrainte au niveau workflow
ALTER TABLE approval_steps ADD CONSTRAINT no_self_approval CHECK (assigned_to IS DISTINCT FROM (SELECT created_by FROM ...)); -- à implémenter par trigger (CHECK ne peut pas sous-requêter)
```

---

## 11. Synthèse : ce que D365 fait que l'ERP interne ne fait probablement pas encore

| Thème | Pratique D365 | Recommandation pour la refonte |
|---|---|---|
| Statuts du BC | Deux axes (approbation / document) + statut ligne calculé | Abandonner un `status` unique ; ajouter `approval_status`, `doc_status`, statut par ligne |
| Modifications après confirmation | Versions snapshot à chaque approbation | `purchase_order_versions` JSONB ; interdire l'UPDATE direct par trigger |
| Réception | Étape physique (registration) distincte de la pièce comptable (product receipt) ; FNP automatique | Déjà partiellement en place (réception BC) ; ajouter l'accrual et la fermeture explicite du reliquat |
| Quantités | Double quantité (unité achat + unité stock) sur **chaque** ligne de chaque pièce | Garder « 20 sacs » **et** « 500 kg » partout ; cohérent avec la mémoire *Unités d'affichage* |
| Facture | Zone « en attente » + rapprochement 3 voies paramétré par article/fournisseur + tolérances | Table `matching_policies` + statut de rapprochement par ligne |
| Retours | BC de type retour + return action + avoir lettré | Nouveau `order_kind='return'` plutôt qu'un module à part |
| Paiement | Sous-ledger fournisseur + lettrage many-to-many ; `paid_amount` dérivé | Garder le cache mais une seule source d'écriture |
| Charges / frais | Codes de frais ventilés dans le coût de l'article | Table `document_charges` ; alimente le coût réel des recettes |
| Règles | Paramètres et politiques, pas de code | `module_parameters`, `matching_policies`, `signing_limits` |
| Qualité | Ordre qualité déclenché par règle à la réception, lot bloqué tant que non validé | S'appuie sur les lots existants ; `inv_status` sur le lot |

### Capacités à traiter en priorité pour une boulangerie de cette taille (avis)

1. **Socle** (D1.1–D1.4, D1.8–D1.11, D1.13, D2.1, D2.4, D4.1–D4.3, D4.11, D5.2–D5.4, D5.8, D6.1–D6.2, D6.6–D6.8, D6.10, D7.1–D7.2, D7.4–D7.5, D7.9, D8.1, D8.7–D8.8, D9.1, D9.5, D10.2, D10.4, D10.6, D10.8, D10.10) — environ 40 capacités.
2. **Standard à forte valeur locale** : D4.4 (versions), D4.8 (frais → coût), D5.6 (retours), D6.3 (tolérances), D7.3 (proposition de paiement), D7.7 (effets), D8.2 (FNP), D3.1 (3 devis), D3.5 (évaluation), D2.6 (besoin net depuis les plans de production).
3. **Avancé, à différer** : vendor collaboration, landed cost complet, budget control, catalogue punch-out, catch weight, demand forecasting.

---

## Sources consultées (vérification ✅)

- [Purchase order approval and confirmation](https://learn.microsoft.com/en-us/dynamics365/supply-chain/procurement/purchase-order-approval-confirmation)
- [Purchase order statuses and versions (training)](https://learn.microsoft.com/en-us/training/modules/configure-manage-vendor-collaboration-dyn365-supply-chain-mgmt/8-po-versions)
- [Use purchase order change management (training)](https://learn.microsoft.com/en-us/training/modules/process-purchase-orders-dyn365-supply-chain-mgmt/3-use-po-change-mgmnt)
- [Three-way matching policies](https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/three-way-matching-policies)
- [Set up Accounts payable invoice matching validation](https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/tasks/set-up-accounts-payable-invoice-matching-validation)
- [Vendor collaboration with customers](https://learn.microsoft.com/en-in/dynamics365/supply-chain/procurement/vendor-collaboration-work-customers-dynamics-365-operations)
- [Source to pay business process areas](https://learn.microsoft.com/en-ie/Dynamics365/guidance/business-processes/source-to-pay-areas)
- [Automatic application of charges](https://learn.microsoft.com/hr-hr/dynamics365/supply-chain/procurement/automatic-charges-allocation)
- [Turn on the Landed cost module](https://learn.microsoft.com/en-us/dynamics365/supply-chain/landed-cost/landed-cost-enable)
- [Create a purchase return order](https://learn.microsoft.com/en-us/dynamics365/supply-chain/procurement/tasks/create-purchase-return-order)
- [Create vendor returns (training)](https://learn.microsoft.com/en-us/training/modules/process-purchase-orders-dyn365-supply-chain-mgmt/7-create-vendor-returns)
- [Key invoice data into AP system using approval journal](https://learn.microsoft.com/sl-si/dynamics365/finance/accounts-payable/tasks/key-invoice-data-into-ap-system-approval-journal)
- [Accounts payable daily procedures (training)](https://learn.microsoft.com/en-us/training/modules/accounts-payable-daily-procedures-dyn365-finance/1-introduction)
- [Process purchase order invoices in Dynamics 365 Finance (training)](https://learn.microsoft.com/en-us/training/modules/purchase-order-invoices-finance)

Les capacités marquées ◐ correspondent au fonctionnement connu et stable de Dynamics AX 2012 → D365 SCM (noms de tables `PurchTable`, `VendTrans`, `MarkupTrans`, `InventTrans`, etc.) ; elles n'ont pas été re-vérifiées page par page mais ne font pas l'objet de doute raisonnable. La hiérarchie exacte de résolution des politiques de rapprochement (ligne BC > article×fournisseur > fournisseur > article > entité) est documentée dans la configuration produit mais la source trouvée en ligne était tierce (⚠ sur l'ordre précis entre « article » et « fournisseur »).
