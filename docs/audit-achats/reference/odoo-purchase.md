# Référentiel de capacités — Module Achats (procure-to-pay) selon Odoo 17/18

**Source de référence :** Odoo 17 / 18, apps `purchase`, `purchase_stock`, `purchase_requisition`, `stock`, `stock_account`, `stock_landed_costs`, `quality` / `quality_control` (Enterprise), `account`, `account_3way_match` (Enterprise), `approvals` (Enterprise), `mail`.
**Public :** équipe de refonte du module Achats de l'ERP interne boulangerie-pâtisserie (Maroc, ~40 fournisseurs, ~300 BC/an, ingrédients achetés en sacs/cartons/bidons convertis en kg/L, consommables d'emballage, charges).
**Lecteur principal :** ancien développeur Oracle Forms / PL/SQL — les analogies Oracle sont volontaires.
**Date :** 2026-10-11.

## 0. Méthode et niveau de confiance

- Vérification web effectuée (recherches sur la documentation Odoo 16→master, Odoo eLearning, livres Cybrosys v18 CE/EE, Odoo Apps). Les points marqués **[vérifié]** sont confirmés par au moins une source publique récente ; les points **[connaissance]** reposent sur la connaissance du code source Odoo 16/17/18 (noms de modèles et de champs stables depuis la v14) ; **[à confirmer]** signale un détail de version ou d'édition incertain.
- Édition : **CE** = Community, **EE** = Enterprise. Sauf mention, la capacité existe en CE.
- Niveau : **socle** = indispensable à tout module Achats crédible ; **standard** = attendu d'un ERP mature ; **avancé** = différenciant, à faire si le besoin est démontré.
- Convention de nommage Odoo → analogie Oracle : un *modèle* (`purchase.order`) = une table + son package PL/SQL ; un champ *computed stored* = colonne alimentée par trigger ; un champ *computed non-stored* = colonne de vue ; une *action serveur* = procédure ; le *chatter* = table d'audit journalisée par trigger + mails ; une *route* = règle de workflow (`stock.rule`) jouant le rôle d'un moteur de règles.

## 1. Vue d'ensemble du cycle Odoo (procure-to-pay)

```
Besoin ─┬─ Règle de réappro (stock.warehouse.orderpoint)  ─┐
        ├─ Rapport de réassort / MTO (stock.rule buy)      ├─► RFQ (purchase.order, state=draft)
        ├─ Demande manuelle / Approvals (EE)                │        │ action_rfq_send → state=sent
        └─ Accord-cadre / appel d'offres                   ┘        │ button_confirm → state=purchase (ou to approve)
                                                                     ▼
                                   Réception (stock.picking IN) ◄── purchase.order (state=purchase, puis done/locked)
                                   lots, DLC, FEFO, qualité, reliquats
                                                                     │ qty_received / qty_invoiced par ligne
                                                                     ▼
                                   Facture fournisseur (account.move in_invoice) ← politique de contrôle (ordered/received)
                                   rapprochement 3 voies (EE), landed costs, GR/IR (anglo-saxon)
                                                                     ▼
                                   Paiement (account.payment), échéances, relances, remises, lettrage
```

### Statuts canoniques

| Modèle | Champ | Valeurs |
|---|---|---|
| `purchase.order` | `state` | `draft` (RFQ) → `sent` (RFQ envoyée) → `to approve` (si seuil d'approbation) → `purchase` (BC confirmé) → `done` (verrouillé) ; `cancel` |
| `purchase.order` | `invoice_status` | `no` (rien à facturer), `to invoice` (quantités en attente), `invoiced` (tout facturé) — calculé à partir des lignes |
| `purchase.order` | `receipt_status` (v17+) | `pending`, `partial`, `full` |
| `stock.picking` | `state` | `draft`, `waiting`, `confirmed`, `assigned` (prêt), `done`, `cancel` |
| `account.move` | `state` / `payment_state` | `draft`, `posted`, `cancel` / `not_paid`, `in_payment`, `partial`, `paid`, `reversed` |
| `account.move` | `release_to_pay` (EE 3-way) | `yes`, `no`, `exception` |

---

## D1 — Référentiel fournisseurs & données d'achat

Odoo n'a pas de table « fournisseur » : un fournisseur est un `res.partner` (table unique clients/fournisseurs/contacts, comme un `PARTIES` générique) distingué par `supplier_rank > 0`. Les données d'achat par produit vivent dans `product.supplierinfo` (« liste de prix fournisseur »), **pas** sur le produit lui-même.

| # | Capacité | Description précise (modèles, champs, règles) | Pourquoi c'est important | Niveau | Conf. |
|---|---|---|---|---|---|
| D1.1 | Fiche fournisseur unifiée | `res.partner` : `is_company`, `parent_id` (contacts/adresses enfants type `contact`, `invoice`, `delivery`), `vat` (ICE/IF au Maroc), `supplier_rank`, `property_supplier_payment_term_id` (conditions de paiement par défaut), `property_purchase_currency_id`, `property_account_payable_id` (compte 4411 fournisseur auxiliaire), `receipt_reminder_email` + `reminder_date_before_receipt` (relance automatique avant date de réception), `purchase_warn` + `purchase_warn_msg` (voir D1.8), `buyer_id` (acheteur attitré, v17+). Onglet **Achats** sur la fiche qui regroupe tout ça. | Un seul référentiel tiers ; les valeurs par défaut (délai de paiement, compte) descendent automatiquement sur BC et facture. | socle | vérifié/connaissance |
| D1.2 | Vendor pricelist (`product.supplierinfo`) | Table N lignes par produit : `partner_id` (fournisseur), `product_tmpl_id` / `product_id` (variante optionnelle), `product_name` + `product_code` (désignation et **référence article chez le fournisseur**), `min_qty` (quantité minimale), `price` (prix pour 1 UoM d'achat), `currency_id`, `date_start` / `date_end` (validité), `delay` (délai de livraison en jours), `sequence` (ordre de préférence), `discount` (v17+), `company_id`. Le 1er fournisseur par `sequence` est le « fournisseur principal ». | C'est le pivot : sélection automatique du fournisseur en réassort, prix proposé sur la ligne BC, délai → date prévue, code article fournisseur imprimé sur le BC. | socle | vérifié |
| D1.3 | Sélection du prix selon qté/date | À la saisie d'une ligne BC, `_select_seller(partner, quantity, date, uom)` cherche la ligne supplierinfo du fournisseur dont `min_qty <= qté` et la date dans la validité, en prenant la plus spécifique (variante avant modèle) puis la `sequence` la plus basse. Prix converti dans l'UoM et la devise du BC. Si rien ne matche : prix = 0 et pas de blocage (avertissement visuel uniquement). | Dégressifs quantitatifs et tarifs saisonniers sans intervention humaine ; chaque BC trace le tarif réellement applicable. | standard | connaissance |
| D1.4 | Mise à jour automatique de la pricelist depuis le BC | À la confirmation du BC, pour chaque ligne sans supplierinfo correspondante, Odoo crée la ligne `product.supplierinfo` (prix, fournisseur, délai, code fournisseur) via `_add_supplier_to_product`, sauf si le groupe de sécurité « Ne pas mettre à jour les prix fournisseur » (`purchase.group_warning_purchase`-like, option *Vendor Price Update* dans les paramètres) le désactive pour l'utilisateur. Jamais d'écrasement d'une ligne existante : seule une ligne manquante est ajoutée. | Le référentiel s'auto-alimente : après 6 mois le catalogue prix est complet sans saisie dédiée. | standard | connaissance |
| D1.5 | UoM d'achat ≠ UoM de stock | `product.template.uom_po_id` (unité d'achat, ex. *Sac 25 kg*) distincte de `uom_id` (unité de stock, *kg*). Les deux doivent appartenir à la même **catégorie d'UoM** (`uom.category`) ; la conversion est un `factor` fixe sur `uom.uom`. La ligne BC est saisie en `product_uom` (achat), la réception convertit en unité de stock, la facture conserve l'UoM de la ligne. | Correspond exactement au besoin « sacs/cartons/bidons → kg/L ». Odoo ne gère **pas** un contenant à poids variable : c'est à vous d'ajouter `qty_per_container` (cf. vos migrations 225/226). | socle | vérifié |
| D1.6 | Onglet Achats du produit | `product.template` : `purchase_ok` (achetable), `seller_ids` (one2many vers supplierinfo affichée en liste éditable **sur la fiche produit**), `purchase_method` (politique de facturation `purchase`=ordered / `receive`=received, cf. D6), `supplier_taxes_id` (TVA achat par défaut), `description_purchase` (texte imprimé sur le BC), `purchase_line_warn`. | Tout ce qui pilote l'achat est sur la fiche produit, l'acheteur ne cherche pas dans trois écrans. | socle | vérifié |
| D1.7 | Catégories produit & comptes | `product.category` : `property_account_expense_categ_id`, `property_account_income_categ_id`, `property_stock_account_input_categ_id` / `output`, `property_stock_valuation_account_id`, `property_cost_method` (standard / average / fifo), `property_valuation` (manual / real_time). Le compte de charge peut être surchargé sur le produit (`property_account_expense_id`). | Le routage comptable (601 matières vs 612 consommables vs 613 charges) descend de la catégorie — équivalent de votre `expense_categories` unifié. | socle | connaissance |
| D1.8 | Avertissements fournisseur / produit | Option « Avertissements » : `res.partner.purchase_warn` ∈ {`no-message`, `warning`, `block`} + `purchase_warn_msg` ; idem `product.template.purchase_line_warn`. `warning` affiche une popup non bloquante à la sélection ; `block` vide le champ et interdit la saisie. Idem sur `sale_warn`, `invoice_warn`, `picking_warn`. | Fournisseur en litige, produit en fin de vie, allergène sous surveillance : l'information arrive au moment de l'acte, pas dans un document oublié. | standard | vérifié |
| D1.9 | Fournisseur = fabricant ou distributeur, multi-contacts | Contacts enfants (`type='contact'`) avec `function`, `email`, `phone` ; adresse de facturation distincte (`type='invoice'`). Le BC est adressé à `partner_id`, la facture à `partner_id.commercial_partner_id`. | Un commercial et une comptabilité fournisseur ne sont pas la même personne ; les relances paiement vont au bon destinataire. | standard | connaissance |
| D1.10 | Fournisseur archivé (soft delete) | `active = False` sur `res.partner` et `product.supplierinfo` : disparaît des recherches, reste joignable depuis l'historique (BC, factures). Interdiction de suppression physique si des écritures comptables existent (`ondelete='restrict'`). | Traçabilité comptable : un fournisseur avec historique ne se supprime jamais (règle d'audit). | socle | connaissance |
| D1.11 | Conditions de paiement (`account.payment.term`) | Lignes `account.payment.term.line` : `value` (`percent`/`fixed`), `nb_days`, `delay_type` (`days_after`, `days_after_end_of_month`, `days_end_of_month_on_the`…), `discount_percentage` + `discount_days` (escompte, v16+). Un terme peut produire plusieurs échéances (30 % à 0 j, 70 % à 30 j fin de mois). | Les échéances fournisseur se calculent automatiquement à la facture (`invoice_date_due`, lignes `account.move.line` avec `date_maturity`). | socle | connaissance |

