# Scénario 1 — Données de base et premier approvisionnement

Suite du scénario 0 (`SCENARIO_0_PREMIERE_CONFIGURATION.md`). Rédigé le 2026-11-19, **pas
encore joué**. Toutes les données sont fictives.

But : à la fin du scénario, la boulangerie peut produire et vendre. Les fournisseurs, les
matières, les produits et les fiches techniques existent ; le stock initial est entré par
un vrai circuit d'achat ; la caisse est ouverte.

## 0. Comment lire ce document

Chaque cas a un identifiant, un type et un résultat attendu.

| Type | Sens |
|---|---|
| N | Cas nominal : le chemin normal |
| V | Variante : une autre façon correcte de faire |
| L | Cas limite : valeur extrême ou situation rare |
| E | Erreur attendue : l'application doit refuser, avec un message clair |
| D | Droits : l'action doit être permise ou refusée selon le rôle |

Le résultat attendu décrit ce que le métier attend. Quand je ne connais pas le
comportement réel de l'application, la ligne commence par « À observer ». À l'exécution,
chaque cas reçoit un statut : conforme, écart, bloquant, non joué.

Prérequis : scénario 0 fait (rôles, ateliers, 12 comptes, catégories de vente).

Ordre imposé par l'application (constaté à l'exécution) : les formats de production
d'abord, puis les fiches techniques (partie D), puis les produits fabriqués (partie C).
Seuls les produits de revente se créent sans fiche.

## 1. Qui fait quoi (droits en base après les décisions du 2026-11-19)

| Action | Rôle qui en a le droit aujourd'hui | Conséquence pour le scénario |
|---|---|---|
| Créer un fournisseur | Responsable des achats, Gérant | Conforme au rôle prévu |
| Créer une matière première | Économe, Gérant | Décision : droit donné à l'Économe. Il crée, mais ne modifie ni ne supprime |
| Créer un produit | Chaque chef, Gérant | Décision : droit donné aux chefs. Modifier et supprimer restent au gérant |
| Créer une fiche technique | Chaque chef, Gérant | La fiche est la responsabilité du chef |
| Modifier ou supprimer une fiche créée | Gérant seulement | Décision : une fois créée, la fiche n'est plus modifiable par le chef |
| Créer une demande d'achat | Chefs, Économe, Responsable des achats | Conforme |
| Demande de prix, bon de commande, réception | Responsable des achats, Gérant | Conforme |
| Valider et payer une facture reçue | Gérant | Le Responsable des achats saisit et contrôle seulement |
| Ouvrir et fermer la caisse | Caissier, Gérant | Conforme |
| Paramètres (charges fixes, majoration) | Administrateur | Décision du scénario 0 |

## 2. Jeu de données fictif

### 2.1 Fournisseurs

| Code | Fournisseur | Fournit | Paiement | Particularité testée |
|---|---|---|---|---|
| F1 | Minoterie Atlas | Farines, semoule, levure | 30 jours | Fournisseur principal, livraison par sacs |
| F2 | Laiterie du Gharb | Beurre, lait, crème, fromage | 15 jours | Produits frais, DLC courte |
| F3 | Ferme avicole Zerhoun | Œufs | Comptant, espèces | Paiement en espèces, sans ICE |
| F4 | Comptoir Cacao et Fruits secs | Chocolat, amandes, sésame, miel | 30 jours | Second devis pour comparer |
| F5 | Épicerie de gros Al Baraka | Sucre, sel, huile, conserves, volaille | 30 jours fin de mois | Concurrent de F1 et F4 sur certains articles |
| F6 | Emballages du Nord | Boîtes, sacs, étiquettes | 30 jours | Consommables, pas des matières |
| F7 | Rif Boissons Distribution | Eau, sodas | 15 jours | Marchandise revendue sans transformation |
| F8 | Pâtisserie Import Lyon | Chocolat de couverture, purées de fruits | Virement à la commande | Fournisseur étranger en euros, frais d'approche |
| F9 | Froid et Fours Équipement | Four, contrat d'entretien | 50 % à la commande | Immobilisation et service |

### 2.2 Matières premières (36)

| Famille | Matières | Unité | Contenant | Particularité testée |
|---|---|---|---|---|
| Farines | Farine T55, Farine T45, Farine complète, Semoule fine | kg | Sac 25 kg | Achat par sac, usage au gramme |
| Levures | Levure fraîche, Levure chimique | kg | Bloc 500 g, boîte 1 kg | DLC courte (levure fraîche) |
| Sucres | Sucre semoule, Sucre glace, Miel | kg | Sac 50 kg, sac 10 kg, seau 5 kg | Miel : poids et volume |
| Beurre | Beurre doux, Beurre de tourage, Margarine | kg | Carton 10 kg, plaque 1 kg | Deux beurres proches (risque de doublon) |
| Lait, crèmes | Lait entier, Crème liquide 35 % | litre | Brique 1 L, bidon 5 L | Densité pour passer du litre au kilo |
| Œufs | Œufs frais | pièce | Plateau de 30 | Poids par pièce (55 g) |
| Chocolat | Chocolat noir de couverture, Cacao en poudre | kg | Sac 5 kg, boîte 1 kg | Acheté en euros chez F8 |
| Noix | Amandes entières, Poudre d'amande, Sésame | kg | Sac 10 kg | Allergènes |
| Matières grasses | Huile de tournesol | litre | Bidon 5 L | Volume |
| Fromages | Fromage râpé, Fromage frais | kg | Sachet 1 kg | DLC courte |
| Viandes, conserves | Blanc de poulet, Thon en conserve, Tomate concassée, Olives | kg | Barquette, boîte 2,5 kg | Chaîne du froid, conserve |
| Fruits et légumes | Fraises, Citron, Oignon, Pomme | kg | Cagette | Très périssable, pertes |
| Épices, arômes | Sel fin, Eau de fleur d'oranger, Vanille en gousse, Cannelle | kg, litre, pièce | Divers | Très petites quantités (2 g) |
| Gélifiants | Gélatine en feuille | pièce | Boîte de 100 | Unité à la pièce |

