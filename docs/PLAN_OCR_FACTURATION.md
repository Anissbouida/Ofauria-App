# Plan — Intégration OCR dans le module Facturation (type devstation.org)

> Objectif : déposer la pièce du fournisseur (PDF/photo) → extraction automatique des
> champs → pré-remplissage du brouillon de facture reçue → l'opérateur confirme → validation.
> Branche : `claude/ocr-facturation-integration-c2aeb3`.

## 1. Pourquoi c'est un petit chantier côté métier

Le schéma et le flux de validation existent déjà (lot L1 P2P, mig 438) :

- `invoices` porte déjà `supplier_invoice_number`, `invoice_date`, `declared_ht/vat/ttc`,
  `needs_supplier_document`, `attachment_url`, `currency_code`.
- La facture reçue **naît en `draft`** et ne peut être **validée** qu'avec n° fournisseur + TTC
  déclaré (trigger `fn_invoice_validation_requires_document` / `trg_invoice_requires_document`).
- Route `POST /invoices/:id/validate` → `accounting.repository.validate()` remplit les
  `declared_*`, passe `draft → validated`, pose les événements IR (rapprochement à 3).
- Route `POST /invoices/:id/attachment` (upload multer) existe déjà.

**L'OCR ne crée pas de nouveau flux** : il produit les champs qui alimentent la validation existante.

## 2. Architecture (3 pièces + 1 contrat)

```
[UI PurchaseOrdersTab] --upload--> [POST /invoices/ocr] --> [invoice-ocr.service] --> moteur OCR
        ^                                                                                |
        |------------------- JSON structuré (champs + confiance) ------------------------|
        |
   l'opérateur corrige --> [POST /invoices/:id/validate] (EXISTANT) --> draft→validated
```

### Contrat de sortie OCR (le JSON)
```ts
interface OcrInvoiceResult {
  supplierInvoiceNumber: string | null;
  invoiceDate: string | null;           // ISO yyyy-mm-dd
  declaredHt: number | null;
  declaredVat: number | null;
  declaredTtc: number | null;
  currencyCode: string | null;          // 'MAD' par défaut
  supplierGuess: { ice?: string; name?: string } | null;  // pour rapprocher le fournisseur
  lines: Array<{ label: string; qty: number | null; unitPrice: number | null; amount: number | null }>;
  confidence: Record<string, number>;   // 0..1 par champ → surlignage "à vérifier" dans l'UI
  rawText?: string;                      // trace / debug
}
```

## 3. Travaux, par lot

### Lot 0 — Choix du moteur (bloquant, décision utilisateur)
- **LLM vision** (Claude/Mistral OCR) : image/PDF → JSON direct. Multilingue FR/AR, léger sur
  Cloud Run, pas de parsing maison. → clé API + variable d'env.
- **API Document dédiée** (Google Document AI / AWS Textract `AnalyzeExpense` / Azure) : parseur
  "invoice" prêt. → compte cloud + credentials.
- **Tesseract** (local/gratuit) : texte brut → parsing des champs à écrire soi-même (fragile,
  binaire lourd sur Cloud Run). Déconseillé pour l'extraction de champs.

### Lot 1 — Backend : service + endpoint
- `server/src/services/invoice-ocr.service.ts` : `extractFromBuffer(buffer, mimetype) → OcrInvoiceResult`.
  Isole le moteur derrière une interface pour pouvoir en changer sans toucher au reste.
- `POST /invoices/ocr` (dans `accounting.routes.ts`, `invoicesRouter`) :
  - multer **`memoryStorage`** (PAS diskStorage — FS Cloud Run éphémère), limite 10 Mo,
    filtre `.pdf/.png/.jpg/.jpeg/.webp`.
  - auth `authenticate` + `authorize(...ROLE_GROUPS.ADMIN_MANAGER)`.
  - appelle le service, renvoie `OcrInvoiceResult`. **Ne crée aucune facture** (étape lecture seule).
- Variable d'env pour la clé API (+ documenter dans `.env.example` et secrets Cloud Run).
- Gestion d'erreurs : timeout moteur, image illisible, PDF multi-pages → message clair, pas de 500 muet.

### Lot 2 — Persistance de la pièce (corrige le bug Cloud Run)
- Basculer l'upload `attachment` existant de `diskStorage` → `memoryStorage` + stockage en base
  (data URI base64 dans `attachment_url`, comme le logo) OU object storage (GCS) si les PDF sont gros.
- Recommandation : **object storage** si > ~1 Mo fréquent (le base64 gonfle la base de +33 %) ;
  sinon data URI pour rester simple et cohérent avec l'existant.

### Lot 3 — Frontend : UI de scan
- Dans `client/src/features/accounting/PurchaseOrdersTab.tsx` (ou le modal de validation facture) :
  - bouton **« 📷 Scanner la facture »** → input fichier → `POST /invoices/ocr`.
  - pré-remplit le formulaire de validation avec le JSON ; **surligne** les champs dont
    `confidence < seuil` (ex. 0,8) en "à vérifier".
  - l'opérateur corrige, puis bouton **Valider** → `POST /invoices/:id/validate` (existant).
  - affiche l'aperçu de la pièce à côté du formulaire (lecture + contrôle visuel).
- Ajouter l'appel API dans la couche `client/src/api`.

### Lot 4 — Rapprochement (valeur ajoutée, optionnel au 1er jet)
- Fuzzy-match du fournisseur par ICE/nom (`supplierGuess`) → pré-sélection.
- Rapprochement 3 voies : comparer `declared_*` et lignes OCR aux lignes de BC/réception
  rattachées (`qty_invoiced_base` existe déjà) → mettre en évidence les écarts prix/quantité.

### Lot 5 — Tests + migration (si besoin)
- Aucune nouvelle colonne a priori (tout existe). Si on veut tracer le résultat OCR brut :
  migration additive `invoices.ocr_payload JSONB` — **numéroter 456+** (dernière committée = 455).
- Tests : service OCR (mock moteur), endpoint `/invoices/ocr` (fichier factice), parcours
  scan→validation. Vérif locale sur ports autorisés (5173/4173).

## 4. Points de vigilance
- **Cloud Run éphémère** : jamais de `diskStorage` pour ce qui doit survivre (voir Lot 2).
- **Secrets** : clé OCR en variable d'env / Secret Manager, pas en dur ; CI = env factice.
- **Multi-pages / factures groupées** : décider si on traite page 1 ou agrégé.
- **Coût par page** : logguer les appels (le module e-mails/jobs a déjà un pattern de traçage).
- **Darija / bilingue** : tester sur de vraies factures fournisseurs marocaines.
- **RGPD/données** : une API externe reçoit les factures → vérifier l'acceptabilité (sinon moteur auto-hébergé).

## 5. Estimation
- Lot 1 (service + endpoint) : ~0,5 j une fois le moteur choisi.
- Lot 2 (persistance) : ~0,5 j.
- Lot 3 (UI scan + pré-remplissage) : ~1 j.
- Lot 4 (rapprochement) : ~1 j (optionnel).
- Total 1er jet exploitable (lots 1-3) : ~2 j.
