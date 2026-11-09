# Feuille de route — Kalum multi-secteur, domaine Ventes

Rédigée le 2026-11-09 sur `main` (`de3912f`, dernière migration `467`). Elle met en une
seule séquence les deux plans existants :

- `docs/audit-ventes/00_SYNTHESE.md` § 5 — lots **V0 à V8** (manques face aux grands ERP) ;
- `docs/AUDIT_COUPLAGE_SECTORIEL.md` § 5 — lots **L0 à L6** (retrait du couplage boulangerie
  et choix du secteur dans les Paramètres).

Les constats et leurs preuves restent dans ces deux documents ; ici ne figure que l'ordre
des travaux. Les tailles (S, M, L) sont relatives ; aucune durée n'est promise, elle dépend
du rythme de validation.

---

## Règles valables pour toutes les étapes

1. **Ofauria ne régresse jamais.** Le secteur « Boulangerie » reproduit l'existant ; chaque
   étape se termine par une vérification des écrans d'Ofauria.
2. **Une étape = un lot livré et vérifié** : migration testée sur la base de test, contrôle
   de types, tests du domaine, puis démonstration à l'écran.
3. **Des capacités, jamais un test du secteur.** Le code lit « cet article est-il
   fabriqué ? », pas « sommes-nous une boulangerie ? ».
4. **Additif d'abord.** Une colonne ou une table s'ajoute ; l'ancien comportement reste la
   valeur par défaut tant que la nouvelle voie n'est pas validée.
5. **Git** : commit sur `main` en local à chaque étape, rien n'est poussé ni déployé sans
   demande ; numéro de migration revérifié sur `main` avant chaque lot (à partir de `468`).
6. **Constats à revérifier** : l'audit date du 2026-11-09 ; chaque écart est relu dans le
   code avant d'être traité.

---

## Vue d'ensemble

| Phase | Objet | Lots repris | Taille | Dépend de |
|---|---|---|---|---|
| 0 | Sécuriser l'existant | V0 | M | — |
| 1 | Choix du secteur dans les Paramètres | L0, L2 | M | — |
| 2 | Rôles configurables | L1 | L | 1 |
| 3 | Article générique | V1, L3 | L | 1 |
| 4 | Référentiel client | V3 | M | — |
| 5 | Fiscalité de vente | V2 | L | 3, expert-comptable |
| 6 | Tarification | V4 | L | 3, 4 |
| 7 | Logistique sortante | V5 | L | 3, 4 |
| 8 | Caisse | V6 | M à L | 3, 5 |
| 9 | Écrans et vocabulaire par secteur, deuxième secteur réel | L4, L5, L6 | M | 1, 2, 3 |
| 10 | Plateforme | V7 | L | 2 |
| 11 | Attendus de milieu de gamme | V8 | au fil de l'eau | 3 à 7 |

Les phases 2 et 3 peuvent être interverties ; la phase 4 peut avancer en parallèle de la 3.

---

## Phase 0 — Sécuriser l'existant

But : ne pas bâtir sur des défauts connus.

| Étape | Travail | Terminé quand |
|---|---|---|
| 0.1 | Impression : corriger `send()` qui s'appelle elle-même hors CUPS (`printer.service.ts:89`) | un ticket sort sur une imprimante réseau ou USB directe |
| 0.2 | Suppression d'un produit : refuser si des ventes ou commandes existent, proposer l'archivage ; le reste dans une transaction | l'historique de ventes survit à toute suppression |
| 0.3 | Retours : capture d'erreur sur les routes, remboursement au prorata de la remise de ticket, remboursement selon le moyen d'origine | un retour sur ticket remisé rembourse le montant payé |
| 0.4 | Sortie de stock sans lot : refuser ou signaler au lieu de borner à zéro en silence | un BL au-delà du stock est refusé ou tracé |
| 0.5 | Relire puis corriger les anomalies rapportées : abonnement repris après pause, plafonds de remise sur devis, commande modifiée non re-sourcée, commissions en double | chaque anomalie est soit corrigée, soit écartée avec sa raison |
| 0.6 | Cloisonnement par magasin : rapports de vente, rapports enregistrés, lecture d'un devis par identifiant | un utilisateur d'un magasin ne lit ni ne modifie les pièces d'un autre |
| 0.7 | Tests de vente exécutés en intégration continue ; garde contre les numéros de migration en double | la suite ventes tourne à chaque envoi |

Décision attendue : aucune.

## Phase 1 — Choix du secteur dans les Paramètres

But : rendre le secteur visible et pilotant, sans rien changer pour Ofauria.

