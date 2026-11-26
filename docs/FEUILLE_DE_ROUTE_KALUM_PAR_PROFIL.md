# Feuille de route — Kalum piloté par le profil

Rédigée le 25 novembre 2026. Aucune ligne de code n'est écrite à ce stade : ce document décrit ce qui sera fait, dans quel ordre, et comment.

Maquettes de référence (45 écrans, cinq profils, trois modules) : https://claude.ai/artifact/MZcqSQv6Hc5j6gdi2cgzLx

## 1. La cible

Un seul Kalum, un seul code. Le profil choisi dans l'assistant de configuration décide de ce que la société voit et de la façon dont ses pièces se comportent : menus, onglets, écrans, référentiels, rôles, règles.

Six règles tiennent l'ensemble :

1. **Le code ne lit jamais le secteur.** Il lit une capacité (allumée ou éteinte), un comportement de référentiel, ou un réglage résolu.
2. **Un écran, son entrée de menu et son API s'ouvrent et se ferment ensemble.**
3. **Les écrans sont assemblés, pas générés.** Une bibliothèque de blocs (en-tête, indicateurs, filtres, tableau, fiche, lignes, chronologie, panneau) et un registre qui dit quels blocs et quelles colonnes un profil affiche.
4. **Les règles se choisissent dans un catalogue**, elles ne s'écrivent pas. Pas de langage de script pour l'administrateur.
5. **Rien n'est supprimé.** Éteindre une capacité masque et ferme ; rallumer rouvre les mêmes données.
6. **Ofauria ne change pas.** Toute nouvelle capacité est allumée par défaut pour une société existante quand elle correspond à un écran qu'elle utilise déjà, éteinte sinon.

Limite assumée : un nouveau secteur se configure sans développement tant qu'il se compose de capacités existantes. Une capacité qui manque (par exemple la pesée d'un camion sur pont-bascule) se développe une fois, puis sert à tous les profils.

## 2. Point de départ (relevé du 25 novembre 2026)

