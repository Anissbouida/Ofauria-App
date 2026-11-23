# Production multi-industries — plan d'exécution détaillé

Date : 2026-11-22. Ce document dit **quoi faire, dans quel ordre et selon quelles règles**. Le pourquoi est dans le rapport d'analyse `PLAN_PRODUCTION_MULTI_INDUSTRIES_2026-11.md` (constats, écarts E1 à E11, verrous V1 à V6). Les écrans cibles sont sur le canevas de maquettes : https://claude.ai/artifact/Ts1aYnDbKw1atoUqtPjkrC (planches 0 à 8).

État de départ : commit `e1d0412d`, dernière migration `630`. Rien de ce plan n'est construit.

Les noms de tables, de colonnes et de fichiers **à créer** sont des propositions : ils se confirment au début de chaque étape, après relecture du code concerné. Les noms **existants** cités ont été lus dans le code ou dans la base de développement.

---

## A. Cible en une page

```
Noyau Kalum (articles, stocks, ordres, coûts, droits, traçabilité technique)
   └─ Famille (ex. Agroalimentaire)            hérite du noyau, ajoute ses capacités
        └─ Profil (ex. Boulangerie & Pâtisserie)   hérite de la famille
             └─ Spécialisations cumulables (pâtisserie, viennoiserie, beldi…)
                  └─ Entreprise : écarts, processus, écrans, vocabulaire
```

Cinq briques, toutes dans le serveur actuel (monolithe modulaire) :

| Brique | Rôle | Étapes |
|---|---|---|
| Catalogue de capacités | Ce que le système sait faire, avec dépendances et obligations | 1 |
| Profils à héritage | Qui reçoit quoi par défaut | 2, 3 |
| Configuration versionnée | Brouillon, publication, gel sur l'ordre | 4 |
| Moteur de processus et documents | Le parcours d'un ordre, composé sans code | 5, 6 |
| Écrans pilotés par définitions | Ce que chaque métier et chaque rôle voit | 10, 11 |

Les étapes 2 bis, 7, 8, 9 généralisent les objets métier (fiche technique, qualité, magasin, coûts) pour que les profils non boulangers aient quelque chose à piloter.

---

## B. Directives permanentes

Elles s'appliquent à **chaque** étape. Une étape qui en enfreint une n'est pas terminée.

### B1. Préserver Ofauria

