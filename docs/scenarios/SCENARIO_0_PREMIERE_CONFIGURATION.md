# Scénario 0 — Première configuration (avant l'ouverture)

État de départ, lu dans la base de développement le 2026-11-19 : installation neuve.
0 produit, 0 ingrédient, 0 fournisseur, 0 salarié, 0 atelier, 1 seul administrateur actif.
Faites le 2026-11-19 : étapes 4 (catégories de vente), 10 (fonctions), 11 (rôles), 12 (ateliers)
13 (employés, données fictives) et 14 (comptes). Restent : 1 (société) et 3 (établissements),
qui demandent des données réelles, puis le contrôle final (15). Les écrans n'ont pas été parcourus dans le navigateur.

## 1. Déroulé

| # | Agent | Écran | Action | État de départ |
|---|---|---|---|---|
| 1 | Administrateur | Paramètres › Société | Vérifier la raison sociale, saisir ICE, IF, RC, CNSS et le compte bancaire | Raison sociale présente, 0 compte bancaire |
| 2 | Administrateur | Paramètres › Secteur et modules | Confirmer le secteur et les modules actifs | Secteur « boulangerie » déjà choisi |
| 3 | Administrateur | Paramètres › Établissements | Renommer « Magasin principal », ajouter le laboratoire et l'économat, désigner le siège | 1 établissement, pas de siège |
| 4 | Administrateur | Paramètres › Catégories de vente | Créer Pain, Viennoiserie, Pâtisserie, Beldi, Salé / Traiteur, Boissons | Fait : 6 catégories, sans famille |
| 5 | Administrateur | Référentiel › Catégories de dépenses | Relire l'arbre, désactiver ce qui ne sert pas | 11 catégories racines, 122 lignes |
| 6 | Administrateur | Référentiel › Catégories de revenus | Vérifier Ventes directes, Commandes, Autres revenus | 3 racines |
| 7 | Administrateur, avec l'Économe | Référentiel › Familles de matières premières | Relire les 26 familles, trancher les écarts du § 4 | Titre renommé (migration 612) |
| 8 | Administrateur, avec l'Économe | Référentiel › Emballages, Unités, Contenants | Vérifier les listes | 5 familles, 12 unités, 10 contenants |
| 9 | Administrateur | Paramètres › TVA, Canaux de vente, Modes de paiement, Numérotation | Vérifier les valeurs livrées | 6 taux, 5 canaux, 8 modes |
| 10 | Administrateur | Référentiel › Fonctions des employés | Ajouter Économe, Responsable des achats, Commercial, Chef Beldi, Chef Salé | Fait : 13 fonctions |
| 11 | Administrateur | Utilisateurs et droits › Rôles | Vérifier les 5 rôles du § 2, ajuster leurs droits au besoin | 9 rôles livrés + 5 créés le 2026-11-19 |
| 12 | Administrateur | Paramètres › Production › Ateliers | Créer les 5 ateliers du § 3 et leur rattacher catégories et rôles | Fait : 5 ateliers, Boulangerie par défaut |
| 13 | Gérant | Personnel › Employés | Créer les 12 fiches : contrat, salaire, rythme de paie | Fait : 12 fiches fictives (§ 3 bis) |
| 14 | Administrateur | Utilisateurs et droits › Utilisateurs | Créer un compte par employé et lui donner son ou ses rôles | Fait : 12 comptes reliés à leur fiche (§ 3 ter) |
| 15 | Administrateur | Paramètres › Vue d'ensemble | Contrôler l'avancement du paramétrage | Relevé le 2026-11-19 : 7 points obligatoires sur 11 (§ 6) |

Décision du 2026-11-19 : le paramétrage est fait par l'**administrateur**. Le gérant n'a pas
accès aux Paramètres ni aux Utilisateurs ; il garde l'étape 13 (Personnel). L'économe est
consulté pour les familles de matières premières et les emballages, sans y avoir accès.

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
| Responsable des achats | `resp_achats` | Gérant | Achats ; stock et emballages en lecture ; saisie et contrôle des factures reçues | 107 sur les 581 du gérant |
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

