# Audit du module de production pâtissière — novembre 2026

Date : 2026-11-24 · Code audité : `79090725` (main) · Base lue : `ofauria_db` (dev, 27 fiches actives, 2 438 plans, 4 173 lignes de plan) · Migrations : 661.

Méthode : lecture du code et des migrations (quatre lectures parallèles, puis revérification des points critiques), requêtes en lecture seule sur la base de dev, utilisation des écrans avec le compte de test « chef pâtissier », état de référence des tests. Chaque constat porte sa preuve et son niveau de vérification :

- **V** = vérifié par moi (code relu, requête ou écran) ;
- **L** = relevé par lecture statique, non exécuté.

Ce document prend la suite de `AUDIT_PRODUCTION_FICHES_TECHNIQUES.md` (2026-10), `ANALYSE_MODULE_RECETTES.md`, `AUDIT_FORMATS_PRODUCTION.md` et `PLAN_EXECUTION_PRODUCTION_MULTI_INDUSTRIES.md`. Il ne les répète pas : il mesure l'existant contre le référentiel cible « production pâtissière » (modes de production, formats, rendements, besoins, mutualisation).

---

## 1. Résumé exécutif

Le module est large et, pour l'essentiel, sain : nomenclature par format à plusieurs niveaux, versions, substitutions, bon de sortie et pesée, lots et traçabilité jusqu'à la vente, coûts prévus et réels, profil sectoriel à héritage. Il n'y a rien à reconstruire.

Trois familles de défauts ressortent.