**Pattern PostgreSQL réutilisable — supplierinfo**

```sql
CREATE TABLE supplier_products (            -- product.supplierinfo
  id              bigserial PRIMARY KEY,
  supplier_id     bigint NOT NULL REFERENCES suppliers(id),
  purchasable_kind text   NOT NULL,          -- 'ingredient' | 'packaging' (cf. fn_purchasable_kind)
  purchasable_id  bigint NOT NULL,           -- ingredients.id ou packaging_items.id
  supplier_code   text,                      -- product_code : référence chez le fournisseur
  supplier_label  text,                      -- product_name
  purchase_uom    text   NOT NULL,           -- 'sac', 'carton', 'bidon', 'kg'
  qty_per_uom     numeric(12,4) NOT NULL DEFAULT 1,  -- kg (ou L) par contenant
  min_qty         numeric(12,3) NOT NULL DEFAULT 0,
  unit_price      numeric(14,4) NOT NULL,    -- prix HT par purchase_uom
  currency        char(3) NOT NULL DEFAULT 'MAD',
  lead_time_days  integer NOT NULL DEFAULT 1,
  valid_from      date, valid_to date,
  sequence        integer NOT NULL DEFAULT 10,
  active          boolean NOT NULL DEFAULT true,
  CONSTRAINT ck_validity CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX ON supplier_products (purchasable_kind, purchasable_id, supplier_id, min_qty DESC);

-- Sélection « meilleur tarif applicable » (équivalent _select_seller)
SELECT * FROM supplier_products
 WHERE supplier_id = $1 AND purchasable_kind = $2 AND purchasable_id = $3
   AND active AND min_qty <= $4
   AND ($5::date BETWEEN COALESCE(valid_from,'-infinity') AND COALESCE(valid_to,'infinity'))
 ORDER BY min_qty DESC, sequence ASC LIMIT 1;
```

---

## D2 — Besoins & demandes d'achat

