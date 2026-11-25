# Matrice de conformité comptable et fiscale marocaine

Date : 24 novembre 2026. Livrable 2.

## 1. Avertissement

Ce document n'est pas un avis juridique ou fiscal. Il confronte ce que fait Kalum à des règles relevées dans les textes, avec le niveau de confiance de chaque source. **Toute ligne marquée « À valider » doit être revue par un expert-comptable marocain avant d'être codée.**

### Sources et niveaux de confiance

| Code | Source | Confiance |
|---|---|---|
| **CGI** | Code général des impôts, édition 2026, PDF de la DGI (intègre la loi de finances n° 50-25), lu article par article | Officiel lu |
| **NC 737** | Note circulaire DGI n° 737 du 27 février 2026 (loi de finances 2026), lue sur une copie hébergée par un cabinet | Doctrine officielle, copie tierce |
| **S** | Cabinet ou presse | Secondaire |
| **I** | Non confirmé, ou de mémoire | Incertain |

Non lus dans leur version officielle : loi n° 9-88, CGNC et PCGE, avis CNC n° 24, loi n° 69-21, pages CNSS. Le projet de loi de finances 2027 n'est pas voté ; ses mesures ne figurent pas dans la matrice.

### États

**Conforme** · **Partiel** · **Absent** · **Écart** (le logiciel fait autre chose que la règle) · **Non audité** (le code concerné n'a pas été lu dans cet audit).

## 2. Cadre comptable

| Exigence | Règle relevée | Source | État Kalum | Constat |
|---|---|---|---|---|
| Partie double, journal, grand livre | Loi 9-88 | S | Conforme | Équilibre garanti en base |
| Livre d'inventaire | Loi 9-88 ; CGI 145-II (inventaire détaillé à chaque clôture) | S ; CGI | Absent | Pas d'édition du livre d'inventaire |
| Comptabilité sous format électronique | CGI 145-I, directement applicable depuis la LF 2026 | CGI, NC 737 | Conforme | — |
| Fichier des écritures comptables à remettre au contrôle | CGI 210 ; format renvoyé à l'avis CNC n° 24 | CGI, NC 737 | Partiel | Export à 18 colonnes ; format de l'avis non confirmé |
| Numérotation séquentielle automatique | Avis CNC n° 24 | S | Conforme | Aucun trou mesuré |
| Aucune modification ni suppression sur période clôturée | Avis CNC n° 24 | S | Partiel | Vrai par triggers ; contournable par le compte de connexion (C-08) ; redatage silencieux (C-11) |
| Deux périodes ouvertes au plus | Avis CNC n° 24 | S | Écart, à valider | 36 périodes ouvertes dans la base simulée ; aucune limite |
| Traçabilité, archivage | Avis CNC n° 24 | S | Partiel | Journal d'audit et chaîne présents ; pas d'archive hors base |
| Conservation 10 ans | CGI 211 ; loi 9-88 art. 22 | CGI ; S | Partiel | Aucune purge ; politique de sauvegarde non auditée |
| Amende de 50 000 DH par exercice sans support électronique | CGI 191 bis | CGI | — | Enjeu du point précédent |
| Cinq états de synthèse (bilan, CPC, ESG, tableau de financement, ETIC) | Loi 9-88, CGNC | I | Partiel | Bilan, CPC, ESG présents ; tableau de financement et ETIC absents |
| Modèle simplifié sous 10 MDH de chiffre d'affaires | Loi 9-88 | I | Conforme | Seuil en dur, suggestion seulement |
| Exercice de 12 mois, dates libres | Loi 9-88 | I | Écart | Année civile en dur |
| Clôture, à-nouveaux | CGNC | I | Partiel | À-nouveaux générés ; pas d'affectation du résultat guidée |
| Plans comptables sectoriels (immobilier, assurances, crédit, coopératives, associations…) | CNC | S | Absent | Un seul plan, 109 comptes |

## 3. TVA

| Exigence | Règle relevée | Source | État Kalum | Constat |
|---|---|---|---|---|
| Taux | 20 % normal, 10 % réduit ; convergence achevée en 2026 | CGI 99, 247-XXXXI | Partiel | Table datée correcte ; 14 % et 7 % encore en dur dans cinq fichiers |
| Exonérations sans droit à déduction | Pain (farine, levure, eau, sel seulement), farines, lait, beurre animal, sucre brut… | CGI 91-I-A | Partiel | Code `EXO_SDD` présent ; pas de code « exonéré avec droit à déduction » |
| Fait générateur | **Encaissement** ; option pour les débits sur déclaration | CGI 95 | **Écart** | Défaut du logiciel = débits (C-04) |
| Périodicité | Mensuelle si chiffre d'affaires taxable ≥ 1 MDH, sinon trimestrielle | CGI 108, 110 | Partiel | Choisie à chaque export, pas de paramètre société ni de contrôle du seuil |
| Naissance du droit à déduction | Mois du paiement ; à exercer dans l'année | CGI 101-3° | Partiel, à valider | Droit rattaché au règlement qui solde la facture ; paiements partiels non proratisés ; délai d'un an non contrôlé |
| Prorata de déduction | Calculé en fin d'année, appliqué l'année suivante | CGI 104-I | Absent | Concerne directement une boulangerie-pâtisserie (pain exonéré, pâtisserie taxable) |
| Exclusions du droit à déduction | Véhicules de personnes, libéralités, missions et réceptions, achats sans facture conforme | CGI 106-I | Partiel | Drapeau par facture ; aucune règle par nature de dépense |
| Espèces : TVA non déductible au-delà de 5 000 DH par jour et 50 000 DH par mois par fournisseur | CGI 106-II | CGI | Conforme | Seuils en table datée |
| Déclaration : collectée − déductible, crédit reporté | CGI 110, 111 | CGI | **Écart** | Pas de report de crédit, pas d'écriture de liquidation (C-03) |
| TVA multi-taux | — | — | **Écart** | Sortie de la déclaration (C-02) |
| Relevé de déductions | Joint à la déclaration | CGI 112 | Conforme | Écran et fichier EDI |
| Retenue à la source de TVA | 75 %, ou 100 % sans attestation de régularité ; extension aux prestations de personnes morales par seuil de chiffre d'affaires du payeur (500 MDH au 1er juillet 2026, 350 MDH en 2027, 200 MDH en 2028) | CGI 117 ; NC 737 | Absent | — |
| Autoliquidation (déchets et métaux de récupération) | Depuis le 1er janvier 2026 | CGI 125 quinquies ; NC 737 | Absent | Marginal selon le secteur |
| Régularisation à la cession d'une immobilisation | Biens meubles conservés 60 mois | CGI 102, 104-II | Absent | — |
| Remboursement de crédit | Cas limitatifs | CGI 103 | Absent | — |
| TVA à l'importation | — | Non lue | Absent | — |
| Télédéclaration | Simpl-TVA | Non lue en entier | Partiel | Fichier du relevé de déductions généré |

## 4. Impôt sur les sociétés et impôt sur le revenu

| Exigence | Règle relevée | Source | État Kalum | Constat |
|---|---|---|---|---|
| Taux d'IS 2026 | 20 % ; 35 % si bénéfice ≥ 100 MDH ; 40 % crédit et assurances | CGI 19-I | Conforme | Paramétrable par exercice |
| Cotisation minimale | 0,25 % (0,15 % pour certains produits, dont farine, sucre, beurre, huile) ; minimum 3 000 DH ; base = chiffre d'affaires, produits d'exploitation, produits financiers, subventions | CGI 144-I | Partiel, à valider | 0,25 % et plancher présents ; taux de 0,15 % absent ; composition de la base à valider |
| Exonération de cotisation minimale | 36 mois après le début d'exploitation, 60 mois au plus après la constitution | CGI 144-I | Partiel | Case manuelle, sans calcul de date |
| Acomptes | Quatre acomptes de 25 % de l'IS de l'exercice précédent, avant la fin des 3e, 6e, 9e et 12e mois | CGI 170-I | Conforme, à valider | Échéances calculées en fin de trimestre civil |
| Déclaration du résultat | Trois mois après la clôture, avec état des ventes par ICE client | CGI 20-I | Partiel | Liasse et EDI présents ; état des ventes par ICE non identifié |
| Contribution sociale de solidarité | 1,5 % à 5 % selon le bénéfice, à partir de 1 MDH ; prorogée 2026-2028 | CGI 267-273 ; NC 737 | Absent | — |
| Report déficitaire | Quatre exercices ; part des amortissements sans limite | CGI 12 | Absent | Saisie libre |
| IR professionnel, auto-entrepreneur | Barème, 0,5 % du chiffre d'affaires encaissé | CGI 73 | Absent | Entreprises individuelles non couvertes |

## 5. Retenues à la source

| Exigence | Règle relevée | Source | État Kalum | Constat |
|---|---|---|---|---|
| Honoraires, commissions, courtages | 5 % vers les personnes morales (selon la qualité et le chiffre d'affaires du payeur, calendrier 2026-2028) ; 10 % vers les personnes physiques | CGI 15 bis, 73-II ; NC 737 | **Écart, à valider** | Un seul taux semé (10 %, marqué « à confirmer ») ; montant saisi, non calculé |
| Loyers professionnels | 5 % du brut hors taxe, depuis la LF 2026 | CGI 15 ter ; NC 737 | **Écart, à valider** | Semé à 10 % puis 15 % au-delà de 120 000 DH, qui est le régime des revenus fonciers des particuliers |
| Dividendes, intérêts, non-résidents | 10 %, 20 %, 10 % | CGI 19-IV | Partiel | Types présents ; pas de type non-résidents distinct |
| Versement | Dans le mois suivant le paiement | CGI 171-I | Partiel | Écriture de reversement ; état à reverser faux (I-07) |
| Déclaration des rémunérations versées à des tiers | Jointe à la déclaration du résultat | CGI 151-I | Absent | Pas d'état par bénéficiaire |

## 6. Facturation et règlements

| Exigence | Règle relevée | Source | État Kalum | Constat |
|---|---|---|---|---|
| Mentions de la facture | Série continue ; identité, IF, taxe professionnelle et ICE du vendeur ; nom, adresse et ICE du client ; TVA distincte ou mention d'exonération ; mode de paiement | CGI 145-III, VIII | Partiel | Champs présents ; rendu non vérifié dans cet audit |
| Ticket de caisse valant facture | Date, vendeur, désignation, quantité, prix, TVA le cas échéant | CGI 145-III | Non audité | — |
| Charges réglées en espèces | Déductibles jusqu'à 5 000 DH par jour et 50 000 DH par mois par fournisseur | CGI 11-II | Conforme | Alerte avant plafond |
| Amende de 6 % sur les ventes réglées hors banque à partir de 20 000 DH | CGI 193 | CGI | Non audité | Aucun contrôle identifié |
| Droit de timbre de quittance | 0,25 % sur les factures et tickets réglés en espèces, avec exclusions | CGI 252-I-B | **Absent, à valider** | Paramètre présent mais désactivé, fonction jamais appelée. À trancher pour les ventes en caisse |
| Facturation électronique | Base légale en place (CGI 145-IX) ; modalités par voie réglementaire ; aucun décret trouvé | CGI ; I pour le calendrier | Absent | À préparer : format structuré et numérotation sont les prérequis |
| Délais de paiement | 60 jours par défaut, 120 conventionnels ; déclaration trimestrielle pour tous depuis le premier trimestre 2026 ; amende indexée sur le taux directeur | Loi 69-21 | S | Absent | Mention de pénalités sur la facture seulement |

## 7. Immobilisations, provisions, divers

| Exigence | Règle relevée | Source | État Kalum | Constat |
|---|---|---|---|---|
| Taux d'amortissement | Usages de la profession ; pas de barème dans le CGI | CGI 10-I-F | Partiel | Durée saisie par bien ; pas de catégories |
| Véhicules de personnes | Taux minimal de 20 % ; base plafonnée à 400 000 DH TTC depuis la LF 2025 | CGI 10-I-F | Absent | — |
| Dégressif | Coefficients 1,5 / 2 / 3 ; exclu pour immeubles et véhicules de personnes | CGI 10-III-C | Partiel | Coefficients corrects ; exclusions non contrôlées |
| Non-valeurs | Cinq ans à taux constant | CGI 10-I-F | Absent | — |
| Créances douteuses | Provision déductible si recours judiciaire dans les 12 mois | CGI 10-I-F-2° | Absent | Classement sans écriture |
| Écarts de conversion | Évaluation au cours de clôture ; passif imposable, actif déductible | CGI 9-I-B, 10-II | Conforme | Réévaluation et provision présentes |
| Cadeaux publicitaires | 100 DH par unité au plus | CGI 10-I-B | Absent | — |

## 8. Paie

Le moteur de paie n'a pas été audité ici ; seules ses écritures l'ont été.

| Exigence | Règle relevée | Source | État Kalum | Constat |
|---|---|---|---|---|
| Comptabilisation des charges sociales et de l'IR | — | — | **Écart** | Seulement à la clôture du mois de paie (C-06) |
| Barème de l'IR 2025-2026 | Six tranches de 0 à 37 % | CGI 73-I | Non audité | Barèmes versionnés en table |
| Frais professionnels | 35 % jusqu'à 78 000 DH de brut annuel, sinon 25 % ; plafond 35 000 DH | CGI 59-I | Non audité | L'EDI 9421 déduit le taux d'un ratio : fragile |
| Charges de famille | 600 DH par personne, plafond 3 600 DH, depuis le 1er janvier 2026 | CGI 74-I ; NC 737 | Non audité | — |
| État 9421 | Avant le 1er mars | CGI 79-I | Partiel | Situation familiale déduite, plusieurs rubriques forcées à zéro |
| CNSS, AMO, formation professionnelle, SMIG | Taux et plafonds | S | Non audité | Sources officielles non lues |

## 9. Points à soumettre à l'expert-comptable

1. Régime de TVA à proposer par défaut, et schéma comptable de la TVA en attente d'encaissement.
2. Prorata de déduction d'une boulangerie-pâtisserie (pain exonéré, pâtisserie taxable) et classement de chaque famille de produits.
3. Droit de timbre de quittance sur les ventes en espèces en caisse.
4. Taux et cas des retenues à la source après la loi de finances 2026, selon la qualité du payeur.
5. Composition de la base de la cotisation minimale et cas du taux de 0,15 %.
6. Naissance du droit à déduction en cas de paiement partiel.
7. Format du fichier des écritures comptables selon l'avis CNC n° 24, et règle des « deux périodes ouvertes ».
8. Compte des ventes d'une activité de production (7111 ou 7121) et méthode d'inventaire à retenir.
9. Compte de régularisation à utiliser pour les charges constatées d'avance (le logiciel emploie 486).
10. Traitement comptable des chèques émis non encore débités.