1. **Intégrité et finance (à corriger d'abord).**
   - 88 % des plans terminés n'ont pas de coût réel : la clôture automatique, chemin normal, ne déclenche ni le calcul ni l'écriture comptable (292 plans chiffrés sur 2 437).
   - Les quantités de semi-finis réservées par un plan ne sont pas rendues dans plusieurs cas (retour en brouillon puis suppression, annulation avec plan fils en attente), et le plan fils garde l'ancienne quantité quand le parent change.
   - La clôture manuelle d'un plan de semi-fini marque les articles produits sans aucun mouvement de stock.
   - La réception d'un transfert peut être rejouée : l'écart et la perte sont réappliqués.
2. **Le calcul des besoins est une règle de trois pure.** 130 tranches d'opéra pour un cadre de 48 donnent 2,708 cadres, sans proposition de 3 cadres ni excédent de 14. Le code d'arrondi au contenant existe (chemin des commandes), mais il lit `recipes.contenant_id`, vide sur les 27 fiches : il ne se déclenche jamais. Pas d'ingrédient fixe, pas de multiple de lot, pas de capacité d'équipement.
3. **Paramétrage à moitié branché.** Les référentiels « types de production » et « unités de lancement » existent en base (mig 634) mais l'écran et le validateur lisent une liste en dur de 5 valeurs : le 6ᵉ type est inutilisable, et un mode créé par l'administrateur n'apparaîtrait nulle part.

Maturité estimée par domaine (0 = absent, 4 = complet et testé) :

| Domaine | Note | Commentaire |
|---|---|---|
| Nomenclature multi-niveaux, versions, substitutions | 3,5 | Solide ; conservation par base absente |
| Formats et contenants | 2,5 | Dimensions saisies mais décoratives ; pas d'empreintes ni de capacité |
| Modes de production configurables | 1,5 | Référentiel créé, non lu |
| Calcul des besoins | 2 | Juste en proportion, sans lots entiers ni fixe |
| Mutualisation des semi-finis | 2 | Dans un plan oui ; entre plans non ; arrondi au kilo, pas au lot |
| Exécution, stock, lots | 3 | Double sortie bien gardée ; trous sur annulation et semi-finis |
| Coûts et comptabilité | 2 | Modèle riche, déclenchement défaillant |
| Paramétrage et profil sectoriel | 3 | Héritage, capacités, gel partiel |
| Tests | 2,5 | 261 fichiers d'intégration, mais les 13 tests du calcul des besoins sont cassés |

---

## 2. Cartographie de l'existant

| Fonction | Où | État |
|---|---|---|
| Fiche technique (identité, étapes, paramètres de pâte, allergènes) | `recipes`, `NomenclatureEditor.tsx`, `EtapesSection.tsx` | Conforme |
| Nomenclature par format | `recipe_format_components` (+ miroir `recipe_components` par trigger) | Conforme |
| Composants : matière, préparation de base, emballage | `chk_rfc_one_source` (mig 634) | Conforme |
| Sous-recettes, 12 niveaux, anti-cycle | trigger `trg_rfc_no_cycle` (mig 410/649) + contrôle applicatif | Conforme (logique en double) |
| Sous-ensemble fantôme | `is_phantom` (mig 588) | Conforme |
| Versions de nomenclature, restauration | `bom_versions` (mig 559), `VersionsSection.tsx` | Conforme |
| Substitutions de matière | `recipe_line_substitutes` (mig 563) | Conforme (pas de substitution de base) |
| Fiches alternatives par produit | `recipes.usage`, `alternative_for_product_id` (mig 562) | Partiel : ignorée à la déclaration |
| Format = fiche × contenant, rendement pièces ou kilo | `recipe_formats` (`nb_par_defaut`, `rendement_unite`, `rendement_kg`) | Partiel |
| Lien format ↔ produit vendu | `recipe_formats.product_id` | Conforme |
| Référentiel des contenants (cadres, cercles, plaques) | `production_contenants`, onglet « Formats de production » | Partiel : dimensions décoratives |
| Types de production / unités de lancement | `ref_entries` (mig 634) | Non branché |
| Pertes : ligne, standard de base, pertes fixes du contenant | `perte_pct`, `perte_standard_pct`, `pertes_fixes` | Partiel : quatre emplacements non unifiés |
| Coupe en plusieurs sorties | `production_item_outputs` (mig 302), `recipe_outputs` (mig 564) | Conforme |
| Calcul des besoins | `recipe-composition.helper.ts` | Partiel |
| Semi-finis : détection, réservation, plan fils | `detectAndCreateSemiFinishedPlans` | Fragile |
| Bon de sortie, pesée, multi-lots | `bon-sortie.repository.ts` | Conforme |
| Réservation de matière | mig 644, éteinte par défaut | Partiel |
| Lots produit fini, DLC, vitrine | `product_lots` | Conforme |
| Lots de semi-finis | `semi_finished_lots` | Non conforme : aucune date limite |
| Transfert magasin | réapprovisionnement (flux réel) ; `production_transfers` (route sans appelant) | Fragile |
| Coût prévu figé, coût réel, coûts standard | mig 645, 655-661 | Partiel |
| Écriture comptable de production | `production-ledger.ts` (politique éteinte par défaut) | Fragile |
| MRP jour et MRP phasé | `mrp.repository.ts`, `mrp-phased.ts` | Partiel : diviseur différent du plan |
| Profil sectoriel, spécialisations, capacités | mig 468, 632-633 | Conforme |
| Types d'ordre, politiques, gel sur l'ordre | mig 546, 538, 638 | Partiel |
| Droits par rôle | `can()` sur toutes les mutations | Conforme (pas de séparation des tâches) |

Fonctions présentes mais non accessibles depuis un écran : mode de référence « lot » et « pourcentage » de la fiche (`recipes.reference_mode`, lu, jamais écrit) ; type de production 6 « Lot de fabrication » ; unités de lancement `lot` et `kg` ; `freinte_par_etape` du format ; multiple de lot du MRP (codé, toujours 0) ; routes `GET /production/:id/dependencies`, `POST /production/:id/transfer-items`, `commit-partial` et `cancel` du bon de sortie ; champs « obligatoire » des documents et des étapes de parcours (saisis, non appliqués).

---

## 3. Forces à conserver

- Une seule source pour la composition (`recipe_format_components`), miroir tenu par trigger, coût par `fn_recipe_cost(recipe_id, format_id)`.
- Une base est référencée, jamais copiée : réutilisation sans duplication.
- Double sortie de matière correctement gardée entre bon de sortie et déclaration (relance, retour en brouillon et régénération refusés dès qu'un bon est prélevé).
- Verrous `FOR UPDATE` et garde de statut sur confirmation, démarrage, déclaration, clôture.
- Besoins figés à la confirmation sur la version de nomenclature en vigueur.
- Traçabilité lot matière → plan → lot produit → vente, avec rappel.
- Fonctions sectorielles conditionnées par capacité, test qui interdit de comparer le code du secteur.
- Conversion d'unité inconnue qui renvoie NULL côté SQL (plus de facteur 1 silencieux).

---

## 4. Registre des constats

Priorités : P0 intégrité ou erreur financière · P1 fonction essentielle manquante ou dysfonctionnement important · P2 amélioration · P3 confort.

### 4.1 P0 — Critique

**C-01 · Coût réel et écriture comptable absents après clôture automatique** — Non conforme · V
- État : `calculateAndSave` et `postProductionEntry` ne sont appelés que par la clôture manuelle (`production.controller.ts:864-866`). Quand le dernier article est déclaré, `produceItems` clôt le plan lui-même (`production.repository.ts:1845-1852`) sans rien calculer.
- Preuve : 2 437 plans terminés, 292 avec une ligne dans `production_cout_reel` (118/1 001 plans de produits, 174/1 436 plans de semi-finis).
- Impact : marges et écarts faux ou vides ; si la politique d'écritures est activée, le stock de produits finis n'est jamais comptabilisé pour ces plans.
- Cause : le calcul est accroché au contrôleur d'une route, pas à l'événement « plan terminé ».
- Solution : déclencher le calcul et l'écriture après toute transition vers « terminé », quel que soit le chemin ; rattrapage par `calculateAllUncalculated`.
- Acceptation : un plan clos par la déclaration du dernier article a son coût réel ; test d'intégration.

**C-02 · Semi-finis réservés non rendus, plan fils périmé** — Non conforme · V
- État : `releaseSemiFinishedReservations` ne traite que les dépendances `fulfilled` (`production.repository.ts:2683`). Une dépendance `pending` avec une part prise sur le stock n'est jamais rendue. `revertToDraft` ne libère rien (`:715-783`) et la garde de détection sort dès qu'une dépendance existe (`:2427-2433`), contrairement au commentaire `:712`. `remove` supprime le brouillon sans rien rendre (`:2403`).
- Scénarios : (a) confirmer (2 kg de crème réservés), revenir en brouillon, supprimer : les 2 kg et les quantités de lots disparaissent ; (b) confirmer 50 tartes, revenir en brouillon, passer à 100, reconfirmer : le plan fils reste dimensionné pour 50 et le parent exclut toujours la base de ses besoins.
- Impact : stock de semi-finis faux, sous-production silencieuse de la base.
- Solution : au retour en brouillon et à la suppression, rendre les réservations, annuler les plans fils non démarrés, supprimer les dépendances ; libérer aussi les dépendances `pending`.
- Acceptation : après retour en brouillon, le stock de semi-fini revient à sa valeur ; après changement de quantité, le plan fils est recalculé.

**C-03 · Clôture manuelle d'un plan de semi-fini sans mouvement** — Non conforme · V (code)
- État : `complete()` passe les lignes à « produit » (`:1105`) puis ne traite que les lignes jointes à `products` (`:1133`). Une ligne de plan fils a `product_id` NULL.
- Impact : plan terminé sans entrée de stock ni sortie de matière ; dépendance du parent jamais levée.
- Solution : refuser `complete()` tant qu'il reste des lignes de base non déclarées, ou les faire passer par le même traitement que `produceItems`.

### 4.2 P1 — Élevée

**C-04 · Pas de fabrication par lots entiers (scénario « opéra par cadre »)** — Manquante · V (écran + base)
- État : la quantité saisie part telle quelle ; besoins = quantité ÷ rendement, en fraction. À l'écran, 130 tranches restent 130 (les boutons +/− avancent bien d'un cadre, mais la saisie libre n'est ni arrondie ni signalée).
- Existant non branché : `sourcing.helper.ts:220-226` calcule `ceil`, quantité effective et surplus, mais sur `recipes.contenant_id` (0 fiche sur 27). Sur 4 173 lignes de plan, aucune n'a `nb_contenants`.
- Impact : besoins de 2,7 cadres pour 3 fabriqués, excédent non prévu, coût par pièce faux.
- Solution : règle de lot sur le format (lots entiers / partiel autorisé), calcul unique du nombre de fournées, de la production prévue et de l'excédent, lu depuis `recipe_formats` ; affichage à la création du plan.
- Acceptation : 130 tranches, cadre de 48, lots entiers → 3 cadres, 144 prévues, 14 d'excédent, besoins pour 3 cadres ; partiel autorisé → 2,71 cadres proposés.

**C-05 · Plan fils de semi-fini arrondi au kilo, pas au lot** — Partiellement conforme · V (code)
- État : `Math.ceil(toProduce)` dans l'unité de rendement (`:2594`). 0,15 kg de besoin → 1 kg ; 7,2 kg de crème (fournée de 2,9 kg) → 8 kg, soit 2,76 fournées.
- Solution : même règle de lot que C-04, appliquée à la base.

**C-06 · Aucune mutualisation entre plans** — Manquante · L
- État : consolidation dans un plan (un besoin cumulé par base) ; entre plans du même jour, chaque parent crée son propre plan fils, à la même date, sans délai.
- Impact : deux plans à 1,2 kg de crème donnent deux fabrications au lieu d'une.
- Solution : rattacher le besoin à un plan fils ouvert de la même base, du même jour et du même atelier s'il n'est pas démarré ; sinon en créer un.

**C-07 · Référentiels des modes de production non lus** — Non paramétrable · V (écran + base)
- État : `production_types` (6) et `production_launch_units` (7) en base ; l'écran lit `shared/src/constants/production-contenant.ts:39-53` (5 et 5, libellés sans accents) ; le validateur borne le type à 1..5. `getModeCalcul` ne reconnaît que `kg_pate`.
- Solution : écran, validateur et mode de calcul lisent le référentiel (`metadata.mode`).

**C-08 · Tests du calcul des besoins cassés** — Techniquement fragile · V
- État : `recipe-composition.test.ts`, 13 tests sur 13 en échec (« Requête non stubbée ») depuis le changement du diviseur au kilo : le bouchon ne reconnaît plus la requête.
- Impact : le cœur du calcul n'a plus de filet.

**C-09 · Conversion inconnue : quantité invalide au lieu d'une alerte** — Non conforme · L
- État : `fn_convert_factor` renvoie NULL ; le helper fait `parseFloat(null)` = NaN (`recipe-composition.helper.ts:141`) sans garde. Le message « quantité prise telle quelle » est donc faux.
- Solution : traiter NULL comme « conversion impossible » : avertissement nommé, besoin non chiffré, jamais NaN.

**C-10 · Lots de semi-finis sans date limite** — Non conforme · V
- Preuve : 1 436 lots, 0 avec `expires_at`. La durée de conservation n'existe que sur le produit, pas sur la base. Le filtre de péremption de la réservation est donc inopérant.
- Solution : durée de conservation sur la base, DLC posée à la création du lot.

**C-11 · Besoins matière du MRP sur un autre diviseur** — Non conforme · L
- État : `mrp.repository.ts:379` divise par `recipes.yield_quantity` et ne lit que la composition du format par défaut ; le plan confirmé utilise le rendement du format. Une fiche par pièce avec un rendement de 12 donnerait des achats divisés par 12.
- Solution : le MRP appelle le même moteur que la confirmation.

**C-12 · Réception de transfert rejouable** — Non conforme · V (code)
- État : `confirmTransferReception` ne vérifie pas le statut du transfert (`:2000-2103`). L'idempotence dépend d'un en-tête facultatif. Route sans appelant dans le client actuel (le flux réel passe par le réapprovisionnement), d'où P1 et non P0.
- Solution : refuser un transfert déjà reçu.

**C-13 · Clôture sans bon de sortie : bases consommées deux fois** — Non conforme · L
- État : `complete()` développe les sous-recettes sans exclure celles couvertes par un plan fils (`:1152-1156`), contrairement à `produceItems` (`:1541`).

**C-14 · Écriture de production sans clé unique** — Techniquement fragile · L
- État : contrôle par SELECT hors transaction, écriture `source_kind='manual'` sans `source_id`, hors de l'index unique. Ni extourne ni complément après recalcul.

### 4.3 P2 — Moyenne

| N° | Constat | Classification | Vérif. | Solution |
|---|---|---|---|---|
| C-15 | Dimensions du contenant et nombre de pièces après découpe : saisis, jamais utilisés ; pas de dimension de portion ni de bordure, pas de calcul géométrique | Partiellement conforme | V | Calcul proposé (longueur, largeur, bordure, portion), rendement validé par le chef prioritaire |
| C-16 | Pas de nombre d'empreintes ni de capacité (volume, poids de remplissage) sur le contenant | Manquante | L | Deux colonnes sur le contenant |
| C-17 | Tout composant est proportionnel : pas d'ingrédient fixe par fournée | Manquante | L | Drapeau par ligne |
| C-18 | Quantité mini sur le produit seulement ; pas de maxi ; multiple de lot codé mais toujours 0 | Partiellement conforme | L | Mini, maxi et multiple sur le format |
| C-19 | Aucune capacité physique d'équipement (plaques par four, kilos par batteur) | Manquante | L | Capacité par équipement, contrôle à la planification |
| C-20 | Perte standard d'une fiche appliquée seulement quand elle est consommée comme base, pas sur le produit de tête | Partiellement conforme | L | Marge de fabrication explicite sur le format |
| C-21 | Poids cuit : valeur stockée saisie dans Paramètres, valeur affichée recalculée dans l'éditeur | Redondante | L | Une seule saisie |
| C-22 | Perte standard, champ de la fiche, saisi dans la carte du format | Mal intégrée | L | La porter sur le format ou la sortir de la carte |
| C-23 | Dupliquer un format perd l'emballage, le rendement au kilo et les poids | Non conforme | L | Copier toutes les colonnes |
| C-24 | L'éditeur n'adapte pas ses champs au mode : mêmes champs pour cadre, cercle, plaque, kilo | Non conforme | V | Champs pilotés par le mode du contenant |
| C-25 | Colonne « Recettes » des formats : « Aucune » partout (compte l'ancienne colonne) | Non conforme | V | Compter `recipe_formats` |
| C-26 | Gel de configuration partiel : 3 politiques figées sont relues en direct | Techniquement fragile | L | Lire l'instantané |
| C-27 | Réservation de matière ignorée par le bon de sortie et la consommation | Mal intégrée | L | Stock libre lu partout |
| C-28 | Aucune annulation après prélèvement ; aucun retour matière | Manquante | L | Flux de retour au magasin |
| C-29 | Coût du semi-fini compté dans le plan fils et dans le parent pour les totaux | Redondante | L | Exclure les plans fils des totaux |
| C-30 | Déclaration : la fiche alternative choisie est ignorée | Non conforme | L | Utiliser `recipeForItem` |
| C-31 | Bases imbriquées : le plan fils ne redétecte pas, le niveau 2 est aplati, son stock ignoré | Partiellement conforme | L | Détection récursive |
| C-32 | Pas de séparation des tâches (préparer, remettre et accepter un bon par la même personne) | Manquante | L | Politique optionnelle |
| C-33 | Familles : deux niveaux seulement, la sous-famille est un texte libre | Partiellement conforme | L | Arbre de catégories |
| C-34 | Onglet des contenants et panneau de coupe affichés sans test de capacité sectorielle | Mal intégrée | L | Conditionner |

### 4.4 P3 — Faible

- Verrou absent sur démarrage d'articles, annulation d'articles, sortie d'attente, création de transfert.
- Lectures de production sans contrôle de droit sur quelques routes.
- Fichiers géants : `production.repository.ts` 3 017 lignes, `ProductionLaunchModal.tsx` 2 437, `PlanDetailPage.tsx` 2 133 ; sortie de matière écrite trois fois.
- 17 fichiers de test échouent dans un worktree sans `.env` (variables manquantes), sans lien avec le code.
- `ProductionProfileTab` appelle encore une route retirée (410).

---

## 5. Écarts par rapport au référentiel cible

| Exigence | Existant | Écart |
|---|---|---|
| Huit modes (cadre, pièce, moule, plaque, empreinte, poids, diamètre, lot) | Pièces ou kilo sur le format ; cadre, cercle, plaque sur le contenant | Empreinte et diamètre absents comme modes ; pas de combinaison explicite |
| Modes créés par l'administrateur | Référentiel en base | Non lu (C-07) |
| Recette / fiche / nomenclature / format de production / format commercial / ordre | Fiche + format + produit lié + ordre | Format commercial sans entité propre (lien produit) : suffisant ; à conserver |
| Dimensions, capacité, remplissage, découpe | Dimensions et nombre de pièces saisis | Décoratifs (C-15, C-16) |
| Rendement validé par le chef | `nb_par_defaut` saisi à la main | Conforme de fait ; pas de calcul proposé |
| Chutes récupérables | Sous-produits à valeur fixe | Pas de réintégration |
| Nomenclature multi-niveaux, versions, substitutions, anti-cycle | Oui | Conservation par base (C-10) |
| Nombre de cadres, lots, excédent | Non | C-04, C-05 |
| Ingrédients fixes et proportionnels | Non | C-17 |
| Quantités mini, maxi, capacités | Mini produit | C-18, C-19 |
| Mutualisation entre ordres | Dans un plan | C-06 |
| Interfaces adaptées au mode | Trois bascules | C-24 |
| Pas de double mouvement ni double écriture | Double sortie gardée | C-12, C-13, C-14 |
| Paramètres historisés, ordres protégés | Journal et gel | Partiels (C-26) |

Scénarios du cahier des charges, état initial :

| Scénario | État initial |
|---|---|
| 1 Opéra par cadre (130 → 3 cadres, 144, +14) | Non : 2,708 cadres |
| 2 Trompe-l'œil par pièce | Oui (composition par pièce) |
| 3 Cakes 300 g et 600 g | Oui pour deux formats d'une fiche ; poids cru/cuit hors besoin |
| 4 Cookies par lot | Partiel : pas de nombre de lots ni de capacité |
| 5 Mille-feuilles par plaque | Partiel : pertes de découpe en pièces fixes, pas de géométrie |
| 6 Muffins par empreinte | Partiel : empreintes = rendement saisi |

---

## 6. Architecture cible

Principe : ajouter, ne rien remplacer. Un seul moteur de dimensionnement, lu par la création de plan, la confirmation, les semi-finis et le MRP.

**Données (ajouts)**

| Table | Colonnes | Rôle |
|---|---|---|
| `recipe_formats` | `lot_rule` (`entier` / `partiel`), `lot_min`, `lot_max`, `lot_multiple`, `marge_securite_pct` | Règle de lot du format |
| `recipe_format_components` | `quantite_fixe` (booléen) | Composant fixe par fournée |
| `production_contenants` | `nb_empreintes`, `capacite_qty`, `capacite_unit`, `portion_longueur_cm`, `portion_largeur_cm`, `bordure_cm` | Géométrie et capacité |
| `recipes` | `shelf_life_hours` (bases) | DLC des lots de semi-finis |
| `ref_entries` `production_types` / `production_launch_units` | `metadata.mode`, `metadata.fields` | Mode de calcul et champs affichés |
| `production_plan_items` | `format_id`, `nb_contenants`, `surplus_prevu` (existent) | Enfin remplis |

**Moteur** (`services/batch-sizing.ts`, fonction pure, testable sans base)

```
entrée : quantité demandée, rendement par fournée, règle de lot, mini, maxi, multiple, marge
1. besoin = demande × (1 + marge)
2. fournées = besoin ÷ rendement
3. règle « entier » : fournées = plafond(fournées) ; multiple : arrondi au multiple supérieur
4. mini : fournées ≥ mini ; maxi : alerte si dépassé (jamais d'écrêtage silencieux)
5. production prévue = fournées × rendement ; excédent = prévue − demande
besoin d'un composant = quantité par fournée × fournées        (proportionnel)
                      = quantité par fournée × plafond(fournées) (fixe)
```

**Règles**
- Le rendement saisi par le chef prime toujours sur le calcul géométrique, qui n'est qu'une proposition.
- La règle de lot est figée sur la ligne de plan à la confirmation (comme la version de nomenclature).
- Aucune fonction pâtissière sans capacité : les autres profils gardent le comportement proportionnel (`lot_rule` = `partiel` par défaut).

---

## 7. Plan de remédiation

| Lot | Contenu | Constats | Risque |
|---|---|---|---|
| 1 Intégrité | Coût réel à toute clôture ; libération des semi-finis ; clôture d'un plan fils ; réception rejouable ; conversion inconnue ; tests réparés | C-01, 02, 03, 08, 09, 12 | Faible : gardes et déclenchements |
| 2 Lots entiers | Règle de lot du format, moteur de dimensionnement, plan fils au lot, affichage à la création du plan | C-04, 05 | Moyen : touche la quantité planifiée |
| 3 Modes configurables | Référentiel lu par l'écran et le validateur, champs par mode | C-07, 24, 25 | Faible |
| 4 Bases | DLC des semi-finis, mutualisation entre plans, détection récursive | C-06, 10, 31 | Moyen |
| 5 Formats | Empreintes, capacité, géométrie de découpe, composant fixe, mini/maxi | C-15 à 18, 23 | Faible |
| 6 Cohérence | MRP sur le moteur commun, clôture sans bon, écriture à clé unique, gel complet | C-11, 13, 14, 26 | Moyen |
| 7 Capacités et flux | Capacité d'équipement, retour matière, séparation des tâches | C-19, 28, 32 | Élevé : nouveaux flux |

**Non-régression** : chaque lot ajoute ses tests d'intégration ; la suite `test:db` et le scénario A (`scenario-a-boulangerie.db.test.ts`) passent avant et après ; migrations additives, colonnes nullables ou à défaut neutre ; `lot_rule` = `partiel` par défaut, donc aucun plan existant ne change de quantité.

**Retour arrière** : migrations sans suppression ni réécriture de données ; une colonne ajoutée peut rester inutilisée. Aucune régularisation de données n'est lancée sans accord (le rattrapage des coûts réels est proposé, pas exécuté).

---

## 8. Suivi de l'intervention

Voir `SUIVI_PRODUCTION_PATISSIERE_2026-11.md` : matrice avant / après, modifications réalisées, résultats de tests, limites résiduelles.

Constats ajoutés pendant la simulation à l'écran (détail dans le document de suivi, § 2) : C-35 production déclarée en rupture de matière, coût réel sous-évalué (P1) ; C-36 aucune modification de quantité après confirmation depuis l'écran (P2) ; C-37 plan de semi-fini à deux quantités et bon de sortie fantôme (P3) ; C-38 libellé trompeur du bouton d'ajout (P3).

État au 2026-11-24 : lots 1, 2 et 3 réalisés (C-01, 02, 03, 04, 05, 07, 08, 09, 12, 23, 25) ; lots 4 à 7 proposés.
