/**
 * Liasse fiscale — modèle comptable normal du CGNC (lot Bonus 14), sans accès
 * à la base : bilan actif (tableau 1), bilan passif (tableau 2), CPC (tableau
 * 3) et état des soldes de gestion (tableau 4 : TFR et CAF), calculés depuis
 * les soldes des comptes.
 *
 * Rattachement d'un compte à une rubrique par son poste à 3 chiffres :
 *   - brut : les 3 premiers chiffres (2321 → 232) ;
 *   - amortissements et provisions (28xx, 29xx, 39xx, 59xx) : le poste qu'ils
 *     corrigent (2832 → 232, 2951 → 251, 3942 → 342) ;
 *   - banques à solde créditeur (51x) : trésorerie passif (554).
 * Le modèle simplifié (CA ≤ 10 MDH) reprend les mêmes rubriques, regroupées
 * à leur niveau (A, B, C…) pour le bilan.
 */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Solde d'un compte : débit − crédit. */
export type AccountBalance = { code: string; label: string; balance: number };
export type LiasseModel = 'normal' | 'simplifie';

type Def = { id: string; label: string; kind: 'line' | 'group' | 'subtotal' | 'total'; keys?: string[]; sum?: string[]; sign?: Record<string, 1 | -1> };

/** Postes particuliers : compte → poste de rattachement. */
const POSTE_OVERRIDE: Record<string, string> = { '486': '349' };   // charges constatées d'avance (code PCG) → régularisation actif

/** Poste du brut ou poste corrigé (amortissements et provisions). */
export function posteOf(code: string): { poste: string; contra: boolean } {
  if (POSTE_OVERRIDE[code]) return { poste: POSTE_OVERRIDE[code], contra: false };
  const c = code.replace(/\D/g, '');
  if (/^2[89]/.test(c)) return { poste: `2${c[2] ?? '0'}${c[3] ?? '0'}`, contra: true };
  if (/^39/.test(c)) return { poste: `3${c[2] ?? '0'}${c[3] ?? '0'}`, contra: true };
  if (/^59/.test(c)) return { poste: '510', contra: true };
  return { poste: c.slice(0, 3), contra: false };
}

/* ─── Tableau 1 : bilan actif ─────────────────────────────────────── */

