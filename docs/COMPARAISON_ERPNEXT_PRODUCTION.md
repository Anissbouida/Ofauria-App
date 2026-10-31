# Comparaison Ofauria ⇄ ERPNext — Module PRODUCTION (approfondi)

> **Date :** 2026-10-29 · **Réf. ERPNext :** `develop` (v16), module `manufacturing`
> **Sources Ofauria :** `production.routes.ts`, `routing.routes.ts`, `production-etapes/cout/contenant/markup`, `bon-sortie.routes.ts`, migrations 005→388, features client `production/`.
> Complément du document [COMPARAISON_ERPNEXT.md](COMPARAISON_ERPNEXT.md) §A6.

---

## 0. Deux paradigmes de production différents

C'est la clé de lecture de tout le reste.

- **ERPNext = fabrication discrète (atelier).** On lance un **Ordre de Fabrication** (`Work Order`) par article, décliné en **Fiches d'opération** (`Job Card`) exécutées sur des **Postes de travail** (`Workstation`) selon une **Gamme** (`Routing`). L'ordonnancement, la capacité machine, les temps réels par opérateur et les transferts matière par opération sont au cœur du système.

- **Ofauria = plan de production journalier pâtisserie + pesage.** On bâtit un **plan** (multi-produits, multi-formats), le MRP calcule les besoins, le **Bon de Sortie Interne (BSI)** pilote le **pesage** des matières (choix de lot, DLC, dérogation, validation chef), puis on suit les **étapes de procédé**, le **rendement** et le **coût réel** (matière + équipement + main-d'œuvre + écart de mix).

Conséquence : Ofauria est **devant** ERPNext sur la précision matière (pesage réel vs *backflush* théorique), le rendement et le coût réel ; ERPNext est **devant** sur l'exécution d'atelier (postes, capacité, ordonnancement, temps machine).

---

## 1. Correspondance concept par concept

| Concept ERPNext | Équivalent Ofauria | Verdict |
|---|---|---|
| `BOM` (nomenclature) | `recipes` + `recipe_components` (205) + `recipe_format_components` (200) | 🟢 Ofauria plus riche (par format, densité, par pièce, frais indirects, main-d'œuvre) |
| `BOM` versioning (`is_active`/`is_default`/`amended_from`) | `recipe_versions` (041), `recipes_archive_versions_snapshot` (346) | 🟡 Présent, mécanisme différent |
| `BOM Explosion Item` (roll-up multi-niveaux stocké) | Calcul à la volée via vues `v_recipe_*_cost` | 🟡 Pas d'explosion matérialisée |
| `BOM` phantom / `is_phantom_bom` | — | 🔴 Absent |
| `BOM` scrap / `process_loss_percentage` + `secondary_items` + `cost_allocation` | `production_item_outputs` (302, coupe/sorties) + `pertes_production` (301) | 🟡 Couvert autrement, pas de co-produit valorisé par allocation de coût |
| `BOM` `rm_cost_as_per` (valuation / dernier achat / liste prix) | CMUP figé | 🔴 Pas de bascule de source de coût matière |
| `BOM Update Tool` (remplacer un composant sur toutes les BOM) | — | 🔴 Absent |
| `BOM Creator` (constructeur visuel) | Éditeur de composition (Tree View) | 🟡 Présent, moins « assemblage visuel » |
| `Work Order` (OF par article) | `production_plan` + items + machine à états (299) | 🟡 Logique plan journalier, pas OF unitaire |
| `Work Order Operation` (op. planifiées/réelles) | `production_item_etapes` (089/342) + timer | 🟡 Étapes de procédé, pas opérations de poste |
| `Job Card` (exécution atelier + time logs) | Étapes avec `timer`/`status`/`progress` | 🔴 Pas d'exécution par poste/opérateur avec pointage |
| `Workstation` (poste + capacité + calendrier + statut) | `work_centers` (388) — **coût horaire seul** | 🔴 Pas de capacité, calendrier, statut |
| `Routing` + `Operation` | `routings` + `routing_operations` (388) — **coût standard, autonome** | 🟡 Existe mais déconnecté du flux réel |
| `Production Plan` (depuis SO/MR, sous-assemblages) | `/mrp/generate`, `/mrp/horizon`, `/mrp/semi-finished` | 🟡 MRP présent, moins d'automatisation appro |
| `Master Production Schedule` + `Sales Forecast` | « Plan directeur » (MRP lot 1) + Prévision de demande | 🟡 Présent, MPS moins formalisé |
| `Plant Floor` (vue atelier temps réel) | — | 🔴 Absent |
| `Downtime Entry` (arrêts machine) | — | 🔴 Absent |
| `Manufacturing Settings` (tolérances, backflush, capacité) | Réglages épars (markup 142, charges fixes 118) | 🟡 Pas de paramétrage centralisé |
| Qualité intégrée (`inspection_required` sur BOM/WO/Job Card) | Module Contrôle & Qualité + HACCP (séparés) | 🟡 Non intégré au flux comme point bloquant |
| Sous-traitance (`is_subcontracted`, `sourced_by_supplier`) | — | 🔴 Absent |
| Traçabilité lots / n° série | `product_lots` (105), `sale_item_lots` (337), ONSSA (056), recall | 🟢 Ofauria devant (chaîne de rappel complète) |
| Consommation matière | **Pesage réel** (BSI 113) : lot, DLC, dérogation, partiel | 🟢 Ofauria devant (vs backflush théorique) |
| Rendement / coût réel | `production_rendement` (089), `production_cout_reel` (090), écart de mix (268), usage équipement + temps travail | 🟢 Ofauria devant |

🟢 parité ou devant · 🟡 présent mais moins profond · 🔴 absent

---

## 2. Ce qui existe dans ERPNext et PAS dans Ofauria (production)

### 2.1 — Exécution d'atelier (le plus gros écart)
ERPNext `Job Card` : chaque opération d'un OF devient une fiche exécutée sur un poste, avec `time_logs` par **opérateur**, statut par opération (Open → WIP → Completed), transfert matière par opération, `barcode`, pause/reprise, OF correctif (`is_corrective_job_card`), inspection qualité par fiche.

Ofauria a des **étapes de procédé** (timer, statut, répétition, progression) mais pas rattachées à un poste ni à un opérateur pointé, ni au transfert matière par opération. → **Il manque la couche « qui fait quoi, sur quel poste, combien de temps réellement ».**

### 2.2 — Capacité & ordonnancement
Absents côté Ofauria :
- **Capacité par poste** (`Workstation.production_capacity`), **horaires de travail** (`Workstation Working Hour`) et **jours fériés** (`holiday_list`).
- **Ordonnancement des opérations** : `planned_start_time`/`planned_end_time` par opération, fenêtre `capacity_planning_for_days`, `mins_between_operations`.
- Vérifié dans le code : les dates côté Ofauria sont au niveau **plan**, pas au niveau opération/poste.

Pertinent pour vous : planifier la charge **four** et **chariots** (18 plaques), goulets d'étranglement.

### 2.3 — Suivi des arrêts et état des postes
`Downtime Entry` (arrêt + motif : maintenance, panne, réglage, électricité…) et statut machine (`Production / Off / Idle / Problem / Maintenance / Setup`). Base d'un indicateur type **TRS/OEE**. Rien d'équivalent dans Ofauria.

### 2.4 — Plant Floor
Vue atelier temps réel (postes, OF en cours, statut). Absente.

### 2.5 — Nomenclature avancée (BOM)
- **Explosion multi-niveaux matérialisée** (`BOM Explosion Item`) + **roll-up de coût** automatique sur plusieurs niveaux de sous-assemblages (Ofauria calcule via vues, sans table d'explosion).
- **Nomenclature fantôme** (`is_phantom_bom`) : éclatement sans mouvement de stock intermédiaire.
- **Co-produits / sous-produits valorisés** (`secondary_items` + `cost_allocation_per`) : répartir le coût d'un lot sur plusieurs sorties. Ofauria a les **sorties de cadre** (302) mais pas l'allocation de coût entre co-produits.
- **Outil de remplacement de composant en masse** (`BOM Update Tool`) : changer un ingrédient sur toutes les recettes qui l'utilisent, en une opération + journal de mise à jour.
- **Source de coût matière paramétrable** (`rm_cost_as_per` : valorisation stock / dernier achat / liste de prix).

### 2.6 — Production Plan / MRP avancé
- Génération d'OF **depuis les commandes de vente** et **demandes de matière** avec explosion des **sous-assemblages** (`sub_assembly_items`), **stock de sécurité** (`include_safety_stock`), `skip_available_sub_assembly_item`, `combine_items`.
- **Génération automatique des approvisionnements** depuis le plan (demandes d'achat / transferts des manquants). Ofauria produit le BSI mais la demande d'achat auto des ruptures reste à confirmer.
- **MPS** formalisé (`Master Production Schedule`) distinct du plan opérationnel.

### 2.7 — Divers
- **Tolérance de surproduction** paramétrable (`overproduction_percentage_*`).
- **Modes de *backflush*** (BOM vs matière transférée) — utile pour un article à flux rapide où le pesage pièce à pièce n'a pas de sens.
- **Désassemblage** (`disassembled_qty`), **OF correctif**, **génération auto n° lot/série depuis l'OF**.
- **Sous-traitance de fabrication** (façonnage externe) — cf. doc principal §A11.

---

## 3. Ce qui existe des deux côtés mais À AMÉLIORER

1. **Brancher gammes/postes (388) sur le flux réel.** Aujourd'hui `work_centers` + `routings` servent à un **coût de main-d'œuvre standard autonome**, déconnecté du coût réel (`production_cout_reel`, 090) et des étapes (089). → Les relier : l'exécution d'une étape sur un poste doit alimenter le temps réel et le coût réel, et permettre un **écart standard vs réel** de main-d'œuvre (vous avez déjà l'écart de mix matière en 268).
2. **Rendement → ajouter la charge/capacité.** Le module rendement (089, cible/réel/stats par produit) gagnerait une dimension **capacité** (temps disponible par poste/four) pour détecter les goulets.
3. **Nomenclature : explosion et roll-up multi-niveaux.** Matérialiser l'explosion (à la `BOM Explosion Item`) pour fiabiliser le coût des semi-finis en cascade et accélérer les écrans.
4. **Co-produits de la coupe (302) : allocation de coût.** Répartir le coût d'un cadre entre ses sorties (tranches + entremets) au prorata, au lieu d'un coût par sortie non ventilé.
5. **Centraliser les réglages de production** (tolérances, markup 142, charges fixes 118, politique de consommation) dans un écran unique type `Manufacturing Settings`.

---

## 4. Ce qu'Ofauria fait MIEUX qu'ERPNext (à préserver)

- **Pesage réel (BSI strict, 113)** : consommation matière au gramme, choix de lot, DLC, dérogation tracée (339), préparation partielle, validation chef, réception. ERPNext se contente d'un *stock entry* théorique (*backflush*).
- **Coût réel analytique (090 + 268)** : matière + usage équipement + temps de travail + **écart de mix**. Plus fin que le simple « planned vs actual operating cost » d'ERPNext.
- **Nomenclature par format / par personne / par pièce** (157/200/216) + **densité** poids↔volume (266) + frais indirects et main-d'œuvre éditables (159/213) : modèle pâtisserie qu'ERPNext ne sait pas représenter nativement.
- **Semi-finis** : détection automatique (`/detect-semi-finished`) + dépendances inter-plans + stock intermédiaire.
- **Coupe / sorties de cadre** (302) : un cadre → plusieurs produits (tranches, entremets) saisis à la production.
- **Traçabilité & rappel de lot** matière → client (ONSSA 056, 300, 337) : chaîne de rappel complète, au-delà du simple lot ERPNext.
- **Machine à états du plan** (299) avec relance, annulation tracée, retour brouillon.

---

## 5. Recommandations priorisées — Production

| Priorité | Chantier | Pourquoi | Effort |
|---|---|---|---|
| **P0** | **Brancher postes/gammes (388) sur le flux réel + coût réel (090)** | Débloque l'écart standard↔réel de main-d'œuvre sans nouveau modèle | Faible-Moyen |
| **P1** | **Capacité & charge par poste/four** (horaires, jours fériés, capacité) greffée sur le rendement | Détecter les goulets (fours, chariots 18 plaques) | Moyen |
| **P1** | **Allocation de coût des co-produits de la coupe** (302) | Coût de revient juste des tranches vs entremets d'un même cadre | Faible-Moyen |
| **P2** | **Exécution d'atelier légère** (étape = poste + opérateur + temps réel) | Pointage et temps réels par poste | Moyen |
| **P2** | **Explosion/roll-up multi-niveaux matérialisé** des nomenclatures | Fiabilité + perf du coût des semi-finis | Moyen |
| **P2** | **Outil de remplacement de composant en masse** (à la BOM Update Tool) | Maintenance des 365 fiches techniques | Faible-Moyen |
| **P3** | **Suivi des arrêts (downtime) + statut poste → TRS/OEE** | Pilotage industriel de l'atelier | Moyen |
| **P3** | **Génération auto des appros/ruptures depuis le plan** | Moins de ressaisie entre plan et achats | Moyen |

### Réserve de méthode
Analyse fondée sur les tables (migrations), les routes et les features client, pas sur une exécution. Les points marqués *« à confirmer »* (demande d'achat auto des ruptures depuis le BSI, lien commande de vente → plan) méritent une vérification ciblée dans les services correspondants.
