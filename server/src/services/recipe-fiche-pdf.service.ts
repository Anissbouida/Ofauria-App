import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Fiche technique imprimable d'une recette (A4, pdfkit).
 *
 * Meme charte que les bons de commande et les factures (marron/beige Ofauria)
 * pour que les documents sortis du systeme se ressemblent.
 *
 * Contenu, dans l'ordre de lecture d'un chef qui la pose sur le plan de travail :
 *   1. identite : nom, categorie, mode de cout, rendement
 *   2. formats de production : ce qu'on lance et ce que ca coute a la piece
 *   3. composition : ingredients directs ET/OU nomenclature par format
 *   4. etapes de production, avec durees et points de controle
 *
 * Le document est genere par format : une recette a 3 formats sort 3 blocs de
 * nomenclature, parce que c'est justement ce qui change d'un cadre a l'autre.
 */

// ── Charte Ofauria (identique invoice-pdf / purchase-order-pdf) ──
const BROWN = '#8E4A1F';
const BEIGE = '#F5F0E8';
const GOLD = '#B8860B';
const TEXT_DARK = '#3B2F2F';
const TEXT_MUTED = '#7A7168';
const BORDER = '#D6CFC4';
const WHITE = '#FFFFFF';

const M = 40;
const PW = 595.28;
const PH = 841.89;
const CW = PW - M * 2;
const BOTTOM = PH - 55;

export interface FicheComponent {
  role: string | null;
  sourceName: string;
  sourceType: 'recipe' | 'ingredient';
  quantite: number;
  unite: string;
  pertePct: number;
  coutDh: number | null;
  conversionOk: boolean;
}

export interface FicheFormat {
  contenantNom: string | null;
  isDefault: boolean;
  nbParDefaut: number;
  nbParts: number | null;
  quantiteParFormat: number;
  quantiteParFormatUnite: string;
  /** Cout matiere du LANCEMENT complet (le cadre entier, la fournee). */
  coutFormatDh: number | null;
  /** Cout matiere rapporte a une piece. */
  coutUnitaireDh: number | null;
  /** Cout complet (matiere + MO + energie + structure + emballage) par piece. */
  coutCompletUnitaireDh: number | null;
  prixVenteUnitaireDh: number | null;
  components: FicheComponent[];
}

export interface FicheIngredient {
  name: string;
  quantity: number;
  unit: string;
  coutDh: number | null;
}

/** Une preparation de base citee par la nomenclature, avec sa propre recette. */
export interface FicheBase {
  name: string;
  yieldQuantity: number;
  yieldUnit: string;
  perteStandardPct: number;
  coutFourneeDh: number | null;
  /** Quantite NETTE reclamee par le(s) format(s) imprime(s). null = hors perimetre. */
  besoinNet: number | null;
  /** Fraction de fournee standard a produire pour couvrir ce besoin. */
  facteur: number | null;
  ingredients: FicheIngredient[];
}

export interface FicheEtape {
  ordre: number;
  nom: string;
  dureeMin: number | null;
  controleQualite: boolean;
  checklist: string[];
  /** Version darija — imprimee sous la version francaise si presente. */
  nomAr?: string | null;
  checklistAr?: string[];
}

export interface FicheData {
  name: string;
  categoryLabel: string | null;
  isBase: boolean;
  modeCout: string;
  yieldQuantity: number;
  yieldUnit: string;
  perteStandardPct: number;
  totalCostDh: number | null;
  productName: string | null;
  instructions: string | null;
  ingredients: FicheIngredient[];
  formats: FicheFormat[];
  /** true = fiche restreinte a UN format : le bandeau parle de ce format. */
  scopedToFormat: boolean;
  bases: FicheBase[];
  etapes: FicheEtape[];
  editedAt: string;
  logoPath?: string;
}

function resolveLogoInput(logoPath?: string): string | Buffer | null {
  if (logoPath) {
    if (logoPath.startsWith('data:')) {
      const b64 = logoPath.slice(logoPath.indexOf(',') + 1);
      if (b64) {
        try { return Buffer.from(b64, 'base64'); } catch { /* data URI invalide */ }
      }
    } else if (existsSync(logoPath)) {
      return logoPath;
    }
  }
  const fallback = resolve(process.cwd(), 'client', 'public', 'images', 'logo-horizontal.png');
  return existsSync(fallback) ? fallback : null;
}

