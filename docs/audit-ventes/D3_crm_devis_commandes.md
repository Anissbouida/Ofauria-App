# D3 — Avant-vente (CRM), devis, contrats et gestion des commandes

Audit du domaine Ventes de Kalum, sous-domaine D3. Date : 2026-11-09. Branche : `claude/kalum-sales-cycle-o2c-audit-f724ad`.
Référentiel de comparaison : SAP S/4HANA (SD, CRM), Oracle Fusion (CX Sales, Order Management), Microsoft Dynamics 365 (Sales, SCM), Salesforce, NetSuite, Sage X3, Odoo Enterprise.

Convention : ✅ complet (serveur ET écran câblés) · 🟡 partiel · ❌ absent. Priorité : P0 bloquant multi-secteur ou obligation légale au Maroc · P1 attendu par tout ERP de milieu de gamme · P2 avancé · P3 niche.
Tout ce qui suit a été vérifié dans le code, sauf les passages marqués « supposé » ou « à confirmer ».

---

## 1. Périmètre et sources lues

**Périmètre** : pistes et opportunités, activités, campagnes ; devis et proforma ; contrats de vente ; types de commande ; canaux de saisie ; promesse de disponibilité ; contrôles de la commande ; abonnements. Hors périmètre (traité par d'autres lots) : fiche client, tarification de caisse, expédition et BL en détail, facturation, encaissement, relances.

**Migrations lues** : 008 (orders), 011, 015, 069, 119 (sourcing), 171, 172, 173, 243, 332, 350 (approbations), 354 (particulier / pro), 355, 363, 365 (devis), 368, 369, 371 (CRM), 372, 382 (abonnements), 383 (campagnes), 387 (tournées), 389 (réservation), 431, 441 (livraisons partielles, machine à états), 443 (crédit, prix).

**Serveur lu** :
- `server/src/routes/crm.routes.ts`, `quotes.routes.ts`, `orders.routes.ts`, `subscription.routes.ts`, `delivery-route.routes.ts`
- `server/src/controllers/order.controller.ts`, `subscription.controller.ts`
- `server/src/repositories/crm.repository.ts`, `quote.repository.ts`, `order.repository.ts`, `sourcing.helper.ts`, `subscription.repository.ts`, `credit-note.repository.ts` (en-tête), `return.repository.ts` (en-tête), `delivery-note.repository.ts` (`lineDefaults`)
- `server/src/services/order-fulfilment.ts`, `credit-control.ts`, `scheduler.ts` (tâches), `approval-handlers.ts`, `mailer.ts` (appelants), `data-import.ts` (entités), `pos-pricing.ts`, `parameters-catalog.ts` (`sales.quotes`, `sales.pricing`)
- `shared/src/constants/order-status.ts`, `roles.ts`

**Client lu** : `client/src/features/crm/CrmPage.tsx`, `features/quotes/QuotesPage.tsx`, `features/orders/OrdersPage.tsx`, `components/orders/OrderFormModal.tsx`, `features/sales/SalesLayout.tsx`, `SalesPage.tsx` (onglets), `SubscriptionsTab.tsx`, `api/orders.api.ts`, `api/custom-fields.api.ts`, `App.tsx` (routes), `mobile/capacitor.config.ts`.

**Recherches négatives** (grep insensible à la casse sur `server/src`, `server/migrations`, `shared/src`, `client/src`) : `lead`, `competitor`, `calendar|ics`, `web-to-lead|/public/`, `signature|accept_token|public_token`, `blanket|contrat-cadre|scheduling|sales_contract`, `dropship`, `consign`, `échantillon|sample|free_of_charge`, `intercompany|inter-soci`, `portal|portail`, `e-commerce|woocommerce|shopify`, `api_key|webhook`, `recurring_order|order_template|standing_order`, `shipping_address|ship_to|customer_addresses|customer_contacts`, `incoterm`, `customer_ref|po_number`, `acompte|down_payment` (côté ventes), `order_events|order_history|order_versions`, `email_templates`, `consent|opt_in|cndp`, `whatsapp|sms`, `unit_of_measure|uom`, `territor|sales_team|quota`.

Les documents `docs/AUDIT_O2C_GAP_ANALYSIS.md`, `AUDIT_POS.md`, `AUDIT_COUPLAGE_SECTORIEL.md` ont servi de contexte ; aucun statut n'en est repris sans vérification dans le code.

---

## 2. Ce qui existe (forces, avec preuves)

**CRM**
- Opportunités numérotées (OPP-AAAA-NNNN), client existant ou prospect sans fiche, source, montant espéré, probabilité, date de conclusion, responsable, champs personnalisés : mig 371 (`opportunities`), `crm.repository.ts:105-141`, `CrmPage.tsx:209-287`.
- Pipeline en tableau glisser-déposer, liste, recherche, filtre « Mes affaires » : `CrmPage.tsx:132-161`.
- Activités (appel, rendez-vous, e-mail, tâche, note) avec échéance, destinataire, résultat ; vue « à faire » ; rappel automatique des activités échues : mig 371 (`crm_activities`), `crm.repository.ts:162-192`, `CrmPage.tsx:182-206`, tâche `crm_activities_due` (`scheduler.ts:139`).
- Motif de perte obligatoire (référentiel éditable partagé avec les devis) : `crm.repository.ts:147`, `CrmPage.tsx:413-430`.
- Prévision pondérée (montant × probabilité), taux de transformation 90 jours, gagné du mois, activités en retard : `crm.repository.ts:61-91`, `CrmPage.tsx:91-99`.
- Campagnes datées et budgétées, retour mesuré en opportunités et chiffre gagné : mig 383, `crm.repository.ts:217-257`, `CrmPage.tsx:433-501`.
- Prospect → fiche client en un clic ; opportunité → devis prérempli ; le devis envoyé passe l'affaire en « Proposition », le devis commandé la passe « Gagnée » : `crm.repository.ts:195-208, 260-271`, `CrmPage.tsx:317, 345`, `QuotesPage.tsx:58-63`.

**Devis**
- Cycle brouillon → envoyé → accepté | refusé | expiré → converti | annulé, journal d'événements : mig 365 (`quotes`, `quote_items`, `quote_events`), `quote.repository.ts:237-268`, `QuotesPage.tsx:372-393`.
- Régimes de prix (professionnel HT + TVA par ligne, particulier TTC), remise globale en %, promotions en vigueur : `quote.repository.ts:58-82`.
- PDF devis et facture proforma avec numéro PF propre, mentions légales de la société (RC, IF, ICE, patente) : `quotes.routes.ts:112-161`, `quote.repository.ts:289-310`.
- Validité paramétrable (`sales.quotes.validity_days`), expiration automatique avec notification à l'auteur : `quotes.routes.ts:47-50`, `scheduler.ts:119-136`.
- Conversion en commande dans une transaction verrouillée (pas de double conversion), promotions du devis conservées, contrôle de crédit : `quote.repository.ts:316-391`.
- Tableau de bord : en cours, à relancer, taux de transformation, pertes par motif : `quote.repository.ts:113-138`, `QuotesPage.tsx:87-106`.

**Commandes**
- Deux processus : particulier (caisse, avance facultative, solde intégral à la remise) et professionnel (direction, HT + TVA par ligne, BL, facture) : mig 354, `order.controller.ts:246-370`.
- Machine à états en base (table de transitions + trigger) : mig 441 §1 (`order_status_transitions`, `fn_order_status_guard`).
- Sourcing automatique stock → production, plan de production lié et daté sur le besoin, annulation propagée aux plans non lancés : `order.repository.ts:121-164, 293-313`, `sourcing.helper.ts`.
- Réservation de stock à la prise de commande, disponible = stock − réservé : mig 389, `sourcing.helper.ts:69-79, 255-270`.
- Livraisons partielles, reliquat, solde du reliquat, tolérance de sur-livraison par client, cumuls livré / facturé / annulé par ligne : mig 441 §2-4, `order-fulfilment.ts`, `OrdersPage.tsx:910-1052`.
- Contrôle de crédit à trois jalons (création, confirmation, expédition) avec encours unique et journal des décisions ; dérogation motivée à l'expédition : mig 443, `credit-control.ts:45-69`, `order.controller.ts:211-219, 443-447`.
- Prix grille figé sur la ligne, dérogation de prix tracée et bornée par rôle, remise bornée par rôle : `order.controller.ts:73-96, 125-168`.
- Report de date journalisé (règle des 24 h, forçage motivé par la direction), plans de production décalés : `order.controller.ts:504-523`, `order.repository.ts:328-356`.
- Annulation tracée (date, auteur), avance acquise passée en produit : `order.controller.ts:449-471`.
- Suivi commande → BL → facture dans la liste : `order.repository.ts:28-37`, `OrdersPage.tsx:80-82`.

**Abonnements et tournées**
- Abonnements à montant fixe (mensuel, trimestriel, annuel), génération idempotente de factures émises et comptabilisées : mig 382, `subscription.repository.ts:77-121`, `SubscriptionsTab.tsx`.
- Tournées de livraison regroupant des BL, ordre de passage, pointage par arrêt : mig 387, `delivery-route.routes.ts:12-20`.

---

## 3. Tableau des capacités

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| **CRM** | | | | | | | |
| D3-01 | Pistes (leads) distinctes des opportunités | Salesforce Lead, Dynamics Lead, Odoo CRM, SAP Lead | ❌ | Aucune table `leads` ; le prospect est porté par 5 colonnes de `opportunities` (mig 371). Cherché : `lead` | Pas de vivier de contacts froids, pas de conversion piste → compte + contact + opportunité | P1 | Services, négoce, industrie, distribution |
| D3-02 | Qualification et score | Salesforce Einstein, Dynamics scoring, Odoo predictive lead scoring | ❌ | Étape « qualifié » seule (`crm.routes.ts:11`). Cherché : `score` dans le CRM | Ni critères de qualification (budget, décideur, besoin, délai) ni score | P2 | Services, B2B |
| D3-03 | Pipeline par étapes configurables | Salesforce Sales Process, Odoo stages, Dynamics BPF | 🟡 | 6 étapes figées : CHECK de `opportunities.stage` (mig 371), `STAGES` (`crm.routes.ts:11`), `STAGE_PROBABILITY` (`crm.repository.ts:10`) ; tableau glisser-déposer (`CrmPage.tsx:132-161`) | Étapes, libellés et probabilités codés en dur ; ajouter une étape = migration + code | P1 | Tous |
| D3-04 | Plusieurs pipelines, équipes de vente | Salesforce record types, Odoo Sales Teams, Dynamics multiple BPF | ❌ | Un seul jeu d'étapes ; pas de `sales_team`. Cherché : `sales_team`, `territor` | Un seul processus pour toutes les activités (négoce, projet, service) | P2 | Multi-activités |
| D3-05 | Activités (appel, rendez-vous, e-mail, tâche, note) et rappels | Salesforce Activities, Odoo Activities, Dynamics Activities | ✅ | mig 371 `crm_activities` ; `crm.repository.ts:162-192` ; `CrmPage.tsx:182-206, 365-405` ; tâche `crm_activities_due` | Limite : rattachées aux opportunités seulement (pas au client, au devis, à la commande) | — | Tous |
| D3-06 | Calendrier, agenda, synchronisation | Odoo Calendar, Dynamics / Outlook, Salesforce Calendar | ❌ | Aucune vue calendrier ni export. Cherché : `calendar`, `ics` | Rendez-vous visibles en liste seulement ; pas de synchronisation Google / Outlook | P2 | Services, B2B |
| D3-07 | Campagnes marketing | Salesforce Campaigns, Dynamics Marketing, Odoo Marketing | 🟡 | mig 383 `crm_campaigns` ; `crm.repository.ts:217-257` ; `CrmPage.tsx:433-501` | Nom, dates, budget, retour ; pas de liste cible, de membres, d'envoi en masse, de coût réel, de réponses | P2 | Retail, services |
| D3-08 | Capture web, formulaire, web-to-lead | Salesforce Web-to-Lead, Odoo website forms, HubSpot | ❌ | Aucune route publique. Cherché : `/public/`, `webform`, `web-to-lead` | Toute affaire est saisie à la main | P2 | Services, e-commerce |
| D3-09 | Intégration e-mail et modèles d'e-mail | Salesforce Email, Dynamics / Outlook, Odoo mail gateway | ❌ | `enqueueEmail` n'a que deux appelants : `rfq.repository.ts:57`, `dunning.repository.ts:199`. Activité « e-mail » = trace manuelle. Cherché : `email_templates` | Aucun envoi depuis une affaire, aucun suivi des échanges, aucun modèle | P2 | Services, B2B |
| D3-10 | Motifs de perte | Salesforce Closed Lost reason, Odoo lost reasons | ✅ | Référentiel `quote_lost_reasons` (mig 365) ; motif exigé (`crm.repository.ts:147`) ; `CrmPage.tsx:413-430` | — | — | Tous |
| D3-11 | Concurrents | Salesforce Competitors, SAP Competitor, Dynamics Competitors | ❌ | Seul le code de motif `competitor` existe (mig 365:115). Cherché : `competitor` | Pas de fiche concurrent ni de concurrent rattaché à l'affaire | P3 | Industrie, négoce |
| D3-12 | Prévision de ventes pondérée | Salesforce Forecast, Odoo expected revenue | ✅ | `weighted_amount` (`crm.repository.ts:29, 69`) ; `CrmPage.tsx:94` | — | — | Tous |
| D3-13 | Prévision par période, catégories, objectifs par commercial | Salesforce Collaborative Forecasts, Dynamics Forecasting, quotas | ❌ | Total pondéré global seulement (`crm.repository.ts:68-70`). Cherché : `quota`, `sales_target` | Pas de prévision par mois de conclusion, pas d'objectifs, pas d'écart réalisé / objectif | P2 | Tous B2B |
| D3-14 | Affectation automatique, territoires | Salesforce assignment rules, Dynamics routing, Odoo lead assignment | ❌ | Responsable choisi à la main, notification à l'affectation (`crm.repository.ts:282-289`) | Ni règles ni tour de rôle ni territoire | P2 | Distribution, services |
| D3-15 | Contacts multiples par compte, détection des doublons, fusion | Salesforce Contacts + Duplicate rules, SAP BP relationships | ❌ | `customers` = un nom, un téléphone, un e-mail ; prospect = un contact. Cherché : `customer_contacts`, `duplicate`, `merge` | Un seul interlocuteur par client ; `createCustomer` crée une fiche sans chercher de doublon (`crm.repository.ts:195-208`) | P1 | Tous B2B |
| D3-16 | Source de l'affaire et analyse par source | Salesforce Lead Source, Odoo UTM | 🟡 | Référentiel `crm_sources` saisi (`CrmPage.tsx:270`) ; analyse calculée (`crm.repository.ts:76-79, 88`) mais jamais affichée — **serveur seul** | L'écran ne montre pas le retour par source | P3 | Tous |
| D3-17 | Conversion prospect → client | Salesforce Lead Convert, Odoo « convertir » | ✅ | `crm.repository.ts:195-208` ; `CrmPage.tsx:345` | Sans contrôle de doublon (voir D3-15) | — | Tous |
| D3-18 | Visibilité par commercial, rôle vendeur | Salesforce sharing, Dynamics security roles, Odoo « own documents » | 🟡 | Filtre « Mes affaires » (`crm.routes.ts:46-56`) ; droit module `crm` ; devis réservés à admin / gérant par rôle (`quotes.routes.ts:18`) | Tout utilisateur CRM voit toutes les affaires ; un commercial ne peut pas établir de devis ; aucun rôle « commercial » (`shared/src/constants/roles.ts:21-33`) | P1 | Négoce, distribution, services |
| D3-19 | Consentement de prospection (loi 09-08, CNDP) | Salesforce Individual / consent, Dynamics consent | ❌ | Cherché : `consent`, `opt_in`, `cndp`, `unsubscribe` | Aucun suivi du consentement ni de l'opposition des prospects | P1 | Tous (dès qu'il y a prospection) |
| D3-20 | Champs personnalisés et tableau de bord CRM | Tous | ✅ | mig 371 (entité `opportunity`) ; `CrmPage.tsx:218, 275` ; indicateurs `CrmPage.tsx:91-99` | — | — | Tous |
| **Devis** | | | | | | | |
| D3-21 | Cycle de vie du devis (client ou prospect) | SAP VA21, Odoo Quotation, NetSuite Estimate | ✅ | mig 365 ; `quote.repository.ts:152-268` ; `QuotesPage.tsx` | — | — | Tous |
| D3-22 | Versions et révisions | Salesforce CPQ amendments, Sage X3 révisions, Dynamics revise | 🟡 | « Dupliquer » pose `revision_of` (`quote.repository.ts:271-286`) ; modification en place d'un devis envoyé avec simple événement « Modifié après envoi » (`:201-226`) | Pas de numéro de version, pas d'instantané de la version envoyée, l'original n'est pas remplacé, pas de comparaison | P1 | Services, industrie, traiteur |
| D3-23 | Modèles de devis | Odoo Quotation Templates, Salesforce CPQ templates | ❌ | Aucun modèle ; un seul gabarit de mentions (`document_templates` « quote », mig 365) | Pas de devis type réutilisable (offres packagées, textes d'introduction) | P2 | Services, traiteur |
| D3-24 | Lignes libres, sections, sous-totaux | Odoo sections / notes, SAP text items, Sage X3 | ❌ | `quote_items.product_id NOT NULL` (mig 365) ; `order_items.product_id NOT NULL` (mig 008:22) | Impossible de chiffrer une ligne sans article, de structurer un devis en lots | P1 | Services, industrie, BTP, traiteur |
| D3-25 | Lignes optionnelles et variantes | Odoo optional products, SAP alternative items, CPQ | ❌ | Aucune colonne d'option sur `quote_items` | Pas d'option ni d'alternative chiffrée | P2 | Services, industrie |
| D3-26 | PDF du devis | Tous | ✅ | `quotes.routes.ts:112-161` ; `QuotesPage.tsx:365` | — | — | Tous |
| D3-27 | Envoi par e-mail avec suivi | Odoo « Send by email », Salesforce email tracking | ❌ | Bouton « Marquer envoyé » (`QuotesPage.tsx:375`) ; `transition('send')` ne met rien en file d'envoi (`quote.repository.ts:237-268`) | Le devis est imprimé puis envoyé hors de l'application ; ni e-mail, ni pièce jointe, ni suivi d'ouverture | P1 | Tous B2B |
| D3-28 | Signature électronique, acceptation en ligne | Odoo Sign / portail, DocuSign, Dynamics | ❌ | « Accepté » est un clic interne (`QuotesPage.tsx:381`). Cherché : `signature`, `accept_token` | Pas de lien client, pas de bon pour accord conservé | P2 | Services, B2B |
| D3-29 | Validité et expiration | SAP valid-to, Odoo expiration | ✅ | `valid_until`, paramètre `sales.quotes` ; tâche `quotes_expire` (`scheduler.ts:119-136`) | Limite : pas de rappel au client avant l'échéance | — | Tous |
| D3-30 | Circuit d'approbation (remise, marge) | SAP release strategy, Salesforce CPQ approvals, Odoo approvals | ❌ | Moteur d'approbation branché sur 4 pièces sans rapport avec les ventes (`approval-handlers.ts:15, 28, 39, 53`) ; le devis ne passe pas de contexte de contrôle à `priceLines` (`quote.repository.ts:67`) et accepte 0-100 % de remise (`:76`) | Aucun seuil ni validation ; les plafonds de remise et de prix des commandes ne s'appliquent pas aux devis (voir anomalie A1) | P1 | Tous B2B |
| D3-31 | Affichage de la marge | Odoo Sale Margin, SAP condition VPRS, NetSuite gross profit | ❌ | Aucun coût lu à la saisie du devis ou de la commande. Cherché : `marge|margin|cost_price` dans ces fichiers | Le vendeur ne voit ni coût ni marge par ligne | P1 | Négoce, distribution, industrie |
| D3-32 | Conversion totale en commande | Tous | ✅ | `quote.repository.ts:316-391` ; `QuotesPage.tsx:384, 404-420` | — | — | Tous |
| D3-33 | Conversion partielle, plusieurs commandes par devis | SAP référence partielle, Sage X3 | ❌ | Un seul `order_id` ; CHECK `(status = 'converted') = (order_id IS NOT NULL)` (mig 365) | Tout ou rien | P2 | Industrie, négoce |
| D3-34 | Facture proforma | Tous | ✅ | `quote.repository.ts:289-310` ; `QuotesPage.tsx:366` | — | — | Tous (export) |
| D3-35 | Devis et commandes multi-devises | SAP document currency, Odoo pricelists, NetSuite | ❌ | `currency_code` existe sur `purchase_orders`, `invoices`, `payments` (mig 363, 368) mais pas sur `quotes` ni `orders` ; « DH » codé en dur (`quote.repository.ts:265`, `QuotesPage.tsx`) | Offre en devise impossible alors que la facture client en devise existe (mig 431) | P1 | Export, négoce, industrie |
| D3-36 | Conditions commerciales structurées (paiement, incoterm, mode de livraison) | SAP header conditions, Sage X3, Dynamics | 🟡 | `delivery_terms`, `notes` en texte libre (mig 365) ; délai de paiement porté par le client seulement | Pas de conditions de paiement, d'incoterm ni de mode de livraison sur le devis ou la commande | P1 | Négoce, export, industrie |
| **Contrats** | | | | | | | |
| D3-37 | Contrats-cadres, commandes ouvertes | SAP VA41 quantity / value contract, Dynamics blanket order, Sage X3 contrats | ❌ | Cherché : `blanket`, `contrat-cadre`, `sales_contract` | Aucun engagement de volume ou de valeur suivi par appels | P1 | Distribution, industrie, services |
| D3-38 | Programmes de livraison avec appels | SAP scheduling agreement VA31 | ❌ | Cherché : `scheduling` | Aucun cadencier de livraison | P2 | Industrie, sous-traitance |
| D3-39 | Contrats de prix, tarifs négociés par client | SAP condition records, Odoo pricelists, NetSuite price levels | 🟡 | Seule remise : `customers.remise_pct` appliquée au prix catalogue (`delivery-note.repository.ts:97-109`) ; les tarifs par palier et par canal (mig 171, 173) ne servent qu'à la caisse (`pos-pricing.ts:1-12`) | Pas de prix net par client et article, pas de liste de prix, pas de validité, pas de barème par quantité en B2B | **P0** | Négoce, distribution, industrie |
| D3-40 | Renouvellement et échéances de contrat | SAP contrats, NetSuite renewals | ❌ | Sans objet faute de contrats ; abonnements sans renouvellement (D3-90) | Pas d'alerte d'échéance | P2 | Services |
| **Types de commande** | | | | | | | |
| D3-41 | Typologie de commande configurable | SAP order types (OR, RO, CR…), Sage X3 types de commande | 🟡 | `orders.type` sans contrainte depuis mig 069:5 ; l'écran ne crée que `custom` et `staff` (`OrderFormModal.tsx:411-462`) ; le processus est choisi par `customer_type` (`order.controller.ts:58`) | Pas de table de types portant des règles (numérotation, livraison, facturation, crédit) ; **couplage boulangerie** : libellés « Sur mesure », « Événement » | P1 | Tous |
| D3-42 | Commande standard B2B | Tous | ✅ | mig 354 ; `order.controller.ts:246-370` ; `OrdersPage.tsx` | Limites reprises en D3-65, 68, 84 | — | Tous |
| D3-43 | Vente au comptant | SAP cash sale, Odoo POS | ✅ | Ticket de caisse et commande particulier remise contre solde (`order.controller.ts:531-591`) | — | — | Retail |
| D3-44 | Commande urgente | SAP rush order | ❌ | Aucune priorité sur `orders` | Pas de priorité transmise à la préparation | P3 | Distribution |
| D3-45 | Consignation (dépôt-vente) | SAP consignment fill-up / issue / pick-up | ❌ | Cherché : `consign` (résultats sans rapport : consignes de fabrication) | Pas de stock en dépôt chez le client, pas de relevé de consommation | P2 | Distribution, édition, boulangerie (dépôts) |
| D3-46 | Livraison directe par le fournisseur | SAP third-party, Odoo dropshipping, NetSuite drop ship | ❌ | Cherché : `dropship`, `livraison directe` | Aucun lien commande client → bon de commande fournisseur | P2 | Négoce |
| D3-47 | Gratuits, échantillons | SAP free-of-charge delivery, free goods | 🟡 | Prix à 0 possible par dérogation motivée (`order.controller.ts:144-156`) ; articles offerts par le moteur de promotions (mig 372) | Pas de type « gratuit » ni de traitement dédié (compte de charge, TVA sur cadeaux) | P2 | Distribution, industrie |
| D3-48 | Commande de retour | SAP returns order, Odoo RMA, Dynamics return order | 🟡 | Avoir « retour » ligne à ligne sur facture (`credit-note.repository.ts:6-13`) ; retours de caisse (`return.repository.ts`) | Pas de pièce de retour avec autorisation, réception, contrôle et décision (remise en stock, rebut) | P1 | Distribution, négoce, retail |
| D3-49 | Demande d'avoir, demande de débit | SAP credit / debit memo request | 🟡 | Avoir AV direct (mig 450) ; approbation seulement pour l'annulation de facture (`approval-handlers.ts:39`) | Pas de demande soumise à validation ; pas de note de débit. Cherché : `debit_note` | P2 | Tous B2B |
| D3-50 | Inter-sociétés | SAP intercompany, NetSuite intercompany | ❌ | Cherché : `intercompany`, `inter-soci` | Aucune vente entre entités avec pièce miroir | P2 | Groupes |
| D3-51 | Fabrication à la commande et sourcing de la commande | SAP MTO / requirement types, Odoo routes (MTO, Buy) | 🟡 | `order.repository.ts:121-164` ; `sourcing.helper.ts:140-222` | **Couplage boulangerie** : tout manque de stock crée un plan de production, même pour un article acheté ; pas de route « acheter à la commande » ni « reliquat en attente de réception » ; quantités arrondies à l'entier (`sourcing.helper.ts:78`) ; sourcing sauté sans établissement (`order.repository.ts:127`) | **P0** | Négoce, distribution, retail |
| D3-52 | Commande de service, articles non stockés | SAP service items, Odoo service products, NetSuite service item | ❌ | Ligne = article obligatoire ; aucun type d'article « service » sur `products` (colonnes relevées : `sale_type`, `sale_unit`, `unit`…) | Une prestation saisie comme article passe par le sourcing et déclenche un plan de production ; pas de lien avec les projets ou les temps passés | **P0** | Services, industrie, traiteur |
| D3-53 | Commande récurrente, modèle, recommande | Odoo subscriptions (biens), SAP copie de pièce, Dynamics order templates | ❌ | Aucune duplication de commande ; abonnements = factures à montant fixe sans articles (mig 382). Cherché : `order_template`, `standing_order` | Pas de commande permanente (livraison quotidienne à un hôtel), pas de « recommander » | P1 | Distribution, boulangerie B2B, traiteur |
| D3-54 | Vente au personnel | Odoo employee pricelist | ✅ | Type `staff`, remise imposée par le serveur (`order.controller.ts:75-78`) ; `OrderFormModal.tsx:455-462` | — | — | Retail |
| **Canaux de saisie** | | | | | | | |
| D3-55 | Back-office et caisse | Tous | ✅ | `OrderFormModal.tsx` ; `POSPage.tsx:2785` | — | — | Tous |
| D3-56 | Portail client | Odoo portal, SAP Commerce, Dynamics customer portal | ❌ | Cherché : `portal`, `portail` (résultats : portails fiscaux seulement) | Le client ne peut ni commander ni suivre ses pièces | P1 | Distribution, négoce, services |
| D3-57 | E-commerce | Odoo eCommerce, connecteurs Shopify / WooCommerce | ❌ | Libellé `online` vestigial (`OrdersPage.tsx:54`), jamais créé. Cherché : `ecommerce`, `shopify`, `woocommerce` | Aucune boutique en ligne ni connecteur | P2 | Retail |
| D3-58 | EDI | SAP IDoc ORDERS / DESADV / INVOIC, Sage X3 EDI | ❌ | Seul l'EDI fiscal existe (`dgi-edi.service.ts`) | Pas d'échange de commandes avec la grande distribution | P2 | Distribution, industrie |
| D3-59 | API publique, clés d'API, webhooks | Tous (REST / OData) | ❌ | API interne protégée par session et CSRF. Cherché : `api_key`, `webhook` | Aucune intégration par un tiers | P1 | Tous |
| D3-60 | Import de commandes par fichier | SAP LSMW, Odoo import, NetSuite CSV | ❌ | Entités importables : fournisseurs, clients, matières, consommables, produits (`data-import.ts:34, 50-113`) | Pas d'import de commandes, de devis ni d'opportunités | P2 | Distribution |
| D3-61 | Mobile, prise de commande en tournée | SAP Sales Cloud mobile, Odoo mobile, van sales | 🟡 | Application Capacitor = enveloppe de l'application web (`mobile/capacitor.config.ts`) ; tournées de livraison (mig 387) | Pas de prise de commande terrain hors ligne, pas de vente en tournée | P2 | Distribution, boulangerie |
| **Promesse** | | | | | | | |
| D3-62 | Disponibilité à la saisie (ATP) et capacité (CTP) | SAP aATP, Dynamics CTP, Odoo forecasted availability | 🟡 | Disponible = stock − réservé calculé à l'enregistrement (`sourcing.helper.ts:69-79`) — **serveur seul** : aucun affichage dans `OrderFormModal.tsx` | Pas de disponible daté (réceptions et fabrications prévues), pas de date proposée, pas de lien avec la capacité (mig 398) | P1 | Tous |
| D3-63 | Réservation, allocation | SAP stock reservation, Odoo reservation | ✅ | mig 389 ; `order-fulfilment.ts:53-70` ; indicateur « dont N réservé » (`ProductsPage.tsx:588`) | Limites : stock frigo non réservé, pas d'allocation de lot à la commande | — | Tous |
| D3-64 | Reliquats | SAP backorders, Odoo backorder | ✅ | mig 441 ; `order-fulfilment.ts:76-97` ; `OrdersPage.tsx:1027` | Professionnels seulement (un particulier est remis en une fois) | — | Tous B2B |
| D3-65 | Dates demandée, promise, confirmée par ligne | SAP schedule lines, Dynamics requested / confirmed dates | 🟡 | Une seule date d'en-tête `orders.pickup_date`, obligatoire (`order.controller.ts:253`) ; reports journalisés (`order_reschedules`, mig 354) | **Couplage boulangerie** (« date de retrait ») ; pas de date par ligne, pas de distinction demandée / promise, pas d'échéancier de livraison | P1 | Industrie, distribution, négoce |
| D3-66 | Délais de livraison | SAP delivery scheduling, Odoo customer lead time | ❌ | `lead_time_days` n'existe que côté achats (mig 404) | Pas de délai par article ou client, pas de calcul de date au plus tôt | P2 | Industrie, négoce |
| D3-67 | Règles de livraison complète ou partielle | SAP complete delivery flag, Odoo shipping policy | 🟡 | Tolérance de sur-livraison par client (mig 441 §4) ; livraison partielle toujours permise | Pas d'indicateur « livraison complète exigée » ni de nombre maximal de livraisons partielles | P2 | Distribution, industrie |
| D3-68 | Adresses de livraison multiples, partenaires (livré, facturé, payeur) | SAP partner functions, Odoo delivery / invoice address | ❌ | Une seule adresse sur `customers` ; aucune adresse sur `orders` ni `quotes`. Cherché : `shipping_address`, `ship_to`, `customer_addresses` | Client multi-sites ingérable ; pas de facturation à un tiers payeur | **P0** | Distribution, négoce, industrie, services |
| D3-69 | Site d'expédition par commande ou par ligne | SAP plant / shipping point, Odoo warehouse | 🟡 | `orders.store_id` = établissement de l'utilisateur (`order.controller.ts:309`) | Pas de choix du dépôt d'expédition, pas de répartition par ligne | P1 | Distribution, multi-sites |
| **Contrôles** | | | | | | | |
| D3-70 | Blocage de crédit et déblocage | SAP credit management, Dynamics credit hold | ✅ | mig 443 ; `credit-control.ts:45-69` ; dérogation à l'expédition (`OrdersPage.tsx:1015-1023`) | — | — | Tous B2B |
| D3-71 | Contrôle de prix et de remise | SAP pricing block, Odoo discount limits | ✅ | `order.controller.ts:73-96, 125-168` ; `list_price`, `price_override_*` (mig 443) | Refus direct, sans mise en attente d'approbation (voir D3-80) ; non appliqué aux devis (A1) | — | Tous |
| D3-72 | Blocage manuel de commande (livraison, facturation) | SAP delivery / billing block | ❌ | Le blocage existe côté achats (`purchase_orders.on_hold`, mig 306) mais pas sur `orders` | Impossible de geler une commande avec un motif | P1 | Tous B2B |
| D3-73 | Contrôle de complétude | SAP incompletion log | ❌ | Contrôles minimaux à la création (`order.controller.ts:252-254`) | Pas de liste des données manquantes avant confirmation | P3 | Industrie |
| D3-74 | Modification de commande avec historique et versions | SAP change documents, Sage X3 révisions | 🟡 | Lignes stables (`order.repository.ts:217-266`) ; reports journalisés | Aucun journal des modifications ni version (les BC fournisseurs en ont : `purchase_order_versions`) ; lignes ajoutées ou augmentées non re-sourcées (A7) | P1 | Tous |
| D3-75 | Motifs d'annulation et de clôture | SAP reason for rejection | 🟡 | `cancel_reason` accepté par le serveur (`order.controller.ts:430, 451`) — **serveur seul** : l'écran n'en saisit jamais (`OrdersPage.tsx:216-223`) | Pas de référentiel de motifs ; pas de motif à la clôture du reliquat | P1 | Tous |
| D3-76 | Acomptes à la commande | SAP down payment request, Odoo down payment, facture d'acompte | 🟡 | Avance en caisse d'un particulier, ticket `advance`, acquise à l'annulation (`order.controller.ts:278-348, 454-471`) | Aucun acompte pour un professionnel (`:278` force 0) ; pas de facture d'acompte, pas de TVA sur l'avance, pas d'imputation sur la facture finale, pas de remboursement | **P0** | Industrie, services, traiteur, négoce |
| D3-77 | Confirmation de commande (document et e-mail) | SAP order confirmation, Odoo « confirmation » | ❌ | Aucun PDF de commande client ; PDF existants : devis, BL, facture. Cherché : `order-pdf`, `confirmation` | Le client ne reçoit aucun accusé de sa commande | P1 | Tous B2B |
| D3-78 | Suivi du flux de pièces | SAP document flow, Odoo smart buttons | 🟡 | Dernier BL et dernière facture dans la liste (`order.repository.ts:28-37`) ; devis → n° de commande (`quote.repository.ts:38`) ; opportunité → devis (`crm.repository.ts:100`) | Pas de vue d'ensemble (plusieurs BL, avoirs, règlements) ; depuis la commande, le devis d'origine n'apparaît que dans le texte des notes (`quote.repository.ts:366`) | P1 | Tous |
| D3-79 | Statuts ligne par ligne | SAP item status, Dynamics line status | 🟡 | Cumuls livré / facturé / annulé par ligne (mig 441) | `order_items.status` jamais mis à jour (A5) ; pas de statut de ligne affiché ni d'annulation d'une seule ligne | P2 | Industrie, distribution |
| D3-80 | Circuits d'approbation de commande | SAP release, Dynamics workflow, Odoo approvals | ❌ | Moteur mig 350 non branché aux ventes (`approval-handlers.ts`) | Au-delà du plafond, la saisie est refusée au lieu d'être soumise | P1 | Tous B2B |
| D3-81 | Pièces jointes (opportunité, devis, commande) | Tous | ❌ | Cherché : `attachment`, `pièce jointe` dans les routes de vente | Ni bon de commande du client, ni cahier des charges, ni devis signé | P1 | Tous B2B |
| D3-82 | Notifications | Tous | 🟡 | Internes : `order_ready`, `production_plan_created`, `quote_expired`, `quote_accepted`, `crm_*` | Rien vers le client (confirmation, commande prête, expédition). Cherché : `sms`, `whatsapp` | P2 | Tous |
| D3-83 | Machine à états contrôlée | Tous | ✅ | mig 441 §1 ; `OrdersPage.tsx:438-480` | — | — | Tous |
| D3-84 | Unités de vente, quantités décimales | SAP sales unit, Odoo UoM | ❌ | `order_items.quantity INT` (mig 008:23) ; `quote_items.quantity INTEGER` (mig 365) ; refus des décimales (`quote.repository.ts:65`) ; arrondi à l'entier (`sourcing.helper.ts:78`) | **Couplage boulangerie** (vente à la pièce) : pas de vente au kg, au mètre, au litre, au carton ; pas de conversion d'unités | **P0** | Négoce, distribution, industrie |
| D3-85 | Référence de commande du client, vendeur sur la pièce | SAP customer PO number, sales employee | ❌ | `orders.user_id` = saisisseur. Cherché : `customer_ref`, `po_number`, `salesperson` | Pas de n° de bon de commande du client ; pas de commercial attribué | P1 | Tous B2B |
| D3-86 | Frais annexes (port, emballage) | SAP header conditions, Odoo delivery costs | ❌ | Aucun champ de frais sur `orders` ni `quotes` | Frais de livraison saisis comme article ou oubliés | P2 | Négoce, e-commerce |
| D3-87 | Champs personnalisés sur commande et devis | Tous | 🟡 | Entité `order` autorisée (mig 371, `custom-fields.api.ts:6`) — **serveur seul** : aucun écran de commande ne les propose ; rien pour les devis | Données métier propres à un secteur non saisissables | P3 | Tous |
| **Abonnements** | | | | | | | |
| D3-88 | Plans et offres | Odoo Subscriptions, Zuora, NetSuite SuiteBilling | ❌ | Abonnement = libellé + montant libre (mig 382) | Pas de catalogue d'offres, pas d'articles ni de quantités | P2 | Services, SaaS, maintenance |
| D3-89 | Périodicité | Tous | 🟡 | `monthly`, `quarterly`, `yearly` figés (mig 382) | Pas d'hebdomadaire, de semestriel ni de période libre | P3 | Services |
| D3-90 | Renouvellement | Odoo renewals, Salesforce renewals | 🟡 | `end_date` → statut `ended` (`subscription.repository.ts:117-120`) | Pas de tacite reconduction, de préavis ni d'alerte d'échéance | P2 | Services |
| D3-91 | Prorata | Zuora, Odoo | ❌ | Montant plein à chaque échéance | Pas de prorata d'entrée, de sortie ni de changement d'offre | P2 | Services |
| D3-92 | Suspension, résiliation | Tous | 🟡 | Statuts `paused`, `ended` (`subscription.repository.ts:68-71` ; `SubscriptionsTab.tsx:95-96`) | Sans motif ni date d'effet ; la reprise facture les périodes de pause (A3) | P2 | Services |
| D3-93 | Facturation récurrente automatique | Tous | 🟡 | Génération par bouton (`SubscriptionsTab.tsx:63` ; `POST /subscriptions/generate`) | Aucune tâche planifiée (`scheduler.ts:239-253`) ; facture à une ligne, sans consommation | P1 | Services, maintenance |
| D3-94 | Indicateurs de revenu récurrent | Odoo MRR, Zuora | ❌ | Seul le total facturé par abonnement est calculé | Pas de revenu récurrent mensuel ou annuel, pas de taux d'attrition | P2 | Services |

---

## 4. Écarts détaillés P0 et P1

Effort : S = quelques jours · M = une à trois semaines · L = plus d'un mois.

### 4.1 P0

**D3-39 — Tarifs négociés par client**
- Constat : le seul levier B2B est une remise globale en pourcentage sur la fiche client (`delivery-note.repository.ts:97-109`). Les tarifs par palier et par canal existent (mig 171, 173) mais seule la caisse les lit (`pos-pricing.ts`) ; `priceLines` part de `products.price` (`order.controller.ts:137`).
- Impact : un négociant ou un distributeur ne peut pas saisir ses accords de prix (prix net par article, barème par quantité, validité). Les prix sont ressaisis à la main à chaque commande, chacun étant une « dérogation » à motiver.
- Piste : tables `price_lists` (devise, validité), `price_list_items` (article, quantité minimale, prix net ou remise), `customers.price_list_id` ; résolution unique partagée par caisse, devis et commande (étendre `pos-pricing.ts` en service commun) ; écran Ventes › Tarifs.
- Effort : M.

**D3-51 — Sourcing de commande limité à « stock puis production »**
- Constat : `computeSourcingAndCreatePlan` crée un plan de production pour toute quantité manquante (`sourcing.helper.ts:206-222`), que l'article ait une recette ou non. Aucune route d'achat.
- Impact : en négoce ou en distribution, une commande au-delà du stock produit un plan de fabrication sans objet et passe la commande « en production ». Aucun besoin d'achat n'est créé.
- Piste : mode d'approvisionnement par article (`supply_mode` : fabriqué, acheté, non stocké) ; pour « acheté », créer une demande d'achat liée à la ligne (le flux DA existe, mig 456-458) et un statut « en attente de réception » ; libellés neutres (« en préparation »).
- Effort : M.

**D3-52 — Prestations et articles non stockés**
- Constat : une ligne exige un article (`order_items.product_id NOT NULL`, idem `quote_items`) et tout article est traité comme stocké et fabriqué.
- Impact : une société de services ne peut ni deviser ni commander une prestation sans déclencher la production ; le module Projets (mig 358) n'est pas alimenté par les commandes.
- Piste : `products.item_type` (bien stocké, bien non stocké, service) ; le sourcing ignore les services ; à la livraison, « service fait » au lieu d'une sortie de stock ; lien facultatif ligne → projet.
- Effort : M.

**D3-68 — Adresses de livraison et partenaires**
- Constat : une adresse par client, aucune adresse sur la commande, le devis ou le BL d'origine commande.
- Impact : client à plusieurs points de livraison (chaîne, hôtels, chantiers) ingérable sans dupliquer les fiches, ce qui fausse l'encours et le plafond de crédit. Pas de facturation à une centrale.
- Piste : table `customer_addresses` (type livraison / facturation, contact, par défaut) ; `orders.ship_to_address_id`, `bill_to_customer_id` ; reprise sur BL, facture et tournée.
- Effort : M.

**D3-76 — Acomptes de commande**
- Constat : l'avance n'existe que pour un particulier, encaissée en caisse sous forme de ticket sans TVA (`order.controller.ts:318-339`). Pour un professionnel, l'avance est forcée à zéro (`:278`). La conversion d'un devis crée la commande sans avance (`quote.repository.ts:365`).
- Impact : un traiteur, un industriel ou un prestataire ne peut pas demander 30 % à la commande à un client professionnel. À confirmer avec l'expert-comptable : au régime de l'encaissement, la TVA est due sur l'acompte reçu, ce qui suppose une facture d'acompte — non vérifiable dans le code, c'est une hypothèse fiscale.
- Piste : facture d'acompte (`invoices.kind = 'down_payment'`, compte 4421), imputation automatique sur la facture finale, avoir d'acompte à l'annulation ; taux d'acompte proposé depuis le devis.
- Effort : M.

**D3-84 — Unités de vente et quantités décimales**
- Constat : quantités entières sur les devis et les commandes, alors que les BL et les cumuls sont déjà en `NUMERIC(12,3)` (mig 441) et que la caisse vend au poids.
- Impact : impossible de commander 2,5 kg, 12,40 m ou 3 cartons de 24. Un envoi de quantité décimale à `POST /orders` n'est pas refusé proprement par le contrôleur (`order.controller.ts:133-134` accepte tout nombre positif) et échouerait à l'insertion dans la colonne entière — comportement déduit de la lecture, non exécuté.
- Piste : `quantity NUMERIC(12,3)` sur `order_items` et `quote_items` ; unité de vente sur la ligne, table de conversions par article ; lever `Math.floor` du sourcing.
- Effort : M (touche sourcing, réservation, production, écrans).

### 4.2 P1

| ID | Constat | Impact | Piste de solution | Effort |
|---|---|---|---|---|
| D3-01 | Pas d'objet « piste » ; un prospect n'existe que dans une opportunité | Pas de base de prospection ; les contacts sans affaire en cours ne sont nulle part | Table `leads` (statut, source, campagne, responsable) ; conversion en client + contact + opportunité ; écran Ventes › Pistes | M |
| D3-03 | Étapes et probabilités codées en dur à trois endroits | Chaque secteur a son cycle de vente ; toute adaptation demande un développement | Table `crm_stages` (ordre, probabilité, gagné / perdu) remplaçant le CHECK ; éditeur dans Paramètres | S |
| D3-15 | Un contact par client ; aucun contrôle de doublon | Interlocuteurs multiples impossibles ; fiches en double à la conversion | Table `customer_contacts` (fonction, rôle) ; recherche par téléphone, e-mail, ICE avant création ; fusion de fiches | M |
| D3-18 | Devis réservés par rôle à admin / gérant ; pas de rôle commercial ; aucune restriction de visibilité | Une force de vente ne peut pas travailler en autonomie | Droit de module `quotes` (comme `crm`) ; rôle « commercial » ; filtre « ses propres pièces » ; plafonds de remise par rôle étendus | S |
| D3-19 | Aucun suivi du consentement | Risque de non-conformité à la loi 09-08 dès la première campagne | Champs consentement / opposition et date sur client et piste ; filtre dans les envois | S |
| D3-22 | Révision = copie liée ; édition en place d'un devis envoyé | On ne sait plus ce que le client a reçu ; litiges | `quotes.version`, instantané JSON à l'envoi (`quote_versions`), l'ancienne version passe « remplacée » | S |
| D3-24 | Ligne = article obligatoire | Devis de service ou de projet illisibles | `line_type` (article, texte, section, sous-total) et `product_id` facultatif sur `quote_items` et `order_items` | M |
| D3-27 | « Marquer envoyé » sans envoi | Double travail, aucune trace de l'envoi | Bouton « Envoyer » : PDF en pièce jointe par `email_outbox` (ajouter les pièces jointes au mailer), modèle de message, journal dans `quote_events` | S |
| D3-30 | Aucune validation ; plafonds des commandes non appliqués | Remise ou prix hors politique accordés par devis puis convertis | Brancher `quote` sur le moteur mig 350 (condition : remise, marge, montant) ; appliquer `PricingCtx` aux devis | S |
| D3-31 | Pas de coût ni de marge à la saisie | Vente à perte invisible | Coût de revient par ligne (le coût figé existe, mig 444 et 452) ; marge en valeur et en % sur devis et commande, réservée aux rôles autorisés | S |
| D3-35 | Pas de devise sur devis ni commande | Offre export impossible alors que la facture en devise existe | `currency_code`, `exchange_rate` sur `quotes` et `orders` ; reprise à la facturation | M |
| D3-36 | Conditions en texte libre | Échéance, incoterm et transport non repris sur BL ni facture | Référentiels conditions de paiement, incoterms, modes de livraison ; colonnes sur devis et commande, valeur par défaut du client | S |
| D3-37 | Aucun contrat-cadre | Engagements annuels suivis hors système | Tables `sales_contracts` / `sales_contract_items` (quantité ou valeur cible, prix, validité) ; commande « appel » imputée au contrat | L |
| D3-41 | Type libre sans règles ; processus déduit du type de client | Chaque nouveau cas (échantillon, retour, service) demande du code | Table `order_types` (numérotation, acompte, livraison, facturation, contrôle de crédit) ; découpler « particulier / professionnel » de la caisse | M |
| D3-48 | Retour traité par avoir direct | Pas de contrôle de la marchandise revenue ni d'autorisation | Pièce « retour client » : autorisation, réception, contrôle qualité, décision, avoir généré | M |
| D3-53 | Ni copie ni commande permanente | Ressaisie quotidienne des commandes régulières | « Dupliquer » une commande ; modèle de commande récurrente (jours, quantités par jour) générant les commandes par tâche planifiée | M |
| D3-56 | Aucun portail | Toute commande passe par un salarié | Espace client authentifié : catalogue au tarif du client, commande, suivi, factures, acceptation du devis | L |
| D3-59 | Pas d'API ouverte | Aucune intégration (site marchand, logisticien, outil du client) | Clés d'API par intégration, périmètres, points d'entrée commandes / clients / stocks, webhooks de statut | M |
| D3-62 | Disponibilité calculée mais non montrée | Le vendeur promet sans voir | Point d'entrée de disponibilité (stock − réservé + entrées prévues par date) ; affichage par ligne dans la saisie ; date proposée | M |
| D3-65 | Une date d'en-tête, nommée « retrait » | Pas d'engagement de date par ligne ni de mesure du taux de service | `requested_date` et `promised_date` par ligne ; libellé neutre ; indicateur livré à temps | M |
| D3-69 | Établissement = celui de l'utilisateur | Pas d'expédition depuis un autre dépôt | Choix du dépôt sur la commande, puis par ligne ; sourcing par dépôt | M |
| D3-72 | Pas de blocage manuel | Impossible de suspendre une commande litigieuse | `orders.hold_type`, motif, auteur ; contrôle au BL et à la facture ; déblocage tracé (modèle existant : mig 306) | S |
| D3-74 | Aucun historique des modifications | Qui a changé un prix ou une quantité reste inconnu | `order_versions` (instantané + différences) sur le modèle de `purchase_order_versions` ; re-sourcing à la modification | M |
| D3-75 | Motif d'annulation jamais saisi | Aucune analyse des annulations | Référentiel `order_cancel_reasons` ; fenêtre de motif obligatoire ; motif au solde du reliquat | S |
| D3-77 | Aucune confirmation de commande | Pas d'accusé pour le client professionnel | PDF « Confirmation de commande » (réutiliser `invoice-pdf.service`) ; envoi par e-mail à la confirmation | S |
| D3-78 | Flux partiel | Reconstituer une affaire demande plusieurs écrans | `orders.quote_id` ; vue « flux » sur la commande : devis, BL, factures, avoirs, règlements | S |
| D3-80 | Refus au lieu d'approbation | Le vendeur doit faire ressaisir par la direction | Type `sales_order` dans le moteur mig 350 ; statut « en attente d'approbation » | M |
| D3-81 | Aucune pièce jointe | Le bon de commande du client reste dans une boîte mail | Table générique `document_attachments` (type de pièce, identifiant) ; stockage hors disque éphémère | M |
| D3-85 | Ni référence client ni vendeur | Rapprochement avec le bon de commande du client impossible ; commissions par vendeur fragiles | `orders.customer_reference`, `orders.salesperson_id` (repris du devis et de l'opportunité) | S |
| D3-93 | Génération manuelle | Oubli de facturation | Tâche planifiée `subscriptions_invoice` ; lignes d'articles sur l'abonnement | S |

---

## 5. Compteurs

| | Nombre |
|---|---|
| Capacités auditées | 94 |
| ✅ Complet | 19 |
| 🟡 Partiel | 28 |
| ❌ Absent | 47 |

Priorité des 75 écarts (🟡 et ❌) :

| P0 | P1 | P2 | P3 |
|---|---|---|---|
| 6 | 30 | 33 | 6 |

Écarts marqués « couplage boulangerie » : D3-41, D3-51, D3-65, D3-84 (et la notification des chefs par catégorie, anomalie A14).
Capacités « serveur seul » : D3-16 (analyse par source), D3-62 (disponibilité), D3-75 (motif d'annulation), D3-87 (champs personnalisés de commande).

---

## 6. Anomalies rencontrées en chemin

| N° | Anomalie | Preuve | Gravité |
|---|---|---|---|
| A1 | Les plafonds de remise par rôle et le contrôle des dérogations de prix (O2C L3) ne s'appliquent pas aux devis ; la conversion reprend prix et remise tels quels. Un gérant plafonné sur les commandes peut donc accorder n'importe quelle remise en passant par un devis | `quote.repository.ts:67` (`priceLines` sans contexte), `:76` (remise 0-100), `:335-343` | Haute |
| A2 | Le motif d'annulation d'une commande n'est jamais transmis : `ordersApi.updateStatus(id, status, reason)` est appelé sans motif | `OrdersPage.tsx:150, 222` ; `POSPage.tsx:896` ; `orders.api.ts:8` ; serveur `order.controller.ts:430, 451` | Moyenne |
| A3 | Reprise d'un abonnement en pause : `next_invoice_date` n'ayant pas bougé, la génération suivante facture toutes les échéances passées pendant la pause (jusqu'à 36) — déduit de la lecture, non exécuté | `subscription.repository.ts:68-71, 96-120` | Haute |
| A4 | La migration 382 annonce une génération « automatique » ; aucune tâche planifiée n'existe pour les abonnements | mig 382 (en-tête) ; `scheduler.ts:239-253` | Moyenne |
| A5 | `order_items.status` est écrit à « pending » à la création et n'est jamais lu ni mis à jour : colonne morte | mig 119 ; `order.repository.ts:109` (seul usage) | Faible |
| A6 | Types de commande incohérents : `shared` déclare `in_store`, `custom`, `online`, `staff` ; l'écran libelle `custom`, `online`, `event`, `staff` ; la base n'a plus de contrainte ; `online`, `event`, `in_store` ne sont créés par aucun écran | `shared/src/constants/order-status.ts:24-29` ; `OrdersPage.tsx:54` ; mig 069:5 | Faible |
| A7 | Modification d'une commande : une ligne ajoutée ou une quantité augmentée n'est ni re-sourcée ni réservée, et le plan de production n'est pas ajusté (le commentaire du code l'admet) | `order.repository.ts:195-198, 249-254` | Moyenne |
| A8 | Sourcing et réservation sautés sans avertissement si l'utilisateur (ou le devis converti) n'a pas d'établissement — déjà relevé (G-FF-07), toujours présent | `order.repository.ts:127` ; `quote.repository.ts:367` | Moyenne |
| A9 | Date de commande antidatable par tout rôle de vente — déjà relevé (G-OM-08), toujours présent | `order.controller.ts:247, 308` ; `order.repository.ts:93` ; `OrderFormModal.tsx:541` | Moyenne |
| A10 | Suppression physique d'une commande annulée : la trace de l'annulation (auteur, date, motif) disparaît | `order.repository.ts:363-372` ; `orders.routes.ts:20` | Moyenne |
| A11 | Analyse par source calculée par le serveur, jamais affichée | `crm.repository.ts:76-79, 88` ; `crm.api.ts:40` ; aucun usage dans `CrmPage.tsx` | Faible |
| A12 | Champs personnalisés déclarés pour l'entité `order` sans aucun écran de saisie | `custom-fields.api.ts:6` ; mig 371 (contrainte d'entités) ; `OrderFormModal.tsx` (aucun usage) | Faible |
| A13 | Canal de vente déduit de deux codes en dur (`gros`, `commande`) : si un client renomme ou supprime ces canaux, le canal devient NULL sans erreur | `order.repository.ts:94-96` ; `quote.repository.ts:168-170` | Faible |
| A14 | Notification de production routée par des catégories de boulangerie codées en dur, avec repli sur le rôle « baker » | `order.controller.ts:20-34` | Moyenne (couplage) |
| A15 | Lecture d'une opportunité ou d'un devis par identifiant sans contrôle d'établissement, alors que les listes filtrent par établissement (la commande, elle, contrôle) | `crm.routes.ts:57-61` ; `quotes.routes.ts:67-71` ; comparer `order.controller.ts:236-238` | Moyenne |
| A16 | Les tarifs par palier et par canal sont ignorés par les devis et les commandes | `pos-pricing.ts:1-12` (seul consommateur) ; `order.controller.ts:137` | Moyenne |
| A17 | Devise « DH » codée en dur dans les notifications et les écrans de devis | `quote.repository.ts:265` ; `scheduler.ts:133` ; `QuotesPage.tsx:89-93` | Faible |
| A18 | Numéros de migration en double : 051, 264, 265, 426, 427, 428 | `ls server/migrations` | Faible |
| A19 | Aucun test automatisé pour le CRM ni les abonnements ; les devis ne sont couverts que par la conversion | `server/src/__tests__` : seul `db/o2c-l3.db.test.ts` référence `quoteRepository` | Moyenne |
| A20 | La conversion d'un devis exige une « date de livraison ou de retrait » et crée toujours une commande de type `custom` sans avance, même si le devis mentionne un acompte en texte libre | `quotes.routes.ts:96-97` ; `quote.repository.ts:364-365` | Faible |

**Non vérifié** (aucune exécution, aucun accès base, conformément aux règles de l'audit) : le comportement réel de A3 et de l'envoi d'une quantité décimale (D3-84) ; l'état des données de production ; l'hypothèse fiscale de D3-76 sur la TVA des acomptes.
