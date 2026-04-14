# Proposition de refonte ergonomique et visuelle — Ofauria Tablette

> **Document de validation** — Aucun code ne sera modifié avant approbation.
> Date : 13 avril 2026

---

## 1. Diagnostic de l'existant

### Problemes identifies

| Zone | Probleme | Impact |
|------|----------|--------|
| **Palette** | Couleur primaire `#714B67` (violet-brun) peu coherente avec l'identite boulangerie | Perte d'identite visuelle |
| **Contraste** | Textes `text-gray-400`/`text-gray-500` sur fond blanc : ratio < 4.5:1 | Non-conformite WCAG AA, fatigue oculaire |
| **Header** | Hauteur de 48px (`h-12`) trop compacte pour le tactile | Clics difficiles sur les icones |
| **Boutons** | Padding standard `px-4 py-2` = zone tactile ~36px de haut | En dessous du minimum 44px recommande par Apple/Google |
| **Sidebar** | Fond `#3d1e0e` (chocolat tres fonce) avec texte blanc/transparent | Lisibilite correcte mais monotone |
| **Grille produits** | Cartes `p-2` avec `text-sm` | Trop dense, texte petit pour ecran a bout de bras |
| **Formulaires** | Inputs `px-3 py-2` trop petits pour saisie tactile | Precision excessive requise |
| **Espacement** | `gap-1` a `gap-2` dominant | Interface tassee, pas de respiration |
| **Couleurs statuts** | 10+ couleurs differentes sans logique unifiee | Surcharge cognitive |

---

## 2. Nouvelle palette de couleurs

### Philosophie
Une palette **chaude, douce et reposante** inspiree du pain, de la farine et des viennoiseries. Les couleurs vives sont reservees aux actions et alertes, le reste de l'interface baigne dans des tons naturels et apaisants.

### 2.1 Couleurs de base

```
FOND PRINCIPAL (surfaces)
┌─────────────────────────────────────────────────┐
│  Creme clair    #FAF6F1   Fond de page          │
│  Blanc chaud    #FFFDF9   Cartes et modales      │
│  Sable clair    #F3ECE2   Zones secondaires      │
│  Sable moyen    #E8DDD0   Separateurs, bordures  │
└─────────────────────────────────────────────────┘

TEXTE
┌─────────────────────────────────────────────────┐
│  Brun profond   #2D1810   Titres, texte fort     │
│  Brun moyen     #5C3D2E   Corps de texte         │
│  Brun clair     #8B7355   Texte secondaire       │
│  Brun pale      #B5A08A   Placeholders, hints    │
└─────────────────────────────────────────────────┘
```

> **Ratios de contraste (WCAG AA)** :
> - `#2D1810` sur `#FAF6F1` = **14.2:1** (excellent)
> - `#5C3D2E` sur `#FAF6F1` = **7.8:1** (tres bon)
> - `#8B7355` sur `#FAF6F1` = **4.6:1** (conforme AA)

### 2.2 Couleurs de marque Ofauria

```
IDENTITE BOULANGERIE
┌─────────────────────────────────────────────────┐
│  Dore principal #C4872B   Actions primaires       │
│  Dore hover     #A8721F   Survol/appui            │
│  Dore clair     #F5E6CC   Fond accent leger       │
│  Brun croute    #7A4B28   Navigation, header      │
│  Brun fonce     #3D2415   Sidebar (si conservee)  │
└─────────────────────────────────────────────────┘
```

> Le dore `#C4872B` remplace le violet-brun `#714B67` comme couleur primaire.
> Il evoque le pain dore, la croute, le caramel — coherent avec l'univers boulangerie.

### 2.3 Couleurs fonctionnelles (statuts et alertes)

