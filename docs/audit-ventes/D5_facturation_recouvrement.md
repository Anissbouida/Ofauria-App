# D5 — Facturation client, encaissements, crédit et recouvrement

Audit du domaine D5 de Kalum face aux grands ERP (SAP S/4HANA SD Billing / FI-AR / FSCM, Oracle Fusion Receivables et Advanced Collections, Dynamics 365 Finance, NetSuite, Sage X3, Odoo Enterprise).
Date : 2026-11-09. Branche : `claude/kalum-sales-cycle-o2c-audit-f724ad`. Lecture seule, aucune exécution (ni serveur, ni base, ni migration).

Convention : ✅ complet (serveur ET écran câblés) · 🟡 partiel · ❌ absent. Priorités : P0 bloquant multi-secteur ou obligation légale au Maroc · P1 attendu d'un ERP de milieu de gamme · P2 avancé · P3 niche.
Tout ce qui est noté « vérifié » l'a été par lecture du code cité. Ce qui relève d'une déduction ou d'un point de droit à faire confirmer est noté « supposé » ou « à confirmer ».

---

## 1. Périmètre et sources lues

**Périmètre** : de l'émission de la facture client (FE) et de l'avoir (AV) jusqu'à l'encaissement, au lettrage, à la relance, au contrôle de crédit et aux écritures de fin de période. Hors périmètre : commande, expédition, prix (autres domaines), sauf là où ils conditionnent la facture.

**Migrations lues** (`server/migrations/`) : 242 (identifiants légaux et conditions du client), 309 (colonnes facture, `einvoice_*` réservées), 329 (séries de numérotation), 332 (modèles de documents), 351, 352, 353, 354, 356, 357 (réclamations), 358 (projets), 364 (e-mails), 366, 368, 382 (abonnements), 431, 435, 439, 443, 450, 451, 452, 466, 467 (survolée), 413/420/426 (en-têtes).

**Serveur** (`server/src/`) :
- dépôts : `accounting.repository.ts` (objets `invoiceRepository`, `paymentRepository`), `credit-note`, `customer-receipt`, `receivables`, `dunning`, `aged-balance`, `lettrage`, `bill-portfolio`, `bank-reconciliation`, `period-end`, `fx-revaluation`, `payment-schedule`, `subscription`, `delivery-note`, `document-sequence`, `complaint`, `project`, `withholding`, `ledger` (déclaration de TVA) ;
- services : `journal-generator.service.ts`, `credit-control.ts`, `invoice-pdf.service.ts`, `invoice-docx.service.ts`, `scheduler.ts`, `mailer.ts`, `bank-statement-import.service.ts`, `dgi-edi.service.ts`, `setup-status.ts` ;
- contrôleurs et routes : `accounting.controller.ts`, `accounting.routes.ts`, `dunning.routes.ts`, `customers.routes.ts`, `delivery-note.routes.ts`, `bank-reconciliation.routes.ts`, `payment-schedule.routes.ts`, `subscription.routes.ts`, `order.controller.ts` (avances), `validators/payment.validator.ts`.

**Client** (`client/src/features/`) : `sales/EmittedInvoicesTab.tsx`, `sales/ReceivablesTab.tsx`, `sales/ProSalesTab.tsx`, `sales/SubscriptionsTab.tsx`, `sales/SalesLayout.tsx`, `dunning/DunningPage.tsx`, `customers/CustomersPage.tsx`, `accounting/{AgedBalanceTab,LettrageTab,BanqueTab,BillsPortfolioTab,ClotureTab,AccountingPage}.tsx`, `quotes/QuotesPage.tsx`.

**Recherches par mot-clé** (sur `server/src`, `server/migrations`, `shared/src`, `client/src`) pour établir les absences : `factur-x`, `facturx`, `peppol`, `xades`, `timbre`, `stamp`, `direct_debit`, `prélèvement`, `payment_link`, `cmi`, `payzone`, `stripe`, `affactur`, `factoring`, `coface`, `credit_insurance`, `escompte`, `early_payment`, `writeoff`, `irrécouvrable`, `douteu`, `3424`, `3942`, `promesse`, `dso`, `délai moyen`, `compensation`, `netting`, `rembours`, `milestone`, `jalon`, `deferred_revenue`, `debit_note`, `sms`, `portal`, `portail`, `tva_regime`, `revenue_account`.

Les documents `docs/AUDIT_O2C_GAP_ANALYSIS.md` et `docs/AUDIT_COUPLAGE_SECTORIEL.md` n'ont pas servi de preuve.

---

## 2. Ce qui existe (forces, avec preuves)