Emballages : boîte pâtissière 20 cm, boîte à gâteau 1 kg, sac à baguette, sachet kraft,
étiquette produit, papier cuisson, ficelle.

### 2.3 Produits (25) et préparations de base (6)

| Atelier | Produits | Particularité testée |
|---|---|---|
| Boulangerie | Baguette, Pain complet, Pain rond, Pain de mie | Vente à la pièce, gros volume, petit prix |
| Viennoiserie | Croissant, Pain au chocolat, Brioche, Chausson aux pommes | Dépendent d'une préparation de base (pâte feuilletée) |
| Pâtisserie | Éclair au chocolat, Mille-feuille, Tarte aux fraises, Entremets chocolat, Opéra, Macarons | Formats multiples, vente par personne, découpe d'un cadre, vente en boîte |
| Beldi | Cornes de gazelle, Chebakia, Ghriba, Msemen, Plateau beldi assorti | Vente au kilo, assortiment de plusieurs produits |
| Salé / Traiteur | Quiche au thon, Pizza individuelle, Briouates au poulet, Plateau salé | Vente à la douzaine, sur commande uniquement |
| Boissons | Eau minérale 50 cl, Soda 33 cl | Revente sans fiche technique |

Préparations de base (semi-finis) : pâte levée feuilletée, crème pâtissière, pâte sucrée,
ganache chocolat, pâte à pizza, sirop de miel.

## 3. Partie A — Fournisseurs (Responsable des achats)