/**
 * Police arabe embarquee. Helvetica est en WinAnsi : elle ne contient aucun
 * caractere arabe et sortirait du charabia. Cairo (SIL Open Font License)
 * couvre l'arabe ET le latin accentue — indispensable ici, car les astuces en
 * darija citent des termes francais (« Bec d'oiseau », « Grainer », « Tassage »).
 */
const POLICE_AR = resolve(process.cwd(), 'assets', 'fonts', 'Cairo-Regular.ttf');
const POLICE_AR_ALT = resolve(process.cwd(), 'server', 'assets', 'fonts', 'Cairo-Regular.ttf');
function policeArabe(): string | null {
  if (existsSync(POLICE_AR)) return POLICE_AR;
  if (existsSync(POLICE_AR_ALT)) return POLICE_AR_ALT;
  return null;
}

const EST_RTL = (c: string) => /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(c);

/** true des qu'une chaine contient de l'arabe : declenche la police dediee. */
export function contientArabe(s: string | null | undefined): boolean {
  return Boolean(s) && [...String(s)].some(EST_RTL);
}

// NOTE — pas de bibliotheque bidi ici, mais un mini-bidi par RUN (ci-dessous).
// fontkit (embarque dans pdfkit) applique deja le facconnage arabe ET l'ordre
// droite-a-gauche pour un run 100 % arabe. Une passe de reordonnancement
// par-dessus inverserait une seconde fois les runs latins : « Tassage » sortait
// « egassaT ». Verifie sur les 12 chaines darija de la fiche Opera.
// En revanche, un MOT MIXTE (« و24 », « (القاعدة ») dessine d'un bloc sort
// faux : chiffres retournes (24 -> 42), parentheses non mirrorees. D'ou
// runsDuMot() : chaque mot est decoupe en runs directionnels poses un a un.

/**
 * Decoupe un paragraphe arabe en lignes AVANT reordonnancement.
 *
 * L'ordre bidi se calcule par LIGNE. Reordonner le paragraphe entier puis
 * laisser pdfkit le couper produit des lignes correctes prises isolement mais
 * enchainees a l'envers. On coupe donc soi-meme sur la chaine logique, puis on
 * reordonne chaque ligne, puis on les imprime une par une.
 *
 * Les fleches ←/→ n'existent pas dans Cairo (glyphe .notdef en carre blanc) :
 * remplacees par un tiret cadratin, qui porte le meme sens de sequence.
 */
function lignesArabes(doc: PDFKit.PDFDocument, texte: string, largeur: number): string[] {
  const mots = texte.replace(/[←→]/g, '—').split(/\s+/).filter(Boolean);
  const lignes: string[] = [];
  let courante = '';
  for (const mot of mots) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (courante && doc.widthOfString(essai) > largeur) {
      lignes.push(courante);
      courante = mot;
    } else {
      courante = essai;
    }
  }
  if (courante) lignes.push(courante);
  return lignes;
}

/**
 * Miroir bidi des paires ouvrantes/fermantes : dans un contexte droite-a-gauche
 * une parenthese OUVRANTE logique s'affiche avec le glyphe de la fermante
 * (elle « ouvre » vers la gauche), et reciproquement. Sans ce miroir, la fiche
 * imprimait « )القاعدة 54( » au lieu de « (القاعدة 54) ».
 */
const MIROIRS: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{',
  '«': '»', '»': '«', // « »
};

/**
 * Decoupe un mot en runs directionnels : arabe / crochet-miroir / neutre
 * (chiffres, latin, ponctuation). Les crochets sont mirrores et isoles dans
 * leur propre run pour etre places dans le flux droite-a-gauche — les laisser
 * dans le run neutre les collerait du mauvais cote du nombre (« )3 »).
 */
function runsDuMot(mot: string): string[] {
  const runs: string[] = [];
  let courant = '';
  let kindCourant: 'rtl' | 'miroir' | 'neutre' | null = null;
  for (const c of mot) {
    const kind = EST_RTL(c) ? 'rtl' : (MIROIRS[c] ? 'miroir' : 'neutre');
    if (courant && kind !== kindCourant) { runs.push(courant); courant = ''; }
    courant += MIROIRS[c] ?? c;
    kindCourant = kind;
  }
  if (courant) runs.push(courant);
  return runs;
}