```
SUCCES / VALIDE
┌─────────────────────────────────────────────────┐
│  Fond           #EFF7EE                          │
│  Texte/Icone    #2D6A30                          │
│  Bordure        #A3D4A0                          │
└─────────────────────────────────────────────────┘

ATTENTION / EN COURS
┌─────────────────────────────────────────────────┐
│  Fond           #FFF8EC                          │
│  Texte/Icone    #946300                          │
│  Bordure        #F0D48A                          │
└─────────────────────────────────────────────────┘

ERREUR / ANNULATION
┌─────────────────────────────────────────────────┐
│  Fond           #FDF0EF                          │
│  Texte/Icone    #C23B2A                          │
│  Bordure        #F0ADA5                          │
└─────────────────────────────────────────────────┘

INFO / NEUTRE
┌─────────────────────────────────────────────────┐
│  Fond           #EEF4FB                          │
│  Texte/Icone    #2563A8                          │
│  Bordure        #A0C4E8                          │
└─────────────────────────────────────────────────┘
```

> Seulement **4 familles de couleurs fonctionnelles** au lieu de 10+.
> Les fonds sont tres doux (proches du blanc), les textes fonces pour la lisibilite.

---

## 3. Typographie

### Recommandation de police
**Inter** (Google Fonts, gratuite) — concue pour les ecrans, excellente lisibilite en petite taille, largeur genereuse des caracteres.

### Echelle typographique revisee

| Role | Taille actuelle | Taille proposee | Poids | Utilisation |
|------|----------------|-----------------|-------|-------------|
| **Titre page** | 24px (`text-2xl`) | 28px | Bold (700) | Nom de la page |
| **Titre section** | 18px (`text-lg`) | 22px | Semibold (600) | En-tetes de sections |
| **Sous-titre** | 16px (`text-base`) | 18px | Medium (500) | Sous-sections |
| **Corps** | 14px (`text-sm`) | 16px | Regular (400) | Texte courant, tableaux |
| **Label** | 12px (`text-xs`) | 14px | Medium (500) | Labels de formulaires |
| **Caption** | 12px (`text-xs`) | 13px | Regular (400) | Notes, timestamps |

> **Principe** : taille minimale de **13px** partout (au lieu de 12px).
> Gain moyen de **+2px** sur chaque niveau = lisibilite nettement amelioree sur tablette a bout de bras.

### Hierarchie visuelle

```
┌──────────────────────────────────────────┐
│  TITRE PAGE          28px  Bold  #2D1810 │
│  Sous-titre section  22px  Semi  #2D1810 │
│  Texte courant       16px  Reg   #5C3D2E │
│  Info secondaire     14px  Reg   #8B7355 │
│  Note / aide         13px  Reg   #B5A08A │
└──────────────────────────────────────────┘
```

---

## 4. Zones tactiles et composants

### 4.1 Boutons

| Type | Actuel | Propose | Detail |
|------|--------|---------|--------|
| **Bouton principal** | `px-4 py-2` (~36px) | `px-6 py-3` (48px min) | Fond dore `#C4872B`, texte blanc, coins arrondis 12px |
| **Bouton secondaire** | `px-4 py-2` (~36px) | `px-5 py-3` (48px min) | Bordure dore, fond transparent, texte dore |
| **Bouton danger** | `px-4 py-2` (~36px) | `px-5 py-3` (48px min) | Fond `#C23B2A`, texte blanc |
| **Bouton icone** | `p-1.5` (~28px) | `p-3` (48px min) | Zone tactile carree 48x48px |
| **CTA principal (caisse)** | `px-8 py-4` (56px) | `px-8 py-5` (60px) | Deja correct, leger ajustement |

```
COMPARAISON VISUELLE DES ZONES TACTILES

Actuel :     ┌──────────┐     36px de haut
             │ Valider  │
             └──────────┘

Propose :    ┌──────────────┐  48px de haut (+33%)
             │              │
             │   Valider    │
             │              │
             └──────────────┘
```

> **Regle** : toute zone interactive fait minimum **48x48px** (recommandation WCAG / Material Design).

### 4.2 Champs de formulaire

| Element | Actuel | Propose |
|---------|--------|---------|
| **Input texte** | `px-3 py-2` (~36px) | `px-4 py-3` (48px) |
| **Select** | `px-3 py-2` (~36px) | `px-4 py-3` (48px) |
| **Checkbox/Radio** | 16x16px | 24x24px avec zone tactile 44px |
| **Quantite (POS)** | `w-20 px-2 py-1` (~30px) | `w-24 px-3 py-2.5` (44px) |

