# Scénario 2 — Couverture

138,944 appels d'écriture par les endpoints des écrans, 55 opérations distinctes, 870 refus ou erreurs (incidents provoqués compris).

## Par agent

| Agent | Appels | Opérations distinctes |
|---|---|---|
| caissier_matin | 60,424 | 9 |
| caissier_soir | 51,860 | 9 |
| econome | 7,383 | 10 |
| patissier | 4,664 | 9 |
| gerant | 4,518 | 25 |
| achats | 3,085 | 7 |
| viennoiserie | 2,012 | 9 |
| sale | 2,012 | 9 |
| beldi | 1,416 | 9 |
| boulanger_nuit | 888 | 6 |
| boulanger_matin | 678 | 9 |
| commercial | 4 | 1 |

## Par opération

| Opération | Appels | Refus / erreurs |
|---|---|---|
| `POST /sales/checkout` | 109,184 | 39 |
| `POST /production/:id/confirm` | 2,437 | 0 |
| `POST /production/:id/start` | 2,437 | 0 |
| `POST /production/:id/start-items` | 2,437 | 0 |
| `POST /production/:id/produce-items` | 2,437 | 0 |
| `PUT /bons-sortie/ligne/:id` | 2,381 | 322 |
| `PUT /bons-sortie/:id/preparation` | 1,001 | 0 |
| `PUT /bons-sortie/:id/ready` | 1,001 | 0 |
| `PUT /bons-sortie/:id/accept-reception` | 1,001 | 0 |
| `PUT /bons-sortie/:id/peser` | 1,000 | 283 |
| `POST /replenishment/:id/acknowledge` | 911 | 0 |
| `POST /replenishment/:id/prepare` | 911 | 0 |
| `POST /replenishment/:id/transfer` | 911 | 0 |
| `POST /replenishment/:id/confirm-reception` | 911 | 0 |
| `POST /production` | 870 | 0 |
| `POST /purchase-requests` | 739 | 0 |
| `PUT /rfqs/:id/quotations` | 553 | 0 |
| `POST /purchase-orders/:id/send` | 531 | 0 |
| `POST /purchase-orders/:id/confirm-delivery` | 528 | 1 |
| `POST /invoices/:id/validate` | 527 | 0 |
| `POST /cash-register/open` | 521 | 173 |
| `POST /payments` | 517 | 10 |
| `POST /rfqs/from-requests` | 490 | 0 |
| `PATCH /rfqs/:id` | 490 | 0 |
| `POST /rfqs/:id/send` | 490 | 0 |
| `POST /rfqs/:id/award` | 490 | 0 |
| `POST /delivery-notes` | 449 | 36 |
| `PUT /stock-counts/:id/lines/:id` | 353 | 0 |
| `POST /cash-register/close` | 348 | 0 |
| `POST /unsold-decisions` | 348 | 0 |
| `POST /cash-register/:id/submit` | 348 | 0 |
| `POST /bons-sortie/ligne/:id/transfer-from-economat` | 322 | 2 |
| `POST /replenishment` | 174 | 0 |
| `POST /attendance/bulk` | 174 | 0 |
| `POST /inventory-checks/opening` | 173 | 0 |
| `POST /orders` | 133 | 0 |
| `POST /orders/:id/deliver` | 130 | 0 |
| `POST /payroll/:id/pay` | 72 | 0 |
| `POST /purchase-orders` | 41 | 0 |
| `POST /stock-counts` | 29 | 0 |
| `POST /stock-counts/:id/submit` | 29 | 0 |
| `POST /stock-counts/:id/validate` | 29 | 0 |
| `POST /delivery-notes/invoice` | 15 | 0 |
| `POST /salary-advances` | 12 | 0 |
| `POST /unsold-decisions/destroy-expired` | 12 | 0 |
| `POST /payments/customer-receipts` | 11 | 0 |
| `POST /invoices/holds/:id/release` | 10 | 0 |
| `POST /payroll/generate` | 6 | 0 |
| `PATCH /payment-schedules/:id` | 6 | 0 |
| `POST /promotions` | 4 | 0 |
| `PUT /customers/:id` | 4 | 0 |
| `PUT /orders/:id/status` | 2 | 1 |
| `POST /sales/:id/cancel` | 2 | 2 |
| `POST /delivery-notes/from-order/:id` | 1 | 1 |
| `POST /returns` | 1 | 0 |