1. Tout nouveau réglage a pour valeur par défaut le comportement actuel de la boulangerie.
2. Avant et après chaque étape : même configuration effective pour Ofauria (modules, capacités, libellés, politiques, types d'ordre), même jeu de référence, même scénario A.
3. Aucune fonction existante n'est retirée pour faire place au nouveau modèle. Une fonction remplacée reste en place un cycle complet, puis se retire dans un lot à part.
4. Économat et Pesage, transferts partiels vers les magasins, invendus, équipes par chef : ces fonctionnements doivent rester exacts à chaque étape.

### B2. Règles de conception

5. **Le code ne compare jamais le code du secteur.** Il lit une capacité, une politique, un attribut du type d'ordre ou une étape du processus. Le test `never-sector-guard.test.ts` reste vert.
6. **Configuration d'abord, mais catalogue fermé** : l'administrateur compose à partir d'éléments écrits et testés en code (gardes, actions, panneaux, colonnes). Il n'écrit jamais de règle libre ni de SQL.
7. **Les droits et l'intégrité sont appliqués côté serveur.** Masquer un champ ou une colonne n'est jamais une protection.
8. **Désactiver un document ou un écran ne désactive pas l'enregistrement** dont dépendent le stock, la traçabilité ou la comptabilité.
9. **Une capacité réglementaire ne se désactive pas** tant qu'un article, un lot ou une juridiction l'exige.
10. **Héritage vivant, pas de copie** : un enfant stocke ses écarts, jamais une copie du parent.
11. Une configuration publiée ne modifie jamais un ordre déjà confirmé.
12. Pas de généralisation spéculative : textile, pharmaceutique et base partagée multi-entreprise ne démarrent que sur un besoin client réel.

### B3. Règles de réalisation dans ce dépôt

13. **Migrations** : additives uniquement ; numéro pris après vérification des migrations déjà sur `main` (prochaine libre : 631) ; appliquées sur la base de dev et sur `kalum_test` ; une migration appliquée à la main s'inscrit dans `_migrations` avec son empreinte SHA-256, jamais MD5. Aucune suppression de table ou de colonne dans le lot qui la remplace.
14. **Quantités** : `DOUBLE PRECISION` côté plans et transferts (choix de la migration 512) ; tout paramètre numérique passé à `GREATEST` ou à une fonction est typé (`$N::numeric`).
15. **SQL dans les dépôts de données** (`repositories/`) : la garde `sql-outside-repositories` ne peut que baisser.
16. **Droits** : `can('…')` par action ; toute route ajoutée régénère `route-rights.snapshot.json`.
17. **Politiques** : toute constante métier de production passe par `parameters-catalog.ts` et `resolvePolicy` ; une écriture hors `setPolicy` appelle `invalidatePolicies()`.
18. **Définition de fini d'un réglage** (règle C-02 existante) : exporté dans le modèle de configuration, valeur boulangerie = comportement actuel, valeur différente dans au moins un profil de référence ou exception justifiée dans `profile-coverage.db.test.ts`.
19. **Interface** : composants de `components/ds`, classes `kl-ds`, statuts par `StatusTag`, boutons `odoo-btn-*`, listes longues en `SearchSelect`, pas de numéro sur les étapes d'un circuit, unité affichée = unité saisie, montants par `money()`.
20. **Vocabulaire** : aucun terme de métier en dur dans un écran partagé ; il passe par `sectorLabel` ou `useProdTerms`.
21. **Tests** : suite unitaire (`npx vitest run --exclude 'src/__tests__/db/**'`), puis suite base en série sur `kalum_test` avec `DATABASE_URL` = base de test. Deux tests échouent entre 18 h et minuit sur ce poste (fuseau) : ce n'est pas une régression.
22. **Git** : un commit par tâche, directement sur `main`, en n'indexant que ses propres fichiers ; pas de PR ; pas de `push` sans accord.
23. **Données** : demander avant de supprimer des données visibles dans l'application ; aucune écriture en production sans validation ; les scripts de diagnostic sont en lecture seule.
24. **Vérification** : un écran modifié se vérifie dans l'application en marche (client 5173, API 3001 depuis `main`), pas seulement à la compilation.

### B4. Fin d'étape : liste de contrôle

- [ ] Suite unitaire et suite base vertes.
- [ ] Jeu de référence : zéro écart sur Ofauria.
- [ ] Scénario A vert.
- [ ] Configuration effective d'Ofauria identique avant et après.
- [ ] Tests `never-sector-guard` et `profile-coverage` verts.
- [ ] Réglages nouveaux exportés dans le modèle de configuration.
- [ ] Écrans vérifiés dans l'application, comparés à la maquette.
- [ ] Tableau de suivi (§ F) mis à jour : livré, testé, reste à faire.

---

## C. Ordre, dépendances et jalons

```
0 → 1 → 2 → 3
        2 → 2 bis ─────────────┐
        2 → 4 → 5 → 6 → 11 → 12
        1 → 7                  │
        4 → 8 → 9              │
        1 → 10a-10d ; 10e-10g après 5
13, 14 : sur décision
```

| Jalon | Étapes | Ce qui devient vrai |
|---|---|---|
| J1 — Kalum hérite | 0, 1, 2, 3 | Profils en familles, capacités avec dépendances, spécialisations, plus aucun métier dans les rôles |
| J2 — La fiche est générique | 2 bis, 7 | Une fiche technique sert la boulangerie et l'agroalimentaire conditionné |
| J3 — Le parcours se compose | 4, 5, 6 | Un type d'ordre a son processus, versionné, figé sur l'ordre |
| J4 — Le magasin et les coûts suivent | 8, 9 | Emplacements génériques, réservation, coût machine |
| J5 — Chaque métier a ses écrans | 10, 11 | Définitions d'écran, poste opérateur, assistant et simulation |
| J6 — Profils démontrés | 12 | Scénarios B, C, D automatisés |

Tailles : S 1-3 jours, M 1-2 semaines, L 3-5 semaines, XL 2 mois et plus, en temps de travail effectif. Ordres de grandeur, pas des engagements.

---

## D. Les étapes

### Étape 0 — Filet de sécurité · S

**But.** Pouvoir prouver, à chaque étape, que rien n'a changé pour Ofauria.

**Tâches.**
1. Ajouter deux commandes `npm` dans `server/` autour de `scripts/reference-snapshot.ts` : capture et comparaison (7 familles existantes, tolérance nulle).
2. Écrire `scripts/effective-config-snapshot.ts` : exporte en JSON trié la configuration effective (secteur, modules, capacités, libellés fusionnés, politiques résolues au niveau société, types d'ordre, ateliers). Sert de comparaison avant/après.
3. Écrire le **scénario A** (`__tests__/db/scenario-a-boulangerie.db.test.ts`) sur une base neuve : fiche avec recette de base → plan → confirmation → bon de sortie → transfert Économat vers Pesage d'un contenant ouvert → pesée → démarrage → déclaration avec rendement → lot produit → transfert partiel en deux fois → invendu → clôture. Vérifier : journal `production_plan_events`, quantités des deux zones, lots consommés, coût réel, lot en vitrine.
4. Réécrire les deux scénarios abandonnés (`scenarios-production`, `scenarios-stock` en `.wip`) sur le même socle.
5. Mesurer sur la **production**, en lecture seule : nombre de lignes des quatre tables de l'ancien modèle de fiche, taux de remplissage des champs boulangerie, valeurs réelles des drapeaux des types d'ordre. Consigner les chiffres au § F.

**Acceptation.** Modifier volontairement une transition, un mode de consommation ou une règle de coût fait échouer le scénario A ou le jeu de référence.

**Préalable hors code.** Les migrations 507 à 630 doivent être en production avant l'étape 2.

---

### Étape 1 — Catalogue de capacités · M

**But.** Passer de 8 options isolées à un catalogue complet, avec dépendances et obligations. Corrige E3.

**Maquette.** Planche 1, onglet « Capacités ».

**Données.**
- Étendre `app_features` : `kind` (`fonction` | `reglementaire`), `requires` (liste de clés), `module_key` ouvert à d'autres modules que `production`, `scope` (société, établissement, article).
- Inscrire les capacités aujourd'hui implicites, toutes **actives** dans le profil boulangerie :

| Capacité | Nature | Dépend de | Aujourd'hui |
|---|---|---|---|
| Lots | Réglementaire (alimentaire) | — | Toujours actif |
| Numéros de série | Fonction | — | `products.tracking_mode` |
| Dates limites DLC / DDM | Réglementaire (alimentaire) | Lots | Politiques `stock.dlc_alerts`… |
| Allergènes et traces | Réglementaire (alimentaire) | — | Toujours actif |
| Traçabilité amont et aval | Fonction | Lots | Toujours actif |
| Rappel de lot | Fonction | Traçabilité | Toujours actif |
| Pesage au bon de sortie | Fonction | Emplacements | Drapeau du type d'ordre |
| Contrôle qualité et libération | Fonction | Lots | Drapeau + politique |
| Quarantaine | Fonction | Lots | Toujours actif |
| Relevés de température | Fonction | — | Options `haccp`, `ccp_cuisson` |
| Rendements, pertes et rebuts | Fonction | — | Réglage société |
| Semi-finis | Fonction | — | Toujours actif |
| Co-produits et sous-produits | Fonction | — | Table présente, inutilisée |
| Sous-traitance | Fonction | — | Drapeau du type d'ordre |
| Réservation de matière | Fonction | — | Absente (étape 8) |
| Conditionnement multi-niveaux | Fonction | — | Absente (étape 2 bis) |
| Étiquetage | Fonction | Allergènes | Amorcé (étape 2 bis) |

- Les 8 options existantes (`dlc_jour`, `vitrine`, `contenants_cru_cuit`, `ccp_cuisson`, `haccp`, `lot_thermal`, `fiche_masterclass`, `mode_fournee`) gardent leur clé.

**Serveur.**
- `sector.repository` : calcul des dépendances entre capacités sur le modèle de `MODULE_DEPENDENCIES` ; refus d'une configuration incohérente ; l'import complète les dépendances manquantes.
- Refus de désactiver une capacité réglementaire utilisée : compteur d'usage dans le registre de `module-impact.ts` (articles alimentaires, lots actifs).
- **Rendre effectifs `requires_weighing` et `requires_quality_check`** : garde au démarrage (toutes les lignes pesées) et garde au transfert ou à la clôture (inspection passée). Activation par une politique `production.enforce_declared_steps`, **désactivée par défaut** pour les sociétés existantes, activée dans les profils livrés à partir de cette étape. Raison : ces drapeaux n'ont jamais été appliqués ; les activer d'office changerait le comportement d'Ofauria.
- Brancher les gardes de capacité une à une, en commençant par celles qui ne changent rien quand elles sont actives.

**Client.** L'onglet « Modules et options » devient « Capacités » : colonne Origine, colonne Dépend de, nature, verrou sur les réglementaires, filtres Toutes / Héritées / Propres / Écarts.

**Tests.** Dépendances en cascade ; refus de désactivation d'une réglementaire utilisée ; `profile-coverage` étendu aux capacités.

**Acceptation.** Désactiver « Lots » pour une société qui a des articles alimentaires est refusé avec un message qui dit pourquoi. Activer « Rappel » active « Traçabilité » et « Lots ».

**Risque.** Faible : le catalogue est déclaratif avant d'être contraignant. Retour arrière : restauration de la version de configuration.

---

### Étape 2 — Héritage vivant, familles et spécialisations · M

**But.** Remplacer la copie par un héritage résolu à la lecture ; créer la famille Agroalimentaire ; rendre les spécialisations activables. Corrige E2.

**Maquettes.** Planche 0 (choix du profil par famille), planche 1 (chaîne d'héritage, spécialisations).

**Données.**
- `sector_packs` : un profil enfant stocke ses **écarts** (`add_modules`, `remove_modules`, `add_features`, `remove_features`) ; `base_sector` devient le parent réel ; les profils racines gardent leurs listes complètes.
- Nouveaux profils : `agroalimentaire` (famille), `agro_conditionne` (enfant). `boulangerie` devient enfant d'`agroalimentaire`, ses écarts calculés pour que le résultat soit **strictement identique** à aujourd'hui.
- `process`, `discret`, `atelier` : convertis en écarts par rapport à `fabrication` ; vérifier l'égalité avant d'écrire.
- Spécialisations : table `sector_specializations` (code, profil, libellé, contenu : ateliers, catégories de fiches, types d'étape, libellés, capacités) et table des spécialisations activées par la société. Sept livrées : boulangerie, pâtisserie, viennoiserie, biscuiterie, traiteur et salé, beldi et spécialités, chocolaterie et confiserie.
- Ofauria : les spécialisations correspondant à ses quatre ateliers existants (mig 511) sont marquées actives **sans rien créer**.

**Serveur.**
- Une fonction de résolution unique, récursive, bornée en profondeur et protégée contre les cycles, pour : modules, capacités, libellés (`sectorLabels` aujourd'hui à un niveau), couche `profile` (types d'ordre fusionnés par code, politiques par clé, l'enfant l'emporte), données de départ.
- Activation d'une spécialisation : n'ajoute que ce qui manque, n'écrase rien (règle de `applyLayers`).
- Modèle de configuration `kalum.config` version 3 : parent + écarts + spécialisations. Les versions 1 et 2 restent acceptées.

**Client.** Onglet Secteur regroupé par famille, état de chaque profil (actuel, à valider, sur demande), panneau « ce que le profil apporte » et « aperçu d'impact ». Bloc Spécialisations en pastilles à choix multiple.

**Tests.** Égalité de la configuration effective d'Ofauria ; ajout d'une capacité au parent visible chez l'enfant ; retrait chez l'enfant respecté ; cycle refusé ; import v1, v2, v3.

**Acceptation.** Les critères 3, 11 et 12 du prompt passent. Aucun libellé, module ou capacité d'Ofauria n'a bougé.

**Risque.** Moyen : la résolution est lue à chaque requête (cache de 30 s existant à conserver et à invalider). Retour arrière : les listes complètes restent stockées sur les profils convertis pendant un cycle.

---

### Étape 2 bis — Fiche technique générique · L

**But.** Lever les verrous V1 à V6 ; une même fiche pour la boulangerie et l'agroalimentaire conditionné. Corrige E11.

**Maquettes.** Planches 3 et 4, à lire côte à côte.

**Six pas, chacun livrable seul.**

| Pas | Contenu | Acceptation |
|---|---|---|
| 2b-1 Dette | Si les quatre tables de l'ancien modèle sont vides en production (mesure de l'étape 0) : les retirer des vues de coût et d'allergènes, puis les archiver. `bom_versions` seul historique ; `recipe_versions` en lecture seule. Retirer les vues de première génération sans appelant. | Jeu `recipe-costs` à zéro écart ; allergènes identiques fiche par fiche |
| 2b-2 Format sans contenant | `recipe_formats.contenant_id` facultatif ; le format porte quantité, unité, article. Le contenant de boulanger devient une facette sous la capacité `contenants_cru_cuit`. `type_production` et `unite_lancement` en référentiel. | Un format sans contenant se crée, se chiffre et se fabrique ; les formats existants sont inchangés |
| 2b-3 Emballage en composant | Rôle obligatoire sur les lignes de nomenclature : matière, semi-fini, emballage. L'emballage pointe vers les consommables en stock, réservé et consommé. `cout_emballage_unitaire` reste le repli. | Coût identique pour Ofauria ; une fiche avec lignes d'emballage décrémente le stock |
| 2b-4 Quantité de référence | Mode de la fiche : fournée (défaut boulangerie), lot standard, pourcentage ramené à une taille de lot. Unités de rendement lues dans le référentiel au lieu d'un CHECK. | Une formule en pourcentage pour 500 kg donne les mêmes besoins que la même fiche en quantités |
| 2b-5 Date limite | Plafond de 365 jours levé ; nature DLC ou DDM sur l'article, reprise sur le lot ; `sale_type` et `sale_unit` en référentiel. | Un article à 730 jours en DDM se crée ; comportement à la vente d'un lot dépassé en DDM selon la décision n° 8 |
| 2b-6 Étiquetage | Valeurs nutritionnelles pour 100 g sur la matière ; calcul sur la fiche ; liste d'ingrédients par ordre pondéral décroissant, allergènes mis en évidence ; contrôle de complétude avant impression. | L'étiquette d'un produit à deux semi-finis liste les matières des deux niveaux dans le bon ordre |

**Client.** `NomenclatureEditor` (1 334 lignes) découpé en panneaux par facette : composition, formats, contenant de cuisson, cru/cuit, pâte, date limite, allergènes, conditionnement, étiquette. Premier cas d'usage du registre de panneaux de l'étape 10.

**Directives propres.**
- Aucune fiche existante n'est réécrite ; la fournée reste sa quantité de référence.
- Les règles d'étiquetage dépendent du pays : elles vont dans le pack pays et sont validées par une personne compétente avant tout usage réel.
- Rien n'est archivé avant un cycle d'observation en production.

**Risque.** Moyen : 2b-1 et 2b-3 touchent le coût de revient. Garde : jeu de référence.

---

### Étape 3 — Sortir les métiers des rôles · M

**But.** Qu'aucun rôle système ne porte un métier. Finit E2.

**Tâches.**
1. Retirer le CHECK de `roles.base_role` ; ajouter des archétypes neutres (opérateur de production, responsable de production). Les rôles `baker`, `pastry_chef`, `viennoiserie`, `beldi_sale` restent pour Ofauria, comme rôles ordinaires.
2. Remplacer les derniers usages de `ROLE_GROUPS` côté client (`ProductionLayout.tsx:23`, `OuvertureTab`, `JourneeBoutiquePage`) par des droits par action ; supprimer les constantes déclarées et non utilisées côté serveur.
3. `ROLE_CATEGORY_SLUGS` et `getCategoryRole` → lecture de l'atelier par catégorie (table existante de la migration 511).
4. `chefRoles` en dur dans les notifications → membres de l'atelier.
5. Suffixes BOUL / PAT / VIEN / BELD → code court de l'atelier.
6. Couleurs par rôle dans `ProductionPage` → couleur de l'atelier.

**Tests.** `route-rights.snapshot.json` inchangé pour les rôles d'Ofauria ; notifications reçues par les mêmes personnes.

**Acceptation.** Une société sans aucun des quatre rôles boulangers lance et clôture un ordre.

**Risque.** Moyen (droits). Retour arrière par commit.

---

### Étape 4 — Configuration versionnée complète et gel sur l'ordre · M

**But.** Qu'une version couvre toute la configuration, et qu'un ordre garde celle avec laquelle il a été confirmé. Corrige E6.

**Maquettes.** Bandeaux « brouillon / en vigueur » des planches 1, 2 et 3.

**Données.**
- `config_versions` : états brouillon et publié, date de publication, version précédente. L'instantané s'étend aux dix couches : vocabulaire, ateliers, types d'ordre, impressions et variantes, postes et gammes, unités, emplacements, plans de contrôle, spécialisations, modèles de processus.
- Brouillon tenu côté serveur (aujourd'hui côté client), un par société.
- `production_plans` : référence de la version et instantané des paramètres d'exécution (drapeaux du type d'ordre, politiques résolues, version du processus).

**Serveur.**
- Écriture de l'instantané à la confirmation. Les lectures en direct des drapeaux du type d'ordre (`production.repository`, jointures aux lignes 55, 80, 1171, 1607) lisent l'instantané, avec repli sur la valeur vivante pour les ordres antérieurs.
- `resolvePolicy` accepte un ordre et lit son instantané.
- Reprise : les ordres en cours reçoivent un instantané des valeurs du jour de la migration.
- Comparaison de deux versions ; aperçu d'impact étendu aux couches production (ordres ouverts par type, fiches concernées).

**Tests.** Scénario E : ordre confirmé, changement du mode de consommation puis d'une politique, publication ; l'ordre se termine avec ses anciens réglages ; un nouvel ordre prend les nouveaux. Restauration d'une version complète.

**Acceptation.** Critères 16 et 17 du prompt.

**Risque.** Moyen : toute lecture oubliée crée une incohérence. Garde : recherche systématique des jointures sur le type d'ordre, plus un test qui change un réglage en cours d'ordre.

---

### Étape 5 — Moteur de processus · XL

**But.** Qu'un type d'ordre porte son parcours, composé sans code. Corrige E1.

**Maquette.** Planche 2.

**Principe.** Un modèle de processus = liste d'étapes versionnée. Chaque étape a des prédécesseurs (d'où le parallélisme), des gardes de début et de fin, des actions, un document, un responsable. Gardes et actions viennent de deux **catalogues fermés écrits en code**. Chaque étape se rattache à un état technique existant ; la machine à états SQL de la migration 299 reste le filet de sécurité.

**Données.** Modèles (par type d'ordre, versionnés), étapes, liens entre étapes avec condition, gardes par étape, actions par étape, état des étapes par ordre, journal du mode ombre.

**Catalogues de départ**, extraits du code actuel :

| Gardes | Actions |
|---|---|
| Bon de sortie clôturé | Générer le bon de sortie |
| Toutes les lignes pesées, écarts dans la tolérance | Transférer Économat vers Pesage |
| Lots non périmés | Consommer au bon de sortie, à la déclaration, ou en saisie |
| Étapes bloquantes terminées | Créer le lot produit, le lot vitrine |
| Relevé de point critique présent | Générer l'inspection finale |
| Inspection passée, lot libéré | Calculer coût réel et rendement |
| Composants réservés | Notifier, émettre un événement |

**Cinq pas.**

| Pas | Contenu | Sortie |
|---|---|---|
| 5a | Extraire gardes et actions en catalogues nommés, sans changer le comportement | Scénario A vert, aucun écart |
| 5b | Tables + génération en données du modèle « boulangerie standard » reproduisant exactement les transitions actuelles | Le modèle se lit dans l'écran, en lecture seule |
| 5c | Mode ombre par type d'ordre (politique : éteint, ombre, actif) : le moteur calcule la décision à côté de la machine à états et journalise tout écart | Zéro écart sur le scénario A et sur une période d'exploitation réelle, puis bascule |
| 5d | Éditeur : liste ordonnée d'étapes (nom, responsable, délai, gardes, actions, champs obligatoires, document, reprise), brouillon et publication par l'étape 4 | Un second processus se compose sans code |
| 5e | Branches parallèles, embranchements conditionnels, reprise et annulation par étape | Parcours « commande spéciale » avec garniture en parallèle |

**Acceptation.** Le parcours mécanique du prompt (commande, ordre, réservation, usinage, assemblage, contrôle, entrée en stock) se configure et s'exécute de bout en bout ; le parcours boulangerie donne les mêmes mouvements qu'avant.

**Directives propres.**
- Aucune action ne s'écrit en configuration : une action manquante s'ajoute au catalogue, avec son test.
- Le moteur ne contourne jamais la machine à états SQL.
- La machine à états actuelle ne se retire pas dans cette étape.

**Risque.** Élevé. Retour arrière : repasser la politique du type d'ordre sur « éteint ».

---

### Étape 6 — Documents pilotables · M

**But.** Qu'un document soit activable, obligatoire ou non, rattaché à une étape, soumis ou non à approbation. Corrige E7.

**Données.** Registre des documents de production : activé, obligatoire, génération automatique ou manuelle, étape de rattachement, règle d'approbation, série de numéros, gabarit. Documents inscrits : ordre de fabrication, bon de sortie, fiche de pesage, fiche de suivi, fiche de contrôle, bon de transfert, bon d'entrée en stock, rapport de production, rapport de rendement, rapport de pertes, fiche de non-conformité, bon d'envoi en sous-traitance.

**Serveur.** Étendre les types de pièce du moteur d'approbation (déjà générique, limité à `bom_change`) à : ordre de fabrication, démarrage, clôture, libération de lot, non-conformité. Série de numéros pour la non-conformité.

**Règle testée.** Désactiver « Fiche de pesage » ou « Rapport de rendement » n'empêche ni la pesée ni la déclaration : seul le document disparaît.

**Acceptation.** Critère 6 du prompt.

---

### Étape 7 — Qualité · S

- Points de contrôle « avant transfert » et « avant livraison » dans `quality_control_plan_lines` (aujourd'hui réception, en cours, final), reliés aux gardes de l'étape 5.
- Plans de contrôle rattachables à une famille d'articles, donc exportables dans un profil.
- Règle du point critique paramétrable (aujourd'hui « au moins un relevé », en dur).

---

### Étape 8 — Magasin générique · L

**But.** Sortir Économat, Pesage, Magasin, Frigo et Vitrine du code. Corrige E5. **Étape la plus risquée du plan.**

**Tâches, dans cet ordre.**
1. Typer les emplacements : réserve, en-cours ouvert, atelier, froid positif, froid négatif, vente, quarantaine.
2. Inverser la source de vérité : `ingredient_lot_locations` devient la table écrite ; `economat_quantity` et `pesage_quantity` deviennent des valeurs dérivées, maintenues un cycle (environ 140 références à reprendre, surtout `bon-sortie.repository` et `ingredient-lot.repository`).
3. Remplacer les littéraux `'PESAGE'`, `'ECONOMAT_REQUIRES_TRANSFER'`, `'MAGASIN'`, `'FRIGO'` par l'emplacement du type attendu.
4. Vitrine et réserve du produit fini : emplacements de type « vente » et « réserve ».
5. Réservation de matière par ordre (capacité de l'étape 1) ; idempotence sur les routes de production.

**Préservation.** Le profil boulangerie livre deux emplacements, Économat (réserve) et Pesage (en-cours ouvert), et les mêmes règles : réception en Économat, transfert d'un contenant ouvert vers le Pesage, consommation jusqu'à épuisement.

**Acceptation.** Jeu de référence `stock-lots` à zéro écart avant et après chaque tâche ; scénario A vert ; un profil sans Pesage consomme directement depuis la réserve.

**Directives propres.** Jamais de mise à jour directe d'`ingredient_lots` hors du dépôt de données (un déclencheur recalcule l'inventaire) ; une tâche à la fois, jamais deux inversions dans le même commit.

---

### Étape 9 — Coûts et comptabilité · M

- Coût machine réel : taux du poste × temps réel (aujourd'hui le taux ne sert qu'au coût standard).
- Composantes de coût en catalogue, activables par profil : matière, emballage, main-d'œuvre, machine, énergie, sous-traitance, pertes, charges.
- Écritures de production en option, pour l'inventaire permanent. **Décision comptable préalable** ; l'inventaire intermittent reste le défaut et le comportement d'Ofauria.

---

### Étape 10 — Interfaces adaptatives · XL

**But.** Des écrans qui changent vraiment selon le métier, la société et le rôle. Corrige E4.

**Maquettes.** Planches 3, 4, 5 (écrans par métier), 6 (poste opérateur), 7 (configurateur).

**Principe.** Deux niveaux. Les **définitions d'écran** (colonnes, filtres, sections, ordre, visibilité par rôle) sont des données, résolues profil → société → rôle. Les **panneaux métier** sont des composants écrits à la main et enregistrés par capacité : un panneau dont la capacité est éteinte n'est pas chargé.

| Pas | Contenu | Acceptation |
|---|---|---|
| 10a | Composants `DataTable` et `FormLayout` dans le design system, pilotés par une définition | La liste des plans s'affiche par définition, à l'identique |
| 10b | Définitions d'écran en base ; listes Plans et Fiches ; fiche d'ordre : les règles de `planPanelRules.ts` passent en données, ordre configurable | Réordonner deux sections sans code |
| 10c | Découpage par capacité : rendement générique + panneau bilan massique ; fenêtre de lancement (2 481 lignes) en étapes enregistrées (température de base, coupe, séries) | Profil sans `mode_fournee` : aucun champ de pâte chargé |
| 10d | Vocabulaire complet : « ingrédient » (374 occurrences), « fournée », unités de coût, textes de notification et titres de documents | Bilan de santé : aucun terme boulanger hors boulangerie |
| 10e | Tableaux de bord par profil et par rôle, à partir du générateur de rapports ; consommation de `report_keys` | Un chef d'atelier et un gérant n'ont pas le même tableau de bord |
| 10f | Poste opérateur tactile plein écran, piloté par l'étape de processus en cours | Pesée validée au doigt sur tablette |
| 10g | Configurateur : colonnes, filtres, sections, champs personnalisés placés dans une section, vues par rôle, aperçu, publication | Critères 8, 9, 10 du prompt |

**Directives propres.**
- Pas de générateur d'écrans universel : ce qui est métier reste un composant.
- Le configurateur ne propose que des éléments du catalogue de l'écran ; certains sont verrouillés (numéro, statut).
- 10a à 10d peuvent commencer dès la fin de l'étape 1 ; 10e à 10g attendent l'étape 5.

---

### Étape 11 — Assistant de configuration et simulation · M

**Maquette.** Planche 8.

- Parcours en huit étapes : secteur, spécialisations, modes de production (types d'ordre), capacités, processus, écrans, simulation, publication. Chaque étape réutilise l'écran de paramétrage correspondant.
- Simulation : dérouler un ordre fictif dans une transaction annulée (technique du point de sauvegarde, déjà utilisée par la migration 593), rapport étape par étape : ce que le système a fait, mouvement de stock, résultat.
- Scénarios de simulation livrés avec chaque profil.
- La publication est bloquée tant qu'un point bloquant subsiste.

**Acceptation.** Critère 1 du prompt : une société neuve est configurée de bout en bout sans toucher au code.

---

### Étape 12 — Profils de référence et scénarios B, C, D · L

| Profil | Scénario automatisé | Dépend de |
|---|---|---|
| Agroalimentaire conditionné | B : lot, DDM, contrôle, non-conformité, rappel, rendement | 2 bis, 7 |
| Mécanique et assemblage | C : nomenclature multiniveaux, réservation, opérations, séries, coût | 5, 8, 9 |
| Cosmétique et chimie | Formule, pesée, mélange, lot, libération | 2 bis |
| Menuiserie et meubles | Affaire, débit, sur-mesure | 5 |
| Textile et confection | D : modèles, tailles, couleurs, coupe, façon | 13 |

Chaque profil : un test de base, un jeu de données de démonstration, une relecture par une personne du métier avant d'être proposé à un client. Pharmaceutique : hors périmètre tant qu'un client ne l'impose pas.

---

### Étape 13 — Variantes d'article · L, sur demande

Attributs et variantes (taille, couleur, modèle, collection), matrice de saisie à la commande et à l'ordre. Ne démarre que pour un client textile.

### Étape 14 — Isolation entre entreprises · sur décision

- Une base par client : isolation acquise, aucun travail. Recommandé au départ.
- Base partagée : colonne d'entreprise et sécurité par ligne (équivalent d'une VPD Oracle) sur toutes les tables, dont les quinze tables de configuration qui n'en ont pas. Chantier de plusieurs mois, cadré dans le plan de 2026-09.

---

## E. Décisions attendues

| # | Décision | Bloque |
|---|---|---|
| 1 | Isolation : une base par client ou base partagée | 14 |
| 2 | Comptabilité de production : inventaire intermittent par défaut | 9 |
| 3 | Éditeur de processus : liste ordonnée d'étapes, ou canevas graphique | 5d |
| 4 | Premier client hors boulangerie : son secteur | Ordre de 12 et 13 |
| 5 | Liste des spécialisations | 2 |
| 6 | Règles d'étiquetage et personne qui les valide | 2b-6 |
| 7 | Accord pour archiver les tables de l'ancien modèle de fiche si vides en production | 2b-1 |
| 8 | Lot dépassé en DDM : signalé sans blocage, ou bloqué comme en DLC | 2b-5 |
| 9 | Onglet « Modules et options » renommé « Capacités » | 1 |
| 10 | Appliquer ou non pesée et contrôle obligatoires aux types d'ordre d'Ofauria | 1 |

## F. Suivi

À tenir à jour à chaque fin d'étape : ce qui est livré, ce qui est testé, ce qui reste, écarts assumés.

| Étape | État | Commit | Migrations | Reste |
|---|---|---|---|---|
| 0 | Livré | d9bc5d4f | 631 | Mesure en production à passer (`diagnose-multi-industries.sql`) |
| 1 | Livré | voir § F.1 | 632 | Gardes de capacité branchées sur 6 familles de routes ; les autres capacités du socle restent déclaratives jusqu'à leur étape (8, 2 bis) |
| 2 | Livré | voir § F.2 | 633 | Relecture métier des profils « À valider » ; liste des spécialisations à confirmer (décision n° 5) |
| 2 bis | Livré en partie | voir § F.2 bis | 634, 635, 636 | 2b-1 (dette) en attente de la mesure en production et de la décision n° 7 ; saisie écran des lignes d'emballage, des pourcentages et de la nutrition des matières renvoyée au pas 10c (API prêtes) |
| 3 | Livré | voir § F.3 | 637 | Retirer ROLE_CATEGORY_SLUGS et getCategoryRole (obsolètes, encore lus par 3 anciens tests) ; OuvertureTab et JourneeBoutiquePage gardent les groupes caisse et direction (non métier) |
| 4 | Livré | voir § F.4 | 638 | Brouillon tenu côté serveur et écran de comparaison des versions (API prête) ; restauration limitée au vocabulaire et aux spécialisations pour les nouvelles couches |
| 5 | Livré | voir § F.5 | 639 | Bascule en actif type d'ordre par type d'ordre après une période d'ombre réelle ; actions du catalogue encore exécutées par le code existant (le moteur décide des passages, pas des effets) ; avancement à afficher sur la fiche de l'ordre (API prête, pas 10) |
| 6 | Livré | voir § F.6 | 640 | Écran des approbations : les cinq nouveaux types apparaissent dans Paramètres › Approbations (catalogue partagé) ; gabarits des documents sans impression (fiche de pesage, rapports) à dessiner au pas 10 |
| 7 | Livré | voir § F.7 | 641 | Écran de saisie de la règle CCP : dans Paramètres › Production (catalogue des politiques) ; écran des contrôles « avant livraison » : liste qualité existante |
| 8 | Livré | voir § F.8 | 642, 643, 644 | Les ~140 lectures des zones (economat_quantity, pesage_quantity) restent un cycle : à basculer vers les emplacements puis retirer les colonnes ; écran de rangement d'un lot dans un emplacement quelconque (fonctions prêtes) |
| 9 | Livré | voir § F.9 | 645 | Décision comptable n° (inventaire permanent) à prendre avec l'expert-comptable avant d'activer les écritures ; comptes CGNC figés (3151/7132, 6124/3121) tant qu'un écran de comptes de production n'est pas demandé |
| 10 | À faire | | | |
| 11 | À faire | | | |
| 12 | À faire | | | |

### F.0 — Étape 0 (2026-11-23)

Livré :
- `npm run ref:capture|ref:compare` (jeu de référence, 7 familles) et `npm run config:snapshot|config:compare` (`scripts/effective-config-snapshot.ts` : secteur, modules, options, libellés fusionnés, politiques, types d'ordre, ateliers, et capacités dès l'étape 1).
- Scénario A : `__tests__/db/scenario-a-boulangerie.db.test.ts` (Économat → Pesage, plan, bon de sortie pesé, déclaration, coût réel, transfert avec manquant, journal exact des transitions).
- Scénarios `scenarios-production` et `scenarios-stock` réécrits (fichiers `.wip` retirés) : 43 tests.
- `scripts/diagnose-multi-industries.sql` (lecture seule) pour la mesure en production.

Défauts trouvés et corrigés :
1. Aide de test : e-mail du jeu de données identique pour tous les blocs d'un fichier (collision dès le deuxième bloc).
2. **Relance d'un plan confirmé** (`productionRepository.relaunch`) : échouait toujours quand le bon de sortie n'était pas encore prélevé, car elle rappelait `confirm()`, qui n'accepte plus qu'un brouillon (verrou mig 338). Le plan repasse désormais en brouillon avant la reconfirmation.
3. **Lot de produit fini périmé noté « épuisé »** (mig 631) : le déclencheur `fn_product_lot_invariant` réécrivait le statut `expired` posé par la péremption automatique.

Écart assumé : le scénario « semi-finis » a été réécrit selon la règle actuelle (modèle B, F-044 : la pâte devient un plan fils qui consomme la matière ; le parent ne la porte plus), qui avait changé depuis son écriture.

Mesures sur la base de dev (simulation) : tables de l'ancien modèle de fiche toutes vides ; 26 fiches sur 27 en mode composé ; aucun poids cru/cuit, aucune pièce par fournée ; rôle vide sur les 133 lignes de nomenclature par format ; un seul type d'ordre (`PLAN_JOUR`, pesée déclarée obligatoire, contrôle non) avec 2 439 ordres.

Constat hors chantier : la base de dev a été basculée sur le secteur « fabrication » le 2026-11-23 à 02:02 UTC depuis l'écran (version de configuration n° 4), avant le début de ce travail. Non modifié.

Tests : suite base 239 fichiers / 892 tests verts ; suite unitaire verte ; compilation serveur propre.

### F.1 — Étape 1 (2026-11-23)

Livré :
- Mig 632 : `app_features` gagne `kind` (fonction / réglementaire), `requires`, `default_on` ; 17 capacités inscrites (lots, séries, DLC/DDM, allergènes, traçabilité, rappel, pesage, contrôle qualité, quarantaine, relevés de procédé, rendements et pertes, semi-finis, co-produits, sous-traitance, étiquetage actives par défaut ; réservation de matière et conditionnement éteintes, pas encore construites) ; dépendances posées sur les options existantes.
- `shared/src/constants/capabilities.ts` : fermeture des dépendances, dépendants, dépendances manquantes (communs serveur / écran).
- `sector.repository` : socle actif par défaut, capacité effective seulement si son module et ses dépendances le sont, activation qui emporte ses dépendances, refus d'une désactivation qui en éteindrait d'autres en silence, refus de désactiver une capacité réglementaire utilisée (`services/capabilities.ts`, registre figé de comptages).
- Garde d'API étendue : traçabilité, contrôle qualité, sous-traitance, numéros de série (en plus de HACCP et congélation).
- Politique `production.enforce_declared_steps` (défaut : éteinte ; activée dans les profils process, discret, atelier) : « pesée obligatoire » vérifiée au démarrage, « contrôle obligatoire » au transfert.
- Import d'un modèle : les capacités emportent leurs dépendances. Aperçu d'impact : données masquées comptées pour 5 capacités.
- Écran : onglet « Modules et capacités », nature (Réglementaire), origine (Préréglage, Socle commun, Ajusté), « Dépend de », cascade dans le brouillon. Vérifié dans l'application (compte gérant de test, base de test) : cascade de 10 capacités en désactivant « Gestion des lots », refus serveur affiché avec 1 043 lots de matière et 115 lots de produit fini.

Décisions appliquées (recommandation du plan, § E) : n° 9 — l'onglet s'appelle « Modules et capacités » (les modules y restent) ; n° 10 — pesée et contrôle obligatoires désactivés par défaut pour les sociétés existantes.

Écart assumé : la configuration effective change par l'AJOUT des capacités du socle à la liste des options effectives (constaté sur la base de dev : 15 clés ajoutées, aucune retirée). Les 8 options historiques ne bougent pas. Deux assertions de `module-activation.db.test.ts` qui figeaient « aucune option active » ont été précisées en « aucune option hors du socle ».

Défaut évité en chemin : la nouvelle règle refusait d'activer une option dont le module est éteint (régression signalée par le test d'activation) ; corrigé, l'écart est gardé et prend effet au rallumage du module, comme avant.

Tests : `capabilities.db.test.ts` (8) ; suite base 240 fichiers / 900 tests verts ; suite unitaire verte ; compilation serveur et client propre.

### F.2 — Étape 2 (2026-11-23)

Livré :
- Mig 633 : `sector_packs.inherits` + écarts (`add_/remove_modules`, `add_/remove_features`), `family`, `status`, `description`, `sort_order` ; famille racine `agroalimentaire` (socle de fabrication + Contrôle & Qualité, HACCP, congélation) et profil `agro_conditionne` (couches production reprises du profil process) ; `boulangerie` devient enfant d'`agroalimentaire` ; `process`, `discret`, `atelier` convertis en écarts. La migration vérifie elle-même que chaque profil converti redonne exactement ses anciennes listes. `process` relibellé « cosmétique, chimie ».
- Résolution récursive unique (`sector.repository`) pour modules, options, libellés (toute la chaîne) et couche `profile` (`resolvedProfile` : l'enfant l'emporte par code, clé, document, nom) ; données de départ prises chez le plus proche parent qui en a.
- Spécialisations : `sector_specializations`, `company_specializations`, `specialization.repository` (activer = atelier, types d'étape et capacités manquants seulement ; désactiver = rien n'est supprimé), routes `GET /settings/specializations`, `PUT /settings/specializations/:code`. Sept spécialisations livrées ; pour Ofauria, les cinq qui correspondent à ses ateliers sont actives sans rien créer.
- Modèle `kalum.config` v3 : spécialisations exportées et réimportées ; un secteur enregistré HÉRITE de son secteur de base (écarts seulement) ; v1 et v2 acceptés.
- Écran Secteur : profils groupés par famille avec état (Actuel, À valider, Personnalisé), chaîne « Hérite de », bloc Spécialisations (pastilles cumulables). Vérifié dans l'application.

Tests : `inheritance.db.test.ts` (6) ; tests des modèles passés en v3 ; instantané des droits régénéré (2 routes ajoutées) ; suite base 241 fichiers / 906 tests verts ; suite unitaire verte ; configuration effective de la base de dev identique avant / après.

Écart assumé : la base de test garde deux comptes de vérification désactivés (`gerant.test`, `admin.test`) : leur suppression est bloquée par des bulletins de paie de test.

### F.2 bis — Étape 2 bis (2026-11-23)

Livré :
- 2b-2 (mig 634) : référentiels `production_types` et `production_launch_units` ; le CHECK 1..5 du type de production devient un contrôle sur le référentiel. Le format sans contenant existait déjà (mig 267).
- 2b-3 (mig 634, 635, 636) : ligne de nomenclature EMBALLAGE (`source_packaging_id`, quantité par unité produite) ; rôle de ligne posé et contrôlé par déclencheur ; coût d'emballage du format recalculé depuis ces lignes (vues de coût inchangées) ; miroir de composition qui ignore l'emballage ; sortie du stock d'emballages à la déclaration de production.
- 2b-4 (mig 634, 635) : `recipes.reference_mode` (fournée, lot, pourcentage) et lot de référence ; `pct` sur les lignes ; en mode pourcentage la quantité est calculée à l'enregistrement (besoins et coûts inchangés) ; unités du format contrôlées par le référentiel des unités.
- 2b-5 (mig 634) : `products.date_kind` (DLC / DDM) recopié sur le lot ; durée de vie jusqu'à 3 650 jours ; cycle « sur stock » et unité « carton » ; `sale_type` et `sale_unit` contrôlés par référentiel. Décision n° 8 appliquée (recommandation) : un lot dépassé en DDM reste vendable et n'est pas périmé automatiquement ; la DLC continue de bloquer.
- 2b-6 (mig 634) : `ingredients.nutrition` (pour 100 g) et route `PUT /ingredients/:id/nutrition` ; `products.prepackaged` ; déclaration nutritionnelle calculée sur l'étiquette (moyenne pondérée par le poids, concentrée par le rapport cru/cuit quand il est connu), bloquante seulement pour un article préemballé.
- Écran : fiche article (nature de la date, préemballé), tableau nutritionnel sur l'étiquette imprimée.

Défauts trouvés et corrigés : mig 634 lisait une colonne absente de `recipe_components` dans une fonction partagée (mig 636) ; le miroir de composition aurait rejeté toute nomenclature contenant un emballage (mig 635) ; un test du bilan de santé dépendait du volume de la base de test (liste bornée à 200).

Non fait, et pourquoi :
- 2b-1 (retrait de l'ancien modèle des vues, archivage) : la mesure en production n'a pas pu être faite d'ici, la décision n° 7 est attendue, et le plan impose un cycle d'observation. De plus, les aides de test (`createProductWithRecipe`) s'appuient encore sur `recipe_ingredients`.
- Saisie à l'écran des lignes d'emballage, des pourcentages et des valeurs nutritionnelles des matières : les API sont prêtes et testées ; l'éditeur de nomenclature (1 334 lignes) doit d'abord être découpé en panneaux (pas 10c).

Tests : `fiche-generique.db.test.ts` (5) ; suite base 242 fichiers / 911 tests verts ; suite unitaire verte ; compilation serveur et client propre.

### F.3 — Étape 3 (2026-11-23)

Livré :
- Mig 637 : CHECK figé de `roles.base_role` remplacé par « rôle système existant » ; archétypes neutres « Opérateur de production » et « Responsable de production » (rôles proposés, droits par module et par action recopiés de leurs bases) ; `production_workshops.short_code` et `.color` repris à l'identique.
- Suffixe des numéros de demande boutique lu sur l'atelier (identique : BOUL, VIEN, PATI, BELD, SALE sur la base de dev) ; destinataire « fabrication » d'une notification = atelier actif ; trois constantes de groupes de rôles inutilisées retirées des routes.
- Client : entrées de pilotage de la production ouvertes par le droit d'édition du module (plus par la liste des rôles boulangers) ; responsables de fabrication = membres d'un atelier actif ; couleur d'écran portée par l'atelier.

Écart assumé : `ROLE_CATEGORY_SLUGS` et `getCategoryRole` restent dans `shared`, marqués obsolètes ; le code métier ne les lit plus (les ateliers portent la correspondance depuis la mig 511), mais trois anciens tests unitaires les vérifient encore.

Tests : suite base 242 / 911 et suite unitaire vertes ; configuration effective de la base de dev identique hormis les deux champs ajoutés aux ateliers.

### F.4 — Étape 4 (2026-11-23)

Livré :
- Mig 638 : `production_plans.exec_snapshot` et `.config_version_id` ; reprise des ordres ouverts (aucun sur la base de dev) ; `config_versions.status` et `.published_at`.
- À la confirmation, l'ordre fige les drapeaux de son type d'ordre et quatre politiques résolues pour lui (étapes obligatoires, source des étapes, clé de répartition du coût, libération automatique) ainsi que la version de configuration en vigueur. `forPlan`, les deux lectures du mode de consommation, la consommation manuelle, la sous-traitance et la garde des étapes obligatoires lisent l'instantané, avec repli sur la valeur vivante pour un ordre plus ancien.
- Chaque version de configuration capture aussi neuf couches (vocabulaire, spécialisations, types d'ordre, ateliers, impressions, postes, emplacements, unités, plans de contrôle) ; comparaison de deux versions (`GET /settings/modules/versions-compare?a=&b=`) ; la restauration remet aussi le vocabulaire et les spécialisations.

Écarts assumés : le brouillon reste tenu par l'écran (pas encore côté serveur) ; types d'ordre, ateliers et autres couches se rétablissent dans leur propre écran (la restauration en masse contournerait leurs contrôles, dont le refus de modifier un type d'ordre utilisé par des ordres en cours) ; écran de comparaison à faire (API prête).

Défauts trouvés en chemin (dans le code de l'étape) : capture hors transaction, identifiant de version renvoyé en texte, paramètre SQL non typé.

Tests : `config-freeze.db.test.ts` (scénario E, 3) ; suite base 243 / 914 et suite unitaire vertes.

### F.5 — Étape 5 (2026-11-23)

Livré :
- 5a : catalogue fermé `services/process-catalog.ts` (6 gardes reprenant mot pour mot les contrôles existants, 11 actions, 4 conditions, états techniques).
- 5b (mig 639) : `process_models` (versionnés, un seul publié par type d'ordre), `process_stages` (état technique de rattachement, gardes, actions, document, responsable, délai, condition, groupe parallèle, champs obligatoires, reprise), `process_shadow_log` ; un « Parcours standard » publié par type d'ordre existant, qui reproduit le parcours actuel.
- 5c : `services/process-engine.ts` et politique `production.process_engine` (éteint par défaut, ombre, actif ; portée société, établissement, atelier, type d'ordre). Branché au démarrage (étape `fabrication`) et au transfert (étape `transfert`). Les contrôles historiques du démarrage sont regroupés dans `legacyStartChecks` : en éteint et en ombre ils décident seuls, l'ombre journalise chaque désaccord ; en actif les gardes du parcours publié décident. Les gardes « toutes les lignes pesées » et « contrôle conforme » ne s'appliquent que si la politique des étapes obligatoires figée sur l'ordre est active ; un plan de semi-fini n'a pas de garde de bon de sortie (comme aujourd'hui).
- 5d : éditeur `repositories/process-model.repository.ts` (validation : codes, catalogue, états qui ne reculent pas, première étape brouillon, étapes en cours et terminée présentes, groupe parallèle contigu et de même état) ; routes `GET /settings/process-models`, `GET …/shadow-log`, `GET …/history/:orderType`, `PUT …/:orderType/draft`, `POST …/:id/publish`, `DELETE …/:id` ; écran Paramètres › Production › Parcours (politique, liste par type d'ordre, éditeur d'étapes en fenêtre, publication, journal de l'ombre).
- 5e : conditions (étape sautée quand la condition est fausse, gardes ignorées) et groupes parallèles (étapes courantes ensemble) ; `GET /production/:id/progress` (avancement fait / courant / à venir / sauté).

Écarts assumés : le moteur décide des PASSAGES ; les actions (bon de sortie, lot, coût, transfert) restent exécutées par le code existant, le catalogue les décrit. La machine à états SQL (mig 299) reste le filet de sécurité en actif.

Tests : `process-engine.db.test.ts` (6 : parcours standard, éteint, ombre d'accord / en désaccord, actif, refus de l'éditeur, parcours « mécanique » à 7 étapes configuré sans code avec groupe parallèle et contrôle conditionnel) ; instantané des droits régénéré ; suite unitaire verte.

### F.6 — Étape 6 (2026-11-23)

Livré :
- Mig 640 : registre `production_documents` (douze documents : ordre de fabrication, bon de sortie, fiche de pesage, fiche de suivi, fiche de contrôle, bon de transfert, bon d'entrée en stock, rapport de production, de rendement, de pertes, fiche de non-conformité, bon d'envoi en sous-traitance) avec activé, obligatoire (implique activé), génération, étape du parcours, type d'approbation, série, gabarit et « trace de ». Tous actifs, aucun obligatoire : comportement actuel.
- Série de numéros des non-conformités (`NC-AAAA-00001`, déclencheur à la création, reprise des fiches existantes : 97 sur la base de test).
- Approbations étendues : cinq types de pièce (`production_order`, `production_start`, `production_closure`, `lot_release`, `nonconformity`) dans le catalogue partagé, avec leurs champs de condition ; `services/production-approvals.ts` (`gateApproval` : sans règle, rien ne change ; avec règle, la demande est créée et l'action refusée en 409 `APPROVAL_PENDING` tant qu'elle attend) branché sur la confirmation, le démarrage et la clôture d'un ordre, la libération d'un lot et la clôture d'une non-conformité ; gestionnaires d'effet (confirmation, démarrage, libération, clôture de la non-conformité appliqués à l'approbation ; la clôture d'un ordre est acceptée à la tentative suivante, car elle porte les quantités saisies).
- Routes `GET /production/documents`, `PUT /settings/production-documents/:key` ; couches de configuration capturées : documents et parcours publiés.
- Écran : Paramètres › Production › Documents ; la fiche d'ordre ne propose plus un document désactivé (bon de sortie, fiche de suivi, aperçu de l'ordre de fabrication).

Défaut trouvé et corrigé en chemin : requêtes SQL écrites dans un contrôleur et un fichier de routes (garde G3-07) déplacées dans le service.

Tests : `production-documents.db.test.ts` (6, dont la règle « fiche de pesage et rapport de rendement désactivés : pesée et déclaration possibles ») ; instantané des droits régénéré.

### F.7 — Étape 7 (2026-11-23)

Livré :
- Mig 641 : étapes de contrôle « avant transfert » et « avant livraison » (plan de contrôle et inspections, colonnes élargies) ; inspection rattachable à un bon de livraison ; garde `pre_transfer_checks_done` ajoutée à l'étape transfert des parcours standard (elle passe sans ligne déclarée).
- Plan de contrôle : `generateBeforeTransfer` (un contrôle par article, créé hors de la transaction du transfert pour survivre au refus), `generateBeforeDelivery` (une fois par bon), `blockingOpen` (contrôle bloquant à faire ou non conforme). Le transfert et l'expédition d'un bon de livraison sont refusés tant qu'un contrôle bloquant n'est pas soldé ; sans ligne à ces étapes, rien ne change.
- Plans de contrôle par famille : saisie « Porte sur : un article / une famille » à l'écran ; nouvelle couche `control_plans` du profil (export par nom de famille, validation d'un fichier non fiable, application sans doublon et seulement si la famille existe).
- Règle du point critique paramétrable : politique `quality.ccp_rule` (au moins un relevé — défaut, comportement historique ; relevés tous conformes ; dernier relevé conforme ; nombre minimal) résolue par atelier et établissement ; le profil agroalimentaire conditionné livre « tous conformes ».

Écart assumé : la livraison et le transfert gardent leurs contrôles dans les écrans qualité existants (liste des inspections à faire) ; pas d'écran dédié.

Tests : `quality-checkpoints.db.test.ts` (4) ; `profile-coverage` vert (la nouvelle politique est livrée par un profil).

Commit : les étapes 5 (5c à 5e), 6 et 7 partagent un commit, car elles touchent les mêmes fichiers (transfert, catalogue de gardes, routes de paramétrage).

### F.8 — Étape 8 (2026-11-23)

Jeu de référence capturé avant la première tâche (`avant-etape8`) et comparé après chacune : **zéro écart** (5 045 lots, coûts, balance, TVA, paie).

Livré, une tâche par commit :
1. Mig 642 : `stock_locations.role` (réserve, en-cours ouvert, atelier, froid positif, froid négatif, vente, quarantaine, expédition), repris du code historique puis du type ; `role_default` (un par établissement et par rôle) ; `fn_store_location(store, rôle)`. La réception range dans la réserve par défaut ; les destinations produit fini deviennent les rôles « vente » et « froid positif ». Écran Emplacements : rôle, « par défaut ». Couche « emplacements » du profil : rôle exporté.
2. Mig 643 — **inversion** : `ingredient_lot_locations` est la table écrite (`fn_lot_move_role`, `fn_lot_take`, `fn_lot_put`, `fn_lot_clear`), les zones du lot en sont dérivées (`fn_lot_recompute_zones`). Ouverture d'un contenant (trois chemins), retour, perte, consommation au pesage, sortie du bon de sortie, ajustement, extourne et correction de réception passent par ces fonctions. Le reflet de la mig 570 applique des écarts : une part rangée dans un troisième emplacement n'est plus effacée. Commit seul, suite base complète verte (247 / 936).
3. Plus de littéral `'PESAGE'`, `'ECONOMAT'`, `'ECONOMAT_REQUIRES_TRANSFER'`, `'MAGASIN'`, `'FRIGO'` dans le code : constantes `ZONE` / `BSI_SOURCE` (`services/stock-roles.ts`) pour les valeurs enregistrées, rôles pour les emplacements.
4. Profil sans Pesage : capacité « pesage » éteinte → le bon de sortie sert directement la réserve (lot alloué, aucune ouverture), la pesée y puise.
5. Mig 644 : réservation de matière à la confirmation (capacité « reservation_matiere », éteinte par défaut) : stock libre = lots utilisables moins réservations actives, part non couverte signalée, consommée au démarrage, libérée au retour en brouillon ou à l'annulation ; garde `components_reserved` sur les réservations ; bloc « Matière réservée » sur la fiche d'ordre. Idempotence sur les sept routes de mutation de la production (confirmation, démarrage, lancement, déclaration, transfert, clôture, réception d'un transfert) ; le client envoie une clé par intention (réutilisée 15 s pour une même action).

Écarts assumés : les zones restent des colonnes maintenues (lectures existantes, rapports) ; les créations de lot et les anciennes fonctions SQL (`fn_stock_receipt`) écrivent encore les zones, reflétées en écarts.

Tests : `magasin-generique.db.test.ts` (8 : rôles et défaut, réception en réserve, inversion, troisième emplacement, invariant global, sans pesage, réservation) ; `product-lot-locations` adapté (message par rôle).

### F.9 — Étape 9 (2026-11-23)

Livré :
- Mig 645 : `production_cout_reel.cout_machine` et `detail_machine` ; `cout_total` recréé avec la machine (valeurs existantes inchangées : jeu de référence à zéro écart).
- Coût machine réel : taux horaire du poste × temps réel des étapes terminées rattachées à un poste (`production_item_etapes.work_center_id`).
- Composantes de coût en catalogue : politique `production.cost_components` (emballages, main-d'œuvre, machine, énergie, sous-traitance, pertes, charges ; les matières toujours) résolue par société, établissement, atelier et type d'ordre. Défaut : les composantes d'aujourd'hui, machine éteinte (Ofauria inchangé). Profils « discret » et « atelier » : machine allumée. Une composante éteinte vaut zéro.
- Écritures de production en option (inventaire permanent) : politique `production.ledger_entries` (éteinte par défaut, jamais livrée par un profil). Activée : une OD à la clôture (3151 / 7132 au coût de revient ; 6124 / 3121 pour les matières et emballages), une seule par ordre, via la file de comptabilisation (rejouable, type « production »).
- Écran : composantes et écritures dans Paramètres › Production › Coûts et prix ; « Machine » et son détail dans le panneau du coût de revient ; règle CCP dans l'onglet Parcours.

Tests : `couts-etape9.db.test.ts` (4) ; `profile-coverage` vert.
