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
| E. Paramétrage de la production | 8 | 2 | 1 | 1 | 0 | 6 |
| A. Fournisseurs | 17 | 11 | 8 | 3 | 1 | 5 |
| B. Matières premières et emballages | 23 | 16 | 12 | 4 | 0 | 7 |
| C. Produits | 24 | 4 | 1 | 2 | 0 | 20 |
| D. Fiches techniques | 46 | 8 | 4 | 4 | 0 | 38 |
| F à I, T | 106 | 0 | 0 | 0 | 0 | 106 |

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
| 18 | Moyenne | Aucune catégorie de production sur une installation neuve ; le lien avec les catégories de vente n'apparaît pas. | D-34 |
| 19 | Faible | Le chef reçoit un refus sur la gamme opératoire de sa propre fiche (appel refusé en arrière-plan). | D-34 |
| 20 | Haute | Une quantité en grammes d'une matière stockée à la pièce est comptée comme des pièces : 110 g d'œufs coûtent 132 DH au lieu de 2,40 DH. Le poids par pièce saisi sur la matière n'est pas utilisé. | B-04, D-13 |
| 21 | Moyenne | Un seul bouton enregistre la composition et les paramètres financiers : un chef obtient « Accès interdit » alors que sa composition est enregistrée. | D-34 |
| 22 | Moyenne | La création d'un format refusée faute de droit affiche « Erreur lors de l'enregistrement », et le bouton reste proposé au chef. | — |
| 23 | Faible | Dans la composition, la liste déroulante des composants est coupée par le bas du cadre : les choix sont invisibles tant qu'on ne tape pas. | D-34 |
| 24 | Corrigée (vente à la pièce) | Un produit lié à une fiche composée par format reprend le coût de toute la fournée comme coût unitaire (rendement lu à 1 au lieu de 60) : 155,10 DH de revient et 465,30 DH de prix au lieu d'environ 3 DH et 9 DH la pièce. Le prix de vente étant en lecture seule, il est impossible de le corriger à la création. | C-03, C-21 |
| 25 | Moyenne | Le chef ne voit aucun code TVA dans l'onglet Tarifs du produit. | C-01 |
| 26 | Faible | La première version d'une fiche affiche « Aucune différence » au lieu du contenu à valider. | D-07 |
| 27 | Corrigée | En vente au poids, le prix d'un produit fabriqué reste celui de la pièce : le poids d'une fournée composée par format vaut 0 côté serveur (vue `v_recipe_total_weight_kg`, ancienne composition seulement). | C-03 |
| 28 | Faible | Le poids brut affiché par la fiche (2,10 kg) ne suit pas les mêmes règles que celui du serveur (2,165 kg) : la fiche compte un volume sans masse volumique comme des grammes et ignore les pièces. | D-34 |
| 29 | Haute | Le prix de revient d'un produit fabriqué ne prend que la matière (Baguette 0,92 DH), alors que sa fiche calcule un coût de production avec structure (1,05 DH) et un prix conseillé de 3,16 DH HT. Les deux écrans proposent deux prix différents pour le même article, et les charges fixes saisies n'entrent pas dans le coût du produit. | C-01, E-02 |
| 30 | Moyenne | Les données de base n'ont pas de matière « Eau » : une fiche de pain ne peut pas déclarer son hydratation, et son poids brut est faux (15,6 kg au lieu d'environ 25 kg). À ajouter au scénario (matière à coût quasi nul, masse volumique 1). | D-01 |
| 31 | Faible | Formulaire produit : un clic sur le nom de la recette dans l'aperçu (au lieu de la liste) ne choisit rien, sans message ; le prix reste à 0. | C-01 |
| 32 | Corrigée | Le rendement d'un format ne se saisissait qu'en pièces : impossible de déclarer « une plaque donne 2 kg » pour un article vendu au poids. Migration 613. | D-01, C-03 |
| 33 | Haute | Un changement de rendement n'est pas une modification à valider : la photo de version (`fn_recipe_bom_snapshot`) ne contient que les composants des formats, pas leur rendement. Un chef peut passer de 100 à 120 pièces (ou en kg) sans que le gérant ait à créer de version, alors que tous les coûts unitaires changent. | D-07 |
| 34 | Moyenne | Ouvrir un produit fabriqué existant recalcule son prix depuis la fiche sans le dire : « Mettre à jour » enregistre le nouveau prix même si l'on venait modifier autre chose. | C-03 |
| 35 | Faible | Le prix affiché par la fiche (267,55 DH) n'applique pas l'arrondi des prix, que la fonction de coût applique (268 DH). | E-04 |

## Reste à jouer

Partie A : A-09, A-10, A-12, A-13, A-14. Partie B : 7 cas (conversions à voir dans les fiches, conversion en consommable, équipement, suppression). Puis C (produits),
D (fiches techniques), E (suite), F (achats), G (stock), H (caisse), I (contrôles) et les
cas transverses.
