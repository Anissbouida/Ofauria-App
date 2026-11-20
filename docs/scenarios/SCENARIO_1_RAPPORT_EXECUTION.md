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
| C. Produits | 24 | 8 | 2 | 5 | 0 | 16 |
| D. Fiches techniques | 46 | 28 | 18 | 10 | 0 | 18 |
| F. Premier approvisionnement | 58 | 32 | 18 | 14 | 2 | 24 |
| G à I, T | 48 | 0 | 0 | 0 | 0 | 48 |

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
| F-14 | Non joué | Le compte administrateur est celui de l'utilisateur : BC-2026-0001 et BC-2026-0003 attendent son approbation. |
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
| F-30 | Non joué | Les deux BC de la Minoterie (BC-2026-0001 et BC-2026-0003) attendent l'approbation de l'administrateur (F-14). |
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

## Reste à jouer

Partie A : A-09, A-10, A-12, A-13, A-14. Partie B : 7 cas (conversions à voir dans les fiches, conversion en consommable, équipement, suppression). Partie F : F-14 (approbation par l’administrateur), puis F-30 ; F-39, F-40 (Économe) ; factures et paiements (F-50 à F-66), stock d’ouverture (F-70 à F-72). Puis C (produits),
D (fiches techniques), E (suite), G (stock), H (caisse), I (contrôles) et les
cas transverses.
