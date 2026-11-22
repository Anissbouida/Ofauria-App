# Design System Kalum

Règles d'interface communes à tous les modules, validées sur les maquettes du module Achats
le 2026-11-22. Un seul ERP : une identité visuelle, une logique de navigation, une hiérarchie
graphique.

- Jetons et styles : `client/src/styles/design-system.css` (variables `--ds-*`).
- Composants React : `client/src/components/ds/index.tsx`.
- Activation : la classe `kl-ds` est posée une fois sur la zone de contenu (`AppLayout`), sauf la
  caisse (`/pos`), écran plein écran à part. Les briques existantes (`prj-*`, `odoo-table`,
  `kl-largetitle`…) prennent la présentation commune sans changer de nom.

## 1. Identité visuelle

Les couleurs viennent toujours du thème (Paramètres › Apparence) ; aucune couleur en dur.

| Jeton | Rôle |
|---|---|
| `--ds-accent`, `--ds-accent-ink`, `--ds-tint` | action, sélection, lien |
| `--ds-ink`, `--ds-body`, `--ds-muted` | texte fort, courant, discret (contraste ≥ 4,5:1) |
| `--ds-bg`, `--ds-card`, `--ds-sep`, `--ds-hair`, `--ds-line` | fond de page, carte, séparateurs, contour de champ (≥ 3:1) |
| `--ds-success`, `--ds-warning`, `--ds-danger`, `--ds-info` (+ `-bg`) | succès, attention, erreur, information |

Une couleur = un sens, partout : vert conforme ou terminé, orange à traiter, rouge bloqué ou en
retard, bleu en cours, gris brouillon ou annulé. Un statut s'affiche toujours avec
`components/ui/StatusTag` (couleur + libellé, jamais la couleur seule).

Espacements : multiples de 4 (`--ds-s1` 4 … `--ds-s8` 32). Arrondis : 8 champs, 12 barres,
16 cartes, pilule pour les boutons. Police : police système. Icônes : `lucide-react` uniquement.

## 2. Hiérarchie graphique

| Niveau | Élément | Style | Composant |
|---|---|---|---|
| 1 Module | fil d'Ariane « Module › Rubrique › Page » | 14 px | `Breadcrumb` (ou `ModuleShell`) |
| 2 Page | titre + description d'une ligne | 30 px gras | `PageHeader` |
| 3 Section | regroupement | 17 px gras | `SectionHeader` |
| 4 Sous-section | détail | 14 px demi-gras | classe `ds-subhead`, `FormSection` |
| 5 Libellé / donnée | en-tête de colonne, champ | 12 px / 14 px | — |

Pas de capitales, pas d'en-tête coloré.

## 3. Gabarit d'une page de gestion

Toujours dans cet ordre :

1. Fil d'Ariane, avec à droite les actions : « Exporter » (secondaire) puis **une seule** action
   principale (`odoo-btn-primary`).
2. Titre de page et description (`PageHeader`).
3. Indicateurs (`KpiGrid` + `KpiCard`), si pertinents — 4 au plus par ligne.
4. Étapes du circuit en pastilles-filtres, sans numérotation (`StagePipeline` de
   `components/purchasing/ProcessBoard`, ou `FilterChips` de `features/sales/ListTemplate`).
5. Barre d'outils (`Toolbar`) : recherche à gauche (`SearchBar`), filtres, puis à droite les
   bascules (`Segmented`) : période « En cours / Historique », affichage « Tableau / Colonnes / Kanban ».
6. Contenu : tableau dans `DataPanel`, avec `TableFooter` (compteur, total, pagination).
7. Messages : `Alert`, notifications `notify`, confirmations `ConfirmDialog`.

Une fiche (détail d'une pièce) : fil d'Ariane jusqu'au numéro, titre + `StatusTag`, avancement,
puis deux colonnes — contenu (sections) à gauche, informations à droite.

Tableau de bord : même grille — `PageHeader`, `KpiGrid`, puis sections ; les listes « à traiter »
utilisent le tableau standard.

## 4. Tableau standard

`<DataPanel><table className="odoo-table">…</table></DataPanel>`

- Densité : 48 px par ligne ; ajouter `ds-dense` pour la variante dense (36 px, comptabilité).
- En-têtes en minuscules, 12 px ; tri indiqué dans l'en-tête.
- Nombres et montants : classe `ds-num` (à droite, chiffres tabulaires), **unité dans l'en-tête**
  (« Montant HT (DH) »), pas répétée dans chaque cellule.
- Numéros de pièce : `ds-ref`. Donnée principale de la ligne : `ds-strong`.
- Dates : « 21 nov. 2026 ».
- Statut : `StatusTag`.
- Actions : dernière colonne (`ds-actions`) — une action visible (bouton `odoo-btn-secondary ds-btn-sm`),
  le reste dans le menu de ligne (`components/ui/RowMenu`). Jamais plus de deux icônes par ligne.
- Sélection : case à cocher en première colonne, ligne `ds-selected`, barre `BulkBar` au-dessus.
- Regroupement : ligne `ds-group` (libellé + sous-total).
- Total : `<tfoot>`. Pied : `TableFooter`.
- États : `EmptyState` (vide), `NoResultState` (filtres sans résultat), `LoadingState`, `ErrorState`.

## 5. Formulaire standard

- `FormSection` par groupe logique ; `FormField` pour chaque champ : libellé visible, astérisque
  rouge si obligatoire, aide sous le champ, message d'erreur qui dit quoi corriger.
- Contrôles : classe `ds-input` (40 px ; `sm` 32 px dans un tableau).
- Grille : `ds-form-grid` (2 colonnes, 1 sur mobile ; `cols-4` pour les en-têtes de pièce).
- Pied : `FormFooter` — « Modifications non enregistrées » à gauche, Annuler puis Enregistrer à
  droite ; le bouton est désactivé pendant l'envoi (pas de double soumission).
- Action destructrice : bouton `ds-btn-danger`, toujours confirmée par `ConfirmDialog` (motif si la
  règle métier l'exige).

## 6. Accessibilité

Focus clavier visible partout (`:focus-visible`), boutons et liens réels, `aria-label` sur les
boutons à icône seule, contrastes AA, cibles de 40 px au moins sur écran tactile, tableaux larges
dans une zone à défilement horizontal, menu du module empilé sous 900 px.

## 7. Règles de migration d'un écran

1. Ne pas toucher aux règles métier, aux appels d'API, aux droits ni aux calculs.
2. Remplacer les variantes locales par les composants communs (ne pas en recréer).
3. Supprimer les styles en ligne et les couleurs en dur devenus inutiles.
4. Vérifier : `cd client && npx tsc -b`, puis l'écran dans le navigateur.