## 3. Ateliers créés

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

## 3 bis. Employés créés (données fictives)

Tous en CDI, déclarés, payés au mois, embauchés le 2026-11-02, sans période d'essai,
rattachés à l'établissement principal. Chaque fiche porte la note « Donnée fictive —
scénario 0 ». Masse salariale brute : 81 000 DH par mois.

| Agent du scénario | Employé | Fonction | Salaire mensuel brut |
|---|---|---|---|
| Gérant | Karim Bennani | Gérant | 12 000 DH |
| Chef Pâtissier | Nadia Berrada | Pâtissier | 9 000 DH |
| Responsable des achats | Youssef Tazi | Responsable des achats | 8 000 DH |
| Chef Tourier / Viennoiserie | Mehdi Alaoui | Viennoiserie | 7 500 DH |
| Commercial | Salma El Idrissi | Commercial | 7 000 DH |
| Chef Beldi | Fatima Zahra Chraibi | Chef Beldi | 6 500 DH |
| Chef Salé / Traiteur | Omar Kettani | Chef Salé | 6 500 DH |
| Boulanger (nuit) | Abdelilah Saidi | Boulanger | 6 000 DH |
| Boulanger (matin) | Rachid Amrani | Boulanger | 5 500 DH |
| Économe | Hassan Ouazzani | Économe | 5 000 DH |
| Caissier 1 | Imane Fassi | Caissier | 4 000 DH |
| Caissier 2 | Hamza Belkadi | Caissier | 4 000 DH |

Non renseignés : CIN, numéro CNSS, RIB, date de naissance, personnes à charge, poste
horaire. Le contrôle du SMIG reste inactif tant que ses montants ne sont pas saisis dans
les paramètres de paie.

## 3 ter. Comptes utilisateurs créés (base locale uniquement)

Créés par `server/scripts/seed-scenario0-accounts.ts` (à relancer sur une base remise à
neuf, après les rôles et les fiches employés). Adresse : `prenom.nom@kalum.local`. Le mot
de passe de test est celui noté en tête de ce script. Les deux caissiers ont en plus un code
PIN de caisse, noté au même endroit.

| Compte | Rôle |
|---|---|
| karim.bennani | Gérant |
| salma.el-idrissi | Commercial |
| youssef.tazi | Responsable des achats |
| hassan.ouazzani | Économe |
| nadia.berrada | Pâtissier |
| mehdi.alaoui | Viennoiserie |
| fatima-zahra.chraibi | Chef Beldi |
| omar.kettani | Chef Salé |
| rachid.amrani, abdelilah.saidi | Boulanger |
| imane.fassi, hamza.belkadi | Caissier |

