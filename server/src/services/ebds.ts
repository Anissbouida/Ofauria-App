/**
 * Fichier e-BDS (Bordereau de Declaration des Salaires) pour Damancom —
 * fonctions PURES.
 *
 * Source : CNSS, « e-BDS. Cahier des charges relatif a la realisation des
 * declarations des salaires en mode echange de fichiers entre la CNSS et ses
 * affilies », version 2 (fevrier 2006) ; implementations tierces concordantes
 * (Odoo cnss_bds_generator, RHP DamanComEDI). Aucune version CNSS plus
 * recente n'est publiee : valider par un premier depot test sur Damancom.
 *
 * Principe : la CNSS envoie un « preetabli » AFFEBDS_<affilie>_<periode>.txt
 * (A00 entete, A01 affilie, A02 un par assure connu, A03 recap). L'affilie
 * renvoie DS_<affilie>_<MMAAAA>.txt :
 *   B00 = A00 (type B00, categorie B0)        B01 = A01 (type B01)
 *   B02 = un par A02, dans le meme ordre : zones A02 recopiees a l'identique
 *         + AF a reverser, jours, salaire reel, plafonne, situation, controle
 *   B03 = recap des B02 (zones A03 recopiees + totaux)
 *   B04 = entrants (salaries absents du preetabli), ou une ligne vide
 *   B05 = recap des B04                        B06 = B03 + B05
 * Enregistrements de 260 caracteres, LF apres chacun ; N = zeros a gauche,
 * AN = espaces a droite ; montants en CENTIMES. Les zones issues du
 * preetabli sont recopiees octet pour octet (lecture/ecriture latin-1).
 */

export const RECORD_LENGTH = 260;

export interface PreetabliA02 {
  line: string;          // enregistrement brut (260)
  numAssure: string;     // 9 chiffres
  name: string;
  afNet: number;         // centimes
}

export interface Preetabli {
  a00: string;
  a01: string;
  a02: PreetabliA02[];
  a03: string;
  affilie: string;       // 7 chiffres
  periode: string;       // AAAAMM
  raisonSociale: string;
}

/** Ligne de paie a declarer (bordereau CNSS du mois). */
export interface EbdsEmployee {
  name: string;
  cnssNumber: string | null;
  cin: string | null;
  days: number;
  salaireReel: number;   // DH
}

export interface EbdsResult {
  content: string;       // a ecrire en latin-1
  fileName: string;
  warnings: string[];
  totals: { salaries: number; entrants: number; sortants: number; jours: number; salaireReel: number; salairePlafonne: number };
}

// ─── Primitives de format ───
const N = (v: number | string, len: number): string => {
  const s = typeof v === 'number' ? String(Math.round(v)) : v;
  if (!/^\d*$/.test(s)) throw new Error(`Valeur numérique invalide : ${s}`);
  if (s.length > len) throw new Error(`Valeur ${s} trop longue pour une zone de ${len} chiffres`);
  return s.padStart(len, '0');
};
const AN = (v: string, len: number): string => v.slice(0, len).padEnd(len, ' ');
const filler = (len: number) => ' '.repeat(len);
const cents = (dh: number) => Math.round(dh * 100);

/** Nom et CIN des entrants : majuscules, chiffres, espace (cahier des charges §IV.8). */
export const ebdsText = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Cle du numero d'affilie (7 chiffres). */
export function affilieKeyValid(n: string): boolean {
  if (!/^\d{7}$/.test(n)) return false;
  const c = n.split('').map(Number);
  const t = (c[1] + c[3] + c[5]) * 2 + c[0] + c[2] + c[4];
  return c[6] === (t % 10 === 0 ? 0 : 10 - (t % 10));
}

