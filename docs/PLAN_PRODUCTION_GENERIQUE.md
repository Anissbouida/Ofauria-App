# Plan — Production générique (socle fabrication + couche boulangerie)

*Rédigé le 2026-11-12. Rien n'est construit. Suite de [AUDIT_COUPLAGE_SECTORIEL.md](AUDIT_COUPLAGE_SECTORIEL.md) (lots L3/L4), vérifiée contre le code et la base. Pendant Production de [FEUILLE_DE_ROUTE_MULTI_SECTEUR.md](FEUILLE_DE_ROUTE_MULTI_SECTEUR.md) (domaine Ventes) ; le lot P2 réalise sa phase 2.3 pour la production.*

## 1. Objectif et principe

Aujourd'hui, le module Production n'existe que pour le secteur « Boulangerie / Pâtisserie » : les packs `generique` et `negoce` (mig 468/497) n'activent ni `production` ni `recipes`. C'est correct pour un négoce ou une société de services, comme dans les grands ERP où la fabrication est un module **optionnel**. Mais une entreprise qui fabrique autre chose que du pain n'a aujourd'hui aucune option.

**Principe retenu : un seul module Production, en deux couches.**

| Couche | Contenu | Qui l'active |
|---|---|---|
| **Socle fabrication** | nomenclature (BOM), ordre de fabrication, sortie matière, lots et traçabilité, coût réel, rendement, postes / gammes / TRS, MRP, semi-finis | tout secteur qui fabrique |
| **Couche boulangerie** | contenants en grammes (cru / cuit), CCP et relevés de cuisson, HACCP, gel / dégel, DLC du jour, vitrine, invendus, demandes boutique, PDF Masterclass darija | le secteur boulangerie, ou un traiteur à la carte |

On ne crée **pas** de deuxième module : stocks, lots, coût CMUP, traçabilité et besoins matière seraient sinon maintenus en double. Règle de l'audit maintenue : **le code ne teste jamais le code du secteur**, il lit des capacités (module actif, option active) que le pack positionne.

## 2. État des lieux (inventaire du 2026-11-12)

Estimation au poids du code et des tables :

- **≈ 40 % générique tel quel** : ordres de fabrication et machine à états (`production-state.ts`), postes / gammes / TRS (`work_centers`, `routings`, mig 388/402), plan directeur (`mrp.repository.ts`), semi-finis (mig 081), rendement, traçabilité des lots, marge.
- **≈ 35 % générique mais nommé F&B** : fiches techniques = BOM multi-niveaux (`recipes`, `recipe_components`, `recipe_sub_recipes`, versions), bon de sortie / « pesage » (saisie manuelle, aucune balance connectée dans le code), coût réel, étapes, sorties multiples (`production_item_outputs`, mig 302), import Excel.
- **≈ 25 % spécifique** : contenants (`recipe_formats.quantite_par_format_g`, `poids_cru_g` / `poids_cuit_g`), CCP (`CCP_STEP_TYPES`), relevés (mig 422), HACCP, `lot-thermal`, invendus (mig 062), demandes boutique (`replenishment`), PDF Masterclass (`recipe-fiche-pdf.service.ts`), DLC du jour (`production.repository.ts:1199-1226`).

### Couplages durs à lever