1. **Chaîne BL → facture tenue par la base.** Chaque ligne de facture désigne la ligne de BL et de commande qu'elle facture ; le facturé net est borné par le livré par un trigger différé (mig 450 : `invoice_items.delivery_note_item_id`, `delivery_note_items.qty_invoiced`, `fn_refresh_dni_invoiced`). Facturation de plusieurs BL d'un client en une transaction : `delivery-note.repository.ts:384`. Écran : `ProSalesTab.tsx:144`.
2. **Facturation périodique planifiée.** Tâche `monthly_invoicing` (`scheduler.ts:163`) : une facture par client et par mois, ou par livraison selon `customers.billing_frequency` (mig 354). Livrée désactivée (mig 450 § 6).
3. **Facture émise figée et numérotée sans trou.** Triggers `trg_guard_emitted_invoice_lock` et `trg_guard_emitted_invoice_items` (mig 439) ; série `invoice_emitted` `gapless` (mig 329) ; suppression refusée (`accounting.repository.ts:1637`) ; numéro jamais fourni par l'appelant (`:755`).
4. **Avoirs liés ligne à ligne.** Série AV continue, quatre motifs, imputation immédiate sur la facture d'origine puis sur une autre facture du client (`credit-note.repository.ts:56`, `:162` ; mig 450). Annulation totale soumise au circuit d'approbation `invoice_cancel` (`accounting.controller.ts:281-314`). Écran : `EmittedInvoicesTab.tsx:1085-1188`.
5. **Encaissement réparti et avances.** Un règlement sur plusieurs factures (`payment_allocations`, mig 451), reste en avance client 4421, affectation ultérieure avec sa propre écriture 4421 → 3421 (`customer-receipt.repository.ts:34`, `:89` ; `journal-generator.service.ts:1043`). Écran : `ReceivablesTab.tsx:463-612`.
6. **Portefeuille de chèques et d'effets.** Bordereau de remise à l'encaissement ou à l'escompte, dénouement, impayé avec réouverture de la créance et frais (mig 435, `bill-portfolio.repository.ts:105-215`, `BillsPortfolioTab.tsx`).
7. **Lettrage complet.** Manuel, automatique, partiel (pré-lettrage promu au solde, mig 466), axe facture sur les lignes d'écriture (mig 451 § 4), gardes différées (mig 420) ; `lettrage.repository.ts:241`, `LettrageTab.tsx`.
8. **Deux balances âgées rapprochées.** Gestion (`receivables.repository.ts:160`, tickets à crédit compris) et comptable à date (`aged-balance.repository.ts:65`), avec pont gestion ↔ compte 3421 par client (`receivables.repository.ts:194-226`).
9. **Relances paramétrables.** Niveaux, textes à champs, frais, taux d'intérêt, blocage, tâche quotidienne, envoi par e-mail en file, PDF, pause par client (mig 366, `dunning.repository.ts`, `DunningPage.tsx`).
10. **Contrôle de crédit unique et journalisé.** `fn_customer_exposure` (tickets impayés + factures ouvertes + BL non facturés + reste à livrer − avoirs − avances ; mig 443/450/451), décision à chaque jalon dans `credit_check_events`, dérogation motivée à l'expédition (`credit-control.ts:44`).
11. **Devises côté comptable.** Facture de prestations en devise, règlement au taux du jour, écart de change réalisé 7331/6331 (`journal-generator.service.ts:880-892`), réévaluation de clôture et contre-passation (mig 431, `fx-revaluation.repository.ts`).
12. **Fin de période.** Factures à établir 3427 extournées à l'ouverture, contrôle « factures clients sans écriture » bloquant (mig 452, `period-end.repository.ts:74`, `ClotureTab.tsx:356`).
13. **Banque.** Import CSV / Excel / OFX / MT940 / CFONB avec profils (`bank-statement-import.service.ts`), rapprochement automatique par montant à ± 7 jours (`bank-reconciliation.repository.ts:336`).

---

