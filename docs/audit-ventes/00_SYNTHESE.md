# Domaine Ventes — benchmark face aux grands ERP (synthèse)

Audit du 2026-11-09 sur `main` (HEAD `bba7532`). Sept rapports de domaine (`D1` à `D7`,
même dossier) confrontent **450 capacités** des grands ERP (SAP S/4HANA, Oracle Fusion,
Dynamics 365, NetSuite, Sage X3, Odoo Enterprise, et les caisses Dynamics Commerce,
Odoo POS, Lightspeed, Loyverse) au code réel de Kalum, sous l'angle **multi-secteur**.

**Méthode et limites.** Lecture du code seulement (migrations, serveur, écrans) : rien
n'a été exécuté, aucune base consultée. Chaque statut porte sa preuve `fichier:ligne`
dans le rapport de domaine. Les listes de capacités viennent de la connaissance générale
de ces ERP, pas de leur documentation. Les priorités et les efforts sont des jugements.
Les points fiscaux marocains (§ 7) sont à valider avec l'expert-comptable.

---

## 1. Verdict

**Le flux Ventes fonctionne pour le cas Ofauria ; il n'est pas au niveau d'un grand ERP,
et il n'est pas encore multi-secteur.** Sur 450 capacités de référence, 102 sont complètes
(23 %), 155 partielles (34 %), 193 absentes (43 %).

Ce résultat corrige l'appréciation rapide donnée avant cet audit (« fonctionnellement
complet ») : elle portait sur l'enchaînement devis → commande → BL → facture → règlement,
qui est effectivement solide. Ce qui manque se trouve **sous** ce flux, dans les fondations
que les grands ERP considèrent comme acquises :

1. **l'article** — il ne peut ni exister ni être tarifé sans recette, n'a pas de type
   (service, négoce, abonnement), pas d'unité de vente libre, pas de code-barres, pas de
   code TVA ;
2. **le prix** — un seul prix par article, lu TTC en caisse et HT pour un professionnel ;
   ni liste de prix, ni prix par client ;
3. **le client** — une seule adresse, pas de partenaires (livré, facturé, payeur), pas
   d'archivage, pas de piste d'audit ;
4. **la fiscalité de vente** — TVA de caisse nulle, pas de droit de timbre, pas de facture
   d'acompte, pas de facture depuis un ticket.

Les points forts restent réels : livraisons partielles avec lots FEFO et rappel, contrôle
de crédit bloquant, avoirs, affectation des règlements, lettrage total et partiel, relances
à niveaux, clôture (FAE, coût figé), promotions et fidélité, CRM, abonnements.

---

## 2. Chiffres par domaine

| Domaine | Capacités | ✅ | 🟡 | ❌ | P0 | P1 | P2 | P3 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| D1 Référentiels clients, organisation commerciale | 50 | 7 | 18 | 25 | 6 | 22 | 14 | 6 |
| D2 Catalogue, prix, remises, taxes | 55 | 7 | 26 | 22 | 9 | 28 | 10 | 1 |
| D3 CRM, devis, contrats, commandes | 94 | 19 | 28 | 47 | 6 | 30 | 33 | 6 |
| D4 Logistique sortante, livraison, retours | 55 | 14 | 12 | 29 | 6 | 22 | 12 | 1 |
| D5 Facturation, encaissements, crédit, recouvrement | 65 | 20 | 18 | 27 | 6 | 21 | 15 | 3 |
| D6 Point de vente | 66 | 21 | 20 | 25 | 7 | 22 | 15 | 1 |
| D7 Pilotage, force de vente, transverse | 65 | 14 | 33 | 18 | 6 | 34 | 12 | 1 |
| **Total** | **450** | **102** | **155** | **193** | **46** | **179** | **111** | **19** |

Les 46 lignes P0 se recoupent d'un domaine à l'autre (les adresses de livraison
apparaissent en D1, D3 et D4 ; les prix par client en D1, D2 et D3) : elles se ramènent à
**sept chantiers** (§ 3). Certains rapports donnent aussi une priorité au reliquat d'une
capacité notée complète, d'où un total de priorités légèrement supérieur aux écarts.

Domaines les plus mûrs : D6 Caisse (32 % complet), D5 Facturation (31 %), D4 Livraison
(25 %). Les plus faibles : D2 Catalogue et prix (13 %), D1 Clients (14 %).

---

## 3. Les sept chantiers P0

### A. Modèle d'article générique
| Écart | Réf. |
|---|---|
| Article non créable ni tarifable sans recette (prix en lecture seule) | D2-01 |
| Aucun type d'article : service, négoce, abonnement, numérique, frais | D2-02, D3-52 |
| Unités de vente figées (pièce, poids, personne), aucune conversion ; quantités entières sur devis et commandes (`order_items.quantity INT`) | D2-03, D3-84, D7-64 |
| Aucun code-barres (comparaison au seul `sku`, côté navigateur) | D6-03 |
| Tout manque de stock crée un plan de production, même pour un article acheté | D3-51 |
| Aucun lot pour les marchandises de négoce (`product_lots` alimentée par la production seule) | D4-23 |

