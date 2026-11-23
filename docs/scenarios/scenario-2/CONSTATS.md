# Scénario 2 — Constats

Numérotation à la suite du scénario 1 (dernier : 129). Gravité : bloquant, majeur, mineur,
question. « Corrigé » = commit sur `main` (non poussé), journée rejouée depuis la sauvegarde.

| N° | Date simulée | Agent / écran | Constat | Gravité | Statut |
|---|---|---|---|---|---|
| 130 | 01/06 | Caissier — demande d'approvisionnement boutique | Une quantité décimale (cornes de gazelle, produit au poids fabriqué au kilo : 1,3 kg) faisait échouer **toute** la demande en 500 (« invalid input syntax for type integer ») : vitrine vide, aucune vente de la journée. | Bloquant | Corrigé (0bb913a0, mig 625), 01/06 rejoué |
| 131 | 01/06 | Caissier — Caisse, vente au poids | La caisse vend en grammes mais le stock d'un produit au poids est en kilos (unité de la production et du coût au kilo) : 1 g vendu retirait 1 kg de vitrine ; le produit devenait invendable après quelques grammes. Même erreur dans le contrôle de stock de l'écran Caisse, la remise de commande et l'annulation de ticket. | Bloquant | Corrigé (3a2550ea), 01/06 rejoué |
| 132 | 05/06 | Caissier — retrait d'une commande | Le retrait d'une commande avec solde échouait en 500 (« invalid input syntax for type integer: "12.000" ») : quantité de commande décimale recopiée dans le ticket (entier). Solde impossible à encaisser. | Bloquant | Corrigé (d3f2df05), 04-07/06 rejoués |
| 133 | 31/05 | Gérant — Stock › Inventaires | La validation d'un inventaire qui crée du stock (lots ADJ, 60 807 DH à l'ouverture) ne passe **aucune écriture comptable** : le stock 3121 n'existe pas en comptabilité tant qu'on ne le saisit pas à la main (OD). Les écarts d'inventaire mensuels ne sont pas comptabilisés non plus. | Majeur | Corrigé (mig 627 ; reprise : 5 écritures de variation, 3121 = 33 772 DH au 31/10) |
| 134 | 01/06 | Économe — bons de sortie | L'eau du réseau ne peut pas être déclarée « non stockée » depuis l'application (champ `non_stocke` absent des écrans et de l'API) : ligne en rupture sur chaque bon, remise « avec manquants » obligatoire, et une anomalie « Stock insuffisant : Eau » à chaque production de préparation de base (suite du constat 37). | Majeur | Corrigé (93eccc3b ; l'eau est déclarée non stockée) |
| 135 | 31/05 | Gérant — Paramètres › Banques | Le compte bancaire de la société ne peut être créé que par l'administrateur (paramétrage) ; le gérant reçoit 403. Conforme à la décision du scénario 0, mais les factures partent sans RIB tant que l'administrateur ne l'a pas saisi. | Question | Ouvert |
| 136 | 31/05 | Données | Pain rond et Chebakia sans fiche technique (cas C-06, C-09 du scénario 1) : non fabriqués pendant toute la simulation ; Quiche, Briouates, Macarons, plateaux absents du catalogue (constats 54, 58, 61, 62). | Question | Ouvert |
| 137 | 21/11 (vérification) | Gérant — Ventes › Tickets, vue « Par reçu » | Les cartes CA net, nombre de ventes et panier moyen ne totalisent que la page chargée (200 tickets au plus) : sur juin, l'écran affichait 200 tickets et 2 069 DH. Les heures sont affichées dans le fuseau du navigateur (un ticket de 14 h 05 à Casablanca apparaît à 13 h 05 sur un poste réglé en UTC). | Majeur | Corrigé (cartes) ; heure : à vérifier sur le poste |
| 138 | 03/06 | Responsable des achats — envoi d'un BC | Un BC de plus de 5 000 DH passe en approbation (202) adressée au seul rôle administrateur (décision du 25/10, mig 350) : le gérant ne peut pas l'approuver. 41 BC de farine et de laiterie sont restés en attente en juin, d'où des ruptures en viennoiserie. Contournement retenu : commandes fractionnées sous 5 000 DH. À trancher : approbation par le gérant jusqu'à un plafond ? | Question | Ouvert (décision du propriétaire respectée) |
| 139 | 03/06 (vérification) | Gérant — Ventes › Sessions, Tickets | Les heures dépendent du fuseau du poste (en-tête X-Timezone = fuseau du navigateur) et non de celui de la boutique : sur un poste réglé sur New York, une session ouverte à 07:00 à Casablanca s'affiche 02:00 – 09:00 ; l'écran Tickets a montré 13:05 pour un ticket de 14:05. Les journées comptables et les filtres « du jour » suivent aussi le fuseau du poste. | Majeur | Corrigé (journées, numérotation et reçu à l'heure de la boutique ; écrans à l'heure du poste) |
| 140 | 01/06 (vérification) | Gérant — Ventes › Tickets, vues | CA net et nombre de ventes différents selon la vue : 10 426,32 DH / 620 tickets (reçu, vendeuse, paiement) contre 10 243,32 DH et 716 ou 886 « tickets » (catégorie, article) — acompte de commande sans ligne d'article, et lignes comptées comme des tickets. | Majeur | Corrigé (mêmes cartes partout, écart expliqué sous les vues catégorie/article) |
| 141 | juin → nov. | Économe — bons de sortie | Le lot proposé à la génération d'un bon n'est pas réservé : un bon généré juste après (autre atelier, plan enfant) le vide, et la pesée est refusée « Lot … non actif (depleted) » (142 refus). L'économe doit rechoisir un lot à la main. | Majeur | Corrigé (4c0507d6 ; quantités promises aux autres bons déduites à la génération ; suites cec9dc33 : « Re-vérifier dispo » et ouverture depuis l'économat, lots pesés affichés sur le bon) |
| 142 | juin → nov. | Économe — pesée | Une ligne de bon ne puise que dans un seul lot : quand le lot proposé ne couvre pas la quantité, la pesée est refusée (« le lot … ne couvre pas la pesée », plus de 400 refus : fraises, crème, farines, levure) au lieu de compléter avec le lot suivant en FEFO. Suite du constat F-073 de février. | Majeur | Corrigé (b9751c40, mig 626 ; pesée multi-lots en FEFO, traçabilité par lot) |
| 143 | 22/11 (revue) | Comptabilité — pertes de produits finis | Le générateur d'écriture des pertes (vitrine, périmé, recyclage) vise le compte 6114, absent du plan comptable, et crédite le compte clients 3421 au lieu d'un compte de stock. Jamais déclenché dans la simulation (pertes de production seules), mais l'écriture échouerait ou serait fausse. | Majeur | Corrigé (générateur mort retiré ; pas d'écriture en inventaire intermittent) |

## Erreurs de mise en place (pas des défauts de l'application)

Consignées pour la traçabilité : elles ont faussé des journées, rejouées depuis la sauvegarde.

- **Purge D1 trop large** : `unit_factor_cache` (facteurs d'unités) et `order_status_transitions`
  (transitions autorisées des commandes) sont des tables de paramétrage, vidées par erreur.
  Conséquences observées : préparations de base planifiées en quantité NaN, commandes refusées
  (« pending → in_production »). Base reconstruite, 01/06 et 04-07/06 rejoués.
- **Durée d'exposition des pains mise à 12 h** par le gérant (choix de mise en place) : ventes du
  soir refusées. Portée à 16 h.
- **Passation sans comptage** : le pilote enregistrait une passation vide (bilan produits du shift du matin à 0) ; la caissière compte désormais la vitrine à 14 h. Juin rejoué.
- **Pilote de journée** : réponse d'attribution de demande de prix mal lue, virements sans
  référence, seuils de réapprovisionnement trop bas pour les denrées périssables (levure,
  fraises en rupture le 06/06). Corrigés, journées rejouées.