## 3. Tableau des capacités

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D5-01 | Facture sur livraison (BL → facture, facturé ≤ livré) | SAP VF01 delivery-related ; Odoo « delivered quantities » | ✅ | mig 450 ; `delivery-note.repository.ts:384` ; `ProSalesTab.tsx:144` | Pas de devise sur le BL (voir D5-28) | — | tous |
| D5-02 | Facture sur commande ou avant livraison (marchandises sans BL) | SAP order-related billing ; Odoo « ordered quantities » | ❌ | `accounting.controller.ts:247` renvoie 410 ; refus `accounting.repository.ts:749` | Aucune facture de marchandises hors BL | P1 | négoce, e-commerce, services, industrie à la commande |
| D5-03 | Facturation groupée / périodique | SAP collective billing VF04 ; X3 facturation périodique | ✅ | `scheduler.ts:163` ; mig 354 `billing_frequency` ; mig 450 § 6 | Tâche désactivée à l'installation | — | distribution, traiteur, B2B |
| D5-04 | Règles de regroupement / fractionnement | SAP copy control / split ; D365 summary update | 🟡 | `scheduler.ts:168-176` : client × (mois \| livraison) seulement | Pas de règle par commande, site livré, semaine, quinzaine, condition de paiement, devise | P2 | distribution, industrie |
| D5-05 | Proforma | SAP F5/F8 ; Odoo pro-forma | ✅ | `quote.repository.ts:288` ; `invoice-pdf.service.ts:100` ; `QuotesPage.tsx:366` | — | — | export, négoce |
| D5-06 | Facture d'acompte et reprise sur la facture finale | SAP down payment request FAZ ; Odoo down payment ; X3 acomptes | ❌ | `kind='prepayment'` autorisé (mig 309:137) mais jamais écrit ; pro « ni avance ni caisse » `order.controller.ts:278` | L'avance n'est qu'un règlement non affecté (4421) : pas de pièce, pas de TVA, pas de déduction sur la facture | P0 | industrie, BTP, traiteur, services, négoce |
| D5-07 | Facturation à l'avancement / jalons / situations | SAP milestone billing ; D365 project invoicing ; X3 situations | ❌ | recherche `milestone`, `jalon`, `situation`, `avancement` : rien côté facture | Aucun plan de facturation | P1 | services, BTP, industrie, traiteur événementiel |
| D5-08 | Facturation des temps et frais de projet | NetSuite / D365 time & material | 🟡 serveur seul | `project_time_entries.invoice_id` (mig 358:98) ; non-facturé calculé `project.repository.ts:26` ; colonne jamais renseignée | Pas de génération de facture depuis les temps | P1 | services, maintenance |
| D5-09 | Facturation récurrente (abonnements, contrats) | SAP billing plan ; NetSuite SuiteBilling ; Odoo Subscriptions | 🟡 | mig 382 ; `subscription.repository.ts:75` ; `SubscriptionsTab.tsx:27` | Une ligne à montant fixe ; génération manuelle (aucune tâche dans `scheduler.ts:239-254`) ; ni prorata, ni indexation, ni préavis, ni plusieurs lignes | P1 | services, maintenance, location, SaaS |
| D5-10 | Facture / note de débit (complément de prix) | SAP debit memo ; Oracle debit memo | ❌ | `subsequent_debit` dans le CHECK (mig 309:137), aucun usage | Complément = nouvelle facture sans lien | P2 | négoce, industrie |
| D5-11 | Avoirs liés à la facture (annulation, retour, prix, geste) | SAP credit memo ; Oracle credit memo | ✅ | mig 450 § 2-3 ; `credit-note.repository.ts:56` ; `EmittedInvoicesTab.tsx:1120` | — | — | tous |
| D5-12 | Avoir libre, avoir de retour avec remise en stock, remise de fin d'année | SAP returns + credit ; rebates | 🟡 | contrainte `chk_emitted_credit_note_origin` (mig 450) ; motif « retour » purement financier `credit-note.repository.ts:106-111` | Pas d'avoir sans facture d'origine ; aucun mouvement de stock ; pas de RFA | P2 | distribution, négoce |
| D5-13 | Annulation de facture (avec approbation) | SAP VF11 ; Odoo reversal | ✅ | `accounting.controller.ts:281-314` ; trigger mig 439 (refus si réglée) | — | — | tous |
| D5-14 | Facture libre de prestations | Oracle manual transaction ; Odoo facture manuelle | ✅ | `accounting.repository.ts:719` ; `EmittedInvoicesTab.tsx:140, 598` | — | — | services |
| D5-15 | Facture à partir d'un ticket de caisse | Odoo POS « Invoice » ; Sage 100 | ❌ | aucun lien `sales` → `invoices` ; routes `sales.routes.ts` sans facture | Un client comptoir qui demande une facture n'en obtient pas | P1 | retail, négoce, restauration |
| D5-16 | Remises de ligne et de pied sur la facture | tous | 🟡 | `invoice_items` sans colonne de remise ; PDF « REMISE 0 % » par défaut `invoice-pdf.service.ts:450` | Remise noyée dans le prix net | P2 | négoce, distribution |
| D5-17 | Détermination des comptes de produits par article / prestation | SAP account determination VKOA ; Odoo income account | 🟡 | TVA par taux ✅ (`journal-generator.service.ts:104-117`) ; produit codé en dur `'7111'` (`:363`, `:333`) | Toute vente va en 7111 « marchandises » ; aucun paramétrage par famille, prestation ou secteur | P0 | tous hors négoce pur |
| D5-18 | Numérotation légale continue et chronologique | CGI art. 145 ; SAP official document numbering | 🟡 | série `gapless` (mig 329:76) ; `accounting.repository.ts:711-716` | Millésime pris sur la date du jour, pas sur la date de facture ; aucune garde de chronologie (voir § 6-A1) | P0 | tous |
| D5-19 | Inaltérabilité de la facture émise | Odoo lock / hash ; SAP | ✅ | mig 439 ; `accounting.repository.ts:1634-1638` ; chaînage des écritures mig 413 | — | — | tous |
| D5-20 | Mentions obligatoires marocaines | CGI art. 145 | 🟡 | vendeur RC / patente / IF / ICE : `document-template.ts:83` ; client : une ligne « ICE / IF » `invoice-pdf.service.ts:291`, `accounting.controller.ts:623` | Aucun contrôle de l'ICE du client professionnel à l'émission ; mode de règlement vide (`:708`) ; pas de mention d'exonération | P0 | tous en B2B |
| D5-21 | Facturation électronique (DGI, Factur-X, Peppol / UBL) | SAP Document Compliance ; Odoo EDI | ❌ | colonnes réservées `einvoice_uid/format/status` (mig 309:133-135), aucun code | Ni format structuré, ni dépôt, ni statut | P1 (P0 dès le calendrier DGI) | tous |
| D5-22 | Archivage légal du document émis | SAP ArchiveLink ; Odoo pièce jointe figée | ❌ | PDF régénéré à chaque téléchargement `accounting.controller.ts:563-742` | Le PDF change si le modèle ou la fiche client change ; aucune copie figée ni empreinte | P1 | tous |
| D5-23 | PDF de facture et d'avoir | tous | ✅ | `invoice-pdf.service.ts` ; `EmittedInvoicesTab.tsx:358` | — | — | tous |
| D5-24 | Envoi par e-mail avec suivi | Odoo « Send & Print » ; NetSuite | ❌ | `enqueueEmail` appelé par relances et appels d'offres seulement (`dunning.repository.ts:199`, `rfq.repository.ts:57`) | Facture, avoir, relevé : téléchargement manuel | P1 | tous |
| D5-25 | Modèles de documents personnalisables | SAP Adobe Forms ; Odoo Studio | 🟡 | `document_templates` (mig 332) : conditions, pénalités, pied, RIB | Une seule mise en page codée ; pas de modèle par société, client ou type | P2 | tous |
| D5-26 | Langue du document | tous | ❌ | libellés français en dur `invoice-pdf.service.ts:97-101` | Ni arabe, ni anglais, ni langue par client | P2 | export, négoce |
| D5-27 | Portail client | SAP, Odoo, NetSuite Customer Center | ❌ | recherche `portal`, `portail` : rien côté client | — | P2 | B2B, services |
| D5-28 | Factures en devise | tous | 🟡 | prestations en devise `EmittedInvoicesTab.tsx:626` ; mig 431 | BL, commande, devis et fiche client sans devise : pas de facture de marchandises en devise ; règlement réparti refusé en devise `customer-receipt.repository.ts:29` | P1 | export, négoce, industrie |
| D5-29 | Écarts de change réalisés et réévaluation de clôture | SAP FAGL_FCV ; Odoo | ✅ | `journal-generator.service.ts:880-892` ; `fx-revaluation.repository.ts` ; `FxRevaluationTab.tsx` | — | — | export |
| D5-30 | Conditions de paiement structurées | SAP payment terms ; Odoo payment terms | 🟡 | un entier `customers.delai_paiement_jours` (mig 242) ; `delivery-note.repository.ts:406` | Pas de référentiel, ni fin de mois, ni jour fixe, ni condition par facture | P1 | tous en B2B |
| D5-31 | Échéances multiples / échéancier client | SAP installment plan ; Odoo | ❌ | `payment-schedule.repository.ts:4` : « sorties d'argent » ; aucun écran côté ventes | Une seule `due_date` par facture | P1 | industrie, BTP, services, mobilier |
| D5-32 | Escompte pour paiement anticipé | SAP cash discount ; Odoo early payment | ❌ | `escompte` ne désigne que l'escompte bancaire d'effets (mig 435) | — | P2 | distribution, négoce |
| D5-33 | Pénalités et intérêts de retard | SAP interest calculation ; D365 interest notes | 🟡 | mention imprimée (mig 332) ; calcul sur la lettre `dunning.repository.ts:134` | « Non comptabilisés » (mig 366, en-tête) : ni facture d'intérêts, ni écriture | P1 | tous en B2B |
| D5-34 | Loi 69-21 : contrôle des délais et déclaration | spécifique Maroc | ❌ | seules les mentions imprimées (`setup-status.ts:132`) | Aucun contrôle du délai convenu, aucun état des retards | P1 (à confirmer) | tous en B2B |
| D5-35 | Espèces, chèque, virement, carte, paiement mobile | tous | ✅ | `journal-generator.service.ts:838-842` ; `ReceivablesTab.tsx:253-258` | L'écran ventes ne propose pas le compte de trésorerie (voir § 6-A9) | — | tous |
| D5-36 | Effet / LCN et portefeuille (remise, escompte, impayé) | Sage 100 ; X3 ; SAP bills of exchange | ✅ | mig 435 ; `bill-portfolio.repository.ts` ; `BillsPortfolioTab.tsx` | — | — | négoce, industrie |
| D5-37 | Prélèvement | SEPA DD ; mandats | ❌ | recherche `direct_debit`, `prélèvement`, `mandat` | — | P3 | services, abonnements |
| D5-38 | Lien de paiement en ligne (CMI, etc.) | Odoo payment providers ; NetSuite | ❌ | recherche `payment_link`, `cmi`, `payzone`, `stripe` : seul un libellé de référentiel (mig 058:85) | — | P2 | services, e-commerce |
| D5-39 | Règlement réparti sur plusieurs factures, paiement partiel | SAP F-28 ; Oracle receipt application | ✅ | mig 451 ; `customer-receipt.repository.ts:34` ; `ReceivablesTab.tsx:525` | — | — | tous |
| D5-40 | Avance client non affectée, affectation ultérieure | Oracle on-account ; Odoo outstanding credit | ✅ | `customer-receipt.repository.ts:89` ; `journal-generator.service.ts:869, 1043` ; `ReceivablesTab.tsx:466` | — | — | tous |
| D5-41 | Trop-perçu et remboursement client | SAP F-31 ; Oracle refund | 🟡 | trop-perçu = avance via règlement réparti ; le chemin « une facture » refuse (`accounting.repository.ts:2376`) | Aucun remboursement d'avance ou d'avoir : seule l'annulation du règlement existe | P1 | tous |
| D5-42 | Compensation client-fournisseur | SAP F.13 / netting ; X3 | ❌ | recherche `compensation`, `netting` : seul un code EDI (`dgi-edi.service.ts:8`) | — | P2 | négoce, industrie |
| D5-43 | Écarts de règlement, frais bancaires, abandon de petits soldes | SAP tolerance groups ; Odoo write-off | ❌ | affecté ≤ règlement, reste dû strict (`customer-receipt.repository.ts:45, 56`) | Un écart de quelques centimes laisse la facture ouverte | P1 | tous |
| D5-44 | Retenues à la source subies | spécifique Maroc ; SAP withholding tax AR | ❌ | `withholding.repository.ts:5-10` ne traite que les retenues opérées | Un client qui retient ne peut être soldé qu'à la main | P1 (à confirmer) | services, BTP, marchés publics |
| D5-45 | Créances douteuses et irrécouvrables | SAP FI-AR ; Odoo bad debt | ❌ | compte 3424 présent au plan (mig 179:140), aucun traitement | Ni reclassement, ni passage en perte, ni TVA | P1 | tous |
| D5-46 | Provisions pour créances douteuses | SAP FAGL ; X3 | ❌ | 3942 cité dans `liasse.rules.ts:10` seulement | Saisie libre d'OD uniquement | P1 | tous |
| D5-47 | Relevé de compte client | tous | 🟡 | `receivables.repository.ts:266` ; `ReceivablesTab.tsx:369` | Affichage seul : ni PDF, ni e-mail ; hors tickets à crédit ; non lié au lettrage | P1 | tous en B2B |
| D5-48 | Balance âgée | tous | ✅ | `receivables.repository.ts:160` ; `aged-balance.repository.ts:65` ; `AgedBalanceTab.tsx` | Tranches fixes | — | tous |
| D5-49 | Lettrage total, partiel, automatique | Sage ; SAP clearing | ✅ | mig 420, 466 ; `lettrage.repository.ts:241` ; `LettrageTab.tsx:105-135` | — | — | tous |
| D5-50 | Rapprochement bancaire et import de relevés | tous | ✅ | mig 426 ; `bank-reconciliation.repository.ts:336` ; `BanqueTab.tsx:139` | — | — | tous |
| D5-51 | Imputation automatique des encaissements depuis le relevé | SAP lockbox / EBS ; Odoo reconciliation models | ❌ | l'auto-rapprochement ne cherche qu'une écriture existante de même montant (`bank-reconciliation.repository.ts:354-366`) | Aucun règlement créé depuis une ligne de relevé, aucune règle par référence | P2 | tous à fort volume |
| D5-52 | Relances : niveaux, lettres, e-mail, historique | SAP dunning F150 ; Odoo follow-up | ✅ | mig 366 ; `dunning.repository.ts` ; `DunningPage.tsx` | — | — | tous en B2B |
| D5-53 | Relance par SMS ou messagerie | Odoo SMS | ❌ | recherche `sms` | — | P3 | retail, services |
| D5-54 | Liste de travail du recouvreur, promesses de paiement | SAP Collections Management ; Oracle Advanced Collections | 🟡 | propositions `dunning.repository.ts:75` ; pause `customers.dunning_paused_until` | Pas d'affectation, de note de contact, de promesse (date et montant), de prochaine action | P2 | tous en B2B |
| D5-55 | Plafond, encours consolidé, contrôle aux jalons | SAP FSCM Credit ; D365 credit management | ✅ | mig 443/450/451 ; `credit-control.ts:44` ; `CustomersPage.tsx:561, 896` | Effets en portefeuille non comptés (supposé) | — | tous en B2B |
| D5-56 | Blocage et déblocage avec approbation | SAP DCD ; D365 credit holds | 🟡 | `dunning.routes.ts:108-116` ; dérogation `credit-control.ts:54` | Déblocage direct sans trace (voir § 6-A8) ; pas de demande ni de circuit | P2 | tous en B2B |
| D5-57 | Score / classe de risque, revue des limites | SAP credit scoring ; Oracle credit profile | ❌ | fiche client : `credit_limit` seul (mig 242) | — | P2 | négoce, distribution |
| D5-58 | Assurance-crédit, affacturage | SAP ; X3 factoring | ❌ | recherche `affactur`, `factoring`, `coface` | — | P3 | export, industrie |
| D5-59 | Litige rattaché à une facture | SAP Dispute Management ; Oracle disputes | 🟡 | `complaints.invoice_id` (mig 357:48) ; statut `disputed` serveur seul (`accounting.controller.ts:535`) | Pas de montant contesté ; résolution non liée à l'avoir ; pièce en litige toujours relancée (`receivables.repository.ts:99`) ; aucun écran côté ventes | P1 | tous en B2B |
| D5-60 | Écritures automatiques (3421, 4421, 7111, 4455x) | tous | ✅ | `journal-generator.service.ts:328-398, 834-905, 1043` | Comptes en dur (voir D5-17) | — | tous |
| D5-61 | Régime de TVA : encaissement ou débit | CGI art. 95 ; SAP deferred tax ; Odoo cash basis | ❌ | TVA créditée à la facture (`journal-generator.service.ts:378-386`) ; déclaration par date d'écriture (`ledger.repository.ts:841-867`) | Régime des débits de fait, sans paramètre ; la déductible, elle, suit le règlement | P0 (à confirmer) | tous |
| D5-62 | Droit de timbre sur règlement en espèces | spécifique Maroc | ❌ | recherche `timbre`, `stamp` : rien | Ni calcul, ni ligne, ni compte | P0 (à confirmer) | retail, négoce, services |
| D5-63 | Factures à établir et contrôles de clôture | SAP accruals ; Odoo cut-off | ✅ | mig 452 ; `period-end.repository.ts:74` ; `ClotureTab.tsx:356-388` | — | — | tous |
| D5-64 | Produits constatés d'avance, reconnaissance du revenu | SAP RAR ; NetSuite ARM ; Odoo deferred revenue | ❌ | recherche `deferred_revenue`, `revenue_recogn` ; CCA côté charges seulement (mig 380) | Abonnement annuel facturé d'avance : tout le produit sur le mois | P1 | services, abonnements, maintenance |
| D5-65 | Indicateurs : DSO, taux de recouvrement | tous | 🟡 | ratio encaissé / facturé calculé à l'écran `EmittedInvoicesTab.tsx:339` | Pas de DSO, pas d'historique, pas par client ou commercial | P2 | tous |

