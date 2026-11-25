# Personnalisation multisectorielle — audit et plan d'action

Rédigé le 24 novembre 2026, sur la branche `claude/kalum-erp-customization-2845eb` (code à la migration 662 ; `main` est à la 663).

- Maquette cliquable : [maquette/assistant-configuration.html](maquette/assistant-configuration.html) — 4 planches : assistant en 12 étapes, reprise et évolution, profils industriels, analyse d'impact. Elle reprend la feuille de style compilée de Kalum et la coquille réelle des Paramètres.
- Ce document : ce qui existe, ce qui manque, l'architecture visée, puis 18 lots dans l'ordre d'exécution.

Rien n'est codé à ce stade. Les noms de tables, de fichiers et de routes marqués « à créer » sont des propositions ; les autres ont été lus dans le code.

---

## 1. Ce qui existe déjà

Kalum a déjà un moteur de secteur. Le besoin décrit ne part donc pas de zéro : environ la moitié des 12 étapes s'appuie sur des écrans et des tables en place.

| Sujet | Existant (lu dans le code) | Décision |
|---|---|---|
| Profils | 9 profils en base (`sector_packs`, mig 468 → 633) avec héritage parent → enfant, résolu par `resolvePacks()` (`server/src/repositories/sector.repository.ts`). 6 sur 9 sont à l'état « à valider ». | Conserver, enrichir |
| Création de profil sans code | `POST /settings/sectors` enregistre la configuration courante comme profil. On ne peut ni modifier ni versionner un profil. | Améliorer |
| Spécialités | `sector_specializations` (mig 633) : 7 spécialités, toutes rattachées à la boulangerie. | Étendre |
| Modules | 22 modules activables, 3 non désactivables. Liste et 5 dépendances en code (`shared/src/constants/module-activation.ts`). Garde serveur `module-activation.middleware.ts`. | Conserver, déplacer les relations en base |
| Sous-modules | 25 capacités dans `app_features`, avec `requires[]` et un type « réglementaire » qui interdit la désactivation si la capacité est utilisée. | Conserver |
| Aperçu d'impact | `POST /settings/modules/preview` pour les modules et capacités. | Généraliser |
| Versions | `config_versions` (mig 508), comparaison et restauration. La restauration ne remet que 6 couches sur 11. | Compléter |
| Héritage | Trois mécanismes séparés : profil, politiques de production (`policy_values`, 5 portées), écrans (`screen_definitions`). Ni pays, ni utilisateur. | Refactoriser en un seul |
| Vocabulaire | 25 clés (`shared/src/constants/vocabulary.ts`), profil puis renommage société. Pluriel en clé séparée, français seul. Environ 10 700 chaînes en dur à côté. | Étendre fortement |
| Assistants | Liste de contrôle `SetupHome`, parcours de production en 8 étapes (`production-setup.ts`, avec simulation en transaction annulée), proposition par IA depuis une description (`config-assistant.ts`). Aucune progression enregistrée. | Réutiliser dans un parcours unique |
| Bilan de santé | 24 contrôles déterministes (`config-health.ts`). | Réutiliser comme contrôles de cohérence |
| Société, établissements | `company_settings` (ligne unique), `legal_entities`, `stores`, `currencies`, `country_packs` (un seul pays : Maroc). Pas de langue ni de fuseau par défaut. | Compléter |
| Rôles | Tables `roles` et `role_permissions`, rôles personnalisés, séparation des tâches (`sod_rules`), délégations. Les 9 rôles système sont ceux d'une boulangerie ; `ROLE_GROUPS` borne encore les routes. | Conserver, ajouter des jeux de rôles par profil |
| Approbations, numérotation, notifications | En place : `approval_rules` (mig 350), `document_sequences` (mig 329), `notification_rules` (mig 332). | Réutiliser tels quels |
| Champs et écrans | Champs personnalisés (mig 369), colonnes et sections par société ou rôle (mig 646, surtout production), rapports configurables (mig 394). | Étendre le catalogue d'écrans |
| Import | `data-import.ts` : fournisseurs, clients, matières, consommables, produits (mise à jour). Aperçu, annulation. | Ajouter 5 entités |
| Comptabilité | Plan CGNC posé par migration, journaux, exercices, codes de TVA datés, centres de coûts. 144 numéros de compte en dur dans 14 fichiers. | Voir lot 10 et l'audit comptable |
| Journal | `config_audit_log` (mig 328), ancienne et nouvelle valeur. | Conserver |
| Garde-fou | `never-sector-guard.test.ts` : le code ne compare jamais le code du secteur. | Conserver, mettre à jour |

