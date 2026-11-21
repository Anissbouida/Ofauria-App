# Scénario 1 — Rapport d'exécution

Les cas sont décrits dans `SCENARIO_1_DONNEES_DE_BASE.md`. Ce rapport consigne leur
résultat, partie par partie.

- **Mode :** par les écrans, sur l'application locale (base de développement).
- **Données :** fictives, sauf les charges fixes (montants réels).
- **Statuts :** conforme, écart (ça marche, mais pas comme attendu), bloquant, non joué,
  sans objet.

## Avancement

| Partie | Cas | Joués | Conformes | Écarts | Sans objet | Non joués |
|---|---|---|---|---|---|---|
| E. Paramétrage de la production | 8 | 6 | 4 | 2 | 0 | 2 |
| A. Fournisseurs | 17 | 11 | 8 | 3 | 1 | 5 |
| B. Matières premières et emballages | 23 | 16 | 12 | 4 | 0 | 7 |
| C. Produits | 24 | 21 | 9 | 12 | 0 | 3 |
| D. Fiches techniques | 46 | 45 | 31 | 14 | 0 | 1 |
| F. Premier approvisionnement | 58 | 54 | 34 | 20 | 2 | 2 |
| G. Tenue du stock | 14 | 12 | 8 | 4 | 0 | 2 |
| H. Caisse | 11 | 10 | 8 | 2 | 0 | 1 |
| I. Contrôles de fin de scénario | 10 | 8 | 4 | 4 | 0 | 2 |
| T. Cas transverses | 13 | 13 | 13 | 0 | 0 | 0 |

## Partie E — Paramétrage de la production (2026-11-19)

| ID | Statut | Constat |
|---|---|---|
| E-01 | Conforme | Loyer 22 000 DH ; énergie 14 000 DH (électricité 12 000 + gaz 500 + eau 1 500) ; mode « charges mensuelles ». La vue d'ensemble affiche « 36 000 DH par mois répartis dans les coûts ». **Enregistré par le service de l'application, pas par l'écran** : cet écran est réservé à l'administrateur, dont je n'ai pas le compte. |

Le mode de calcul était « taux sur les matières ». Il est passé à « charges mensuelles »,
sans quoi les montants saisis n'auraient pas été utilisés.

## Partie A — Fournisseurs (2026-11-19, compte du Responsable des achats)

| ID | Statut | Constat |
|---|---|---|
| A-01 | Écart | Minoterie Atlas créée et listée ; ICE et IF contrôlés à la saisie (« Format valide »). **Aucun délai de paiement ne se saisit sur la fiche fournisseur.** |
| A-02 | Conforme | Laiterie du Gharb, Comptoir Cacao et Fruits secs, Épicerie de gros Al Baraka, Emballages du Nord, Rif Boissons Distribution créés. |
| A-03 | Conforme | Ferme avicole Zerhoun créée avec le type « Commerçant / marché » : les identifiants fiscaux deviennent facultatifs. |
| A-04 | Écart | Pâtisserie Import Lyon créée en euros (« Proposée sur ses BC et devis ; le stock reste valorisé en DH »). L'ICE et l'IF restent marqués obligatoires pour un fournisseur étranger ; l'enregistrement passe avec l'avertissement « ICE à compléter ». Pas de pays demandé dans le formulaire principal. |
| A-05 | Conforme | Froid et Fours Équipement créé comme une entreprise ordinaire. |
| A-06 | Conforme | Même nom : « Un fournisseur porte déjà ce nom ». Même ICE sous un autre nom : refus, avec le panneau « Doublon probable » qui nomme la fiche existante. |
| A-07 | Conforme | ICE de 10 chiffres : « Identifiant ICE invalide », avec le compteur « 10/15 chiffres ». |
| A-08 | Écart | Nom vide : refusé, mais par le message du navigateur, en anglais (« Please fill out this field. »). |
| A-09 | Non joué | Attend les matières premières (partie B). |
| A-10 | Non joué | Attend les matières premières (partie B). |
| A-11 | Sans objet | Pas de délai de paiement sur la fiche fournisseur (voir A-01). |
| A-12 | Non joué | |
| A-13 | Non joué | Attend une première commande (partie F). |
| A-14 | Non joué | |
| A-15 | Conforme | Le Commercial ne peut ni voir ni créer un fournisseur. Vérifié par le contrôle des droits, pas par l'écran. |
| A-16 | Conforme | L'Économe peut voir les fournisseurs, pas en créer. Vérifié par le contrôle des droits, pas par l'écran (son mot de passe a été changé). |
| A-17 | Conforme | « Société d'Épices & Cie — شركة التوابل » créée et affichée sans altération. PDF non testé. |

État en base après la partie A : 10 fournisseurs actifs (les 9 du jeu de données et celui
du cas A-17).

## Partie B — Matières premières et emballages (2026-11-19, compte du Gérant)

Jouée avec le compte du gérant : le mot de passe de l'économe a été changé, je ne peux
plus me connecter avec son compte. **La partie est arrêtée au premier cas.**

| ID | Statut | Constat |
|---|---|---|
| B-01 | Bloquant | Formulaire « Nouvel ingrédient » ouvert (Stock › Réserve › Nouveau). La catégorie est obligatoire, mais la liste est vide : « Aucun résultat », même sans texte de recherche. Aucune matière ne peut être créée. Rien n'a été enregistré. |
| B-06 | Écart | Coût saisi « 5,5 » : le champ affiche « 55 ». La virgule est avalée sans avertissement. Le navigateur de test est en anglais ; à revérifier sur un navigateur en français. |
| B-02 à B-05, B-07 à B-23 | Non joués | En attente du déblocage de B-01. |

Cause du blocage, lue dans le journal des modifications : le 2026-11-19 entre 14 h 33 et
14 h 39 (heure du serveur), les sous-catégories de dépenses ont été désactivées une à une
dans le référentiel, dont « Ingrédients », « Matériel cuisine », « Petit matériel » et
« Informatique & POS ». Les 24 familles de matières ont été réactivées ensuite, mais pas
leur parent « Ingrédients ». Le formulaire ne retrouve donc plus les familles : elles
existent, mais sous un parent inactif.

Second blocage, pour l'économe : la liste des catégories se lit avec le droit de
consultation des catégories de dépenses (`accounting.expense_categories.view`). L'économe
et les chefs ne l'ont pas ; le gérant l'a. Même après réactivation, l'économe verrait
donc une liste vide.

À relever aussi sur le formulaire : il ne propose ni seuil d'alerte, ni densité, ni poids
par pièce, ni DLC. Ces champs sont à chercher sur la fiche après création (cas B-03,
B-04, B-23).

### Déblocage : refonte des catégories de dépenses (2026-11-19, sur décision)

Décision : garder les 11 catégories, leur donner les bonnes sous-catégories, et aligner
les noms sur les termes des ERP. Les noms suivent le plan comptable marocain.