---

## 4. Écarts détaillés P0 et P1

Effort : S ≤ 3 jours · M 1 à 2 semaines · L > 2 semaines.

### P0

**D5-06 — Facture d'acompte et reprise**
- Constat (vérifié) : une avance client est un règlement non affecté porté en 4421 (`customer-receipt.repository.ts:63`). Aucune pièce n'est émise, aucune TVA n'est constatée sur l'acompte, la facture finale ne montre pas l'acompte déduit. Les commandes de professionnels n'acceptent pas d'avance (`order.controller.ts:278`).
- Impact : impossible de vendre sur acompte à un professionnel avec une pièce opposable. Bloquant pour l'industrie à la commande, le BTP, le traiteur événementiel, les services.
- Piste : `invoices.kind = 'prepayment'` (déjà dans le CHECK), série dédiée, lien `orders.id` ; écriture 3421 / 4421 + TVA ; sur la facture finale, ligne négative de reprise liée à la facture d'acompte. Écran : bouton « Facture d'acompte » sur la commande, bloc « Acomptes déduits » sur la facture et le PDF.
- Effort : M.

**D5-17 — Compte de produit codé en dur**
- Constat (vérifié) : `const revCode = '7111'` pour toute facture client (`journal-generator.service.ts:363`), 7111 ou 7129 pour l'avoir (`:333`). La résolution par catégorie existe pour les charges et pour les recettes hors facture (`:887`), pas pour les lignes de facture client.
- Impact : une prestation, un bien produit et une marchandise revendue tombent dans le même compte. Le CPC est faux dès qu'on sort du négoce pur.
- Piste : compte de produit sur la famille d'articles et sur un référentiel de prestations ; `invoice_items.revenue_account_code` figé à l'émission ; `posting_profiles` par type de ligne ; une ligne de produit par compte dans l'écriture.
- Effort : M.

