# Plan d'action — coût de revient analytique

> **Avancement au 2026-11-23** — fait : 1.1 (bug de code, pas de données : mig 656), 1.7 (novembre
> recalculé, contrôle équilibré), décisions 2.1 (unités, faute de poids), 2.2 (temps standard),
> 2.3 (oui), 2.5 (refigé), 2.6 (clôture), lots A à F, amortissements et outillage (mig 660),
> valorisation des semi-finis. Restent à l'entreprise : 1.2 à 1.6 et 2.4 (données qu'elle seule
> connaît), puis la phase 4 (mise en production).

Établi le 2026-11-23, après la livraison du moteur analytique (mig 655, commit `f516a096`).
Conception du moteur : [COUT_DE_REVIENT_ANALYTIQUE.md](COUT_DE_REVIENT_ANALYTIQUE.md).

## 0. Point de départ (mesuré sur la base de dev)

| Élément | État |
|---|---|
| Moteur (centres, charges, personnel, capacité normale, sous-activité) | livré, 973 tests verts |
| Plan OF-2026-02427 | 3 390,58 DH (2,46 DH / pain) au lieu de 37 206 DH |
| Plans de novembre chiffrés | 1 sur 292 |
| Charges saisies | 2 (loyer 22 000, énergie 14 000) |
| Fiches dont le rendement est faux | 8 sur 16 produits |
| Produits sans poids unitaire | 16 sur 16 |
| Gammes (temps standard) | 0 ; étapes pointées : 0 ; rendements saisis : 0 |
| Produits sans code TVA | 21 sur 21 |
| Commits locaux non poussés sur origin | 602 ; production à la migration 505 |

Conséquence : le calcul est juste, mais il s'appuie sur des données incomplètes. La phase 1
(données) passe avant tout nouveau développement.

Qui fait quoi : **Toi** = saisie ou décision dans l'application ; **Claude** = développement,
correctif de données sur ton accord, vérification.

---

## Phase 1 — Fiabiliser les données (aucun développement)

### 1.1 Corriger le rendement des 8 fiches techniques — Toi + Claude

**Problème.** Ces fiches décrivent une fournée entière mais annoncent « 1 pièce » : le coût
prévu d'une baguette sort à 92 DH. L'écart « prévu / réel » de tous leurs plans est donc faux.

| Fiche | Coût de la fiche | Prix de vente |
|---|---|---|
| Baguette | 92,19 | 3,00 |
| Brioche | 137,83 | 11,00 |
| Ghriba | 74,42 | 4,50 |
| Msemen | 26,63 | 2,00 |
| Pain complet | 119,80 | 4,00 |
| Pain de mie | 196,81 | 17,00 |
| Tartelette aux fraises | 63,02 | 18,50 |
| Tranche d'opéra | 160,24 | 11,50 |

**Étapes.**
1. Toi : donner pour chaque fiche le nombre de pièces que produit la recette telle qu'elle est
   écrite (ex. Baguette : 100 pièces).
2. Claude : corriger le rendement des 8 fiches (migration de données, comme la mig 652).
3. Claude : vérifier que le coût par pièce de chaque fiche redevient inférieur au prix de vente.
4. Les plans déjà lancés gardent leur coût prévu figé ; seuls les nouveaux plans prennent le
   bon. Décider si on refige le prévu des plans de novembre (voir 2.5).

**Terminé quand** : aucune fiche active n'a un coût par pièce supérieur à son prix de vente
sans raison connue.

### 1.2 Renseigner le poids unitaire des 16 produits — Toi + Claude

**Pourquoi.** Sans poids, le coût d'un plan est partagé à la quantité : une baguette et un pain
de mie portent le même coût unitaire (2,46 DH).

