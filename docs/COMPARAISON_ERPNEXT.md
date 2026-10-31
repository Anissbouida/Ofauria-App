# Comparaison Ofauria ⇄ ERPNext — Écarts fonctionnels

> **Date :** 2026-10-29
> **Référence ERPNext :** branche `develop` (v16), `/Users/anissbouida/Downloads/erpnext-develop`
> **Méthode :** inventaire des *doctypes* ERPNext par module ⇄ routes, migrations (395) et features client d'Ofauria.
> **But :** (A) ce qui existe dans ERPNext et **pas** dans Ofauria ; (B) ce qui existe des deux côtés mais **à améliorer** dans Ofauria.

---

## 0. Lecture rapide

Ofauria **n'est pas** un sous-ensemble d'ERPNext : c'est un ERP métier boulangerie/pâtisserie, taillé pour le Maroc, qui couvre déjà la grande majorité des domaines ERPNext **et** va beaucoup plus loin sur le métier (pesage, nomenclature par format, coupe/sorties de cadre, CMUP, invendus, contrôle des ventes, paie Maroc + Damancom, fiches techniques).

Les écarts réels avec ERPNext ne sont donc **presque jamais** « fonction absente », mais plutôt :
1. **Généricité** — ERPNext fait du paramétrable là où Ofauria fait du spécifique (variantes, dimensions analytiques, workflow).
2. **Multi-entité** — ERPNext est multi-sociétés/multi-devises nativement ; Ofauria est mono-société (le chantier SaaS multi-tenant est en cours).
3. **Profondeur de cycle** — sur quelques objets (immobilisations, fabrication atelier, lettrage), ERPNext gère un cycle de vie plus complet.

### Couverture par module

| Domaine | Couverture Ofauria | Écart principal avec ERPNext |
|---|---|---|
| Comptabilité & Finance | 🟢 Élevée | Dimensions analytiques génériques, lettrage auto, clôture formelle, multi-société |
| Stock / Inventaire | 🟢 Élevée | Variantes génériques, n° de série, contrôle qualité à réception, colisage/expédition |
| Achats | 🟢 Élevée | Commande-cadre (blanket), agrégation auto des besoins → BC |
| Ventes | 🟢 Élevée | Règles d'expédition, bundles génériques, blanket sales order |
| Fabrication | 🟡 Moyenne | Atelier (job card/workstation), capacité, versioning BOM |
| Qualité | 🟡 Moyenne | QMS complet (non-conformité, actions, réunions, objectifs) |
| Immobilisations | 🟡 Moyenne | Cycle complet (capitalisation, cession/rebut, réparation, mouvements) |
| Projets | 🟡 Moyenne | Feuilles de temps, marge/rentabilité projet, templates |
| CRM | 🟡 Moyenne | Prise de RDV, contrats, campagnes e-mail |
| Maintenance / SAV | 🟢 Élevée | Planning préventif formalisé |
| Sous-traitance | 🔴 Absente | Module complet (donneur d'ordre / preneur d'ordre) |
| Paie / RH | 🟢 Élevée (Maroc) | ERPNext délègue à HRMS (app séparée) — Ofauria est **devant** |
| Transversal (workflow, multi-société, API) | 🟡 Moyenne | Moteur de workflow générique, multi-société, webhooks |

Légende : 🟢 à parité ou devant · 🟡 présent mais moins profond · 🔴 absent

---

## A. Ce qui existe dans ERPNext et PAS (ou à peine) dans Ofauria

### A1. Transversal — les écarts les plus structurants