## 2. Ce qui manque

Par ordre de poids :

1. **Aucun parcours unique.** Pas de composant d'étapes, pas de progression enregistrée, pas de mode rapide ou avancé, pas de premier démarrage.
2. **Pas de chaîne d'héritage unique.** Les niveaux pays et utilisateur n'existent pas ; les règles de ventes, d'achats et de comptabilité (`module_parameters`) sont globales, sans héritage ni export.
3. **Pas de verrou de paramètre.** Rien n'empêche un niveau bas de défaire une règle réglementaire, hors capacités « réglementaires ».
4. **Un seul secteur par société**, pas d'activité secondaire.
5. **Pas de notion d'incompatibilité** entre modules, ni de classement obligatoire / recommandé / facultatif / non pertinent par profil.
6. **Vocabulaire trop étroit** : 25 termes de production, pas de traduction ni de synonyme.
7. **Pas de rôles proposés par profil**, pas d'accueil par rôle, pas de préférences utilisateur.
8. **Import incomplet** : employés, fiches techniques, stocks initiaux, soldes d'ouverture, plan comptable. Données de démonstration non marquées et non effaçables.
9. **Simulation et activation limitées à la production.** L'activation n'est pas une seule transaction couvrant toute la configuration.
10. **Profils non versionnés** : pas d'édition, pas de comparaison entre profils, pas de mise à niveau d'une société vers une nouvelle version.

Limites d'architecture à connaître avant de commencer :

- Une seule société par base (`company_settings id = 1`). L'isolation entre sociétés reste « sur décision » dans le plan de production (étape 14).
- Les catalogues de modules, de paramètres, de termes et de contrôles sont en code. C'est voulu pour ce qui est lu par le code ; seules les valeurs et les relations doivent passer en base.
- Cache de 30 secondes par instance sur l'activation et les politiques.
- Deux documents sont périmés et décrivent le secteur comme absent : `docs/AUDIT_COUPLAGE_SECTORIEL.md`, `docs/FEUILLE_DE_ROUTE_MULTI_SECTEUR.md`.

## 3. Architecture visée

```
Catalogue (code)            Valeurs (base)                     Consommateurs
────────────────            ──────────────                     ─────────────
paramètres, modules,   →    config_values par niveau      →    resolveConfig(clé, contexte)
termes, écrans, règles      socle › pays › secteur ›           menus, écrans, validateurs,
de cohérence                spécialité › entreprise ›          documents, comptabilisation
                            établissement › utilisateur
                                    ↑
Profils versionnés ─────────────────┤
(sector_pack_versions)              │
                                    │
Assistant : session → jeu de changements → contrôles → simulation → activation (1 transaction) → version
```

Quatre règles tiennent l'ensemble :

1. **Le code ne lit jamais le secteur.** Il lit un paramètre, une capacité ou un terme. Le test `never-sector-guard` le vérifie déjà.
2. **Un seul résolveur.** Toute valeur de configuration passe par `resolveConfig(clé, contexte)`. Le niveau le plus précis l'emporte, sauf si un niveau au-dessus a verrouillé la valeur.
3. **Rien n'est appliqué en dehors d'un jeu de changements.** L'assistant, la reconfiguration et la mise à niveau d'un profil produisent tous un jeu de changements, contrôlé, simulé, puis appliqué en une transaction qui crée une version.
4. **Désactiver masque, ne supprime pas.** Aucune opération de configuration ne supprime de pièce, d'écriture ni de donnée.

Règle de priorité entre niveaux :

| Cas | Résolution |
|---|---|
| Valeur posée à plusieurs niveaux | Le niveau le plus précis gagne : utilisateur, puis établissement, entreprise, spécialité, secteur, pays, socle. |
| Deux spécialités posent des valeurs différentes | Booléen : « oui » gagne. Liste : union. Nombre ou choix : conflit signalé à l'administrateur, qui tranche au niveau entreprise. |
| Secteur principal et secondaire | Modules et capacités : union. Vocabulaire et valeurs uniques : le secteur principal gagne. |
| Paramètre verrouillé | Le niveau qui verrouille fixe la valeur ; toute écriture en dessous est refusée (`CONFIG_LOCKED`). Seuls le socle et le pays verrouillent en « sécurité » ou « réglementaire » ; un secteur peut verrouiller en « réglementaire ». |
| Niveau utilisateur | Ouvert seulement aux paramètres marqués « préférence » (langue, densité, accueil, colonnes). |