export const ACTIF: Def[] = [
  { id: 'A', label: 'IMMOBILISATIONS EN NON-VALEURS (A)', kind: 'group', sum: ['A1', 'A2', 'A3'] },
  { id: 'A1', label: 'Frais préliminaires', kind: 'line', keys: ['211'] },
  { id: 'A2', label: 'Charges à répartir sur plusieurs exercices', kind: 'line', keys: ['212'] },
  { id: 'A3', label: 'Primes de remboursement des obligations', kind: 'line', keys: ['213'] },
  { id: 'B', label: 'IMMOBILISATIONS INCORPORELLES (B)', kind: 'group', sum: ['B1', 'B2', 'B3', 'B4'] },
  { id: 'B1', label: 'Immobilisations en recherche et développement', kind: 'line', keys: ['221'] },
  { id: 'B2', label: 'Brevets, marques, droits et valeurs similaires', kind: 'line', keys: ['222'] },
  { id: 'B3', label: 'Fonds commercial', kind: 'line', keys: ['223'] },
  { id: 'B4', label: 'Autres immobilisations incorporelles', kind: 'line', keys: ['220', '228', '229'] },
  { id: 'C', label: 'IMMOBILISATIONS CORPORELLES (C)', kind: 'group', sum: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] },
  { id: 'C1', label: 'Terrains', kind: 'line', keys: ['231'] },
  { id: 'C2', label: 'Constructions', kind: 'line', keys: ['232'] },
  { id: 'C3', label: 'Installations techniques, matériel et outillage', kind: 'line', keys: ['233'] },
  { id: 'C4', label: 'Matériel de transport', kind: 'line', keys: ['234'] },
  { id: 'C5', label: 'Mobilier, matériel de bureau et aménagements divers', kind: 'line', keys: ['235'] },
  { id: 'C6', label: 'Autres immobilisations corporelles', kind: 'line', keys: ['230', '238'] },
  { id: 'C7', label: 'Immobilisations corporelles en cours', kind: 'line', keys: ['239'] },
  { id: 'D', label: 'IMMOBILISATIONS FINANCIÈRES (D)', kind: 'group', sum: ['D1', 'D2', 'D3', 'D4'] },
  { id: 'D1', label: 'Prêts immobilisés', kind: 'line', keys: ['241'] },
  { id: 'D2', label: 'Autres créances financières', kind: 'line', keys: ['240', '248'] },
  { id: 'D3', label: 'Titres de participation', kind: 'line', keys: ['251'] },
  { id: 'D4', label: 'Autres titres immobilisés', kind: 'line', keys: ['250', '258'] },
  { id: 'E', label: 'ÉCARTS DE CONVERSION — ACTIF (E)', kind: 'group', sum: ['E1', 'E2'] },
  { id: 'E1', label: 'Diminution des créances immobilisées', kind: 'line', keys: ['271'] },
  { id: 'E2', label: 'Augmentation des dettes de financement', kind: 'line', keys: ['272'] },
  { id: 'T1', label: 'TOTAL I (A + B + C + D + E)', kind: 'subtotal', sum: ['A', 'B', 'C', 'D', 'E'] },
  { id: 'F', label: 'STOCKS (F)', kind: 'group', sum: ['F1', 'F2', 'F3', 'F4', 'F5'] },
  { id: 'F1', label: 'Marchandises', kind: 'line', keys: ['311'] },
  { id: 'F2', label: 'Matières et fournitures consommables', kind: 'line', keys: ['312'] },
  { id: 'F3', label: 'Produits en cours', kind: 'line', keys: ['313'] },
  { id: 'F4', label: 'Produits intermédiaires et produits résiduels', kind: 'line', keys: ['314'] },
  { id: 'F5', label: 'Produits finis', kind: 'line', keys: ['315'] },
  { id: 'G', label: 'CRÉANCES DE L\'ACTIF CIRCULANT (G)', kind: 'group', sum: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] },
  { id: 'G1', label: 'Fournisseurs débiteurs, avances et acomptes', kind: 'line', keys: ['341'] },
  { id: 'G2', label: 'Clients et comptes rattachés', kind: 'line', keys: ['342'] },
  { id: 'G3', label: 'Personnel', kind: 'line', keys: ['343'] },
  { id: 'G4', label: 'État', kind: 'line', keys: ['345'] },
  { id: 'G5', label: 'Comptes d\'associés', kind: 'line', keys: ['346'] },
  { id: 'G6', label: 'Autres débiteurs', kind: 'line', keys: ['340', '348'] },
  { id: 'G7', label: 'Comptes de régularisation — actif', kind: 'line', keys: ['349'] },
  { id: 'H', label: 'TITRES ET VALEURS DE PLACEMENT (H)', kind: 'line', keys: ['350', '351', '352', '353', '354', '355', '356', '357', '358'] },
  { id: 'I', label: 'ÉCARTS DE CONVERSION — ACTIF (I) (éléments circulants)', kind: 'line', keys: ['370'] },
  { id: 'T2', label: 'TOTAL II (F + G + H + I)', kind: 'subtotal', sum: ['F', 'G', 'H', 'I'] },
  { id: 'J1', label: 'Chèques et valeurs à encaisser', kind: 'line', keys: ['511'] },
  { id: 'J2', label: 'Banques, TG et CCP', kind: 'line', keys: ['510', '514'] },
  { id: 'J3', label: 'Caisses, régies d\'avances et accréditifs', kind: 'line', keys: ['516'] },
  { id: 'T3', label: 'TOTAL III (trésorerie — actif)', kind: 'subtotal', sum: ['J1', 'J2', 'J3'] },
  { id: 'TG', label: 'TOTAL GÉNÉRAL (I + II + III)', kind: 'total', sum: ['T1', 'T2', 'T3'] },
];

/* ─── Tableau 2 : bilan passif ────────────────────────────────────── */