**D5-18 — Numérotation : millésime et chronologie**
- Constat (vérifié) : `generateInvoiceNumber` n'envoie pas la date de la pièce (`accounting.repository.ts:711-716`), alors que l'avoir l'envoie (`:754`). La période du compteur est donc celle du jour. La tâche mensuelle date la facture du dernier jour du mois écoulé (`scheduler.ts:180`). Aucune garde ne refuse une facture datée avant la dernière émise.
- Impact (supposé, non exécuté) : une facture datée du 31/12/2026 émise le 02/01/2027 porterait un numéro FE-2027. La suite des numéros ne suit plus l'ordre des dates.
- Piste : passer `data.invoiceDate` au compteur ; trigger refusant une date antérieure à la dernière facture de la série ; pour la facturation de fin de mois, dater du jour d'émission ou réserver la période.
- Effort : S.

**D5-20 — Mentions obligatoires**
- Constat (vérifié) : le PDF imprime une seule ligne « ICE / IF » alimentée par l'ICE, à défaut l'IF, à défaut l'ICE fournisseur (`accounting.controller.ts:623`). `customer_rc` est lu (`accounting.repository.ts:673`) mais jamais imprimé. Rien n'empêche d'émettre une facture à un professionnel sans ICE ; seul l'écran Clients le signale (`CustomersPage.tsx:90`). Le mode de règlement est transmis vide (`:708`). Le drapeau `tva_exonere` met le taux à 0 sans mention d'exonération.
- Impact : factures non conformes pour le client (droit à déduction) et pour l'émetteur.
- Piste : contrôle à l'émission (ICE du client requis selon le type, paramétrable alerte ou blocage, comme `fn_validate_invoice` côté achats) ; bloc client complet ; mention d'exonération par motif ; mode de règlement.
- Effort : S.