| # | Couplage | Où |
|---|---|---|
| C1 | **Atelier = rôle de chef.** Les rôles `baker` / `pastry_chef` / `viennoiserie` / `beldi_sale` sont les ateliers ; la catégorie → atelier est codée en dur | `shared/src/constants/roles.ts` (`PRODUCTION`, `CHEFS`, `BSI_VIEWERS`, `ROLE_CATEGORY_SLUGS`, `getCategoryRole`) ; `CHEF_ROLES` recopié dans `production.controller.ts`, `replenishment.controller.ts`, `mrp.repository.ts`, `ProductionPage.tsx`, `ReplenishmentPage.tsx` ; refus 403 `ROLE_CATEGORY_MISMATCH` (`production.controller.ts` ~155-175) ; `CATEGORY_ROLE_MAP` (`order.controller.ts` ~20-33) ; `production_plans.target_role` ; libellés Boulanger / Pâtissier dans `plan-print.ts` |
| C2 | **Quantités entières** | `production_plan_items.planned_quantity INTEGER` (et la vue `v_plan_item_rendement`) |
| C3 | **Listes figées dans le code** (équivalent de CHECK constraints) | types d'étape (`recipe.validator.ts`, mig 342) ; équipements four / pétrin / laminoir (`production-cout.validator.ts`, mig 090) ; paramètres de relevé (`production-etapes.validator.ts`, mig 422) ; unités g / kg / ml / l (`recipe-component.validator.ts`, `recipe.validator.ts`) ; `TYPE_PRODUCTION_LABELS` / `UNITE_LANCEMENT_OPTIONS` (`shared/src/constants/production-contenant.ts`) |
| C4 | **Secteur filtré côté client seulement** | `PermissionsContext.tsx:75` ; aucun middleware serveur ne lit `sector_packs` |
| C5 | **Vocabulaire** | `sector_labels` (mig 495) existe mais n'est branché qu'au titre de `ProductionLayout.tsx` |

## 3. Lots

Ordre conseillé : **P0a d'abord** (l'écran d'activation est le socle du reste), puis P1 → P2 → P3. P0b et P0c peuvent suivre P0a à tout moment, P4 à P7 dans n'importe quel ordre, et les lots de configuration intelligente (P8 à P11) en dernier.

Le lot P0 est découpé en trois pour rester livrable : **P0a le socle**, **P0b la sécurité** (aperçu d'impact, retour arrière), **P0c la finesse** (par établissement, pilote). Ce découpage reprend le meilleur des grands ERP : préréglage par secteur (ERPNext, Odoo), modules et options (Odoo, NetSuite), aucune perte de données (NetSuite, Sage), activation sans intégrateur (l'inverse de SAP). Il y ajoute ce qu'aucun ne fait aussi simplement : l'aperçu d'impact, le retour arrière en un clic, l'activation par établissement et le mode pilote.

Chaque lot est **additif** : la boulangerie doit fonctionner à l'identique après chacun, ce qui sert de test de non-régression. Numéros de migration à partir de **507**, à vérifier sur `main` au moment de coder.

### P0a — Écran d'activation des modules et options, le socle *(moyen, préalable)*

Aujourd'hui, la liste des modules visibles vient **uniquement** du secteur (`sector_packs.enabled_modules`). Aucun ajustement par société n'est possible : pour activer Production en secteur Générique, il faut une migration. Ce lot fait du secteur un **préréglage** que l'administrateur ajuste ensuite module par module et option par option. C'est l'équivalent, côté Oracle, d'un paramétrage société qui surcharge un profil standard.

**Modèle de données** (migration 507+, à vérifier sur `main`) :
- `company_module_settings (module_key PK, enabled BOOLEAN, updated_by, updated_at)` : ne stocke que les **écarts** au préréglage. Pas de ligne = le module suit le secteur.
- `app_features (key PK, module_key, label, description, sort_order)` : catalogue des options d'un module (ex. Production : `dlc_jour`, `ccp_cuisson`, `lot_thermal`, `vitrine`, `contenants_cru_cuit`, `fiche_masterclass`, `haccp` ; Ventes : `invendus`, `demandes_boutique`).
- `sector_packs.features TEXT[]` : options allumées par défaut pour chaque secteur (toutes pour `boulangerie`).
- `company_feature_settings (feature_key PK, enabled BOOLEAN, updated_by, updated_at)` : écarts aux options, même principe.
- Chaque changement est tracé dans le journal du paramétrage existant (`config_audit_log`, mig 328 : qui, quand, avant / après).

**Calcul unique, côté serveur** : `effectiveModules()` = modules du secteur + modules activés − modules désactivés ; `effectiveFeatures()` sur le même modèle. `/settings/sector` renvoie ces listes effectives. `PermissionsContext` n'a donc rien à changer : il lit déjà `current.modules`. Le droit final reste **modules effectifs ∩ droits du rôle**.