**Constat.** Les lignes de plan n'ont pas de format (0 sur 500 en novembre) : le poids lu est
celui de la fiche (« poids d'une pièce »), pas le « Poids cuit » du format. Je n'ai pas trouvé
de champ pour ce poids dans l'éditeur de fiche : à vérifier avant de te demander de le saisir.

**Étapes.**
1. Toi : donner le poids cuit d'une pièce pour chacun des 16 produits (en grammes).
2. Claude : vérifier où ce poids se saisit ; s'il n'y a pas de champ, l'ajouter à la fiche
   technique, puis enregistrer les 16 poids.
3. Paramètre « Clé de répartition du coût entre les articles d'un ordre » : vérifier qu'il est
   sur « poids ».

**Terminé quand** : l'onglet Coûts d'un plan à plusieurs articles affiche des coûts unitaires
différents par article, sans le message « poids unitaire manquant ».

### 1.3 Compléter le référentiel des charges — Toi

**Où.** Production › Analyse des coûts › onglet Charges › « Nouvelle charge ».

**Étapes.**
1. Lister toutes les charges récurrentes hors salaires et hors matières. Liste de contrôle :
   assurances, eau, téléphone et internet, abonnements logiciels, amortissement du matériel
   (four, pétrin, véhicule), entretien et maintenance, produits d'entretien, honoraires du
   comptable, taxes (taxe professionnelle), frais bancaires, publicité, carburant et livraisons,
   gardiennage.
2. Pour chacune : choisir la nature (l'écran propose le comportement et le centre), saisir le
   montant mensuel prévu (une charge annuelle se divise par 12).
3. Vérifier l'énergie : aujourd'hui 14 000 DH dont 30 % fixe. Ajuster la part fixe d'après une
   facture (abonnement + minimum = part fixe).
4. Ne pas saisir les salaires (repris de la paie) ni l'énergie déjà comptée par les usages
   d'équipement.

**Terminé quand** : le total « prévu / mois » de l'onglet Charges correspond aux charges du
compte de résultat hors achats et hors personnel, à 5 % près.

### 1.4 Vérifier l'affectation du personnel — Toi

**Où.** Onglet Personnel. Affectation proposée d'après le rôle : 6 en Production (main-d'œuvre
directe), 3 en Commercial, 1 Achats, 1 Logistique, 1 Direction.

**Étapes.**
1. Corriger chaque salarié qui travaille pour plusieurs services (ex. gérant : 50 % Direction,
   30 % Production, 20 % Commercial). Le total doit faire 100 %.
2. Vérifier que le coût affiché vient de la paie (« dernière paie »), pas d'une estimation.
3. Tout nouveau salarié doit être affecté : sinon il est compté en Administration, avec un
   avertissement.

### 1.5 Fixer la capacité normale des centres — Toi

**Où.** Onglet Centres de coûts › Modifier un centre principal.

**Étapes.**
1. Production : saisir la production d'un mois normal (aujourd'hui calculée : moyenne des 3
   derniers mois, environ 72 900 unités). La saisir évite qu'un mois creux fasse baisser la
   référence.
2. Capacité maximale (facultatif) : ce que l'atelier peut sortir au mieux.
3. Laisser « auto » pour Achats, Administration et Commercial tant qu'on n'a pas 6 mois de recul.

### 1.6 Ajuster les clés et les cessions — Toi

1. Onglet Clés de répartition › « Surfaces occupées » : remplacer 70 / 20 / 10 par les surfaces
   réelles (m² atelier, boutique, bureaux).
2. Onglet Centres › centres auxiliaires : vérifier les cessions (Logistique 60 % Achats, 40 %
   Production ; Direction 100 % Administration).

### 1.7 Recalculer novembre et contrôler — Toi + Claude

1. Toi : onglet Période › « Recalculer les plans du mois » (292 plans).
2. Vérifier : contrôle « Équilibré » ; plans chiffrés 292 / 292 ; aucun avertissement.
3. Claude : comparer la somme des charges imputées aux plans avec le total « Imputées aux
   produits » de la période (écart attendu : arrondis).
4. Lire la sous-activité : si elle dépasse 15 % des charges fixes, soit la capacité normale est
   trop haute, soit l'activité est réellement basse.

**Fin de la phase 1** : les coûts de novembre sont exploitables pour décider des prix.