Chaque compte a un seul rôle. Pour tester le cumul, ajouter « Chef Salé » au compte de
Fatima Zahra Chraibi (ou l'inverse) dans Utilisateurs et droits.

## 4. Familles de matières premières — écarts à trancher

| Constat | Détail |
|---|---|
| Deux listes en parallèle | Le référentiel compte 26 lignes ; l'arbre des dépenses en compte 28 sous *Matières premières › Ingrédients*. |
| Écart entre les deux | « Fruits » et « Fruits secs » n'existent que dans l'arbre, et y sont inactifs. |
| Nœud parent inactif | « Ingrédients » (niveau 2) est inactif alors que 24 de ses familles sont actives. Effet sur le sélecteur de la fiche ingrédient non vérifié. |
| Libellés sans accents | « Epices & aromes », « Oeufs ». |

Trois titres de référentiel restent sans accents : « Categories de depenses »,
« Categories emballages », « Motifs d absence ».

## 5. Vérification dans l'application (2026-11-19)

Connexion réelle sur l'application locale avec six comptes. Lecture des écrans seulement,
aucune saisie. Non testés : boulangers, pâtissier, viennoiserie, Chef Salé, second caissier.

| Compte | Résultat |
|---|---|
| Gérant | Connexion par e-mail. Voit Ventes, Achats, Stock, Production, Personnel (12 employés, répartition par poste correcte). **N'a pas accès aux Paramètres.** |
| Chef Beldi | Voit Stock et Production. L'application lui attribue l'atelier Beldi et lui seul. |
| Caissière | Sa tuile apparaît à l'écran de connexion ; le code PIN ouvre la caisse sur « Caisse fermée — Ouvrir la caisse ». |
| Responsable des achats | Voit Achats et Stock ; le poste de travail Achats se charge. **Les factures reçues lui sont refusées.** |
| Commercial | Voit Ventes, Commandes, Clients ; Promotions et CRM se chargent sans refus. |
| Économe | Voit Stock et Production (demandes boutique). |

Points relevés :

1. **Paramètres réservés à l'administrateur.** Le gérant reçoit « Vous n'avez pas accès aux
   paramètres ». Décision : le paramétrage reste à l'administrateur (§ 1 mis à jour).
2. **Factures reçues.** Elles sont protégées par le droit de consultation de la
   comptabilité (`accounting.view`). Décision : ce droit est donné au Responsable des
   achats, avec la saisie d'une facture (lignes, catégorie, conditions de paiement), la
   pièce jointe, l'ouverture d'un litige et le blocage du paiement. Il ne valide pas,
   n'annule pas, ne supprime pas et ne paie pas. Revérifié dans l'application : l'écran
   Factures reçues s'ouvre, la saisie est acceptée par le contrôle des droits, la
   validation est refusée. Le droit de saisie couvre aussi les factures clients.
3. **« Approvisionnement » = demandes de la boutique à la production**, pas les achats.
   Décision : droit retiré au Responsable des achats ; la tuile Production a disparu de son
   accueil, et l'étape « À commander » des achats fonctionne toujours.
4. **Écran Utilisateurs chez le gérant** : la page s'affiche avec « 0 compte, aucun
   utilisateur » au lieu d'un refus d'accès.
5. **Personnel › Pilotage** : « rotation 550 % » sur une base où les 12 employés viennent
   d'entrer ; libellés sans accents « Gerant », « Patissier ».

## 6. Avancement du paramétrage (étape 15, relevé du 2026-11-19)

Calculé par l'application (le même contrôle que Paramètres › Vue d'ensemble) :
7 points obligatoires faits sur 11.

| Point | État | Ce qui manque |
|---|---|---|
| Compte bancaire | À faire | Aucun RIB : il ne figure pas sur les factures |
| Établissements | À compléter | Adresse et téléphone ; aucun siège désigné |
| Charges fixes de production | À faire | Loyer et énergie : les coûts de revient sont calculés sans eux |
| Fournisseurs et produits | À faire | Objet du scénario 1 |
| Logo | Conseillé | Les documents partent sans logo |
| Contrôle des droits | Conseillé | En observation : un accès hors droits est tracé, pas bloqué |

Faits : identité légale, canaux de vente, TVA, numérotation, mentions des factures,
catégories, comptes utilisateurs (13 actifs, 1 administrateur), ticket de caisse, sachets,
majoration, règles d'achat, passation des écritures.

## 7. Suite

Le scénario 1 est détaillé dans `SCENARIO_1_DONNEES_DE_BASE.md` (224 cas : nominaux,
variantes, limites, erreurs, droits). Résumé de l'ordre :

| # | Agent | Action |
|---|---|---|
| 1 | Responsable des achats | Créer les fournisseurs (farine, beurre et produits laitiers, œufs, chocolat et fruits secs, emballages, boissons) |
| 2 | Économe | Créer les matières premières et les emballages : famille, unité, contenant, coût |
| 3 | Chaque chef | Créer ses produits et leur prix de vente |
| 4 | Chaque chef | Rédiger la fiche technique de chaque produit : ingrédients, grammages, rendement, étapes |
| 5 | Administrateur | Saisir les charges fixes de production |
| 6 | Responsable des achats, Économe | Premier bon de commande, réception, stock initial |
| 7 | Administrateur, Caissier | Fond de caisse, première ouverture de caisse |