**Règles de gestion** :
- **Modules socle** non désactivables : `dashboard`, `settings`, `users`.
- **Dépendances** déclarées dans `shared` (ex. `production` ↔ `recipes`, `production` → `stock`, `unsold` / `replenishment` → `production`). Activer un module propose d'activer ses dépendances. Désactiver un module avertit des modules qui en dépendent et les désactive avec lui, après confirmation.
- **Alias** (`stock` / `economat` / `pesage` / `warehouse`) : un seul interrupteur, résolu par `resolveModuleKeys`.
- **Rien n'est supprimé** : désactiver masque les écrans et bloque l'API, les données restent. Réactiver réaffiche tout.
- **Changement de secteur** : la confirmation demande « garder mes ajustements » ou « repartir du préréglage » (vide les deux tables d'écarts).

**Garde serveur** (ferme C4) : un middleware `requireModule(module)` vérifie `effectiveModules()` (cache court, invalidé à chaque changement) sur les routes de chaque module (`/production`, `/recipes`, `/bons-sortie`, `/mrp`, `/replenishment`, `/unsold-decisions`, `/haccp`, puis les autres modules). Il renvoie 403 `MODULE_DISABLED`. Même chose pour les options sur les routes qui leur sont propres (ex. relevés CCP → `ccp_cuisson`).

**Écran** : Paramètres › Entreprise › « Secteur d'activité » devient **« Secteur et modules »** (droit `company` / `edit`).
1. **Secteur** : le choix actuel, présenté comme un préréglage.
2. **Modules** : groupés par domaine (Ventes et caisse, Achats et stock, Production, Gestion, Compta). Pour chacun : un interrupteur, le libellé et une ligne d'explication, un badge « Préréglage » ou « Ajusté », et un lien « Revenir au préréglage ».
3. **Options** : sous chaque module actif, ses options avec le même interrupteur et le même badge. Par exemple, Production › DLC du jour, Points critiques de cuisson, Gel / dégel, Fiche Masterclass bilingue.
4. Un bouton général « Revenir au préréglage du secteur ».

Gabarit des écrans « pro » : `odoo-table`, boutons `odoo-btn-*`, `ConfirmDialog` pour les dépendances. Après enregistrement, `reload()` des droits pour que les menus s'adaptent aussitôt (comme aujourd'hui pour le secteur).

**Fait quand** :
- en secteur Générique, l'administrateur active Production (Fiches techniques est proposé avec), et les menus apparaissent sans migration ;
- il éteint « DLC du jour » : l'option apparaît « Ajusté » et `hasFeature('dlc_jour')` renvoie faux (l'effet sur les lots arrive avec le câblage du code, en P5) ;
- un module désactivé renvoie 403 par l'API, et ses données réapparaissent intactes une fois réactivé ;
- le secteur Boulangerie sans ajustement se comporte exactement comme aujourd'hui.

### P0b — Aperçu d'impact et retour arrière *(moyen)*

Ce qui rend la configuration **sûre** : on voit l'effet avant de valider, et on peut tout annuler.

**Aperçu d'impact.** Avant d'enregistrer un changement, l'écran affiche :
- les menus qui apparaissent ou disparaissent (calculés côté client depuis `config/navigation`) ;
- les rôles qui gagnent ou perdent l'accès (droits du rôle ∩ modules effectifs, avant / après) ;
- les données concernées, par exemple « 38 plans de production et 52 fiches techniques seront masqués, pas supprimés » ;
- les dépendances, **expliquées** (« Fiches techniques est nécessaire à Production parce que… »).

Côté serveur : `POST /settings/modules/preview` reçoit les changements envisagés, n'écrit rien, et renvoie ce bilan. Les comptages viennent d'un registre déclaré dans le code (module → requêtes de comptage), sur le modèle du registre de sources des rapports configurables (mig 394) : pas de SQL dynamique.

