# Traductions — avancement module par module (G6-05)

Généré par `client/scripts/i18n-report.ts` le 2026-11-19. Ne pas modifier à la main : relancer `cd client && npx tsx scripts/i18n-report.ts --write`.

- **À extraire** : chaînes françaises encore en dur (estimation par expressions régulières : textes JSX, attributs `placeholder`/`title`/`aria-label`/`label`/`alt`, messages `notify`/`toast`/`confirm`). Ordre de grandeur, pas un compte exact.
- **Extrait** : appels `t('…')` posés dans le module.
- **Clés** : clés du domaine du module dans `client/src/i18n/fr.ts` (préfixe = nom du dossier ; socle = `common`, `nav`, `module`, `header`, `session`, `lang`), et combien sont traduites en arabe et en anglais (une clé non traduite s'affiche en français).

**Total** : 10725 chaînes à extraire, 47 appels t() posés, 95 clés (95 traduites en arabe, 95 en anglais).

| Module | Fichiers | À extraire | Extrait | Avancement | Clés | Traduit ar | Traduit en |
|---|---:|---:|---:|---:|---:|---:|---:|
| Coquille (components/layout, config) | 8 | 12 | 17 | 59 % | 69 | 69 (100 %) | 69 (100 %) |
| features/accounting | 40 | 1776 | 0 | 0 % | 0 | — | — |
| features/approvals | 1 | 62 | 0 | 0 % | 0 | — | — |
| features/auth | 3 | 20 | 30 | 60 % | 26 | 26 (100 %) | 26 (100 %) |
| features/boutique | 5 | 85 | 0 | 0 % | 0 | — | — |
| features/controle | 10 | 255 | 0 | 0 % | 0 | — | — |
| features/crm | 1 | 100 | 0 | 0 % | 0 | — | — |
| features/customers | 7 | 229 | 0 | 0 % | 0 | — | — |
| features/dashboard | 2 | 22 | 0 | 0 % | 0 | — | — |
| features/dunning | 1 | 73 | 0 | 0 % | 0 | — | — |
| features/employees | 32 | 836 | 0 | 0 % | 0 | — | — |
| features/forecast | 1 | 64 | 0 | 0 % | 0 | — | — |
| features/haccp | 2 | 137 | 0 | 0 % | 0 | — | — |
| features/inventory-check | 1 | 36 | 0 | 0 % | 0 | — | — |
| features/logistics | 2 | 51 | 0 | 0 % | 0 | — | — |
| features/maintenance | 2 | 99 | 0 | 0 % | 0 | — | — |
| features/orders | 3 | 155 | 0 | 0 % | 0 | — | — |
| features/packaging | 1 | 58 | 0 | 0 % | 0 | — | — |
| features/pipeline | 1 | 99 | 0 | 0 % | 0 | — | — |
| features/portal | 1 | 23 | 0 | 0 % | 0 | — | — |
| features/pos | 11 | 435 | 0 | 0 % | 0 | — | — |
| features/pricing | 1 | 46 | 0 | 0 % | 0 | — | — |
| features/production | 41 | 974 | 0 | 0 % | 0 | — | — |
| features/products | 6 | 266 | 0 | 0 % | 0 | — | — |
| features/projects | 4 | 226 | 0 | 0 % | 0 | — | — |
| features/promotions | 2 | 130 | 0 | 0 % | 0 | — | — |
| features/purchasing | 12 | 670 | 0 | 0 % | 0 | — | — |
| features/quotes | 1 | 108 | 0 | 0 % | 0 | — | — |
| features/recipes | 14 | 335 | 0 | 0 % | 0 | — | — |
| features/reconciliation | 3 | 208 | 0 | 0 % | 0 | — | — |
| features/replenishment | 2 | 105 | 0 | 0 % | 0 | — | — |
| features/reports | 5 | 172 | 0 | 0 % | 0 | — | — |
| features/sales | 19 | 635 | 0 | 0 % | 0 | — | — |
| features/settings | 43 | 976 | 0 | 0 % | 0 | — | — |
| features/stock | 28 | 714 | 0 | 0 % | 0 | — | — |
| features/traceability | 2 | 154 | 0 | 0 % | 0 | — | — |
| features/users | 5 | 188 | 0 | 0 % | 0 | — | — |
| components (hors layout) | 29 | 191 | 0 | 0 % | 0 | — | — |

## Clés manquantes

- Arabe : aucune
- Anglais : aucune

## Méthode d'extraction d'un module

1. Ajouter les clés `<module>.<libellé>` dans `fr.ts` (référence) ; TypeScript refuse ensuite toute clé `ar`/`en` inconnue.
2. Remplacer les chaînes par `t('<module>.<libellé>')` (`const t = useT()` dans un composant, `t` de `i18n/core` hors React).
3. Traduire dans `ar.ts` puis `en.ts` ; en RTL, préférer les utilitaires logiques Tailwind (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`) aux `ml-`/`mr-`/`left-`/`right-`/`text-left`.
4. Montants : `money()` (utils/money.ts, devise de la société + séparateurs de la langue) ; nombres et dates : `formatNumber` / `formatDate` (i18n/core).
5. Relancer ce rapport.

## Écarts RTL (arabe)

- Utilitaires Tailwind physiques restants (`ml-`, `pr-`, `left-`, `text-left`, `border-l`…) : **2784** dans les .tsx ; propriétés CSS physiques : **143** dans les .css. À convertir en logiques au fil de l'extraction de chaque module (la coquille — barre du haut, menus, lanceur, barre latérale ModuleShell, connexion — est déjà convertie).
- Textes non encore extraits : affichés en français dans une page RTL (ponctuation finale déplacée à gauche par l'algorithme bidi).
- Icônes directionnelles (flèches, chevrons lucide) : à retourner en RTL (`rtl:-scale-x-100`) ; fait sur « Changer de personne » de la connexion. Les chevrons texte « › » sont déjà miroités par le navigateur.
- Libellés venant de `shared` ou du serveur (rôles `ROLE_LABELS`, statuts, messages d'erreur API, vocabulaire sectoriel) : restent en français ; à traiter par une table de traduction côté serveur ou des clés renvoyées par l'API.
- Documents PDF / tickets : hors périmètre (le PDF bidi des fiches masterclass et les champs `_ar` ne sont pas touchés).