## Incidents (étape 7)

| Date | Incident | Attendu | Résultat |
|---|---|---|---|
| 2026-06-05 | Livraison partielle (Farine T55, 80 %) | BC soldé, reliquat annulé, facture sur la quantité livrée | Conforme — livre_complet |
| 2026-06-10 | Hausse du prix du beurre (+12 %) sur les devis | prix du devis et du BC suivants majorés, coût CMUP réévalué | Conforme — appliquée aux prochaines demandes de prix |
| 2026-06-24 | Fournée de croissants ratée (40 pièces) | perte déclarée et valorisée, stock produit réduit | Conforme — déclarée |
| 2026-07-15 | Annulation de commande après acompte | commande annulée, acompte conservé (non remboursable), plans non démarrés annulés | Conforme — statut cancelled, acompte 150.00, plans ['cancelled'] |
| 2026-07-30 | Commande pro urgente (Fête du Trône) | plan créé, fabriqué et livré le jour même | Écart — POST /delivery-notes/from-order/c5af8dcc-4caf-4faa-a83a-a08df4e2d1da -> 409 {'success': False, 'error': {'message': 'Plafond de crédit dépassé : 21\u202f092,70  |
| 2026-08-12 | Erreur de rendu de monnaie : écart de caisse le soir | écart -50 DH enregistré avec motif, écriture d’écart passée | Conforme — {'difference': '-50.00', 'difference_reason': 'rendu_monnaie', 'closure_number': 'Z-20260812-0002'} |
| 2026-08-26 | Retour client et remboursement | avoir/remboursement de 18 DH, déduit de la caisse | Conforme — {'return_number': 'RET-20260826-0001', 'refund_amount': '18.00'} |
| 2026-09-09 | Facture fournisseur reçue en double (même numéro) | réception refusée (409) | Conforme — {'success': False, 'error': {'message': 'La facture fournisseur N° F260908-9167 a déjà été enregistrée (reception BR-2026-0288 — BC BC-2026-0288). Vérifie le nu |
| 2026-09-23 | Caissier : annulation de ticket sans droit | 403 | Conforme — {'success': False, 'error': {'message': 'Accès interdit', 'permission': 'sales.cancel'}} |
| 2026-09-23 | Caissier : remise de 83 % sans validation | 403 DISCOUNT_APPROVAL_REQUIRED | Conforme — {'success': False, 'error': {'message': 'Stock vitrine insuffisant pour "Baguette" — disponible: 0 pièces, demande: 10 pièces. Faire une demande d\'approvisionn |
| 2026-10-01 | Caissier : annulation de ticket sans droit | 403 | Conforme — {'success': False, 'error': {'message': 'Accès interdit', 'permission': 'sales.cancel'}} |
| 2026-10-01 | Caissier : remise de 83 % sans validation | 403 DISCOUNT_APPROVAL_REQUIRED | Conforme — {'success': False, 'error': {'code': 'DISCOUNT_APPROVAL_REQUIRED', 'maxPct': 10, 'pct': 83, 'message': "Remise de 83 % au-delà de votre plafond (10 %) : validat |
| 2026-10-07 | Deux ventes simultanées des 25 derniers « Croissant » | une seule vente acceptée, stock vitrine jamais négatif | Conforme — résultats ['ok', 409], vitrine après : 0.0 |
| 2026-10-21 | Session expirée pendant une réception | reconnexion puis une seule réception enregistrée | Conforme — 1 bon(s) de réception |
| 2026-11-04 | Dépassement du plafond de crédit (Café Atlas, plafond 8 000 DH) | 409 CREDIT_BLOCKED | Écart — {'success': False, 'error': {'message': '« Croissant » : 364 disponible(s) en lots valides sur 2000 à expédier (lots expirés et surgelés exclus)', 'code': 'LOTS |
| 2026-11-18 | Fermeture interrompue puis reprise | vente refusée pendant la fermeture (409 SESSION_IN_CLOSING), reprise du comptage possible | Écart — {'success': False, 'error': {'message': 'Stock vitrine insuffisant pour "Baguette" — disponible: 0 pièces, demande: 1 pièces. Faire une demande d\'approvisionne |