/**
 * Dessine une ligne arabe en placant chaque mot soi-meme, de droite a gauche —
 * et, DANS un mot mixte, chaque run directionnel de droite a gauche aussi.
 *
 * Pourquoi mot par mot : pdfkit/fontkit faconne bien un mot arabe isole, mais
 * sur une ligne multi-mots il avale des espaces et inverse parfois deux mots
 * voisins (constate sur la fiche Opera : « والسكر كلاصي » sortait inverse).
 * Pourquoi run par run : un mot mixte dessine d'un bloc retourne les chiffres
 * (« و24 » sortait « و42 ») et ne mirrore pas les parentheses. Chaque run
 * neutre (chiffres, latin) est dessine gauche-a-droite dans sa case, les cases
 * s'enchainant de droite a gauche dans l'ordre logique — ce qui est exactement
 * ce que prescrit l'algorithme bidi pour un paragraphe arabe.
 * Limite restante : deux mots latins CONSECUTIFS sortiraient inverses entre
 * eux (« Bec d'oiseau » -> « d'oiseau Bec ») ; le contenu darija n'en a pas.
 */
function dessinerLigneArabe(doc: PDFKit.PDFDocument, ligne: string, xDroite: number, y: number): void {
  const espace = doc.widthOfString(' ');
  let x = xDroite;
  for (const mot of ligne.split(' ').filter(Boolean)) {
    for (const run of runsDuMot(mot)) {
      const w = doc.widthOfString(run);
      x -= w;
      doc.text(run, x, y, { lineBreak: false });
    }
    x -= espace;
  }
}

/**
 * Assainit une chaine pour Helvetica (encodage WinAnsi de pdfkit).
 *
 * Deux pieges rencontres en vrai :
 *   - les noms saisis dans l'app peuvent etre en forme DECOMPOSEE (« OPÉRA »
 *     stocke E + U+0301) ; WinAnsi ne connait pas l'accent combinant et rend
 *     du charabia. normalize('NFC') recompose en É, qui lui est mappable.
 *   - tout caractere hors Latin-1 restant (puces exotiques collees depuis Word,
 *     emoji) sortirait en glyphe aleatoire : on le remplace par un point median.
 */
function safe(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .normalize('NFC')
    // Hors WinAnsi mais frequents dans les fiches : translitteres plutot que
    // remplaces par un point (« → bande 5 x 26 cm » perdait sa fleche, les
    // exposants de « 1ʳᵉ vitesse » sortaient en points).
    .replace(/→/g, '->').replace(/←/g, '<-').replace(/≈/g, '~')
    .replace(/−/g, '-').replace(/ʳ/g, 'r').replace(/ᵉ/g, 'e')
    // Latin-1 imprimable + le jeu WinAnsi complet (oe/OE, guillemets, tirets,
    // puce, euro...) + les sauts de ligne, sinon « oeufs » sort en « ·ufs » et
    // les retours a la ligne des notes deviennent des points.
    .replace(/[^\n\r\u0020-\u007E\u00A0-\u00FF\u0152\u0153\u0160\u0161\u017D\u017E\u0178\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]/g, '\u00B7')
    .replace(/[\u00A0\u202F\u2009]/g, ' ');
}

/** Helvetica ne porte pas les espaces insecables que fr-FR met dans les milliers. */
function n(val: number | null, dec = 2): string {
  if (val === null || !Number.isFinite(val)) return '\u2014';
  return val
    .toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
    .replace(/[\u00A0\u202F\u2009]/g, ' ');
}

/** Montant : « — » seul quand la valeur est absente, pas « — DH ». */
function dh(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '\u2014' : `${n(v)} DH`;
}

/** Quantite : on garde l'unite SAISIE, jamais convertie (420 g reste 420 g). */
function qty(v: number, unit: string): string {
  const dec = Number.isInteger(v) ? 0 : 2;
  return `${n(v, dec)} ${unit}`;
}