---

## Phase 2 — Décisions à prendre (avant les développements)

| N° | Décision | Options | Recommandation |
|---|---|---|---|
| 2.1 | Inducteur du centre Production | unités · poids · heures de main-d'œuvre · heures machine | Poids dès que 1.2 est fait ; heures machine quand les gammes existent (lot B) |
| 2.2 | Main-d'œuvre directe | pointage des étapes à l'atelier · temps standard des gammes · rester dans le centre | Temps standard des gammes : pas de saisie quotidienne |
| 2.3 | Charges de structure dans le prix de revient | oui (coût complet) · non (coût de production) | Oui pour fixer les prix ; le stock reste au coût de production |
| 2.4 | TVA des 21 produits | prix TTC avec code TVA · prix hors taxe | Renseigner le code TVA : les marges HT sont fausses pour un produit taxé sans code |
| 2.5 | Coût prévu des plans de novembre | refiger après 1.1 · laisser | Refiger : sinon l'écart prévu / réel reste faux tout le mois |
| 2.6 | Clôture mensuelle des coûts | figer les taux à la clôture · recalcul libre | Figer (lot C) : un coût publié ne doit plus bouger |

---

## Phase 3 — Développements (par ordre de priorité)

Chaque lot : migration + tests + vérification sur 5173 + commit sur main.

### Lot A — Coût propre à chaque article d'un plan (priorité 1)

**Objectif.** Dans un plan Baguette + Pain de mie, chaque article porte ses propres matières et
ses propres charges, au lieu d'une part du total.

1. Matières par article : répartir les matières consommées du plan d'après la nomenclature de
   chaque article (quantité théorique × quantité produite), puis ajuster au réel consommé.
2. Charges par article : appliquer le coût de l'unité d'œuvre de chaque centre aux unités
   d'œuvre de l'article (ses unités, son poids, sa valeur de vente).
3. Enregistrer le détail par article ; le coût des lots de produits finis le lit.
4. Écran : tableau « Coût et marge par article » avec matières, charges, revient, marge.
5. Test : plan à deux articles de coûts très différents ; la somme des articles égale le plan.

**Terminé quand** : le pain de mie et la baguette d'un même plan ont des coûts unitaires
cohérents avec leurs fiches.

### Lot B — Temps standard comme inducteur (priorité 2)

**Objectif.** Répartir la production selon le temps de fabrication sans pointage quotidien.

1. Toi : créer les gammes des produits (Production › Postes & gammes) : opérations, poste,
   durée, taille de fournée.
2. Claude : heures de main-d'œuvre et heures machine d'un plan = temps standard des gammes
   quand rien n'est pointé (le temps pointé reste prioritaire).
3. Main-d'œuvre directe imputée au taux horaire chargé × heures standard ; le reste du salaire
   est la sous-activité de main-d'œuvre, affichée à part.
4. Écran Période : heures payées, heures imputées, heures non productives.
5. Test : deux produits de temps différents, même quantité, coûts de main-d'œuvre différents.

### Lot C — Clôture analytique mensuelle (priorité 3)

**Objectif.** Un coût publié ne change plus ; la sous-activité est tracée.

1. Table des périodes analytiques : ouverte, clôturée ; taux de chaque centre figés à la clôture.
2. Clôturer un mois : recalcul final de tous ses plans, enregistrement des taux et des écarts.
3. Un mois clôturé n'est plus recalculé (modification du paramétrage sans effet sur lui).
4. Rapport de clôture : charges, imputé, sous-activité, écart sur budget, par centre.
5. Rouvrir un mois : gérant seulement, tracé au journal d'audit.
6. Test : modifier une charge après clôture ne change pas le coût des plans du mois.

### Lot D — Charges réelles depuis la comptabilité (priorité 4)

**Objectif.** Ne plus saisir le réel à la main.

1. Lier chaque charge du référentiel à un ou plusieurs comptes de la classe 6.
2. Réel du mois = écritures validées de ces comptes, par centre (ventilation analytique, mig 428).
3. Amortissements repris des immobilisations (dotation mensuelle par bien, affecté à un centre
   ou à un produit).
