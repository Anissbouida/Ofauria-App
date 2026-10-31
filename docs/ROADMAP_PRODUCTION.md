# Feuille de route — Module Production (corrections + fonctionnalités manquantes)

> **Date :** 2026-10-29 · **Base :** [COMPARAISON_ERPNEXT_PRODUCTION.md](COMPARAISON_ERPNEXT_PRODUCTION.md)
> **Principe directeur :** *réutiliser l'existant, pas de refonte*. Les briques clés sont déjà là (coût réel 090, étapes 089/342, postes/gammes 388, coupe 302) ; l'essentiel du travail est de **les relier** et de combler quelques manques ciblés.

---

## Principes & conventions

- **Numérotation migrations :** la dernière sur `main` est **395**. Les numéros ci-dessous (396→) sont indicatifs ; **vérifier sur `main` juste avant de créer chaque fichier** (des numéros peuvent être pris entre-temps).
- **Conventions projet :** une migration SQL par lot, routes `*.routes.ts` + controller + repository, feature client sous `features/production/`, socle UI « pro » (`ModuleShell`, `odoo-table`, `ui-timeline`, `StatusBanner`, `ProcessBoard`, `ConfirmDialog`).
- **Au démarrage worktree :** `cd shared && npm run build` + `cp principal/.env .env` (sinon login 500).
- **Flag de déploiement :** chaque lot s'active via un booléen `company_settings` (comme `production_cost_enabled`) pour un déploiement progressif.
- **Pièges Postgres connus :** `GREATEST($N,0)` → caster `$N::numeric` ; vérifier les fonctions/regex en `pg_temp` + `ROLLBACK` avant de commiter.

## Constat préalable à trancher — doublon ressources

Deux tables modélisent aujourd'hui des « ressources » de production :
- `work_centers` (388) → **coût horaire main-d'œuvre**, utilisé par les gammes (standard, autonome) ;
- `production_equipements` (090) → **coût horaire énergie** (four, batteur…), utilisé par le coût réel.

👉 **Décision structurante du Lot 1 :** garder les deux rôles mais les **articuler** (un poste *peut* référencer un équipement), plutôt que de fusionner. Évite une migration lourde et respecte la distinction MO ≠ énergie déjà en place.

---

## Vue d'ensemble des lots

| Lot | Objet | Priorité | Effort | Dépend de | Migration(s) |
|---|---|---|---|---|---|
| **1** | Brancher gammes/postes sur le flux réel → **écart MO standard/réel** | P0 | Faible-Moyen | — | 396 |
| **2** | **Allocation de coût des co-produits** de la coupe | P1 | Faible-Moyen | — | 397 |
| **3** | **Capacité & charge** par poste/four (horaires, calendrier) | P1 | Moyen | 1 | 398 |
| **4** | **Exécution d'atelier** (étape = poste + opérateur + temps réel) | P2 | Moyen | 1, 3 | 399 |
| **5** | **Explosion / roll-up** de nomenclature matérialisé | P2 | Moyen | — | 400 |
| **6** | **Outil de remplacement de composant** en masse | P2 | Faible-Moyen | 5 | 401 |
| **7** | **Arrêts machine (downtime) + TRS/OEE** | P3 | Moyen | 3 | 402 |
| **8** | **MRP avancé** : lien commande→plan, appros auto, MPS | P3 | Élevé | — | 403-404 |
| **9** | **Réglages production centralisés** + surproduction + backflush | P3 | Faible-Moyen | — | 405 |

> Lots **indépendants** exécutables en parallèle : 1, 2, 5, 8, 9. Les lots 3→4→7 forment une chaîne « atelier ».

---

## Lot 1 — Gammes/postes branchés sur le flux réel (P0)

**Problème.** `work_centers` + `routing_operations` (388) calculent un coût MO **standard théorique** complètement déconnecté du coût réel (090). On ne peut pas comparer prévu vs réel sur la main-d'œuvre (alors que l'écart de mix matière existe déjà en 268).