| Catégorie (ancien nom) | Sous-catégories actives |
|---|---|
| Matières premières | Matières premières alimentaires (ex-« Ingrédients », porte les 24 familles), Marchandises (revente en l'état) |
| Énergie et fluides (Énergie) | Électricité, Eau, Gaz |
| Charges de personnel | Rémunérations du personnel, Primes et indemnités, Charges sociales, Avantages et frais du personnel, Règlement CNSS et AMO, Règlement IR sur salaires, Règlement CIMR |
| Frais généraux et administratifs (Frais administratifs) | Fournitures de bureau, Frais postaux et télécommunications, Honoraires et prestations, Primes d'assurance, Services bancaires, Impôts et taxes, Abonnements et logiciels |
| Entretien et réparations (Entretien & Maintenance) | Réparations et dépannages, Maintenance préventive, Contrats de maintenance, Nettoyage et hygiène |
| Locations et charges locatives (Loyer & Charges) | Loyers, Charges locatives, Locations de matériel |
| Transports et déplacements (Transport) | Transport sur achats, Douane et transit, Livraisons et fret, Carburants, Déplacements et missions |
| Petit matériel et outillage (Équipements & Matériel) | Petit outillage, Ustensiles et matériel de laboratoire, Fournitures informatiques et de caisse, Vêtements de travail |
| Emballages | Boîtes, Sacs et sachets, Étiquettes, Papiers et films alimentaires, Ficelles et rubans, Barquettes et plateaux |
| Immobilisations | Matériel et outillage, Matériel de transport, Mobilier, Matériel informatique et de caisse, Agencements et aménagements |
| Charges diverses (Divers) | Publicité et marketing, Réceptions et frais de représentation, Emprunts et charges financières, Dons et cotisations, Autres charges diverses |

- 51 sous-catégories actives : 32 anciennes renommées ou réactivées (leur identifiant est
  utilisé par l'application et, pour certaines, relié à un compte), 19 nouvelles.
- Familles de matières : « Oeufs » devient « Œufs », « Epices & aromes » devient « Épices
  et arômes ».
- Anciennes sous-catégories non reprises : « Assurances » (sous Loyer), « Charges
  sociales » et « Frais généraux » (sous Frais administratifs), et les 52 anciens types de
  détail. **Elles restent désactivées, pas effacées** : l'application ne sait que
  désactiver une catégorie.
- Comptes : 5 sous-catégories ont reçu leur compte propre (6174, 6147, 6167, 6144, 6311).
  Les autres héritent du compte de leur catégorie ; le plan comptable installé n'a pas de
  compte pour les marchandises (6111), les assurances (6134), les honoraires (6136) ni
  les télécommunications (6145).
- L'économe a reçu le droit de lire les catégories, sans lequel sa liste restait vide.
- Vérifié dans l'application avec le compte du gérant : le formulaire « Nouvel
  ingrédient » propose de nouveau les familles (Farines, Sucres…). **B-01 est débloqué.**

### Reprise de la partie B après déblocage (2026-11-19, compte du Gérant)

| ID | Statut | Constat |
|---|---|---|
| B-01 | Conforme | Farine T55 créée : famille Farines, fournisseur Minoterie Atlas, sac de 25 kg (« 1 sac = 25 kg — commandes et transferts vers le pesage se feront par sac entier »), allergène gluten. Message « Ingrédient ajouté ». Le seuil d'alerte ne se saisit pas à la création. |
| B-02 | Conforme | Les 36 matières du jeu de données sont créées par l'écran, une par une, chacune avec sa famille, son fournisseur habituel et ses allergènes. Contrôle en base : 37 fiches (36 + le doublon), aucune sans famille, 17 familles utilisées. Le jeu compte 36 matières et non 34 : le scénario est corrigé. |
| B-03 | Conforme | Lait entier au litre : le champ « Masse volumique (kg/L) » apparaît dès qu'on choisit le litre ; 1,03 enregistré. Brique de 1 L. La conversion dans une fiche reste à vérifier (partie D). |
| B-04 | Conforme | Œufs frais à la pièce : le champ « Poids d'une pièce (kg) » apparaît ; 0,055 enregistré, caisse de 30. L'aide ne parle que de la répartition des frais d'approche : l'usage en grammes dans une fiche reste à vérifier (partie D). |
| B-09 | Écart | « beurre DOUX » suivi d'un espace : créé sans avertissement sous le nom « Beurre DOUX », à côté de « Beurre doux ». Le doublon n'est pas détecté à la création. |
| B-11 | Conforme | Allergènes cochés à la création : gluten (farine), lait (lait, beurre), œufs. |
| B-15 | Écart | Coût de −5 : refusé par le serveur, mais **aucun message à l'écran**. Le formulaire reste ouvert sans explication ; la réponse du serveur est « Erreur lors de la création », sans motif. |

État en base : 37 matières, dont le doublon « Beurre DOUX » gardé pour le cas de fusion B-10.

À noter : la fiche « Sucre semoule », créée à 7,50 DH, a été modifiée ensuite depuis une autre session (coût 6,00 DH, contenant de 18). Ce n'est pas une anomalie de l'application.

### Fin de la partie B (2026-11-19, compte du Gérant)

| ID | Statut | Constat |
|---|---|---|
| B-12 | Conforme | Création sans famille : « Choisissez une catégorie. » sous le champ, et « Complétez les champs signalés. » en bas du formulaire. |
| B-13 | Conforme | La famille désactivée « Fruits secs » n'est pas proposée : « Aucun résultat ». |
| B-14 | Écart | « Colorant rouge » créé sans coût : accepté, « Ingrédient ajouté », sans aucun avertissement. La fiche est gardée pour tester une fiche technique au coût incomplet (D-12). |
| B-16 | Conforme | Les 7 emballages sont créés dans Stock › Consommables : catégorie Emballages, puis sous-catégorie (Boîtes, Sacs et sachets, Étiquettes, Papiers et films alimentaires, Ficelles et rubans), format, coût, fournisseur Emballages du Nord. Ils apparaissent « en rupture », à réapprovisionner. Les nouveaux noms de catégories sont bien repris. |
| B-20 | Conforme | L'Économe peut consulter et créer une matière ; il ne peut ni la modifier ni la supprimer. Vérifié par le contrôle des droits, pas par l'écran. |
| B-21 | Conforme | Un chef ne peut pas modifier une matière. Vérifié par le contrôle des droits. |
| B-22 | Conforme | Le Responsable des achats consulte les matières sans pouvoir les modifier. Vérifié par le contrôle des droits. |
| B-23 | Conforme | Stock › Points de commande : point de commande de Farine T55 mis à 50 kg ; enregistré dès la sortie du champ et relu par la liste. |
| B-10 | Non joué | Le doublon « Beurre DOUX » a été supprimé depuis une autre session ; il n'y a plus de doublon à fusionner. |
| B-05, B-07, B-08 | Non joués | Ils se vérifient dans une fiche technique : reportés à la partie D. |
| B-17, B-18, B-19 | Non joués | |

État en base à la fin de la partie B : 37 matières (les 36 du jeu et « Colorant rouge »), 7 emballages.

## Parties C et D — Produits et fiches techniques (2026-11-19, compte du Chef Beldi)

Les deux parties sont arrêtées dès le premier cas, par trois blocages en chaîne.

| ID | Statut | Constat |
|---|---|---|
| C-21 | Bloquant | Le chef ouvre Produits › Catalogue (par l'adresse, il n'a pas de menu) et le formulaire « Nouveau produit ». Pour un produit « Fabriqué », une recette est obligatoire : « Aucune recette disponible — Créez d'abord une recette ». **La fiche technique doit donc exister avant le produit** : l'ordre du scénario (C avant D) est faux. Seul un produit « Revente » se crée sans recette. |
| D-34 | Bloquant | Le chef crée la fiche « Cornes de gazelle » : la création ne demande que le type, le nom, la catégorie de production et le mode de saisie. Message « Recette créée — complète la composition ». Toute la composition (formats, ingrédients, étapes) se saisit **après**, sur la page de la fiche. Or la règle décidée retire au chef toute modification après création : il ne peut créer qu'une fiche vide. |

Trois blocages :

1. **La règle « le chef ne modifie plus après création » empêche le chef de composer.**
   L'application crée toujours la fiche vide, puis la fait composer. Il n'existe pas de
   création « en une fois » à l'écran.
2. **Aucun format de production n'existe.** La composition se fait « par format
   (contenant) » ; la liste des contenants est vide (ils ont été retirés avec les données
   de départ). Sans format, personne ne peut composer une fiche, gérant compris.
3. **Aucune catégorie de production n'existe** : la recherche « Beldi » ne renvoie rien.
   Le champ est facultatif.

Piste sans développement pour le premier blocage : l'application a déjà un circuit de
versions. Les modifications d'une fiche ne s'appliquent à la production qu'une fois une
version **activée**, et ce droit (`recipes.bom_versions`) n'appartient qu'au gérant. On
peut donc rendre la composition aux chefs : ils préparent, le gérant valide en activant
la version, et ce qui est validé ne change plus sans lui.

État en base : une fiche vide « Cornes de gazelle », aucun produit.

### Déblocage et première fiche composée (2026-11-19, par les écrans)

Décision : les chefs composent leurs fiches ; le gérant valide en activant la version et
garde les frais, la restauration et la suppression. Droits rendus aux six rôles de chef :
composition, étapes, formats, poids, duplication. Ce réglage de rôle a été fait par le
service de l'application, l'écran des rôles étant réservé à l'administrateur.

| ID | Statut | Constat |
|---|---|---|
| — | Écart | Le chef ouvre « Créer un format » (Fiches techniques › Formats de production), remplit le formulaire, et reçoit « Erreur lors de l'enregistrement » : la création d'un format demande un droit qu'il n'a pas, et l'écran ne le dit pas. Le format « Plaque beldi 60 pièces » (60 pièces, 2 perdues, 58 nettes, 1,5 kg) est créé avec le compte du gérant. |
| D-34 | Conforme | Le chef ajoute le format à sa fiche (« Format ajouté », rendement 60), puis 7 ingrédients : Farine T55 500 g, Beurre doux 150 g, Eau de fleur d'oranger 50 ml, Poudre d'amande 1 000 g, Sucre glace 400 g, Cannelle 5 g, Œufs frais 2 pièces. Total 155,10 DH par fournée, 2,59 DH de matière par pièce. Contrôlé après rechargement. |
| D-15 | Conforme | Les allergènes de la fiche sont déduits des matières : fruits à coque, gluten, lait, œufs. |
| B-08 | Conforme | 5 g de cannelle à 80 DH/kg donnent 0,40 DH, sans arrondi à zéro. |
| — | Conforme | 50 ml d'une matière stockée au litre donnent 2,00 DH : la conversion de volume est juste. |
| B-04 / D-13 | Écart | 110 g d'œufs, matière stockée à la pièce avec un poids de 55 g : le coût affiché est 132,00 DH (110 × 1,20 DH), au lieu de 2,40 DH (2 œufs). **Le poids par pièce n'est pas utilisé pour convertir des grammes en pièces** ; seul un petit triangle d'avertissement s'affiche, sans explication lisible. La ligne a été corrigée en « 2 pièces ». |
| — | Écart | Le bouton « Enregistrer » enregistre à la fois la composition et les paramètres financiers. Pour le chef, la composition est sauvegardée mais l'écran affiche « Accès interdit » (paramètres financiers réservés au gérant) et « Modifications non enregistrées » : il ne sait pas ce qui a été gardé. |
| — | Constat levé | Le constat n° 15 tombe : le chef voit bien la liste des matières dans la composition. |

État en base : 1 format de production, 1 fiche composée « Cornes de gazelle » (version
non encore activée), aucun produit.

### Validation par le gérant et premier produit (2026-11-19, par les écrans)

| ID | Statut | Constat |
|---|---|---|
| D-07 | Conforme | Le gérant ouvre « Voir les modifications », saisit le motif « Première version validée par le gérant » et crée la version 1 : « Version 1 active depuis le 19/11/2026 — La fiche est identique à la version active ». Pour une première version, la comparaison affiche « Aucune différence », ce qui prête à confusion. |
| C-03 / C-21 | Bloquant | Le chef crée le produit « Cornes de gazelle » (Fabriqué, recette Cornes de gazelle, catégorie Beldi, vente au poids). La recette est proposée avec « Coût : 155,10 DH — Rend : 1.00 unité » au lieu de 60 pièces. Résultat : prix de revient 155,10 DH et prix de vente 465,30 DH (le kilo), alors que la fiche affiche 2,97 DH de coût et 8,92 DH de prix par pièce, soit environ 74 DH de coût au kilo (155,10 DH ÷ 2,10 kg). **Le produit reprend le coût de toute la plaque comme coût unitaire.** Le prix de vente est en lecture seule : la saisie de 220 DH est ignorée. Le produit n'a pas été enregistré. |
| — | Écart | Dans l'onglet Tarifs, le chef ne voit aucun code TVA (« Aucun — TVA saisie à la ligne » seulement), alors que 6 taux existent. Cause probable : droit de lecture des taux absent. |

État en base : 1 format, 1 fiche avec version 1 active, aucun produit.

### Correction du coût unitaire (2026-11-19)

Cause : le formulaire produit divisait le coût de la fiche par le rendement global de la
recette (`yield_quantity`, resté à 1), alors que la fiche composée par format porte son
rendement dans le format par défaut (60). Correction : nouveau module
`client/src/features/products/recipeUnitCost.ts` (coût de la fournée ÷ rendement du format
par défaut ; coût au kilo pour une vente au poids quand le poids de la fournée est connu),
appelé par `ProductsPage.tsx`, avec 6 tests.

Revérifié par l'écran avec le compte du chef : la recette est proposée avec « Rend : 60
unités », prix de revient 2,58 DH et prix de vente 7,75 DH la pièce (au lieu de 155,10 DH
et 465,30 DH).

Reste ouvert : en vente au poids, le prix reste celui de la pièce (7,75 DH affiché « /kg »).
Le serveur calcule le poids d'une fiche par une vue qui ne lit que l'ancienne composition :
pour une fiche composée par format, le poids renvoyé est 0. La fiche, elle, calcule son
poids brut (2,10 kg) dans l'écran. Le produit n'a pas été créé.

Décision : les cornes de gazelle se vendent au kilo. Correction côté serveur : la liste des
recettes renvoie maintenant le poids d'une fournée du format par défaut
(`default_format_weight_kg`, calculé dans `recipe.repository.ts` depuis la composition :
masse directe, volume avec masse volumique, pièce avec poids par pièce, sinon ligne
écartée), et le formulaire produit l'utilise pour le prix au kilo. 7 tests du calcul et
16 tests de base sur les recettes passent ; typage client et serveur sans erreur.

| ID | Statut | Constat |
|---|---|---|
| C-03 | Conforme | Le chef crée « Cornes de gazelle » (catégorie Beldi, vente au poids) : prix de revient 71,64 DH/kg, prix de vente 214,92 DH/kg, « Produit créé » ; le produit apparaît au catalogue, actif, en rupture (aucune production). Poids retenu : 2,165 kg (l'eau de fleur d'oranger est écartée faute de masse volumique ; la fiche affichait 2,10 kg en comptant les 50 ml comme 50 g et en ignorant les œufs). |

État en base : 1 format, 1 fiche (version 1 active), 1 produit.

### Atelier Boulangerie : Baguette (2026-11-19, par les écrans)

Comptes : gérant (format, validation), Boulanger matin (fiche, produit).

| ID | Statut | Constat |
|---|---|---|
| — | Conforme | Le gérant crée le format « Pétrin baguettes 100 pièces » (pétrissage et cuisson, fournée, 100 pièces, 3 pertes, 25 kg). |
| E-02 | Écart | Le prix de revient du produit Baguette (0,92 DH) ne contient aucune part des charges fixes (36 000 DH par mois saisis en E-01). La fiche affiche une « Structure 15 % » ; l'origine de ce taux n'est pas vérifiée (taux par défaut ou calcul depuis les charges). |
| D-01 | Écart | Le boulanger crée la fiche « Baguette », ajoute le format et compose : farine T55 15 kg, sel fin 300 g, levure fraîche 300 g. Résultat : 91,50 DH la fournée, 15,6 kg, 0,92 DH de matière par pièce, allergène gluten détecté. **Pas d'eau** : aucune matière « Eau » dans les données de base, donc l'hydratation (environ 10 l) manque et le poids brut (15,6 kg) ne correspond pas aux 25 kg du format. Poids cuit et perte à la cuisson non saisis. |
| D-34 | Écart | L'enregistrement passe pour la composition (200) mais la mise à jour financière est refusée (403) : le boulanger voit « Accès interdit » et « Modifications non enregistrées », alors que sa composition est bien enregistrée (constat 21, reproduit). |
| D-07 | Conforme | Le gérant crée et active la version 1 (« Validation gérant : fiche initiale pétrin 100 baguettes »). Comparaison toujours « Aucune différence » pour une première version (constat 26, reproduit). |
| C-01 | Écart | Le boulanger crée « Baguette » (Fabriqué, catégorie Pain proposée d'office, à la pièce). La recette est proposée avec « Rend : 100 unités » (correction du constat 24 confirmée). Prix de revient 0,92 DH, prix de vente 2,75 DH (0,915 × 3). **Mais la fiche affiche un coût de production de 1,05 DH et un prix de vente de 3,16 DH HT** : elle ajoute la structure (15 %), le produit ne prend que la matière. Toujours aucun code TVA proposé au chef (constat 25). |

Piège d'écran : dans le formulaire produit, le nom de la recette apparaît aussi dans
l'aperçu à droite ; un clic sur cet aperçu au lieu de la liste laisse le champ recette
vide sans message, et le prix reste à 0.

État en base : 2 formats, 2 fiches (version 1 active), 2 produits.

### Correction : rendement en pièces ou en kilos (2026-11-19)

Constat de l'utilisateur : le rendement d'un format ne se saisit qu'en pièces, alors qu'un
article vendu au poids (cornes de gazelle) ou une préparation de base rend des kilos.
Décision : au choix, pièces OU kilos, par format.

- Migration 613 : `recipe_formats.rendement_unite` (`unit` par défaut, ou `kg`) et
  `rendement_kg` (décimal, obligatoire en kg) ; `fn_recipe_cost` divise par les kilos pour
  un format au kilo (PDF de fiche, coût théorique de production).
- Fiche : sélecteur « p. / kg » à côté du rendement ; en kg, le bandeau, la décomposition
  du prix et l'onglet du format passent au kilo. Une composition saisie par pièce reste en
  pièces. Le nombre de pièces est conservé (planification).
- Produit vendu au poids : le coût au kilo prend le rendement en kilos, prioritaire sur le
  poids brut de la composition. Libellé « Rend : 2 kg » dans le choix de la recette.
- Historique de restauration (mig 346) : l'unité est photographiée et restaurée.

Vérifié par l'écran (gérant) sur « Cornes de gazelle » : rendement 2 kg → matière
77,55 DH/kg, coût de production 89,18 DH/kg, prix 267,55 DH/kg ; enregistré, relu après
rechargement ; `fn_recipe_cost` donne les mêmes montants (prix arrondi à 268 DH par le
réglage d'arrondi). La fiche produit recalcule 232,65 DH/kg (77,55 × 3). Sur décision, le
gérant met le produit à jour par l'écran (« Produit mis à jour ») : 232,65 DH/kg, revient
77,55 DH/kg, vente au poids (avant : 214,92 DH/kg, calculé sur le poids brut 2,165 kg).

| ID | Statut | Constat |
|---|---|---|
| D-06 | Non joué | Le rendement de la fiche Baguette vaut 120 en base (100 au moment de la création du produit) : modifié en dehors du scénario. |

### Correction : le produit reprend le prix de sa fiche (2026-11-19, constat 29)

Avant : le formulaire produit prenait la matière seule comme prix de revient et
matière × multiplicateur comme prix (Baguette 0,92 / 2,75 DH), alors que la fiche affiche
un coût de production complet et un prix conseillé (1,05 / 3,16 DH à 100 pièces). La
synchro serveur `syncProductPrice` (déclenchée par un changement de coût d'une matière ou
d'une base) faisait de même, avec le rendement global de la recette (1 pour une fiche par
format) : elle aurait réécrit le prix d'un produit avec le coût de toute la fournée.

- Migration 614 : `fn_recipe_sale_pricing(recette)` = coût complet et prix HT arrondi du
  format par défaut (`fn_recipe_cost`), à la pièce et au kilo (format au kilo tel quel,
  sinon fournée ÷ poids brut de la composition).
- Liste des fiches : expose ces valeurs ; le poids brut vient de la même fonction.
- Formulaire produit : coût et prix repris de la fiche, portés en TTC si la base du prix
  catalogue est TTC et qu'un code TVA est choisi ; libellés des champs corrigés.
- `syncProductPrice` : même source pour une fiche par format ; au poids, `price` et
  `price_per_kg` reçoivent la même valeur. L'ancien calcul reste pour les fiches sans format.

Vérifié par l'écran (gérant) : le produit Baguette propose 3,00 DH et 0,88 DH de revient
(fiche à 120 pièces : 0,76 matière + 15 % de structure ; 2,63 × 3 arrondi au demi-dirham
supérieur) ; avec la TVA à 20 % et la base TTC, 3,60 DH. Sur décision, le gérant met
les deux produits à jour par l'écran : Baguette 3,00 DH (revient 0,88), Cornes de gazelle
223,00 DH/kg (revient 89,18 ; fiche au multiplicateur 2,5). Tests :
3 tests de base (fonction et synchro), 17 tests du calcul client, suite de base complète
(770) et 565 tests unitaires serveur.

Écart restant : la fiche affiche son prix avant arrondi (constat 35).

### Catégories de production (2026-11-19, constat 18)

La liste « Catégorie de production » de la fiche était vide : aucune catégorie en base et
aucun écran pour en créer. Correction : migration 615, référentiel « Catégories de
production » dans Paramètres › Référentiel › Production et pertes.

Création des 6 catégories **par le service** (l'écran est réservé à l'administrateur, dont
je n'ai pas le compte) : Boulangerie, Viennoiserie, Pâtisserie, Beldi (gâteaux marocains),
Salé / Traiteur, Préparations de base. Classement des fiches **par l'écran** (gérant,
« ✎ » identité de la fiche) : Baguette → Boulangerie, Cornes de gazelle → Beldi.

### Baguette complétée, boulanger de nuit, version 2 (2026-11-19, par les écrans)

Le compte de l'Économe n'est pas utilisable (mot de passe changé par l'utilisateur) : la
matière Eau est créée par le gérant.

| ID | Statut | Constat |
|---|---|---|
| — | Écart | Le gérant crée la matière « Eau » (litre, 0,01 DH/l, masse volumique 1, en vrac, sans fournisseur). Aucune famille ne convient (pas de famille « Eau ») : rangée dans « Sel & Vinaigre ». Elle apparaît aussitôt en **Rupture**, alors qu'elle ne s'achète ni ne se stocke. |
| D-01 | Conforme (après correction) | Le boulanger ajoute l'eau (10 l) : fournée 25,6 kg bruts (le format annonce 25 kg), 91,60 DH. Il saisit 18 % de perte à la cuisson : 21,0 kg cuits. **Avant correction, la perte était perdue** : elle partait avec les paramètres financiers, refusés au chef (403), et revenait à 0 après rechargement. Corrigé : la perte part avec la composition ; un refus des paramètres financiers n'est plus une erreur (« Composition enregistrée (paramètres financiers réservés au gérant, non modifiés) »). |
| D-21 | Conforme (décision révisée) | Le boulanger de nuit ouvre la fiche du boulanger du matin et passe le sel de 300 à 330 g : enregistré. Selon la décision révisée (les chefs composent, le gérant valide par la version), la modification reste en attente jusqu'à la validation. Le texte du cas prévoyait un refus. |
| D-07 | Écart | Le gérant voit les modifications : eau ajoutée, sel 300 → 330 g, perte 0 → 18. Les composants sont listés **deux fois** (« Composants » et « Format 1 (défaut) »), la perte s'affiche sous son nom technique `perte_standard_pct`, **l'auteur de chaque modification n'apparaît pas**, et le passage du rendement de 100 à 120 n'y figure pas (constat 33). Version 2 créée et active. |

État en base : 2 formats, 2 fiches (Baguette en version 2, Cornes en version 1), 2 produits,
38 matières.

### Atelier Viennoiserie : pâte feuilletée, croissant, pain au chocolat (2026-11-19, par les écrans)

Chef Viennoiserie (Chef Tourier du scénario) : Mehdi Alaoui. Formats créés par le gérant.

| ID | Statut | Constat |
|---|---|---|
| D-23 | Conforme (après correction) | Le chef crée la préparation de base « Pâte levée feuilletée » (catégorie Préparations de base, pâte à 22 °C, hydratation 55 %). **Page blanche** juste après « Préparation créée » : l'écran allait vers une adresse supprimée (`/recipes/:id/preparation`). Corrigé : l'éditeur unique s'ouvre (constat 40). |
| — | Écart | Le chef tente de créer le format de la pâte : le bouton « Nouveau format » lui est proposé, la saisie se fait, puis « Erreur lors de l'enregistrement » (refus `production.contenants.create`, constat 22 reproduit). Dans le même formulaire, « 0,3 » kg de perte devient « 03 », soit 3 kg (constat 8 reproduit). Le gérant crée « Pâton feuilleté 10 kg » (laminage, au kilo de pâte, 10 kg bruts, 0,3 kg de chutes, net 9,7 kg). |
| D-23 | Écart | Le format au kilo s'attache à la fiche avec un rendement par défaut de **10 pièces** : le chef bascule l'unité sur kg et saisit 9,7 kg (constat 42). Composition : farine T45 4,5 kg, lait 1,4 l, eau 0,9 l, sucre 450 g, sel 90 g, levure 180 g, beurre de tourage 2,4 kg ; 275,53 DH la fournée, 28,41 DH de matière au kilo utilisable. La fiche d'une base affiche multiplicateur, prix de vente, marge et « Vente au point de vente » (constat 43). |
| D-24 | Conforme (après correction) | Le gérant crée « Plaque viennoiserie 40 pièces » (1 pièce perdue). Le chef crée Croissant (saisie par pièce) : 60 g de pâte feuilletée + 0,05 œuf de dorure, 15 % de perte à la cuisson. **Avant correction, les 60 g de pâte coûtaient 16,53 DH** au lieu de 1,70 DH : la base était coûtée sur un rendement de 1 kg (valeur de création), pas sur les 9,7 kg du format (constat 41, migration 616). Après correction : croissant 1,76 DH de matière, 2,03 DH de coût complet ; pain au chocolat (55 g de pâte, 10 g de chocolat, dorure) 3,02 DH. L'explosion descend jusqu'aux matières de la pâte (beurre 0,015 kg, farine 0,028 kg par croissant). |
| D-15 | Conforme | Allergènes déduits à travers la préparation de base : croissant gluten, lait, œufs ; pain au chocolat gluten, lait, œufs, soja. |
| D-07 | Écart | Le gérant crée la version 1 des trois fiches ; la page de la pâte affiche « Utilisée par : Croissant · Pain au chocolat ». Première version toujours « Aucune différence » (constat 26). |
| D-25 | Conforme | Le gérant remplace le beurre de tourage par du beurre doux dans la pâte : le croissant passe de 1,76 à 1,62 DH de matière. Mais le croissant reste « identique à la version active » alors que son coût affiché inclut déjà une modification de la pâte non validée (constat 47). Pour revenir à la version 1, aucun bouton : le gérant remet le beurre de tourage à la main (constat 46). Comparaison : composants listés deux fois (constat 39). |

### Produits Croissant et Pain au chocolat (2026-11-19, compte du Chef Viennoiserie)

| ID | Statut | Constat |
|---|---|---|
| C-02 | Conforme | Le chef crée « Croissant » (Fabriqué, recette Croissant, à la pièce) : prix 5,50 DH, revient 2,03 DH, repris de la fiche (correction du constat 29 confirmée). « Pain au chocolat » : 10,50 DH, revient 3,48 DH. Catégorie Viennoiserie, donc atelier viennoiserie. C-02 en cours : 4 produits sur 25. |
| — | Écart | La catégorie proposée d'office est « Pain » alors que la fiche est classée en Viennoiserie (constat 49). La liste des recettes affiche « Rend : 1 unité » pour une fiche saisie par pièce, au lieu des 40 pièces de la plaque (constat 50). Le code TVA ne propose toujours que « Aucun » au chef (constat 25 reproduit). |
| — | Observation | Le multiplicateur du croissant est passé de 3 à 2,5 à 01 h 48 depuis le compte administrateur (modification faite en parallèle du scénario, non jouée par un agent) : le prix proposé est 5,50 DH (2,03 × 2,5, arrondi) au lieu de 6,50 DH. Aucune version n'a été demandée (constats 33 et 36). |

État en base : 4 formats, 5 fiches (pâte, croissant et pain au chocolat en version 1), 4 produits.

### Atelier Pâtisserie : préparations de base et éclair (2026-11-19, par les écrans)

Chef Pâtissier : Nadia Berrada. Formats créés par le gérant : « Bassine 5 kg » (au kilo, 0,1 kg de perte ; aucun type de production ne convient à une bassine, « Moule / Découpe » faute de mieux, constat 51) et « Plaque éclairs 30 pièces ».

| ID | Statut | Constat |
|---|---|---|
| D-27 | Conforme | Trois préparations de base créées par la cheffe, sans page blanche (correction du constat 40 confirmée), toutes sur la bassine avec un rendement en kilos recopié dans la recette (correction du constat 41 confirmée) : crème pâtissière (lait 2 l, 8 œufs, sucre 400 g, farine 180 g, beurre 150 g, 2 gousses de vanille ; 2,9 kg) 23,36 DH/kg ; pâte sucrée (farine 1 kg, beurre 500 g, sucre glace 375 g, poudre d'amande 125 g, 4 œufs, sel 5 g ; 2,1 kg) 35,03 DH/kg ; ganache (chocolat 1 kg, crème 1 l ; 2 kg) 89,00 DH/kg. À chaque fois, le format au kilo arrive avec un rendement en pièces (constat 42 reproduit) ; le poids brut affiché ignore les œufs et la masse volumique du lait (2,73 kg au lieu d'environ 3,2 kg, constat 28 reproduit). |
| D-28 | Conforme | Pâte à choux (eau, lait, beurre, farine, 18 œufs, sel ; 2,6 kg, 25,92 DH/kg), puis Éclair au chocolat saisi par pièce : 40 g de pâte à choux 1,04 DH, 70 g de crème pâtissière 1,64 DH, 15 g de ganache 1,34 DH, soit 4,01 DH de matière, 4,61 DH de coût complet. Allergènes déduits à travers les deux niveaux : gluten, lait, œufs, soja. |
| D-32 | Conforme | La cheffe met 100 g de ganache dans la crème pâtissière (enregistré), puis 100 g de crème pâtissière dans la ganache : refus 409 « Cycle détecté : « Crème pâtissière » contient (directement ou indirectement) cette recette. Composition refusée. » La crème reste proposée dans la liste alors que la page de la ganache affiche « Utilisée par : Crème pâtissière » : la boucle n'est vue qu'à l'enregistrement (constat 52). Retour à l'état initial ensuite. |
| D-07 | Conforme | Le gérant crée la version 1 des cinq fiches. |

État en base : 6 formats, 10 fiches toutes en version (Baguette en version 2), 4 produits. Produits pâtisserie pas encore créés.

### Atelier Pâtisserie, suite : formats multiples, trois niveaux, cadre, mille-feuille (2026-11-20, par les écrans)

Formats créés par le gérant : « Plaque tartelettes 12 pièces », « Cercle 20 cm 6 personnes » et « Cercle 24 cm 8 personnes » (1 pièce, 6 ou 8 pièces après découpe), « Cadre opéra 40x60 » (1 cadre, 48 tranches après découpe).

| ID | Statut | Constat |
|---|---|---|
| D-29 | Conforme | « Tarte aux fraises » saisie par fournée, trois formats avec chacun sa composition (pas de règle de trois) : tartelettes 360 g de pâte sucrée, 600 g de crème, 900 g de fraises (10 % de perte à l'équeutage, bien appliquée : 35,00 DH) soit 5,14 DH la tartelette ; cercle 6 personnes 37,55 DH ; cercle 8 personnes 51,63 DH, créé avec « Dupliquer depuis » le format 6 personnes puis ajusté. Les parts (6 et 8) se ressaisissent sur la fiche : le format les annonce mais la fiche part de 1 (constat 53). |
| D-33 | Conforme | Trois niveaux : sirop d'imbibage (eau, sucre ; 1,8 kg) → biscuit chocolat imbibé (300 g de sirop + farine, cacao, sucre, 12 œufs ; 1,6 kg, 19,03 DH/kg) → entremets chocolat (300 g de biscuit, 400 g de ganache, 300 ml de crème). Coûts justes à chaque niveau ; l'explosion descend jusqu'à l'eau et au sucre du sirop. 52,71 DH l'entremets de 6 parts. |
| D-30 | Écart | L'entremets se décrit par format (cercle 6 personnes, 6 parts) : rien ne fait suivre les quantités du nombre de parts de 4 à 16 sans créer un format par taille (constat 55). La vente par personne reste à jouer côté produit (C-04). |
| D-31 | Bloquant | Opéra sur le cadre (biscuit 1,2 kg, ganache 800 g, beurre 500 g ; 136,54 DH le cadre). Rendement d'abord à 1 : le produit « Tranche d'opéra » aurait repris le coût du cadre entier ; corrigé en saisissant 48 tranches (2,84 DH la tranche, prix 10,00 DH), alors que le format annonçait déjà 48 tranches (constat 53). Les sorties déclarées exigent un produit existant ; or la fiche, déjà liée à « Tranche d'opéra », n'est plus proposée pour un second produit (« Recette déjà liée à un produit ») : « Entremets opéra » ne peut être créé que comme « Revente », ce qui est faux (constat 54). Non poursuivi. |
| D-53 | Conforme | La cheffe pâtissière emploie la pâte feuilletée du chef viennoisier dans son mille-feuille (50 g de pâte 1,42 DH, 80 g de crème pâtissière 1,87 DH ; 3,29 DH). |
| D-07 | Conforme | Versions créées pour la tarte et le sirop, puis, après la correction du constat 56, pour le biscuit, l'entremets, l'opéra et le mille-feuille, sans nouvelle déconnexion. Les 16 fiches du scénario ont une version active. |

Après chaque enregistrement, la page de la fiche se recharge et remonte en haut (constat 57).

État en base : 10 formats, 16 fiches, 5 produits (Tranche d'opéra en plus).

### Produits de pâtisserie (2026-11-20, compte de la Cheffe pâtissière)

| ID | Statut | Constat |
|---|---|---|
| C-02 | Conforme | Créés par la cheffe, catégorie Pâtisserie : Éclair au chocolat 14,00 DH (revient 4,61 DH), Mille-feuille 11,50 DH (3,78 DH), prix et coûts repris des fiches. Catégorie « Pain » toujours proposée d'office (constat 49). |
| C-05 | Écart | Le formulaire produit ignore les formats : la fiche Tarte aux fraises est proposée par son format par défaut (« Rend : 12 unités », 18,00 DH). Le prix par format existe côté fiche (un produit lié par format), mais les produits 6 et 8 personnes ne peuvent pas être créés en « Fabriqué » : la fiche est déjà liée (même blocage que le constat 54). Seul « Tartelette aux fraises » est créé (constat 58). |
| C-04 | Écart | « Entremets chocolat » en vente par personne : le prix par personne n'est pas déduit de la fiche (6 parts, 182,00 DH conseillés pour l'entremets entier), la cheffe saisit 30,50 DH. Le prix de revient enregistré reste celui de l'entremets entier (60,62 DH) face à un prix par personne : toute marge calculée sur ce produit est fausse (constat 59). Tailles proposées en caisse à vérifier en partie H. |

État en base : 9 produits.

### Viennoiserie, suite : brioche et chausson aux pommes (2026-11-20, compte du Chef Viennoiserie)

| ID | Statut | Constat |
|---|---|---|
| D-26 | Conforme | Brioche saisie par fournée sur la plaque viennoiserie (farine T45 2 kg, 20 œufs, beurre 1 kg, sucre 250 g, sel 40 g, levure 80 g ; 12 % de perte à la cuisson) : 124,82 DH les 40, 3,12 DH la brioche. Chausson aux pommes saisi par pièce : 70 g de pâte feuilletée, 60 g de pomme avec 25 % de perte à l'épluchage, 8 g de sucre ; la perte est appliquée au coût (0,72 DH) et aux besoins (l'explosion demande 0,08 kg de pomme par chausson) ; 2,76 DH le chausson. |
| C-02 | Conforme | Produits créés par le chef : Brioche 11,00 DH (revient 3,59 DH), Chausson aux pommes 10,00 DH (3,17 DH). |
| D-07 | Conforme | Versions 1 créées par le gérant pour les deux fiches. |

État en base : 18 fiches toutes en version, 11 produits.

### Atelier Beldi, suite : ghriba, msemen, plateau assorti (2026-11-20, compte de la Cheffe beldi)

| ID | Statut | Constat |
|---|---|---|
| D-35 | Écart | Ghriba sur la plaque beldi 60 pièces (poudre d'amande 500 g, sucre glace 250 g, 3 œufs, levure chimique 10 g ; 8 % de perte à la cuisson) : 71,95 DH la plaque, 1,20 DH la pièce. Le poids standard par pièce ne se saisit pas sur la fiche (poids brut et cuit calculés, en lecture seule) : il se règle dans Paramètres › Qualité des données › Poids des formats, écran réservé à l'administrateur. Ni la cheffe ni le gérant ne peuvent le renseigner (constat 60). |
| D-36 | Conforme | Msemen (semoule 1,5 kg, farine 1,5 kg, eau 1,8 l, huile 0,3 l ; 0,43 DH la pièce) avec deux étapes rédigées en français et en arabe (nom, points à suivre en darija) : affichées de droite à gauche, conservées en base telles que saisies. |
| D-14 | Conforme | Après l'enregistrement des étapes, la cheffe modifie la composition (huile 0,35 l) et enregistre : les deux étapes restent. |
| D-37 | Bloquant | La fiche « Plateau beldi assorti » ne peut pas contenir de produits finis : la recherche « Cornes » ne donne « Aucun résultat » ; seules les préparations de base et les matières sont proposées. Un plateau qui consomme des produits n'est pas réalisable. La fiche vide reste en base (constat 61). |
| D-07 | Conforme | Versions 1 créées par le gérant pour la ghriba et le msemen. |

### Atelier Salé : pâte à pizza, pizza, briouates, plateau (2026-11-20, compte du Chef Salé)

| ID | Statut | Constat |
|---|---|---|
| D-38 | Conforme (partiel) | Préparation « Pâte à pizza » en bassine 5 kg, rendement 3,3 kg (farine T55 2 kg, eau 1,2 l, huile 0,1 l, sel 40 g) : 12,89 DH la fournée. « Pizza individuelle » saisie par pièce sur la plaque de 30 : 120 g de pâte (0,47 DH, coûtée sur le rendement kilo grâce au correctif du constat 41), 50 g de tomate concassée, 40 g de fromage râpé ; 4,17 DH de matière. La quiche au thon n'est pas saisie : même schéma que la pizza (pâte et garniture), rien de nouveau à éprouver. La DLC courte reprise à la production reste à vérifier dans la partie production. |
| D-39 | Écart | Briouates au poulet saisies par pièce sur la plaque beldi 60 pièces : blanc de poulet 25 g, oignon 10 g avec 10 % de perte, farine T55 10 g ; 45 g et 1,49 DH de matière, 1,71 DH de coût de production. La fabrication à la pièce fonctionne, mais la vente à la douzaine n'existe pas : le produit ne connaît que la pièce, le poids et la personne, sans conditionnement de vente (constat 62). |
| C-07 | Écart | Même cause : « Briouates au poulet vendues à la douzaine » ne se crée pas. Un second produit « douzaine » n'est pas possible non plus, la fiche ne se liant qu'à un produit (constat 54). Produit non créé. |
| D-40 | Bloquant | Plateau salé pour 20 personnes : la recherche « pizza » dans les composants ne propose que la préparation « Pâte à pizza », jamais la fiche « Pizza individuelle ». Même blocage que le plateau beldi (constat 61) ; aucune fiche créée cette fois. |
| D-07 | Conforme | Versions 1 créées par le gérant pour la pâte à pizza, la pizza individuelle et les briouates. |

État en base : 24 fiches dont 23 en version (le plateau beldi vide n'en a pas), 11 produits.

## Partie F — Premier approvisionnement, de la demande à la commande (2026-11-20, par les écrans)

Comptes : Chef Viennoiserie (demandes), Responsable des achats (demandes de prix, bons de
commande). Le compte Économe reste inutilisable. Réglages des achats tels qu'à l'installation :
plusieurs contrôles sont en mode « avertissement » (`po_requires_request`, `sod_mode`,
`lot_dlc_enforcement`, `cash_limit_enforcement`, `off_contract_enforcement`) et n'empêchent
rien (constat 64).

| ID | Statut | Constat |
|---|---|---|
| F-01 | Écart | Le chef demande 50 kg de beurre de tourage et 100 kg de farine T45 depuis la fiche de chaque matière (Stock › matière › « Commander ») : deux demandes, une par article. Elles sont **directement « Prêtes »** : l'approbation ne porte plus sur la demande mais sur le bon de commande chiffré (choix de la mig 465, commentaire du contrôleur). Aucune confirmation visible après « Ajouter à la liste ». Le texte du formulaire annonce que « le gérant crée directement le bon de commande », ce qui n'est plus le flux. |
| F-02 | Écart | Pas de demande groupée : une demande = un article. Joué partiellement (compte Économe inutilisable) ; l'écran « Demandes d'achat » regroupe ensuite les demandes par fournisseur. |
| F-03 | Sans objet | Pas d'approbation de demande (voir F-01). Une demande peut être annulée avec un motif. |
| F-04 | Sans objet | Même cause. |
| F-05 | Conforme | Depuis « Demandes d'achat », groupe Minoterie Atlas, « Lancer la demande de prix » : AO-2026-0001 créée en brouillon avec la farine. Le sucre (autre groupe fournisseur) est ajouté à la main dans la demande de prix, avec Comptoir Cacao et Al Baraka : trois fournisseurs consultés, envoi « en attente » des devis (pas de SMTP en local, les messages restent en file). **Le sucre ajouté à la main ne couvre pas sa demande d'achat**, qui reste « à commander » (constat 67). |
| F-06 | Conforme | Trois devis saisis (référence, validité, délai, conditions, note qualité, prix par ligne). Le sucre est demandé en sacs de 18 kg et chiffré au sac ; le comparateur ramène bien au kilo (6,80 / 6,50 / 6,00 DH). Totaux HT : 1 374,40, 1 302,00, 1 228,00 DH. |
| F-07 | Conforme | Notation pondérée prix 50 %, qualité 25 %, fournisseur 25 % : Minoterie 80,8 « Recommandé », Comptoir 79,5, Al Baraka 77,5 « Moins cher ». Le délai de livraison (1, 2, 6 jours) est affiché mais n'entre pas dans la note (constat 66). Attribution à Minoterie : BC-2026-0001 créé (1 302 DH). |
| F-08 | Écart | Attribuer à Al Baraka (non recommandé) ne demande qu'une confirmation, sans justification ; l'API n'en prévoit pas (constat 65). Attribution annulée. |
| F-09 | Écart | « Nouveau BC › Articles stockés » chez la Ferme avicole Zerhoun sans demande de prix ni demande d'achat : créé et envoyé (BC-2026-0002). La règle existe (mig 454) mais reste en mode avertissement (constat 64). |
| F-10 | Conforme | Demande de prix AO-2026-0002 (sucre) à deux fournisseurs, Comptoir « a décliné », un seul devis : l'attribution reste possible, sans alerte. BC-2026-0004 créé. |
| F-11 | Conforme | BC-2026-0002 : 89 caisses de 30 œufs à 1,20 DH = 3 204 DH, envoyé sans approbation. |
| F-12 | Conforme | BC-2026-0003 : 131 sacs de T55 (3 275 kg) = 18 012,50 DH ; à l'envoi, « à approuver », étape 1 « Administrateur », règle « Bon de commande au-dessus de 5 000 DH » (engagement TTC + cumul du jour chez le fournisseur). Conséquence voulue : BC-2026-0001 (1 302 DH, même fournisseur, même jour) part aussi en approbation. Détail de l'approbation : identifiant technique de la catégorie affiché, « 0 circuit actif » alors qu'un circuit est en cours (constat 74). |
| F-13 | Conforme | Le responsable des achats n'a rien dans « À approuver » ; son BC est dans « Mes demandes », en attente de l'administrateur. |
| F-14 | Conforme | Joué par l'utilisateur sur le compte administrateur (20/11, 15 h 36) : BC-2026-0001 et BC-2026-0003 approuvés, ils passent « Envoyé · en attente de livraison ». |
| F-15 | Écart | BC-2026-0001 ne s'envoie pas (approbation, F-12). PDF vérifié sur BC-2026-0002 : identité légale complète en pied de page (raison sociale, RC, patente, IF, ICE), lignes présentes, mais **ni prix, ni TVA, ni total**, et la quantité est en unité de base (2 670 « unit » au lieu de 89 caisses) (constat 68). |
| F-16 | Conforme | Un BC envoyé ne se modifie plus directement : « Demande de changement » crée une révision motivée (motif obligatoire, précision). 89 → 90 caisses, 3 240 DH, ligne « Modifié · Modification de quantité » dans l'historique. |
| F-17 | Conforme | BC-2026-0004 envoyé puis annulé avec le motif « Doublon de commande » et une précision : « Les demandes d'achat qu'il couvrait redeviennent à commander » ; la demande de sucre repasse « pending ». |
| F-18 | Écart | BC-2026-0005 chez Pâtisserie Import Lyon : devise EUR proposée d'office, prix converti (140 DH/kg = 12,9032 €/kg), 30 kg = 387,10 € ≈ 4 199,99 DH, pastille « EUR » dans la liste. Mais aucun taux du jour : « Aucun taux saisi pour EUR », le taux est saisi à la main sur le bon (constat 69). |
| F-19 | Conforme | BC-2026-0006 chez Emballages du Nord : la ligne « Boîte pâtissière 20 cm » porte l'étiquette « Consommable » (`line_type = consumable`). |
| F-20 | Bloquant | BC d'immobilisation chez Froid et Fours : la catégorie est obligatoire et la liste répond « Aucun résultat » ; l'appel `/expense-categories` est refusé (403) au responsable des achats. Même cause que le constat 7 ; toutes ses lignes de BC sont d'ailleurs « Sans catégorie » (constat 71). |
| F-21 | Écart | Quantité 0 refusée (« Les quantités doivent être supérieures à 0 »). Prix −2,50 : le BC est créé, la ligne enregistrée sans prix (« Prix à définir ») ; pas de refus explicite (constat 70). Prix corrigé à 2,50 DH ensuite. |

Autres observations : un chef voit tout le module Achats, y compris « + Nouveau BC » qui ouvre
le formulaire, alors que son rôle n'a que la création de demandes ; le responsable des achats
voit « Modifier », « Ajuster » et « Supprimer » sur une fiche matière alors qu'il n'a que la
lecture du stock (constat 72). L'écran « Modifier le bon de commande » annonce qu'une quantité
livrée saisie là « ajuste automatiquement le stock », donc sans réception, sans lot ni DLC ;
non essayé (constat 73).

État en base : 6 BC (0001 et 0003 en attente d'approbation, 0002 envoyé, 0004 annulé, 0005 et
0006 en brouillon), 2 demandes de prix attribuées, demandes de beurre et de sucre à commander.

### Partie F — Réceptions (2026-11-20, compte du Responsable des achats)

| ID | Statut | Constat |
|---|---|---|
| F-30 | Conforme | Joué après F-14 (voir « Partie F — suite ») : BC-2026-0003 reçu par contenant, 131 sacs × 25 kg = 3 275 kg calculés par l'écran. |
| F-31 | Conforme | Beurre de tourage (BC-2026-0007, Laiterie du Gharb, issu de la demande de Mehdi par la demande de prix AO-2026-0003) : lot et DLC obligatoires à la saisie ; lot interne LI-261120-00004 créé avec le lot fournisseur LG-B-2611 et la DLC 15/01/2027. |
| F-32 | Conforme | 30 kg reçus sur 50 : BC « Réception partielle », reliquat de 20 kg attendu. |
| F-33 | Conforme | Seconde réception : le BC passe « livre_complet ». La réception qui solde le BC exige le numéro de facture du fournisseur et crée la facture (FAC-LG-8812, 5 100 DH). |
| F-34 | Conforme | 22 kg pour le reliquat (52 reçus pour 50 commandés, dans la tolérance de 10 %) : accepté ; la fiche du BC signale « 1 écart » (beurre surlivré). |
| F-35 | Écart | 40 kg pour le reliquat (70 pour 50) : refusé par le serveur (« la ligne dépasserait la quantité commandée… tolérance 10 % »), mais **aucun message à l'écran** : la fenêtre reste ouverte, le bouton revient, rien n'explique le refus (constat 75). |
| F-36 | Écart | Œufs (BC-2026-0002) : pas de quantité refusée ni de motif à la réception. Contournement : 88 caisses reçues sur 90 (2 640 œufs, lot ZER-2611-A, DLC 10/12), puis « Clôturer le reliquat » avec le motif « Livraison partielle acceptée, reliquat abandonné » et la précision « 2 caisses cassées » (constat 76). La facture FR-2026-0001 (3 168 DH) est créée à la clôture, sans numéro du fournisseur. |
| F-37 | Écart | Lait avec une DLC au 18/11 : refusé par le serveur (« la DLC 2026-11-18 est déjà dépassée, la marchandise ne peut pas être réceptionnée »), mais sans message à l'écran (constat 75). |
| F-38 | Écart | Lait avec une DLC dans 2 jours : accepté sans alerte, aucune alerte de péremption créée. Le lait n'exige d'ailleurs ni lot ni DLC à la réception (constat 77). |
| F-39 | Non joué | Compte Économe inutilisable. Les lots reçus n'ont pas d'emplacement. |
| F-40 | Non joué | Même cause. |
| F-41 | Conforme | Sucre semoule, stock à zéro : 90 kg à 5,00 DH (BC-2026-0008) puis 90 kg à 6,00 DH (BC-2026-0009) : coût de la matière 5,00 puis **5,50 DH** le kilo. La demande de sucre reste pourtant « à commander » (constat 67). |
| F-42 | Écart | Chocolat de couverture en euros (BC-2026-0005), « Frais annexes » de 1 200 DH à la réception : le coût passe de 139,9997 à 179,9997 DH le kilo (+40 DH, 30 kg). Mais les frais sont répartis **au prorata de la valeur**, pas au poids, et la catégorie de charge reste vide (403, constat 71) (constat 78). |
| F-43 | Conforme | L'écran Réceptions ne propose que des BC envoyés : pas de réception sans bon de commande. |
| F-44 | Conforme | « Clôturer le reliquat » avec motif obligatoire (liste) et précision : BC-2026-0002 clôturé, 60 œufs annulés et tracés. |
| F-45 | Écart | Aucune action de retour fournisseur dans les Achats (BC, bon de réception) ; seule une décision « Retour fournisseur » existe sur une non-conformité du module Contrôle. Non joué (constat 79). |
| F-46 | Conforme | Le caissier ouvre l'écran Réceptions (menu Achats visible, constat 72) mais n'y voit aucun BC : aucune réception possible. |

Autres observations : les compteurs de l'écran Réceptions ne se mettent à jour qu'après un
rechargement ; « Tout reçu » remplit les kilos mais laisse le nombre de sacs à 0 ; le coût d'un
article payé en devise garde quatre décimales (179,9997) (constat 80).

État en base : 9 BC (0002, 0005, 0007, 0008 et 0009 reçus et soldés ; 0001 et 0003 en
approbation ; 0004 annulé ; 0006 en brouillon), 6 bons de réception, 5 factures en attente,
aucune validée (FR-2026-0001, FAC-LG-8812, BRK-F-101, BRK-F-102, PIL-2026-77).

### Partie F — Factures et paiements (2026-11-20, Responsable des achats puis Gérant)

Méthode : les boutons « Mettre en litige » et « Lever le litige » passent par une fenêtre
`confirm()` du navigateur, que le panneau de test ferme d'office ; elle a été acceptée par
script (ce que l'utilisateur ferait en cliquant « OK »).

| ID | Statut | Constat |
|---|---|---|
| F-50 | Conforme | Les factures naissent à la réception qui solde le BC (ou à la clôture du reliquat), en brouillon. « Contrôle de la facture » sur FAC-LG-8812 : rapprochement par ligne commandé / reçu / facturé et prix commandé / facturé, « Facture conforme au rapprochement ». Aucune échéance calculée (« Échéance — », constat 1). |
| F-51 | Conforme | Joué dans la suite : PDF joint à BRK-F-101, « Facture jointe avec succès », pièce conservée et relisible. |
| F-52 | Écart | BRK-F-101 : prix passé de 5,00 à 5,50 DH par « Éditer les lignes » (le formulaire affiche « Écart avec le montant enregistré +45,00 DH »). Mais l'enregistrement **recrée la ligne sans lien avec la ligne de BC, la réception ni la catégorie** : le contrôle, même relancé, répond « Facture conforme » et n'a plus de rapprochement par ligne (constat 81). |
| F-53 | Conforme | Joué dans la suite après la correction du constat 81 : la validation d'une facture de 150 kg pour 90 kg reçus est refusée avec un message clair (constat 89 pour le contrôle du brouillon). |
| F-54 | Écart | Le responsable des achats reçoit « Accès interdit » en mettant une facture en litige. Le gérant le peut : sans motif, après une simple confirmation ; BRK-F-102 passe « Bloquée / litige », « Payer » est remplacé par « Voir le litige » (constat 84). |
| F-55 | Conforme | « Valider » est proposé au responsable des achats, mais refusé (« Accès interdit », message générique). |
| F-56 | Écart | Le gérant valide FAC-LG-8812 en confirmant le n° et le total TTC du papier : « À payer ». L'écriture d'achat (AC-2026-00007) était **déjà passée à la réception**, facture encore en brouillon ; la validation n'ajoute rien, et chaque édition extourne puis repasse l'écriture. Étiquette « À vérifier » sur des factures pourtant conformes (constat 83). |
| F-57 | Conforme | FR-2026-0001 (œufs) validée (n° fournisseur saisi, la facture n'en avait pas) puis payée en espèces : 3 132 DH, écriture au journal de caisse (CA-2026-00001), une seule fois. Plafond espèces affiché (jour et mois) et alerte « non déductible » au-delà de 5 000 DH. Le paiement n'est rattaché à aucune session de caisse (constat 86). |
| F-58 | Conforme (sur F5) | Les BC de la Minoterie attendent l'approbation : virement joué sur BRK-F-102 (Al Baraka, 540 DH), référence obligatoire, journal de banque (BQ-2026-00001), facture « Réglée ». Pas de choix du compte bancaire. |
| F-59 | Conforme | FAC-LG-8812 : 3 000 DH par chèque barré (n° obligatoire), « Partiellement réglée · reste 2 100,00 DH ». Le chèque est passé au journal des opérations diverses (OD-2026-00001) (constat 86). |
| F-60 | Écart | Joué dans la suite : aucun acompte fournisseur possible (constat 90). |
| F-61 | Conforme | Seconde facture FAC-LG-8812 chez Laiterie du Gharb : refusée par le serveur (« Ce numéro de facture est déjà enregistré pour ce fournisseur »), l'écran n'affiche que « Erreur ». La saisie manuelle exige une catégorie que le responsable des achats ne peut pas choisir (liste vide, constat 71). |
| F-62 | Écart | L'avoir fournisseur n'existe que dans le formulaire de paiement par chèque (« Avoir fournisseur, déduit de la dette sans sortie de trésorerie »). Un avoir de 36 DH couvrant tout le reste des œufs (chèque à 0) est refusé : « Données invalides » ; le reste de 36 DH demeure (constat 85). |
| F-63 | Conforme | Payée dans la suite à 11,00 DH l'euro : perte de change de 58,11 DH en 6331. Avant : PIL-2026-77 (euros) ne se validait pas : erreur serveur « column "updated_at" of relation "ingredients" does not exist » (`accounting.repository.ts:1493`), et la réévaluation comparait le prix facturé (139,9997) au coût du lot frais d'approche compris (179,9997), ce qui aurait effacé les 1 200 DH de frais. **Corrigé (mig 618)** : la facture se valide, le coût du chocolat reste 179,9997 DH. Le paiement à un autre taux que celui du BC reste à jouer (la facture est en litige) (constat 82). |
| F-64 | Conforme | « Lever le litige » : BRK-F-102 redevient « À payer », bouton « Payer » de retour. |
| F-65 | Écart | Pas de catégorie par ligne dans Factures reçues : la catégorie se choisit pour toute la facture (« Modifier la facture »), l'éditeur de lignes n'a que la TVA (constat 87). |
| F-66 | Conforme | Le commercial ouvre l'écran Factures reçues (menu visible, « Nouvelle facture » affiché, constat 72) mais n'y voit aucune facture. |

État en base : FAC-LG-8812 partiellement réglée (reste 2 100 DH), BRK-F-102 réglée,
FR-2026-0001 partiellement réglée (reste 36 DH), BRK-F-101 en brouillon (ligne rattachée de nouveau au BC
et à la réception après la correction du constat 81, prix 5,50 DH),
PIL-2026-77 validée après correction et toujours en litige (état mis à jour dans la suite ci-dessous).

### Partie F — suite : cas débloqués et stock d'ouverture (2026-11-20, Responsable des achats puis Gérant)

| ID | Statut | Constat |
|---|---|---|
| F-52 (rejoué) | Écart | Après la correction du constat 81, le contrôle de BRK-F-101 montre de nouveau le rapprochement par ligne (prix commandé 5, facturé 5,5 en orange). La validation par le gérant passe pourtant **sans blocage de prix** : la tolérance installée est de 2 % ou 0,50 DH par unité, la plus large des deux, et 0,50 DH sur un sucre à 5,00 DH représente 10 % (constat 88). La validation réévalue correctement le lot : 5,00 → 5,50 DH, CMUP 5,50 → 5,75 DH, +45,00 DH au stock. Seul blocage ouvert : « TVA à vérifier » (ligne sans taux), non bloquant. |
| F-53 | Conforme | Le responsable des achats passe BRK-F-101 à 150 kg (90 reçus) par « Éditer les lignes » : enregistré sans avertissement. Le contrôle affiche 150 en rouge mais titre « Facture conforme au rapprochement », même après « Recontrôler » : sur un brouillon, aucun blocage n'est calculé (constat 89). À la validation, le gérant est refusé : « BC BC-2026-0008 : la ligne serait sur-facturée (150.0000 facturé > 90.0000 reçu, tolérance 2.00 %) ». Quantité remise à 90 kg, puis facture validée (F-52). |
| F-51 | Conforme | Gérant, BRK-F-101 : « Joindre un fichier », PDF choisi (le sélecteur de fichier a été alimenté par script, comme pour les fenêtres `confirm()`), « Facture jointe avec succès ». La pièce est rangée dans le stockage de fichiers (`invoice/2026/11/…pdf`, nom d'origine et empreinte conservés) et se rouvre en `application/pdf`. Le responsable des achats a le droit `accounting.attachment`. |
| F-63 | Conforme | Gérant : « Lever le litige » sur PIL-2026-77 (387,10 €, taux de la facture 10,85), puis « Payer ». Le formulaire demande le taux du jour : 11,00 → « Sortie de trésorerie 4 258,10 DH », « Dette soldée au taux de la facture 4 199,99 DH », « Perte de change 58,11 DH (6331) ». Virement avec référence obligatoire : écriture BQ-2026-00002 (4411 débit 4 199,99, 6331 débit 58,11, 5141 crédit 4 258,10), facture « Réglée ». |
| F-14 | Conforme | Voir plus haut : approbation faite par l'utilisateur sur le compte administrateur. |
| F-30 | Conforme | Responsable des achats, BC-2026-0003 : la saisie par contenant (« sac × 25 kg ») calcule les kilos (131 sacs → 3 275 kg). Lot fournisseur et DLC obligatoires ; la réception solde le BC et exige le n° de facture du fournisseur : lot interne LI-261120-00011 (lot MA-T55-2611, DLC 20/05/2027, emplacement attribué), BC « livre_complet », facture MA-2026-4471 (18 012,50 DH) en brouillon. Les dates saisies au clavier ne sont pas prises dans les champs date du panneau de test (saisies autrement). |
| F-60 | Écart | Aucun acompte fournisseur : ni le BC (actions : envoyer, annuler, bloquer, supprimer) ni la facture ne proposent un versement à la commande. Le seul paiement rattachable à un BC est une dépense passée en charge, pas une avance (compte 4091) déduite de la facture finale (constat 90). Le BC chez Froid et Fours reste en outre impossible pour le responsable des achats (F-20). |
| F-70 | Conforme | Gérant (compte Économe inutilisable), Stock › Inventaires : « Stock de départ novembre 2026 », matières premières, comptage à l'aveugle, articles sans stock inclus : INV-2026-0001, 38 articles. Formule par contenant acceptée (« 2x10 » → 20 kg de beurre doux, « 87x30 » → 2 610 œufs). Six articles comptés, les autres laissés « non comptés » (pas de mise à zéro). Stock créé au coût du catalogue par des lots ADJ (beurre doux 20 kg à 85 DH, levure fraîche 5 kg à 28 DH, miel 3,5 kg à 90 DH, sel 25 kg à 2 DH) ; aucune facture, aucune dette fournisseur. Ces lots n'ont **ni DLC ni lot fournisseur**, levure fraîche comprise (constat 91). |
| F-71 | Conforme (observé) | « Article hors liste » ne cherche que dans le catalogue et le périmètre de l'inventaire : une matière absente du catalogue (pistache) ou un consommable dans un inventaire de matières (boîte pâtissière) répond « Aucun résultat ». Il faut créer l'article avant de le compter. |
| F-72 | Conforme | « Terminer le comptage » (confirmation : les 32 non comptés ne seront pas ajustés), puis « Valider l'inventaire » : « Inventaire validé : écart net 1 979,00 DH » (excédents +2 205,00, manquants −226,00 : beurre de tourage −2 kg, −190 DH ; œufs −30, −36 DH), valorisé au coût moyen du jour. Stock ajusté (tourage 50 kg, œufs 2 610). Aucune écriture comptable : cohérent avec un inventaire intermittent (variation de stock à la clôture), à confirmer côté comptabilité. Le gérant voit la colonne « Théorique » malgré le comptage à l'aveugle. |

État en base : BC-2026-0001 envoyé (non reçu), BC-2026-0003 reçu et soldé ; factures BRK-F-101
validée (495 DH, à payer), PIL-2026-77 réglée, MA-2026-4471 en brouillon ; inventaire
INV-2026-0001 validé. Restent F-39 et F-40 (compte Économe).

## Partie G — Tenue du stock (2026-11-20, compte du Gérant)

Jouée avec le compte du gérant : le mot de passe de l'économe a été changé. Les refus propres à
l'économe sont vérifiés par ses droits (`role_action_permissions`), le refus du responsable des
achats à l'écran.

| ID | Statut | Constat |
|---|---|---|
| G-01 | Écart | Stock › Réserve : par matière, quantité en réserve et au pesage, nombre de lots, jours de stock, DLC la plus proche, statut (OK, DLC ≤ 7 j, sans usage…). La fiche matière détaille les lots (lot fournisseur, coût, valeur) et la fiche lot la chaîne BC → BR → lot → DLC et la répartition réserve / pesage. Mais l'installation n'a que **deux emplacements**, « Économat (sec) » et « Zone de pesage » : beurre et lait sont rangés en « sec », pas de chambre froide ; les œufs et les lots d'inventaire n'ont aucun emplacement (constat 94). |
| G-02 | Conforme | « Ouvrir » sur la farine → Bons de sortie › Contenants à ouvrir : lot proposé en FEFO, quantité par contenant (1 sac × 25 kg), « Mettre au pesage » : « 25.00 kg Farine T55 mis au pesage (lot LI-261120-00011) », réserve 3 250 kg. |
| G-03 | Conforme | Lait entier, deux lots : le lot à DLC 22/11 est proposé par défaut, celui au 25/11 en second. |
| G-04 | Écart | Le lot au 25/11 choisi à la main est ouvert sans alerte ni justification, alors qu'un lot plus proche de sa DLC reste en réserve (constat 92). |
| G-05 | Écart | Fiche matière › « Ajuster » › « Perte / Casse », 25 kg, motif « Casse / renversé », note : « Stock ajusté », mouvement « Perte / Déchet » tracé avec son motif. Mais ni lot ni zone ne se choisissent : les 25 kg ont été retirés du sac **ouvert au poste de pesée** (pesage 25 → 0), pas de la réserve où le sac a cassé ; le mouvement n'est rattaché à aucun lot et ne porte pas de coût ; le champ « Motif de la perte » est affiché deux fois (constat 93). |
| G-06 | Conforme | Poste de pesée › Lait entier › contenant ouvert › « Remettre en réserve » (quantité, note) : « 1 l de Lait entier (lot LG-L-2611-2) remis en réserve » ; réserve 10 + 10 l, pesage 0, total 20 l, le lot reste marqué ouvert. La DLC du contenant s'y affiche 24/11 pour un lot au 25/11 (constat 96). |
| G-07 | Conforme | Seuil du miel porté à 5 kg (stock 3,5) : bandeau « Stock bas · 3.5 kg restant(s), seuil minimum 5 kg » avec « Demander », et Achats › À commander : « Miel · stock 3.5 / seuil 5 kg », 585 DH estimés. Pas de notification (constat 96). |
| G-08 | Non joué | Aucun lot n'atteint sa DLC ce jour (première : lait au 22/11). Le lait est déjà signalé « DLC ≤ 7 j » et « Ouvrir en priorité ». |
| G-09 | Non joué | Même cause ; l'action « Lot aux pertes » existe sur la fiche lot et au poste de pesée. |
| G-10 | Conforme | Ouvrir 10 kg de levure fraîche pour 5 kg en stock : champ en orange, « Mettre au pesage » désactivé. Une perte de 10 kg par « Ajuster » est refusée par le serveur (« Stock insuffisant (disponible: 5, demande: 10) ») mais **sans message à l'écran**, la fenêtre reste ouverte (même défaut que le constat 75). |
| G-11 | Conforme | Droits : l'économe n'a pas `stock.inventory.adjust` (ajustement manuel refusé), le gérant l'a ; son ajustement exige un type et un motif (liste), la note reste facultative. |
| G-12 | Écart | Historique incomplet : l'onglet « Historique » de la farine ne montre que la réception (+3 275 kg) et la perte (−25 kg), pas l'ouverture vers le pesage ; la fiche lot n'a pas d'historique de mouvements (constat 95). |
| G-13 | Conforme | Le responsable des achats ouvre Bons de sortie › Contenants à ouvrir, voit « Mettre au pesage » actif, et reçoit « Accès interdit » au clic (message générique, bouton affiché : constat 72). |
| G-14 | Conforme (partiel) | Après la correction du constat 102 : BC-2026-0010 chez Rif Boissons Distribution, 24 « Eau minérale 50 cl » reçues sans aucune production : lot produit PA-261121-0001 en réserve, stock réserve 24, coût 3,00 DH. Le passage en vitrine (demande d'approvisionnement vitrine, puis transfert) et la vente restent à jouer avec la caisse. |

État en base : farine 3 250 kg (réserve), lait 20 l (deux lots, dont un ouvert puis refermé),
miel sous son seuil (3,5 / 5 kg), une perte de 25 kg de farine tracée.

## Partie H — Caisse (2026-11-20, Caissier puis Gérant)

Comptes : les codes PIN sont ceux de `server/scripts/seed-scenario0-accounts.ts`. Celui de Hamza
(260222) est bon ; celui d'Imane ne correspond plus au script (changé depuis, comme le mot de
passe de l'économe) : Hamza joue le caissier 1. Le compte administrateur est celui de
l'utilisateur (H-01 vérifié par les écrans de caisse et le code).

| ID | Statut | Constat |
|---|---|---|
| H-01 | Écart | Aucun fond de caisse de départ paramétrable : le montant se saisit librement à chaque ouverture, sans montant attendu ; l'ouverture ne passe aucune écriture comptable (constat 97). |
| H-02 | Conforme | Écran de connexion : tuiles Hamza B., Hassan O., Imane F. ; tuile de Hamza + code PIN → « Caisse fermee · Bonjour Hamza ! · Ouvrir la caisse ». |
| H-03 | Conforme | Deux codes faux sur la tuile d'Imane : « Code PIN incorrect (4 tentative(s) restante(s)) », puis 3. Verrouillage de 15 min après 5 échecs (`auth.controller.ts`), non poussé jusqu'au bout pour ne pas bloquer le compte. |
| H-04 | Conforme | « Ouvrir la caisse » → fond saisi 500 DH → « Caisse ouverte ! », pied d'écran « Caisse ouverte à 15:24 · Hamza Belkadi » ; session à son nom. Saisie directe du montant, sans comptage par coupures à l'ouverture (il existe à la fermeture). |
| H-05 | Écart | Session du gérant fermée en « Passation de shift » avec 300 DH (« Caisse juste »), puis rouverte avec 250 DH : ouverte sans remarque. Le serveur connaît pourtant le montant laissé à la clôture (`/cash-register/last-amount` = 300) mais ne le propose pas et ne calcule aucun écart d'ouverture : 50 DH disparaissent sans trace (constat 97). |
| H-06 | Conforme (observé) | Pendant la session de Hamza, le gérant ouvre la sienne (300 DH) : deux sessions ouvertes en même temps dans la même boutique, sans avertissement. Une session par utilisateur, pas par poste ni par tiroir (constat 98). |
| H-07 | Conforme (partiel) | Catégories Pain, Viennoiserie, Pâtisserie, Beldi, Salé, Boissons. 11 produits créés à ce stade (partie C inachevée, 25 attendus), tous sans stock faute de production : rangés sous « EN RUPTURE · 11 — afficher », aucun proposé à la vente. Prix au kilo affiché sans unité (Cornes de gazelle « 223,00 DH »), même vignette pour tous (constat 99). |
| H-08 | Conforme | Toucher « Baguette » (rupture) n'ajoute rien au ticket : vente sans stock refusée (`POS_ALLOW_NEGATIVE_STOCK=false`), mais sans message (constat 99). |
| H-09 | Non joué | « Plus › Réglages du poste » : « Aucune imprimante ticket configurée pour ce magasin (Réglages → Impression) » ; pas de ticket de test côté caissier, et aucune vente possible (tout en rupture). |
| H-10 | Conforme | Caissier : `/settings` → « Vous n'avez pas accès aux paramètres » ; `/employees` → « Mon espace » (sa fiche, ses congés, ses attestations) seulement. |
| H-11 | Conforme | Le gérant ouvre la caisse : session à son nom (« Karim Bennani », 300 DH), fermeture « Passation de shift » avec résultat (fond, attendu, trouvé, carte POS / TPE, « Caisse juste ») et rapport imprimable. |

État en base : session de Hamza ouverte (fond 500 DH) ; deux sessions de test du gérant fermées
(300 et 250 DH, justes) ; aucune vente.

## Partie C — Produits, suite et bilan (2026-11-20, Gérant, Commercial, Caissier)

Bilan de la partie : les cas déjà joués avec les chefs (C-01, C-03, C-04, C-05, C-07) gardent
leur statut ci-dessus ; les autres sont joués ici, au compte du gérant sauf mention.

| ID | Statut | Constat |
|---|---|---|
| C-02 | Conforme (20 / 25) | Créés ce jour : Ghriba 4,50 DH, Msemen 3,50 DH, Pizza individuelle 14,50 DH (prix repris des fiches), Eau minérale 50 cl et Soda 33 cl (revente), et par import Pain complet, Pain rond, Pain de mie, Chebakia. Manquent Macarons et Quiche (pas de fiche), Briouates (vente à la douzaine, constat 62), les deux plateaux (constat 61). La fiche choisie ne reprend ni le nom ni la catégorie : la catégorie reste « Pain » tant qu'on ne la change pas. Pendant le chargement des fiches, le formulaire affiche « Aucune recette disponible » (constat 104). |
| C-06 | Non joué | Pas de fiche « Macarons » ; même limite que les formats (C-05). |
| C-08 | Écart (bloquant) | La fiche du plateau beldi ne peut pas contenir de produits finis (constat 61, D-37) : produit non créé. |
| C-09 | Non joué | Le formulaire a bien un interrupteur « Sur commande », mais le plateau salé ne peut pas avoir de fiche (constat 61, D-40). |
| C-10 | Écart | Eau minérale créée en « Revente » (sans fiche, prix libre, prix d'achat 3,00 DH), vendable : elle apparaît en caisse (en rupture). Mais son stock ne peut pas venir d'un achat : une ligne de BC ne porte qu'une matière ou un consommable, jamais un produit (`purchase_order_items` sans produit ; le commentaire de `sourcing.helper.ts` le confirme) (constat 102), corrigé : achetée depuis par BC-2026-0010, 24 bouteilles en réserve). À la modification, la fiche rouvrait l'article en « Fabriqué », recette obligatoire, la liste des produits ne renvoyant pas sa nature (constat 101, corrigé). |
| C-11 | Écart | Croissant › Tarifs › « Prix par canal de vente » : Gros / B2B 4,50 DH enregistré. Ce prix n'est lu que par la caisse (sélecteur de canal) ; les commandes et les devis ne consultent ni les prix par canal ni les listes de prix (`order.controller.ts`) : il ne s'applique pas à une commande professionnelle (constat 103). |
| C-12 | Conforme (paramétré) | Pas de palier par quantité sur le produit (les paliers ne concernent que la vente au poids) ; il passe par une promotion : « Croissants par 50 », −10 % sur Croissant, quantité minimum 50, caisse et commandes. Application non vérifiée sur une commande : aucun client n'existe encore. |
| C-13 | Écart (corrigé, constat 100) | Second « Eau minérale 50 cl » : le serveur bute sur l'unicité du `slug`, l'erreur n'est pas rattrapée (« Unhandled Rejection », routes produits sans `asyncHandler` sous Express 4) et la requête reste sans réponse : « Enregistrement… » sans fin, aucun message, et le bouton des autres fiches reste bloqué jusqu'au rechargement (constat 100). |
| C-14 | Écart | Prix −2 : refusé par le navigateur seulement (« Value must be greater than or equal to 0. », en anglais). Prix 0 : produit créé sans avertissement. Le prix d'un produit fabriqué n'est pas saisissable (repris de la fiche) (constat 103). |
| C-15 | Écart | Eau minérale vendue 0,00 DH pour 3,00 DH d'achat : aucune alerte de marge (constat 103). Sur un fabriqué, le prix est figé sur la fiche : le cas ne peut pas se produire depuis la fiche produit. |
| C-16 | Écart | Impossible de laisser la catégorie vide à l'écran : « Pain » est présélectionnée, sans option « aucune » ; un oubli range donc l'article dans Pain. Le serveur, lui, accepte un produit sans catégorie (`categoryId` facultatif) (constat 104). |
| C-17 | Conforme (observé) | Boissons n'est rattachée à aucun atelier (les cinq ateliers ont chacun leur catégorie) ; un article de revente n'est pas produit, il ne tombe donc pas sur la boulangerie. |
| C-18 | Conforme | Photo choisie pour Croissant (fichier fourni par script au sélecteur), « Mettre à jour » : image envoyée au stockage de fichiers, toujours affichée après rechargement. |
| C-19 | Conforme | Msemen rendu indisponible (« Disponible à la vente » décoché) : il disparaît de la caisse, même de la liste « En rupture » (19 articles au lieu de 21), et reste au catalogue (« Inactif »). |
| C-20 | Écart | Suppression d'un produit sans mouvement (« Produit test suppression », importé pour l'essai) : refusée au gérant (403, `products.delete` réservé à l'administrateur), sans message à l'écran, alors que le bouton « Supprimer » lui est montré ; la confirmation ne nomme pas le produit. Produit désactivé à la place. Le cas « produit déjà vendu » reste à jouer (aucune vente) (constat 104). |
| C-21 | Conforme | Création par un chef vérifiée plus haut (C-02, C-03) ; modification refusée par les droits (`products.edit` : administrateur et gérant seulement). |
| C-22 | Conforme | Le Commercial voit le catalogue (et les boutons « Nouveau », « Importer CSV ») ; changer le prix de l'eau est refusé (403), sans message, la fenêtre reste ouverte (constat 104). |
| C-23 | Non joué | Le nombre d'articles par sachet se règle dans Paramètres › Règles de caisse, écran refusé au gérant (« Vous n'avez pas accès aux paramètres ») : à faire avec l'administrateur. |
| C-24 | Conforme | Import d'un fichier au format Loyverse (6 lignes) : « 1 ligne ignorée … — détail en console », puis « Import terminé : 5 créés ». « 12,50 » lu 12,50 DH, Chebakia vendue au poids, la ligne au prix « douze » écartée sans bloquer les autres. Réserves : le détail des lignes écartées ne s'affiche que dans la console du navigateur ; les produits importés sont « Fabriqué » sans fiche, même en Boissons (constat 104). |

État en base : 21 produits (dont Msemen indisponible et « Produit test suppression » désactivé,
à supprimer par l'administrateur) ; prix de gros du croissant 4,50 DH ; promotion « Croissants
par 50 » active ; photo du croissant.

## Partie D — Fiches techniques, suite et bilan (2026-11-21, Boulanger matin, Gérant, chefs, Caissier, Économe)

Bilan de la partie : les cas déjà joués avec les chefs gardent leur statut ci-dessus ; les
autres sont joués ici.

| ID | Statut | Constat |
|---|---|---|
| D-02 | Conforme | Rachid (boulanger matin) ajoute à la Baguette cinq étapes, chacune avec un type pris dans le référentiel : Pétrissage 15 min à 24 °C, Pointage 45 min à 24 °C, Façonnage 20 min, Apprêt 60 min à 26 °C, Cuisson 22 min à 250 °C. « Étapes enregistrées », durée totale 2 h 42. |
| D-03 | Conforme (paramétré) | Cuisson cochée « Contrôle qualité » : la fiche affiche « 1 point de contrôle » et prévient que l'étape bloque la suivante tant qu'elle n'est pas validée. Le blocage lui-même ne se vérifie qu'en production. |
| D-04 | Conforme | Perte de 2 % sur la farine : le coût passe de 82,50 à 84,18 DH et le détail des besoins demande 15,306 kg de farine. |
| D-05 | Conforme (réserve) | Le boulanger ne peut pas saisir la partie financière, et le message est clair : « Composition enregistrée (paramètres financiers réservés au gérant, non modifiés) ». Le gérant saisit 45 min de main-d'œuvre et 15 DH d'énergie : par pièce, matière 0,78 + main-d'œuvre et énergie 0,31 + frais indirects 0,16 = 1,25 DH. Ce coût de revient s'affiche à part du coût matière. Réserve : sans « Temps / fournée », la main-d'œuvre vaut la durée totale des étapes, temps d'attente compris (162 min), et le prix calculé monte à 5,01 DH (constat 110). |
| D-06 | Conforme (après correction, constat 113) | Joué sur Pain complet (gérant) : rendement passé de 120 à 250 pièces, les quantités restaient celles d'une fournée de 120 (15 kg de farine) et le coût par pièce baissait de moitié sans rien dire (constat 113). Après correction : bandeau « Rendement passé de 120 à 250 pièces », « Mettre à l'échelle (×2,083) » porte la farine à 31,25 kg, le sel à 687,5 g, l'eau à 20,833 l ; « Garder les quantités » reste possible. Rien enregistré (essai). |
| D-08 | Conforme (après correction, constat 109) | Rejoué : Pain complet créé par copie de la Baguette. Avant : Une fiche ne se duplique pas en entier. « Dupliquer » ne copie que la composition d'un format, dans la même fiche. Pain complet n'a donc pas été créé par copie (constat 109). |
| D-09 | Écart (corrigé, constat 107) | Une fiche sans aucun ingrédient est créée sans avertissement (« Recette créée — complète la composition »). Son coût affiche des tirets, sans signe « incomplète » (constat 107). |
| D-10 | Écart (corrigé, constat 107) | Une ligne à 0 g et une ligne à −5 g disparaissent sans message à l'enregistrement (constat 107). |
| D-11 | Écart (corrigé, constat 107) | Le même ingrédient saisi deux fois reste sur deux lignes, sans regroupement ni signalement (constat 107). |
| D-12 | Écart (corrigé, constat 108) | Un ingrédient sans coût (Colorant rouge) compte pour 0,00 DH. Le coût de revient paraît donc plus bas qu'il n'est, sans marque « incomplet » (constat 108). |
| D-13 | Conforme (partiel, complété par le constat 108) | Miel au kilo demandé en litres sans densité : un bandeau signale « 1 conversion d'unité douteuse… renseigne la densité » et la ligne porte un ⚠. Le miel reste pourtant compté dans le total, à 1 l = 1 kg (90 DH) (constat 108). |
| D-16 | Conforme | « Imprimer la fiche » produit un PDF dans le navigateur, avec le logo, la composition (dont la perte de 2,0 %) et les étapes. Les astuces sont en français, et en darija écrite de droite à gauche, lettres liées. En pied de page : TRIANGLE D'ORIENT SARL. Reste « Poids/pièce 1 g » sur la ligne du format (constat 60). |
| D-17 | Conforme (après correction, constat 111) | Rejoué : le gérant archive Pain rond puis le restaure. Avant : Le bouton « Archiver la sélection » est montré au gérant, mais le serveur refuse (403) sans message à l'écran. L'archivage et la restauration sont réservés à l'administrateur. Restauration non jouée (constat 111). |
| D-18 | Conforme | Eau minérale, article de revente : aucune fiche n'est exigée (voir C-10). |
| D-20 | Conforme (4 fiches sur 4) | Baguette, Pain rond, puis Pain complet (copie de la Baguette, farine complète, 18 % de perte à la cuisson, relié au produit) et Pain de mie (copie du Pain rond, + lait 2 l, beurre 1 kg, sucre 0,6 kg, 15 % de perte ; relié au produit, dont le prix passe de 12,50 à 14,50 DH, prix arrondi de la fiche, règle du constat 29). Chaque fiche a son poids brut, son poids cuit et sa perte à la cuisson. Pain rond reste non relié : le relier porterait son prix de caisse de 3,50 à 5,50 DH (multiplicateur ×3 de la fiche). |
| D-22 | Conforme (après correction, constat 114) | Deux onglets du gérant sur Pain de mie : A passe l'eau à 4,5 l et enregistre, B (resté sur l'ancienne version) passe le beurre à 1,2 kg et enregistre : l'eau revenait à 6,5 l, la modification de A était perdue sans avertissement (constat 114). Après correction : B reçoit « Cette composition a été modifiée par Karim Bennani à 18:25 depuis que vous l'avez ouverte. Rechargez la fiche… », rien n'est écrasé. |
| D-50 | Écart (corrigé, constat 106) | Fatima-Zahra (cheffe beldi) voit les 17 fiches, y compris celles de la pâtisserie. Elle a modifié l'Éclair au chocolat (ganache de 15 à 16 g, enregistré) : les droits de modification ne tiennent pas compte de l'atelier. Valeur remise à 15 g (constat 106). |
| D-51 | Conforme (décision révisée) | Modifier sa propre fiche : permis, comme pour D-21 (les chefs composent, le gérant valide par la version). Supprimer : refusé, car seul l'administrateur peut supprimer (`recipes.delete`). |
| D-52 | Non joué | Le cumul de rôles existe (`user_roles`), mais l'attribution d'un second rôle revient à l'administrateur. |
| D-54 | Conforme (droits) | L'Économe lit les fiches mais ne peut pas les modifier (pas de `recipes.edit`). Vérifié sur les droits : son compte est inutilisable. |
| D-55 | Écart (corrigé, constat 105) | Hamza (caissier) ouvre « Fiches techniques » : il voit la liste des 16 fiches, avec leurs coûts, et le bouton « Nouveau ». La lecture (`GET /recipes`) ne demande aucun droit ; seule la création est refusée (`recipes.create`) (constat 105). |
| D-56 | Conforme | Baguette : multiplicateur ramené de 3 à 2,4. Prix calculé 3,01 DH, marge 1,76 DH (58 %), écart nul avec le prix de caisse (3,00 DH). Enregistré. |

État en base : la Baguette a ses étapes, sa perte de 2 % et ses paramètres financiers ; une fiche
Pain rond a été créée (vide d'abord, pour D-09, puis composée), non liée au produit ; la
ganache de l'Éclair est revenue à 15 g.

## Partie E — Paramétrage de la production, suite (2026-11-21, Gérant)

| ID | Statut | Constat |
|---|---|---|
| E-03 | Non joué | Majorations globale et par catégorie : réglées dans Paramètres › Production, écran réservé à l'administrateur. |
| E-04 | Conforme (constaté) | L'arrondi au demi-dirham est actif (`au_demi_dh`) : les prix conseillés des fiches tombent sur ,00 ou ,50 (Baguette 3,50, Pain rond 5,50, Pain de mie 14,50). |
| E-05 | Conforme (partiel) | Taux de charges fixes −5 % : refusé par le navigateur (« Value must be greater than or equal to 0 », en anglais), rien d'enregistré (40 % conservé). Majoration de 1 000 % non jouable : elle se règle dans Paramètres (administrateur). |
| E-06 | Conforme (partiel) | Postes de travail créés avec leur coût horaire : Four 40 DH/h, Pétrin 25 DH/h, 480 min/jour. Ils servent au coût de main-d'œuvre standard des gammes, à la charge des postes et à l'écart main-d'œuvre standard / réel ; le coût réel d'un plan ne les compte pas directement (il s'appuie sur les étapes et les paramètres de la fiche). |
| E-07 | Écart | Le gérant ouvre Production › Paramétrage et l'enregistre (tolérance de surproduction 0 → 10 % acceptée, remise à 0) ; le scénario prévoyait un paramétrage réservé à l'administrateur. L'onglet Impressions demande trois fois ses réglages et reçoit trois refus (403) sans rien afficher (constat 127). |
| E-08 | Non joué | Passage du contrôle des droits en mode bloquant : Utilisateurs › Rôles, administrateur. NB : la garde des modules est en mode « observation » sur la base de développement (constat 105). |

## Parties I et T — Contrôles de fin de scénario et cas transverses (2026-11-21, Gérant, Caissier)

Les contrôles réservés à l'administrateur (vue d'ensemble du paramétrage, écran Qualité des
données) n'ont pas pu être joués à l'écran ; leurs faits ont été vérifiés en base quand c'était
possible.

| ID | Statut | Constat |
|---|---|---|
| I-01 | Non joué | Vue d'ensemble du paramétrage : écran réservé à l'administrateur. |
| I-02 | Non joué | Qualité des données : écran Paramètres réservé à l'administrateur. La liste des fiches signale désormais elle-même les compositions vides et les coûts incomplets (constats 107, 108). |
| I-03 | Écart (en partie corrigé) | Marges toutes positives (l'entremets, vendu à la personne, se lit sur 8 parts). Mais le coût matière d'un produit composé était faux d'un facteur 20 à 40 dans la vue qui valorise marges, coût des ventes, pertes et invendus (constat 115, corrigé) et dans la liste des fiches (constat 123, corrigé). Restent : Chebakia et « Produit test suppression » sans fiche, Pain rond non relié à sa fiche (le relier porterait son prix de 3,50 à 5,50 DH) ; le coût affiché sur la fiche produit (`cost_price`) est un instantané qui ne suit pas la fiche (Baguette 0,88 DH contre 1,25 DH). |
| I-04 | Conforme | Stock valorisé (Stock › Clôtures) : 34 556,99 DH = réceptions acceptées 31 470,49 DH + stock d'ouverture 2 205,00 DH (beurre doux, levure, miel, sel) + réévaluations au prix facturé 1 245,00 DH (chocolat 140 → 180 DH/kg, sucre 5,50 → 5,75) − mouvements de la partie G 363,50 DH (2 kg de beurre, 25 kg de farine, 30 œufs) : réconcilié au centime. |
| I-05 | Conforme (après correction, constat 116) | Fournisseurs (4411) : 2 631,00 DH = factures validées non payées (36 + 2 100 + 495). Avant correction : 20 715,50 DH, les deux brouillons nés d'une réception (18 084,50 DH) y figuraient déjà ; ils sont désormais en reçu non facturé (4417). |
| I-06 | Écart | Caisse (5161) −3 132,00 DH et banque (5141) −4 798,10 DH : exactement l'opposé des paiements (espèces 3 132, virements 4 798,10 ; chèque 3 000 en 5111). Aucun compte bancaire ni solde d'ouverture n'est paramétré ; les fonds de caisse des sessions (500, 300, 250 DH) ne sont pas des mouvements comptables. Un paiement en espèces de 3 132 DH a été accepté caisse vide, sans avertissement (constat 117). |
| I-07 | Conforme (après correction, constat 125) | La piste d'audit (mig 578) trace modifications et suppressions avec date, mais l'auteur manquait presque partout (fiches 66/66, produits 10/10, fournisseurs 7/7 sans auteur). Corrigé : toute requête authentifiée porte son auteur ; vérifié sur une modification de la fiche Pain de mie (« Karim Bennani »). La création n'est pas tracée dans la piste, par choix de la mig 578 (la ligne porte created_at). |
| I-08 | Écart | Écritures : 41 sur 41 équilibrées. Mais aucune TVA d'achat : toutes les lignes de BC, réceptions et factures fournisseurs sont sans taux, faute de code de TVA par défaut sur les articles et les catégories, alors que les fournisseurs sont assujettis ; aucune TVA récupérable n'est donc enregistrée (constat 124). |
| I-09 | Écart | 19 produits fabriqués, dont 16 reliés à une fiche (Chebakia sans fiche, Pain rond non relié, produit de test) ; le scénario en prévoyait 23 (macarons, quiche, briouates à la douzaine et les deux plateaux non créés, constats 61 et 62). Étapes saisies sur 3 fiches seulement (Baguette, Pain complet, Msemen). |
| I-10 | Conforme (sans donnée) | Plan directeur calculé sans erreur, mais vide : ni prévision (aucune vente) ni commande ferme. |
| T-01 | Conforme | Formulaire produit vide : le navigateur signale le premier champ obligatoire, puis le suivant (message dans la langue du navigateur). |
| T-02 | Conforme | Nom de 308 caractères : refus net du serveur, « Nom trop long » (le message affichait le nom technique du champ, « name: », retiré). |
| T-03 | Conforme (partiel) | Darija sur le PDF de la fiche (D-16), apostrophes et « & » conservés à l'écran (« Tranche d'opéra », « Société d'Épices & Cie — شركة التوابل »), accents corrects à l'export CSV. |
| T-04 | Conforme (après correction, constat 118) | « 1,5 » devenait « 15 » dans un champ numérique d'un navigateur en anglais ; la virgule est désormais comprise partout. L'import CSV lit « 12,50 » (C-24). |
| T-05 | Conforme (après correction, constat 119) | Double clic sur « Dupliquer » : deux fiches ; désormais une seule. |
| T-06 | Conforme (après correction, constat 114) | Deux sessions sur la même composition : la seconde est prévenue (D-22). Les autres formulaires (produit, BC) n'ont pas ce contrôle. |
| T-07 | Conforme (après correction, constat 121) | Session close pendant une saisie : retour à la connexion avec « Votre session a expiré. Votre dernière modification n'a pas été enregistrée… ». |
| T-08 | Conforme | Après chaque enregistrement de la journée, rechargement et contrôle en base : données présentes. |
| T-09 | Conforme (après correction, constat 120, éditeur de fiche) | « Retour » en pleine saisie : confirmation demandée, saisie conservée si l'on reste. |
| T-10 | Conforme (après correction, constat 122) | « eclair » trouve « Éclair au chocolat » (fiches, produits), « opera » trouve « Tranche d'opéra ». |
| T-11 | Conforme | Export CSV du stock valorisé : BOM UTF-8, séparateur « ; », virgule décimale, accents corrects (« Unité », « Coût unitaire »). |
| T-12 | Conforme (réserve) | Tablette 768 × 1024 : fiche technique, stock et poste de pesée sans défilement horizontal ; le menu latéral des modules tronque ses libellés (« Registre des… », « Emplaceme… ») (constat 126). |
| T-13 | Conforme | Caissier sur l'adresse des fiches : « Vous n'avez pas accès aux fiches techniques. » ; gérant sur les paramètres : « Vous n'avez pas accès aux paramètres. » |

## Constats à traiter

| # | Gravité | Constat | Cas |
|---|---|---|---|
| 1 | Moyenne | La fiche fournisseur n'a pas de délai de paiement. Les conditions ne se saisissent que facture par facture. | A-01, A-11 |
| 2 | Moyenne | Un fournisseur étranger n'a pas de type à lui : ICE et IF restent affichés comme obligatoires et la fiche reste « à compléter ». | A-04 |
| 3 | Faible | Dans le formulaire fournisseur, la touche Tab ne sort pas du champ « Devise des achats » du premier coup : la saisie au clavier se décale d'un champ. | A-02 |
| 4 | Faible | Un champ obligatoire vide affiche le message du navigateur, en anglais, au lieu d'un message de l'application. | A-08 |
| 5 | À confirmer | Un clic en dehors de la fenêtre « Nouveau fournisseur » a fermé le formulaire et perdu la saisie, sans demande de confirmation. Observé une fois. | T-09 |
| 6 | Bloquante (contournée) | Désactiver une catégorie parente laisse ses familles actives mais introuvables : le formulaire de matière affiche « Aucun résultat » sans explication, et plus aucune matière ne peut être créée. | B-01 |
| 7 | Haute | La liste des catégories d'une matière dépend d'un droit de comptabilité. Un rôle qui a le droit de créer une matière sans ce droit obtient une liste vide. | B-01, B-20 |
| 8 | Haute | Un coût saisi avec une virgule (« 5,5 ») devient « 55 » sans avertissement sur un navigateur en anglais. | B-06 |
| 9 | Moyenne | Une famille d'emballage ajoutée dans le référentiel est créée un niveau trop bas dans l'arbre des dépenses (niveau 3 au lieu de 2). Corrigé à la main pour « Barquettes et plateaux ». | B-16 |
| 10 | Haute | Un doublon de matière (même nom, autre casse) est accepté sans avertissement. | B-09 |
| 11 | Haute | Une création de matière refusée par le serveur n'affiche aucun message : l'utilisateur ne sait pas pourquoi rien ne se passe. | B-15 |
| 12 | Faible | Le formulaire de matière n'a pas de bouton « Enregistrer et nouveau » : pour 36 fiches, il faut rouvrir le formulaire 36 fois et resaisir le fournisseur à chaque fois. | B-02 |
| 13 | Faible | Formulaire « Consommable » : libellés sans accents (« Categorie », « Unite », « Cout unitaire », bouton « Creer »). | B-16 |
| 14 | Moyenne | Une matière sans coût est acceptée sans avertissement, alors que les coûts de revient qui l'utilisent seront faux. | B-14 |
| 15 | Levé | Les chefs voient bien la liste des matières dans la composition d'une fiche. | D-34 |
| 16 | Bloquante | Un produit fabriqué ne se crée pas sans recette, et une recette ne se compose pas sans format de production : l'ordre de saisie est imposé (formats, puis fiches, puis produits) sans que l'écran l'annonce au départ. | C-21, D-34 |
| 17 | Bloquante | Aucun format de production (contenant) sur une installation neuve : aucune fiche ne peut être composée. | D-34 |
| 18 | Corrigée (mig 615) | Aucune catégorie de production sur une installation neuve, et **aucun écran pour en créer** (la table `recipe_categories` n'avait qu'une route de lecture) : la liste « Catégorie de production » de la fiche restait vide. Elles sont désormais éditables dans Paramètres › Référentiel › Production et pertes (administrateur). Elles ne servent qu'au classement des fiches : les ateliers sont rattachés aux catégories de produits. | D-34 |
| 19 | Faible | Le chef reçoit un refus sur la gamme opératoire de sa propre fiche (appel refusé en arrière-plan). | D-34 |
| 20 | Haute | Une quantité en grammes d'une matière stockée à la pièce est comptée comme des pièces : 110 g d'œufs coûtent 132 DH au lieu de 2,40 DH. Le poids par pièce saisi sur la matière n'est pas utilisé. | B-04, D-13 |
| 21 | Corrigée | Un seul bouton enregistre la composition et les paramètres financiers : un chef obtient « Accès interdit » alors que sa composition est enregistrée. Le refus des paramètres financiers n'est plus une erreur. | D-34 |
| 22 | Moyenne | La création d'un format refusée faute de droit affiche « Erreur lors de l'enregistrement », et le bouton reste proposé au chef. | — |
| 23 | Faible | Dans la composition, la liste déroulante des composants est coupée par le bas du cadre : les choix sont invisibles tant qu'on ne tape pas. | D-34 |
| 24 | Corrigée (vente à la pièce) | Un produit lié à une fiche composée par format reprend le coût de toute la fournée comme coût unitaire (rendement lu à 1 au lieu de 60) : 155,10 DH de revient et 465,30 DH de prix au lieu d'environ 3 DH et 9 DH la pièce. Le prix de vente étant en lecture seule, il est impossible de le corriger à la création. | C-03, C-21 |
| 25 | Moyenne | Le chef ne voit aucun code TVA dans l'onglet Tarifs du produit. | C-01 |
| 26 | Faible | La première version d'une fiche affiche « Aucune différence » au lieu du contenu à valider. | D-07 |
| 27 | Corrigée | En vente au poids, le prix d'un produit fabriqué reste celui de la pièce : le poids d'une fournée composée par format vaut 0 côté serveur (vue `v_recipe_total_weight_kg`, ancienne composition seulement). | C-03 |
| 28 | Faible | Le poids brut affiché par la fiche (2,10 kg) ne suit pas les mêmes règles que celui du serveur (2,165 kg) : la fiche compte un volume sans masse volumique comme des grammes et ignore les pièces. | D-34 |
| 29 | Corrigée (mig 614) | Le prix de revient d'un produit fabriqué ne prend que la matière (Baguette 0,92 DH), alors que sa fiche calcule un coût de production avec structure (1,05 DH) et un prix conseillé de 3,16 DH HT. Les deux écrans proposent deux prix différents pour le même article, et les charges fixes saisies n'entrent pas dans le coût du produit. | C-01, E-02 |
| 30 | Moyenne | Les données de base n'ont pas de matière « Eau » : une fiche de pain ne peut pas déclarer son hydratation, et son poids brut est faux (15,6 kg au lieu d'environ 25 kg). À ajouter au scénario (matière à coût quasi nul, masse volumique 1). | D-01 |
| 31 | Faible | Formulaire produit : un clic sur le nom de la recette dans l'aperçu (au lieu de la liste) ne choisit rien, sans message ; le prix reste à 0. | C-01 |
| 32 | Corrigée | Le rendement d'un format ne se saisissait qu'en pièces : impossible de déclarer « une plaque donne 2 kg » pour un article vendu au poids. Migration 613. | D-01, C-03 |
| 33 | Haute | Un changement de rendement n'est pas une modification à valider : la photo de version (`fn_recipe_bom_snapshot`) ne contient que les composants des formats, pas leur rendement. Un chef peut passer de 100 à 120 pièces (ou en kg) sans que le gérant ait à créer de version, alors que tous les coûts unitaires changent. | D-07 |
| 34 | Moyenne | Ouvrir un produit fabriqué existant recalcule son prix depuis la fiche sans le dire : « Mettre à jour » enregistre le nouveau prix même si l'on venait modifier autre chose. | C-03 |
| 35 | Faible | Le prix affiché par la fiche (267,55 DH) n'applique pas l'arrondi des prix, que la fonction de coût applique (268 DH). | E-04 |
| 37 | Moyenne | Pas de famille de matière pour l'eau, et une matière qui ne s'achète pas (eau du réseau) apparaît en rupture et « à traiter » dans le stock. | B, D-01 |
| 38 | Corrigée | La perte à la cuisson saisie par un chef était perdue : elle n'était enregistrée qu'avec les paramètres financiers (réservés au gérant). Elle part désormais avec la composition. | D-01 |
| 39 | Moyenne | Comparaison des versions : composants listés deux fois (recette et format par défaut), nom technique `perte_standard_pct` affiché, auteur des modifications absent. | D-07, D-21 |
| 36 | Haute | Le multiplicateur de la fiche Cornes de gazelle est passé de 3 à 2,5 à 21 h 29 sans version à valider (même cause que le constat 33 : la photo de version ne contient pas les leviers financiers). | D-07 |
| 40 | Corrigée | Créer une préparation de base menait à une page blanche : l'écran de création allait vers l'ancienne page de préparation, supprimée lors de l'unification de l'éditeur. | D-23 |
| 41 | Corrigée (mig 616) | Une préparation de base au rendement en kilos était coûtée sur 1 kg (rendement de création) quand une autre fiche l'emploie : 60 g de pâte feuilletée valaient 6 % de la fournée (16,53 DH au lieu de 1,70 DH). Le rendement kilo du format par défaut est désormais recopié dans la recette à l'enregistrement ; la migration rattrape les bases existantes. | D-24 |
| 42 | Moyenne | Un format créé au kilo (« Kg pâte ») s'attache à la fiche avec un rendement par défaut en pièces (10 p.) : il faut basculer l'unité et ressaisir le rendement. | D-23 |
| 43 | Faible | La fiche d'une préparation de base affiche multiplicateur, prix de vente, marge et « Vente au point de vente », alors qu'elle ne se vend pas. | D-23 |
| 44 | Faible | La liste des unités d'une ligne de composition propose m, m², h et min pour une farine ; une matière stockée à la pièce (œufs) est proposée en grammes par défaut (l'alerte de conversion douteuse s'affiche bien). | D-24 |
| 45 | Faible | L'explosion à plat affiche les petites quantités en kilos à 3 décimales : sel « 0,001 kg » et « 0,00 DH » par croissant au lieu de 0,6 g. | D-24 |
| 46 | Moyenne | Aucun moyen d'abandonner des modifications non validées pour revenir à la version active : il faut tout ressaisir à la main. | D-07, D-25 |
| 47 | Moyenne | Une fiche affiche un coût calculé sur la composition en cours de ses préparations de base, modifications non validées comprises, tout en se disant « identique à la version active ». | D-25 |
| 48 | Faible | Liste des formats de production : colonne « Recettes » vide même pour les formats employés par des fiches. | E |
| 49 | Faible | Nouveau produit : la catégorie « Pain » est proposée d'office, quelle que soit la catégorie de production de la fiche choisie. | C-02 |
| 50 | Faible | Nouveau produit : une fiche saisie par pièce apparaît avec « Rend : 1 unité » au lieu du rendement de son format (40 pièces) ; le coût affiché, lui, est bien celui d'une pièce. | C-02 |
| 51 | Faible | Aucun type de format de production pour une préparation en bassine ou en cuve (crème, ganache, pâte) : « Moule / Découpe » utilisé faute de mieux. | D-27 |
| 52 | Faible | Une préparation qui contient déjà la fiche en cours reste proposée comme composant : la boucle n'est refusée qu'à l'enregistrement (message clair). | D-32 |
| 53 | Moyenne | Le nombre de pièces après découpe déclaré sur le format (6, 8, 48) n'est pas repris par la fiche : parts et rendement repartent de 1. Un produit lié à l'opéra aurait coûté le cadre entier. | D-29, D-31 |
| 54 | Haute | Une fiche ne se lie qu'à un seul produit, et une sortie déclarée exige un produit existant : le second produit d'une coupe (entremets opéra à côté des tranches) ne peut être créé que comme « Revente ». La découpe d'un cadre en deux produits n'est pas réalisable proprement. | D-31 |
| 55 | Moyenne | Pas de fiche « par personne » dont les quantités suivent le nombre de parts : il faut un format par taille. | D-30 |
| 56 | Corrigée | Déconnexions répétées pendant le scénario. Cause reproduite : quand le serveur ne répond pas (redémarrage, ici à chaque modification faite par une autre session de travail ; en production, un déploiement ou un démarrage à froid), `/auth/me` renvoie une erreur 500 et l'application la traitait comme « non connecté » : retour à l'écran de connexion alors que la session restait valide. Désormais seul un 401 ou 403 déconnecte ; une erreur réseau ou serveur est réessayée (8 essais, 1,5 s d'écart). Vérifié : redémarrage de l'API pendant un rechargement, la page reste ouverte. | — |
| 57 | Faible | Après un enregistrement de fiche, la page se recharge et remonte en haut ; la saisie reprend après un défilement. | D-29 |
| 58 | Haute | Un produit vendu en plusieurs formats (tarte individuelle, 6 et 8 personnes) n'est pas réalisable : le formulaire produit ne connaît que le format par défaut, et la fiche déjà liée n'est plus proposée pour les produits des autres formats. | C-05 |
| 59 | Haute | Produit vendu par personne : prix par personne saisi à la main (pas déduit de la fiche et de ses parts), mais prix de revient de l'entremets entier (60,62 DH pour 30,50 DH de prix) ; les marges sont fausses. | C-04 |
| 60 | Moyenne | Le poids standard par pièce (contrôlé à la production) ne se saisit pas sur la fiche : seulement dans Paramètres › Qualité des données, réservé à l'administrateur. | D-35 |
| 61 | Haute | Une fiche ne peut pas contenir de produit fini : un plateau assorti (beldi, salé) qui consomme des produits n'est pas modélisable. | D-37, D-40 |
| 62 | Moyenne | Pas d'unité de vente distincte de l'unité de fabrication : un produit se vend à la pièce, au poids ou par personne, sans conditionnement (douzaine, boîte de 6 ou 12). Les briouates fabriquées à la pièce ne se vendent pas à la douzaine. | C-06, C-07, D-39 |
| 63 | À décider | Une demande d'achat ne porte qu'un article et n'a pas d'approbation (l'approbation est sur le BC chiffré, mig 465). Le scénario (demande groupée, approbation et refus de ligne) est à réaligner, ou le besoin à réintroduire. | F-01 à F-04 |
| 64 | Haute | Sur une installation neuve, plusieurs contrôles d'achat sont en mode « avertissement » et n'empêchent rien : demande d'achat obligatoire pour un BC, séparation des tâches, DLC des lots, plafond espèces, achats hors contrat. Rien ne signale à l'administrateur qu'ils sont éteints. | F-09 |
| 65 | Moyenne | Attribuer une demande de prix à un autre devis que le mieux noté ne demande aucune justification. | F-08 |
| 66 | Faible | Le délai de livraison des devis n'entre pas dans la notation pondérée (prix, qualité, fournisseur). | F-07 |
| 67 | Haute | Un article ajouté à la main dans une demande de prix ne couvre pas la demande d'achat du même article : elle reste « à commander » et peut être commandée deux fois (sucre sur BC-2026-0001 puis BC-2026-0004). | F-05, F-17 |
| 68 | Haute | Le PDF du bon de commande n'a ni prix, ni TVA, ni total, et affiche la quantité en unité de base (2 670 unités au lieu de 89 caisses). | F-15 |
| 69 | Moyenne | Pas de taux de change du jour : le taux est saisi à la main sur chaque BC en devise (Paramètres › Devises vide). | F-18 |
| 70 | Faible | Un prix négatif sur une ligne de BC est effacé sans message (ligne « Prix à définir ») au lieu d'être refusé. | F-21 |
| 71 | Haute | Le responsable des achats n'a pas accès aux catégories de dépenses (403) : toutes ses lignes de BC sont « Sans catégorie » et un BC d'immobilisation est impossible (catégorie obligatoire, liste vide). Même cause que le constat 7. | F-19, F-20 |
| 72 | Moyenne | Boutons affichés sans le droit correspondant : module Achats complet et « + Nouveau BC » pour un chef, « Modifier », « Ajuster », « Supprimer » sur une fiche matière pour le responsable des achats (lecture seule). | F-01, F-05 |
| 73 | À vérifier | L'écran « Modifier le bon de commande » permet de saisir une quantité livrée qui, selon son texte, ajuste le stock directement, sans réception (ni lot, ni DLC). | F-19 |
| 74 | Faible | Approbations : identifiant technique de la catégorie d'achat affiché, compteur « 0 circuit actif » faux, numéros « AO- » (appel d'offres) pour les demandes de prix, colonne « Dernier prix payé » qui montre un prix seulement commandé. | F-10, F-12 |
| 75 | Haute | Réception : un refus du serveur (DLC dépassée, quantité hors tolérance) n'est pas affiché ; la fenêtre reste ouverte sans explication. | F-35, F-37 |
| 76 | Moyenne | Pas de quantité refusée ni de motif à la réception (casse, non-conformité) : il faut recevoir moins puis clôturer le reliquat. | F-36 |
| 77 | Moyenne | Aucune alerte pour une DLC proche à la réception ; un produit frais comme le lait n'exige ni lot ni DLC. | F-38 |
| 78 | Moyenne | Frais annexes de réception répartis au prorata de la valeur, pas au poids. | F-42 |
| 79 | Moyenne | Pas de retour fournisseur depuis les Achats ; seulement une décision de non-conformité dans Contrôle. | F-45 |
| 80 | Faible | Écran Réceptions : compteurs non rafraîchis après confirmation, « Tout reçu » laisse les contenants à 0, coût en devise à quatre décimales. | F-36, F-41, F-42 |
| 81 | Corrigée | « Éditer les lignes » d'une facture recréait les lignes sans lien avec le BC, la réception ni la catégorie : le rapprochement était perdu et un écart de prix n'était plus détecté (« Facture conforme »). Désormais l'écran renvoie l'id de chaque ligne et le serveur la met à jour sur place : même id, liens BC / réception / catégorie / emballage / BL conservés, blocages de la ligne gardés ; seules les lignes retirées sont supprimées. Une ligne reprise du BC lié porte sa ligne de BC. Même correction pour les factures clients. La fiche en cache est relue après enregistrement (sans quoi une réouverture montrait les anciennes lignes). Test `invoice-lines-edit-links.db.test.ts`. Vérifié à l'écran sur BRK-F-101 (liens remis en base, prix 5,45 puis 5,50 : même ligne, liens gardés, la facture réapparaît dans la réévaluation, 45,00 DH). | F-52, F-53 |
| 82 | Corrigée (mig 618) | Valider une facture dont le prix différait du coût du lot échouait (« column updated_at of relation ingredients does not exist », `accounting.repository.ts:1493`), et la réévaluation comparait le prix facturé au coût du lot frais d'approche compris (elle les aurait effacés). Désormais l'écart se mesure contre le prix de la ligne de réception, s'ajoute au coût du lot (frais conservés) et n'est appliqué qu'une fois par facture et par lot. Test `revaluation-receipt-price.db.test.ts`. | F-63 |
| 83 | Moyenne | L'écriture d'une facture fournisseur est passée dès sa création (à la réception), facture encore en brouillon ; la validation par le gérant n'a pas d'effet comptable et chaque édition extourne et repasse. | F-56 |
| 84 | Moyenne | Mise en litige réservée au gérant (refusée au responsable des achats), sans motif ni trace autre qu'une confirmation du navigateur. | F-54 |
| 85 | Moyenne | Avoir fournisseur seulement dans un paiement par chèque, et refusé quand il couvre tout le reste dû (chèque à 0). | F-62 |
| 86 | Faible | Paiements : espèces non rattachées à une session de caisse, chèque passé au journal OD, pas de choix du compte bancaire, étiquette « À vérifier » sur des factures conformes, messages génériques (« Erreur », « Accès interdit »). | F-55 à F-61 |
| 87 | Faible | Pas de catégorie de charge par ligne dans Factures reçues (catégorie de facture seulement). | F-65 |
| 88 | Moyenne | Tolérance de prix à la facture : `fn_validate_invoice` retient la plus large de 2 % et 0,50 DH par unité (`match_tolerances` à l'installation). Sur un article bon marché, 0,50 DH l'emporte : 10 % d'écart sur un sucre à 5,00 DH passe sans blocage. | F-52 |
| 89 | Moyenne | Contrôle d'une facture en brouillon : le titre dit « Facture conforme au rapprochement » alors que le tableau montre un écart de quantité (150 pour 90 reçus) et de prix ; les blocages ne sont calculés qu'à la validation, et l'éditeur de lignes n'avertit pas. Message de refus avec quantités à quatre décimales (« 150.0000 »). | F-53 |
| 90 | Haute | Pas d'acompte fournisseur : impossible de verser 50 % à la commande (F9), ni de le déduire de la facture finale ; pas de compte d'avance 4091, le seul paiement lié à un BC est une dépense en charge. | F-60 |
| 91 | Moyenne | Lots créés par la validation d'un inventaire (ADJ-…) sans DLC ni lot fournisseur, y compris pour une denrée périssable (levure fraîche) : ni FEFO ni alerte de péremption. | F-70 |
| 92 | Moyenne | Ouvrir un lot plus récent alors qu'un lot plus proche de sa DLC est en réserve : ni alerte ni justification demandée (le FEFO n'est qu'une proposition par défaut). | G-04 |
| 93 | Moyenne | Perte par « Ajuster » : pas de choix du lot ni de la zone ; la quantité est retirée en priorité du contenant ouvert au poste de pesée (25 kg de farine pris au pesage, pas à la réserve) ; mouvement sans lot ni coût ; champ « Motif de la perte » en double ; refus « Stock insuffisant » non affiché. | G-05, G-10 |
| 94 | Moyenne | Emplacements : seulement « Économat (sec) » et « Zone de pesage » à l'installation ; toute réception va en « sec », y compris beurre et lait ; œufs et lots d'inventaire sans emplacement. Pas de froid positif ni négatif proposé. | G-01 |
| 95 | Moyenne | Historique des mouvements incomplet : la fiche matière ignore les ouvertures vers le pesage et les retours ; la fiche lot n'a aucun historique (réception, ouverture, pesées, pertes). | G-12 |
| 96 | Faible | DLC affichée un jour plus tôt au poste de pesée (24/11 pour un lot au 25/11, décalage de fuseau probable) ; aucune notification de stock bas ; la notification « Inventaire à valider » reste après la validation. | G-06, G-07 |
| 97 | Moyenne | Fond de caisse : ni montant de départ paramétré, ni proposition du montant laissé à la clôture précédente (pourtant fourni par `/cash-register/last-amount`), ni écart d'ouverture calculé ; aucune écriture pour le fond. | H-01, H-05 |
| 98 | Moyenne | Sessions de caisse par utilisateur, sans notion de poste ni de tiroir : deux sessions ouvertes en même temps dans la même boutique, chacune avec son fond, sans avertissement. | H-06 |
| 99 | Faible | Caisse : textes sans accents (« Caisse fermee », « a vendre », « Resultat », « montant trouve »), prix au kilo sans unité sur la vignette, même image pour tous les produits, vignette en rupture sans message au toucher. | H-02, H-07, H-08 |
| 100 | Corrigée | Corrigé : les 20 routes produits passent par `asyncHandler` et une violation d'unicité (nom, code-barres) répond 409, « Un produit du même nom existe déjà. » à la création comme au renommage ; test `product-duplicate-name.db.test.ts` ; vérifié à l'écran (second « Eau minérale 50 cl » : message affiché, bouton rendu, aucun doublon en base). Constat d'origine : créer un produit en doublon fige l'écran : l'erreur d'unicité (`products_slug_key`) n'est pas rattrapée, les routes produits n'ont pas d'`asyncHandler` (Express 4), la requête reste sans réponse ; « Enregistrement… » sans fin, sans message, jusqu'au rechargement. Toute autre erreur levée sur ces routes ferait de même. | C-13 |
| 101 | Corrigée | Corrigé : la liste des produits renvoie `item_kind` (`productRepository.findAll`), la fiche rouvre l'eau minérale en « Revente » sans recette ; test ajouté à `product-item-kind.db.test.ts` ; vérifié à l'écran. Constat d'origine : modifier un produit de revente : la liste des produits ne renvoie pas `item_kind`, la fiche rouvre l'article en « Fabriqué » avec recette obligatoire ; il faut recocher « Revente » à chaque modification. | C-10 |
| 102 | Corrigée (mig 619) | Corrigé : un BC porte désormais une ligne « produit de revente » (`product_id`, type `product`, désignation et catégorie « Achats de marchandises » figées ; un produit fabriqué est refusé). La réception crée un lot produit en réserve (PA-AAMMJJ-NNNN, DLC, lot fournisseur en note), augmente le stock réserve du magasin et fixe le coût du produit (CMUP) ; la facture issue de la réception porte le produit ; l'écriture de réception débite 6111 (comptes 3111 et 6111 et catégorie créés par la migration). Extourne et correction d'une réception de produit : refus explicite (409), à traiter plus tard. Test `po-resale-product.db.test.ts`. Vérifié à l'écran : BC-2026-0010 chez Rif Boissons, 24 « Eau minérale 50 cl » à 3,00 DH, réception (lot PA-261121-0001, DLC 30/06/2027), facture RIF-F-5521 en brouillon, écritures AC-2026-00034 (6111 / 4417) et AC-2026-00035 (4417 / 4411). Constat d'origine : les produits de revente ne s'achètent pas : une ligne de BC ne porte qu'une matière ou un consommable ; boissons et autres marchandises n'ont aucun chemin d'entrée en stock par achat. | C-10, G-14 |
| 103 | Moyenne | Prix : les prix par canal (Gros / B2B) ne valent qu'en caisse, pas sur les commandes ni les devis ; prix 0 accepté sans avertissement ; aucune alerte de marge sous le coût d'achat ; prix négatif refusé par le seul navigateur. | C-11, C-14, C-15 |
| 104 | Faible | Fiche produit et catalogue : catégorie « Pain » présélectionnée (pas de « aucune »), nom et catégorie non repris de la fiche, « Aucune recette disponible » pendant le chargement ; suppression réservée à l'administrateur mais bouton montré, refus 403 muets (gérant, commercial), confirmation sans nom du produit ; import : lignes écartées détaillées en console seulement, produits importés « Fabriqué » sans fiche. | C-02, C-16, C-20, C-22, C-24 |
| 105 | Corrigée | Corrigé : nouveau droit « Recettes : consulter » (`recipes.view`), exigé par les 18 routes de lecture des fiches (liste, fiche, formats, composition, étapes, versions, PDF…) ; amorcé pour l'administrateur, le gérant, les chefs et le magasinier (donc l'Économe), pas pour la caisse ; réglable depuis l'écran des rôles. Seules les catégories et les rôles de composants restent en lecture libre (listes de référence sans coût). À l'écran, la liste et la fiche affichent « Vous n'avez pas accès aux fiches techniques. » au lieu des données. Test `recipes-read-permission.db.test.ts`, instantané des droits par route régénéré. Vérifié : le caissier reçoit 403 sur la liste, la fiche et le PDF, voit le message, et les plans de production restent accessibles ; la cheffe beldi lit toujours les fiches. Constat d'origine : lecture des fiches ouverte à tous : `GET /recipes` ne demande aucun droit. Le caissier et l'économe voient toutes les fiches, avec les coûts et les marges, et le bouton « Nouveau » est montré au caissier (la création, elle, est refusée). | D-54, D-55 |
| 106 | Corrigée (mig 620) | Corrigé : un chef ne modifie plus que les fiches de ses ateliers, comme pour les ordres de fabrication ; le droit « production.all_workshops » (administrateur, gérant) lève la restriction. Atelier d'une fiche : celui de la catégorie de son produit, sinon celui de sa catégorie de fiche, désormais reliée à un atelier (Paramètres › Ateliers, « Catégories de fiches techniques » ; reprise automatique : Salé → Salé / Traiteur, etc.). Une fiche sans atelier (préparations de base) reste commune. Les 21 routes d'écriture répondent 403 « Cette fiche relève de l'atelier Pâtisserie : vous n'en êtes pas membre. » ; créer ou déplacer une fiche vers l'atelier d'un autre est refusé de même. À l'écran : bandeau « Lecture seule », plus de crayon d'identité ni de bouton Enregistrer, panneaux substituts / sorties grisés ; l'impression reste possible. Test `recipe-workshop-rights.db.test.ts`. Vérifié avec Fatima-Zahra : Éclair, Pain rond et Briouates en lecture seule (enregistrement des étapes refusé, 403), Ghriba modifiable, Ganache (commune) modifiable. Constat d'origine : pas de séparation par atelier : `recipes.edit` vaut pour toutes les fiches. La cheffe beldi lit et modifie une fiche de pâtisserie. | D-50 |
| 107 | Corrigée | Corrigé : (1) une ligne qui désigne un composant sans quantité valide (vide, 0, négative) n'est plus écartée en silence : bandeau rouge, champ en rouge, et l'enregistrement est refusé avec « Quantité nulle, négative ou manquante : Sucre glace. Saisis une quantité supérieure à 0 ou supprime la ligne. » (le serveur refusait déjà) ; enregistrer une composition entièrement vide est refusé aussi. (2) Un composant saisi sur plusieurs lignes est signalé (bandeau orange, « Saisi sur plusieurs lignes » sous la ligne), sans être additionné ni bloqué : un ajout en deux temps peut être voulu. (3) « Composition vide » veut dire désormais « aucune ligne » (et non plus « coût nul ») : étiquette dans la liste, préparations de base comprises, et bandeau « Fiche incomplète : aucun composant » sur la fiche. Test `recipe-composition-checks.db.test.ts`. Vérifié à l'écran (Fatima-Zahra) : Plateau beldi assorti marqué vide (liste et fiche) ; sur la Ghriba, ligne Sucre glace en double à 0 puis −5 : deux bandeaux, enregistrement refusé, composition intacte. Constat d'origine : la saisie de la composition n'est pas contrôlée : une fiche sans ingrédient est acceptée sans avertissement, les lignes à zéro ou négatives disparaissent sans message, et un ingrédient saisi deux fois reste sur deux lignes, ni regroupé ni signalé. | D-09, D-10, D-11 |
| 108 | Corrigée (mig 621) | Corrigé : vue `v_recipe_cost_gaps` qui relève les trous du coût de revient d'une fiche, y compris à travers ses préparations de base : ingrédient sans prix, conversion d'unité douteuse (litres d'un ingrédient au kilo sans densité), préparation de base sans composant. La liste marque « Coût incomplet » (pastille orange) ; la fiche affiche « Coût de revient incomplet » avec le détail (« Colorant rouge (sans prix, via Glaçage) ») ; l'éditeur signale en direct un ingrédient sans prix (bandeau et « Sans prix : coût incomplet » sous la ligne). Les montants ne sont pas modifiés : la fiche est marquée, pas recalculée. Test `recipe-cost-gaps.db.test.ts`. Vérifié : aucune des 25 fiches actuelles n'est marquée à tort ; sur la Ghriba, ajout de Colorant rouge (0 DH) : bandeau et marque affichés, rien enregistré. Constat d'origine : un coût incomplet passe pour un coût juste : un ingrédient sans coût compte pour 0 DH, sans marque « incomplet ». Une conversion douteuse (litres sans densité) est signalée mais comptée quand même, à 1 l = 1 kg. | D-12, D-13 |
| 109 | Corrigée | Corrigé : bouton « Dupliquer la fiche » sur la fiche (permis même en lecture seule) : nom et catégorie de la copie, qui reprend paramètres, étapes, formats et composition, sans produit lié, sans versions ni sorties ; copie indépendante (`POST /recipes/:id/duplicate`, droit de créer, catégorie contrôlée par atelier). Test `recipe-duplicate.db.test.ts`. Vérifié (gérant) : Baguette dupliquée en « Pain complet » (Boulangerie), farine T55 remplacée par la farine complète sur la copie seule (la Baguette garde la T55), puis la fiche reliée au produit Pain complet. Constat d'origine : une fiche ne se duplique pas en entier : « Dupliquer » copie seulement la composition d'un format, dans la même fiche. Une variante (Pain complet à partir de la Baguette) se ressaisit entièrement. | D-08, D-20 |
| 110 | Corrigée (mig 622) | Corrigé : les types d'étape pointage, apprêt, cuisson et refroidissement sont marqués « temps d'attente » (référentiel, metadata.attente) ; sans « Temps / fournée », la main-d'œuvre vaut le temps actif des étapes (`fn_etapes_duree_active`) : 35 min sur la Baguette au lieu de 162. La vue `v_recipe_format_cost`, qui ignorait même le temps saisi, prend désormais « temps saisi, sinon temps actif », comme `fn_recipe_cost`. L'éditeur affiche « actif 35 » en indication, avec l'explication au survol. Test `recipe-labour-active-time.db.test.ts`. Vérifié sur le Msemen (sans temps saisi) : « actif 15 ». Effet : les fiches sans temps saisi voient leur coût de main-d'œuvre baisser (Msemen). Constat d'origine : main-d'œuvre par défaut : sans « Temps / fournée », le coût prend la durée totale des étapes, temps d'attente compris (pointage, apprêt). Sur la Baguette, cela fait 162 min et un prix calculé de 5,01 DH au lieu de 3,01 DH. | D-05 |
| 111 | Corrigée (mig 623) | Corrigé : le gérant archive et restaure les fiches (une ou une sélection) ; la suppression définitive reste à l'administrateur. Les droits sont renommés d'après ce qu'ils font (« Recettes : archiver une fiche » pour `DELETE /recipes/:id`, qui archive). Nouvelle route « mes droits par action » (`GET /users/me/action-permissions`) et crochet `useActionPermissions` : la liste ne montre que les boutons permis, et un refus éventuel s'affiche (« Action refusée »). Le bouton « Restaurer » en double sur les fiches archivées est retiré. Vérifié (gérant) : Pain rond archivé (confirmation nommant la fiche, « Fiche archivée — restaurable »), puis restauré depuis « Archivées » ; pas de bouton « Supprimer la sélection ». Constat d'origine : archiver, restaurer et supprimer une fiche sont réservés à l'administrateur. Les boutons sont pourtant montrés au gérant, et le refus (403) n'affiche aucun message. | D-17, D-51 |
| 112 | Corrigée | Corrigé : la cause était la compilation JIT de PostgreSQL, déclenchée par le coût estimé énorme des vues et fonctions de coût imbriquées (prix de vente, coût de revient) : la compiler coûtait bien plus que l'exécuter (liste des fiches : 68 ms sans JIT, 0,9 s avec, 9,6 s quand les statistiques des petites tables de fiches ont vieilli). Le JIT est désactivé pour les connexions de l'application (`SET jit = off`, config/database.ts). Vérifié : `GET /recipes` passe de 10 s à 50 ms. Constat d'origine : la liste des fiches a mis jusqu'à 10 s à s'afficher. | D (liste des fiches) |
| 113 | Corrigée | Corrigé : changer le rendement d'un format en pièces propose de mettre la composition à l'échelle (bandeau « Rendement passé de 120 à 250 pièces », boutons « Mettre à l'échelle (×2,083) » et « Garder les quantités ») ; la mise à l'échelle multiplie chaque quantité (3 décimales) ; rien n'est enregistré avant « Enregistrer ». Vérifié sur Pain complet (essai non enregistré). Constat d'origine : changer le rendement (D-06) ne touchait pas les quantités et ne prévenait pas : le coût par pièce baissait silencieusement (×0,48 de 120 à 250 pièces). | D-06 |
| 114 | Corrigée | Corrigé : la composition d'un format porte un jeton de version (horodatage en microsecondes) ; l'éditeur le renvoie à l'enregistrement et le serveur refuse (409, « Cette composition a été modifiée par … à HH:MM depuis que vous l'avez ouverte. Rechargez la fiche… ») si le format a changé entre-temps ; le jeton est rafraîchi après chaque enregistrement. Test `recipe-concurrent-edit.db.test.ts`. Vérifié à deux onglets (D-22). Constat d'origine : deux sessions sur la même fiche s'écrasaient en silence, le dernier enregistrement l'emportait. | D-22 |
| 115 | Corrigée (mig 624) | Corrigé : le coût matière d'un produit (`v_product_unit_cost`, qui valorise les marges de gestion, le coût des ventes à la clôture, les pertes et les invendus) lisait l'ancien calcul au prorata du poids (`v_recipe_format_cost`), remplacé ailleurs par `fn_recipe_cost` depuis la mig 409. Pour une fiche composée de préparations de base, il s'effondrait : croissant 0,04 DH au lieu de 1,75, pain au chocolat 0,09 au lieu de 3,41, éclair 0,14 au lieu de 4,25, pizza 0,14 au lieu de 4,17 ; les cornes de gazelle, vendues au kilo, recevaient un coût à la pièce (2,59 DH au lieu de 77,55 DH le kilo). La vue prend désormais la matière de `fn_recipe_cost` pour le format par défaut. Test `product-unit-cost-composed.db.test.ts`. Reste : `products.cost_price` (coût affiché sur la fiche produit) est un instantané qui ne suit pas la fiche (Baguette 0,88 DH contre 1,25 DH) ; il ne sert plus que de dernier repli. | I-03 |
| 116 | Corrigée | Corrigé : une facture fournisseur créée automatiquement depuis une réception et encore en brouillon n'est plus écrite aux fournisseurs : la dette reste en « reçu non facturé » (4417, écriture de réception) ; l'écriture 4417 → 4411 est passée à la validation de la pièce du fournisseur (`fromInvoice`, `invoiceRepository.validate` → `regenerateInvoiceEntry`). Les factures saisies depuis un document restent écrites à la création. Reprise : script `src/scripts/repost-draft-reception-invoices.ts` (extourne les brouillons déjà écrits), exécuté sur la base de développement (MA-2026-4471 et RIF-F-5521) ; **à exécuter en production au déploiement**. Au passage, la régénération d'une facture lit aussi son ticket d'origine (`source_sale_id`) et ne double plus une facture issue de la caisse. Test `reception-invoice-draft-posting.db.test.ts`. Vérifié : fournisseurs (4411) = 2 631,00 DH = factures validées non payées ; reçu non facturé (4417) = 18 084,50 DH = les deux brouillons. Constat d'origine : les brouillons nés d'une réception passaient aux fournisseurs dès leur création (4411 = 20 715,50 DH dont 18 084,50 DH non validés). | I-05 |
| 117 | Moyenne | Trésorerie (I-06) : aucun compte bancaire ni solde d'ouverture de caisse et de banque n'est paramétré dans le scénario ; les comptes 5161 (caisse) et 5141 (banque) sont donc négatifs (−3 132,00 DH et −4 798,10 DH), exactement l'opposé des paiements. Un paiement fournisseur en espèces de 3 132 DH a été accepté alors que la caisse comptable était vide, sans avertissement. À décider : bloquer ou avertir quand un paiement rend un compte de trésorerie négatif ; et ajouter les soldes d'ouverture au paramétrage de démarrage. | I-06 |
| 118 | Corrigée | Corrigé : dans un champ numérique, la virgule décimale dépendait de la langue du navigateur ; dans un navigateur en anglais, « 1,5 » devenait « 15 » sans avertissement (1,5 kg de beurre enregistrable comme 15 kg). Un gestionnaire global (`utils/decimalCommaInput.ts`, monté dans main.tsx) remplace la virgule tapée par un point dans tout champ numérique de l'application. Vérifié dans l'éditeur de fiche : virgule interceptée, « 1,5 » donne 1,5 (coût 127,50 DH pour 1,5 kg à 85 DH). | T-04 |
| 119 | Corrigée | Corrigé : un double clic sur un bouton d'enregistrement envoyait deux requêtes (le bouton n'était désactivé qu'au rendu suivant) : « Dupliquer » double-cliqué créait deux fiches « Essai double clic ». Garde globale (`utils/doubleClickGuard.ts`, montée dans main.tsx) : un second clic sur le même bouton principal ou d'envoi dans les 800 ms est ignoré ; les pavés et boutons +/− ne sont pas concernés. Test `doubleClickGuard.test.ts`. Vérifié : double clic → une seule copie. Les trois fiches d'essai ont été archivées. | T-05 |
| 120 | Corrigée (éditeur de fiche) | Corrigé dans l'éditeur de fiche : le bouton « Retour » du navigateur en pleine saisie changeait de page sans avertissement et la saisie était perdue (le rechargement, lui, était protégé). L'application utilise BrowserRouter, sans bloqueur de navigation : tant que la saisie n'est pas enregistrée, une entrée d'historique est empilée sur la même adresse ; « Retour » y revient et demande « Des modifications ne sont pas enregistrées. Quitter la fiche quand même ? ». Vérifié : refus → on reste, saisie intacte ; accord → retour à la liste, rien d'enregistré. Reste : les autres formulaires longs (fiche produit, BC, factures) n'ont pas cette garde ; une protection générale demanderait de passer au routeur « données » (createBrowserRouter + useBlocker). | T-09 |
| 121 | Corrigée | Corrigé : une session expirée pendant une saisie renvoyait à la connexion sans un mot, la modification en cours étant perdue. Le renvoi (intercepteur `api/client.ts`) note s'il s'agissait d'une écriture ; la page de connexion affiche « Votre session a expiré. Votre dernière modification n'a pas été enregistrée : reconnectez-vous, puis refaites-la. » (ou « Reconnectez-vous pour continuer. » après une simple lecture). Vérifié : session close pendant une saisie dans la fiche Pain de mie, « Enregistrer » → page de connexion avec le message ; rien d'enregistré. | T-07 |
| 122 | Corrigée | Corrigé : la recherche ne tenait pas compte des accents (« eclair » ne trouvait pas « Éclair au chocolat »). Aide commune `utils/searchText.ts` (casse et accents ignorés) appliquée aux listes des fiches techniques et du stock ; côté serveur, la recherche des produits compare les noms sans accents (`translate`, sans extension). Vérifié : « eclair » trouve l'éclair dans les fiches et dans les produits, « opera » trouve « Tranche d'opéra ». Les sélecteurs (SearchSelect) ignoraient déjà les accents. | T-10 |
| 123 | Corrigée | Corrigé : la liste des fiches recalculait le coût matière par pièce en divisant le coût de la fournée par le rendement ; pour une composition saisie par pièce (éclair, croissant, pizza), le résultat était faux d'un facteur 30 à 40 (éclair 0,14 DH au lieu de 4,25 DH). La liste lit désormais la matière par pièce de la source unique (`fn_recipe_cost`, format par défaut), en déduit la fournée (pièce × rendement) en saisie par pièce, et trie sur la même valeur. Vérifié : éclair 127,46 DH la fournée / 4,25 DH la pièce, croissant 1,75 DH, pizza 4,17 DH. | T-10, I-03 |
| 124 | Haute | TVA d'achat absente (I-08) : aucun article ni catégorie n'a de code de TVA par défaut ; les lignes de BC, de réception et de facture fournisseur sont donc sans taux, alors que les fournisseurs sont assujettis (sauf la ferme avicole et la société d'épices). Aucune TVA récupérable n'est enregistrée, les achats sont comptés TTC en charge. À décider puis paramétrer : taux par article (farine, sucre, beurre, chocolat… n'ont pas le même), proposé par défaut sur le BC ; et une alerte à la validation d'une facture d'un fournisseur assujetti sans TVA. | I-08 |
| 125 | Corrigée | Corrigé : la piste d'audit (mig 578) lit l'auteur dans `app.user_id`, que seuls quelques dépôts posaient ; la plupart des modifications étaient sans auteur (fiches, produits, fournisseurs). `authenticate` exécute désormais la suite de la requête dans `runWithActor` ; toute connexion empruntée pour écrire (requête d'écriture, transaction, connexion explicite) porte l'auteur, remis à zéro au retour au pool ; les lectures restent directes. Test `audit-actor-context.db.test.ts` (écriture simple, transaction, pas de fuite hors requête). Vérifié : modification de la fiche Pain de mie attribuée à Karim Bennani. | I-07 |
| 126 | Faible | Tablette (768 px) : le menu latéral des modules tronque ses libellés (« Registre des… », « Emplaceme… »). | T-12 |
| 127 | Faible | Paramétrage de la production (E-07) : le gérant l'ouvre et l'enregistre, alors que le scénario le réservait à l'administrateur (à décider : droit « Paramètres › Production » du gérant) ; l'onglet Impressions demande trois fois ses réglages (`/production/print-templates/settings`) et reçoit trois refus 403 sans message. | E-07 |

## Reste à jouer

Partie A : A-09, A-10, A-12, A-13, A-14. Partie B : 7 cas (conversions à voir dans les fiches, conversion en consommable, équipement, suppression). Partie F : F-39, F-40 (compte Économe inutilisable). Partie G : G-08, G-09 (à partir du 22/11,
première DLC atteinte), G-14 (second volet : vitrine et vente de l'eau). Partie H :
H-09 (imprimante à configurer). Partie C : C-06, C-09 (fiches manquantes), C-23 (administrateur),
second volet de C-20 (après une vente). Partie D : D-52 (double rôle, à attribuer par l'administrateur). Partie I : I-01, I-02 (administrateur). Partie E : E-03, E-08 (administrateur).