**D5-61 — Régime de TVA**
- Constat (vérifié) : la TVA facturée est créditée en 4455x à la date de facture et la déclaration lit ces comptes par date d'écriture (`ledger.repository.ts:841-867`). La TVA déductible suit déjà la date du règlement (mig 311, commentaire `:872`). Aucun paramètre de régime (recherche `tva_regime`, `encaissement`).
- Impact : pour une société au régime de l'encaissement, la TVA des ventes à crédit est déclarée trop tôt. À confirmer avec l'expert-comptable (régime de droit commun, option pour les débits).
- Piste : paramètre société « encaissement | débits » ; en encaissement, TVA en compte d'attente à la facture, basculée en TVA due à chaque affectation de règlement, au prorata (les `payment_allocations` portent déjà le montant par facture) ; déclaration lue sur le compte de TVA due.
- Effort : M.

**D5-62 — Droit de timbre**
- Constat (vérifié) : aucune occurrence de `timbre` ni `stamp` dans le code et les migrations.
- Impact : obligation à confirmer avec l'expert-comptable (taux, périmètre, seuils de déclaration). Si elle s'applique, le règlement en espèces d'une facture n'est ni majoré ni déclaré.
- Piste : paramètre (taux, modes concernés, compte) ; ligne de timbre à l'encaissement en espèces ; écriture au compte de dette envers l'État ; état mensuel.
- Effort : S à M.

### P1

**D5-02 — Facture sur commande / marchandises sans BL**
- Constat : `createFromOrder` répond 410, la création refuse toute ligne produit sans ligne de BL (`accounting.repository.ts:749`).
- Impact : pas de facturation avant expédition, de vente départ sans BL, de facture de marchandises non stockées.
- Piste : politique de facturation par type de commande (« sur livré » | « sur commandé ») ; `invoice_items.order_item_id` sans BL ; borne facturé ≤ commandé.
- Effort : M.

**D5-07 — Avancement, jalons, situations**
- Constat : aucun plan de facturation. Piste : table `billing_plans` (commande ou projet, jalon, pourcentage ou montant, date, statut) ; génération de la facture du jalon ; cumul facturé ; retenue de garantie en option. Effort : L.

**D5-08 — Temps et frais de projet**
- Constat : le non-facturé est calculé, `project_time_entries.invoice_id` n'est jamais écrit.
- Piste : action « Facturer les temps » sur la fiche projet (lignes groupées par activité), qui renseigne `invoice_id` ; forfait relié à D5-07. Effort : M.

**D5-09 — Facturation récurrente**
- Constat : un montant, une ligne, trois fréquences ; génération par bouton ; création de la facture et de sa trace en deux transactions (`subscription.repository.ts:103-112`).
- Piste : lignes d'abonnement (article, quantité, prix), prorata, date d'anniversaire, indexation, préavis ; tâche planifiée ; transaction unique ; lien avec D5-64. Effort : M.

**D5-15 — Facture depuis un ticket de caisse**
- Constat : aucun lien ticket → facture.
- Piste : « Éditer une facture » sur un ou plusieurs tickets d'un client identifié ; pièce FE qui reprend les lignes sans repasser le chiffre d'affaires (écriture de reclassement ou facture « sans écriture » liée au ticket) ; garde anti-double facturation. Effort : M.