**Objectif.** Rattacher chaque étape de production à une opération de gamme / un poste, puis produire un **écart standard ↔ réel** de main-d'œuvre par plan/produit.

**Migration 396 :**
```
ALTER TABLE production_item_etapes
  ADD COLUMN work_center_id        UUID REFERENCES work_centers(id),
  ADD COLUMN routing_operation_id  UUID REFERENCES routing_operations(id);
ALTER TABLE work_centers
  ADD COLUMN equipement_id UUID REFERENCES production_equipements(id); -- articulation MO/énergie
-- Vue d'écart : standard (gamme) vs réel (temps_travail) par plan_item
CREATE VIEW v_production_mo_ecart AS ...
```
**Endpoints** (`production-cout` existant) : `GET /plans/:planId/mo-ecart`, `GET /by-product/mo-ecart`.
**UI :** colonne « MO standard / réel / écart » dans `CoutReelPanel.tsx` ; sélecteur de gamme sur l'item de plan.
**Effort :** faible-moyen (données déjà présentes). **Risque :** rendre la gamme **optionnelle** (beaucoup d'items n'en auront pas) → écart affiché seulement si gamme renseignée.

---

## Lot 2 — Allocation de coût des co-produits de la coupe (P1)

**Problème.** `production_item_outputs` (302) liste les sorties d'un cadre (tranches, entremets) avec `quantity` + `equiv_pieces`, **sans coût**. Le coût de revient par produit issu d'un même cadre n'est donc pas ventilé.

**Objectif.** Répartir le coût total d'un item de plan sur ses sorties au **prorata des `equiv_pieces`** (ou d'une clé choisie), et exposer un **coût unitaire par sortie**.

**Migration 397 :**
```
ALTER TABLE production_item_outputs
  ADD COLUMN cost_share       NUMERIC(12,4),  -- coût alloué à la sortie
  ADD COLUMN unit_cost        NUMERIC(12,4),  -- cost_share / quantity
  ADD COLUMN allocation_basis VARCHAR(20) DEFAULT 'equiv_pieces';
```
**Logique :** au calcul du coût réel (hook sur `/plans/:planId/calculate`), ventiler `production_cout_reel.total` sur les outputs. **Endpoint :** `GET /plans/:planId/outputs-cost`.
**UI :** tableau des sorties avec coût unitaire dans `CoutReelPanel`. **Effort :** faible-moyen.

---

## Lot 3 — Capacité & charge par poste/four (P1)

**Problème.** Aucune notion de capacité : impossible de détecter un goulet (four, chariots 18 plaques).

**Objectif.** Donner à chaque poste/équipement une **capacité** et un **calendrier**, puis confronter la **charge planifiée** (gammes × quantités du plan) à la capacité disponible.

**Migration 398 :**
```
ALTER TABLE work_centers
  ADD COLUMN capacity_per_hour NUMERIC(10,2),  -- ex. plaques/h, pièces/h
  ADD COLUMN capacity_unit     VARCHAR(20);
CREATE TABLE work_center_calendar (          -- horaires + jours off
  work_center_id UUID, weekday INT, start_time TIME, end_time TIME, ...);
CREATE TABLE work_center_holidays (work_center_id UUID, day DATE, reason TEXT);
```
**Endpoints :** `GET /work-centers/:id/load?date=`, `GET /plans/:planId/charge` (charge vs capacité par poste).
**UI :** nouveau panneau « Charge & capacité » (barres charge/capacité par poste et par jour) dans `WorkCentersPage.tsx`.
**Effort :** moyen. **Dépend de** Lot 1 (lien étape↔poste). **Réutilise** `holiday_list` si une table de jours fériés existe déjà (paie).

---

## Lot 4 — Exécution d'atelier légère (P2)

**Problème.** Les étapes (089) ont déjà `started_by`/`completed_by`/`duree_reelle_min`/`responsable_role` mais **pas le poste** ni un suivi « qui occupe quel poste maintenant ».