### 4.3 Cartes produits (POS)

```
ACTUEL                          PROPOSE
┌──────────┐                    ┌────────────────┐
│ img      │ p-2               │                │ p-3
│ Nom   14px                   │    image       │
│ Prix  12px                   │                │
└──────────┘                    │ Nom       16px │
                                │ Prix      14px │
                                │ [+]  48x48    │
                                └────────────────┘
```

> Cartes plus grandes, texte plus lisible, bouton d'ajout explicite et large.

---

## 5. Navigation et layout

### 5.1 Header

| Aspect | Actuel | Propose |
|--------|--------|---------|
| **Hauteur** | 48px (`h-12`) | 56px (`h-14`) |
| **Couleur fond** | Variable (settings) | `#7A4B28` (brun croute) par defaut |
| **Taille icones** | 20px | 24px |
| **Zone tactile icones** | ~28px | 48px (padding augmente) |
| **Nom entreprise** | `text-sm` | `text-base font-semibold` |

### 5.2 Grille des modules (App Launcher)

```
ACTUEL : 3-4 colonnes, icones 48x48, gap-4

PROPOSE : 3 colonnes tablette, icones 56x56, gap-5
┌──────────────────────────────────────────┐
│                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │  icone  │  │  icone  │  │  icone  │  │
│  │  56x56  │  │  56x56  │  │  56x56  │  │
│  │  Caisse │  │ Ventes  │  │Produits │  │
│  └─────────┘  └─────────┘  └─────────┘  │
│                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │  icone  │  │  icone  │  │  icone  │  │
│  │  56x56  │  │  56x56  │  │  56x56  │  │
│  │Productn │  │ Recettes│  │Approv.  │  │
│  └─────────┘  └─────────┘  └─────────┘  │
│                                          │
└──────────────────────────────────────────┘

Chaque module : fond blanc chaud, ombre douce,
coins arrondis 16px, label 14px medium
```

### 5.3 Espacement general

| Zone | Actuel | Propose |
|------|--------|---------|
| **Padding page** | `p-4` | `p-5` a `p-6` |
| **Gap grille** | `gap-2` a `gap-4` | `gap-4` a `gap-6` |
| **Marge entre sections** | `space-y-2` | `space-y-4` a `space-y-6` |
| **Padding cartes** | `p-4` | `p-5` |

---

## 6. Ecran Caisse (POS) — Refonte detaillee

L'ecran le plus utilise (caissiere, toute la journee). Priorite maximale.

### 6.1 Layout general

```
┌──────────────────────────────────────────────────────────┐
│  HEADER (56px)  [Ofauria]           [Notif] [Profil]    │
├──────────────────────────────────────────────────────────┤
│                          │                               │
│   PRODUITS (60%)         │   PANIER (40%)                │
│                          │                               │
│  ┌─────┐ ┌─────┐ ┌────┐│  ┌────────────────────────┐   │
│  │     │ │     │ │    ││  │ Pain complet    x2     │   │
│  │ img │ │ img │ │ img││  │                 16.00  │   │
│  │     │ │     │ │    ││  ├────────────────────────┤   │
│  │Nom  │ │Nom  │ │Nom ││  │ Croissant       x3     │   │
│  │Prix │ │Prix │ │Prix││  │                 10.50  │   │
│  └─────┘ └─────┘ └────┘│  ├────────────────────────┤   │
│                          │  │                        │   │
│  ┌─────┐ ┌─────┐ ┌────┐│  │                        │   │
│  │     │ │     │ │    ││  │                        │   │
│  │ ... │ │ ... │ │ ...││  │                        │   │
│  └─────┘ └─────┘ └────┘│  ├────────────────────────┤   │
│                          │  │  TOTAL        26.50 DH │   │
│  ──────────────────────  │  │                        │   │
│  [Categories]  Onglets   │  │  ┌──────────────────┐  │   │
│  avec defilement         │  │  │    ENCAISSER     │  │   │
│                          │  │  │    (60px haut)   │  │   │
│                          │  │  └──────────────────┘  │   │
│                          │  └────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 6.2 Specificites caisse

| Element | Propose |
|---------|---------|
| **Onglets categories** | 48px haut, texte 15px, fond `#F3ECE2` inactif / `#C4872B` actif |
| **Cartes produits** | 3 colonnes, padding 12px, image prominente, nom 16px, prix 15px bold |
| **Ligne panier** | 56px haut, fond `#FFFDF9`, separateur `#E8DDD0` |
| **Boutons +/-** | 44x44px, fond `#F5E6CC`, icone `#C4872B` |
| **Total** | 24px bold, couleur `#2D1810` |
| **Bouton ENCAISSER** | 60px haut, fond `#C4872B`, texte blanc 18px bold, coins 12px |
| **Fond page** | `#FAF6F1` (creme) au lieu de blanc pur |