| Étape | Travail | Terminé quand |
|---|---|---|
| 1.1 | Table des secteurs et rattachement de la société ; deux secteurs : « Boulangerie » (miroir de l'existant) et « Générique » | Ofauria est rattachée à « Boulangerie » sans effet visible |
| 1.2 | Écran Paramètres › Société › Secteur d'activité, avec aperçu de ce que le choix affiche ou masque | l'administrateur change de secteur et revient en arrière sans perte |
| 1.3 | Modules actifs par société : droit d'accès = modules de la société ∩ droits du rôle | « Générique » masque Production, Recettes, Pesage, Invendus |
| 1.4 | Menus des modules lus depuis le secteur (entrées masquables) | le menu Ventes d'une société « Générique » n'affiche aucune entrée boulangerie |

Décision attendue : la liste des modules du secteur « Générique ».

## Phase 2 — Rôles configurables

But : sortir les métiers du code. Étape la plus risquée, car elle touche l'authentification.

| Étape | Travail | Terminé quand |
|---|---|---|
| 2.1 | Table des rôles ; reprise des rôles actuels à l'identique ; la contrainte en dur sur `users.role` disparaît | les utilisateurs existants se connectent avec les mêmes droits |
| 2.2 | Droits par rôle en base, à la place de la table de constantes partagée | modifier un droit ne demande plus de livraison |
| 2.3 | Remplacer les groupes de rôles en dur (ventes, production, chefs) par des capacités (« peut encaisser », « peut produire ») | plus aucun nom de métier dans les routes ni dans les écrans |
| 2.4 | Rôles proposés par secteur ; écran de gestion des rôles | une société « Générique » crée un rôle « commercial » depuis les Paramètres |

Décision attendue : aucune ; fenêtre de test à prévoir avec les comptes réels.

## Phase 3 — Article générique

But : qu'un article existe sans recette. C'est le pivot des phases 5 à 8.

| Étape | Travail | Terminé quand |
|---|---|---|
| 3.1 | Type d'article : fabriqué, acheté pour revente, prestation, abonnement ; la fiche affiche les blocs selon le type | une bouteille d'eau se crée sans recette, avec un prix saisissable |
| 3.2 | Unités en référentiel avec conversions (pièce, kg, carton de 12, palette, heure) | un article se vend au carton et se stocke à la pièce |
| 3.3 | Quantités décimales sur devis, commandes, BL et factures | une commande de 3,5 tonnes s'enregistre |
| 3.4 | Codes-barres sur l'article (plusieurs par article), recherche côté serveur | la douchette retrouve l'article en caisse |
| 3.5 | Code TVA sur l'article, relié à la table des taux | le taux proposé vient de l'article et non du dernier BL |
| 3.6 | Approvisionnement selon le type : un manque sur un article acheté crée une demande d'achat, pas un plan de production | une commande d'article de négoce n'ouvre aucun plan de production |
| 3.7 | Lots pour les articles achetés (entrée à la réception) | un article de négoce sort en FEFO avec son lot |

Décision attendue : la liste des types d'article et des unités de départ.

## Phase 4 — Référentiel client

But : mettre la fiche client au niveau de la fiche fournisseur.

| Étape | Travail | Terminé quand |
|---|---|---|
| 4.1 | Adresses multiples (livraison, facturation) avec pays et code postal ; adresse figée sur commande, BL et facture | un client à cinq sites reçoit ses BL à la bonne adresse, la facture au siège |
| 4.2 | Partenaires : livré, facturé, payeur ; entité mère | une filiale commande, le siège paie |
| 4.3 | Identifiants légaux typés, contrôle de l'ICE, détection de doublons, alignés sur le référentiel fournisseurs | un doublon d'ICE est signalé au lieu de produire une erreur |
| 4.4 | Archivage à la place de la suppression ; piste d'audit sur la fiche | un client archivé garde son historique |
| 4.5 | Commercial attitré sur le client, repris sur devis, commande, BL, facture | le chiffre d'affaires par commercial se lit sur les pièces B2B |
| 4.6 | Loi 09-08 : consentement, export des données, anonymisation | une demande d'effacement se traite sans casser la comptabilité |

Décision attendue : aucune.

## Phase 5 — Fiscalité de vente

But : des pièces de vente conformes. **Bloquée par les réponses de l'expert-comptable**
(§ « Décisions ») ; les questions partent dès la phase 0.

| Étape | Travail | Terminé quand |
|---|---|---|
| 5.1 | Base de prix explicite (HT ou TTC) sur l'article et la liste de prix | le même article n'est plus lu TTC ici et HT là |
| 5.2 | TVA au comptoir par article ; ventilation par taux sur le ticket et dans l'écriture | le rapport Z donne la TVA collectée par taux |
| 5.3 | Comptes de produits par famille d'article, à la place du `7111` en dur | une prestation se comptabilise dans son compte |
| 5.4 | Facture d'acompte et sa reprise sur la facture finale ; acompte ouvert aux professionnels | un acompte de 30 % donne une pièce numérotée, déduite ensuite |
| 5.5 | Facture depuis un ticket de caisse | un client demande sa facture après l'achat au comptoir |
| 5.6 | Numérotation selon la date de facture ; mentions légales contrôlées à l'émission | une facture sans ICE client professionnel est refusée |
| 5.7 | Droit de timbre, régime de TVA, attestation d'exonération datée | selon les réponses de l'expert-comptable |

## Phase 6 — Tarification

| Étape | Travail | Terminé quand |
|---|---|---|
| 6.1 | Listes de prix : par canal, par groupe de clients, dates de validité, devise | une liste « Hôtels » coexiste avec la liste « Boutique » |
| 6.2 | Paliers par quantité et prix négocié par client | 2,20 DH, puis 2 DH à partir de 500 pièces, pour un client donné |
| 6.3 | Ordre de priorité entre prix, appliqué partout : caisse, devis, commande, BL | le même client obtient le même prix quel que soit l'écran |
| 6.4 | Plafonds de remise par rôle en caisse et sur devis ; prix plancher | une remise hors plafond demande une approbation |
| 6.5 | Historique et mise à jour en masse des prix | une hausse de 5 % s'applique à une famille, avec trace |

Décision attendue : aucune.

## Phase 7 — Logistique sortante

| Étape | Travail | Terminé quand |
|---|---|---|
| 7.1 | Statuts du BL : brouillon, préparé, expédié, livré ; le stock sort à l'expédition | un BL se prépare la veille et part le lendemain |
| 7.2 | Bon de préparation ; regroupement de plusieurs commandes | le préparateur travaille sur une liste imprimée |
| 7.3 | Site d'expédition au choix ; stock de produits finis par emplacement | une commande part du dépôt et non du magasin |
| 7.4 | Transferts de produits finis entre magasins ou dépôts | un transfert laisse une pièce et deux mouvements |
| 7.5 | Retour d'un professionnel : réception, décision (remise en stock ou rebut), lot inversé, avoir | un retour remet la marchandise en stock avec son lot |
| 7.6 | Preuve de livraison (signature, heure réelle) et réserves | un litige de livraison se rattache au BL |

Décision attendue : le secteur « Boulangerie » garde-t-il le BL en une seule étape.

## Phase 8 — Caisse

| Étape | Travail | Terminé quand |
|---|---|---|
| 8.1 | Annulation de ticket avec autorisation ; retours soumis à un seuil et à un délai | une annulation laisse une trace et un approbateur |
| 8.2 | Ouverture et fermeture paramétrables : le contrôle des invendus devient une option du secteur | une société « Générique » ferme sa caisse sans inventaire de vitrine |
| 8.3 | Chèque et paiement mobile à l'écran ; caissier identifié sur chaque vente | la vente porte le bon vendeur |
| 8.4 | Mode hors-ligne avec synchronisation | la caisse encaisse pendant une coupure réseau |

Décision attendue : le mode hors-ligne est-il nécessaire dès maintenant (c'est l'étape la plus lourde).

## Phase 9 — Écrans et vocabulaire par secteur

| Étape | Travail | Terminé quand |
|---|---|---|
| 9.1 | Libellés par clé neutre, valeurs par secteur (« recette » ou « nomenclature ») | changer de secteur change les mots à l'écran |
| 9.2 | Tableaux de bord et rapports proposés par secteur | « Générique » ouvre sur ses propres indicateurs |
| 9.3 | Données de départ par secteur, chargeables, sorties des migrations | une société neuve ne reçoit pas les recettes de croissants |
| 9.4 | Deuxième secteur réel, de bout en bout, comme preuve | une société de négoce va du devis à l'encaissement sans écran boulangerie |

Décision attendue : le deuxième secteur à construire (proposition : négoce).

## Phase 10 — Plateforme

| Étape | Travail | Terminé quand |
|---|---|---|
| 10.1 | Traduction de l'interface et des documents ; arabe avec écriture de droite à gauche | une facture sort en arabe |
| 10.2 | API publique documentée, clés d'accès, notifications sortantes | un site marchand crée une commande |
| 10.3 | Portail client : commandes, factures, relevé | un client professionnel télécharge sa facture |

Décision attendue : les langues visées, et si l'API passe avant le portail.

## Phase 11 — Attendus de milieu de gamme

Traités au fil de l'eau, une fois les fondations posées : contrats-cadres et commandes
ouvertes, ristournes de fin d'année, dossiers de litige, relances par e-mail, objectifs par
commercial, portefeuille de chèques et d'effets, facturation électronique dès que le
calendrier marocain est publié. Liste complète : écarts P1 des rapports `D1` à `D7`.

---

## Décisions à prendre

| Décision | Par qui | Bloque |
|---|---|---|
| Régime de TVA, TVA au comptoir, droit de timbre, TVA sur acompte, retenues à la source, loi 69-21 | expert-comptable | phase 5 |
| Modules du secteur « Générique » | toi | étape 1.3 |
| Types d'article et unités de départ | toi | phase 3 |
| Deuxième secteur à construire | toi | étape 9.4 |
| Mode hors-ligne de la caisse : maintenant ou plus tard | toi | étape 8.4 |
| Langues visées ; API ou portail d'abord | toi | phase 10 |

## Première action

Phase 0, étape 0.1, puis les étapes 0.2 à 0.7 dans l'ordre. En parallèle, envoi à
l'expert-comptable de la liste de questions de la phase 5.