**Configuration versionnée.**
- Table `config_versions (id, created_at, created_by, label, snapshot JSONB)`. Le `snapshot` contient le secteur et toutes les tables d'écarts (modules, options, puis établissements et pilotes de P0c).
- Chaque enregistrement crée une version, et `config_audit_log` (mig 328) garde le détail champ par champ.
- **Retour arrière en un clic** : « Revenir à la configuration du 10 novembre » restaure le snapshot dans une transaction, et la restauration crée elle-même une nouvelle version. On peut donc annuler l'annulation. En termes Oracle, c'est un flashback limité à la configuration.
- Écran : un onglet « Historique » dans « Secteur et modules », avec la liste des versions, qui / quand, le différentiel et le bouton « Restaurer ».

**Fait quand** :
- désactiver Production affiche le nombre exact de plans et de fiches masqués avant validation ;
- après trois changements, « Restaurer » ramène exactement la configuration choisie, menus compris, et une nouvelle version apparaît dans l'historique.

### P0c — Activation par établissement et activation pilote *(moyen)*

Ce qui rend la configuration **fine**.

**Par établissement.** Le labo a Production, la boutique ne l'a pas ; une boutique a les Invendus, l'autre non.
- Table `store_module_settings (store_id, module_key, enabled)` : écarts par établissement, appliqués **après** ceux de la société. Même principe pour les options (`store_feature_settings`).
- Seuls certains modules s'y prêtent. Le registre les déclare « par établissement » (caisse, invendus, demandes boutique, production…). Les modules centraux (compta, achats, paramètres) restent au niveau société.
- L'établissement de référence est celui de l'utilisateur (`users.store_id`) ou celui qu'il a sélectionné. Les modules effectifs dépendent donc de l'établissement courant.

**Activation pilote.** Un module (ou une option) a trois états : **éteint / pilote / actif**.
- En pilote, seuls les utilisateurs ou rôles listés dans `module_pilot_members (module_key, user_id | role)` le voient : par exemple le gérant et un chef pendant une semaine. On l'ouvre ensuite à tous d'un clic.
- La garde serveur de P0a vérifie aussi l'appartenance au pilote.

**Fait quand** :
- Production est actif pour le labo et invisible pour un utilisateur de la boutique, API comprise ;
- un module en pilote n'est visible que du gérant ; passé en « actif », tous les rôles autorisés le voient.

### P1 — Secteur « Industrie / Fabrication » *(faible)*

- **Migration** : nouveau pack `fabrication` = modules de `generique` + `production` + `recipes`. Les packs `generique` et `negoce` restent **sans** production.
- **Préréglage des options** (catalogue créé en P0a) : pour `fabrication`, les options de la couche boulangerie sont éteintes (HACCP, invendus, demandes boutique, DLC du jour…). Les onglets correspondants de `ProductionLayout` / `ModuleShell` sont masqués.
- **Fait quand** : on choisit « Industrie / Fabrication », Production apparaît sans HACCP, invendus ni demandes boutique, et l'écran de P0a permet d'en rallumer une.

### P2 — Ateliers paramétrables *(élevé, chemin critique)*

En termes Oracle : on remplace une table de correspondance codée en dur dans un package par une vraie table de référence.

- **Migration** :
  - table `production_workshops` (`id`, `code`, `label`, `work_center_id` facultatif, `is_active`) ;
  - table de liaison `production_workshop_categories (workshop_id, category_id)` ;
  - table `production_workshop_members (workshop_id, user_id | role)`.