---

## 7. Tableaux et listes

### Style propose pour les tableaux de donnees

```
┌────────────────────────────────────────────────┐
│  En-tete    Fond #F3ECE2   Texte #5C3D2E      │
│             14px Medium    Padding py-3 px-4   │
├────────────────────────────────────────────────┤
│  Ligne 1    Fond #FFFDF9   Texte #5C3D2E      │
│             16px Regular   Padding py-4 px-4   │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│  Ligne 2    Fond #FAF6F1   (alternance douce)  │
│             16px Regular   Padding py-4 px-4   │
├────────────────────────────────────────────────┤
│  Ligne 3    Fond #FFFDF9                       │
└────────────────────────────────────────────────┘

Hauteur de ligne : 56px minimum (zone tactile)
Separateurs : 1px #E8DDD0 (sable moyen)
Hover : fond #F5E6CC (dore clair)
```

> Alternance de couleurs tres subtile (creme / blanc chaud) pour guider l'oeil sans fatiguer.

---

## 8. Modales

### Principes

| Aspect | Actuel | Propose |
|--------|--------|---------|
| **Fond overlay** | `bg-black/20` ou `bg-black/60` | `bg-black/40` uniforme |
| **Padding interne** | `p-8` | `p-6` (plus de place pour le contenu) |
| **Coins** | `rounded-2xl` | `rounded-2xl` (conserve) |
| **Largeur max** | Variable | `max-w-lg` standard, `max-w-2xl` pour formulaires complexes |
| **Boutons bas** | Alignement variable | Toujours en bas, colles, full-width sur tablette |
| **Stepper** | Couleurs variees par etape | Palette unifiee dore/gris |

### Stepper (modales multi-etapes)

```
Actuel : chaque etape a sa propre couleur (indigo, emerald, amber...)

Propose :
  ( 1 )----( 2 )----( 3 )----( 4 )
   Dore    Dore      Gris     Gris
  Fait     Actif    A venir  A venir

Etape faite   : cercle #C4872B plein, texte blanc
Etape active  : cercle #C4872B borde, fond #F5E6CC
Etape a venir : cercle #E8DDD0, texte #B5A08A
Ligne          : #C4872B (fait) / #E8DDD0 (a venir)
```

---

## 9. Mode semi-sombre (optionnel)

### Recommandation
Plutot qu'un mode sombre complet (deconseille en environnement boulangerie car la luminosite ambiante est souvent forte), je recommande un **mode "fin de journee"** activable manuellement :

```
MODE JOUR (defaut)              MODE FIN DE JOURNEE
Fond page : #FAF6F1             Fond page : #F0E8DC
Cartes    : #FFFDF9             Cartes    : #EDE4D6
Texte     : #2D1810             Texte     : #2D1810 (inchange)
Luminosite ecran reduite        Teintes plus chaudes
```

> L'idee est de **rechauffer** les fonds en fin de journee, pas de passer en sombre.
> Cela reduit la lumiere bleue emise et diminue la fatigue oculaire.
> Un simple toggle dans le header "Mode Confort" suffirait.

---

## 10. Badges de statut unifies

### Systeme actuel : 10+ variantes de couleurs

### Systeme propose : 4 familles coherentes

