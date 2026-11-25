# Suivi de l'intervention — production pâtissière, novembre 2026

Suite de `AUDIT_PRODUCTION_PATISSIERE_2026-11.md`. Branche `claude/audit-pastry-production-module-c4e2b0`, quatre commits (`de450a4b`, `a35f7a21`, `01c8adf1`, puis le manque valorisé). Rien n'est fusionné sur `main`, rien n'est poussé, rien n'est déployé. La base de dev `ofauria_db` n'a pas été modifiée : la migration 662 n'y est pas appliquée.

Trois états sont distingués partout :

- **Fait et testé** : code écrit, test automatique vert, et vérification à l'écran quand la fonction a un écran.
- **Fait, test automatique seulement** : pas de vérification à l'écran.
- **Proposé** : décrit dans le rapport, non réalisé.

---

## 1. Matrice avant / après

| Fonctionnalité | État initial | Constat | Action | Priorité | État final | Validation |
|---|---|---|---|---|---|---|
| Coût réel d'un plan terminé | Calculé seulement à la clôture manuelle ; 292 plans chiffrés sur 2 437 | C-01 | Coût et écriture déclenchés après toute clôture (`services/production-closing.ts`) | P0 | Fait et testé | Test « C-01 » ; à l'écran, plan de biscuit clos par la déclaration : « Coût réel 3,44 DH » |
| Semi-finis réservés au retour en brouillon, à la relance, à la suppression | Jamais rendus si la dépendance attend son plan fils ; plan fils figé sur l'ancienne quantité | C-02 | Libération de toute dépendance active, annulation du plan fils non lancé, détection rejouée | P0 | Fait et testé | 4 tests « C-02 » ; à l'écran, relance du plan OF-2026-02441 : 3 plans fils annulés et recréés, biscuit produit repris du stock, stock = lots |
| Clôture manuelle d'un plan de préparation de base | Articles « produits » sans mouvement de stock | C-03 | Refus tant que la base n'est pas déclarée | P0 | Fait, test automatique seulement | Test « C-03 » |
| Fabrication par fournées entières | Règle de trois : 130 tranches = 2,708 cadres | C-04 | Règle de lot sur le format (mig 662), moteur `sizeBatches`, création et modification d'ordre, plans issus d'une commande | P1 | Fait et testé | 10 tests unitaires, 4 tests d'intégration ; à l'écran : « 3 fournées · 144 prévues (+14 d'excédent) », plan « 3× Cadre opéra 40x60 · Demandé 130 · excédent +14 », beurre 1,50 kg |
| Plan de semi-fini à la fournée de la base | Arrondi au kilo supérieur (7,2 kg → 8 kg) | C-05 | Même règle de lot, appliquée au format de la base | P1 | Fait, test automatique seulement | Test « C-05 » : 7,2 kg, fournée de 2,9 kg → 3 fournées, 8,7 kg |
| Types de production, unités de lancement, types de découpe | Liste en dur de 5 types sans accents ; 6ᵉ type inutilisable | C-07 | Écran, validateur et mode de calcul lisent le référentiel | P1 | Fait et testé | À l'écran : 6 types accentués dont « Lot de fabrication » ; test de validateur aligné |
| Tests du calcul des besoins | 13 tests sur 13 en échec | C-08 | Bouchon réparé, 3 tests ajoutés | P1 | Fait et testé | 16 tests verts |
| Conversion d'unité absente | Quantité invalide (NaN) propagée | C-09 | Besoin non chiffré + avertissement nommé ; poids/volume sans densité = 1 kg pour 1 l | P1 | Fait, test automatique seulement | 3 tests unitaires |
| Réception de transfert | Rejouable : écart et perte réappliqués | C-12 | Refus d'un transfert déjà reçu | P1 | Fait, test automatique seulement | Test « C-12 » |
| Duplication d'un format | Perdait emballage, rendement au kilo, poids | C-23 | Copie complète, règle de lot comprise | P2 | Fait, test automatique seulement | Test « C-23 » |
| Colonne « Recettes » des formats | « Aucune » partout | C-25 | Compte les formats des fiches | P2 | Fait et testé | À l'écran : 7, 1, 2, 2, 1, 4, 4… |
| Production déclarée sans assez de matière | Sortie bornée à zéro, coût réel sous-évalué (3,44 DH pour 3 kg de biscuit) | C-35 | Décision du 2026-11-24 : laisser passer et valoriser le manque au coût courant, en ligne à part ; alerte sur le plan | P1 | Fait et testé | Test « C-35 » ; à l'écran : coût réel 64,33 DH dont 53,94 DH de « Manques de stock valorisés », alerte sur la fiche du plan |
| Mutualisation entre plans | Un plan fils par plan parent | C-06 | — | P1 | Proposé | — |
| Date limite des lots de semi-finis | 0 lot daté sur 1 436 | C-10 | — | P1 | Proposé | — |
| Besoins matière du MRP | Autre diviseur que le plan confirmé | C-11 | — | P1 | Proposé (non vérifié par exécution) | — |
| Clôture sans bon de sortie | Bases consommées deux fois | C-13 | — | P1 | Proposé (non vérifié par exécution) | — |
| Écriture de production | Sans clé unique | C-14 | — | P1 | Proposé | — |
| Géométrie de découpe, empreintes, capacité | Saisie décorative ou absente | C-15, C-16 | — | P2 | Proposé | — |
| Composant fixe par fournée | Absent | C-17 | — | P2 | Proposé | — |
| Capacité des équipements | Absente | C-19 | — | P2 | Proposé | — |
| Champs de l'éditeur selon le mode | Mêmes champs pour tout contenant | C-24 | — | P2 | Proposé | — |

---

## 2. Constats ajoutés pendant la simulation

Trouvés en utilisant les écrans sur la copie de travail. C-35 a été corrigé après votre décision (« valoriser le manque ») ; les autres ne le sont pas, sauf mention.

**C-35 · Production déclarée en rupture de matière : sortie bornée à zéro, coût réel sous-évalué** — P1 · vérifié
- Plan de biscuit OF-2026-02442 : cacao, sucre, œufs et eau étaient à zéro. La déclaration a été acceptée (« Production enregistrée avec succès »), seule la farine est sortie. Coût réel : 3,44 DH pour 3 kg, la farine seule.
- Les avertissements existent (`production_plans.warnings` : « Stock insuffisant : Cacao en poudre… ») mais passent en notification de cinq secondes ; le plan terminé ne les affiche pas.
- Un plan de semi-fini n'a ni besoins ni bon de sortie : aucun contrôle de disponibilité avant la déclaration.
- **Corrigé le 2026-11-24.** La production passe toujours (politique « autoriser et tracer », inchangée ; « bloquer » reste réglable par type d'article). Le manque, déjà inscrit dans `stock_anomalies`, est compté dans le coût réel au coût courant de la matière, sur des lignes « manque de stock » regroupées à part dans Coûts › Consommations. La fiche du plan affiche une alerte avec le montant et renvoie vers Stock › Anomalies. Le stock reste borné à zéro : aucune écriture de stock négatif.
- Limites : le coût courant est celui de la matière au moment du calcul, pas celui du jour de la production ; les plans déjà chiffrés ne changent qu'après « Recalculer » ; un manque d'emballage ou de semi-fini n'est pas valorisé ; aucun contrôle de disponibilité n'est ajouté avant la déclaration d'un plan de préparation de base.

**C-36 · Aucune modification de quantité après confirmation depuis l'écran** — P2 · vérifié
- Un plan « en attente d'ingrédients » ne propose que « Bon de sortie » et « Relancer le plan ». Le retour en brouillon n'existe que pour le statut « confirmé », réservé aux ordres sans bon de sortie. La relance recalcule mais ne permet pas de changer la quantité.

**C-37 · Plan de semi-fini : deux quantités et un bon de sortie fantôme** — P3 · vérifié
- L'en-tête affiche « Quantité prévue 3 », le détail « À produire 2,95 kg » et pèse les matières sur 2,95 kg.
- La carte « Bon de sortie » reste sur « En génération » alors qu'aucun bon ne sera créé.
- Corrigé en partie : un plan de base dont le plan parent a été relancé ou supprimé affichait « Préparation bloquée : aucun besoin calculé ». L'écran reconnaît maintenant le plan par son propre indicateur, et le lien avec le parent est gardé quand la base a déjà été lancée.

**C-38 · Création d'ordre : libellé du bouton trompeur** — P3 · vérifié
- « Ajouter 1 Cadre opéra 40x60 » ajoute une pièce, pas un cadre.

---

## 3. Modifications techniques

**Données**
- `server/migrations/662_regle_de_lot_format.sql` : `recipe_formats.lot_rule` (`partiel` par défaut), `lot_min`, `lot_max` ; `production_plan_items.requested_quantity`. Additive, inversion décrite en tête. Appliquée à `kalum_test` et à la copie `kalum_audit` seulement.

**Serveur**
- `services/production-closing.ts` (nouveau) : coût réel puis écriture après toute clôture.
- `services/production-declaration.ts`, `controllers/production.controller.ts` : appellent ce service.
- `repositories/production.repository.ts` : libération des semi-finis (toutes dépendances actives, quantité lue sur les lots, annulation du plan fils), retour en brouillon, relance, suppression, garde de détection, clôture d'une base, réception rejouable, insertion de ligne avec règle de lot (`lotRuleFor`, `insertSizedPlanItem`), plan fils à la fournée.
- `repositories/sourcing.helper.ts` : plans issus d'une commande lus sur la règle de lot du format.
- `repositories/recipe-composition.helper.ts` : conversion absente.
- `repositories/recipe-component.repository.ts`, `validators/recipe-component.validator.ts`, `repositories/recipe.repository.ts` : règle de lot lue, enregistrée, exposée ; duplication complète.
- `services/process-referentials.ts`, `controllers/production-contenant.controller.ts`, `validators/production-contenant.validator.ts` : référentiels des formats.

**Partagé**
- `shared/src/constants/batch-sizing.ts` (nouveau) : `sizeBatches`, `formatYieldPerBatch`.
- `shared/src/constants/production-contenant.ts` : listes de repli alignées sur le référentiel, mode lu du référentiel.

**Client**
- `features/recipes/NomenclatureEditor.tsx` : « Fournées : Entières / Partielles », « Nombre par ordre : mini à maxi ».
- `features/production/ProductionPage.tsx` : aperçu fournées, quantité prévue, excédent ; message à la création.
- `features/production/PlanDetailPage.tsx` : demande d'origine et excédent sur la ligne.
- `features/production/ContenantsPage.tsx` : référentiels, colonne « Recettes ».

---

## 4. Résultats des tests

| Suite | Avant | Après |
|---|---|---|
| Calcul des besoins (`recipe-composition.test.ts`) | 0 / 13 | 16 / 16 |
| Dimensionnement (`batch-sizing.test.ts`) | — | 10 / 10 |
| Lot 1 intégrité (`audit-patisserie-lot1.db.test.ts`) | — | 8 / 8 |
| Lot 2 fournées (`audit-patisserie-lot2.db.test.ts`) | — | 8 / 8 |
| Intégration production, fiches, commandes, bons de sortie (75 fichiers) | 44 / 44 sur les 9 fichiers de référence | 340 / 340 (délai de test porté à 30 s : la base jetable a accumulé 1 440 fiches et la liste des fiches dépasse 5 s) |
| Tests unitaires serveur (77 fichiers) | 370 réussis, 13 échecs, 17 fichiers non chargés faute de variables | 578 / 578 avec les variables de test |
| Tests client du module production | — | 25 / 25 |
| Types (`tsc`) serveur, client, partagé | Propre | Propre |

Régression constatée et traitée : un test figeait l'ancienne borne « type de production ≤ 5 » ; il vérifie désormais que le schéma accepte un type du référentiel et refuse 0.

Non rejoué : la suite d'intégration complète (261 fichiers), les tests de bout en bout Playwright, les autres modules du client.

---

## 5. Simulation à l'écran

Copie de travail `kalum_audit` (copie de `ofauria_db`, sur le même serveur PostgreSQL), serveur et client lancés depuis la branche, compte de test « chef pâtissier ».

| Étape | Résultat |
|---|---|
| Fiche Opéra : passer le format en « Entières », enregistrer | Enregistré, relu à l'identique |
| Nouveau plan : 130 tranches d'opéra, 46 éclairs | Aperçu « 3 fournées · 144 prévues (+14) » ; éclairs inchangés (fournée partielle) |
| Création | Plan OF-2026-02441 : « 3× Cadre opéra 40x60 », 144, « Demandé 130 · excédent +14 » |
| Confirmation | Beurre 1,50 kg ; biscuit 3,6 kg ; 4 plans de semi-finis ; bon de sortie créé |
| Rupture de matière | Beurre « Manquant 1,500 kg » sur le bon ; production verrouillée jusqu'à la clôture du bon |
| Plan de biscuit : confirmer, démarrer, déclarer 3 kg | Terminé automatiquement, coût réel affiché ; constat C-35 |
| Relance du plan parent | Biscuit repris du stock (3,6 kg, reste 0,05 kg, stock = lots) ; 3 plans fils annulés avec leur motif et recréés |
| Écran des formats | 6 types accentués, colonne « Recettes » renseignée |

Non simulé à l'écran : pesée par le magasinier, acceptation du bon, déclaration du produit fini, rendement inférieur au prévu, transfert vers le magasin, pertes, achats, comptabilité, production simultanée de deux ordres. Les rôles économat, achats, qualité, magasin et comptable n'ont pas été joués. Les produits forêt-noire, trompe-l'œil, cakes, muffins, cookies, macarons n'existent pas dans les données et n'ont pas été créés.

---

## 6. Mode d'emploi

**Chef pâtissier**
- *Fournées entières.* Fiche technique › Composition › carte du format › « Fournées » : choisir « Entières ». Toute quantité planifiée pour ce format est alors arrondie à la fournée supérieure ; l'écran de création annonce le nombre de fournées, la quantité prévue et l'excédent, et la ligne du plan garde la demande d'origine.
- *Nombre par ordre.* « mini » relève la quantité quand la demande est inférieure ; « maxi » ne réduit jamais la quantité, il signale le dépassement.
- *Préparations de base.* Même réglage sur la fiche de la base : son plan de fabrication est lancé en fournées entières.
- *Changer une quantité après confirmation.* Sur un ordre sans bon de sortie : retour en brouillon. Sinon : « Relancer le plan ». Dans les deux cas les semi-finis réservés sont rendus et recalculés.

**Administrateur**
- *Types de production, unités de lancement, types de découpe.* Paramètres › Référentiels. Un type ou une unité ajouté apparaît dans l'écran des formats ; une valeur désactivée reste affichée sur les formats qui la portent. Pour une unité de lancement, la métadonnée `mode` vaut `poids` ou `pieces`.
- *Avant de déployer.* Appliquer la migration 662. Sans réglage, toutes les fiches restent en « Partielles » : aucun ordre ne change.
- *Rattrapage des coûts réels.* Les plans terminés avant ce correctif n'ont toujours pas de coût. Le calcul en masse existe côté serveur (`POST /production-cout/batch-calculate`, droit `production.production_cout.batch_calculate`) mais aucun écran ne l'appelle : il n'a pas été lancé. À faire après accord, sur une copie d'abord (2 145 plans à chiffrer en dev).

---

## 7. Limites et suites recommandées

1. **C-35** est traité côté coût. Reste le stock : les anomalies ouvertes (Stock › Anomalies) sont à régulariser, et un contrôle de disponibilité avant la déclaration d'une préparation de base éviterait de les créer.
2. **Dates limites des semi-finis (C-10)** et **mutualisation entre plans (C-06)** : lot 4 du rapport.
3. **MRP (C-11)** et **clôture sans bon (C-13)** : relevés par lecture, à confirmer par un test avant correction.
4. La règle de lot n'est pas figée sur l'ordre au moment de la confirmation : elle est appliquée à la création et à la modification des lignes. Changer la règle d'un format ne modifie pas un ordre existant, mais sa relance ne réarrondit pas non plus.
5. La règle de lot n'est pas lue par le MRP ni par les prévisions.
6. `nb_contenants` est un entier : en fournée partielle, le nombre de fournées n'est pas enregistré sur la ligne.
7. La base `kalum_audit` et les deux lanceurs `audit-server-3014` / `audit-client-4190` (fichier `.claude/launch.json` du worktree) sont des outils de vérification : à supprimer quand ils ne servent plus.


---

## 8. Sorties de matière par article (2026-11-24, mig 663)

Décision : suivre les grands ERP (un ordre par article) sans retirer le « plan du jour » : le plan reste la vue de regroupement, chaque ligne porte ses propres besoins, sorties, lots et manques.

| Sujet | Avant | Après | Validation |
|---|---|---|---|
| Besoins | Par produit | Par ligne de plan (`production_ingredient_needs.plan_item_id`) | Test « besoins enregistrés par ligne » |
| Bon de sortie | Lot sorti rattaché au plan | Chaque lot sorti est porté par les lignes qui en ont besoin, au prorata de leur besoin ; un article qui ne prévoit pas la matière n'en reçoit rien | Test « bon de sortie » |
| Déclaration, clôture, sortie manuelle, FEFO | Sorties rattachées au plan | Sorties et lots rattachés à la ligne ; manque de stock rattaché à la ligne (`stock_anomalies.origin_line_id`) | Tests existants + test « coût réel » |
| Coût réel par article | Répartition par les besoins théoriques | Mesuré sur les sorties de la ligne ; seul le non-rattaché (sorties anciennes, semi-finis) est encore réparti | Test : beurre 80 DH entièrement dans l'article A, 0 dans B |
| Traçabilité aval et rappel | Tout le plan touché | Seules les lignes qui ont consommé le lot ; les autres articles du plan sont signalés « non concernés » | Tests « traçabilité » et « rappel » |
| Écran | Lots du plan en une liste | Lots groupés par article ; bandeau des articles non concernés dans la traçabilité | Vérifié à l'écran |

Reprise : les plans à un seul article ont été rattachés (exact) ; les plans à plusieurs articles antérieurs restent au niveau du plan et gardent l'ancienne répartition.

Limites :
- Au bon de sortie, la part de chaque article est calculée sur son besoin, pas pesée séparément : le coût d'une matière commune y reste théorique entre articles. Le gain est sur la traçabilité (un article qui n'utilise pas la matière n'est plus touché) et sur les productions sans bon de sortie, où la sortie est réellement faite article par article.
- Les préparations de base consommées par un plan (semi-finis) restent rattachées au plan, réparties par les besoins.
- ~~Le bon de sortie reste commun au plan : une matière manquante pour un article retient toujours le démarrage de tout le plan.~~ Traité (§ 9).

## 9. Matière manquante : seul l'article concerné attend (2026-11-24, mig 664)

| Étape | Comportement |
|---|---|
| Bon remis « avec manquants » et accepté par le chef | La part non livrée de chaque article (ligne en rupture, ou pesée inférieure de plus de 2 % au besoin) devient son manque (`production_item_shortages`). Ces articles passent en liste d'attente ; les autres démarrent et se produisent. |
| Clôture du bon | Ne remet plus en production un article qui attend une matière. |
| « Restaurer » | Sort la matière manquante pour l'article (stock, mouvement, lots, coût rattachés à l'article), tout ou rien ; refusé tant que le stock ne couvre pas, avec la liste de ce qui manque. |
| « Produire sans » | Lève le manque sans sortie de matière ; l'article repart. |
| Annuler l'article | Ferme son manque. |
| Relance du plan | N'efface plus l'attente d'un article à qui une matière manque. |
| Écran | Liste d'attente : « Manque : Beurre 1 kg », statut « Matière manquante », boutons Restaurer / Produire sans / Annuler. |

Validation : `manques-par-article.db.test.ts` (3 tests : attente de A pendant que B se produit, refus sans stock puis sortie pour A à l'arrivée du beurre, « produire sans », annulation).