### B. Tarification
| Écart | Réf. |
|---|---|
| Aucune liste de prix (canal, client, groupe, dates, paliers, devise) | D2-19 |
| Aucun prix négocié par client ou groupe : seul un taux de remise global | D2-21, D1-09, D3-39 |
| Base de prix ambiguë : le même `products.price` est TTC en caisse, HT pour un professionnel | D2-18 |

### C. Fiscalité et conformité des pièces de vente
| Écart | Réf. |
|---|---|
| Pas de code TVA sur l'article (défaut = dernier taux utilisé sur un BL) | D2-44 |
| TVA de caisse nulle : `taxAmount = 0` en dur (`sale.controller.ts:143`) | D2-48, D6-31 |
| Droit de timbre sur paiement en espèces absent | D2-50, D5-62 |
| Régime de TVA non paramétrable (encaissement ou débits) | D5-61 |
| Exonération de TVA : simple booléen, sans attestation ni dates de validité | D1-23 |
| Mentions légales : ICE du client professionnel non contrôlé à l'émission | D5-20 |
| Numérotation : la date de facture n'est pas transmise à la série (`accounting.repository.ts:716`) | D5-18 |
| Compte de produit `7111` en dur pour toute facture client (`journal-generator.service.ts:363`) | D5-17 |
| Pas de facture d'acompte ; acompte impossible pour un professionnel | D5-06, D3-76 |
| Pas de facture depuis un ticket de caisse | D6-33 |

### D. Référentiel client
| Écart | Réf. |
|---|---|
| Une seule adresse (texte + ville) ; ni adresse de livraison, ni partenaires (livré, facturé, payeur) | D1-04, D3-68, D4-08 |
| Pas d'archivage : `is_active` jamais lu ni écrit, seule sortie = suppression physique | D1-25 |
| Aucune piste d'audit sur la fiche client | D1-32 |
| Loi 09-08 : ni consentement, ni export, ni anonymisation | D1-45, D7-60 |
| Aucun commercial attitré sur client, devis, commande, BL, facture | D7-21 |

Le référentiel **fournisseurs** (mig 304 : identifiants typés par pays, régime TVA, entité
mère, audit, doublons) est nettement plus mûr : aligner `customers` dessus couvre une
bonne part de ce chantier.

### E. Logistique sortante
| Écart | Réf. |
|---|---|
| Le BL naît « livré » et sort le stock à la saisie : pas de statuts préparé / expédié / livré | D4-06 |
| Pas de choix du site d'expédition ; stock de produits finis limité à réserve et vitrine | D4-14 |
| Aucun transfert de produits finis entre magasins ou entrepôts | D4-43 |
| Retour d'un professionnel purement financier : ni remise en stock, ni lot inversé | D4-48 |

### F. Caisse
| Écart | Réf. |
|---|---|
| Remise en caisse non plafonnée par rôle (plafond appliqué aux commandes seulement) | D6-18 |
| Pas d'annulation de ticket ; retours ouverts à toute caissière, sans seuil ni approbation | D6-38 |
| Ouverture et fermeture de caisse liées aux invendus et au contrôle de vitrine, non paramétrable | D6-48 |
| Aucun mode hors-ligne | D6-52 |

### G. Plateforme
| Écart | Réf. |
|---|---|
| Aucune infrastructure de traduction : interface et PDF en français seul, pas d'arabe | D7-42 |
| Pas d'API publique documentée ni de clés d'API | D7-49 |
| Rôles figés sur des métiers de boulangerie ; routes de vente autorisées par groupes en dur | D7-62 |

D7-21 et D7-42 redescendent en P1 si la cible reste francophone et orientée caisse.

---

## 4. Anomalies (bugs) relevées en chemin

**Relues et confirmées dans le code pour cette synthèse :**

| Anomalie | Preuve |
|---|---|
| Impression : `send()` s'appelle elle-même pour toute interface non CUPS (récursion sans fin) | `server/src/services/printer.service.ts:87-90` |
| Supprimer un produit efface ses lignes de tickets, de commandes et de retours, hors transaction | `server/src/repositories/product.repository.ts:253-277` |
| Sortie de stock d'un produit sans lot : bornée à zéro en silence, sans contrôle de disponibilité | `server/src/services/product-shipment.ts:86-94` |
| Routes de retours sans `asyncHandler` (0 occurrence) | `server/src/routes/return.routes.ts` |
| Remboursement d'un retour = prix unitaire de ligne × quantité, sans prorata de la remise de ticket | `server/src/controllers/return.controller.ts:120-133` |
| Numéros de migration en double : 051, 264, 265, 426, 427, 428 | `server/migrations/` |

**Rapportées par les audits de domaine, non relues ici** (preuves dans chaque rapport, § 6) :