## 4. Règles d'exécution

- Un lot par commit, sur une branche dédiée, fusion sur `main` à la demande.
- Chaque réglage garde pour valeur par défaut le comportement actuel d'Ofauria. Avant et après chaque lot : `npm run config:snapshot` puis `config:compare` (depuis `server/`), écart attendu nul.
- Numéros de migration : à partir de 664, à revérifier sur `main` avant chaque lot.
- Écrans : composants de `client/src/components/ds`, jetons `--ds-*`, contrôle à l'écran sur 5173 après fusion.
- Un lot est fini quand ses tests passent et que le scénario concerné (§ 6) a été rejoué.

Taille : P = petit, M = moyen, G = gros.

---

## 5. Les lots

### Lot 0 — Filet de sécurité (P)

**But.** Pouvoir prouver à chaque lot qu'Ofauria n'a pas bougé.

- Instantané de référence de la configuration d'Ofauria (outil existant `config:snapshot`), ajouté aux tests.
- `never-sector-guard.test.ts` : ajouter les codes `agroalimentaire` et `agro_conditionne`, qu'il ignore aujourd'hui.
- Marquer les deux documents périmés et renvoyer vers ce plan depuis `docs/GUIDE_CONFIGURATION_INDUSTRIE.md`.
- Relever les 7 scénarios du § 6 sous forme de fichiers de test vides, qui se rempliront lot après lot.

**Fin.** Suite de tests verte, instantané archivé.

### Lot 1 — Socle de l'assistant : étapes, session, reprise (M)

**But.** Un parcours vide mais complet : navigation, enregistrement automatique, reprise, mode rapide ou avancé.

**Données (mig 664).** Table `config_wizard_sessions` : `id`, `kind` (`initial` | `evolution` | `upgrade`), `status` (`draft` | `simulated` | `applied` | `abandoned`), `mode` (`quick` | `advanced`), `current_step`, `answers jsonb`, `issues jsonb`, `base_version_id` (version de configuration au départ), `revision int` (verrou optimiste), auteur et dates. Un seul brouillon `initial` à la fois (index partiel unique).

**Serveur.**
- `server/src/services/wizard/steps.ts` (à créer) : registre déclaratif des étapes — `key`, `phase`, `advanced`, `visibleWhen(answers)`, `validate(answers)` qui rend des points bloquants, des avertissements et des informations. C'est ce registre qui rend le parcours dynamique.
- Routes `GET/POST /settings/assistant`, `PUT /settings/assistant/:id` (enregistre une étape, refuse si `revision` a changé), `POST …/abandon`. Droit : `settings` en modification.
- `setup-status.ts` renvoie le brouillon en cours pour la vue d'ensemble.