Odoo ne possède pas d'objet « demande d'achat » natif en CE : le besoin est exprimé soit par une **règle de réapprovisionnement** (min/max), soit par une **demande MTO** (route *Make To Order* déclenchée par un OF ou une commande client), soit par une saisie manuelle de RFQ, soit (EE) par l'app **Approvals** avec une catégorie « Purchase ».

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Conf. |
|---|---|---|---|---|---|
| D2.1 | Règle de réappro min/max | `stock.warehouse.orderpoint` : `product_id`, `location_id`, `warehouse_id`, `product_min_qty`, `product_max_qty`, `qty_multiple` (arrondi par lot de commande, ex. multiple de 25 kg = 1 sac), `trigger` ∈ {`auto`, `manual`}, `route_id` (forcer la route Achat / Fabrication), `supplier_id` (v16+, forcer le fournisseur), `lead_days_date` (date de besoin = aujourd'hui + délai fournisseur + délai de sécurité), `qty_forecast` (prévision à `lead_days_date`), `qty_to_order` (calculé : si prévision < min alors max − prévision, arrondi à `qty_multiple`), `snoozed_until` (reporter). Scheduler nocturne (`procurement.group.run_scheduler`) exécute les règles `auto`. | Transforme le stock économat en moteur de besoins ; le `qty_multiple` est exactement votre « on commande par sac entier ». | socle | vérifié |
| D2.2 | Rapport de réassort (Replenishment) | Vue liste éditable des orderpoints `trigger=manual` **+ lignes virtuelles créées à la volée** pour tout produit en rupture prévisionnelle sans règle (min=max=0). Colonnes : en stock, prévu, à commander, fournisseur proposé, route, bouton **Commander** (`action_replenish`) → crée/complète une RFQ par fournisseur, bouton **Snooze**, filtre « à réapprovisionner ». Les lignes virtuelles sont nettoyées à chaque recalcul. | Écran unique du matin pour l'acheteur ; les besoins non anticipés y remontent sans configuration. | standard | vérifié |
| D2.3 | Regroupement automatique en RFQ | `stock.rule` action `buy` → `_run_buy` : cherche une RFQ `draft` du même fournisseur, même société, même `picking_type`, même devise et (si « regroupement par date ») même fenêtre `group_days` (v17 : `purchase.order.date_order` arrondi) ; sinon crée une RFQ. Ligne existante pour le même produit → la quantité est **ajoutée** ; `origin` concatène les sources (« OP/00012, MO/00034 »). | Évite 15 RFQ pour 15 produits chez le même grossiste ; `origin` garde la traçabilité du besoin. | standard | connaissance |
| D2.4 | Délais (lead times) | `product.supplierinfo.delay` (délai fournisseur), `res.company.po_lead` (délai de sécurité achat, « Security Lead Time for Purchase »), `res.company.days_to_purchase` (délai interne pour passer la commande, v15+), `stock.rule.delay`. `date_planned` de la ligne BC = `date_order` + `delay`. L'orderpoint anticipe : `lead_days = delay + po_lead + days_to_purchase`. | Sans délais, min/max déclenche trop tard ; la DLC des matières premières impose de ne pas déclencher trop tôt non plus. | standard | vérifié |
| D2.5 | Route MTO / réassort à la demande | Route `Replenish on Order (MTO)` sur le produit : une consommation planifiée (OF, commande) crée directement la procuration → RFQ sans passer par le stock. Champ `procure_method` ∈ {`make_to_stock`, `make_to_order`} sur `stock.rule`. | Pour les achats « pour une commande » (gâteau de mariage, événement) : le besoin suit la commande client, pas le stock. | avancé | connaissance |
| D2.6 | Prévision / rapport de stock prévisionnel | `report.stock.forecast` / vue **Prévision** du produit : stock à date = en stock + entrées prévues (BC confirmés non reçus, `stock.move` état `assigned/confirmed`) − sorties prévues. Le besoin de l'orderpoint utilise `virtual_available` à `lead_days_date`, pas `qty_available`. | C'est la différence entre « j'ai 20 kg » et « j'aurai −30 kg jeudi » ; c'est la base de votre plan de production → besoins. | standard | connaissance |
| D2.7 | Demande d'achat formalisée (EE Approvals) | `approval.request` catégorie *Purchase* avec `has_product=required`, lignes `approval.product.line` (`product_id`, `quantity`, `product_uom_id`, `seller_id`) ; `approver_ids` (1 à N approbateurs, séquentiels ou non, `minimum_approvers`), statuts `new → pending → approved/refused → cancel`. Bouton **Créer RFQ** une fois approuvée (`action_create_purchase_orders`) : regroupe par fournisseur, lie `purchase_order_line_id` sur chaque ligne. | Sépare demandeur (chef pâtissier) et acheteur ; l'historique de la demande survit au BC. Équivalent natif de votre `purchase_requests` + statut `received` (mig 271). | standard | connaissance |
| D2.8 | Besoins depuis la production (MRP) | `mrp.production` confirmé → `stock.move` composants → si rupture et route Achat : procuration automatique ; onglet « Composants » affiche la disponibilité ; `components_availability_state`. Le BC généré porte `origin = 'MO/000xx'`. | Lien plan de production ↔ besoins d'achat : chez vous, le plan confirmé calcule les besoins et le BSI ; chez Odoo, c'est le même mécanisme via `stock.rule`. | standard | connaissance |
| D2.9 | Alerte rupture & dates de besoin | Sur chaque `stock.move`, `date_deadline` (date limite métier) distincte de `date` (prévue) ; l'écart alimente les alertes « en retard » (`delay_alert_date`) et les activités planifiées. | Une matière qui arrive après la cuisson ne sert à rien : la date limite est portée par le besoin, pas par le fournisseur. | avancé | connaissance |

**Pattern PostgreSQL — règle de réassort**

```sql
CREATE TABLE reorder_rules (
  id bigserial PRIMARY KEY,
  purchasable_kind text NOT NULL, purchasable_id bigint NOT NULL,
  zone_id bigint REFERENCES stock_zones(id),
  min_qty numeric(12,3) NOT NULL, max_qty numeric(12,3) NOT NULL,
  qty_multiple numeric(12,3) NOT NULL DEFAULT 1,
  trigger text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','auto')),
  preferred_supplier_id bigint REFERENCES suppliers(id),
  snoozed_until date,
  CHECK (max_qty >= min_qty)
);
-- qty_to_order = CASE WHEN forecast < min THEN ceil((max - forecast)/qty_multiple)*qty_multiple ELSE 0 END
-- où forecast = stock + BC confirmés non reçus − besoins plans confirmés à horizon lead_days
```

---

## D3 — Sourcing & approbation

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Conf. |
|---|---|---|---|---|---|
| D3.1 | RFQ (demande de prix) | `purchase.order` en `state=draft` ; bouton **Envoyer par e-mail** (`action_rfq_send`, template `purchase.email_template_edi_purchase`) → `state=sent` et PDF « Request for Quotation » joint ; bouton **Imprimer RFQ**. Le fournisseur n'a pas de portail de réponse natif en CE : l'acheteur saisit le prix reçu. | Formalise la consultation ; la RFQ et le BC sont le **même enregistrement** (même numéro `P000xx`), donc pas de re-saisie. | socle | vérifié |
| D3.2 | RFQ alternatives & comparaison | Option « Purchase Alternatives » (`purchase_requisition`, v16+) : onglet **Alternatives** sur la RFQ, `alternative_po_ids` (même `purchase.group`), bouton **Créer une alternative** (choix fournisseur, case *Copier les produits*), **Lier une RFQ existante**, vue **Comparer les lignes** (`purchase.order.line` groupées par produit avec prix, qté, total ; bouton *Choisir* par ligne → `action_choose` annule les lignes concurrentes ou toute la RFQ concurrente). | Trois devis de farine comparés ligne à ligne, choix mixte possible (la farine chez A, le sucre chez B) sans ressaisie. | standard | vérifié |
| D3.3 | Accord-cadre (blanket order) | `purchase.requisition` type `blanket_order` : `vendor_id`, `date_start`/`date_end`, `currency_id`, lignes `purchase.requisition.line` (`product_id`, `product_qty` prévue, `price_unit` négocié, `qty_ordered` cumulée calculée). Statuts `draft → ongoing → done/cancel` (v18 : `confirmed`, `closed`). Bouton **Nouvelle commande** pré-remplit un BC ; le prix de l'accord **prend le pas** sur supplierinfo tant qu'il est `ongoing` et la quantité restante se décrémente. | Contrat annuel farine/sucre à prix bloqué, appels de livraison successifs : c'est le mode d'achat typique d'une boulangerie avec un grossiste. | standard | vérifié |
| D3.4 | Appel d'offres (call for tender) | `purchase.requisition` type `purchase_template` (anciennement `tender`) : `exclusive` ∈ {`exclusive`, `multiple`} ; plusieurs RFQ rattachées (`requisition_id`) ; confirmer l'une d'elles **annule automatiquement** les autres en mode exclusif. | Mise en concurrence tracée pour les achats d'équipement ou les gros marchés annuels. | avancé | vérifié |
| D3.5 | Seuil d'approbation (double validation) | Paramètre `purchase.po_double_validation` ∈ {`one_step`, `two_step`} + `po_double_validation_amount` (montant HT, en devise société). Si `two_step` et `amount_total > seuil` et l'utilisateur n'est pas dans le groupe `purchase.group_purchase_manager` → `button_confirm` passe en `to approve` ; le manager a le bouton **Approuver** (`button_approve`). Un seul niveau natif ; multi-niveaux via Approvals (EE) ou module tiers. | Contrôle interne proportionné : un BC d'emballages à 800 MAD se confirme seul, un four à 60 000 MAD attend le gérant. | standard | vérifié |
| D3.6 | Rôles & droits | Groupes `purchase.group_purchase_user` (créer/confirmer sous seuil), `group_purchase_manager` (approuver, config, verrouiller/déverrouiller), `stock.group_stock_user` (recevoir), `account.group_account_invoice` (facturer). Record rules par société. | Séparation des tâches acheteur / magasinier / comptable, exigence d'audit classique. | socle | connaissance |
| D3.7 | Statusbar cliquable (UX) | En-tête du formulaire : `<field name="state" widget="statusbar" statusbar_visible="draft,sent,purchase"/>` + boutons contextuels (`invisible` selon état). Les états `to approve`, `done`, `cancel` n'apparaissent que si atteints. L'utilisateur voit où il en est et quelles actions sont possibles. | Modèle à reprendre pour votre `ui-timeline` : un seul composant d'état, les boutons d'action découlent de l'état. | socle | connaissance |
| D3.8 | Acheteur responsable | `purchase.order.user_id` (acheteur, défaut = créateur ou `partner.buyer_id`), `company_id`, `picking_type_id` (entrepôt de destination). Filtre « Mes commandes ». | Portefeuille par acheteur, indicateurs par acheteur. | standard | connaissance |
| D3.9 | Verrouillage des BC confirmés | Paramètre `purchase.po_lock` ∈ {`edit`, `lock`} : si `lock`, `button_confirm` passe directement en `done` (verrouillé, lecture seule) ; boutons **Verrouiller** / **Déverrouiller** (manager) ; `state='done'` est l'état « locked », pas une « clôture » : les réceptions/factures restent possibles. | Empêche la modification d'un BC après envoi au fournisseur ; la version envoyée est la version engagée. | standard | vérifié |

---

## D4 — Commande (bon de commande)

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Conf. |
|---|---|---|---|---|---|
| D4.1 | En-tête `purchase.order` | `name` (séquence `P%05d`, `ir.sequence` par société), `partner_id`, `partner_ref` (**référence du fournisseur** — n° de devis ou de BL, recherché dans la liste), `date_order` (date de confirmation, réécrite à `button_confirm`), `date_approve`, `date_planned` (date de réception prévue = min/max des lignes, éditable → propage aux lignes), `currency_id`, `currency_rate`, `payment_term_id`, `fiscal_position_id`, `incoterm_id`, `notes` (conditions imprimées), `origin`, `dest_address_id` (dropship), `picking_type_id`, `effective_date` (date réelle de 1re réception), `receipt_reminder_email` + `reminder_date_before_receipt` (hérités du fournisseur), `mail_reminder_confirmed` (le fournisseur a cliqué « confirmer la date »). | La `partner_ref` est la clé du rapprochement avec la facture reçue ; `effective_date` vs `date_planned` alimente le taux de ponctualité. | socle | vérifié |
| D4.2 | Ligne `purchase.order.line` | `product_id`, `name` (désignation libre, préremplie par `description_purchase` + code fournisseur), `product_qty` (commandée, en `product_uom`), `product_uom`, `product_uom_qty` (**calculée en UoM de stock**), `price_unit`, `discount` (v17+), `taxes_id`, `date_planned`, `price_subtotal` / `price_tax` / `price_total`, `qty_received_method` ∈ {`manual`, `stock_moves`}, **`qty_received`**, **`qty_invoiced`**, `qty_to_invoice`, `qty_received_manual`, `display_type` (`line_section`, `line_note` : sections et notes dans la grille), `sequence`, `analytic_distribution` (json, v16+), `move_ids`, `invoice_lines`, `orderpoint_id`, `product_packaging_id` + `product_packaging_qty`. | **Les 3 compteurs par ligne (commandé / reçu / facturé) sont la colonne vertébrale du P2P** : ils déterminent les reliquats, le statut de facturation, les écarts. | socle | vérifié |
| D4.3 | Calcul de `qty_received` | Si le produit est stockable (`detailed_type='product'`) : somme des `stock.move` `done` liés à la ligne, entrées − retours (`to_refund=True`), convertie en `product_uom` de la ligne. Si service/consommable non suivi : `qty_received_method='manual'` et saisie manuelle (bouton sur la ligne). Recalculé par `@api.depends('move_ids.state','move_ids.quantity')` — équivalent trigger AFTER UPDATE sur les mouvements. | Jamais saisi deux fois : la réception physique pilote la quantité reçue ; les retours la diminuent. | socle | connaissance |
| D4.4 | Calcul de `qty_invoiced` / `invoice_status` | `qty_invoiced` = Σ `account.move.line.quantity` des factures `posted` (ou `draft`) liées (`purchase_line_id`), factures d'avoir en négatif, converti en UoM de ligne. `qty_to_invoice` = (`product_qty` si politique *ordered*, `qty_received` si *received*) − `qty_invoiced`. `invoice_status` du BC : `to invoice` si une ligne a `qty_to_invoice ≠ 0` ; `invoiced` si toutes à 0 et au moins une facture ; sinon `no`. | Le bouton **Créer facture** sait exactement quoi facturer ; l'onglet « à facturer » du menu Achats est une simple requête sur ce statut. | socle | vérifié |
| D4.5 | Emballages d'achat (`product.packaging`) | `product.packaging` : `name` (*Carton de 12*), `qty` (12 unités de stock), `purchase=True`. Sur la ligne : `product_packaging_id`, `product_packaging_qty` ; la saisie de 3 cartons donne 36 unités, et inversement. | Alternative plus souple que l'UoM d'achat quand un même produit vient en plusieurs conditionnements (sac 25 kg et sac 50 kg). | standard | connaissance |
| D4.6 | Impression / envoi du BC | Rapport QWeb `purchase.report_purchaseorder` (logo société, adresses, référence fournisseur, lignes avec code article fournisseur, date de réception prévue par ligne, totaux HT/TVA/TTC, conditions de paiement, incoterm, notes), bouton **Envoyer BC par e-mail** (`action_rfq_send` avec template BC) qui journalise l'envoi dans le chatter. | Document contractuel versionné : chaque envoi laisse une trace avec le PDF attaché. | socle | vérifié |
| D4.7 | Confirmation = génération des réceptions | `button_confirm` → `_create_picking` : un `stock.picking` type réception (`picking_type_id`), un `stock.move` par ligne stockable (`product_uom_qty` en UoM stock, `date` = `date_planned`, `purchase_line_id`), `procurement.group` nommé comme le BC, `location_dest_id` = stock principal de l'entrepôt. Modification de quantité **après confirmation** → ajuste le move ou en crée un nouveau ; baisse sous la quantité déjà reçue interdite (`UserError`). Ajout de ligne après confirmation → nouveau move dans la réception ouverte. | Le magasinier reçoit une liste d'attendus sans ressaisie ; le BC et la réception restent cohérents après avenant. | socle | connaissance |
| D4.8 | Annulation | `button_cancel` : interdit si une facture `posted` existe ; annule les `stock.move` non faits (les faits restent) ; passe `state=cancel` ; **Remettre en brouillon** (`button_draft`) possible. Les réceptions déjà faites restent en stock (il faut un retour). | Un BC ne disparaît jamais, il s'annule (traçabilité). | socle | connaissance |
| D4.9 | Smart buttons | En haut à droite du BC : **Réceptions** (`incoming_picking_count`), **Factures** (`invoice_count`), **Alternatives**, et (EE) **Demandes d'approbation**. Chaque bouton ouvre la liste filtrée des enregistrements liés. | Navigation en 1 clic vers les documents dérivés — c'est le pattern UX le plus imité d'Odoo. | socle | vérifié |
| D4.10 | Date de réception « confirmée par le fournisseur » | Mail de rappel (cron `purchase.ir_cron_send_reminder_mail`) `reminder_date_before_receipt` jours avant `date_planned` ; le mail contient un lien « Confirmer la date » qui pose `mail_reminder_confirmed=True` ; ou « Mettre à jour la date » (portail, v16+). | Réduit les ruptures dues à un fournisseur silencieux ; économique à implémenter (un e-mail + un endpoint signé). | avancé | vérifié |
| D4.11 | Devises & taux | `currency_id` libre par BC, `currency_rate` figé à la date de commande ; montants société calculés (`amount_total_cc`). | Importations d'ingrédients (chocolat, fruits secs) en EUR/USD. | avancé | connaissance |
| D4.12 | Positions fiscales | `account.fiscal.position` : remplacement de taxes/comptes (ex. fournisseur auto-entrepreneur sans TVA, import). Appliquée automatiquement depuis le fournisseur. | Évite les erreurs de TVA à la ligne. | standard | connaissance |

**Pattern PostgreSQL — lignes de BC avec compteurs**

```sql
CREATE TABLE purchase_order_lines (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  purchasable_kind text NOT NULL, purchasable_id bigint NOT NULL,
  supplier_product_id bigint REFERENCES supplier_products(id),  -- tarif appliqué (traçabilité)
  label text NOT NULL,
  qty_ordered   numeric(12,3) NOT NULL,            -- en purchase_uom (sacs)
  purchase_uom  text NOT NULL, qty_per_uom numeric(12,4) NOT NULL,
  qty_ordered_base numeric(14,4) GENERATED ALWAYS AS (qty_ordered * qty_per_uom) STORED, -- kg
  unit_price numeric(14,4) NOT NULL, discount_pct numeric(5,2) DEFAULT 0,
  vat_rate numeric(5,2) NOT NULL,
  date_planned date,
  qty_received  numeric(12,3) NOT NULL DEFAULT 0,  -- maintenu par trigger sur receipt_lines
  qty_invoiced  numeric(12,3) NOT NULL DEFAULT 0,  -- maintenu par trigger sur invoice_items
  bill_policy text NOT NULL DEFAULT 'received' CHECK (bill_policy IN ('ordered','received')),
  CHECK (qty_received >= 0 AND qty_invoiced >= 0)
);
-- qty_to_invoice = CASE bill_policy WHEN 'ordered' THEN qty_ordered ELSE qty_received END - qty_invoiced
-- invoice_status du BC = agrégat des lignes (vue ou colonne recalculée par trigger)
```

Analogie Oracle : `qty_received` / `qty_invoiced` sont des *colonnes dénormalisées maintenues par trigger* (comme un `AFTER INSERT OR UPDATE OR DELETE ON receipt_lines FOR EACH ROW` qui refait `UPDATE purchase_order_lines SET qty_received = (SELECT SUM…)`). Odoo recalcule avec `@api.depends`, ce qui est la même chose côté application.

---

## D5 — Réception & qualité

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Conf. |
|---|---|---|---|---|---|
| D5.1 | Bon de réception (`stock.picking` IN) | `picking_type_id` (code `incoming`), `partner_id`, `origin` (n° BC), `scheduled_date`, `date_deadline`, `date_done`, `state`, `move_ids` (attendus), `move_line_ids` (détail lot/emplacement/quantité réelle), `purchase_id` (lien BC), `carrier_tracking_ref`, `note`. Boutons **Valider** (`button_validate`), **Annuler**, **Imprimer** (bon de réception, étiquettes lots). | Objet unique entre « attendu » et « reçu » ; une réception peut couvrir plusieurs BC (regroupement) ou un BC plusieurs réceptions. | socle | vérifié |
| D5.2 | Réception partielle & reliquats (backorders) | À la validation avec quantités < attendues : popup *Créer un reliquat ?* → **Créer** (nouveau picking `backorder_id` avec le reste, BC reste `receipt_status=partial`), **Pas de reliquat** (le reste est annulé → le BC affiche le manquant mais ne l'attend plus), ou **Annuler**. Politique par type d'opération `create_backorder` ∈ {`ask`, `always`, `never`}. | Les livraisons partielles sont la norme ; le reliquat garde le lien BC pour que `qty_received` reste juste. | socle | vérifié |
| D5.3 | Sur-réception & tolérance | Réception > commandé autorisée (quantité libre sur `move_line.quantity`) ; la différence apparaît sur la ligne BC (`qty_received > product_qty`) et dans le rapprochement facture. Pas de tolérance % native en CE (EE 3-way la gère par exception). | Un sac de 25 kg pesé à 24,6 kg doit pouvoir être reçu tel quel ; l'écart est tracé, pas bloqué. | standard | connaissance |
| D5.4 | Lots / numéros de série | `stock.lot` (ex `stock.production.lot`) : `name`, `product_id`, `ref` (lot fournisseur), `expiration_date`, `use_date` (DLUO), `removal_date`, `alert_date`, `company_id`, `note`, `product_qty` (calculé), `properties` (v17, champs dynamiques). Suivi par produit `tracking` ∈ {`none`, `lot`, `serial`}. Saisie à la réception dans `stock.move.line` (`lot_id` ou `lot_name` créé à la volée), un lot par ligne. Option « Création de lots à la réception » par type d'opération (`use_create_lots`, `use_existing_lots`). | Traçabilité réglementaire (ONSSA) : lot fournisseur ↔ lot interne ↔ production. | socle | vérifié |
| D5.5 | Dates d'expiration automatiques | Module `product_expiry` : sur le produit `use_expiration_date`, `expiration_time` (jours), `use_time`, `removal_time`, `alert_time`. À la création du lot à la réception : `expiration_date = date réception + expiration_time` (surchargeable). Cron quotidien pose une activité « Lot expiré/alerte ». Filtre « Lots expirant ». Blocage/avertissement à la sortie d'un lot expiré (`is_expired`, popup à la validation). | DLC inerte = constat W de votre audit Pesage : chez Odoo, la DLC vit sur le lot et bloque la consommation. | standard | vérifié |
| D5.6 | FEFO / FIFO / LIFO | `product.category.removal_strategy_id` ou par emplacement : `fifo` (date d'entrée `in_date` du quant), `lifo`, `fefo` (`removal_date` puis `in_date`), `closest` (emplacement le plus proche), `least_packages` (v16+). Appliquée à la **réservation** (`stock.quant._get_removal_strategy_order`) : le système propose le lot à sortir, l'utilisateur peut changer. | Pour vous : le pesage propose le lot le plus proche de sa DLC ; vous aviez noté « choix du lot en une action » dans la refonte BSI. | standard | vérifié |
| D5.7 | Points de contrôle qualité (EE) | `quality.point` : `product_ids` / `product_category_ids`, `picking_type_ids` (déclencheur : réception), `measure_frequency_type` ∈ {`all`, `random` (%), `periodical`}, `test_type_id` ∈ {`passfail`, `measure` (avec `norm`, `tolerance_min/max`, `norm_unit`), `instructions`, `picture`, `register_production`, `worksheet` (v17 EE)}, `team_id`, `responsible_id`, `failure_message`. À la validation de la réception → `quality.check` par point/lot (`state`: `none`, `pass`, `fail`), bouton **Contrôles qualité** sur la réception ; **blocage de la validation** si un check `none`/`fail` (`check_quality` → wizard). `quality.alert` (fiche de non-conformité kanban : `stage_id`, `reason_id`, `action_corrective`, `action_preventive`, `partner_id` fournisseur). | Température du beurre à la réception, pH, aspect visuel, DLC résiduelle minimale : c'est votre « acceptation de réception » avec verrous (mig 298) rendue configurable sans code. | avancé | vérifié |
| D5.8 | Retours fournisseur | Sur une réception `done` : bouton **Retour** (`stock.return.picking` wizard) → picking sortant vers le fournisseur (`location_dest_id = supplier`), lignes `to_refund` (case *À rembourser*) : si cochée, `qty_received` de la ligne BC **diminue** et le retour est déductible dans la facture/avoir ; sinon simple remplacement. | Refus partiel (carton écrasé) sans casser le lien avec le BC. Votre « retour/casse pesage » a le même besoin côté économat. | standard | vérifié |
| D5.9 | Emplacement de réception à étapes | Type d'entrée de l'entrepôt `reception_steps` ∈ {`one_step` (Fournisseur → Stock), `two_steps` (→ Zone d'entrée → Stock), `three_steps` (→ Entrée → Contrôle qualité → Stock)}. Pickings chaînés automatiquement par `stock.rule`. | Pour vous : réception → zone « quarantaine/contrôle » → économat, équivalent de vos zones et transferts (`ingredient_stock_zone_transfers`). | avancé | connaissance |
| D5.10 | Mise à jour du stock & valorisation à la réception | Validation → `stock.quant` incrémenté (`quantity`, `lot_id`, `location_id`, `in_date`) ; `stock.valuation.layer` créé (`unit_cost` = prix BC converti en UoM stock, `value`, `remaining_qty`) si valorisation `real_time` ; écriture comptable débit 31x (stock) / crédit *Stock Interim (Received)* si anglo-saxon. Le coût unitaire tient compte du prix BC en devise et de l'UoM (prix du sac / 25 = prix du kg). | Le coût d'achat réel entre dans la valorisation au moment de la réception, pas à la facture ; d'où le compte d'attente GR/IR (D8). | standard | connaissance |
| D5.11 | Réception sans BC | Un `stock.picking` IN peut être créé directement (don, régularisation) ; il n'a pas de `purchase_id` ; valorisé au coût standard/moyen. Un paramètre peut l'interdire par type d'opération. | Rare mais nécessaire ; chez vous l'inventaire physique mensuel régularise sinon. | standard | connaissance |
| D5.12 | Code-barres & Opérations (EE) | App *Barcode* : scan BC → ouvre la réception, scan produit/lot/qté, impression d'étiquettes lot (ZPL/PDF) à la réception (`stock.lot` rapport). | Accélère et fiabilise la réception ; votre mini-PC + balance (pesage) est un équivalent. | avancé | connaissance |
| D5.13 | Scrap / casse à la réception | `stock.scrap` : `product_id`, `lot_id`, `scrap_qty`, `scrap_reason_tag_ids` (v17), `picking_id` source → mouvement vers emplacement virtuel *Scrap*, écriture de perte. | Distingue « reçu puis cassé » de « non reçu » ; l'un se facture, l'autre non. | standard | connaissance |

**Pattern PostgreSQL — réception avec lots et compteurs**

```sql
CREATE TABLE receipts (                           -- stock.picking IN
  id bigserial PRIMARY KEY, number text UNIQUE NOT NULL,
  supplier_id bigint NOT NULL, order_id bigint REFERENCES purchase_orders(id),
  backorder_of_id bigint REFERENCES receipts(id),
  status text NOT NULL CHECK (status IN ('draft','ready','done','cancel')),
  scheduled_date date, done_at timestamptz, supplier_delivery_ref text, received_by bigint
);
CREATE TABLE receipt_lines (                      -- stock.move.line
  id bigserial PRIMARY KEY, receipt_id bigint NOT NULL REFERENCES receipts(id),
  order_line_id bigint REFERENCES purchase_order_lines(id),
  qty_containers numeric(12,3), qty_base numeric(14,4) NOT NULL,   -- sacs + kg réels pesés
  lot_id bigint REFERENCES ingredient_lots(id),                     -- 1 lot par ligne
  is_return boolean NOT NULL DEFAULT false, to_refund boolean NOT NULL DEFAULT true
);
-- trigger AFTER sur receipt_lines (status du receipt = 'done') :
--   UPDATE purchase_order_lines SET qty_received = Σ CASE WHEN is_return AND to_refund THEN -qty ELSE qty END
```

---

## D6 — Facturation fournisseur & rapprochement

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Conf. |
|---|---|---|---|---|---|
| D6.1 | Politique de contrôle des factures | `product.template.purchase_method` ∈ {`purchase` (*quantités commandées* : facturable dès confirmation), `receive` (*quantités reçues* : facturable au fur et à mesure des réceptions)} ; défaut société `purchase.default_purchase_method`. Détermine `qty_to_invoice` (cf. D4.4). | Services et charges : *ordered* ; matières et consommables : *received*. Interdit de payer ce qui n'est pas arrivé. | socle | vérifié |
| D6.2 | Facture depuis le BC | Bouton **Créer facture** (`action_create_invoice`) sur un BC `purchase`/`done` avec `invoice_status='to invoice'` : crée un `account.move` `in_invoice` **brouillon** avec une ligne par ligne BC (`quantity = qty_to_invoice`, `price_unit`, `taxes`, `purchase_line_id`, compte de charge ou *Stock Interim* selon anglo-saxon, `analytic_distribution`), `invoice_origin = P000xx`, `ref = partner_ref`, `payment_term_id`, `invoice_date` vide (à saisir), `purchase_vendor_bill_id`. Plusieurs BC → **une** facture : action de masse *Créer facture* ou champ **Auto-complétion** (`purchase_vendor_bill_id` sur la facture : choisir un BC ajoute ses lignes). | Zéro ressaisie, chaque ligne de facture sait de quelle ligne de BC elle vient : c'est ce qui rend le rapprochement possible. | socle | vérifié |
| D6.3 | Rapprochement 3 voies (EE `account_3way_match`) | Sur `account.move` : `release_to_pay` ∈ {`yes`, `no`, `exception`} calculé par ligne (`can_be_paid` sur `account.move.line`) : *yes* si qté facturée ≤ qté reçue (politique received) ou ≤ qté commandée ; *no* si rien reçu ; *exception* si facturé > reçu ou prix différent du BC ; `release_to_pay_manual` (forçage), `force_release_to_pay`. Filtre « À payer » dans les paiements ; bannière rouge sur la facture. | Le comptable paie uniquement ce qui est commandé **et** reçu **et** facturé au bon prix ; le reste remonte en exception. | avancé | vérifié |
| D6.4 | Écart de prix facture / BC | Ligne de facture avec `price_unit ≠ purchase_line_id.price_unit` → en anglo-saxon, écriture d'écart automatique (`price_diff` → compte *Price Difference* `property_account_creditor_price_difference` (≤ v16) ; en v17+ l'écart est **absorbé dans la valorisation** via une couche `stock.valuation.layer` corrective si la quantité est encore en stock, sinon en charge). | Vous avez déjà « lien produit + écart prix » (mig 260-263) : Odoo le traite au niveau comptable, pas seulement en alerte. | avancé | connaissance |
| D6.5 | Saisie facture sans BC & numérisation | Facture fournisseur créée directement (charges, loyer) ; OCR *Documents/Digitize* (EE, crédits) qui pré-remplit fournisseur, date, lignes, et propose le BC par `partner_ref`. | Factures de charges hors BC : votre « catégorie par ligne » (mig 194) correspond à `account_id`/`analytic_distribution` par ligne. | standard | connaissance |
| D6.6 | Avoirs | Bouton **Ajouter une note de crédit** (`account.move.reversal`) : `in_refund` lié (`reversed_entry_id`), partiel ou total, option *Rembourser* ; lignes conservent `purchase_line_id` → `qty_invoiced` **diminue**. Lettrage automatique facture/avoir. | Retour fournisseur ou erreur de prix : la ligne BC redevient « à facturer » pour le bon montant. | socle | connaissance |
| D6.7 | Factures en double | Contrainte : avertissement si une facture du même fournisseur a la même `ref` (`_check_duplicate_supplier_reference`, bloquant à la validation en v17 si doublon exact). | Payer deux fois la même facture est l'erreur P2P n° 1. | socle | connaissance |
| D6.8 | TVA par ligne & arrondi | `account.tax` par ligne (`tax_ids`), `price_include`, regroupement par taux dans `tax_totals` (json), arrondi par ligne ou global (`tax_calculation_rounding_method`). Positions fiscales. | TVA 20 % / 10 % / 7 % / 0 % mélangées sur une même facture d'épicerie — votre mig 189. | socle | connaissance |
| D6.9 | Pièces jointes & lien PDF | La facture scannée (PDF) est un `ir.attachment` sur la facture ; l'aperçu PDF s'affiche **à côté** du formulaire (vue *attachment preview*) pour saisir en regard. | Saisie en double écran ; la pièce justificative suit la pièce comptable (audit). | standard | vérifié |
| D6.10 | Acompte / facture d'avance | Pas de wizard d'acompte natif côté achats (il existe côté ventes) ; pratique : paiement enregistré sans facture (`account.payment` fournisseur) puis lettré. Modules OCA `purchase_deposit`. | Les fournisseurs marocains demandent souvent un acompte sur équipement. | avancé | connaissance |
| D6.11 | Date comptable vs date facture | `invoice_date` (date du fournisseur), `date` (date comptable, forcée en période ouverte), `invoice_date_due` calculée par le terme ; verrouillage des périodes (`fiscalyear_lock_date`, `tax_lock_date`). | Factures reçues en retard : la TVA déductible se déclare sur la bonne période. | standard | connaissance |

**Pattern PostgreSQL — rapprochement**

```sql
-- invoice_items porte déjà order_line_id → 3-way par vue :
CREATE VIEW v_po_line_match AS
SELECT l.id, l.qty_ordered, l.qty_received, l.qty_invoiced, l.unit_price,
       CASE WHEN l.qty_invoiced = 0 THEN 'no'
            WHEN l.qty_invoiced <= CASE l.bill_policy WHEN 'ordered' THEN l.qty_ordered ELSE l.qty_received END
                 AND NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.order_line_id = l.id
                                   AND abs(ii.unit_price - l.unit_price) > 0.005)
            THEN 'yes' ELSE 'exception' END AS release_to_pay
FROM purchase_order_lines l;
```

---

## D7 — Paiements & trésorerie fournisseurs

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Conf. |
|---|---|---|---|---|---|
| D7.1 | Enregistrer un paiement | Bouton **Enregistrer un paiement** sur une facture `posted` → wizard `account.payment.register` : `journal_id` (banque/caisse), `payment_method_line_id` (manuel, chèque, virement SEPA/… ), `amount` (partiel autorisé), `payment_date`, `communication` (`ref` facture), `group_payment` (plusieurs factures → un paiement). Crée `account.payment` + écriture 4411 → 5141/5161, lettrage automatique partiel/total ; `payment_state` de la facture mis à jour. Paiement groupé multi-factures depuis la liste. | Un paiement = une écriture = un lettrage ; le solde fournisseur découle du grand livre, pas d'une colonne `paid_amount` (votre réconciliation legacy↔ledger). | socle | vérifié |
| D7.2 | Échéancier & vieillissement | Rapport **Balance âgée fournisseurs** (`account.aged.partner` payable : non échu, 1-30, 31-60, 61-90, 91-120, > 120 jours) ; filtre « factures à payer » (`payment_state in (not_paid, partial)`), tri par `invoice_date_due`. Widget tableau de bord Achats/Compta. | Pilotage du cash hebdomadaire ; pour vous : *PaymentAlertsWidget*. | socle | connaissance |
| D7.3 | Escompte pour paiement anticipé | `account.payment.term` avec `discount_percentage`/`discount_days` (v16+) → `invoice_payment_term_id` calcule `discount_date` et `discount_amount_currency` ; le wizard de paiement propose le montant escompté si payé avant la date ; écriture d'escompte automatique (compte `account_journal_early_pay_discount_loss/gain`). | Les grossistes offrent 2 % à 10 jours : il faut que le système le voie. | avancé | connaissance |
| D7.4 | Paiements par chèque / LCN | Méthode de paiement *Chèque* (`account_check_printing` : numéro, impression), suivi d'état chèque ; LCN (effets) via modules localisation ou journaux dédiés (compte 4415 *Fournisseurs – effets à payer*). | Le chèque et la LCN restent dominants au Maroc en B2B. | standard | connaissance |
| D7.5 | Relevé bancaire & lettrage | Import relevés (CSV/OFX/CAMT), `account.bank.statement.line`, widget de rapprochement avec modèles (`account.reconcile.model` : par montant, libellé, référence) ; lettrage manuel multi-lignes avec écarts (frais). | Clôture mensuelle : chaque sortie de banque est rapprochée d'une facture ou qualifiée. | standard | connaissance |
| D7.6 | Suivi fournisseur (ledger partenaire) | Rapport **Grand livre partenaires** (payable) : toutes les écritures 4411 par fournisseur, lettrées ou non, solde courant. Smart button **Factures fournisseur** et **Dû** (`debit`/`credit`/`total_due`) sur la fiche partenaire. | « Combien doit-on à X ? » répondu depuis la fiche. | socle | connaissance |
| D7.7 | Blocage de paiement | 3-way (EE) `release_to_pay` ; en CE : champ `to_check` (*À vérifier*) sur la facture (filtre et bannière), ou statut brouillon tant que non validée. Pas de paiement possible sur une facture non `posted`. | Le « bon à payer » est une étape distincte de la saisie. | standard | connaissance |
| D7.8 | Paiements fournisseur sans facture & prépaiement | `account.payment` type `outbound` partner_type `supplier` créé seul (acompte) ; apparaît en « paiements en suspens » (`outstanding payments`) sur les factures ultérieures du fournisseur, lettrable en un clic. | Acomptes et paiements à la commande. | standard | connaissance |
| D7.9 | Avances sur salaire / notes de frais ≠ fournisseurs | Hors périmètre Achats chez Odoo (`hr_expense`) mais même mécanique : un `account.move` + paiement + lettrage. | Rappel pour votre module Paie : votre créance 3431 (mig 228) suit la même logique. | — | connaissance |
| D7.10 | Multi-sociétés / multi-journaux | Journaux `purchase` (achats), `bank`, `cash` par société ; `company_id` sur toutes les pièces ; inter-sociétés automatiques (EE). | Si boutique et atelier deviennent des entités séparées (plan SaaS multi-tenants). | avancé | connaissance |

---

## D8 — Comptabilité des achats

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Conf. |
|---|---|---|---|---|---|
| D8.1 | Valorisation continue vs manuelle | `product.category.property_valuation` ∈ {`manual_periodic` (pas d'écriture auto, inventaire périodique), `real_time` (écritures de stock automatiques)} ; `property_cost_method` ∈ {`standard`, `average` (AVCO), `fifo`}. | Choix structurant : votre inventaire physique mensuel = `manual_periodic` ; passer en `real_time` suppose des réceptions fiables. | standard | vérifié |
| D8.2 | Comptabilité anglo-saxonne (GR/IR) | `res.company.anglo_saxon_accounting` : à la **réception**, débit *Stock (31x)* / crédit *Stock Interim (Received)* (`property_stock_account_input_categ_id`) ; à la **facture**, la ligne produit est imputée sur *Stock Interim (Received)* (et non la charge) → le compte d'attente se solde ; les écarts (prix, qté) restent visibles sur ce compte ; la **charge** n'est constatée qu'à la consommation/vente (débit 61x / crédit 31x via *Stock Output*). Mode continental (défaut) : la facture impute directement la charge 61x et la réception ne touche que 31x/603 variation. | Le solde de *Stock Interim (Received)* = « reçu non facturé » (GR/IR) : rapport d'audit incontournable et base des provisions de clôture (factures non parvenues). | avancé | vérifié |
| D8.3 | Couches de valorisation (`stock.valuation.layer`) | Une ligne par mouvement valorisé : `product_id`, `quantity`, `unit_cost`, `value`, `remaining_qty`, `remaining_value`, `stock_move_id`, `stock_landed_cost_id`, `account_move_id`, `description`. FIFO consomme les couches par `remaining_qty` ; AVCO recalcule `standard_price` à chaque entrée. Rapport **Valorisation du stock** à date (`stock.quantity.history` + SVL). | C'est le « grand livre du stock » : chaque kg a un coût d'entrée et une consommation traçable. Votre `current_quantity` qui dérive serait résolu par ce modèle en append-only. | avancé | connaissance |
| D8.4 | Landed costs (frais d'approche) | `stock.landed.cost` : `picking_ids` (réceptions concernées) ou `mrp_production_ids`, `cost_lines` (`product_id` service « landed cost », `price_unit`, `split_method` ∈ {`equal`, `by_quantity`, `by_current_cost`, `by_weight`, `by_volume`}, `account_id`), bouton **Calculer** → `valuation_adjustment_lines` (par couche : `additional_landed_cost`, `former_cost`, `final_cost`), **Valider** → SVL correctifs + écriture (débit 31x / crédit compte de la charge de transport). Peut être créé **depuis la facture fournisseur** du transporteur (case `is_landed_costs_line` sur le produit, bouton *Créer landed costs*). | Transport, douane, livraison payée séparément répartis sur le coût réel des matières → vrai coût de revient de la recette (`CoutReelPanel`). | avancé | vérifié |
| D8.5 | Comptes par défaut & routage | Ordre de résolution du compte de charge sur une ligne de facture : `product.property_account_expense_id` → `product.categ_id.property_account_expense_categ_id` → position fiscale (`account.fiscal.position.account` mapping). TVA : `product.supplier_taxes_id` → position fiscale. | Zéro saisie de compte pour l'opérateur ; le comptable règle les catégories une fois. | socle | connaissance |
| D8.6 | Analytique | `analytic_distribution` (json `{analytic_account_id: %}`) sur ligne BC, copiée sur la facture et sur le SVL ; plans analytiques multiples (v16+ : `account.analytic.plan`), règles de distribution par défaut (`account.analytic.distribution.model` par partenaire/produit/catégorie). Rapport analytique achats. | Coût par atelier (boulangerie / pâtisserie / boutique), par événement, par centre de coût. | standard | connaissance |
| D8.7 | Provisions factures non parvenues | Rapport **Reçu non facturé** = solde Stock Interim (anglo-saxon) ou liste des BC `invoice_status='to invoice'` avec `qty_received − qty_invoiced` valorisée au prix BC ; écriture de provision manuelle (ou module OCA). | Clôture mensuelle fidèle : une réception du 30 facturée le 5 doit peser sur le bon mois. | avancé | connaissance |
| D8.8 | Écarts d'inventaire et de valorisation | `stock.quant` inventaire (`inventory_quantity`, `inventory_diff_quantity`, `inventory_date`, *Appliquer*) → `stock.move` vers emplacement *Inventory adjustment* + SVL + écriture 6xx/31x ; `stock.valuation.layer` manuels (revalorisation `stock.valuation.layer.revaluation`). | Votre inventaire physique mensuel ad hoc devient une opération standard, avec écriture. | standard | connaissance |
| D8.9 | Pièce comptable auto-générée par événement | Chaque événement (réception, facture, paiement, landed cost, retour) produit **sa** pièce `account.move` liée (`stock_move_id`, `stock_valuation_layer_ids`, `payment_id`) avec `ref` explicite ; pas d'écriture « au bilan » recalculée. | Append-only + lien bidirectionnel = auditable. Analogie : un `JOURNAL_ENTRIES` alimenté par trigger sur chaque table d'événement, jamais par batch de recalcul. | socle | connaissance |
| D8.10 | Déclaration TVA & TVA non récupérable | `account.tax` : `type_tax_use='purchase'`, `amount`, répartition `invoice_repartition_line_ids` (base/taxe, comptes 3455x), `tax_group_id`, taxe **non déductible** (répartition 100 % en charge), taxes incluses dans le prix. Rapport **Déclaration TVA** (`account.generic.tax.report`) par période. | TVA déductible marocaine : déclaration mensuelle/trimestrielle, règle de décalage d'un mois sur les achats (hors périmètre Odoo standard, à gérer par date de paiement). | standard | connaissance |

---

## D9 — Pilotage & analytique

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Conf. |
|---|---|---|---|---|---|
| D9.1 | Analyse des achats (`purchase.report`) | Vue SQL matérialisée (modèle `purchase.report`, `_auto=False`) une ligne par ligne BC : `date_order`, `date_approve`, `partner_id`, `product_id`, `category_id`, `user_id`, `company_id`, `state`, `qty_ordered`, `qty_received`, `qty_billed`, `qty_to_be_billed`, `price_total`, `price_average`, `untaxed_total`, `delay` (jours confirmation → **Days to Confirm**), `delay_pass` (jours confirmation → réception, **Days to Receive**), `nbr_lines`, `volume`, `weight`, `avg_days_to_purchase`. Vues graphique / pivot / liste avec mesures et regroupements libres ; filtres « Commandes », « RFQ », « Fournisseur », « Produit », périodes comparées. | Prix moyen d'achat de la farine par mois et par fournisseur, en 3 clics, sans écrire de requête. | socle | vérifié |
| D9.2 | Taux de livraison à l'heure du fournisseur | `res.partner.on_time_rate` (module `purchase_stock`, v15+) : % des `stock.move` de réception `done` dont la date réelle ≤ `date_deadline` (date promise), sur les 365 derniers jours ; affiché sur la fiche fournisseur (onglet Achats, « On-Time Delivery Rate ») ; `receipt_reminder_email`. Le rapport d'analyse donne par ailleurs **Days to Receive** moyen par fournisseur. | Objectiver le choix d'un fournisseur : prix bas mais 40 % de retards ≠ bon fournisseur. | standard | vérifié (rapport) / connaissance (champ) |
| D9.3 | Écart de prix (price variance) | Dans `purchase.report` : `price_average` par produit/fournisseur/période ; comparaison avec `standard_price` via pivot ; en anglo-saxon le compte *Price Difference* / SVL correctifs isolent l'écart BC → facture. Pas de KPI « PPV » prêt-à-l'emploi : il se construit en pivot (prix moyen vs prix précédent). | Surveiller la dérive du beurre et du chocolat ; nourrir la décision de hausse des prix de vente. | standard | connaissance |
| D9.4 | Tableau de bord Achats | `purchase.order` kanban/liste avec filtres prédéfinis : *Mes RFQ*, *À envoyer*, *En attente*, *En retard* (`date_planned < now` et non reçu), *À facturer*, *Non confirmées depuis X jours* ; indicateurs en haut de la liste RFQ (`retrieve_dashboard` : nb RFQ à envoyer, en attente, en retard, montant moyen BC, délai moyen, nb BC du mois). | Vue de pilotage quotidien de l'acheteur, intégrée à la liste, pas un écran séparé. | standard | vérifié |
| D9.5 | Rapport de valorisation & de stock | Inventaire valorisé à date, mouvements (`stock.move.line` *Historique des mouvements*), **Analyse des stocks**, **Performance des réceptions** (Inventory › Reporting › Performance, EE : délais par fournisseur, en retard). | Audit mensuel, rapprochement inventaire physique / théorique. | standard | connaissance |
| D9.6 | Rapports comptables fournisseurs | Balance âgée fournisseurs, grand livre partenaires, journal des achats, déclaration TVA, *Reçu non facturé*. Export XLSX de toute vue liste/pivot. | Reporting légal et de clôture. | socle | connaissance |
| D9.7 | Analyse par catégorie / analytique | Groupement de `purchase.report` par `category_id` (ingrédients, emballages, charges) et par `analytic_distribution` ; rapport analytique (`account.analytic.line`). | Part des emballages dans les achats, coût par atelier. | standard | connaissance |
| D9.8 | Favoris & vues sauvegardées | `ir.filters` : tout filtre/pivot peut être sauvé par utilisateur ou partagé, et épinglé au tableau de bord (*Dashboards* EE, `spreadsheet_dashboard`). | Le gérant retrouve « achats farine 12 derniers mois » sans refaire la manip. | standard | connaissance |
| D9.9 | Feuille de calcul intégrée (EE) | *Spreadsheet* : insérer un pivot d'analyse achats dans une feuille, formules `ODOO.PIVOT`, rafraîchissement live. | Budget vs réel achats, négociation annuelle. | avancé | connaissance |

---

## D10 — Transverse (audit, UX, intégrations)

| # | Capacité | Description précise | Pourquoi c'est important | Niveau | Conf. |
|---|---|---|---|---|---|
| D10.1 | Chatter (journal d'audit + messagerie) | Mixin `mail.thread` sur `purchase.order`, `stock.picking`, `account.move`, `res.partner` : `mail.message` (`model`, `res_id`, `body`, `message_type` ∈ {`comment`, `notification`, `email`}, `subtype_id`, `author_id`, `tracking_value_ids`). **Suivi de champs** (`tracking=True` sur `state`, `partner_id`, `amount_total`, `date_planned`…) : chaque changement journalise ancienne/nouvelle valeur, auteur, date. Envoi d'e-mails depuis le chatter (le fournisseur répond → le mail rentre dans le fil). Abonnés (`message_follower_ids`) notifiés par sous-type. | Audit trail natif sans table de log dédiée ; répond à « qui a changé le prix et quand ? ». Analogie : `AUDIT_LOG` alimenté par trigger sur colonnes marquées + table `MESSAGES`. | socle | vérifié |
| D10.2 | Activités planifiées | `mail.activity` : `activity_type_id` (appel, e-mail, à faire, relance), `date_deadline`, `user_id`, `summary`, `note` ; icône horloge sur chaque enregistrement, vue « Activités » (matrice utilisateur × type), activités auto (lot expiré, facture à vérifier, RFQ sans réponse). | La relance fournisseur est une tâche assignée, datée, visible dans la liste (pastille colorée). | standard | vérifié |
| D10.3 | Pièces jointes | `ir.attachment` (`res_model`, `res_id`, `datas`/`store_fname`, `mimetype`, `checksum`) ; dépôt par glisser-déposer dans le chatter ; aperçu PDF latéral sur la facture. | Devis fournisseur, BL signé, certificat d'analyse attachés au document d'origine. | socle | connaissance |
| D10.4 | Vues liste / kanban / formulaire / pivot / graphe / calendrier | Même modèle, N vues déclaratives ; liste **éditable en ligne** (`editable="bottom"`) pour les lignes BC et supplierinfo ; `optional="hide"` pour colonnes facultatives ; regroupement par n'importe quel champ ; totaux de colonnes (`sum`) ; décorations de lignes (`decoration-danger="state=='cancel'"`). Kanban RFQ par état avec glisser-déposer. Calendrier des réceptions prévues (`date_planned`). | Votre `odoo-table` reprend la liste ; les points à imiter : édition inline, regroupement, totaux, colonnes optionnelles. | socle | vérifié |
| D10.5 | Smart buttons & navigation contextuelle | Boutons compteurs en haut à droite (réceptions, factures, alternatives) ; sur le produit : **Achats** (nb de BC ligne), **En stock**, **Prévision**, **Mouvements**, **Lots** ; sur le fournisseur : **Achats** (`purchase_order_count`), **Factures fournisseur** (`supplier_invoice_count`), **Dû**. Fil d'Ariane conservant le contexte (retour au BC). | Zéro recherche : tout document lié est à un clic du document courant. | socle | vérifié |
| D10.6 | Recherche & filtres | Barre de recherche multi-champs (nom, fournisseur, référence fournisseur, produit, origine) ; filtres prédéfinis + personnalisés (`domain` sur n'importe quel champ) ; regroupements ; favoris. | Retrouver « le BC où on a commandé la crème X en mars » sans SQL. | socle | vérifié |
| D10.7 | Séquences & numérotation | `ir.sequence` par type de document et société, préfixe/suffixe avec `%(year)s`, remise à zéro annuelle, implémentation `standard` (gaps possibles) ou `no_gap` (verrou, sans trou — obligatoire pour factures). | Facture sans trou de numérotation = exigence fiscale ; BC peut tolérer des trous. | socle | connaissance |
| D10.8 | Multi-UoM & conversions | `uom.uom` : `category_id`, `uom_type` ∈ {`reference`, `bigger`, `smaller`}, `factor`/`factor_inv`, `rounding` ; conversion interdite entre catégories (poids ↔ volume) **sauf** via produit avec densité (non natif, cf. votre mig 227). Affichage toujours dans l'unité saisie. | Correspond à votre règle « 420 g reste 420 g ». | socle | connaissance |
| D10.9 | Import/export & API | Import CSV/XLSX de supplierinfo, produits, fournisseurs, BC (assistant d'import avec mapping et test) ; export de toute liste ; API XML-RPC/JSON-RPC (`execute_kw`) ; webhooks (automatisations v17+). | Migration initiale du catalogue prix des 40 fournisseurs en une matinée. | standard | connaissance |
| D10.10 | Automatisations & actions serveur | `base.automation` (v17 : *Automation rules*) : déclencheur (création, modification de champ, délai après date, webhook) + action (mettre à jour un champ, créer activité, envoyer e-mail, code Python) sans module. Ex. : BC > 10 000 MAD → activité au gérant ; réception validée sans lot → alerte. | Règles métier paramétrables = l'équivalent de vos triggers PL/SQL, mais déclaratifs et visibles par un non-développeur. | avancé | connaissance |
| D10.11 | Portail fournisseur | Le fournisseur reçoit un lien (`access_token`) vers son BC : voir, télécharger le PDF, confirmer/modifier la date de réception (v16+), accepter (signature). Pas d'appel d'offres en portail natif. | Boucle de confirmation sans e-mail manuel. | avancé | vérifié |
| D10.12 | Multi-langue & impression | Documents imprimés dans la langue du fournisseur (`partner.lang`), traductions des désignations produit (`name` translatable) ; templates QWeb/PDF personnalisables (en-tête société, logo, pied légal ICE/IF/RC/CNSS). | BC en français et en arabe selon le fournisseur ; mentions légales marocaines. | standard | connaissance |
| D10.13 | Droits d'accès & règles d'enregistrement | `ir.model.access` (CRUD par groupe et modèle), `ir.rule` (filtre de lignes par société, par utilisateur « ses » documents), champs `groups=` (visibilité d'un champ selon rôle : le magasinier ne voit pas les prix). | Le magasinier reçoit sans voir le prix (« Pesage = magasinier strict »). Analogie : VPD/RLS, ce que votre plan SaaS prévoit. | socle | connaissance |
| D10.14 | Archivage / soft delete généralisé | Champ `active` sur partenaires, produits, supplierinfo, règles de réappro ; filtre « Archivé ». Suppression physique refusée dès qu'une pièce comptable `posted` référence l'objet. | Cohérent avec votre `archived_at` (mig 275). | socle | connaissance |

---

## 11. Patterns de modélisation à reprendre (synthèse PostgreSQL maison)

| Pattern Odoo | Traduction PostgreSQL / Node | Remarque pour l'ERP interne |
|---|---|---|
| RFQ et BC = **un seul enregistrement** à états | `purchase_orders.status` (`draft` → `sent` → `to_approve` → `confirmed` → `locked` / `cancelled`) ; pas de table `rfq` séparée | Simplifie la traçabilité, le numéro ne change pas. |
| Compteurs par ligne `qty_received` / `qty_invoiced` | Colonnes dénormalisées + triggers `AFTER` sur `receipt_lines` et `invoice_items` ; `qty_to_invoice` et `invoice_status` en vue ou en colonne recalculée | Toujours convertir en unité de la ligne ; retours en négatif si `to_refund`. |
| `product.supplierinfo` | `supplier_products` (D1) avec `min_qty`, validité, `sequence`, code fournisseur, `qty_per_uom` | Enrichir à la confirmation du BC si absent (D1.4). |
| UoM d'achat ≠ UoM de stock | `purchase_uom` + `qty_per_uom` figés **sur la ligne** (pas seulement sur le référentiel) | Un sac de 25 kg aujourd'hui peut devenir 20 kg demain ; la ligne garde la valeur du jour. |
| `stock.move` / `stock.move.line` | `receipt_lines` (une ligne = un lot = une quantité) + table de mouvements append-only | Base de la DLC active et du FEFO. |
| `stock.valuation.layer` | `stock_valuation_layers` (quantité, coût unitaire, valeur, reste) alimentée par réception, consommation, landed cost, inventaire | Résout la dérive de `current_quantity` : le stock devient une somme, pas un état modifié. |
| GR/IR (Stock Interim Received) | Compte d'attente 4487/3488 débité/crédité par réception et facture ; vue « reçu non facturé » | Faisable même sans anglo-saxon complet : c'est juste une écriture de plus à la réception. |
| Landed costs | `landed_costs` (facture transport → réceptions ciblées → répartition `equal/by_qty/by_weight/by_value`) → SVL correctifs | Priorité basse mais structurante pour le coût réel recette. |
| Chatter / tracking | `audit_events` (table, id, champ, ancienne, nouvelle, auteur, date) + `messages` + `attachments` polymorphes (`res_model`, `res_id`) | Un seul mécanisme pour BC, réception, facture, fournisseur. |
| Smart buttons | Compteurs `COUNT(*)` par relation exposés par l'API détail du BC (`receipts_count`, `invoices_count`) | Rendu avec `odoo-btn-*`, un clic = liste filtrée. |
| Statusbar + boutons par état | `ui-timeline` + matrice état → actions côté serveur (une fonction `allowedActions(order, user)`) | Les boutons ne doivent jamais être décidés côté client seul. |
| Warnings fournisseur/produit | `suppliers.purchase_warn` (`none/warn/block`) + `purchase_warn_msg` ; idem ingrédients | Trois lignes de SQL, forte valeur pour la qualité. |
| Règle de réappro min/max + rapport de réassort | `reorder_rules` (D2) + vue `v_replenishment` (stock + BC confirmés non reçus − besoins plans confirmés) → bouton « Commander » qui crée/complète une RFQ brouillon par fournisseur | Branche directe sur vos plans de production et BSI. |
| Politique de facturation ordered/received | `bill_policy` par catégorie (charges = ordered, stockables = received) copié sur la ligne | Gouverne « Créer facture depuis BC ». |
| Réception partielle / reliquat | `receipts.backorder_of_id` + choix à la validation (`create_backorder`, `no_backorder`) | Sans reliquat, le manquant est **annulé** sur la ligne, pas oublié. |
| Retour fournisseur `to_refund` | `receipt_lines.is_return` + `to_refund` ; décrémente `qty_received` ; avoir lié | Distingue remplacement et remboursement. |

## 12. Priorisation suggérée pour ~40 fournisseurs / ~300 BC par an

1. **Socle (à avoir avant tout)** : D1.1-D1.2-D1.5-D1.6-D1.7-D1.10-D1.11, D3.1-D3.6-D3.7, D4.1-D4.4-D4.6-D4.7-D4.8-D4.9, D5.1-D5.2-D5.4, D6.1-D6.2-D6.6-D6.7-D6.8, D7.1-D7.2-D7.6, D8.5-D8.9, D9.1-D9.6, D10.1-D10.3-D10.4-D10.5-D10.6-D10.7-D10.8-D10.13-D10.14.
2. **Standard (6-12 mois)** : D1.3-D1.4-D1.8, D2.1-D2.2-D2.3-D2.4-D2.7, D3.2-D3.3-D3.5-D3.9, D4.5, D5.5-D5.6-D5.8-D5.13, D6.5-D6.9, D7.4-D7.5-D7.7, D8.1-D8.6-D8.8, D9.2-D9.3-D9.4-D9.7, D10.2-D10.9.
3. **Avancé (si le besoin est démontré)** : D2.5-D2.9, D3.4, D4.10-D4.11, D5.7 (contrôle qualité paramétrable), D5.9, D6.3 (3-way), D6.4, D7.3, D8.2-D8.3-D8.4-D8.7, D9.9, D10.10-D10.11.

Pour une boulangerie avec ~300 BC/an, le 3-way matching formel (D6.3) a moins de valeur que la **politique « received »** (D6.1) + les compteurs par ligne (D4.3-D4.4) : à ce volume, la vue `v_po_line_match` suffit comme contrôle, sans workflow d'exception.

## Sources consultées

- Odoo documentation (master) — Purchase Analysis report : https://www.odoo.com/documentation/master/applications/inventory_and_mrp/purchase/advanced/analyze.html
- Odoo documentation 16.0 — Bill control policies : https://www.odoo.com/documentation/16.0/it/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html
- Odoo eLearning — Approvals & warnings : https://www.odoo.com/slides/slide/approvals-warnings-9252 ; Reordering rules : https://www.odoo.com/hi_IN/slides/slide/reordering-rules-5378
- Cybrosys Odoo 18 Book (CE/EE) — Purchase configuration, Vendor Bills, Purchase Order Approval, RFQ, Purchase Analysis : https://www.cybrosys.com/odoo/odoo-books/v18/purchase/configurations/ ; https://www.cybrosys.com/odoo/odoo-books/v18-ce/purchase/vendor-bills/ ; https://www.cybrosys.com/odoo/odoo-books/v18-ce/purchase/purchase-order-approval/ ; https://www.cybrosys.com/odoo/odoo-books/v18-ce/purchase/requests-for-quotations/ ; https://www.cybrosys.com/odoo/odoo-books/v18-ce/purchase/purchase-analysis/
- Cybrosys blogs Odoo 18 — bill control policy, 3-way matching, purchase order approvals, purchase agreements, compare RFQ, minimum stock rule, delivery lead time, anglo-saxon accounting, landed cost allocation : https://www.cybrosys.com/blog/how-to-configure-bill-control-policy-in-odoo-18-purchase ; https://www.cybrosys.com/blog/how-3-way-matching-works-in-odoo-18-purchase-module ; https://www.cybrosys.com/blog/how-to-manage-purchase-order-approvals-in-odoo-18 ; https://www.cybrosys.com/blog/how-to-use-purchase-agreements-effectively-in-odoo-18 ; https://www.cybrosys.com/blog/what-are-the-best-practices-for-comparing-rfq-prices-in-odoo-18 ; https://cybrosys.com/blog/how-to-manage-minimum-stock-rule-in-odoo-18-inventory ; https://www.cybrosys.com/blog/how-to-manage-the-delivery-lead-time-in-odoo-18 ; https://www.cybrosys.com/blog/how-to-manage-a-business-using-anglo-saxon-accounting-in-odoo-18 ; https://www.cybrosys.com/blog/how-to-build-a-custom-landed-cost-allocation-engine-in-odoo
- Cleverence — Purchase agreements, Lead times (Odoo 18), Landed cost : https://cleverence.com/articles/odoo-documentation/purchase-agreements-blanket-orders-calls-for-tenders-3827 ; https://www.cleverence.com/amp/articles/odoo-documentation/lead-times-odoo-18-0-documentation-7834/ ; https://www.cleverence.com/amp/articles/for-business/landed-cost-odoo-4927/
- Hibou — Landed Costs (Odoo 13, principes comptables) : https://hibou.io/docs/inventory-24/landed-costs-6/ver/13-0-7
- Odoo Apps 18.0 — Vendor Leadtime Scorecard (confirme l'absence de score natif détaillé) : https://apps.odoo.com/apps/modules/18.0/vendor_leadtime_scorecard