/** Cle du numero d'immatriculation (9 chiffres, commence par 1). */
export function immatriculationKeyValid(n: string): boolean {
  if (!/^1\d{8}$/.test(n) || n === '100000000') return false;
  const c = n.split('').map(Number);
  const t = (c[1] + c[3] + c[5] + c[7]) * 2 + c[2] + c[4] + c[6];
  return c[8] === (t % 10 === 0 ? 0 : 10 - (t % 10));
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

// ─── Lecture du preetabli ───
export function parsePreetabli(text: string): Preetabli {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.length > 0);
  const bad = lines.find(l => l.length !== RECORD_LENGTH);
  if (bad) throw new Error(`Préétabli invalide : enregistrement de ${bad.length} caractères au lieu de ${RECORD_LENGTH} (« ${bad.slice(0, 3)} »).`);
  const of = (t: string) => lines.filter(l => l.startsWith(t));
  const [a00] = of('A00'), [a01] = of('A01'), [a03] = of('A03');
  if (!a00 || !a01 || !a03) throw new Error('Préétabli invalide : enregistrements A00, A01 et A03 attendus (fichier AFFEBDS_… de Damancom).');
  return {
    a00, a01, a03,
    affilie: a01.slice(3, 10),
    periode: a01.slice(10, 16),
    raisonSociale: a01.slice(16, 56).trim(),
    a02: of('A02').map(l => ({
      line: l,
      numAssure: l.slice(16, 25),
      name: l.slice(25, 85).trim(),
      afNet: parseInt(l.slice(99, 105), 10) || 0,
    })),
  };
}

// ─── Generation de la declaration ───
const SITUATION_RANK: Record<string, number> = { '  ': 0, SO: 1, DE: 2, IT: 3, IL: 4, AT: 5, CS: 6, MS: 7, MP: 8 };

/**
 * Construit la declaration principale. `plafond` = plafond CNSS mensuel (DH).
 * Rapprochement par numero d'immatriculation : un assure du preetabli sans
 * bulletin est declare sortant (SO, jours et salaires nuls, AF net reversee) ;
 * un salarie paye absent du preetabli est un entrant (B04).
 */
