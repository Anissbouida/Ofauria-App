# Scénario 0 — Première configuration (avant l'ouverture)

État de départ, lu dans la base de développement le 2026-11-19 : installation neuve.
0 produit, 0 ingrédient, 0 fournisseur, 0 salarié, 0 atelier, 1 seul administrateur actif.
Les 5 rôles du § 2 ont été créés le 2026-11-19 (étape 11 faite). Les écrans n'ont pas été parcourus dans le navigateur.

## 1. Déroulé

| # | Agent | Écran | Action | État de départ |
|---|---|---|---|---|
| 1 | Gérant | Paramètres › Société | Vérifier la raison sociale, saisir ICE, IF, RC, CNSS et le compte bancaire | Raison sociale présente, 0 compte bancaire |
| 2 | Gérant | Paramètres › Secteur et modules | Confirmer le secteur et les modules actifs | Secteur « boulangerie » déjà choisi |
| 3 | Gérant | Paramètres › Établissements | Renommer « Magasin principal », ajouter le laboratoire et l'économat, désigner le siège | 1 établissement, pas de siège |
| 4 | Gérant | Paramètres › Catégories de vente | Créer Pain, Viennoiserie, Pâtisserie, Beldi, Salé / Traiteur, Boissons | 0 catégorie |
| 5 | Gérant | Référentiel › Catégories de dépenses | Relire l'arbre, désactiver ce qui ne sert pas | 11 catégories racines, 122 lignes |
| 6 | Gérant | Référentiel › Catégories de revenus | Vérifier Ventes directes, Commandes, Autres revenus | 3 racines |
| 7 | Économe | Référentiel › Familles de matières premières | Relire les 26 familles, trancher les écarts du § 4 | Titre renommé (migration 612) |
| 8 | Économe | Référentiel › Emballages, Unités, Contenants | Vérifier les listes | 5 familles, 12 unités, 10 contenants |
| 9 | Gérant | Paramètres › TVA, Canaux de vente, Modes de paiement, Numérotation | Vérifier les valeurs livrées | 6 taux, 5 canaux, 8 modes |
| 10 | Gérant | Référentiel › Fonctions des employés | Ajouter Économe, Responsable des achats, Commercial, Chef Beldi, Chef Salé | 8 fonctions, dont « Beldi & Sale » en une seule |
| 11 | Gérant | Utilisateurs et droits › Rôles | Vérifier les 5 rôles du § 2, ajuster leurs droits au besoin | 9 rôles livrés + 5 créés le 2026-11-19 |
| 12 | Gérant | Paramètres › Production › Ateliers | Créer les 5 ateliers du § 3 et leur rattacher catégories et rôles | 0 atelier |
| 13 | Gérant | Personnel › Employés | Créer les 12 fiches : contrat, salaire, rythme de paie | 0 salarié |
| 14 | Gérant | Utilisateurs et droits › Utilisateurs | Créer un compte par employé et lui donner son ou ses rôles | 1 administrateur |
| 15 | Gérant | Paramètres › Vue d'ensemble | Contrôler l'avancement du paramétrage | Non consulté |

Ordre imposé : les catégories de vente (4) avant les ateliers (12), les rôles (11) avant
les ateliers (12) et les comptes (14), les employés (13) avant les comptes (14).

## 2. Rôles créés (décisions du 2026-11-19)

L'application livre 9 rôles : Administrateur, Gérant, Caissier, Vendeuse, Boulanger,
Pâtissier, Viennoiserie, Beldi & Salé, Magasinier. Un rôle personnalisé se crée à partir
d'un rôle livré (son « rôle de base ») dont il copie les droits ; on les réduit ensuite.

| Rôle | Code | Rôle de base | Modules | Actions autorisées |
|---|---|---|---|---|
| Économe | `econome` | Magasinier | Stock, approvisionnement, emballages | 44, comme le magasinier |
| Chef Beldi | `chef_beldi` | Beldi & Salé | Stock, fiches techniques, production, approvisionnement, emballages | 82, comme Beldi & Salé |
| Chef Salé | `chef_sale` | Beldi & Salé | Stock, fiches techniques, production, approvisionnement, emballages | 82, comme Beldi & Salé |
| Responsable des achats | `resp_achats` | Gérant | Achats, approvisionnement ; stock et emballages en lecture | 108 sur les 581 du gérant |
| Commercial | `commercial` | Gérant | Ventes, commandes, clients, CRM ; produits en lecture | 84 sur les 581 du gérant |