**Objectif.** Faire de chaque étape une mini-fiche d'opération : poste + opérateur + temps réel, avec un tableau de bord atelier (occupation des postes en temps réel). *≈ Job Card ERPNext, version allégée.*

**Migration 399 :**
```
ALTER TABLE production_item_etapes
  ADD COLUMN assigned_employee_id UUID REFERENCES employees(id),
  ADD COLUMN paused_at TIMESTAMPTZ,
  ADD COLUMN pause_accumulee_min INT DEFAULT 0;
-- temps réel alimente automatiquement production_temps_travail (090)
```
**Endpoints :** `POST /etapes/:id/assign`, `POST /etapes/:id/pause|resume`, `GET /atelier/live` (postes occupés).
**UI :** tableau de bord atelier (`ProcessBoard`) ; au démarrage d'étape, créer une ligne `production_temps_travail` → alimente le coût réel sans ressaisie.
**Effort :** moyen. **Dépend de** 1 et 3. **Garde-fou :** rester *léger* (pas de transfert matière par opération — le pesage BSI reste la source matière).

---

## Lot 5 — Explosion / roll-up de nomenclature matérialisé (P2)

**Problème.** Le coût des semi-finis en cascade est calculé à la volée (vues `v_recipe_*_cost`) ; multi-niveaux = perf et fiabilité limitées. Pas d'équivalent `BOM Explosion Item`.

**Objectif.** Matérialiser l'explosion d'une recette/format en composants élémentaires avec coût roulé, recalculée sur changement de recette ou de coût matière.

**Migration 400 :**
```
CREATE TABLE recipe_explosion (
  recipe_id UUID, format_id UUID, level INT,
  component_recipe_id UUID, ingredient_id UUID,
  qty_base NUMERIC, unit_cost NUMERIC, rolled_cost NUMERIC,
  computed_at TIMESTAMPTZ);
```
**Logique :** fonction récursive `fn_explode_recipe(recipe_id, format_id)` + rafraîchissement (trigger ou job `scheduled_jobs` 364). **Anti-cycle :** réutiliser `recipe_components_no_cycle` (215).
**Endpoint :** `GET /recipes/:id/explosion`. **UI :** arbre d'explosion + coût roulé sur la fiche Composition.
**Effort :** moyen. **Risque :** cohérence avec les vues existantes → à terme, faire pointer les écrans de coût sur la table matérialisée.

---

## Lot 6 — Outil de remplacement de composant en masse (P2)

**Problème.** Remplacer un ingrédient sur les 365 fiches techniques = opération manuelle fiche par fiche.

**Objectif.** Remplacer un ingrédient/semi-fini **A → B** sur toutes les recettes qui l'utilisent, en une action, avec **aperçu** et **journal annulable**. *≈ BOM Update Tool.*

**Migration 401 :**
```
CREATE TABLE recipe_bulk_update_log (
  id UUID, source_ingredient_id UUID, target_ingredient_id UUID,
  scope JSONB, affected_recipes JSONB, performed_by UUID, performed_at TIMESTAMPTZ,
  reverted_at TIMESTAMPTZ);
```
**Endpoints :** `POST /recipes/bulk-replace/preview`, `POST /recipes/bulk-replace/apply`, `POST /recipes/bulk-replace/:logId/revert`.
**UI :** assistant (choix A→B, aperçu des recettes impactées, confirmation). **Effort :** faible-moyen. **Dépend de** Lot 5 (pour recalcul des coûts). **Réutilise** le pattern « journal annulable » de l'import générique (369/370).

---

## Lot 7 — Arrêts machine & TRS/OEE (P3)

**Objectif.** Saisir les arrêts (motif) et le statut des postes, puis un indicateur de performance (disponibilité × performance × qualité). *≈ Downtime Entry + Workstation status.*