export function buildEbds(pre: Preetabli, employees: EbdsEmployee[], plafond: number): EbdsResult {
  const warnings: string[] = [];
  const aff = pre.affilie, per = pre.periode;
  const plafondCts = cents(plafond);
  const byNum = new Map<string, EbdsEmployee>();
  const entrants: EbdsEmployee[] = [];
  for (const e of employees) {
    const n = digits(e.cnssNumber) ? digits(e.cnssNumber).padStart(9, '0') : '';
    if (n && byNum.has(n)) warnings.push(`N° CNSS ${n} en double (${byNum.get(n)!.name} / ${e.name}) : un seul bulletin retenu.`);
    else if (n && pre.a02.some(a => a.numAssure === n)) byNum.set(n, e);
    else entrants.push(e);
  }

  const amounts = (e: EbdsEmployee) => {
    const reel = Math.max(0, cents(e.salaireReel));
    return { jours: Math.min(26, Math.max(0, Math.round(e.days))), reel, plaf: Math.min(reel, plafondCts) };
  };

  // B02 : un par A02, meme ordre.
  const t3 = { jours: 0, reel: 0, plaf: 0, ctr: 0, reverser: 0, sortants: 0 };
  const b02 = pre.a02.map(a => {
    const e = byNum.get(a.numAssure);
    let situation = '  ', reverser = 0, jours = 0, reel = 0, plaf = 0;
    if (e) {
      ({ jours, reel, plaf } = amounts(e));
      if (jours === 0 || reel === 0) {
        // Present au preetabli mais rien de paye : maintenu sans salaire.
        situation = 'MS'; jours = 0; reel = 0; plaf = 0;
        warnings.push(`${e.name} : bulletin sans jours ni salaire, déclaré « MS » (maintenu sans salaire) — à corriger si c'est un congé (CS) ou une maladie (IL).`);
      }
    } else {
      situation = 'SO';
      reverser = a.afNet;
      t3.sortants++;
      warnings.push(`${a.name} (n° ${a.numAssure}) : au préétabli mais sans bulletin ce mois, déclaré sortant (SO).`);
    }
    const ctr = parseInt(a.numAssure, 10) + reverser + jours + reel + plaf + SITUATION_RANK[situation];
    t3.jours += jours; t3.reel += reel; t3.plaf += plaf; t3.ctr += ctr; t3.reverser += reverser;
    return 'B02' + a.line.slice(3, 105) + N(reverser, 6) + N(jours, 2) + N(reel, 13) + N(plaf, 9) + situation + N(ctr, 19) + filler(104);
  });
  const b03 = 'B03' + pre.a03.slice(3, 79) + N(t3.reverser, 12) + N(t3.jours, 6) + N(t3.reel, 15) + N(t3.plaf, 13) + N(t3.ctr, 19) + filler(116);

  // Coherence avec le recap A03 (effectif, somme des immatriculations).
  const a03Count = parseInt(pre.a03.slice(16, 22), 10);
  if (a03Count !== pre.a02.length) warnings.push(`Préétabli incohérent : A03 annonce ${a03Count} salariés pour ${pre.a02.length} lignes A02.`);

  // B04 : entrants, tries par n° d'immatriculation.
  const t5 = { count: 0, imma: 0, jours: 0, reel: 0, plaf: 0, ctr: 0 };
  const b04Rows = entrants.map(e => {
    let num = digits(e.cnssNumber);
    if (num && !immatriculationKeyValid(num)) {
      warnings.push(`${e.name} : n° CNSS ${num} invalide (clé), déclaré sans immatriculation.`);
      num = '';
    }
    const cin = ebdsText(e.cin ?? '').replace(/ /g, '');
    if (!num) {
      num = '000000000';
      if (!cin) warnings.push(`${e.name} : entrant sans n° CNSS ni CIN, la CNSS rejettera la ligne.`);
    }
    const { jours, reel, plaf } = amounts(e);
    if (jours === 0 || reel === 0) warnings.push(`${e.name} : entrant sans jours ou sans salaire (rejet CNSS).`);
    return { num, name: ebdsText(e.name), cin, jours, reel, plaf };
  }).sort((x, y) => x.num.localeCompare(y.num));
  if (cinDuplicates(b04Rows.map(r => r.cin))) warnings.push('CIN en double parmi les entrants.');
  const b04 = b04Rows.length
    ? b04Rows.map(r => {
        const ctr = parseInt(r.num, 10) + r.jours + r.reel + r.plaf;
        t5.count++; t5.imma += parseInt(r.num, 10); t5.jours += r.jours; t5.reel += r.reel; t5.plaf += r.plaf; t5.ctr += ctr;
        return 'B04' + N(aff, 7) + N(per, 6) + N(r.num, 9) + AN(r.name, 60) + AN(r.cin, 8) + N(r.jours, 2) + N(r.reel, 13) + N(r.plaf, 9) + N(ctr, 19) + filler(124);
      })
    // Aucun entrant : une ligne vide obligatoire (9 espaces, zeros).
    : ['B04' + N(aff, 7) + N(per, 6) + filler(9) + filler(60) + filler(8) + N(0, 2) + N(0, 13) + N(0, 9) + N(0, 19) + filler(124)];
  const recap = (type: string, t: { count: number; imma: number; jours: number; reel: number; plaf: number; ctr: number }) =>
    type + N(aff, 7) + N(per, 6) + N(t.count, 6) + N(t.imma, 15) + N(t.jours, 6) + N(t.reel, 15) + N(t.plaf, 13) + N(t.ctr, 19) + filler(170);
  const b05 = recap('B05', t5);
  const immaB03 = parseInt(pre.a03.slice(64, 79), 10);
  const b06 = recap('B06', {
    count: pre.a02.length + t5.count, imma: immaB03 + t5.imma, jours: t3.jours + t5.jours,
    reel: t3.reel + t5.reel, plaf: t3.plaf + t5.plaf, ctr: t3.ctr + t5.ctr,
  });

  const b00 = 'B00' + pre.a00.slice(3, 17) + 'B0' + pre.a00.slice(19);
  const b01 = 'B01' + pre.a01.slice(3);
  const records = [b00, b01, ...b02, b03, ...b04, b05, b06];
  const wrong = records.find(r => r.length !== RECORD_LENGTH);
  if (wrong) throw new Error(`Enregistrement ${wrong.slice(0, 3)} de ${wrong.length} caractères (attendu ${RECORD_LENGTH}).`);
  if (!affilieKeyValid(aff)) warnings.push(`N° d'affilié ${aff} : clé de contrôle invalide.`);

  return {
    content: records.join('\n') + '\n',
    fileName: `DS_${aff}_${per.slice(4, 6)}${per.slice(0, 4)}.txt`,
    warnings,
    totals: {
      salaries: pre.a02.length + t5.count, entrants: t5.count, sortants: t3.sortants,
      jours: t3.jours + t5.jours, salaireReel: (t3.reel + t5.reel) / 100, salairePlafonne: (t3.plaf + t5.plaf) / 100,
    },
  };
}

function cinDuplicates(cins: string[]): boolean {
  const seen = new Set<string>();
  for (const c of cins.filter(Boolean)) { if (seen.has(c)) return true; seen.add(c); }
  return false;
}