| Brique | État |
|---|---|
| Profils (`sector_packs`, héritage, 13 profils dans l'assistant) | En place |
| Référentiels à comportements (`ref_entries`, mig 698 et 701) | En place, peu de comportements lus |
| Capacités (`app_features`) | Production, Stock, Contrôle, Articles seulement |
| Garde d'activation des API (`module-activation.middleware.ts`) | 59 règles pour 107 familles de routes ; 40 familles métier hors table |
| Sous-menus (`ModuleShell`, 11 modules) | Masquage écrit à la main dans chaque page |
| Vocabulaire par profil | 26 clés |
| Catalogue d'écrans | 4 écrans de Production |
| Moteur de processus | Par type d'ordre de production |
| Résolveur de configuration | Écrit, lectures non basculées (lot 2 du suivi) |
| Garde « jamais le secteur » (`never-sector-guard.test.ts`) | Passe, mais ne connaît que 8 anciens codes |

À noter : la branche de travail est à la migration 701, `main` plus loin. Tout démarre depuis `main` ; les numéros de migration sont attribués au moment de l'écriture.

## 3. Méthode, identique pour chaque étape

1. **Audit court** du code concerné (tables, routes, écrans). Les descriptions techniques des phases 2 à 7 ci-dessous sont des propositions : cet audit les confirme ou les corrige.
2. **Maquette** de tout écran nouveau ou transformé, au Design System Kalum.
3. **Accord** avant d'écrire.
4. **Code** : migration, serveur, écran, tests.
5. **Recette** sur deux sociétés : Ofauria (rien ne doit bouger) et une société de test du profil visé.
6. **Commit** sur `main`, déploiement décidé à part.

## 4. Vue d'ensemble

| Phase | Contenu | Dépend de | Profils servis |
|---|---|---|---|
| 1 | Socle | — | Tous |
| 2 | Fiche article et Stock | 1 | Tous |
| 3 | Ventes et documents | 1, 2 | Tous |
| 4 | Production | 1, 2 | Pharmacie, industrie, boulangerie |
| 5 | Achats et Qualité | 2 | Tous |
| 6 | Chantiers, Exploitation, Maintenance | 2, 3, 5 | Bâtiment, transport |
| 7 | Personnel, comptabilité, indicateurs, accueil | 1 | Tous |

Les phases 4 et 5 peuvent avancer en parallèle après la phase 2. La phase 7 peut être entamée par morceaux dès la fin de la phase 1.

---

## Phase 1 — Socle

Aucun écran métier nouveau. À la fin, une société au profil Bâtiment a un Kalum débarrassé de ce qui ne la concerne pas ; il n'est pas encore adapté.

### Étape 1.1 — Inventaire des 40 familles de routes hors garde

- **Objet** : savoir, pour chacune, quel module et quelle capacité la gouvernent, et si elle est lue par un écran d'un autre module.
- **Technique** : relevé de `server/src/routes/index.ts` contre `RULES`, `EXTRA_RULES` et `FEATURE_RULES` ; recherche des appels côté écran (`client/src/api/*.api.ts`) pour repérer les lectures croisées. Résultat : un tableau route → module → capacité → lecteurs.
- **Fin** : tableau validé, sans code.

### Étape 1.2 — Fermeture des API

- **Objet** : plus aucune route métier ouverte quand son module ou sa capacité est éteint.
- **Technique** :
  - fusion des trois tables de règles en une seule, typée, dans `server/src/middleware/` : `{ prefix | pattern, modules, feature?, readOpen?, alsoRead? }` ;
  - exemptions nommées et justifiées (connexion, comptes, paramètres, fichiers, recherche, notifications) ;
  - nouveau test de garde : toute route montée dans `routes/index.ts` doit avoir une règle ou une exemption, sinon échec ;
  - mise en service en mode « journal » (déjà prévu par la garde des droits : refus tracés dans Journal › Connexions, sans blocage), puis passage en blocage après une période sans refus inattendu.
- **Fin** : test de garde vert ; aucun refus inattendu sur Ofauria en mode journal.

### Étape 1.3 — Capacités pour tous les modules

- **Objet** : pouvoir éteindre un écran de Ventes, d'Achats, de Comptabilité ou de Personnel comme on éteint aujourd'hui le mode fournée.
- **Technique** :
  - une migration qui complète `app_features` (30 à 40 lignes), une capacité par écran ou groupe d'écrans existant : devis, contrats de vente, abonnements, promotions, fidélité, commissions, relances, tournées de livraison, retours professionnels, caisse, appels d'offres, frais d'approche, évaluation fournisseurs, paie périodique, avances, plannings, charges constatées d'avance, etc. ;
  - dépendances entre capacités (la fidélité exige la caisse) dans la même table que celles de la Production ;
  - valeur par défaut par profil dans `sector_packs.features` ; pour une société existante, allumée si la table métier correspondante contient des lignes ;
  - types partagés régénérés (`shared/`).
- **Fin** : l'étape « Modules » de l'assistant propose les nouvelles options ; Ofauria garde tout allumé.

### Étape 1.4 — Registre d'écrans unique

- **Objet** : une seule déclaration par écran, lue par le menu, par la garde et par Paramètres.
- **Technique** :
  - registre dans `shared/` (du code, pas une table : un écran est du code livré) : `{ key, module, section, feature?, vocabularyKey?, route, apiPrefixes[] }` ;
  - `ModuleView` (dans `ModuleShell.tsx`) reçoit la clé du registre ; le gabarit calcule seul la visibilité à partir des modules, capacités et droits ;
  - retrait du masquage manuel dans les 11 pages de module (Ventes, Achats, Stock, Production, Contrôle, Comptabilité, Personnel, Projets, Maintenance, Journée boutique, Utilisateurs) ;
  - navigation principale (`client/src/config/navigation.ts`) branchée sur le même registre ;
  - les règles de l'étape 1.2 sont dérivées de `apiPrefixes` : une seule source pour le menu et pour l'API.
- **Fin** : relevé des menus d'Ofauria avant et après, identiques à l'entrée près.

### Étape 1.5 — Lecture unique de la configuration

- **Objet** : une seule façon de demander « cette capacité est-elle allumée, que vaut ce réglage, comment s'appelle cet objet ».
- **Technique** :
  - côté serveur, toutes les lectures passent par le résolveur (ordre : socle, secteur, spécialité, entreprise, établissement, rôle), avec un cache par société vidé à la publication d'une configuration ;
  - côté écran, un seul crochet (capacités, vocabulaire, réglages), chargé à l'ouverture de session, rafraîchi à la publication ;
  - suppression des lectures directes dispersées.
- **Fin** : aucune requête de configuration supplémentaire par écran ; temps de chargement inchangé.

### Étape 1.6 — Gardes durcies et recette du socle

- **Technique** :
  - `never-sector-guard.test.ts` construit sa liste à partir des 13 profils et de leurs ascendants, au lieu de 8 codes écrits en dur ;
  - nouvelle garde : un écran routé absent du registre fait échouer les tests ;
  - recette : société de test au profil Bâtiment — entrées boulangères absentes, API refusées, réactivation sans perte.
- **Fin** : suite serveur complète verte, les deux recettes passées.

---

## Phase 2 — Fiche article et Stock

Maquettes : page « stock » du canevas (15 écrans).

### Étape 2.1 — Audit court

Tables d'articles (`ingredients`, `products`, `packaging_items`), lots (`ingredient_lots`, `product_lots`), emplacements, réservation (mig 389), inventaires (mig 367). Question à trancher : garder trois tables d'articles avec une vue commune, ou converger vers une seule.

### Étape 2.2 — Fiche article par blocs

- **Objet** : une fiche unique dont les onglets dépendent des capacités (péremption, lot, numéro de série, dimensions et poids, article d'un client, matière dangereuse).
- **Technique** : composant de fiche assemblé depuis le registre ; chaque onglet porte sa capacité ; attributs propres à un profil rangés dans les champs personnalisés existants (mig 369) quand ils ne portent aucune règle, en colonne quand une règle les lit.

### Étape 2.3 — Statut de lot

- **Objet** : quarantaine, libéré, refusé, périmé (pharmacie, agroalimentaire).
- **Technique** : statut sur les lots, référentiel de statuts à comportements (« vendable », « consommable en production », « déplaçable ») ; les sorties de stock et la réservation lisent le comportement, jamais le libellé ; journal des changements de statut avec auteur et motif. Capacité `statut_lot`, éteinte pour Ofauria.

### Étape 2.4 — Lieux de stock typés

- **Objet** : réserve et laboratoire, dépôt et chantiers, entrepôt avec allées et emplacements, magasins.
- **Technique** : type de lieu en référentiel à comportements (« reçoit des achats », « consomme sur place », « rattaché à un chantier », « adressage par emplacement ») ; lien facultatif vers un projet ; l'état du stock se regroupe selon le type.

### Étape 2.5 — Stock pour le compte d'un client

- **Objet** : l'entrepôt du transporteur garde des articles qui ne lui appartiennent pas.
- **Technique** : propriétaire sur le lot ou la ligne de stock ; ces quantités sont exclues de la valorisation et de la comptabilité de la société ; état du stock filtrable par déposant. Capacité `stock_deposant`.

### Étape 2.6 — Réservé et disponible généralisés

- **Objet** : étendre la réservation des commandes (mig 389) aux ordres de fabrication et aux chantiers.
- **Technique** : une table de réservations unique avec l'origine (commande, ordre, chantier) ; disponible = stock − réservé, calculé au même endroit pour tous les écrans.

### Étape 2.7 — Mouvements par type

- **Objet** : bon de sortie pesé, réception en quarantaine, réception sur chantier, réception à quai, sortie pour fabrication : un seul écran de mouvement.
- **Technique** : type de mouvement en référentiel à comportements (pesée exigée, contrôle exigé, lot obligatoire, destination) ; l'écran affiche les blocs que le type demande.

---

## Phase 3 — Ventes et documents

Maquettes : page « ventes » du canevas (15 écrans).

### Étape 3.1 — Audit court et cycles de vente

- **Objet** : cinq cycles — comptoir (avance, retrait, solde), commande livrée et facturée, devis puis marché puis situations, demande puis prestation puis facture, commande à délai avec reste à livrer.
- **Technique** : s'appuyer sur les types de commande à comportements (mig 701) ; chaque type nomme son parcours dans le moteur de processus, étendu de la Production aux pièces de vente. Les statuts cessent d'être une liste figée par écran.

### Étape 3.2 — Devis structuré

- **Objet** : devis en lots et ouvrages avec sous-totaux (bâtiment), en lignes simples ailleurs.
- **Technique** : niveau de regroupement sur les lignes de devis (mig 365) ; bloc de lignes hiérarchique dans la bibliothèque. Capacité `devis_structure`.

### Étape 3.3 — Facturation à l'avancement

- **Objet** : situations de travaux, retenue de garantie, avance de démarrage et son remboursement.
- **Technique** : table des situations rattachée au marché, avancement par ligne, cumul précédent, retenue et avance calculées par des réglages (taux à faire valider par un professionnel du bâtiment) ; écritures comptables par modèle. Capacité `facturation_avancement`.

### Étape 3.4 — Grille tarifaire et preuve de livraison

- **Objet** : prix calculé par distance, poids ou palette ; facture déclenchée par la preuve de livraison.
- **Technique** : grilles tarifaires (zones, tranches, minimum de facturation) ; preuve de livraison = pièce jointe et signature sur la livraison ; règle de catalogue « facturer à la preuve ».

### Étape 3.5 — Disponibilité, délai, reste à livrer

- **Objet** : ligne de commande avec disponible et date promise ; livraisons partielles ; expédition par lot libéré.
- **Technique** : calcul de date promise à partir du disponible (phase 2) et du délai de fabrication ; reste à livrer par ligne ; la livraison ne propose que des lots au comportement « vendable ».

### Étape 3.6 — Modèles de documents

- **Objet** : devis, bon de livraison, facture, situation avec les mentions du métier.
- **Technique** : modèles d'impression par type de pièce, blocs activés par capacité (numéro de lot, péremption, retenue, immatriculation du véhicule).

---

## Phase 4 — Production

Maquettes : page « production » du canevas (boulangerie, pharmacie, industrie).

### Étape 4.1 — Types d'ordre par profil

- **Technique** : chaque profil livre ses types d'ordre et leurs parcours dans le moteur existant ; les quatre écrans du catalogue deviennent des assemblages de blocs lus au registre.

### Étape 4.2 — Dossier de lot (pharmacie)

- **Technique** : pesées contrôlées par deux personnes, relevés de procédé par étape, rendement théorique et réel, libération par le responsable qualité (lien avec le statut de lot de la phase 2) ; dossier figé et signé à la clôture.

### Étape 4.3 — Nomenclature et gamme (industrie)

- **Technique** : nomenclature à plusieurs niveaux, gamme d'opérations par poste (les gammes existent déjà : `/routings`), temps passés, rebuts, réservation des composants (phase 2).

### Étape 4.4 — Alignement de la boulangerie

- **Technique** : les écrans actuels passent sur les mêmes blocs, sans changement visible pour Ofauria ; recette par comparaison d'écran.

---

## Phase 5 — Achats et Qualité

### Étape 5.1 — Réception selon le profil

- **Technique** : réception avec contrôle et mise en quarantaine, réception sur chantier, réception à quai ; mêmes types de mouvement que l'étape 2.7.

### Étape 5.2 — Achats affectés

- **Technique** : affectation d'une ligne d'achat à un chantier, un ordre ou un véhicule (l'affectation à un projet existe : mig 390) ; sous-traitance comme ligne de service.

### Étape 5.3 — Plans de contrôle et non-conformités

- **Technique** : plan de contrôle par article ou par famille (points à vérifier, tolérances, taille d'échantillon) ; résultat lié au lot ; non-conformité avec décision (accepter, retoucher, refuser, retourner) ; le module Contrôle & Qualité existant sert de base.

---

## Phase 6 — Chantiers, Exploitation, Maintenance

### Étape 6.1 — Chantiers (bâtiment)

- **Technique** : le module Projets devient « Chantiers » par le vocabulaire ; ouvrages avec déboursé (matériaux, main-d'œuvre, engins, sous-traitance) ; avancement relié aux situations (étape 3.3) ; budget contre réalisé à partir des achats, du stock de chantier et du pointage.

### Étape 6.2 — Exploitation (transport)

- **Technique** : ordres de transport, tournées, affectation chauffeur et véhicule, étapes avec preuve de livraison (étape 3.4) ; les tournées de livraison existantes servent de base.

### Étape 6.3 — Flotte et maintenance

- **Technique** : véhicule et engin comme équipements du module Maintenance, avec compteur (kilomètres, heures), entretiens déclenchés par compteur ou par date, documents à échéance (assurance, visite technique).

---

## Phase 7 — Personnel, comptabilité, indicateurs, accueil

### Étape 7.1 — Pointage selon le profil

- **Technique** : pointage par chantier, par tournée ou par poste ; la paie ne change pas, seule l'imputation analytique change.

### Étape 7.2 — Contenu comptable par profil

- **Technique** : modèles d'écritures, centres de coût et axes analytiques livrés par le profil ; aucun moteur nouveau.

### Étape 7.3 — Indicateurs et accueil

- **Technique** : catalogue d'indicateurs, chacun rattaché à une capacité ; le tableau de bord de chaque module et l'accueil affichent ceux du profil, modifiables par rôle.

### Étape 7.4 — Éditeur de profils

- **Technique** : écran d'administration pour composer un profil (capacités, vocabulaire, référentiels, types de pièces, rôles, indicateurs), versionné (mig 697), avec simulation avant publication. C'est lui qui rend possible un nouveau secteur sans développeur.

---

## 5. Ce qui traverse toutes les phases

- **Tests** : un scénario de bout en bout par profil, enrichi à chaque phase ; les gardes d'architecture bloquent toute régression de la règle 1.
- **Performance** : configuration résolue une fois par session ; aucun calcul de profil dans les requêtes métier.
- **Sécurité** : la fermeture se fait côté serveur ; le menu n'est qu'un confort.
- **Intégrité** : éteindre ne supprime jamais ; une valeur utilisée par des données reste active.
- **Production** : chaque phase est déployable seule, sans effet pour Ofauria tant que rien n'est allumé.

## 6. Risques

| Risque | Parade |
|---|---|
| Fermer une route lue par un écran voisin | Inventaire 1.1, mode journal avant blocage |
| Multiplier les capacités jusqu'à l'illisible | Une capacité = un écran ou une règle visible ; regroupement dans l'assistant |
| Écrans génériques moins bons que les écrans dédiés | Blocs spécialisés autorisés ; l'assemblage est un moyen, pas une obligation |
| Contenu métier faux (taux, mentions, vocabulaire) | Validation par un professionnel de chaque secteur avant livraison du profil |
| Trois tables d'articles | Décision à l'étape 2.1, avant tout écran |

## 7. Décisions attendues

1. Ordre des profils après le socle : lequel sert de premier client réel hors boulangerie ?
2. Qui valide le contenu métier de chaque profil ?
3. Registre d'écrans dans le code (proposé) ou en table ?
4. Tables d'articles : vue commune ou convergence ?

## 8. Suivi d'avancement

Décisions prises selon la recommandation (mandat du 25 novembre 2026 : « tu enchaînes jusqu'à la fin… avec l'option recommandée ») : registre d'écrans dans le code ; tables d'articles laissées en place (décision 2.1 ci-dessous) ; profils pilotes BTP, transport, services pour les extinctions par défaut.

| Étape | État | Détail |
|---|---|---|
| 1.1 Inventaire | Fait | 49 familles hors garde : 15 du socle exemptées (justifiées dans `EXEMPT_PREFIXES`), 34 métier rattachées à leur module, liste des modules lecteurs comprise |
| 1.2 Fermeture des API | Fait | Table unique dans `module-activation.middleware.ts` ; test `route-activation-coverage-guard` : toute route montée a une règle ou une exemption |
| 1.3 Capacités tous modules | Fait | Mig 711 : 18 capacités (Ventes, Caisse, Achats, Comptabilité, Personnel), actives par défaut ; `sector_packs.off_features` pour les extinctions par profil |
| 1.4 Registre d'écrans | Fait | Registre partagé (`capability-screens.ts`) lu par 7 modules ; adresse directe refusée (« Fonction désactivée ») ; lectures croisées conditionnées. Contrôlé à l'écran : devis et abonnements éteints → menu, adresse et API fermés, puis rallumés |
| 1.5 Lecture unique | Fait | Serveur : seul `sector.repository` lit l'état d'activation (garde) ; écran : `PermissionsContext`, relu automatiquement après publication de l'assistant |
| 1.6 Gardes | Fait | Garde anti-secteur étendue aux 17 codes de profils ; garde de couverture des routes ; garde de lecture unique |
| 2.1 Audit Stock | Fait | Existant : quarantaine à la réception par article (mig 461), libération des lots, emplacements à rôles (mig 642), réservations commande (389) et matière. Décision : les trois tables d'articles restent en place (une convergence casserait 45 fichiers sans gain pour les profils) |
| 2.3 Statut de lot | Fait (partiel) | Les statuts existants portent déjà les comportements (seuls les lots `active` sont consommés et valorisés). Ajout : quarantaine imposée par la politique `purchasing.reception_quarantine`, active dans le profil Santé (mig 712) |
| 2.4 Lieux typés | Fait | Rôles « chantier » (lien `project_id`) et « quai » ; emplacements de départ des profils BTP et transport |
| 2.5 Stock déposant | Fait (modèle) | `ingredient_lots.owner_customer_id`, capacité `stock_deposant` (profil transport), exclu de la valorisation et de l'âge du stock. Reste : écran de réception pour compte de client (maquette Stock-Transport-Mouvement) |
| 2.2, 2.6, 2.7 | Reporté | Fiche par blocs, vue unique des réservations, écran de mouvement par type : refonte d'écrans existants, à faire sur maquette |
| 3.1 Audit Ventes | Fait | Existant : devis par sections (lots), `order_items.qty_delivered` (reste à livrer), preuve de livraison sur le bon de livraison (signature, réserves) |
| 3.2 Devis structuré | Existant | Sections du devis = lots ; lignes = ouvrages |
| 3.3 Situations de travaux | Fait | Mig 713 ; écran Ventes › Situations de travaux ; calcul partagé ; contrôlé à l'écran sur un marché de démonstration (supprimé ensuite). À valider par le métier : TVA calculée sur le net après retenue et avance (règle de la maquette) |