**Client.**
- Trois composants ajoutés au Design System : `Stepper` (carte « Votre progression » avec pourcentage, puis étapes numérotées par phase, état fait / en cours / à corriger), `ChoiceCard` (carte à icône et coche, `aria-pressed`), `Switch` (l'actuel `OdooToggle` de `SettingsPrimitives.tsx`, déplacé).
- Route `/settings/assistant` : page pleine largeur sans menu latéral, en trois colonnes — progression et étapes, contenu de l'étape, panneau « Assistance Kalum » (explication de l'étape, recommandation, configuration actuelle, chaîne d'héritage). Pied fixe en bas d'écran : état d'enregistrement et « Enregistrer et quitter » à gauche, Précédent, Suivant ou Terminer à droite. Enregistrement à chaque changement d'étape et après 2 secondes d'inactivité.
- `SetupHome.tsx` : carte « Configuration en cours — Reprendre ».
- Premier démarrage : si aucune version de configuration n'existe, l'administrateur arrive sur l'assistant.

**Tests.** Reprise après fermeture ; deux onglets (le second est refusé, pas écrasé) ; passage rapide ↔ avancé sans perte de réponses.

### Lot 2 — Moteur de configuration : un résolveur, sept niveaux, verrous (G)

**But.** Remplacer les trois résolutions séparées par une seule. C'est le lot dont tout le reste dépend.

**Données (mig 665-666).**
- Table `config_values` : `key`, `scope_type`, `scope_id`, `value jsonb`, `locked boolean`, `lock_reason` (`regulatory` | `security`), `source` (version de profil ou saisie). `scope_type` ∈ `base`, `country`, `sector`, `specialization`, `company`, `legal_entity`, `store`, `workshop`, `order_type`, `product`, `user`.
- Reprise des données : `policy_values` (5 portées) et `module_parameters` (global → portée `company`) y sont copiées ; les deux anciennes tables deviennent des vues en lecture pendant un cycle, puis sont retirées.

**Serveur.**
- `parameters-catalog.ts` : chaque paramètre déclare en plus `levels` (niveaux autorisés), `lockable`, `merge` (`override` | `or` | `union` | `conflict`), `preference` (ouvert à l'utilisateur).
- `server/src/services/config-resolver.ts` (à créer) : `resolveConfig(key, ctx)` et `explainConfig(key, ctx)` qui rend la valeur à chaque niveau et celui qui gagne — c'est ce que montre le tableau « Chaîne d'héritage » de la maquette. `resolvePolicy` (`policies.ts`) devient un simple appel.
- Écriture : `setConfig` refuse avec `CONFIG_LOCKED` si un niveau au-dessus a verrouillé.
- Cache : invalidation par numéro de version de configuration plutôt que par délai seul.

**Client.** Écran « Chaîne d'héritage » (lecture) dans Paramètres › Profils industriels ; chaque réglage des pages de règles affiche d'où vient sa valeur et un cadenas s'il est verrouillé.

**Tests.** Table de vérité de priorité ; verrou (écriture refusée à chaque niveau inférieur) ; conflit entre deux spécialités ; `config:compare` nul sur Ofauria ; `profile-coverage.db.test.ts` toujours vert.

**Risque.** Tous les lecteurs de `module_parameters` changent de source. Passer par les vues de compatibilité, puis migrer les lectures module par module.

### Lot 3 — Étape 1 : entreprise (P)

**Données (mig 667).** `company_settings` : `default_locale`, `timezone`, `company_size`, `tax_regime`. Devises secondaires : `currencies` existe déjà.

**Serveur.** Le niveau `country` du résolveur est alimenté par `country_packs` / `country_pack_parameters` (mig 606), avec `locked = true` pour les paramètres réglementaires. `addTaxRate` cesse d'écrire `'MA'` en dur.

**Client.** L'étape réutilise les formulaires de `CompanyPage.tsx`, `StoresPanel.tsx` et `CompanyLegalEntities.tsx`, extraits en composants sans leur barre d'enregistrement. Champs verrouillés après la première écriture comptable : devise principale, pays.

**Fin.** Une société créée par l'assistant a ses établissements, sa langue et son fuseau ; les documents utilisent le fuseau de la société.

### Lot 4 — Étapes 2 et 3 : secteurs, activités secondaires, spécialités (M)

**Données (mig 668-669).**
- Table `company_sectors` : `sector_code`, `is_primary`, `pack_version`. `company_settings.sector_pack` reste, tenu égal au secteur principal par déclencheur, pour ne casser aucun lecteur.
- `sector_packs` : `icon`, `summary`, `module_classes jsonb` (voir lot 5).
- `sector_specializations` : levée du rattachement à la seule boulangerie ; ajout des 5 spécialités manquantes (restauration rapide, glacerie, café et salon de thé, production artisanale, production industrielle) et des spécialités des autres profils.
- Nouveaux profils à l'état « à valider » : commerce de détail, restauration et hôtellerie, bâtiment, agriculture, textile, transport, services, santé, commerce électronique. Le négoce existant devient « commerce de gros et distribution ».
- Les données de départ en code (`STARTER` de `sector-starter.service.ts`) passent dans la colonne `sector_packs.starter`, déjà utilisée par les profils personnalisés.

**Serveur.** `resolvePacks()` accepte plusieurs secteurs : union des modules et capacités, priorité au principal pour le reste (§ 3). Routes `PUT /settings/sectors/secondary`.

**Client.** Étape « Secteur » en cartes (`ChoiceCard`), case « activité secondaire » ; étape « Spécialités » alimentée par le ou les profils choisis. `SectorTab.tsx` garde son onglet et lit les mêmes données.

**Tests.** `inheritance.db.test.ts` étendu au multi-secteur ; ajouter puis retirer une activité secondaire ne supprime aucune donnée.

### Lot 5 — Étape 4 : modules, sous-modules, moteur de dépendances (M)

**Données (mig 670).** Table `module_relations` : `module`, `related`, `kind` (`requires` | `conflicts` | `recommends`), `reason`. Les 5 dépendances de `MODULE_DEPENDENCIES` y sont copiées.

**Serveur.**
- `shared/src/constants/dependency-engine.ts` (à créer), fonction pure partagée client et serveur : fermeture des prérequis, conflits, liste des modules qui dépendent de celui qu'on retire, conséquences. `withRequirements` (capacités) y est fusionné.
- Classement par profil dans `module_classes` : obligatoire, recommandé, facultatif, non pertinent. Résolu comme le reste (union entre secteurs, le classement le plus fort gagne).
- `planAdjustments` et `module-impact.ts` appellent le moteur.
- Compléter la garde serveur : seules 6 familles de routes sont gardées par capacité aujourd'hui.

**Client.** Étape « Modules » : une ligne par module (étiquette de classement, interrupteur, prérequis), sous-modules en mode avancé. Activer un module active ses prérequis et le dit ; retirer un module dont un autre dépend est refusé avec la liste.

**Tests.** `module-activation.db.test.ts`, `capabilities.db.test.ts` étendus ; tests unitaires du moteur (cycles, conflits).

### Lot 6 — Étape 5 : modèle opérationnel (M)

**But.** Une douzaine de questions en langage métier, chacune reliée à des paramètres du catalogue.

**Serveur.** `server/src/services/wizard/operating-model.ts` (à créer) : pour chaque question, la condition d'affichage (module actif, spécialité), les réponses possibles et les paramètres qu'elle pose. Exemple : « Production à la commande » pose le type d'ordre par défaut et active la capacité de planification à la commande. Paramètres à ajouter au catalogue pour les ventes et le stock, aujourd'hui sans équivalent : canal principal, organisation du stock, suivi par défaut des articles, transferts.

**Client.** Lignes de réglage avec `Segmented` ou `Switch` ; groupes masqués quand le module correspondant est inactif.

**Décision à prendre.** Méthode de valorisation des stocks : aujourd'hui le coût d'une matière est celui du lot en cours d'utilisation (mig 653), sans choix. Offrir coût moyen pondéré et premier entré, premier sorti suppose un développement à part (voir § 8, D2).

### Lot 7 — Étape 6 : dictionnaire métier (G)

**Données (mig 671).** `sector_labels` et `company_label_overrides` reçoivent `locale`, `form` (`singular` | `plural`) et `synonyms text[]`. Le catalogue (`VOCABULARY_KEYS`) passe d'environ 25 à environ 200 termes, groupés par domaine (stock, achats, ventes, production, qualité, personnel, comptabilité), chacun avec genre, singulier et pluriel par défaut.

**Serveur.** `term(key, { plural, locale })` côté serveur pour les documents PDF, les notifications, les e-mails et les exports. Les synonymes alimentent la recherche globale et ⌘K.

**Client.** `useTerm()` remplace `useProdTerms()` et `sectorLabel()` (94 appels à migrer). Étape de l'assistant : 6 à 10 termes clés avec aperçu en direct ; l'écran `VocabularyPanel.tsx` reste l'endroit pour tous les termes.

**Garde-fou.** Un test compte les occurrences en dur des termes du catalogue dans `client/src` et `server/src`, avec un plafond qui baisse à chaque lot. Ordre de passage : menus et titres, puis documents imprimés, notifications, rapports, enfin libellés de formulaires.

**Limite assumée.** Les identifiants techniques, les noms de tables et les clés d'API ne changent jamais. Les 10 700 chaînes non traduites relèvent du chantier de traduction (`docs/I18N_AVANCEMENT.md`), pas de ce lot.

### Lot 8 — Étape 7 : processus et règles de gestion (M)

Presque tout existe ; le lot assemble.

- **Parcours de production** : l'étape lit et écrit les modèles de `ProcessModelsTab.tsx` (étapes requises par type d'ordre). Les étapes imposées par un profil sont verrouillées par le lot 2.
- **Approbations** : jeux de règles proposés par profil, insérés dans `approval_rules` s'ils sont absents ; seuils modifiables dans l'étape.
- **Numérotation, notifications** : liens vers `NumberingTab.tsx` et `NotificationsTab.tsx` ; l'assistant propose un préfixe par établissement.
- **Champs obligatoires (mig 672)** : table `field_rules` — `entity`, `field`, `rule` (`required` | `hidden` | `readonly`), portée. Appliquée côté serveur par un utilitaire commun des validateurs et côté client par `FormField`. Une liste blanche borne les champs concernés : une règle ne peut pas rendre facultatif un champ exigé par la base ou par la loi.
- **Comptabilisation automatique** : affichée, non désactivable.

**Tests.** Une production sans fiche technique est refusée quand la règle l'exige et acceptée sinon ; une règle verrouillée ne se retire pas.

### Lot 9 — Étape 8 : interfaces par métier (G)

**Données (mig 673-674).**
- `role_workspaces` : `role_id`, `home_route`, `widgets jsonb`, `shortcuts jsonb`.
- `user_preferences` : `user_id`, `key`, `value` — niveau « utilisateur » du résolveur, pour les seuls paramètres marqués préférence.

**Serveur.** Registre de tuiles d'accueil (`dashboard-widgets.ts`, à créer) : chaque tuile déclare le module et le droit qu'elle exige. Le catalogue d'écrans (`screen-catalog.ts`) est étendu aux listes de ventes, d'achats et de stock.

**Client.** `HomePage.tsx` affiche l'accueil du rôle (tuiles + raccourcis) à la place de la grille de modules quand il est défini. Étape de l'assistant : un tableau rôle → écran d'accueil, bouton « Ajuster » vers `ScreenConfiguratorTab.tsx`.

**Règle.** Un seul gabarit, les mêmes composants : la configuration choisit des tuiles, des colonnes et des raccourcis, jamais une mise en page.

### Lot 10 — Étape 9 : comptabilité et fiscalité (G, lié à l'audit comptable)

**Données (mig 675).** `country_pack_versions` : le référentiel d'un pays (plan comptable, journaux, taux, règles de clôture) est daté et versionné ; la société garde la version qu'elle a acceptée.

**Serveur.**
- Le plan CGNC posé par la migration 179 devient le contenu du référentiel Maroc ; les sociétés en service ne sont pas touchées.
- L'étape pose : régime de TVA, exercice, centres de coûts proposés d'après les spécialités et les établissements, journaux selon les modules actifs.
- Les paramètres réglementaires sont écrits au niveau `country` avec verrou.

**Hors de ce lot.** Les 144 numéros de compte en dur et les 12 défauts bloquants relevés par l'audit comptable (`docs/audit-compta-2026-11`, autre branche) se traitent dans son plan. L'assistant ne doit pas proposer de schéma de comptabilisation configurable tant que ce chantier n'a pas mis les comptes en table.

**Tests.** `country-pack.db.test.ts` ; tentative de désactiver un contrôle de clôture réglementaire refusée.

### Lot 11 — Étape 10 : rôles et autorisations (M)

**Données (mig 676).** `sector_role_templates` : profil ou spécialité, code, libellé, droits par module, périmètre (soi, établissement, société), accueil.

**Serveur.**
- Appliquer un jeu de rôles crée les lignes de `roles` et `role_permissions` absentes, sans toucher aux rôles existants.
- Archétypes neutres pour `base_role` (direction, responsable, opérateur, caisse, comptable) à la place de `baker` et `manager`.
- Contrôle de séparation des tâches (`sod_rules`) exécuté sur le jeu retenu.
- Remplacement progressif de `ROLE_GROUPS` par les droits de `PERMISSION_ROUTES`, route par route, sous le contrôle de `route-rights.snapshot.json`.

**Client.** Étape : tableau des rôles proposés (case à cocher, accès, périmètre) et avertissements de séparation des tâches. Le détail reste dans `client/src/features/users/`.

### Lot 12 — Étape 11 : initialisation des données (M)

**Serveur.**
- `IMPORT_ENTITIES` (`data-import.ts`) : employés, création de produits, fiches techniques et nomenclatures, stocks initiaux (créent les lots d'ouverture), soldes comptables d'ouverture (écriture d'à-nouveau équilibrée, refusée sinon), plan comptable.
- Données de démonstration : chargées comme un import de type « démonstration » ; le journal d'import sait déjà annuler ce qu'il a créé, la purge est donc l'annulation de cet import. Une garde refuse la première écriture comptable réelle tant qu'une démonstration est chargée.

**Client.** Étape : une ligne par donnée (état, modèle de fichier, importer), réutilisant `ImportSection.tsx`.

**Tests.** Doublons détectés avant validation ; purge de la démonstration sans reste ; soldes d'ouverture déséquilibrés refusés.

### Lot 13 — Étape 12 : révision, simulation, activation (G)

**But.** Appliquer toute la configuration en une fois, ou rien.

**Données (mig 677).** `config_change_sets` : `session_id`, `operations jsonb` (liste ordonnée par couche), `status`, résultat de simulation, version créée.

**Serveur.**
- `compileChangeSet(session)` traduit les réponses en opérations ; `applyChangeSet` les exécute dans une seule transaction avec les fonctions existantes (secteur, modules, valeurs de configuration, vocabulaire, rôles, données de départ), puis crée la version. En cas d'erreur, rien n'est écrit et la session reste en brouillon.
- `config-layers.repository.ts` : la version capture toutes les couches et la restauration les remet toutes (aujourd'hui 6 sur 11).
- Simulation : généralisation de `simulateOrder` — une vente, un achat, une production et leurs écritures, déroulés dans une transaction annulée.
- Aperçu : `GET /settings/assistant/:id/preview` rend le menu, les termes et les accueils que donnerait le brouillon ; c'est le panneau de droite de la maquette.

**Client.** Étape de révision (récapitulatif, points à régler avec « Corriger », Simuler, Terminer et activer). « Activer » reste désactivé tant qu'un point bloquant subsiste ou que la simulation n'a pas réussi.

**Tests.** Injection d'une panne au milieu de l'application : base inchangée. Restauration de la version précédente : `config:compare` nul.

### Lot 14 — Moteur de profils : édition, versions, comparaison (M)

**Données (mig 678).** `sector_pack_versions` : `code`, `version`, `content jsonb`, `status` (`draft` | `published`), notes. `sector_packs` pointe sur la version publiée.

**Serveur.** Créer, dupliquer, modifier (brouillon), publier ; comparer deux versions ou deux profils (même fonction que la comparaison de versions de configuration) ; format `kalum.config` v4 qui ajoute rôles, valeurs de configuration, écrans, parcours et classement des modules (v1 à v3 toujours acceptés).

**Client.** Page Paramètres › Profils industriels : catalogue, éditeur (les mêmes écrans d'étape que l'assistant, appliqués au profil), comparaison.

**Fin.** Le scénario « créer un profil sans code » passe : un profil créé par l'interface sert à configurer une société de test.

### Lot 15 — Reconfiguration : impact, approbation, retour arrière (M)

**Serveur.**
- L'assistant s'ouvre en mode `evolution` sur une seule étape ; le jeu de changements est le même objet qu'au lot 13.
- Registre d'analyseurs d'impact par type de changement (module, activité, spécialité, règle, vocabulaire, établissement, version de profil) — généralisation de `module-impact.ts`. Chaque analyseur rend données conservées, écrans masqués, utilisateurs touchés, points bloquants.
- Changements sensibles (retrait de module, changement de secteur principal, règle de séparation des tâches) : nouveau type de pièce `config_change` dans le moteur d'approbation existant (mig 350). Droit distinct `settings.approve_config`.
- Mise à niveau vers une nouvelle version de profil : même circuit, avec la comparaison du lot 14.

**Client.** Six entrées sur la vue d'ensemble (planche 2 de la maquette) et page d'analyse d'impact (planche 4).

**Tests.** Retrait d'un module avec pièces ouvertes refusé ; retrait puis réactivation : les données réapparaissent.

### Lot 16 — Recommandations (P)

- Règles déterministes déclarées (`server/src/services/wizard/recommendations.ts`, à créer) : condition sur les réponses, proposition, explication, action. Elles alimentent les encadrés de l'assistant et le bilan de santé.
- L'assistant par description libre existant (`config-assistant.ts`) est proposé à l'étape « Secteur ». Sa sortie passe déjà par les validateurs ; il reste à rendre le modèle paramétrable (aujourd'hui en dur) et à masquer le bouton sans clé d'API.
- Les contrôles bloquants ne dépendent jamais de l'IA.

### Lot 17 — Scénarios, mesures, documentation (M)

Rejouer les 7 scénarios du § 6 de bout en bout (tests de base de données + parcours à l'écran), mesurer les critères du § 7, réécrire `docs/GUIDE_CONFIGURATION_INDUSTRIE.md` autour de l'assistant, et faire relire chaque profil par une personne du métier avant de le passer à « disponible ».

---

## 6. Scénarios de validation

| # | Scénario | Ce qu'on vérifie |
|---|---|---|
| 1 | Boulangerie-pâtisserie artisanale, 3 établissements | Configuration identique à celle d'Ofauria aujourd'hui ; 13 rôles proposés |
| 2 | Agroalimentaire industriel | Traçabilité verrouillée, contrôle qualité avant transfert, vocabulaire « formule », « ordre de lot » |
| 3 | Industrie manufacturière à la commande | Numéros de série, « ordre de fabrication », pas de point de vente |
| 4 | Distribution | Aucun module de fabrication ; étapes et termes de production absents du parcours |
| 5 | Services | Ni stock ni production ; projets et temps passés ; parcours plus court |
| 6 | Multisecteur et multisite (boulangerie + restauration, 2 entités) | Union des modules, priorité du secteur principal, dérogation par établissement |
| 7 | Société en service qui ajoute une spécialité puis retire un module | Analyse d'impact, approbation, version, retour arrière, aucune donnée perdue |

Pour chacun : modules, menus, vocabulaire, règles, rôles et accueils conformes au profil ; simulation réussie ; activation en une transaction.

## 7. Critères mesurables

- Écart de configuration d'Ofauria avant et après chaque lot : zéro.
- Nouveau profil créé et utilisé sans modifier le code : démontré par un test.
- Durée d'une configuration en mode rapide : mesurée sur les scénarios 1 et 4 (objectif à fixer après la première mesure).
- Part des 200 termes du dictionnaire encore en dur dans les menus, titres et documents : plafond décroissant, zéro à la fin du lot 7.
- Activation interrompue : aucune écriture partielle.
- Restauration d'une version : toutes les couches remises.
- Comparaison avec SAP Business One, Dynamics 365, Sage X3 et Odoo : grille à établir sur ces mêmes critères, comme les benchmarks Ventes et Achats. Non faite ici.

## 8. Décisions à prendre

| # | Décision | Recommandation |
|---|---|---|
| D1 | Une base par société ou base partagée | Rester à une société par base tant qu'aucun second client n'est signé ; l'assistant et le moteur n'en dépendent pas. |
| D2 | Offrir un choix de méthode de valorisation des stocks | Non dans ce chantier : afficher la méthode actuelle (coût du lot utilisé), ouvrir un chantier séparé si un client l'exige. |
| D3 | Autres pays que le Maroc | Structurer le référentiel par pays (lot 10) sans livrer d'autre pays. |
| D4 | Profils à livrer en premier | Boulangerie, agroalimentaire, industrie, distribution, services : ce sont les scénarios 1 à 5. Les autres restent « à valider ». |
| D5 | Schémas de comptabilisation configurables | Après le chantier de l'audit comptable. |

## 9. Ordre et jalons

| Jalon | Lots | Ce que l'utilisateur voit |
|---|---|---|
| J1 — Parcours | 0, 1, 2 | L'assistant existe, s'enregistre et se reprend ; la chaîne d'héritage est visible |
| J2 — Métier | 3, 4, 5, 6 | Entreprise, secteurs, spécialités, modules et modèle opérationnel configurables de bout en bout |
| J3 — Activation | 13, puis 7, 8 | Révision, simulation, activation en une fois ; vocabulaire et règles |
| J4 — Mise en service | 11, 12, 10 | Rôles, données de départ, comptabilité |
| J5 — Cycle de vie | 14, 15, 9, 16 | Profils versionnés, reconfiguration avec impact, accueils par rôle, recommandations |
| J6 — Preuve | 17 | Sept scénarios rejoués, guide à jour |

Le lot 13 passe avant les lots 7 à 12 : une fois l'activation en place, chaque étape ajoutée est immédiatement utilisable et testable de bout en bout. Les trois lots les plus risqués sont le 2 (changement de source de tous les paramètres), le 7 (volume) et le 13 (transaction unique).