| ID | Cas | Type | Attendu |
|---|---|---|---|
| A-01 | Créer F1 avec ICE, IF, RC, adresse, téléphone, délai de paiement 30 jours | N | Fiche créée, visible dans la liste, utilisable sur une demande de prix |
| A-02 | Créer F2 à F7 | N | 7 fournisseurs actifs |
| A-03 | Créer F3 sans ICE, paiement comptant en espèces | V | À observer : fiche acceptée ou ICE exigé ; si acceptée, un avertissement est attendu |
| A-04 | Créer F8 en euros, avec pays France | V | La devise du fournisseur est l'euro ; le taux de change du jour est demandé ou repris |
| A-05 | Créer F9 pour un équipement et un service | V | Fiche créée, sans famille de matières obligatoire |
| A-06 | Créer un second « Minoterie Atlas » | E | Doublon signalé ou refusé (même nom ou même ICE) |
| A-07 | Saisir un ICE de 10 chiffres au lieu de 15 | E | Refus avec le format attendu |
| A-08 | Laisser le nom vide | E | Champ obligatoire signalé, rien n'est enregistré |
| A-09 | Rattacher les articles à F1 avec leur prix d'achat et leur conditionnement | N | Le prix fournisseur apparaît sur la fiche de la matière |
| A-10 | Déclarer F1 fournisseur préféré de la farine, F5 en second | V | Le préféré est proposé en premier sur la demande d'achat |
| A-11 | Modifier le délai de paiement de F2 de 15 à 30 jours | V | Modification tracée dans l'historique de la fiche |
| A-12 | Désactiver F7 puis tenter une commande chez lui | E | Fournisseur inactif non proposé |
| A-13 | Supprimer F1 après qu'il a une commande | E | Suppression refusée, désactivation proposée |
| A-14 | Importer 3 fournisseurs par fichier CSV (accents, virgule décimale) | V | Import correct, accents conservés, journal d'import annulable |
| A-15 | Le Commercial tente de créer un fournisseur | D | Refus |
| A-16 | L'Économe consulte la liste des fournisseurs | D | Lecture permise, création refusée |
| A-17 | Nom en arabe et caractères spéciaux (« Société d'Épices & Cie ») | L | Enregistré et affiché sans altération, y compris sur un PDF |

## 4. Partie B — Matières premières et emballages (Économe ; corrections par le Gérant)

| ID | Cas | Type | Attendu |
|---|---|---|---|
| B-01 | Créer Farine T55 : famille Farines, unité kg, contenant sac 25 kg, seuil d'alerte 50 kg | N | Matière créée avec sa famille ; stock à zéro ; alerte de stock bas active |
| B-02 | Créer les 36 matières du § 2.2 | N | 36 matières, chacune dans une famille active |
| B-03 | Créer Lait entier au litre avec une densité de 1,03 | V | Une fiche technique peut l'utiliser en grammes ou en millilitres, la conversion est juste |
| B-04 | Créer Œufs frais à la pièce, poids par pièce 55 g | V | Une fiche peut demander 200 g d'œufs ; le besoin est converti en pièces |
| B-05 | Créer Miel au kilo et l'utiliser en millilitres sans densité | E | Conversion impossible signalée, pas de calcul silencieux faux |
| B-06 | Saisir un coût de « 7,5 » avec une virgule | L | Compris comme 7,50 DH, pas comme 75 ni refusé |
| B-07 | Saisir une quantité de 420 g | L | Reste affichée 420 g, pas 0,42 kg |
| B-08 | Créer Vanille en gousse utilisée à 2 g dans une fiche | L | Pas d'arrondi à zéro dans le coût ni dans le besoin |
| B-09 | Créer « Beurre doux » puis « Beurre Doux » ou « Beurre doux » avec un espace final | E | Doublon détecté ; sinon visible dans Qualité des données |
| B-10 | Fusionner deux fiches de beurre créées par erreur | V | Une seule fiche reste, les fiches techniques et le stock suivent |
| B-11 | Renseigner les allergènes : gluten, lait, œufs, fruits à coque, sésame | N | Allergènes enregistrés, repris plus tard par les produits |
| B-12 | Laisser une matière sans famille | E | Refus, ou signalement dans Qualité des données |
| B-13 | Choisir la famille inactive « Fruits secs » | E | Famille inactive non proposée |
| B-14 | Créer une matière sans coût | L | Acceptée, mais signalée : le coût de revient des fiches sera faux |
| B-15 | Saisir un coût négatif ou un seuil négatif | E | Refus |
| B-16 | Créer les 7 emballages comme consommables | N | Ils vont dans les emballages, pas dans les matières |
| B-17 | Créer par erreur « Sac à baguette » comme matière, puis le convertir en consommable | V | Conversion faite sans perdre l'historique |
| B-18 | Créer un « Four à sole » comme matière | E | À observer : un équipement durable doit aller en immobilisation, pas en stock |
| B-19 | Supprimer une matière déjà utilisée dans une fiche | E | Refus ; archivage ou désactivation proposé |
| B-20 | L'Économe crée une matière, puis tente de la modifier et de la supprimer | D | Création permise ; modification et suppression refusées |
| B-21 | Un chef tente de modifier le coût d'une matière | D | Refus |
| B-22 | Le Responsable des achats consulte une matière et ses lots | D | Lecture permise, modification refusée |
| B-23 | Régler un seuil d'alerte sur une matière sans stock | L | Seuil retenu après enregistrement et rechargement de la page |

## 5. Partie C — Produits (chaque chef ; prix et corrections par le Gérant)

| ID | Cas | Type | Attendu |
|---|---|---|---|
| C-01 | Créer Baguette : catégorie Pain, vente à la pièce, prix, TVA | N | Produit créé, rattaché à l'atelier Boulangerie par sa catégorie |
| C-02 | Créer les 25 produits du § 2.3 | N | 25 produits, chacun dans sa catégorie |
| C-03 | Créer Cornes de gazelle vendues au kilo | V | La caisse demande un poids ; prix au kilo |
| C-04 | Créer Entremets chocolat vendu par personne (4 à 16 personnes) | V | Prix = prix par personne × nombre de parts ; tailles proposées |
| C-05 | Créer Tarte aux fraises en trois formats : individuelle, 6 personnes, 8 personnes | V | Un produit, trois formats, chacun avec son prix |
| C-06 | Créer Macarons vendus en boîte de 6 et de 12 | V | Le format porte la quantité de pièces |
| C-07 | Créer Briouates au poulet vendues à la douzaine | V | Unité de vente distincte de l'unité de fabrication |
| C-08 | Créer Plateau beldi assorti, composé de trois produits beldi | V | Le plateau consomme les produits qui le composent |
| C-09 | Créer Plateau salé disponible sur commande uniquement | V | Absent de la vente directe en caisse, présent en prise de commande |
| C-10 | Créer Eau minérale, revendue sans fiche technique | V | Vendable ; son stock vient d'un achat, pas d'une production |
| C-11 | Donner un prix différent pour le canal Gros | V | Le prix de gros s'applique sur une commande professionnelle |
| C-12 | Définir un palier : −10 % à partir de 50 croissants | V | Le palier s'applique à la bonne quantité |
| C-13 | Créer deux produits du même nom | E | Doublon refusé ou signalé |
| C-14 | Saisir un prix de vente à 0 ou négatif | E | Négatif refusé ; zéro signalé |
| C-15 | Prix de vente inférieur au coût de revient | L | Alerte de marge négative, sans blocage |
| C-16 | Produit sans catégorie | E | Refus |
| C-17 | Produit dans la catégorie Boissons, sans atelier rattaché | L | Tombe sur l'atelier par défaut (Boulangerie) : à observer et à corriger si besoin |
| C-18 | Ajouter une photo et la revoir après rechargement | V | Image conservée |
| C-19 | Rendre un produit indisponible | V | Il disparaît de la caisse, reste dans le catalogue |
| C-20 | Supprimer un produit sans mouvement, puis un produit déjà vendu | E | Le premier se supprime ; le second seulement s'archive |
| C-21 | Un chef crée un produit, puis tente de le modifier | D | Création permise ; modification refusée |
| C-22 | Le Commercial consulte les produits et tente de changer un prix | D | Lecture permise, modification refusée |
| C-23 | Régler le nombre d'articles par sachet pour la catégorie Viennoiserie | V | Repris par le contrôle des sachets en caisse |
| C-24 | Importer 5 produits par fichier, avec un prix « 12,50 » | V | Import correct ; une ligne en erreur n'empêche pas les autres |

## 6. Partie D — Fiches techniques (chaque chef pour son atelier)

### 6.1 Cas communs

| ID | Cas | Type | Attendu |
|---|---|---|---|
| D-01 | Fiche Baguette : farine, eau, sel, levure ; rendement en pièces ; poids du pâton ; poids cuit | N | Coût matière par pièce calculé ; poids cuit renseigné |
| D-02 | Ajouter les étapes : pétrissage, pointage, façonnage, apprêt, cuisson, avec durées et températures | N | Étapes dans l'ordre, type d'étape choisi dans le référentiel |
| D-03 | Marquer la cuisson comme point de contrôle (CCP) | V | À la production, l'étape ne se clôt pas sans relevé |
| D-04 | Saisir un taux de perte (pâte restée dans le pétrin, casse) | V | Le besoin en matières tient compte de la perte |
| D-05 | Ajouter la main-d'œuvre (minutes) et les frais indirects | V | Coût de revient complet, distinct du coût matière |
| D-06 | Changer le rendement de 100 à 250 pièces | V | Les quantités de matières suivent en proportion |
| D-07 | Le Gérant modifie la fiche créée par le chef | V | Nouvelle version ; l'ancienne reste consultable et restaurable |
| D-08 | Le Gérant duplique la fiche Baguette pour créer Pain complet | V | Copie indépendante de l'original |
| D-09 | Fiche sans aucun ingrédient | E | Refus ou fiche signalée incomplète |
| D-10 | Quantité à zéro ou négative sur une ligne | E | Refus |
| D-11 | Le même ingrédient saisi deux fois | L | Signalé ou additionné : à observer |
| D-12 | Ingrédient sans coût dans la fiche | L | Coût de revient marqué incomplet, pas faussement bas |
| D-13 | Unité incompatible : un ingrédient au kilo demandé en litres sans densité | E | Conversion impossible signalée |
| D-14 | Modifier la fiche et vérifier que les étapes ne sont pas effacées | L | Les étapes restent ; défaut connu à surveiller |
| D-15 | Les allergènes du produit se déduisent des ingrédients | N | Croissant : gluten, lait, œufs, sans saisie manuelle |
| D-16 | Imprimer la fiche en PDF, avec une astuce rédigée en arabe | V | PDF lisible, texte arabe dans le bon sens |
| D-17 | Archiver une fiche, puis la restaurer | V | Archivée : absente des plans ; restaurée : de retour |
| D-18 | Fiche d'un produit revendu (Eau minérale) | L | Aucune fiche exigée |

### 6.2 Cas par atelier

| ID | Agent | Cas | Type | Attendu |
|---|---|---|---|---|
| D-20 | Boulanger matin | Fiches Baguette, Pain complet, Pain rond, Pain de mie | N | 4 fiches avec poids cuit et pertes à la cuisson |
| D-21 | Boulanger nuit | Tenter de compléter la fiche Baguette créée par le boulanger du matin | D | Refus : la fiche créée ne se modifie plus ; il demande la correction au gérant |
| D-22 | Gérant | Deux sessions du gérant modifient la même fiche en même temps | L | Conflit signalé, pas de perte silencieuse |
| D-23 | Chef Tourier | Créer la préparation de base Pâte levée feuilletée (farine, beurre de tourage, lait, sucre, sel, levure) | N | Préparation utilisable comme ingrédient d'autres fiches |
| D-24 | Chef Tourier | Fiches Croissant et Pain au chocolat à partir de la pâte feuilletée | N | Le coût et les besoins descendent jusqu'aux matières de la pâte |
| D-25 | Gérant | Changer le beurre de la pâte feuilletée | V | Le coût du croissant et du pain au chocolat change aussi |
| D-26 | Chef Tourier | Fiches Brioche et Chausson aux pommes | N | Fruits frais : perte à l'épluchage prise en compte |
| D-27 | Chef Pâtissier | Préparations Crème pâtissière, Pâte sucrée, Ganache chocolat | N | 3 préparations de base |
| D-28 | Chef Pâtissier | Fiche Éclair au chocolat : pâte à choux, crème pâtissière, glaçage | N | Deux niveaux de composition |
| D-29 | Chef Pâtissier | Fiche Tarte aux fraises par format : quantités propres à chaque taille | V | Chaque format a sa nomenclature ; pas de simple règle de trois |
| D-30 | Chef Pâtissier | Fiche Entremets chocolat vendue par personne | V | Les quantités suivent le nombre de parts |
| D-31 | Chef Pâtissier | Fiche Opéra produite en cadre, découpée en tranches et en entremets | V | Une production, deux sorties, chacune avec sa quantité |
| D-32 | Chef Pâtissier | Une préparation A contient B, et B contient A | E | Boucle refusée |
| D-33 | Chef Pâtissier | Trois niveaux : entremets → biscuit → sirop | L | Coût et besoins corrects à travers les trois niveaux |
| D-34 | Chef Beldi | Fiches Cornes de gazelle et Chebakia, vendues au kilo | N | Rendement en kilos ; coût au kilo |
| D-35 | Chef Beldi | Fiche Ghriba avec un poids standard par pièce | V | Poids par pièce contrôlable à la production |
| D-36 | Chef Beldi | Fiche Msemen, étapes rédigées en français et en arabe | V | Les deux langues sont conservées |
| D-37 | Chef Beldi | Fiche Plateau beldi assorti à partir de trois produits finis | V | Le plateau consomme des produits, pas des matières |
| D-38 | Chef Salé | Préparation Pâte à pizza, fiches Pizza et Quiche au thon | N | Viande et fromage : DLC courte reprise à la production |
| D-39 | Chef Salé | Fiche Briouates au poulet, fabriquées à la pièce, vendues à la douzaine | V | Conversion pièce ↔ douzaine correcte |
| D-40 | Chef Salé | Fiche Plateau salé pour 20 personnes, sur commande | V | Utilisable sur une commande traiteur |

### 6.3 Droits et cloisonnement

| ID | Cas | Type | Attendu |
|---|---|---|---|
| D-50 | Le Chef Beldi ouvre une fiche de Pâtisserie | D | À observer : lecture permise ou non ; modification refusée |
| D-51 | Un chef tente de modifier, puis de supprimer, sa propre fiche après création | D | Refus dans les deux cas |
| D-52 | Une personne avec les deux rôles Chef Beldi et Chef Salé | D | Crée des fiches pour les deux ateliers ; n'en modifie aucune |
| D-53 | Le Chef Pâtissier utilise la pâte feuilletée du Chef Tourier dans sa fiche | V | Permis : une préparation de base se partage entre ateliers |
| D-54 | L'Économe consulte une fiche pour préparer une pesée | D | Lecture permise, modification refusée |
| D-55 | Un caissier tente d'ouvrir les fiches techniques | D | Refus |
| D-56 | Le Gérant corrige le prix de vente après lecture du coût de revient | V | Marge recalculée |

## 7. Partie E — Paramétrage de la production (Administrateur)

| ID | Cas | Type | Attendu |
|---|---|---|---|
| E-01 | Saisir les charges fixes : loyer, électricité, gaz, eau | N | Le point « Charges fixes de production » passe à fait |
| E-02 | Vérifier que le coût de revient d'une baguette augmente après E-01 | N | Le coût intègre une part de charges fixes |
| E-03 | Régler une majoration globale, puis une majoration propre à la Pâtisserie | V | La majoration de catégorie l'emporte sur la globale |
| E-04 | Régler l'arrondi des prix (au demi-dirham) | V | Les prix conseillés sont arrondis |
| E-05 | Saisir une charge négative ou une majoration de 1 000 % | E | Refus ou alerte |
| E-06 | Déclarer un four et un pétrin comme équipements, avec leur coût horaire | V | Le coût réel d'une production peut les compter |
| E-07 | Le Gérant tente d'ouvrir ces réglages | D | Refus : paramétrage réservé à l'administrateur |
| E-08 | Passer le contrôle des droits du mode observation au mode bloquant | V | Un accès hors droits est désormais refusé, plus seulement tracé |

## 8. Partie F — Premier approvisionnement (circuit d'achat complet)

### 8.1 De la demande à la commande

| ID | Agent | Cas | Type | Attendu |
|---|---|---|---|---|
| F-01 | Chef Tourier | Demande d'achat : 50 kg de beurre de tourage, 100 kg de farine T45 | N | Demande créée, en attente d'approbation |
| F-02 | Économe | Demande d'achat groupée pour tout le stock de départ | N | Une demande, plusieurs lignes |
| F-03 | Gérant | Approuver F-01, refuser une ligne de F-02 avec un motif | V | Ligne refusée tracée avec son motif |
| F-04 | Chef Tourier | Approuver sa propre demande | D | Refus : on n'approuve pas sa propre demande |
| F-05 | Responsable des achats | Demande de prix à F1, F5 et F4 pour la farine et le sucre | N | Trois fournisseurs consultés |
| F-06 | Responsable des achats | Saisir les trois devis : prix, délai, conditions | N | Comparateur rempli |
| F-07 | Responsable des achats | Retenir un devis par la notation pondérée | N | Le mieux noté est proposé, pas forcément le moins cher |
| F-08 | Responsable des achats | Retenir un devis qui n'est pas le mieux noté | L | Justification demandée et tracée |
| F-09 | Responsable des achats | Créer un bon de commande sans demande de prix | E | Refus : la demande de prix est obligatoire |
| F-10 | Responsable des achats | Un seul fournisseur répond à la demande de prix | L | À observer : attribution possible avec un seul devis ou non |
| F-11 | Responsable des achats | Bon de commande de 3 200 DH chez F3 | N | Sous le seuil : pas d'approbation supplémentaire |
| F-12 | Responsable des achats | Bon de commande de 18 000 DH chez F1 | N | Au-dessus de 5 000 DH : part en approbation chez l'administrateur |
| F-13 | Responsable des achats | Approuver son propre bon de commande | D | Refus |
| F-14 | Administrateur | Approuver F-12 ; puis refuser un autre bon avec motif | V | Bon approuvé envoyable ; bon refusé non envoyable |
| F-15 | Responsable des achats | Envoyer le bon au fournisseur, générer le PDF | N | PDF avec identité légale, lignes, TVA par ligne |
| F-16 | Responsable des achats | Modifier un bon déjà envoyé | E | Refus ou nouvelle version tracée |
| F-17 | Responsable des achats | Annuler un bon avant réception, avec motif | V | Bon annulé, demande d'achat à nouveau disponible |
| F-18 | Responsable des achats | Bon chez F8 en euros | V | Montant en euros et en dirhams au taux du jour |
| F-19 | Responsable des achats | Bon chez F6 pour des emballages | V | Les lignes vont vers les consommables |
| F-20 | Responsable des achats | Bon chez F9 : un four (immobilisation) et un entretien (service) | V | Ni l'un ni l'autre n'entre en stock ; le four crée une fiche d'immobilisation à la réception |
| F-21 | Responsable des achats | Ligne avec une quantité de 0 ou un prix négatif | E | Refus |

### 8.2 Réception

| ID | Agent | Cas | Type | Attendu |
|---|---|---|---|---|
| F-30 | Responsable des achats | Réception complète de F1 : 20 sacs de 25 kg de farine | N | 500 kg en stock ; saisie par contenant |
| F-31 | Responsable des achats | Numéro de lot et DLC à la réception du beurre | N | Lot créé, DLC enregistrée |
| F-32 | Responsable des achats | Réception partielle : 30 kg de beurre sur 50 commandés | V | Bon « partiellement reçu », reliquat de 20 kg attendu |
| F-33 | Responsable des achats | Seconde réception du reliquat | V | Bon soldé |
| F-34 | Responsable des achats | Réception de 52 kg pour 50 commandés | L | Dans la tolérance : accepté ; au-delà : alerte ou refus |
| F-35 | Responsable des achats | Réception de 80 kg pour 50 commandés | E | Hors tolérance : refus ou approbation exigée |
| F-36 | Responsable des achats | Réception d'œufs avec 2 plateaux cassés | V | Quantité refusée saisie avec un motif ; seule la quantité acceptée entre en stock |
| F-37 | Responsable des achats | Lait livré avec une DLC déjà dépassée | E | Réception refusée ou lot mis en quarantaine |
| F-38 | Responsable des achats | Lait livré avec une DLC dans 2 jours | L | Alerte de DLC trop proche |
| F-39 | Économe | Accepter la réception et ranger les lots dans un emplacement | N | Lots localisés ; l'économe prend le stock en charge |
| F-40 | Économe | Constater un écart au rangement (un sac de moins) | V | Écart signalé et tracé |
| F-41 | Responsable des achats | Deux réceptions de farine à deux prix : 500 kg à 5,00 DH puis 500 kg à 6,00 DH | N | Coût moyen pondéré de 5,50 DH le kilo |
| F-42 | Responsable des achats | Réception F8 avec 1 200 DH de transport et de douane | V | Frais répartis au poids sur les lignes ; le coût des matières augmente |
| F-43 | Responsable des achats | Réception sans bon de commande | E | Refus |
| F-44 | Responsable des achats | Clôturer un bon dont le reliquat ne sera jamais livré | V | Clôture forcée avec motif |
| F-45 | Responsable des achats | Retour au fournisseur d'un lot non conforme | V | Stock diminué, retour tracé |
| F-46 | Caissier | Tenter de faire une réception | D | Refus |

### 8.3 Factures et paiement

| ID | Agent | Cas | Type | Attendu |
|---|---|---|---|---|
| F-50 | Responsable des achats | Saisir la facture de F1 à partir de la réception | N | Facture en brouillon, rapprochée de la commande et de la réception |
| F-51 | Responsable des achats | Joindre le PDF de la facture | N | Pièce conservée |
| F-52 | Responsable des achats | Facture avec un prix supérieur au bon de commande | V | Écart de prix signalé |
| F-53 | Responsable des achats | Facture pour 50 kg alors que 30 kg sont reçus | E | Écart de quantité bloquant |
| F-54 | Responsable des achats | Ouvrir un litige et bloquer le paiement | V | Facture non payable tant que le blocage tient |
| F-55 | Responsable des achats | Valider la facture | D | Refus : validation réservée au gérant |
| F-56 | Gérant | Valider la facture conforme | N | Facture due ; écriture comptable passée |
| F-57 | Gérant | Payer F3 en espèces depuis la caisse | V | Sortie de caisse tracée, une seule fois |
| F-58 | Gérant | Payer F1 par virement | N | Facture soldée, dette fournisseur à zéro |
| F-59 | Gérant | Paiement partiel de F2 | V | Facture « partiellement réglée », reste dû exact |
| F-60 | Gérant | Verser l'acompte de 50 % à F9 avant livraison | V | Acompte rattaché au bon, déduit de la facture finale |
| F-61 | Responsable des achats | Saisir deux fois la même facture (même numéro, même fournisseur) | E | Doublon refusé |
| F-62 | Responsable des achats | Avoir du fournisseur pour les œufs cassés | V | Avoir imputé sur la facture |
| F-63 | Gérant | Facture F8 en euros, payée à un taux différent de celui de la commande | L | Écart de change constaté |
| F-64 | Gérant | Lever le blocage après accord avec le fournisseur | V | Facture de nouveau payable |
| F-65 | Responsable des achats | Répartir une facture sur deux catégories de charges, ligne par ligne | V | Chaque ligne garde sa catégorie |
| F-66 | Commercial | Ouvrir les factures reçues | D | Refus |

### 8.4 Variante sans achat : stock d'ouverture par inventaire

| ID | Agent | Cas | Type | Attendu |
|---|---|---|---|---|
| F-70 | Gérant, Économe | Entrer le stock de départ par un inventaire physique, sans bon de commande | V | Stock créé avec un coût ; aucune dette fournisseur |
| F-71 | Économe | Compter une matière absente de la liste | L | À observer : ajout possible pendant l'inventaire ou non |
| F-72 | Gérant | Valider l'inventaire et constater les écarts | N | Stock ajusté, écarts valorisés au coût |

## 9. Partie G — Tenue du stock (Économe)

| ID | Cas | Type | Attendu |
|---|---|---|---|
| G-01 | Consulter le stock après les réceptions | N | Quantités par matière, par lot, par emplacement |
| G-02 | Ouvrir un sac de farine pour la pesée | N | Le sac passe du stock scellé au stock entamé, avec son lot |
| G-03 | Choisir le lot à ouvrir : le plus proche de sa DLC d'abord | V | Le lot le plus ancien est proposé en premier |
| G-04 | Ouvrir un lot plus récent alors qu'un plus ancien existe | L | Alerte, sans blocage, ou justification demandée |
| G-05 | Casser un sac pendant la manutention | V | Perte saisie avec un motif, valorisée au coût |
| G-06 | Renvoyer un contenant entamé du poste de pesée vers l'économat | V | Stock scellé et entamé cohérents après le retour |
| G-07 | Une matière passe sous son seuil d'alerte | N | Alerte ; elle apparaît dans « À commander » |
| G-08 | Un lot atteint sa DLC | N | Lot signalé ; il n'est plus proposé à la pesée |
| G-09 | Envoyer un lot périmé aux pertes | V | Stock diminué, perte tracée avec son motif |
| G-10 | Sortir plus que le stock disponible | E | Refus |
| G-11 | Ajuster une quantité à la main | D | Refus pour l'Économe ; permis au Gérant, avec motif |
| G-12 | Consulter les mouvements d'un lot | N | Historique complet : réception, ouverture, pesées, pertes |
| G-13 | Le Responsable des achats tente d'ouvrir un lot | D | Refus : stock en lecture seule |
| G-14 | Stock de boissons après réception de F7 | V | Les boissons sont vendables sans production |

## 10. Partie H — Caisse (Administrateur, Caissiers)

| ID | Agent | Cas | Type | Attendu |
|---|---|---|---|---|
| H-01 | Administrateur | Définir le fond de caisse de départ | N | Montant enregistré, tracé en comptabilité |
| H-02 | Caissier 1 | Se connecter par sa tuile et son code PIN | N | Arrive sur « Caisse fermée » |
| H-03 | Caissier 1 | Saisir trois fois un mauvais code PIN | E | Refus ; blocage temporaire après plusieurs essais |
| H-04 | Caissier 1 | Ouvrir la caisse en comptant le fond | N | Session ouverte au nom du caissier |
| H-05 | Caissier 1 | Ouvrir avec un fond différent du montant attendu | L | Écart d'ouverture signalé et tracé |
| H-06 | Caissier 2 | Ouvrir une seconde session alors que la première est ouverte | L | À observer : refus ou seconde caisse |
| H-07 | Caissier 1 | Voir les produits disponibles par catégorie | N | Les 25 produits, classés ; les indisponibles absents |
| H-08 | Caissier 1 | Vendre un produit dont la vitrine est vide | L | Selon la règle de caisse : refus ou vente sans stock |
| H-09 | Caissier 1 | Imprimer un ticket de test | V | Ticket avec le nom de la société et les mentions |
| H-10 | Caissier 1 | Ouvrir les Paramètres ou le Personnel | D | Refus |
| H-11 | Gérant | Ouvrir la caisse à la place d'un caissier absent | V | Permis, tracé à son nom |

## 11. Partie I — Contrôles de fin de scénario

| ID | Agent | Cas | Type | Attendu |
|---|---|---|---|---|
| I-01 | Administrateur | Vue d'ensemble du paramétrage | N | « Fournisseurs et produits » et « Charges fixes » passent à fait |
| I-02 | Administrateur | Qualité des données | N | Liste des fiches incomplètes : poids cuit, allergènes, étapes, doublons, prix aberrants |
| I-03 | Gérant | Coût de revient et marge de chaque produit | N | Aucun coût à zéro, aucune marge négative non voulue |
| I-04 | Gérant | Valeur du stock après les réceptions | N | Égale à la somme des réceptions acceptées, au coût moyen |
| I-05 | Gérant | Dettes fournisseurs | N | Égales aux factures validées non payées |
| I-06 | Gérant | Solde de caisse et de banque | N | Fond de caisse, moins les paiements en espèces ; banque moins les virements |
| I-07 | Administrateur | Journal d'audit | N | Chaque création et modification porte son auteur et sa date |
| I-08 | Administrateur | Écritures comptables des réceptions et des factures | N | Équilibrées ; la TVA récupérable est séparée |
| I-09 | Chaque chef | Chaque produit de son atelier a une fiche complète | N | 23 produits fabriqués sur 23 (hors boissons) |
| I-10 | Gérant | Plan directeur : besoins nets de production | V | Calculables sans erreur à partir des fiches et du stock |

## 12. Cas transverses (à rejouer sur chaque écran de saisie)

| ID | Cas | Type | Attendu |
|---|---|---|---|
| T-01 | Valider un formulaire vide | E | Champs obligatoires signalés un par un |
| T-02 | Texte très long (300 caractères) dans un nom | L | Refus net ou troncature annoncée, pas d'erreur technique |
| T-03 | Caractères arabes, apostrophes, « & » | L | Conservés à l'écran, à l'export et sur les PDF |
| T-04 | Nombre avec virgule, avec point, avec espace de milliers | L | Compris correctement ou refusé clairement |
| T-05 | Double clic sur « Enregistrer » | L | Un seul enregistrement |
| T-06 | Deux personnes modifient la même fiche | L | La seconde est prévenue |
| T-07 | Session expirée pendant une saisie | L | Retour à la connexion, sans perte silencieuse |
| T-08 | Rechargement de la page après enregistrement | N | Les données sont bien là |
| T-09 | Bouton « Retour » du navigateur au milieu d'une saisie | L | Avertissement de modifications non enregistrées |
| T-10 | Recherche et filtres dans chaque liste | N | Résultats justes, accents ignorés |
| T-11 | Export Excel ou CSV de chaque liste | V | Fichier lisible, accents corrects |
| T-12 | Écran utilisé sur tablette | V | Utilisable au laboratoire et à l'économat |
| T-13 | Accès direct par l'adresse à un écran interdit | D | Refus clair, pas une page vide |

## 13. Matrice des droits à vérifier

O = doit pouvoir, N = doit être refusé.

| Action | Admin | Gérant | Achats | Économe | Chefs | Commercial | Caissier |
|---|---|---|---|---|---|---|---|
| Créer un fournisseur | O | O | O | N | N | N | N |
| Créer une matière | O | O | N | O | N | N | N |
| Modifier ou supprimer une matière | O | O | N | N | N | N | N |
| Créer un produit | O | O | N | N | O | N | N |
| Modifier ou supprimer un produit | O | O | N | N | N | N | N |
| Créer une fiche technique | O | O | N | N | O | N | N |
| Modifier ou supprimer une fiche créée | O | O | N | N | N | N | N |
| Créer une demande d'achat | O | O | O | O | O | N | N |
| Approuver une demande d'achat | O | O | N | N | N | N | N |
| Créer un bon de commande | O | O | O | N | N | N | N |
| Approuver un bon de plus de 5 000 DH | O | N | N | N | N | N | N |
| Faire une réception | O | O | O | N | N | N | N |
| Ouvrir un lot, peser, déclarer une perte | O | O | N | O | N | N | N |
| Ajuster le stock à la main | O | O | N | N | N | N | N |
| Saisir une facture reçue | O | O | O | N | N | N | N |
| Valider et payer une facture | O | O | N | N | N | N | N |
| Ouvrir et fermer la caisse | O | O | N | N | N | N | O |
| Ouvrir les Paramètres | O | N | N | N | N | N | N |

## 14. Décisions prises le 2026-11-19

| Sujet | Décision | État |
|---|---|---|
| Matières | L'Économe peut en créer | Appliqué et vérifié |
| Produits | Les chefs et le gérant peuvent en créer | Appliqué et vérifié |
| Fiches techniques | Le chef crée ; ensuite seul le gérant modifie ou supprime | Appliqué et vérifié |
| Mode d'exécution | Par les écrans | À suivre à l'exécution |
| Charges fixes | Montants réels | En attente des montants |
| Gestion des droits | Doit rester paramétrable | Elle l'est : Utilisateurs et droits › Rôles et contrôle, réservé à l'administrateur |

Conséquences à surveiller pendant l'exécution :

1. **Une fiche doit être complète dès sa création.** Le chef saisit en une fois le
   rendement, les ingrédients et les étapes. Les formats, les compositions à plusieurs
   niveaux et les sorties d'un cadre s'ajoutent après la création : ils reviennent donc au
   gérant (cas D-23 à D-33, D-37 à D-40). Une vraie solution serait un état « brouillon »
   que le chef peut corriger jusqu'à sa remise au gérant ; elle demande un développement.
2. **Les chefs n'ont pas de menu vers les produits.** L'écran Produits est rangé dans
   Ventes, qu'ils n'ont pas. Ils y accèdent aujourd'hui par l'adresse seulement.
3. **Le parcours « Pipeline »** (proposition, recette, coût, test, dégustation, validation)
   existe dans l'écran Produits mais reste réservé au gérant.

## 15. Hors périmètre, pour les scénarios suivants

Production d'une journée, ventes en caisse, commandes des particuliers et des
professionnels, fermeture de caisse et écarts, invendus, paie, relances clients,
promotions et fidélité, périodes fortes (Ramadan, Aïd).