- Abonnements : la reprise après une pause facture les échéances de la pause ; aucune tâche planifiée (D3, D5).
- Devis : plafonds de remise et de dérogation de prix non appliqués ; la conversion les reprend tels quels (D3).
- Commande modifiée : ni re-sourcée, ni réservée (D3).
- Commissions : double versement possible si les périodes se chevauchent ; impayés inclus, retours non déduits (D7).
- Rapports de vente sans filtre magasin ; rapports enregistrés modifiables d'un magasin à l'autre ; lecture d'un devis par identifiant sans contrôle d'établissement (D3, D7).
- Suppression d'un client : commandes et ventes passent à `customer_id NULL`, points supprimés (D1).
- Facture manuelle : sélecteur limité aux 20 derniers clients créés (D1).
- Échéance imprimée sur le PDF différente de celle suivie en créances (D5).
- Vendeuse autorisée à encaisser mais pas à ouvrir une session (D6).
- Tests d'intégration ventes ignorés en intégration continue faute de `TEST_DATABASE_URL` (D7).

---

## 5. Feuille de route proposée

> La séquence détaillée, étape par étape et fusionnée avec les lots du couplage sectoriel,
> est dans `docs/FEUILLE_DE_ROUTE_MULTI_SECTEUR.md`.

| Lot | Contenu | Effort | Dépend de |
|---|---|---|---|
| **V0 — Correctifs** | Bugs du § 4 (impression, suppression produit, retours, abonnements, isolation par magasin, plafonds sur devis) | S à M | — |
| **V1 — Article générique** | Type d'article, article sans recette, unités en référentiel avec conversions, quantités décimales, code-barres, code TVA sur l'article, sourcing achat ou production | L | — |
| **V2 — Fiscalité de vente** | Base HT/TTC explicite, TVA de caisse, droit de timbre, régime de TVA, attestation d'exonération, mentions légales, numérotation datée, comptes de produits par famille, facture d'acompte, facture depuis ticket | L | V1, expert-comptable |
| **V3 — Référentiel client** | Adresses multiples et partenaires, alignement sur le référentiel fournisseurs, archivage, piste d'audit, commercial attitré, loi 09-08 | M | — |
| **V4 — Tarification** | Listes de prix (canal, client, groupe, dates, paliers, devise), prix négociés, plafonds de remise en caisse et sur devis, prix plancher | L | V1, V3 |
| **V5 — Logistique** | Statuts du BL, bon de préparation, site d'expédition, transferts de produits finis, lots de négoce, retour professionnel avec stock | L | V1, V3 |
| **V6 — Caisse** | Annulation de ticket avec autorisation, ouverture et fermeture paramétrables, lecture code-barres, chèque et mobile à l'écran, mode hors-ligne | M à L | V1, V2 |
| **V7 — Plateforme** | Traduction (français, arabe, anglais), API publique et clés, rôles configurables, portail client | L | audit du couplage sectoriel (L1, L2) |
| **V8 — Attendus P1** | Contrats-cadres, ristournes, litiges, relances par e-mail, objectifs par vendeur, facturation électronique dès publication du calendrier | au fil de l'eau | V1 à V5 |

V1 est le pivot : il conditionne la fiscalité, la tarification, la logistique et la caisse,
et recoupe le lot L3 de `docs/AUDIT_COUPLAGE_SECTORIEL.md`.

**Secteur d'activité paramétrable.** Exigence du 2026-11-09 : le secteur se choisit dans
les Paramètres et les interfaces s'y adaptent (modules, menus, vocabulaire, champs,
référentiels, rapports). Elle est décrite au § 4 bis de `docs/AUDIT_COUPLAGE_SECTORIEL.md`.
Conséquence pour cette feuille de route : chaque lot Ventes livre des **capacités
activables** (type d'article, unité, statut de BL, mode de caisse) et jamais un
comportement lié en dur à un métier, pour que le pack secteur n'ait qu'à les activer.

---

## 6. Rapports de domaine

| Fichier | Contenu |
|---|---|
| `D1_referentiels_clients.md` | Fiche client, conditions, fiscalité, qualité des données, organisation commerciale |
| `D2_catalogue_prix_taxes.md` | Article à la vente, prix, remises, promotions, taxes |
| `D3_crm_devis_commandes.md` | CRM, devis, contrats, commandes, abonnements |
| `D4_livraison_retours.md` | Livraisons, préparation, transport, tournées, retours, traçabilité |
| `D5_facturation_recouvrement.md` | Factures, avoirs, encaissements, crédit, relances, comptabilisation |
| `D6_point_de_vente.md` | Encaissement, gestion de caisse, matériel, multi-magasin |
| `D7_pilotage_transverse.md` | Analyses, commissions, approbations, communication, API, tests |

Chaque rapport contient le tableau complet des capacités, le détail des écarts P0 et P1
(constat, impact, piste, effort) et ses anomalies.

---

## 7. À valider avec l'expert-comptable

- Régime de TVA applicable (encaissement ou débits) et TVA au comptoir par article.
- Droit de timbre sur les règlements en espèces : taux, pièces concernées, comptabilisation.
- TVA exigible sur les acomptes et forme de la facture d'acompte.
- Retenues à la source subies sur les factures clients.
- Portée de la loi 69-21 (délais de paiement, pénalités, déclaration).
- Calendrier de la facturation électronique (classée P1 ; P0 dès publication).
- Exigence de lot sur les marchandises de négoce alimentaire (ONSSA, loi 28-07).