export const PASSIF: Def[] = [
  { id: 'K', label: 'CAPITAUX PROPRES (A)', kind: 'group', sum: ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8'] },
  { id: 'K1', label: 'Capital social ou personnel (moins capital souscrit non appelé)', kind: 'line', keys: ['111'] },
  { id: 'K2', label: 'Primes d\'émission, de fusion, d\'apport', kind: 'line', keys: ['112'] },
  { id: 'K3', label: 'Écarts de réévaluation', kind: 'line', keys: ['113'] },
  { id: 'K4', label: 'Réserve légale', kind: 'line', keys: ['114'] },
  { id: 'K5', label: 'Autres réserves', kind: 'line', keys: ['115'] },
  { id: 'K6', label: 'Report à nouveau', kind: 'line', keys: ['116'] },
  { id: 'K7', label: 'Résultats nets en instance d\'affectation', kind: 'line', keys: ['118'] },
  { id: 'K8', label: 'Résultat net de l\'exercice', kind: 'line', keys: ['119'] },
  { id: 'L', label: 'CAPITAUX PROPRES ASSIMILÉS (B)', kind: 'group', sum: ['L1', 'L2'] },
  { id: 'L1', label: 'Subventions d\'investissement', kind: 'line', keys: ['131'] },
  { id: 'L2', label: 'Provisions réglementées', kind: 'line', keys: ['135'] },
  { id: 'M', label: 'DETTES DE FINANCEMENT (C)', kind: 'group', sum: ['M1', 'M2'] },
  { id: 'M1', label: 'Emprunts obligataires', kind: 'line', keys: ['141'] },
  { id: 'M2', label: 'Autres dettes de financement', kind: 'line', keys: ['140', '148'] },
  { id: 'N', label: 'PROVISIONS DURABLES POUR RISQUES ET CHARGES (D)', kind: 'group', sum: ['N1', 'N2'] },
  { id: 'N1', label: 'Provisions pour risques', kind: 'line', keys: ['151'] },
  { id: 'N2', label: 'Provisions pour charges', kind: 'line', keys: ['155'] },
  { id: 'O', label: 'ÉCARTS DE CONVERSION — PASSIF (E)', kind: 'group', sum: ['O1', 'O2'] },
  { id: 'O1', label: 'Augmentation des créances immobilisées', kind: 'line', keys: ['171'] },
  { id: 'O2', label: 'Diminution des dettes de financement', kind: 'line', keys: ['172'] },
  { id: 'U1', label: 'TOTAL I (A + B + C + D + E)', kind: 'subtotal', sum: ['K', 'L', 'M', 'N', 'O'] },
  { id: 'P', label: 'DETTES DU PASSIF CIRCULANT (F)', kind: 'group', sum: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'] },
  { id: 'P1', label: 'Fournisseurs et comptes rattachés', kind: 'line', keys: ['441'] },
  { id: 'P2', label: 'Clients créditeurs, avances et acomptes', kind: 'line', keys: ['442'] },
  { id: 'P3', label: 'Personnel', kind: 'line', keys: ['443'] },
  { id: 'P4', label: 'Organismes sociaux', kind: 'line', keys: ['444'] },
  { id: 'P5', label: 'État', kind: 'line', keys: ['445'] },
  { id: 'P6', label: 'Comptes d\'associés', kind: 'line', keys: ['446'] },
  { id: 'P7', label: 'Autres créanciers', kind: 'line', keys: ['440', '448'] },
  { id: 'P8', label: 'Comptes de régularisation — passif', kind: 'line', keys: ['449'] },
  { id: 'Q', label: 'AUTRES PROVISIONS POUR RISQUES ET CHARGES (G)', kind: 'line', keys: ['450'] },
  { id: 'R', label: 'ÉCARTS DE CONVERSION — PASSIF (H) (éléments circulants)', kind: 'line', keys: ['470'] },
  { id: 'U2', label: 'TOTAL II (F + G + H)', kind: 'subtotal', sum: ['P', 'Q', 'R'] },
  { id: 'S1', label: 'Crédits d\'escompte', kind: 'line', keys: ['552'] },
  { id: 'S2', label: 'Crédits de trésorerie', kind: 'line', keys: ['553'] },
  { id: 'S3', label: 'Banques (soldes créditeurs)', kind: 'line', keys: ['554', '550', '551', '555', '556', '558', '559'] },
  { id: 'U3', label: 'TOTAL III (trésorerie — passif)', kind: 'subtotal', sum: ['S1', 'S2', 'S3'] },
  { id: 'UG', label: 'TOTAL GÉNÉRAL (I + II + III)', kind: 'total', sum: ['U1', 'U2', 'U3'] },
];

/* ─── Tableau 3 : CPC ─────────────────────────────────────────────── */

export const CPC: Def[] = [
  { id: 'I', label: 'I. PRODUITS D\'EXPLOITATION', kind: 'group', sum: ['I1', 'I2', 'I4', 'I5', 'I6', 'I7', 'I8'] },
  { id: 'I1', label: 'Ventes de marchandises (en l\'état)', kind: 'line', keys: ['711'] },
  { id: 'I2', label: 'Ventes de biens et services produits', kind: 'line', keys: ['712'] },
  { id: 'I3', label: 'Chiffre d\'affaires', kind: 'subtotal', sum: ['I1', 'I2'] },
  { id: 'I4', label: 'Variation de stocks de produits (±)', kind: 'line', keys: ['713'] },
  { id: 'I5', label: 'Immobilisations produites par l\'entreprise pour elle-même', kind: 'line', keys: ['714'] },
  { id: 'I6', label: 'Subventions d\'exploitation', kind: 'line', keys: ['716'] },
  { id: 'I7', label: 'Autres produits d\'exploitation', kind: 'line', keys: ['710', '718'] },
  { id: 'I8', label: 'Reprises d\'exploitation ; transferts de charges', kind: 'line', keys: ['719'] },
  { id: 'II', label: 'II. CHARGES D\'EXPLOITATION', kind: 'group', sum: ['II1', 'II2', 'II3', 'II4', 'II5', 'II6', 'II7'] },
  { id: 'II1', label: 'Achats revendus de marchandises', kind: 'line', keys: ['611'] },
  { id: 'II2', label: 'Achats consommés de matières et fournitures', kind: 'line', keys: ['612'] },
  { id: 'II3', label: 'Autres charges externes', kind: 'line', keys: ['613', '614'] },
  { id: 'II4', label: 'Impôts et taxes', kind: 'line', keys: ['616'] },
  { id: 'II5', label: 'Charges de personnel', kind: 'line', keys: ['617'] },
  { id: 'II6', label: 'Autres charges d\'exploitation', kind: 'line', keys: ['610', '618'] },
  { id: 'II7', label: 'Dotations d\'exploitation', kind: 'line', keys: ['619'] },
  { id: 'III', label: 'III. RÉSULTAT D\'EXPLOITATION (I − II)', kind: 'subtotal', sum: ['I', 'II'], sign: { II: -1 } },
  { id: 'IV', label: 'IV. PRODUITS FINANCIERS', kind: 'group', sum: ['IV1', 'IV2', 'IV3', 'IV4'] },
  { id: 'IV1', label: 'Produits des titres de participation et autres titres immobilisés', kind: 'line', keys: ['732'] },
  { id: 'IV2', label: 'Gains de change', kind: 'line', keys: ['733'] },
  { id: 'IV3', label: 'Intérêts et autres produits financiers', kind: 'line', keys: ['730', '738'] },
  { id: 'IV4', label: 'Reprises financières ; transferts de charges', kind: 'line', keys: ['739'] },
  { id: 'V', label: 'V. CHARGES FINANCIÈRES', kind: 'group', sum: ['V1', 'V2', 'V3', 'V4'] },
  { id: 'V1', label: 'Charges d\'intérêts', kind: 'line', keys: ['631'] },
  { id: 'V2', label: 'Pertes de change', kind: 'line', keys: ['633'] },
  { id: 'V3', label: 'Autres charges financières', kind: 'line', keys: ['630', '638'] },
  { id: 'V4', label: 'Dotations financières', kind: 'line', keys: ['639'] },
  { id: 'VI', label: 'VI. RÉSULTAT FINANCIER (IV − V)', kind: 'subtotal', sum: ['IV', 'V'], sign: { V: -1 } },
  { id: 'VII', label: 'VII. RÉSULTAT COURANT (III + VI)', kind: 'subtotal', sum: ['III', 'VI'] },
  { id: 'VIII', label: 'VIII. PRODUITS NON COURANTS', kind: 'group', sum: ['VIII1', 'VIII2', 'VIII3', 'VIII4', 'VIII5'] },
  { id: 'VIII1', label: 'Produits des cessions d\'immobilisations', kind: 'line', keys: ['751'] },
  { id: 'VIII2', label: 'Subventions d\'équilibre', kind: 'line', keys: ['756'] },
  { id: 'VIII3', label: 'Reprises sur subventions d\'investissement', kind: 'line', keys: ['757'] },
  { id: 'VIII4', label: 'Autres produits non courants', kind: 'line', keys: ['750', '758'] },
  { id: 'VIII5', label: 'Reprises non courantes ; transferts de charges', kind: 'line', keys: ['759'] },
  { id: 'IX', label: 'IX. CHARGES NON COURANTES', kind: 'group', sum: ['IX1', 'IX2', 'IX3', 'IX4'] },
  { id: 'IX1', label: 'Valeurs nettes d\'amortissements des immobilisations cédées', kind: 'line', keys: ['651'] },
  { id: 'IX2', label: 'Subventions accordées', kind: 'line', keys: ['656'] },
  { id: 'IX3', label: 'Autres charges non courantes', kind: 'line', keys: ['650', '658'] },
  { id: 'IX4', label: 'Dotations non courantes aux amortissements et aux provisions', kind: 'line', keys: ['659'] },
  { id: 'X', label: 'X. RÉSULTAT NON COURANT (VIII − IX)', kind: 'subtotal', sum: ['VIII', 'IX'], sign: { IX: -1 } },
  { id: 'XI', label: 'XI. RÉSULTAT AVANT IMPÔTS (VII + X)', kind: 'subtotal', sum: ['VII', 'X'] },
  { id: 'XII', label: 'XII. IMPÔTS SUR LES RÉSULTATS', kind: 'line', keys: ['670'] },
  { id: 'XIII', label: 'XIII. RÉSULTAT NET (XI − XII)', kind: 'total', sum: ['XI', 'XII'], sign: { XII: -1 } },
  { id: 'XIV', label: 'XIV. TOTAL DES PRODUITS (I + IV + VIII)', kind: 'subtotal', sum: ['I', 'IV', 'VIII'] },
  { id: 'XV', label: 'XV. TOTAL DES CHARGES (II + V + IX + XII)', kind: 'subtotal', sum: ['II', 'V', 'IX', 'XII'] },
  { id: 'XVI', label: 'XVI. RÉSULTAT NET (XIV − XV)', kind: 'total', sum: ['XIV', 'XV'], sign: { XV: -1 } },
];

/* ─── Calcul ──────────────────────────────────────────────────────── */

export type LiasseLine = { id: string; label: string; kind: Def['kind']; accounts: string[] };
export type ActifLine = LiasseLine & { gross: number; amort: number; net: number };
export type AmountLine = LiasseLine & { amount: number };
export type Anomaly = { code: string; label: string; balance: number; message: string };

/** Résout les sommes (groupes, sous-totaux, totaux) dans l'ordre de déclaration inverse des dépendances. */
function resolve<T extends Record<string, number>>(defs: Def[], base: Map<string, T>, zero: () => T, fields: (keyof T)[]) {
  const out = new Map(base);
  const get = (id: string): T => {
    if (out.has(id)) return out.get(id)!;
    const d = defs.find(x => x.id === id)!;
    const acc = zero();
    for (const s of d.sum ?? []) {
      const v = get(s), k = d.sign?.[s] ?? 1;
      for (const f of fields) (acc[f] as number) = r2((acc[f] as number) + k * (v[f] as number));
    }
    out.set(id, acc);
    return acc;
  };
  for (const d of defs) get(d.id);
  return out;
}

function keyIndex(defs: Def[]) {
  const idx = new Map<string, string>();
  for (const d of defs) for (const k of d.keys ?? []) idx.set(k, d.id);
  return idx;
}

/**
 * Bilan à une date : `balances` = soldes des comptes de classes 1 à 5 depuis
 * les derniers à-nouveaux ; `result` = résultat de l'exercice (classes 6-7)
 * et `prior` = résultat d'exercices antérieurs non clôturés (en instance
 * d'affectation).
 */
export function computeBilan(balances: AccountBalance[], result: number, prior = 0) {
  const actIdx = keyIndex(ACTIF), pasIdx = keyIndex(PASSIF);
  const act = new Map<string, { gross: number; amort: number; net: number }>();
  const pas = new Map<string, { amount: number }>();
  const accts = new Map<string, string[]>();
  const anomalies: Anomaly[] = [];
  const unmapped: AccountBalance[] = [];
  const addAct = (id: string, gross: number, amort: number, code: string) => {
    const v = act.get(id) ?? { gross: 0, amort: 0, net: 0 };
    v.gross = r2(v.gross + gross); v.amort = r2(v.amort + amort); v.net = r2(v.gross - v.amort);
    act.set(id, v);
    accts.set(id, [...(accts.get(id) ?? []), code]);
  };
  const addPas = (id: string, amount: number, code: string) => {
    pas.set(id, { amount: r2((pas.get(id)?.amount ?? 0) + amount) });
    accts.set(`P:${id}`, [...(accts.get(`P:${id}`) ?? []), code]);
  };

  for (const b of balances) {
    if (Math.abs(b.balance) < 0.005) continue;
    const cls = b.code[0];
    const { poste, contra } = posteOf(b.code);
    // Banques et caisses à solde créditeur : trésorerie passif.
    if (cls === '5' && !contra && !poste.startsWith('55') && b.balance < 0) {
      addPas('S3', -b.balance, b.code);
      continue;
    }
    const aId = actIdx.get(poste), pId = pasIdx.get(poste);
    if (aId && (cls === '2' || cls === '3' || cls === '5' || POSTE_OVERRIDE[b.code])) {
      if (contra) addAct(aId, 0, -b.balance, b.code);
      else {
        addAct(aId, b.balance, 0, b.code);
        if (b.balance < 0) anomalies.push({ code: b.code, label: b.label, balance: r2(b.balance), message: 'Compte d\'actif à solde créditeur' });
      }
    } else if (pId) {
      addPas(pId, -b.balance, b.code);
      if (b.balance > 0 && !['111', '116', '118', '119'].includes(poste))
        anomalies.push({ code: b.code, label: b.label, balance: r2(b.balance), message: 'Compte de passif à solde débiteur' });
    } else {
      unmapped.push(b);
    }
  }
  addPas('K8', result, 'résultat');
  if (Math.abs(prior) >= 0.005) addPas('K7', prior, 'antérieur');

  const actif = resolve(ACTIF, act, () => ({ gross: 0, amort: 0, net: 0 }), ['gross', 'amort', 'net']);
  const passif = resolve(PASSIF, pas, () => ({ amount: 0 }), ['amount']);
  const actifLines: ActifLine[] = ACTIF.map(d => ({ id: d.id, label: d.label, kind: d.kind, accounts: accts.get(d.id) ?? [], ...actif.get(d.id)! }));
  const passifLines: AmountLine[] = PASSIF.map(d => ({ id: d.id, label: d.label, kind: d.kind, accounts: (accts.get(`P:${d.id}`) ?? []).filter(c => /^\d/.test(c)), amount: passif.get(d.id)!.amount }));
  const totalActif = actif.get('TG')!.net, totalPassif = passif.get('UG')!.amount;
  return { actif: actifLines, passif: passifLines, total_actif: totalActif, total_passif: totalPassif, ecart: r2(totalActif - totalPassif), anomalies, unmapped };
}

/** CPC d'un exercice : `balances` = soldes des comptes de classes 6 et 7 sur l'exercice (débit − crédit). */
export function computeCpc(balances: AccountBalance[]) {
  const idx = keyIndex(CPC);
  const base = new Map<string, { amount: number }>();
  const accts = new Map<string, string[]>();
  const unmapped: AccountBalance[] = [];
  for (const b of balances) {
    if (Math.abs(b.balance) < 0.005) continue;
    const id = idx.get(b.code.slice(0, 3));
    if (!id) { unmapped.push(b); continue; }
    // Produits : crédit − débit ; charges : débit − crédit.
    const amount = b.code[0] === '7' ? -b.balance : b.balance;
    base.set(id, { amount: r2((base.get(id)?.amount ?? 0) + amount) });
    accts.set(id, [...(accts.get(id) ?? []), b.code]);
  }
  const all = resolve(CPC, base, () => ({ amount: 0 }), ['amount']);
  const lines: AmountLine[] = CPC.map(d => ({ id: d.id, label: d.label, kind: d.kind, accounts: accts.get(d.id) ?? [], amount: all.get(d.id)!.amount }));
  const v = (id: string) => all.get(id)!.amount;
  return { lines, result: v('XIII'), revenue: v('I3'), unmapped, value: v };
}

/* ─── Tableau 4 : état des soldes de gestion ─────────────────────── */

const sumCodes = (balances: AccountBalance[], re: RegExp, product: boolean) =>
  r2(balances.filter(b => re.test(b.code)).reduce((s, b) => s + (product ? -b.balance : b.balance), 0));

/**
 * TFR (formation des résultats) et CAF. Les dotations et reprises retenues
 * pour la CAF sont celles des actifs immobilisés et provisions durables : les
 * provisions de l'actif circulant (6196, 6394, 6396, 6596, 7196…) et la
 * provision pour perte de change (6393/7393, contrepartie 4506) en sont
 * exclues, comme les transferts de charges.
 */
export function computeEsg(balances: AccountBalance[], distributions = 0) {
  const cpc = computeCpc(balances);
  const v = cpc.value;
  const tfr: AmountLine[] = [];
  const add = (id: string, label: string, amount: number, kind: Def['kind'] = 'line') => tfr.push({ id, label, kind, accounts: [], amount: r2(amount) });
  add('1', 'Ventes de marchandises (en l\'état)', v('I1'));
  add('2', '− Achats revendus de marchandises', v('II1'));
  const marge = r2(v('I1') - v('II1'));
  add('I', 'I. MARGE BRUTE SUR VENTES EN L\'ÉTAT', marge, 'subtotal');
  const production = r2(v('I2') + v('I4') + v('I5'));
  add('II', 'II. PRODUCTION DE L\'EXERCICE (3 + 4 + 5)', production, 'subtotal');
  add('3', 'Ventes de biens et services produits', v('I2'));
  add('4', 'Variation de stocks de produits', v('I4'));
  add('5', 'Immobilisations produites par l\'entreprise pour elle-même', v('I5'));
  const conso = r2(v('II2') + v('II3'));
  add('III', 'III. CONSOMMATIONS DE L\'EXERCICE (6 + 7)', conso, 'subtotal');
  add('6', 'Achats consommés de matières et fournitures', v('II2'));
  add('7', 'Autres charges externes', v('II3'));
  const va = r2(marge + production - conso);
  add('IV', 'IV. VALEUR AJOUTÉE (I + II − III)', va, 'subtotal');
  add('8', '+ Subventions d\'exploitation', v('I6'));
  add('9', '− Impôts et taxes', v('II4'));
  add('10', '− Charges de personnel', v('II5'));
  const ebe = r2(va + v('I6') - v('II4') - v('II5'));
  add('V', ebe >= 0 ? 'V. EXCÉDENT BRUT D\'EXPLOITATION (EBE)' : 'V. INSUFFISANCE BRUTE D\'EXPLOITATION (IBE)', ebe, 'subtotal');
  add('11', '+ Autres produits d\'exploitation', v('I7'));
  add('12', '− Autres charges d\'exploitation', v('II6'));
  add('13', '+ Reprises d\'exploitation, transferts de charges', v('I8'));
  add('14', '− Dotations d\'exploitation', v('II7'));
  const rex = r2(ebe + v('I7') - v('II6') + v('I8') - v('II7'));
  add('VI', 'VI. RÉSULTAT D\'EXPLOITATION (+ ou −)', rex, 'subtotal');
  add('VII', 'VII. RÉSULTAT FINANCIER', v('VI'), 'subtotal');
  add('VIII', 'VIII. RÉSULTAT COURANT (+ ou −)', r2(rex + v('VI')), 'subtotal');
  add('IX', 'IX. RÉSULTAT NON COURANT', v('X'), 'subtotal');
  add('15', '− Impôts sur les résultats', v('XII'));
  const net = r2(rex + v('VI') + v('X') - v('XII'));
  add('X', 'X. RÉSULTAT NET DE L\'EXERCICE (+ ou −)', net, 'total');

  const caf: AmountLine[] = [];
  const c = (id: string, label: string, amount: number, kind: Def['kind'] = 'line') => caf.push({ id, label, kind, accounts: [], amount: r2(amount) });
  const dotExp = sumCodes(balances, /^619[1-5]/, false);
  const dotFin = sumCodes(balances, /^639[12]/, false);
  const dotNc = sumCodes(balances, /^659[1-5]/, false);
  const repExp = sumCodes(balances, /^719[1-5]/, true);
  const repFin = sumCodes(balances, /^7392/, true);
  const repNc = r2(sumCodes(balances, /^759[1-5]/, true) + sumCodes(balances, /^757/, true));
  const cessions = sumCodes(balances, /^751/, true);
  const vnc = sumCodes(balances, /^651/, false);
  c('1', 'Résultat net de l\'exercice (bénéfice + / perte −)', net);
  c('2', '+ Dotations d\'exploitation (actif immobilisé)', dotExp);
  c('3', '+ Dotations financières (actif immobilisé)', dotFin);
  c('4', '+ Dotations non courantes', dotNc);
  c('5', '− Reprises d\'exploitation', repExp);
  c('6', '− Reprises financières', repFin);
  c('7', '− Reprises non courantes (y compris reprises sur subventions d\'investissement)', repNc);
  c('8', '− Produits des cessions d\'immobilisations', cessions);
  c('9', '+ Valeurs nettes d\'amortissements des immobilisations cédées', vnc);
  const cafV = r2(net + dotExp + dotFin + dotNc - repExp - repFin - repNc - cessions + vnc);
  c('I', 'I. CAPACITÉ D\'AUTOFINANCEMENT (CAF)', cafV, 'subtotal');
  c('10', '− Distributions de bénéfices', distributions);
  c('II', 'II. AUTOFINANCEMENT', r2(cafV - distributions), 'total');
  return { tfr, caf, net, cpcResult: cpc.result };
}

/** Modèle simplifié : bilan regroupé au niveau des rubriques (les lignes de détail disparaissent). */
export function simplifyBilan<T extends LiasseLine>(lines: T[], defs: Def[]): T[] {
  const detail = new Set(defs.filter(d => d.kind === 'group').flatMap(d => d.sum ?? []));
  return lines.filter(l => !detail.has(l.id)).map(l => (l.kind === 'group' ? { ...l, kind: 'line' as const } : l));
}

/** Contrôles de cohérence de la liasse (identité du bilan, résultats concordants). */
export function controls(p: { totalActif: number; totalPassif: number; bilanResult: number; cpcResult: number; esgResult: number; unmapped: AccountBalance[]; anomalies: Anomaly[] }) {
  const out: { level: 'error' | 'warning'; message: string }[] = [];
  if (Math.abs(p.totalActif - p.totalPassif) >= 0.01) out.push({ level: 'error', message: `Total actif (${p.totalActif.toFixed(2)}) différent du total passif (${p.totalPassif.toFixed(2)})` });
  if (Math.abs(p.bilanResult - p.cpcResult) >= 0.01) out.push({ level: 'error', message: `Résultat du bilan (${p.bilanResult.toFixed(2)}) différent du résultat du CPC (${p.cpcResult.toFixed(2)})` });
  if (Math.abs(p.esgResult - p.cpcResult) >= 0.01) out.push({ level: 'error', message: `Résultat de l'ESG (${p.esgResult.toFixed(2)}) différent du résultat du CPC (${p.cpcResult.toFixed(2)})` });
  for (const u of p.unmapped) out.push({ level: 'error', message: `Compte ${u.code} ${u.label} (${u.balance.toFixed(2)}) sans rubrique de la liasse` });
  for (const a of p.anomalies) out.push({ level: 'warning', message: `${a.message} : ${a.code} ${a.label} (${a.balance.toFixed(2)})` });
  return out;
}