4. Écran Charges : colonne « Réel comptable », bouton « Reprendre le réel du mois » ; la saisie
   manuelle reste possible.
5. Rapprochement : charges de la classe 6 non rattachées à une charge analytique, listées.

### Lot E — Coût standard des fiches aligné sur les centres (priorité 5)

**Objectif.** Le coût prévu d'une fiche contient les mêmes charges que le coût réel, pour un
écart prévu / réel lisible, et un prix de vente conseillé.

1. Coût standard d'une fiche = matières + emballages + temps standard × taux + charges au coût
   de l'unité d'œuvre des centres (remplace « frais indirects + multiplicateur » de la fiche).
2. Prix de vente conseillé = coût de revient complet ÷ (1 − taux de marque cible).
3. Écart d'un plan décomposé : prix des matières, quantités consommées, rendement, temps,
   charges.
4. Fiche technique : bloc « Coût de revient complet et marge ».

### Lot F — Rapports de rentabilité (priorité 6)

1. Marge par produit et par famille sur une période : ventes réelles − coût de revient.
2. Seuil de rentabilité mensuel : charges fixes ÷ taux de marge sur coûts variables.
3. Tableau de bord : sous-activité des 12 derniers mois, taux d'utilisation, coût unitaire moyen.
4. Simulation : effet d'un volume ou d'un prix différent sur la marge.

### Lot G — Compléments du moteur (au besoin)

1. Inducteurs : nombre de commandes, consommation d'énergie mesurée (usages d'équipement),
   unités équivalentes (coefficient par produit).
2. Surface en m² et effectif saisis sur le centre, clés calculées automatiquement.
3. Budget annuel par centre, suivi mensuel budget / réel.
4. Capacité prévisionnelle tirée du plan directeur.
5. Sous-centres : cumul sur le centre parent ; postes de travail rattachés à un centre.
6. Choix de la méthode enregistrée (aujourd'hui : imputation rationnelle, les autres en
   comparaison).

**Dépendances.** A dépend de 1.1 et 1.2. B dépend des gammes. C dépend de 1.7. E dépend de A et
B. F dépend de C. D est indépendant.

---

## Phase 4 — Mise en production

1. Mesurer la production : mode de calcul actuel, charges saisies, nombre de plans chiffrés
   (lecture seule).
2. Sauvegarde de la base de production.
3. Pousser main sur origin (602 commits) : vérifier l'intégration continue avant le déploiement.
4. Déployer ; les migrations 506 à 655 s'appliquent. La 655 ne change aucun chiffre si la
   production est au « taux sur les matières ».
5. Paramétrer en production : charges (1.3), personnel (1.4), capacités (1.5), clés (1.6).
6. Activer le moteur (Analyse des coûts › « Activer le moteur analytique »).
7. Recalculer le mois en cours ; contrôle « Équilibré » ; comparer 5 plans avant / après.
8. Prévenir : le coût des lots de produits finis baisse (charges de structure exclues) ; les
   marges des rapports changent à partir du mois recalculé.

**Retour arrière** : repasser le mode à « taux sur les matières » et recalculer le mois ; aucune
donnée n'est perdue.

---

## Ordre conseillé

| Ordre | Action | Qui |
|---|---|---|
| 1 | 1.1 rendements des 8 fiches | Toi (quantités) + Claude |
| 2 | 1.2 poids (avec Claude) · 1.3 charges · 1.4 personnel · 1.5 capacités · 1.6 clés | Toi |
| 3 | Décisions 2.1 à 2.6 | Toi |
| 4 | 1.7 recalcul et contrôle de novembre | Toi + Claude |
| 5 | Lot A, puis lot B | Claude (gammes : Toi) |
| 6 | Lot C | Claude |
| 7 | Phase 4, mise en production | Toi + Claude |
| 8 | Lots D, E, F, puis G au besoin | Claude |