**D5-21 — Facturation électronique**
- Constat : trois colonnes réservées, aucun code.
- Piste : modèle sémantique de facture (EN 16931) produit depuis `invoices` ; export UBL / Factur-X ; connecteur de dépôt et suivi de statut dès la publication du cahier des charges DGI. Dépend de D5-20 et D5-22. Effort : L.

**D5-22 — Archivage légal**
- Constat : PDF recalculé à chaque demande depuis la fiche client et le modèle du jour.
- Piste : à l'émission, figer le PDF (stockage objet, pas le disque éphémère) avec empreinte et instantané des mentions (client, société) sur la facture. Effort : M.

**D5-24 — Envoi par e-mail**
- Constat : la file `email_outbox` existe et n'est pas branchée sur les factures.
- Piste : `POST /invoices/:id/send` (PDF joint, modèle de message) ; `sent_at`, destinataire, statut ; envoi groupé après la facturation mensuelle ; contact de facturation sur la fiche client. Effort : S.

**D5-28 — Marchandises en devise**
- Constat : devise absente du devis, de la commande, du BL et de la fiche client ; `delivery-note.repository.ts:420` crée la facture sans devise ; le règlement réparti refuse la devise.
- Piste : devise et taux sur la chaîne de vente (ou au minimum à la facturation du BL) ; devise par défaut du client ; règlement réparti en devise. Effort : M.

**D5-30 et D5-31 — Conditions de paiement et échéancier client**
- Constat : un nombre de jours par client ; une échéance par facture ; l'échéancier existant est celui des décaissements.
- Piste : référentiel `payment_terms` (lignes : pourcentage, jours, fin de mois, jour fixe, escompte) ; `invoice_due_dates` (facture, échéance, montant, soldé) ; balance âgée, relances et encours lus par échéance ; condition sur le client, reprise et modifiable sur le devis et la commande. Effort : M à L.

**D5-33 — Pénalités et intérêts de retard**
- Constat : montants calculés et imprimés sur la lettre, jamais comptabilisés.
- Piste : facture d'intérêts ou note de débit (D5-10) générée depuis la relance, compte de produits financiers ; taux légal paramétré et historisé ; base juridique à confirmer (la lettre cite la loi 69-21, voir § 6-A12). Effort : M.

**D5-34 — Loi 69-21**
- Constat : mentions seules. La déclaration porte sur les factures fournisseurs payées en retard : elle relève surtout du cycle achats ; côté ventes, il manque le contrôle du délai convenu et l'état des retards par client. À cadrer avec l'expert-comptable. Effort : M.

**D5-41 — Remboursement client**
- Constat : une avance ou un avoir non imputé ne peut pas être rendu au client.
- Piste : `POST /payments/customer-refunds` (règlement sortant lié à l'avance ou à l'avoir, écriture 4421 ou 3421 / trésorerie, lettrage). Effort : S.

**D5-43 — Écarts de règlement et petits soldes**
- Constat : aucune tolérance.
- Piste : à l'encaissement, option « solder l'écart » sous un seuil paramétré, vers frais bancaires, escompte accordé ou écart de règlement ; traitement de masse des soldes inférieurs à un seuil. Effort : S à M.

**D5-44 — Retenues à la source subies**
- Constat : seules les retenues opérées par la société existent.
- Piste : à l'encaissement, ligne « retenue subie » (type, taux, base, attestation), débit d'un compte de créance sur l'État, facture soldée pour le brut ; état des retenues subies. Périmètre légal à confirmer. Effort : M.

**D5-45 et D5-46 — Créances douteuses, irrécouvrables, provisions**
- Constat : comptes présents au plan, aucun traitement ; une facture irrécouvrable reste ouverte en gestion même si une OD la solde au grand livre, car `invoices.paid_amount` ne suit que les règlements et avoirs.
- Piste : actions sur la facture « passer en douteux » (3421 → 3424), « provisionner » (dotation et reprise), « passer en perte » (perte + régularisation de TVA, statut `written_off`) ; chacune met à jour le reste dû, l'encours et les relances. Effort : M.

**D5-47 — Relevé de compte**
- Constat : affichage à l'écran, factures et règlements seulement.
- Piste : PDF et envoi par e-mail (D5-24), tickets à crédit inclus, pièces ouvertes mises en évidence par le lettrage, envoi périodique planifié. Effort : S.