- **Reprise** : créer les 4 ateliers actuels (Boulangerie, Pâtisserie, Viennoiserie, Beldi & Salé) depuis `ROLE_CATEGORY_SLUGS`, puis `production_plans.workshop_id` rempli depuis `target_role`.
- **Code** : un service unique `workshopForCategory(categoryId)` / `workshopsOfUser(userId)` remplace `getCategoryRole`, `getRoleCategorySlugs`, toutes les copies de `CHEF_ROLES` et `CATEGORY_ROLE_MAP`. Le contrôle 403 devient « l'utilisateur est-il membre de l'atelier du plan ? ».
- **Transition** : `target_role` reste rempli en parallèle pendant un lot, puis il est retiré.
- **Écran** : Paramètres › Production › Ateliers (libellé, catégories, membres).
- **Fait quand** : `grep CHEF_ROLES` ne renvoie plus rien hors tests, et un atelier « Montage » créé dans l'écran reçoit ses plans sans toucher au code.

### P3 — Quantités décimales et unité de l'ordre *(moyen)*

- **Migration** : `planned_quantity` (et `actual_quantity` s'il est entier) en `NUMERIC(14,3)`. La vue `v_plan_item_rendement` dépend de la colonne : il faut la `DROP` puis la recréer dans la même migration. Ajouter `unit` sur la ligne d'ordre (défaut `pièce`).
- **Code** : retirer les `parseInt` / `Math.round` sur ces quantités (client et serveur), et afficher l'unité saisie (règle « unité d'affichage »).
- **Piège** : ne jamais faire `CREATE OR REPLACE` d'une fonction ancienne en prod (propriétaire différent), créer une nouvelle version.
- **Fait quand** : un ordre de 12,5 kg se planifie, se lance et se clôture avec un rendement juste.

### P4 — Référentiels au lieu des listes figées *(moyen)*

- Tables de référence (même mécanisme que `container_types`, mig 225) : types d'étape, types d'équipement, paramètres de relevé, unités de lancement. Chaque ligne a un `sector_pack` facultatif pour le jeu par défaut.
- Les validateurs vérifient la présence dans le référentiel au lieu d'un `enum`. Les contraintes `CHECK` des mig 090 / 342 / 422 deviennent des clés étrangères.
- Unités des composants : brancher sur le référentiel d'unités et les conversions (mig 470), plus de liste `g / kg / ml / l / unit` en dur.
- **Fait quand** : on ajoute un type d'étape « Usinage » ou un équipement « Presse » dans Paramètres, sans migration.

### P5 — Couche boulangerie activable par options *(moyen)*

- Le catalogue des options, leur préréglage par secteur et leur écran sont livrés en P0a. Ce lot **branche le code** sur ces options, avec `hasFeature()` côté client et `effectiveFeatures()` côté serveur. Le code lit l'option, jamais le secteur :
  - `production.repository.ts` : DLC du jour et `product_display_tracking` seulement si `dlc_jour` / `vitrine` ;
  - `CCP_STEP_TYPES` et les relevés seulement si `ccp_cuisson` ;
  - formats : poids cru / cuit masqués sans `contenants_cru_cuit`, et le format devient « unité de lancement » (quantité + unité, plus de grammes imposés) ;
  - PDF : gabarit neutre par défaut, Masterclass bilingue si `fiche_masterclass`.
- Exemple visé : un traiteur garde la DLC du jour sans prendre les invendus, en deux clics dans l'écran de P0a.

### P6 — Vocabulaire neutre *(faible)*

- Étendre `sectorLabel(key, fallback)` à tout le module : menus, titres, colonnes, PDF, notifications.
- Clés à ajouter dans `sector_labels` pour le pack `fabrication` :

| Clé | Boulangerie | Fabrication |
|---|---|---|
| `recipe` / `recipes` | Fiche technique | Nomenclature |
| `production_plan` | Plan de production | Ordre de fabrication |
| `batch` | Fournée | Lot de fabrication |
| `material_issue` | Pesage / BSI | Sortie matière |
| `ingredient` | Ingrédient | Composant |
| `format` | Contenant | Unité de lancement |
| `workshop` | Atelier (chef) | Atelier |

- Les champs darija `*_ar` restent en base, ils ne sont affichés que si `fiche_masterclass`.

### P7 — Données de départ « Fabrication » *(faible)*