export async function generateRecipeFichePdf(data: FicheData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    // bottom: 0 — le pied de page est ecrit a PH-35, sous la marge basse
    // standard ; toute marge > 0 ferait ajouter une page vide a pdfkit.
    margins: { top: M, bottom: 0, left: M, right: M },
    autoFirstPage: true,
    // Requis pour repasser sur chaque page a la fin et y poser le pied de page
    // avec « n / total » — le total n'est connu qu'une fois tout dessine.
    bufferPages: true,
    info: { Title: `Fiche technique — ${safe(data.name)}`, Author: 'Ôfauria' },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  let y = M;

  // Tout ce qui est ecrit passe par safe() : les noms viennent de la base et
  // peuvent porter des accents decomposes que Helvetica ne sait pas rendre.
  const txt = (s: string, x: number, yy: number, opts: Record<string, unknown> = {}) =>
    doc.text(safe(s), x, yy, { lineBreak: false, ...opts });

  /** Saut de page si le bloc a venir ne tient pas. Retourne le y courant. */
  function ensure(height: number): number {
    if (y + height > BOTTOM) {
      doc.addPage();
      y = M;
    }
    return y;
  }

  function sectionTitle(label: string) {
    ensure(30);
    doc.rect(M, y, CW, 18).fill(BROWN);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE);
    txt(label.toUpperCase(), M + 8, y + 5.5);
    y += 26;
  }

  // ════════ EN-TETE ════════
  const logo = resolveLogoInput(data.logoPath);
  if (logo) {
    try { doc.image(logo, M, y, { width: 150, height: 60 }); } catch { /* logo illisible */ }
  }
  doc.font('Helvetica-BoldOblique').fontSize(18).fillColor(BROWN);
  txt('FICHE TECHNIQUE', M, y + 10, { align: 'right', width: CW });
  doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED);
  txt(`Éditée le ${data.editedAt}`, M, y + 34, { align: 'right', width: CW });
  y += 70;

  doc.moveTo(M, y).lineTo(PW - M, y).lineWidth(1.5).stroke(BROWN);
  y += 12;

  // ════════ IDENTITE ════════
  doc.font('Helvetica-Bold').fontSize(16).fillColor(TEXT_DARK);
  txt(data.name, M, y, { width: CW });
  y += 22;

  const chips: string[] = [
    data.isBase ? 'Préparation de base' : 'Produit fini',
    data.modeCout === 'compose' ? 'Coût : nomenclature' : 'Coût : prorata poids',
  ];
  if (data.categoryLabel) chips.push(data.categoryLabel);
  if (data.productName) chips.push(`Vendu comme : ${data.productName}`);
  doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED);
  txt(chips.join('   •   '), M, y, { width: CW });
  y += 18;

  // Bandeau de synthese : 4 cases.
  //
  // Restreinte a un cadre, la fiche doit parler DE CE CADRE : afficher « 70 unit,
  // 235,58 DH » (rendement de la recette et cout du format par defaut) au-dessus
  // d'un cadre bande a 18 pieces et 90,70 DH serait trompeur sur le papier que le
  // chef emmene au labo.
  const seul = data.scopedToFormat && data.formats.length === 1 ? data.formats[0] : null;
  const netto = data.yieldQuantity * (1 - data.perteStandardPct / 100);
  const cells: Array<[string, string]> = seul
    ? [
      ['FORMAT', seul.contenantNom || 'Sans contenant'],
      ['RENDEMENT', `${seul.nbParDefaut} pièce(s)`],
      ['COÛT LANCEMENT', dh(seul.coutFormatDh)],
      ['COÛT / PIÈCE', dh(seul.coutUnitaireDh)],
    ]
    : [
      ['RENDEMENT BRUT', qty(data.yieldQuantity, data.yieldUnit)],
      ['PERTE TRANSFO.', data.perteStandardPct > 0 ? `${n(data.perteStandardPct, 1)} %` : '—'],
      ['RENDEMENT NET', qty(netto, data.yieldUnit)],
      ['COÛT MATIÈRE', dh(data.totalCostDh)],
    ];
  const cw = CW / cells.length;
  const ch = 34;
  cells.forEach(([label, value], i) => {
    const x = M + i * cw;
    doc.rect(x, y, cw, ch).fill(BEIGE);
    doc.rect(x, y, cw, ch).lineWidth(0.5).stroke(BORDER);
    doc.font('Helvetica').fontSize(6.5).fillColor(BROWN);
    txt(label, x + 6, y + 6, { width: cw - 12 });
    // Le nom d'un contenant (« Cadre bande 60x15x4,5 cm ») deborde de la case a
    // 10 pt : on reduit jusqu'a ce que la valeur tienne sur une ligne.
    doc.font('Helvetica-Bold').fillColor(TEXT_DARK);
    let fs = 10;
    while (fs > 6.5 && doc.fontSize(fs).widthOfString(safe(value)) > cw - 12) fs -= 0.5;
    doc.fontSize(fs);
    txt(value, x + 6, y + 17 + (10 - fs) / 2, { width: cw - 12 });
  });
  y += ch + 16;

  // ════════ FORMATS DE PRODUCTION ════════
  if (data.formats.length > 0) {
    sectionTitle('Formats de production');

    const cols = [
      { w: 150, label: 'Contenant', align: 'left' as const },
      { w: 52, label: 'Pièces', align: 'right' as const },
      { w: 66, label: 'Poids/pièce', align: 'right' as const },
      { w: 74, label: 'Coût lancement', align: 'right' as const },
      { w: 62, label: 'Coût/pièce', align: 'right' as const },
      { w: 61, label: 'Coût complet', align: 'right' as const },
      { w: 50, label: 'PV/pièce', align: 'right' as const },
    ];

    const drawFormatHead = () => {
      doc.rect(M, y, CW, 16).fill(BEIGE);
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(BROWN);
      let x = M;
      for (const c of cols) {
        txt(c.label, x + 4, y + 5, { width: c.w - 8, align: c.align });
        x += c.w;
      }
      y += 16;
    };
    drawFormatHead();

    for (const f of data.formats) {
      if (y + 18 > BOTTOM) { doc.addPage(); y = M; drawFormatHead(); }
      if (f.isDefault) doc.rect(M, y, CW, 18).fill('#FBF7F0');
      doc.rect(M, y, CW, 18).lineWidth(0.4).stroke(BORDER);

      const nom = (f.contenantNom || 'Format sans contenant') + (f.isDefault ? '  (defaut)' : '');
      const values = [
        nom,
        String(f.nbParDefaut),
        qty(f.quantiteParFormat, f.quantiteParFormatUnite),
        dh(f.coutFormatDh),
        dh(f.coutUnitaireDh),
        dh(f.coutCompletUnitaireDh),
        dh(f.prixVenteUnitaireDh),
      ];
      let x = M;
      values.forEach((v, i) => {
        doc.font(i === 0 && f.isDefault ? 'Helvetica-Bold' : 'Helvetica')
           .fontSize(7.5).fillColor(TEXT_DARK);
        txt(v, x + 4, y + 5.5, { width: cols[i].w - 8, align: cols[i].align });
        x += cols[i].w;
      });
      y += 18;
    }
    doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(TEXT_MUTED);
    y += 4;
    const legende = data.formats.some(f => f.isDefault)
      ? '(defaut) = format par défaut   •   coût lancement = le cadre / la fournée entière'
      : 'coût lancement = le cadre / la fournée entière';
    txt(legende, M, y, { width: CW });
    y += 16;
  }

  // ════════ INGREDIENTS DIRECTS ════════
  if (data.ingredients.length > 0) {
    sectionTitle('Ingrédients');

    const iCols = [
      { w: 300, label: 'Ingrédient', align: 'left' as const },
      { w: 110, label: 'Quantité', align: 'right' as const },
      { w: 105, label: 'Coût', align: 'right' as const },
    ];
    const drawIngHead = () => {
      doc.rect(M, y, CW, 15).fill(BEIGE);
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(BROWN);
      let x = M;
      for (const c of iCols) { txt(c.label, x + 4, y + 4.5, { width: c.w - 8, align: c.align }); x += c.w; }
      y += 15;
    };
    drawIngHead();

    let totalIng = 0;
    for (const ing of data.ingredients) {
      if (y + 16 > BOTTOM) { doc.addPage(); y = M; drawIngHead(); }
      doc.rect(M, y, CW, 16).lineWidth(0.4).stroke(BORDER);
      totalIng += ing.coutDh || 0;
      const vals = [ing.name, qty(ing.quantity, ing.unit), dh(ing.coutDh)];
      let x = M;
      vals.forEach((v, i) => {
        doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK);
        txt(v, x + 4, y + 4.5, { width: iCols[i].w - 8, align: iCols[i].align });
        x += iCols[i].w;
      });
      y += 16;
    }
    doc.rect(M, y, CW, 16).fill(BEIGE);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BROWN);
    txt('Total ingrédients', M + 4, y + 4.5);
    txt(`${n(totalIng)} DH`, M + iCols[0].w + iCols[1].w + 4, y + 4.5,
        { width: iCols[2].w - 8, align: 'right' });
    y += 26;
  }

  // ════════ NOMENCLATURE PAR FORMAT ════════
  const formatsAvecBom = data.formats.filter(f => f.components.length > 0);
  if (formatsAvecBom.length > 0) {
    sectionTitle('Nomenclature par format');

    const cCols = [
      { w: 74, label: 'Rôle', align: 'left' as const },
      { w: 191, label: 'Composant', align: 'left' as const },
      { w: 80, label: 'Quantité', align: 'right' as const },
      { w: 55, label: 'Perte', align: 'right' as const },
      { w: 115, label: 'Coût', align: 'right' as const },
    ];

    for (const f of formatsAvecBom) {
      ensure(60);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BROWN);
      txt(`${f.contenantNom || 'Format sans contenant'} — ${f.nbParDefaut} pièce(s)`, M, y);
      y += 15;

      const drawBomHead = () => {
        doc.rect(M, y, CW, 15).fill(BEIGE);
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(BROWN);
        let x = M;
        for (const c of cCols) { txt(c.label, x + 4, y + 4.5, { width: c.w - 8, align: c.align }); x += c.w; }
        y += 15;
      };
      drawBomHead();

      let total = 0;
      for (const c of f.components) {
        if (y + 16 > BOTTOM) { doc.addPage(); y = M; drawBomHead(); }
        doc.rect(M, y, CW, 16).lineWidth(0.4).stroke(BORDER);
        total += c.coutDh || 0;
        // Une conversion d'unite impossible fausse le cout : on le signale sur
        // la ligne plutot que de laisser lire un chiffre faux (cf. mig 260).
        const coutTxt = c.conversionOk ? dh(c.coutDh) : `${dh(c.coutDh)}  (!)`;
        const vals = [
          c.role || '—',
          c.sourceName + (c.sourceType === 'ingredient' ? '  (ingrédient)' : ''),
          qty(c.quantite, c.unite),
          c.pertePct > 0 ? `${n(c.pertePct, 1)} %` : '—',
          coutTxt,
        ];
        let x = M;
        vals.forEach((v, i) => {
          doc.font('Helvetica').fontSize(8).fillColor(!c.conversionOk && i === 4 ? '#B42318' : TEXT_DARK);
          txt(v, x + 4, y + 4.5, { width: cCols[i].w - 8, align: cCols[i].align });
          x += cCols[i].w;
        });
        y += 16;
      }

      doc.rect(M, y, CW, 16).fill(BEIGE);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(BROWN);
      txt('Total lancement', M + 4, y + 4.5);
      const perPiece = f.nbParDefaut > 0 ? total / f.nbParDefaut : null;
      txt(`${n(total)} DH   —   ${n(perPiece)} DH / pièce`,
          M + CW - cCols[4].w - 4, y + 4.5, { width: cCols[4].w, align: 'right' });
      y += 24;
    }
  }

  // ════════ PREPARATIONS DE BASE ════════
  // La nomenclature dit « Biscuit Joconde 1200 g » ; sans le detail, la fiche
  // oblige a en sortir une deuxieme. On imprime donc la recette de chaque base
  // citee, avec son rendement — c'est ce qui permet de la refaire au labo.
  if (data.bases.length > 0) {
    sectionTitle('Préparations de base');

    // Deux colonnes de quantite quand la fiche vise un format precis : ce qu'il
    // faut peser POUR CE CADRE, et la fournee standard en second plan. Sans la
    // premiere, la fiche dit « 450 g de Joconde » sans dire combien d'amande —
    // le chef doit refaire la regle de trois de tete.
    const avecBesoin = data.bases.some(b => b.facteur !== null);
    // Fiche restreinte a un cadre : la colonne vaut « pour ce format ». Fiche
    // complete : le besoin est la somme des formats imprimes, donc ce qu'il faut
    // pour lancer les trois cadres — l'en-tete doit le dire, sinon on lirait la
    // quantite d'un seul.
    const libelleBesoin = data.scopedToFormat || data.formats.length <= 1
      ? 'Pour ce format'
      : `Pour les ${data.formats.length} formats`;
    const bCols = avecBesoin
      ? [
        { w: 230, label: 'Ingrédient', align: 'left' as const },
        { w: 105, label: libelleBesoin, align: 'right' as const },
        { w: 90, label: 'Fournée std', align: 'right' as const },
        { w: 90, label: 'Coût', align: 'right' as const },
      ]
      : [
        { w: 320, label: 'Ingrédient', align: 'left' as const },
        { w: 100, label: 'Quantité', align: 'right' as const },
        { w: 95, label: 'Coût', align: 'right' as const },
      ];

    for (const b of data.bases) {
      ensure(56);
      const net = b.yieldQuantity * (1 - b.perteStandardPct / 100);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BROWN);
      txt(b.name, M, y, { width: CW - 300 });
      doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED);
      const meta = b.facteur !== null && b.besoinNet !== null
        ? `${qty(b.besoinNet, b.yieldUnit)} nécessaires  =  ${n(b.facteur, 2)} fournée${b.facteur >= 2 ? 's' : ''}  •  ${dh((b.coutFourneeDh ?? 0) * b.facteur)}`
        : (b.perteStandardPct > 0
          ? `${qty(b.yieldQuantity, b.yieldUnit)} brut  →  ${qty(net, b.yieldUnit)} net (perte ${n(b.perteStandardPct, 1)} %)  •  ${dh(b.coutFourneeDh)}`
          : `${qty(b.yieldQuantity, b.yieldUnit)}  •  ${dh(b.coutFourneeDh)}`);
      txt(meta, M, y + 1, { width: CW, align: 'right' });
      y += 11;
      // Rappel du rendement standard : c'est la reference dont sortent les
      // quantites mises a l'echelle juste en dessous.
      if (b.facteur !== null) {
        doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(TEXT_MUTED);
        txt(b.perteStandardPct > 0
          ? `Fournée standard : ${qty(b.yieldQuantity, b.yieldUnit)} brut → ${qty(net, b.yieldUnit)} net (perte ${n(b.perteStandardPct, 1)} %)`
          : `Fournée standard : ${qty(b.yieldQuantity, b.yieldUnit)}`,
          M, y, { width: CW });
        y += 10;
      }
      y += 3;

      if (b.ingredients.length === 0) {
        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(TEXT_MUTED);
        txt('Composition non renseignée', M + 4, y);
        y += 16;
        continue;
      }

      const drawBaseHead = () => {
        doc.rect(M, y, CW, 14).fill(BEIGE);
        doc.font('Helvetica-Bold').fontSize(6).fillColor(BROWN);
        let x = M;
        for (const c of bCols) { txt(c.label, x + 4, y + 4, { width: c.w - 8, align: c.align }); x += c.w; }
        y += 14;
      };
      drawBaseHead();

      let totalMis = 0;
      for (const ing of b.ingredients) {
        if (y + 15 > BOTTOM) { doc.addPage(); y = M; drawBaseHead(); }
        doc.rect(M, y, CW, 15).lineWidth(0.4).stroke(BORDER);
        const facteur = b.facteur;
        const vals = facteur !== null && avecBesoin
          ? [ing.name, qty(ing.quantity * facteur, ing.unit), qty(ing.quantity, ing.unit), dh((ing.coutDh ?? 0) * facteur)]
          : [ing.name, qty(ing.quantity, ing.unit), dh(ing.coutDh)];
        if (facteur !== null) totalMis += ing.quantity * facteur;
        let x = M;
        vals.forEach((v, i) => {
          // La colonne « fournée std » est une reference, pas une consigne :
          // elle passe en gris pour que l'oeil aille sur la colonne de gauche.
          const estReference = avecBesoin && i === 2;
          doc.font('Helvetica').fontSize(7.5).fillColor(estReference ? TEXT_MUTED : TEXT_DARK);
          txt(v, x + 4, y + 4, { width: bCols[i].w - 8, align: bCols[i].align });
          x += bCols[i].w;
        });
        y += 15;
      }

      // Total a mettre en oeuvre : superieur au besoin quand la preparation perd
      // a la cuisson. C'est le chiffre que la balance doit voir.
      if (b.facteur !== null && avecBesoin) {
        doc.rect(M, y, CW, 15).fill(BEIGE);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BROWN);
        txt('Total à mettre en œuvre', M + 4, y + 4);
        txt(qty(totalMis, b.yieldUnit), M + bCols[0].w + 4, y + 4,
            { width: bCols[1].w - 8, align: 'right' });
        txt(qty(b.yieldQuantity, b.yieldUnit), M + bCols[0].w + bCols[1].w + 4, y + 4,
            { width: bCols[2].w - 8, align: 'right' });
        y += 15;
      }
      y += 10;
    }
  }

  // ════════ ETAPES ════════
  if (data.etapes.length > 0) {
    sectionTitle('Étapes de production');
    for (const e of data.etapes) {
      const lignesChecklist = e.checklist.length;
      ensure(20 + lignesChecklist * 11);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TEXT_DARK);
      txt(`${e.ordre}.  ${e.nom}`, M + 2, y, { width: CW - 120 });
      const meta: string[] = [];
      if (e.dureeMin) meta.push(`${e.dureeMin} min`);
      if (e.controleQualite) meta.push('contrôle qualité');
      if (meta.length) {
        doc.font('Helvetica').fontSize(7.5).fillColor(GOLD);
        txt(meta.join('  •  '), M, y + 1, { width: CW - 4, align: 'right' });
      }
      y += 13;

      // Libelle en darija, sous le francais.
      const AR = policeArabe();
      if (AR && contientArabe(e.nomAr)) {
        doc.font(AR).fontSize(9).fillColor(BROWN);
        for (const ligne of lignesArabes(doc, String(e.nomAr), CW - 20)) {
          dessinerLigneArabe(doc, ligne, M + CW - 6, y);
          y += 13;
        }
      }

      doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED);
      for (const item of e.checklist) {
        txt(`▫  ${item}`, M + 14, y, { width: CW - 20 });
        y += 11;
      }

      // Points de controle en darija. Bloc separe et aligne a droite : melanger
      // les deux langues dans un meme appel casserait l'ordre des mots.
      if (AR && (e.checklistAr || []).some(contientArabe)) {
        y += 3;
        doc.font(AR).fontSize(8).fillColor(TEXT_MUTED);
        for (const item of e.checklistAr || []) {
          if (!contientArabe(item)) continue;
          for (const ligne of lignesArabes(doc, item, CW - 28)) {
            if (y + 12 > BOTTOM) { doc.addPage(); y = M; }
            dessinerLigneArabe(doc, ligne, M + CW - 14, y);
            y += 11;
          }
          y += 3;
        }
      }
      y += 5;
    }
    y += 6;
  }

  // ════════ INSTRUCTIONS ════════
  if (data.instructions && data.instructions.trim()) {
    sectionTitle('Notes');
    // Les notes melangent francais et darija (ligne allergenes). Helvetica ne
    // sait pas rendre l'arabe : chaque paragraphe part vers la police qui lui
    // convient, sinon la ligne arabe sort en pointilles.
    const ARN = policeArabe();
    for (const para of data.instructions.trim().split(/\n{2,}/)) {
      const bloc = para.trim();
      if (!bloc) continue;
      if (ARN && contientArabe(bloc)) {
        doc.font(ARN).fontSize(9).fillColor(TEXT_DARK);
        for (const ligne of lignesArabes(doc, bloc, CW)) {
          if (y + 13 > BOTTOM) { doc.addPage(); y = M; }
          dessinerLigneArabe(doc, ligne, M + CW, y);
          y += 13;
        }
      } else {
        doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK);
        doc.text(safe(bloc), M, y, { width: CW, align: 'left' });
        y = doc.y;
      }
      y += 6;
    }
    y += 4;
  }

  // ════════ PIEDS DE PAGE ════════
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.moveTo(M, PH - 42).lineTo(PW - M, PH - 42).lineWidth(0.5).stroke(BORDER);
    doc.font('Helvetica').fontSize(6.5).fillColor(TEXT_MUTED);
    doc.text(safe(`Ôfauria — fiche technique « ${data.name} » — éditée le ${data.editedAt}`),
             M, PH - 35, { width: CW - 60, lineBreak: false });
    doc.text(`${i + 1} / ${range.count}`, PW - M - 60, PH - 35, { width: 60, align: 'right', lineBreak: false });
  }
  doc.flushPages();

  doc.end();
  return new Promise((res, rej) => {
    doc.on('end', () => res(Buffer.concat(chunks)));
    doc.on('error', rej);
  });
}