- **Multi-société / multi-établissement comptable.** ERPNext : `company` + transactions inter-sociétés, consolidation, `finance_book` parallèles. Ofauria est mono-société (le chantier *SaaS multi-industries* avec `tenant_id`+RLS adresse le multi-tenant, pas la consolidation multi-sociétés d'un même groupe).
- **Moteur de Workflow générique.** ERPNext : états + transitions + rôles sur n'importe quel document. Ofauria a des validations ciblées (Approbations BC > 5 000 DH, crédit, blocage). → Un moteur générique « statut → transition → rôle autorisé » rendrait tout le circuit de validation paramétrable au lieu d'être codé par cas.
- **Dimensions analytiques génériques** (`accounting_dimension`). Ofauria a *centres de coûts* (mig 386) et *projet* (358) en dur ; ERPNext permet d'ajouter librement n'importe quelle dimension (canal, région, marque…) sur toutes les écritures.
- **Séries de numérotation paramétrables** (naming series) et **formats d'impression** entièrement éditables par l'utilisateur.
- **Webhooks sortants** / API REST générique. Ofauria a l'`email_outbox` + `scheduled_jobs` (mig 364) mais pas de webhooks configurables vers des systèmes tiers.
- **Scan code-barres** natif (stock, caisse). Recherche : **0 occurrence** dans Ofauria → gros plus pour la caisse et l'inventaire.
- **Incoterms** (`incoterm`) sur achats/ventes internationaux.

### A2. Comptabilité & Finance

| Fonction ERPNext | Statut Ofauria | Note |
|---|---|---|
| **Lettrage automatique** (`payment_reconciliation`, allocation paiement↔facture) | Partiel | Ofauria réconcilie (ledger) mais pas d'outil de lettrage auto multi-factures. |
| **Clôture de période formelle** (`period_closing_voucher`, `accounting_period` verrouillable) | Absent | Ofauria n'a pas de verrou d'exercice/période ni d'écriture de clôture automatisée. |
| **Réévaluation de change** (`exchange_rate_revaluation`) | Absent | Écarts de conversion sur soldes en devise non recalculés. |
| **Produits/charges constatés d'avance — côté produits** | Partiel | CCA charges = compte 486 (mig 380) ✅ ; produits constatés d'avance (PCA) non traités. |
| **Abonnements / facturation récurrente** (`subscription` + `subscription_plan`) | À vérifier | `subscription.routes` existe ; comparer la génération auto de factures récurrentes. |
| **Escompte d'effets / caution bancaire** (`invoice_discounting`, `bank_guarantee`) | Absent | Niche, utile si financement sur créances. |
| **Gestion du capital / actionnariat** (`shareholder`, `share_transfer`) | Absent | Niche. |
| **Outils de diagnostic du grand livre** (`ledger_health_monitor`, `bisect_accounting`) | Absent | Détection d'incohérences GL. |
| **Import plan comptable** (`chart_of_accounts_importer`) | À vérifier | Démarrage d'un nouveau dossier. |
| **Relevés de compte client automatisés** (`process_statement_of_accounts`, envoi périodique) | Partiel | Relances existent (mig 366) ; envoi programmé de relevés complets à préciser. |

### A3. Stock / Inventaire

| Fonction ERPNext | Statut Ofauria | Note |
|---|---|---|
| **Variantes génériques** (`item_attribute` → `item_variant`, matrice attributs) | Spécifique | Ofauria gère les *formats* (recipe_format) et entremets par personne, pas une matrice d'attributs générique (couleur/taille…). |
| **Numéros de série** (`serial_no`) | Absent | Ofauria trace par **lots** (batch) — suffisant en agroalimentaire, mais pas de n° de série unitaire. |
| **Contrôle qualité à réception/livraison** (`quality_inspection` + `template` + `parameter`) | Partiel | Module Qualité + HACCP existent, mais pas l'inspection paramétrée bloquante intégrée au flux réception/expédition. |
| **Colisage & expédition** (`packing_slip`, `shipment`, `shipment_parcel`, transporteur) | Absent | `delivery-note` + `delivery-route` (tournées) existent ✅, mais pas de bon de colisage ni de gestion colis/transporteur. |
| **Pick list** (liste de prélèvement magasin) | Absent | Pas de feuille de prélèvement formalisée pour préparer une expédition. |
| **Règles de rangement** (`putaway_rule`) | Absent | Affectation auto d'emplacement à réception. |
| **Articles alternatifs / substitution** (`item_alternative`) | Absent | Remplacement auto si rupture. |
| **Méthode de valorisation au choix par article** (FIFO vs coût moyen mobile) | Partiel | Ofauria : CMUP à l'achat + FIFO par lot en prod. Pas de bascule paramétrable par article. |

> ✅ Déjà bien couvert côté Ofauria : réservation de stock (mig 389, ATP), inventaire physique, transferts de zones, seuils de réapprovisionnement, UOM/conversions, coût au débarquement (landed cost).

### A4. Achats

| Fonction ERPNext | Statut Ofauria | Note |
|---|---|---|
| **Commande-cadre / contrat-cadre** (`blanket_order` achats) | Absent | Engagement de volume sur une période, libéré par BC successifs. |
| **Agrégation besoins → BC auto** (`material_request` groupés → PO) | Partiel | Demandes d'achat + « À commander » existent ; l'agrégation multi-demandes vers un BC consolidé par fournisseur est à confirmer. |

> ✅ Déjà couvert : RFQ/appels d'offres (mig 360), scorecard fournisseurs (`supplier-score`), frais d'approche / landed cost (361, 392), multi-devises (363), routage consommable.

### A5. Ventes

| Fonction ERPNext | Statut Ofauria | Note |
|---|---|---|
| **Règles d'expédition** (`shipping_rule`, frais de port par palier/pays) | Absent | Calcul auto des frais de livraison. |
| **Bundles / Sales BOM génériques** (`product_bundle`, `sales_bom`) | Partiel | Assortiments/coffrets existent côté recettes ; un objet « bundle de vente » générique au niveau article serait plus souple. |
| **Blanket sales order** (commande-cadre client) | Absent | Symétrique de l'achat. |
| **Note d'installation** (`installation_note`) | Absent | Niche (hors métier). |

> ✅ Déjà couvert et souvent **devant** ERPNext : créances (351), BL→facture groupée (352), commandes particulier/pro (354), devis/proforma (365), relances + blocage crédit (366), fidélité (372), promotions (372), commissions commerciales (393).

### A6. Fabrication — l'écart le plus net côté « atelier »

| Fonction ERPNext | Statut Ofauria | Note |
|---|---|---|
| **Job Card / poste de travail** (`job_card`, `workstation`, `operation`, capacité) | Partiel | Ofauria a `routing` + `production-etapes` + rendement ; ERPNext pilote l'atelier (charge par poste, temps réels, pointage opération). |
| **Planification de capacité** (`workstation_working_hour`, `plant_floor`, `downtime_entry`) | Absent | Capacité machine/four, arrêts, plan d'atelier visuel. |
| **Versioning de nomenclature + outil de remplacement** (`bom_update_tool`, remplacer un composant sur toutes les BOM) | Partiel | Nomenclature par format existe ; versionner et substituer en masse un ingrédient est à confirmer. |
| **Master Production Schedule / forecast** (`master_production_schedule`, `sales_forecast`) | Partiel | *Plan directeur* MRP (lot 1) + *Prévision de demande* existent ; MPS formel à comparer. |
| **Co-produits / sous-produits & rebut dans la BOM** | Partiel | *Coupe/sorties de cadre* (mig 302) couvre les sorties multiples ; la modélisation scrap/co-produit générique diffère. |

### A7. Qualité — QMS complet

ERPNext `quality_management` est un **système de management de la qualité** : `non_conformance`, `quality_action` (+résolution), `quality_goal`/`objective`, `quality_review`, `quality_meeting` (agenda/minutes), `quality_procedure`, `quality_feedback`.

Ofauria a : module Contrôle & Qualité (pertes au coût de revient), HACCP, rappel de lot, contrôle ouverture, contrôle des ventes, SAV/réclamations. **Orientation différente** : Ofauria est très fort sur le contrôle opérationnel et la traçabilité ; ERPNext apporte la **boucle d'amélioration formelle** (non-conformité → action corrective → revue → réunion → objectif qualité).

### A8. Immobilisations — cycle de vie

ERPNext couvre tout le cycle : `asset`, `asset_category`, `asset_depreciation_schedule` (+ `finance_book` multiples), `asset_capitalization`, `asset_repair`, `asset_movement`, `asset_value_adjustment`, `asset_maintenance`, cession/rebut.

Ofauria a `fixed-asset` + immobilisations (mig 186, 349) + maintenance (359). **Écarts probables :** capitalisation (assemblage d'immo depuis achats/stock/service), réparation capitalisable, mouvements/affectations d'immo, ajustement de valeur, plans d'amortissement parallèles (fiscal vs comptable). → *À approfondir dans le code.*

### A9. Projets

ERPNext : `timesheet` + `activity_cost`/`activity_type`, `project_template`, `task` + dépendances, `project_update`, **marge/rentabilité par projet**. Ofauria : features `projects` + rattachement achats/charges (mig 390, coût projet = temps + factures HT). **Écarts :** feuilles de temps structurées avec coût d'activité, templates de projet réutilisables, suivi de marge/rentabilité consolidé.

### A10. CRM

ERPNext : `lead` → `opportunity` → `quotation`, `prospect`, `campaign` + `email_campaign`, `contract` (+templates/checklist), `appointment` (prise de RDV en ligne + créneaux), `competitor`, `market_segment`. Ofauria : pipeline CRM (mig 371, opportunités/activités) + campagnes (383). **Écarts :** prise de rendez-vous en ligne, gestion de contrats, campagnes e-mail automatisées, suivi concurrents.

### A11. Sous-traitance — module absent

ERPNext `subcontracting` : `subcontracting_order`/`receipt`/`bom`, fourniture de composants au sous-traitant, suivi matière consommée, double sens (donneur/preneur d'ordre). **Rien d'équivalent dans Ofauria** — pertinent si vous confiez de la production (ex. façonnage) à un tiers.

### A12. Paie / RH — Ofauria est DEVANT

ERPNext **core** ne contient pas la paie (déléguée à l'app séparée *HRMS* : `salary_structure`, `payroll_entry`…). Ofauria embarque une paie **Maroc complète** : CNSS/IR/e-BDS, Damancom, virement RIB, régul IR, attestations, avances/acomptes à retenue, paie hebdo/quinzaine/mensuelle, pointage, repos payé, commissions. **C'est un avantage net d'Ofauria**, aucun écart à combler ici.

---

## B. Ce qui existe des deux côtés mais À AMÉLIORER dans Ofauria

1. **Centres de coûts → dimensions analytiques.** Généraliser les centres de coûts (mig 386) + projet en *dimensions analytiques libres* configurables, portées sur toutes les écritures et exploitables dans les rapports.
2. **Budget.** Le budget (mig 317) gagnerait les apports ERPNext : distribution mensuelle/saisonnière, action au dépassement (avertir/bloquer), budget par dimension (centre de coût, projet).
3. **Rapprochement bancaire.** `bank-reconciliation.routes` existe ✅ ; ajouter l'**import de relevé** (CSV/MT940) + règles de correspondance automatique comme `bank_transaction_rule`.
4. **Nomenclature de production.** Ajouter versioning + outil de substitution en masse d'un ingrédient, et le roll-up de coût multi-niveaux comparé à `bom_explosion_item`.
5. **Devis/opportunités (CRM).** Chaîner lead→opportunité→devis→commande de bout en bout avec motifs de perte analysés (déjà partiellement là via `quotes` + `crm`).
6. **Maintenance préventive.** `maintenance.routes` existe ✅ ; formaliser le **planning préventif récurrent** (`maintenance_schedule` périodique) à la ERPNext.
7. **Scorecard fournisseur.** `supplier-score` existe ✅ ; enrichir avec critères pondérés + périodes + standing automatique (modèle `supplier_scorecard_*`).
8. **Rapports & tableaux de bord.** Rapports configurables (394) + tableaux de bord (395) déjà livrés ✅ ; cible = report builder sur toutes les sources + tuiles KPI temps réel (parité `report_center` / dashboards ERPNext).
9. **Permissions.** Passer des rôles actuels à un contrôle **par ligne et par champ** (parité moteur de permissions Frappe), au-delà du RLS tenant.

---

## C. Points forts d'Ofauria qu'ERPNext n'a PAS

À garder en tête : la migration vers « plus ERPNext » ne doit pas diluer ces atouts.

- **Métier boulangerie/pâtisserie** : pesage (balance connectée WebSerial), nomenclature **par format**, coupe & sorties de cadre, CMUP + coût réel FIFO par lot, fiches techniques (365 produits), densité poids↔volume, contenants par ingrédient.
- **Opérationnel boutique** : invendus, contrôle d'ouverture, contrôle des ventes par shift, caisse (POS) avec impression thermique USB + tiroir-caisse.
- **Fiscal & social Maroc** : TVA par ligne, retenue à la source (`withholding`), paie Maroc + Damancom, identité légale Kalum/Ofauria.
- **Traçabilité agroalimentaire** : rappel de lot matière→client de bout en bout, DLC.

---

## D. Recommandations priorisées

| Priorité | Chantier | Pourquoi | Effort |
|---|---|---|---|
| **P0** | Moteur de **workflow générique** (statut→transition→rôle) | Débloque tous les circuits de validation sans recoder par cas | Moyen |
| **P0** | **Dimensions analytiques** génériques (généraliser centre de coût/projet) | Pilotage fin + rapports multi-axes | Moyen |
| **P1** | **Contrôle qualité à réception** intégré au flux (bloquant) | Sécurise les intrants, complète HACCP | Faible-Moyen |
| **P1** | **Clôture de période** + verrou d'exercice | Intégrité comptable, audits | Faible |
| **P1** | **Scan code-barres** (caisse + inventaire) | Vitesse et fiabilité terrain | Faible-Moyen |
| **P2** | Atelier de **fabrication** (job card / poste / capacité) | Pilotage production fine (fours, chariots) | Élevé |
| **P2** | **Lettrage automatique** paiements↔factures | Gain de temps compta clients/fournisseurs | Moyen |
| **P2** | Cycle **immobilisations** complet (capitalisation, cession, réparation) | Conformité patrimoniale | Moyen |
| **P3** | **Sous-traitance** (si façonnage externe) | Nouveau besoin si externalisation | Élevé |
| **P3** | **Commande-cadre** achats/ventes (blanket) | Contrats volume fournisseurs/clients | Moyen |

---

### Réserves de méthode

Cette comparaison s'appuie sur l'inventaire des *doctypes* ERPNext et sur les routes/migrations/features d'Ofauria, pas sur une lecture ligne à ligne du code métier des deux côtés. Les items marqués *« partiel / à vérifier / à approfondir »* méritent une confirmation ciblée dans le code Ofauria avant arbitrage (notamment : profondeur des abonnements, du MPS, des immobilisations, et de l'agrégation besoins→BC).