Actions laissées au gérant et retirées au Commercial : encaissement et annulation de vente,
facturation, import, annulation et facturation de bon de livraison, relances clients (sauf
consultation), règlement et annulation de ristournes, mise à jour en masse et suppression
de tarifs, ajustement de points de fidélité, retours professionnels, transferts de
produits, génération d'abonnements, suppression et anonymisation de client, exonérations
de TVA, suppression de commande et facture d'acompte. Tout se modifie dans
Utilisateurs et droits › Rôles.

Point à connaître : quand une version ajoute une action réservée au gérant, l'application
la donne aussi aux rôles dont le rôle de base est « Gérant ». Après chaque mise à jour,
relire les droits de `resp_achats` et de `commercial`.

Règles retenues :

- **Économe** : son propre rôle, distinct du magasinier.
- **Chef Beldi et Chef Salé** : deux rôles séparés. Une même personne peut porter les
  deux (un compte accepte plusieurs rôles, ses droits sont l'union des deux), ou chaque
  rôle peut aller à une personne différente.
- **Responsable des achats** et **Commercial** : un rôle chacun. Leur rôle de base est
  « Gérant » parce que c'est le seul rôle livré, hors administrateur, qui ouvre les
  achats et les ventes ; les autres modules leur ont été retirés à la création.
- Le rôle livré « Beldi & Salé » reste dans la liste : un rôle livré ne se supprime pas
  et ne se désactive pas. Il sert de rôle de base aux deux nouveaux et ne s'attribue plus.

## 3. Ateliers à créer

| Atelier | Catégories de vente | Rôle membre |
|---|---|---|
| Boulangerie | Pain | Boulanger |
| Viennoiserie | Viennoiserie | Viennoiserie |
| Pâtisserie | Pâtisserie | Pâtissier |
| Beldi | Beldi | Chef Beldi |
| Salé / Traiteur | Salé / Traiteur | Chef Salé |

Test du 2026-11-19 (transactions annulées, rien gardé en base). Avant correction, un
atelier dont le membre était un rôle créé ne reconnaissait personne : la session ne porte
que les rôles de base. `workshopsOf` (`server/src/services/workshops.ts`) lit maintenant
aussi les rôles réellement attribués. Résultat après correction :

| Compte | Rôles | Ateliers obtenus |
|---|---|---|
| Chef Beldi seul | Chef Beldi | Beldi |
| Chef Salé seul | Chef Salé | Salé / Traiteur |
| Cumul | Chef Beldi + Chef Salé | Beldi et Salé / Traiteur |
| Économe | Économe | aucun |

Ne pas déclarer le rôle livré « Beldi & Salé » comme membre d'un de ces deux ateliers :
il couvre les rôles créés à partir de lui, donc les deux chefs verraient les deux ateliers.

## 4. Familles de matières premières — écarts à trancher

| Constat | Détail |
|---|---|
| Deux listes en parallèle | Le référentiel compte 26 lignes ; l'arbre des dépenses en compte 28 sous *Matières premières › Ingrédients*. |
| Écart entre les deux | « Fruits » et « Fruits secs » n'existent que dans l'arbre, et y sont inactifs. |
| Nœud parent inactif | « Ingrédients » (niveau 2) est inactif alors que 24 de ses familles sont actives. Effet sur le sélecteur de la fiche ingrédient non vérifié. |
| Libellés sans accents | « Epices & aromes », « Oeufs ». |

Trois titres de référentiel restent sans accents : « Categories de depenses »,
« Categories emballages », « Motifs d absence ».

## 5. Suite

Le scénario 1 couvrira les données de base : fournisseurs, ingrédients, produits, fiches
techniques, stock initial et fond de caisse.