- Pack chargeable via `/settings/sector/starter` (mécanisme existant) : un atelier, des types d'étape et d'équipement neutres, des unités (pièce, kg, m, l), une nomenclature de démonstration.

### Plus tard — configuration intelligente (P8 à P11)

Ce qui rend la configuration **intelligente**. Ces lots s'appuient sur P0a et P0b (aperçu, versions) : chaque suggestion passe par l'aperçu d'impact et reste annulable.

- **P8 — Recommandations tirées de l'usage** *(moyen)*. Un « bilan de santé de la configuration », sur le modèle des contrôles du module Qualité : des requêtes sur les données, **sans IA**, qui proposent sans jamais imposer. Exemples :
  - « Vous vendez des articles achetés sans aucune fiche technique : masquer Production ? »
  - « 80 % des lots ont une date de péremption saisie : activer l'option DLC ? »
  - « Le module Projets n'a pas servi depuis 90 jours : le masquer ? »
  - « Production est actif mais aucun atelier n'est défini : le configurer ? »
- **P9 — Mise en route guidée par module** *(faible)*. Activer un module ouvre une courte liste de tâches (créer un atelier, une première nomenclature, charger les données de départ), cochées automatiquement quand la donnée existe. S'appuie sur `/settings/sector/starter`.
- **P10 — Configurations exportables** *(moyen)*. Une configuration complète (secteur, modules, options, vocabulaire, données de départ) s'exporte en modèle réutilisable. Une configuration « traiteur » réussie devient un secteur proposé aux clients suivants : à terme, un catalogue de secteurs enrichi par l'usage.
- **P11 — Configuration en langage naturel** *(élevé, en dernier)*. « Je fabrique des meubles sur commande et je vends en showroom » : Kalum propose secteur, modules, options et vocabulaire, que l'administrateur valide avec l'aperçu d'impact. C'est le seul lot qui demande une IA.

**Préparer l'abonnement sans le construire.** En SaaS multi-sociétés, une troisième couche s'ajoutera, comme chez Business Central : modules **inclus dans l'abonnement** ∩ modules **activés** ∩ droits du rôle (table `tenant_modules` du plan SaaS). P0a doit garder `effectiveModules()` comme point unique, pour pouvoir y brancher cette intersection plus tard.

## 4. Risques et points d'attention

- **Non-régression boulangerie** : c'est le seul client en prod. Chaque lot doit passer les scénarios existants (production, BSI, coût réel, MRP) avec le pack `boulangerie`, avant toute fusion.
- **P2 touche aux droits** : la reprise de `target_role` vers `workshop_id` doit être vérifiée plan par plan en base locale, puis en prod, avant de retirer l'ancien code.
- **P3 change un type de colonne** utilisé par une vue et des rapports : recenser les `::int` et les agrégats avant de migrer.
- **Base locale partagée** (client 4173) : appliquer les migrations avec une sauvegarde préalable, et ne jamais restaurer un snapshot par-dessus.

## 5. Estimation

| Lot | Effort | Dépend de |
|---|---|---|
| **P0a Socle : secteur = préréglage, modules / options, garde serveur, écran** | moyen | — |
| P0b Aperçu d'impact + configuration versionnée | moyen | P0a |
| P0c Par établissement + activation pilote | moyen | P0a |
| P1 Secteur « Fabrication » | faible | P0a |
| P2 Ateliers | élevé | P1 |
| P3 Quantités décimales | moyen | — |
| P4 Référentiels | moyen | — |
| P5 Options boulangerie (câblage du code) | moyen | P0a |
| P6 Vocabulaire | faible | P1 |
| P7 Données de départ | faible | P2, P4 |
| P8 Recommandations par l'usage | moyen | P0b |
| P9 Mise en route guidée | faible | P0a, P7 |
| P10 Configurations exportables | moyen | P0b |
| P11 Configuration en langage naturel | élevé | P0b, P10 |

P0a + P1 + P6 suffisent pour une démonstration « Fabrication » crédible (menus et mots neutres). P2 et P3 sont nécessaires avant un vrai client industriel.
