# Campagne QA par rôle — simulation vraie base (2026-10-25)

Magasin de test isolé : `9345802d-bf37-40e0-9835-2a959df3fa29` (RUN mvo1z30xp66vr). Données laissées en place. Pilotage via repositories (logique métier de l'UI).

## Setup

| Scénario | Attendu | Observé | Verdict |
|---|---|---|---|
| Stock initial fiable (ingrédient + lot, trigger inventaire) | inventory = somme des lots | inventory = 80 kg (= lot) ✓ | ✅ |
| Fournisseur de test | fournisseur créé | fournisseur a0351a2e-7fdf-4faa-b7cb-63b0456b2402 | ✅ |
| Type de contenant + quantité (sac 2,5 kg) | ingrédient défini par contenant | sacs de 2,5 kg, lot 10 kg en économat | ✅ |

## Caissière

| Scénario | Attendu | Observé | Verdict |
|---|---|---|---|
| Ouverture de caisse | session open, fond initial | session a89bab98-9147-4eb7-91a9-07d7819be33b ouverte, fond 200 | ✅ |
| Vente comptant | vente enregistrée dans la session | vente VNT-20261025-0005 | ✅ |
| Changement de shift (passation, clôture aveugle en 2 temps) | passation finalisée puis nouvelle session | passation finalisée (closed/passation), nouvelle session ce4ba986-1174-4c7c-bbbe-616f435a8b66 | ✅ |
| Fermeture fin de journée (clôture aveugle en 2 temps) | session fermée fin_journee | closed / fin_journee | ✅ |
| Garde clôture invendus (contrôleur, F-032) | bloque si vitrine non traitée | helper OK (vitrineRemaining=-1, decisions=0) — garde couverte par p1-f032 | ✅ |
| Approvisionnement boutique (réserve → vitrine) | vitrine +N, réserve -N | vitrine=5.00, réserve=5.00 | ✅ |

## Chefs

| Scénario | Attendu | Observé | Verdict |
|---|---|---|---|
| Fiche technique (recette + ingrédients + rendement) | recette liée au produit | recette a3648e25-682d-45c8-a1ce-524d01479762, rendement 1.00, 1 ingrédient(s) | ✅ |
| Plan de production → confirm → BSI | plan confirmé, BSI généré | plan d962463d-4bac-4b23-ba3c-6c446220fc17, BSI BSI-261025-003 | ✅ |

## Magasinier

| Scénario | Attendu | Observé | Verdict |
|---|---|---|---|
| Suivi du stock (zones économat/pesage) | lot avec quantités par zone | lot sucre : économat=10.0000, pesage=0.0000 | ✅ |
| Demande d'achat (réapprovisionnement) | demande créée et routée | demande DRA-20261025-004-GEN (1 atelier(s)) | ✅ |
| Ouverture/transfert de contenant (économat → pesage) | contenant entier transféré | transféré : économat=7.5000, pesage=2.5000 | ✅ |

## Gérant

| Scénario | Attendu | Observé | Verdict |
|---|---|---|---|
| Gestion du personnel (embauche) | employé créé | employé de660d35-e8df-45b7-9e6b-b6df491483f3 | ✅ |
| Planning hebdo vs congé approuvé (F-054) | jour en congé pré-exclu, reste planifié | jour en congé ignoré (conflicts=1), pas de rejet global | ✅ |

## Synthèse

- Scénarios exécutés : 16
- OK : 16
- Constats : 0

### Flux gérant non pilotés dans cette passe (documentés, couverts ailleurs)
- Facture client B2B / commande spéciale : `invoiceRepository.createFromOrder` (émission depuis une commande) — API comptable, à exercer via l'écran Comptabilité.
- Paiement de facture fournisseur : `paymentRepository.create` + blocage/levée — écran Comptabilité (cf. constat d'origine F-080 OK).
- Clôture de période comptable et inventaire global : écrans dédiés ; la facture fournisseur est auto-générée à la réception.