**Migration 402 :**
```
ALTER TABLE work_centers
  ADD COLUMN status VARCHAR(20) DEFAULT 'idle'
  CHECK (status IN ('production','off','idle','probleme','maintenance','reglage'));
CREATE TABLE work_center_downtime (
  work_center_id UUID, from_time TIMESTAMPTZ, to_time TIMESTAMPTZ,
  reason VARCHAR(40), operator_id UUID, notes TEXT);
```
**Endpoints :** `POST /work-centers/:id/downtime`, `GET /work-centers/:id/oee?from&to`.
**UI :** bouton statut sur le tableau de bord atelier + widget TRS dans Rapports.
**Effort :** moyen. **Dépend de** Lot 3 (capacité pour le dénominateur de disponibilité).

---

## Lot 8 — MRP avancé (P3)

**Objectif.** Rapprocher le MRP d'Ofauria du `Production Plan` ERPNext :
1. **Lien commande de vente → plan** (générer le plan depuis les commandes à livrer).
2. **Explosion des sous-assemblages** avec **stock de sécurité** et saut des sous-assemblages déjà en stock.
3. **Génération automatique des approvisionnements** : créer les demandes d'achat / transferts pour les manquants détectés par le MRP (aujourd'hui le BSI pèse, mais la rupture ne crée pas d'appro auto).
4. **MPS** formalisé distinct du plan journalier.

**Migrations 403-404 :** colonnes de liaison (`production_plans.source_sales_order_id`), table `mps` + items, options `include_safety_stock` / `skip_available_subassembly`.
**Endpoints :** `POST /mrp/from-orders`, `POST /mrp/generate-supply` (appros auto), `GET/POST /mps`.
**UI :** étape « depuis commandes » dans `MrpPage.tsx` ; écran MPS.
**Effort :** élevé. **À confirmer d'abord dans le code :** le lien actuel commande→plan et la création d'appro depuis le BSI.

---

## Lot 9 — Réglages production centralisés (P3)

**Objectif.** Un écran unique « Paramétrage » du module (via `ModuleShell`) regroupant : tolérance de **surproduction**, politique de **consommation** (pesage réel vs *backflush* pour les articles à flux rapide), markup (142), charges fixes (118), flags des lots ci-dessus.

**Migration 405 :** table `production_settings` (ou extension `company_settings`) : `overproduction_pct`, `consumption_mode` (`weighing` | `backflush`), etc.
**Effort :** faible-moyen. **Bénéfice :** rend le module paramétrable sans redéploiement.

---

## Options complémentaires (hors chemin critique)

| Option | Intérêt pour vous | Reco |
|---|---|---|
| **Nomenclature fantôme** (phantom BOM) | Éclater un pré-mélange sans mouvement de stock intermédiaire | Utile si pré-mélanges, sinon différer |
| **Désassemblage** (work order inverse) | Reconditionner/récupérer un produit | Rare en pâtisserie → différer |
| **OF correctif / reprise** | Tracer une reprise de production | Partiellement couvert par la répétition d'étape → différer |
| **Génération auto n° lot depuis l'OF** | Déjà couvert par `product_lots` (105) | Vérifier, probablement RAS |
| **Sous-traitance (façonnage externe)** | Nouveau besoin si externalisation | Chantier séparé (cf. doc principal §A11) |

---

## Séquencement recommandé

1. **Sprint 1 (valeur immédiate, faible risque) :** Lot 1 + Lot 2 — branchement MO réel + coût juste des co-produits. Les deux réutilisent des tables existantes.
2. **Sprint 2 (pilotage atelier) :** Lot 3 → Lot 4 — capacité puis exécution par poste.
3. **Sprint 3 (nomenclature & maintenance données) :** Lot 5 → Lot 6.
4. **Sprint 4 (industrialisation) :** Lot 7, Lot 8, Lot 9 selon besoin terrain.

> Chaque lot est livrable indépendamment derrière son flag `company_settings`, testable sur `kalum_test` avant activation en prod.

### Réserve
Les volumes d'effort sont indicatifs et les points « à confirmer dans le code » (lien commande→plan, appro auto depuis BSI, réutilisation du calendrier jours fériés de la paie) doivent être vérifiés avant chiffrage ferme de chaque lot.