**D5-59 — Litiges**
- Constat : le statut `disputed` se pose par l'API mais aucun écran de vente ne l'offre (l'écran existe côté achats, `PurchasingPage.tsx:767`). La relance prend toute pièce non soldée et non annulée (`receivables.repository.ts:99`).
- Piste : `invoice_disputes` (facture, motif, montant contesté, responsable, échéance, résolution, avoir lié) ou extension de `complaints` ; exclusion du montant contesté des relances ; bouton sur la facture. Effort : M.

**D5-64 — Produits constatés d'avance et étalement du revenu**
- Constat : les charges constatées d'avance existent (mig 380), pas leur symétrique.
- Piste : période de service sur la ligne de facture ; écriture de régularisation à la clôture et constatation mensuelle, sur le modèle des CCA. Effort : M.

---

## 5. Compteurs

| | Nombre |
|---|---|
| Capacités auditées | 65 |
| ✅ Complet | 20 |
| 🟡 Partiel | 18 |
| ❌ Absent | 27 |

Écarts (🟡 + ❌) : 45.

| Priorité | Nombre | Identifiants |
|---|---|---|
| P0 | 6 | D5-06, 17, 18, 20, 61, 62 |
| P1 | 21 | D5-02, 07, 08, 09, 15, 21, 22, 24, 28, 30, 31, 33, 34, 41, 43, 44, 45, 46, 47, 59, 64 |
| P2 | 15 | D5-04, 10, 12, 16, 25, 26, 27, 32, 38, 42, 51, 54, 56, 57, 65 |
| P3 | 3 | D5-37, 53, 58 |

**Couplage boulangerie relevé dans le domaine**
- Deux processus figés « particulier en caisse » et « professionnel sur BL » (`order.controller.ts:44-49`) : l'acompte n'existe que pour le premier, la facture que pour le second.
- Compte de produit unique 7111 et comptes CGNC en dur dans le générateur (`journal-generator.service.ts:363, 838`).
- Fuseau `Africa/Casablanca` et « DH » en dur dans les requêtes et les messages (`credit-note.repository.ts:32`, `customer-receipt.repository.ts:45`, `credit-control.ts:32`, textes de relance de la mig 366).
- Rythmes de facturation limités à « par livraison » et « mensuel » (mig 354).
- Colonne « catégorie » du PDF tirée des catégories de produits (`accounting.controller.ts:572-582`).

---

## 6. Anomalies rencontrées en chemin

Toutes lues dans le code ; aucune n'a été reproduite à l'exécution.

- **A1 — Millésime du numéro de facture.** `accounting.repository.ts:711-716` appelle `nextDocumentNumber` sans date, `:754` (avoir) avec la date de la pièce. Voir D5-18.
- **A2 — Échéance imprimée ≠ échéance suivie.** Sans `due_date`, le PDF imprime date + 30 jours (`accounting.controller.ts:651`) ; les créances, les relances et la balance âgée retiennent date + délai du client (`receivables.repository.ts:94`). Les factures libres de prestations sont créées sans échéance (`EmittedInvoicesTab.tsx:235-247`).
- **A3 — Code mort : édition d'une facture émise.** `openEdit`, `handleUpdateManual`, `updateManualMutation` (`EmittedInvoicesTab.tsx:250-306`) ne sont atteignables que si `validation_status !== 'validated'` (`:550`, `:1089`), or le trigger `trg_emitted_invoice_born_validated` (mig 439) valide toute facture émise à l'insertion.
- **A4 — Code mort : `invoice-docx.service.ts`** (519 lignes), importé nulle part. La route `/invoices/:id/download-docx` et la route `/download-pdf` pointent toutes deux sur `downloadDocx`, qui renvoie un PDF (`accounting.routes.ts:132-133`) ; la méthode client s'appelle `downloadDocx` et appelle `/download-pdf` (`accounting.api.ts:164`).
- **A5 — Code mort avec compte faux : `fromProductLoss`** crédite 3421 (clients) sous le libellé « Sortie stock produit fini » (`journal-generator.service.ts:1620-1621`). Neutralisé par `void fromProductLoss` (`product-loss.controller.ts:180`), mais toujours exporté.
- **A6 — Échéancier sans garde de sens.** `createInvoiceSchedule` lit `invoice_type` sans le tester (`payment-schedule.repository.ts:161`) : `POST /invoices/:id/schedule` sur une facture client créerait des échéances dans le calendrier des décaissements (supposé).
- **A7 — Encaissement réparti sans validateur.** `POST /payments/customer-receipts` n'a pas de schéma (`accounting.routes.ts:158`, contre `validate(createPaymentSchema)` en `:155`) ; `paymentMethod` est une chaîne libre et retombe sur le compte 5141 si elle est inconnue (`journal-generator.service.ts:838`).
- **A8 — Déblocage de crédit non tracé.** `release` remet à NULL motif, date et auteur du blocage (`dunning.repository.ts:225-227`) et n'écrit rien dans `credit_check_events` ; aucun motif n'est demandé (`dunning.routes.ts:114`).
- **A9 — Compte de trésorerie non proposé aux ventes.** Le serveur accepte `treasuryAccountId` (`customer-receipt.repository.ts:36`), aucun écran de `features/sales` ne l'envoie : tout virement client va au compte bancaire par défaut. L'écran de facture ne propose ni carte ni mobile (`EmittedInvoicesTab.tsx:823`).
- **A10 — Abonnements non atomiques.** La facture est créée dans sa propre transaction, puis la ligne `subscription_invoices` est insérée à part (`subscription.repository.ts:103-112`) : un échec entre les deux referait la facture au passage suivant (supposé).
- **A11 — Avoir imputé sur une autre facture : axe de lettrage.** La ligne 3421 de l'avoir porte l'axe de la facture d'origine (`journal-generator.service.ts:345-346`) ; son imputation ultérieure sur une autre facture ne passe aucune écriture (`credit-note.repository.ts:45-52`). Le lettrage par facture de la seconde pièce reste à vérifier.
- **A12 — Base juridique des pénalités.** Le niveau 3 livré écrit « Pénalités de retard (loi n° 69-21) » comme une somme due au créancier (mig 366:57). À faire valider : la loi 69-21 institue surtout une amende et une déclaration ; les pénalités dues au fournisseur relèvent du Code de commerce.
- **A13 — Pièces en litige relancées.** Voir D5-59 : `openDocuments` ne filtre que `paid` et `cancelled`.
- **A14 — Relevé de compte en devise.** Le relevé additionne `p.amount` (trésorerie en DH au taux du jour) et non `settled_amount` (`receivables.repository.ts:290`) : sur une facture en devise soldée, le solde afficherait l'écart de change (supposé).
- **A15 — Tâche de facturation et exercice clos.** Si la période de la date voulue est close, la facture est datée du jour (`scheduler.ts:181-183`) sans alerte : le produit de décembre passe en janvier, alors que la FAE (mig 452) couvre ce cas si elle a été passée.