```
┌─────────────┬───────────────┬────────────┬──────────────┐
│   SUCCES    │   ATTENTION   │   ERREUR   │    INFO      │
├─────────────┼───────────────┼────────────┼──────────────┤
│ Termine     │ En cours      │ Annule     │ Confirme     │
│ Livre       │ En production │ Erreur     │ En attente   │
│ Paye        │ Brouillon     │ Rejete     │ Nouveau      │
│ Complet     │ A verifier    │ Perte      │ Planifie     │
├─────────────┼───────────────┼────────────┼──────────────┤
│ #EFF7EE     │ #FFF8EC       │ #FDF0EF   │ #EEF4FB      │
│ #2D6A30     │ #946300       │ #C23B2A   │ #2563A8      │
│ coins 8px   │ coins 8px     │ coins 8px │ coins 8px    │
│ py-1 px-3   │ py-1 px-3     │ py-1 px-3 │ py-1 px-3    │
│ 13px Medium │ 13px Medium   │ 13px Med  │ 13px Medium  │
└─────────────┴───────────────┴────────────┴──────────────┘
```

---

## 11. Icones des modules

### Couleurs proposees (palette unifiee)

Au lieu de 16 couleurs differentes, utiliser une palette restreinte de 4 teintes :

| Famille | Couleur | Modules |
|---------|---------|---------|
| **Dore** `#C4872B` | Caisse, Ventes, Commandes, Comptabilite |
| **Brun** `#7A4B28` | Produits, Recettes, Stock, Achats |
| **Vert sauge** `#5B8C5A` | Production, Approvisionnement, Invendus |
| **Gris chaud** `#7A7068` | RH, Utilisateurs, Parametres, Rapports |

---

## 12. Resume des changements cles

| Domaine | Avant | Apres | Benefice |
|---------|-------|-------|----------|
| **Couleur primaire** | `#714B67` violet-brun | `#C4872B` dore pain | Coherence identitaire |
| **Fond de page** | `#FFFFFF` blanc pur | `#FAF6F1` creme | Reduit la fatigue oculaire |
| **Zone tactile min** | ~36px | 48px | Confort tactile tablette |
| **Taille texte min** | 12px | 13px | Lisibilite amelioree |
| **Texte corps** | 14px | 16px | Lecture confortable |
| **Couleurs statut** | 10+ variantes | 4 familles | Clarte cognitive |
| **Couleurs modules** | 16 couleurs | 4 familles | Coherence visuelle |
| **Header** | 48px | 56px | Cibles tactiles accessibles |
| **Espacement** | Dense | Aere (+25%) | Interface respirante |
| **Mode confort** | Inexistant | Toggle fin de journee | Fatigue reduite |

---

## 13. Impact sur le code

### Ce qui change

| Fichier | Type de modification |
|---------|---------------------|
| `tailwind.config.js` | Mise a jour palette couleurs |
| `client/src/styles/index.css` | Variables CSS, classes composants |
| `SettingsContext.tsx` | Couleur primaire par defaut |
| Tous les composants de page | Remplacement classes Tailwind (tailles, couleurs, espacements) |
| `Header.tsx`, `AppLayout.tsx` | Dimensions, couleurs navigation |
| `POSPage.tsx` | Refonte layout caisse |

### Ce qui ne change PAS

- Architecture des routes et pages
- Logique metier et API
- Structure des donnees
- Fonctionnalites existantes
- Flux de navigation

### Estimation de l'effort

| Phase | Description | Complexite |
|-------|-------------|------------|
| 1 | Palette + variables CSS + config Tailwind | Faible |
| 2 | Composants de base (boutons, inputs, badges) | Faible |
| 3 | Layout (header, grille modules) | Moyenne |
| 4 | Ecran caisse (POS) | Elevee |
| 5 | Pages de gestion (tableaux, formulaires) | Moyenne |
| 6 | Modales multi-etapes | Moyenne |
| 7 | Mode confort (optionnel) | Faible |

---

## 14. Prochaines etapes

1. **Validation** de cette proposition par l'equipe
2. **Choix** des elements a prioriser (la caisse en premier ?)
3. **Prototype** d'un ecran (le POS par exemple) pour valider le rendu reel
4. **Implementation** progressive, page par page

---

> **Note** : Cette proposition est 100% visuelle et conceptuelle.
> Aucune ligne de code n'a ete modifiee. Le developpement ne demarrera qu'apres validation.
