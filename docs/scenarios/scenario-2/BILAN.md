# Scénario 2 — Bilan (1er juin → 21 novembre 2026)

Exploitation simulée de la boulangerie-pâtisserie, jouée dans la base de développement
`ofauria_db` par 12 agents (un compte chacun) à travers les endpoints des écrans.
Détails : [SYNTHESES.md](SYNTHESES.md), [CONTROLES_GLOBAUX.md](CONTROLES_GLOBAUX.md),
[KPI_JOURNALIERS.csv](KPI_JOURNALIERS.csv), [COUVERTURE.md](COUVERTURE.md), [CONSTATS.md](CONSTATS.md).

## Chiffres clés

| Indicateur | Valeur |
|---|---|
| Journées jouées et clôturées | 174 sur 174 (2 sessions de caisse par jour, passation à 14 h) |
| Chiffre d'affaires caisse | 1 918 428 DH (109 407 tickets, panier moyen 17,53 DH) |
| Jours dans la cible 8 500 – 13 000 DH | 173 sur 174 (13/06 : 13 204 DH, avant l'abaissement du plafond de demande) |
| Ventes aux professionnels (BL) | 170 090 DH, facturées chaque mois (147 913 DH HT facturés au 21/11) |
| Coût matière des ventes caisse | 608 182 DH — marge brute matière 1 310 246 DH (68 %) |
| Achats reçus / fournisseurs payés | 632 548 DH / 549 990 DH (531 BC, 527 livrés et facturés) |
| Charges fixes payées | 217 066 DH (loyer, énergie, eau, internet) |
| Salaires payés | 396 337 DH (72 bulletins, mai → octobre) |
| Pertes de production / invendus jetés | 69 524 DH / 64 160 DH |
| Écart de caisse cumulé | −226 DH, chaque écart > 5 DH justifié |
| Appels d'écriture | 138 944 (55 opérations distinctes) |

## Contrôles (étape 11) sur toute la période

Tous conformes : sessions clôturées ; ventes = encaissements = fermetures de caisse ;
CA comptabilisé (71x) = caisse + factures clients (écart 90 DH) ; aucune écriture
déséquilibrée ni en double ; aucun stock négatif ; lots produits cohérents ; chaque BC
livré a sa facture ; prix d'achat dans la grille ; bulletins tous payés.

## Incidents (étape 7)

| Date | Incident | Résultat |
|---|---|---|
| 10/06 | Hausse du beurre +12 % | Conforme |
| 17/06 | Boulanger de nuit absent | Remplacé par le boulanger du matin, absence pointée |
| 24/06 | Fournée de croissants ratée (40) | Conforme : perte valorisée |
| 02/07 | Rupture d'œufs | Livraison reportée, bons remis avec manquants |
| 15/07 | Annulation après acompte | Conforme : acompte acquis (4421 → 7111), plans annulés |
| 30/07 | Commande pro urgente | Bloquée par le plafond de crédit de l'hôtel (contrôle conforme, plafond trop bas) |
| 12/08 | Erreur de rendu de monnaie (−50 DH) | Conforme : écart et motif enregistrés |
| 26/08 | Retour client | Conforme : 18 DH remboursés |
| 09/09 | Facture fournisseur en double | Conforme : refusée |
| 23/09 et 01/10 | Caissier hors droits | Conforme : annulation refusée (403), remise de 83 % refusée (plafond 10 %) |
| 07/10 | Deux ventes simultanées des derniers croissants | Conforme : une seule acceptée, vitrine jamais négative |
| 21/10 | Session expirée pendant une réception | Conforme : une seule réception après reconnexion |
| 04/11 | Dépassement du plafond de crédit | Test non concluant (refusé faute de lots) ; le blocage est démontré par 35 BL bloqués en juillet |
| 18/11 | Fermeture interrompue | Test non concluant (vente refusée faute de stock avant le contrôle de fermeture) |

## Défauts corrigés pendant la simulation (commits sur `main`, non poussés)

| N° | Défaut | Commit |
|---|---|---|
| 130 | Demande de mise en vitrine en 500 sur une quantité décimale (produit au kilo) : vitrine vide | 0bb913a0 (mig 625) |
| 131 | Vente au poids : 1 g vendu retirait 1 kg de vitrine | 3a2550ea |
| 132 | Retrait d'une commande avec solde en 500 | d3f2df05 |
| 137 | Écran Tickets : cartes calculées sur 200 tickets seulement | 727eedcd |
| 139 | Journées, numérotation et reçu au fuseau du navigateur (ou du serveur) au lieu de celui de la boutique | 80780783 |
| 140 | Totaux différents selon la vue de l'écran Tickets | 6a8b9aa2 |

## Corrigés après la simulation (2026-11-22)

| N° | Correction | Commit |
|---|---|---|
| 141 | Lot proposé par un bon de sortie réservé (quantités promises aux autres bons déduites), y compris à la re-vérification et à l'ouverture depuis l'économat ; lots pesés affichés sur le bon | 4c0507d6, cec9dc33 |
| 142 | Pesée d'une ligne sur plusieurs lots en FEFO, consommation et traçabilité par lot | b9751c40 (mig 626) |
| 133 | Variation de stock comptabilisée à l'inventaire complet ; reprise des 5 inventaires mensuels | 146d7d2d (mig 627) |
| 134 | Matière « non stockée » réglable depuis la fiche ; l'eau est déclarée non stockée | 93eccc3b |
| 143 | Générateur d'écriture des pertes (comptes faux, jamais appelé) retiré | 914105da |

## Reste à corriger avant une vraie exploitation

1. **138 — BC > 5 000 DH approuvés par l'administrateur seul** : décision du 25/10 à confirmer.
2. **124 (scénario 1) — TVA d'achat** : le code TVA par défaut se saisit maintenant sur la matière, le consommable et la catégorie, et il est proposé sur les lignes de BC ; codes validés article par article dans [TVA_ACHATS_CODES_2026.md](../../TVA_ACHATS_CODES_2026.md), à saisir par le propriétaire.
3. **135, 136** : RIB de la société (administrateur) ; fiches Pain rond et Chebakia manquantes.

## Limites de la simulation

- Les opérations passent par les **endpoints** des écrans, avec le compte de chaque agent ;
  les écrans eux-mêmes ont été vérifiés par le propriétaire sur 5173 (Tickets, Sessions de
  caisse), ce qui a révélé les constats 137, 139 et 140. Aucune journée n'a été pilotée
  entièrement au clic.
- Une paie de mai (8 716 DH) a été générée le 1er juin pour des salariés embauchés le
  1er mai sans activité pointée ; elle n'aurait pas lieu dans une ouverture réelle au 1er juin.
- La demande est tirée d'un modèle borné à la cible du propriétaire ; le panier moyen
  (17,5 DH) reflète un grand nombre de petits achats de pain.
- La base est revenue à l'heure réelle sur son conteneur d'origine ; sauvegarde de fin de
  simulation : `Ofauria-app-sauvegardes/ofauria_dev_20261122_scenario2_fin.dump`.
