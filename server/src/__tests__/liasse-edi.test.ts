import { describe, it, expect } from 'vitest';
import { computeBilan, computeCpc, computeEsg, type AccountBalance } from '../services/liasse.rules.js';
import { liasseEdiTables, simplifiedGaps, type LiasseValues } from '../services/liasse-edi.codes.js';
import { liasseXml } from '../services/dgi-edi.service.js';

/**
 * Codes de cellule par tableau dans les exemples officiels de la DGI
 * (annexes EDI SIMPL-IS 2026, liasse_Modele_Normal_1.xml et
 * liasse_Modele_simplifie_7.xml), en plages.
 */
const OFFICIAL: Record<'normal' | 'simplifie', Record<number, string>> = {
  normal: {
    2: '122-149,151-154,160-179,181-184,186-189,192-199,207-234,238-249,254-269,274-289,291-294,296-299,303-314,316-319,497-500,502-505,507-510,512-515,517-520,522-525,527-530,532-535',
    1: '13339,13343,13368-13453,14001-14002',
    6: '11176-11179,11181-11184,11186-11189,11191-11194,11196-11199,11201-11204,11206-11209,11211-11214,11216-11219,11221-11224,11226-11229,11231-11234,11236-11239,11241-11244,11246-11249,11251-11254,11256-11259,11261-11264,11266-11269,11271-11274,11276-11279,11281-11284,11286-11289,11291-11294,11296-11299,11301-11304,11306-11309,11311-11314,11316-11319,11321-11324,11326-11329,11331-11334,11336-11339,11341-11344,11346-11349,11351-11354,11356-11359,11361-11364,11366-11369,11371-11374,11376-11379,11381-11384,11386-11389,11391-11394,11396-11399,11401-11404,11406-11409,11411-11414,11416-11419,11421-11424,11426-11429,11431-11434,11436-11439,14021-14024',
    7: '817-831,833-834,837-840,845-852,854-855,860-867,6872-6875,7830,18009-18010,18012-18013',
    32: '1308-1321,1324-1346,1349-1357,1372-1399,4063-4064,4066-4067',
  },
  simplifie: {
    61: '4562-4565,4567-4570,4572-4575,4577-4580,4582-4585,4587-4590,4592-4595,4597-4600,4602-4605,4607-4610,4612-4615,4617-4620,4622-4625,4627-4630,4632-4635,4637-4640,4642-4645,4647-4650,4652-4655,4657-4660,4662-4665,4667-4670,4672-4675,4677-4680,4682-4685,4687-4690,4692-4695,4697-4700,11501-11504,11506-11509,11511-11514',
    65: '5223-5246,5254-5267,5273-5282,12110-12111,12113-12114,12116-12117,12119-12120,17914-17915,17917-17918',
    78: '5309-5317,5327-5335,5337,5340-5341,5343,5345,5347,5349,5351,5353,5355,5357,5359-5428,5431-5451,12086-12089,12091-12094,12096-12099,17909-17912',
    7: '817-831,833-834,837-840,845-852,854-855,860-867,6872-6875,7830,18009-18010,18012-18013',
    32: '1308-1321,1324-1346,1349-1357,1372-1399,4063-4064,4066-4067',
  },
};
const inRanges = (spec: string, code: number) => spec.split(',').some(r => {
  const [a, b] = r.split('-').map(Number);
  return code >= a && code <= (b ?? a);
});

const B = (code: string, balance: number): AccountBalance => ({ code, label: code, balance });
/** Petite comptabilité cohérente : bilan d'ouverture, ventes, achats, salaires, IS, dotation, banque créditrice. */
function sample(): LiasseValues {
  const ges = [B('7111', -500_000), B('7121', -300_000), B('61211', 350_000), B('6131', 40_000), B('6171', 180_000),
    B('6161', 5_000), B('61931', 12_000), B('6311', 3_000), B('7381', -1_000), B('6701', 33_000)];
  const cpc = computeCpc(ges);
  const bil = [B('1111', -100_000), B('1161', -20_000), B('2332', 150_000), B('28332', -42_000), B('3121', 30_000),
    B('3421', 120_000), B('3455', 15_000), B('3431', 4_000), B('4411', -80_000), B('4455', -25_000),
    B('1481', -60_000), B('5141', 120_000), B('5161', 2_000), B('5143', -8_000)];
  const sumBil = bil.reduce((s, b) => s + b.balance, 0);
  bil.push(B('4481', -(sumBil - cpc.result)));   // équilibre : Σ classes 1-5 = résultat
  const bilan = computeBilan(bil, cpc.result);
  const esg = computeEsg(ges);
  const p = <T extends { id: string; amount: number }>(rows: T[]) => rows.map(r => ({ id: r.id, amount: r.amount, previous: 0 }));
  return {
    actif: bilan.actif.map(a => ({ id: a.id, gross: a.gross, amort: a.amort, net: a.net, previous_net: 0 })),
    passif: p(bilan.passif), cpc: p(cpc.lines), tfr: p(esg.tfr), caf: p(esg.caf),
    passage: { net_result: cpc.result, reintegrations: [{ label: 'Impôt sur les sociétés comptabilisé (6701)', amount: 33_000 }, { label: 'Amendes & pénalités', amount: 1_500 }], deductions: [{ label: 'Dividendes reçus', amount: 1_000 }], taxable_result: 0 },
  };
}
const cell = (tables: ReturnType<typeof liasseEdiTables>, table: number, code: number) =>
  tables.find(t => t.id === table)!.cells.find(c => c.code === code)?.value;

describe('Liasse IS en EDI (Simpl-IS)', () => {
  it.each(['normal', 'simplifie'] as const)('modèle %s : chaque code est dans le tableau de l\'exemple officiel, sans doublon', model => {
    const tables = liasseEdiTables(sample(), model);
    expect(tables.map(t => t.id)).toEqual(model === 'normal' ? [2, 1, 6, 7, 32] : [61, 65, 78, 7, 32]);
    for (const t of tables) {
      const misplaced = t.cells.filter(c => !inRanges(OFFICIAL[model][t.id], c.code)).map(c => c.code);
      expect(misplaced, `tableau ${t.id}`).toEqual([]);
      const single = t.cells.filter(c => !c.line).map(c => c.code);
      expect(new Set(single).size, `doublons tableau ${t.id}`).toBe(single.length);
    }
  });

  it('modèle normal : totaux du bilan, résultat et CPC portés dans les bonnes cellules', () => {
    const l = sample();
    const t = liasseEdiTables(l, 'normal');
    expect(cell(t, 2, 188)).toBe(cell(t, 1, 13368));                    // total net actif = total passif
    expect(cell(t, 1, 13409)).toBe(cell(t, 6, 11423));                  // résultat bilan = résultat CPC
    expect(cell(t, 6, 11423)).toBe(cell(t, 32, 1332));                  // = résultat ESG
    expect(cell(t, 2, 209)).toBe('150000.00');                          // ITMO brut
    expect(cell(t, 2, 216)).toBe('42000.00');                           // amortissements
    expect(cell(t, 2, 223)).toBe('108000.00');                          // net
    expect(cell(t, 1, 13372)).toBe('8000.00');                          // banque créditrice
    expect(cell(t, 6, 11183)).toBe('500000.00');                        // ventes de marchandises (total)
    expect(cell(t, 6, 11182)).toBe('0.00');                             // exercices précédents
    expect(cell(t, 6, 11178)).toBe(cell(t, 6, 11218));                  // en-tête I = Total I
    expect(cell(t, 2, 534)).toBe(cell(t, 2, 318));                      // trésorerie actif = total III
  });

  it('modèle simplifié : regroupements et totaux', () => {
    const t = liasseEdiTables(sample(), 'simplifie');
    expect(cell(t, 61, 4699)).toBe(cell(t, 65, 5277));
    expect(cell(t, 61, 4599)).toBe('108000.00');                        // ITMO net
    expect(cell(t, 61, 4644)).toBe('120000.00');                        // clients
    expect(cell(t, 61, 11508)).toBe('15000.00');                        // État débiteur
    expect(cell(t, 65, 5229)).toBe(cell(t, 78, 5435));                  // résultat
    expect(cell(t, 78, 5376)).toBe('1000.00');                          // produits financiers dans les courants
    expect(cell(t, 78, 5377)).toBe('801000.00');                        // total produits courants
    expect(cell(t, 78, 5447)).toBe('500000.00');                        // marge brute : pas de marchandises achetées
    expect(simplifiedGaps(sample())).toEqual([]);
  });

  it('passage au résultat fiscal : lignes numérotées, totaux T1/T2 et résultat fiscal', () => {
    const l = sample();
    const p = liasseEdiTables(l, 'normal').find(t => t.id === 7)!.cells;
    const net = l.passage.net_result;
    expect(net).toBeGreaterThan(0);
    expect(p.find(c => c.code === 817)!.value).toBe(net.toFixed(2));
    expect(p.find(c => c.code === 820)!.value).toBe('0.00');
    expect(p.filter(c => c.code === 821).map(c => [c.line, c.value])).toEqual([[1, 'Impôt sur les sociétés comptabilisé (6701)'], [2, 'Amendes & pénalités']]);
    expect(p.find(c => c.code === 18009)!.value).toBe('34500.00');
    expect(p.find(c => c.code === 830 && c.line === 1)!.value).toBe('1000.00');
    expect(p.find(c => c.code === 6872)!.value).toBe((net + 34_500 - 1_000).toFixed(2));
    // Perte : déficit brut et net fiscal dans la colonne (−).
    const loss = liasseEdiTables({ ...l, passage: { ...l.passage, net_result: -50_000, reintegrations: [], deductions: [] } }, 'normal').find(t => t.id === 7)!.cells;
    expect(loss.find(c => c.code === 820)!.value).toBe('50000.00');
    expect(loss.find(c => c.code === 840)!.value).toBe('50000.00');
    expect(loss.find(c => c.code === 6875)!.value).toBe('50000.00');
    expect(loss.some(c => c.code === 837 || c.code === 6872)).toBe(false);
  });

  it('XML : structure des exemples officiels (prologue, modèle, numeroLigne, extraFieldvaleurs)', () => {
    const tables = liasseEdiTables(sample(), 'simplifie');
    const s = liasseXml({ identifiantFiscal: '1003928', year: 2025, model: 'simplifie', tables }).toString('utf8');
    expect(s.startsWith('<?xml version="1.0" encoding="UTF-8"?>\r\n<Liasse>\r\n\t<modele>\r\n\t\t<id>7</id>')).toBe(true);
    expect(s).toContain('<identifiantFiscal>1003928</identifiantFiscal>\r\n\t\t<exerciceFiscalDu>2025-01-01</exerciceFiscalDu>\r\n\t\t<exerciceFiscalAu>2025-12-31</exerciceFiscalAu>');
    expect(s.match(/<ValeursTableau>/g)!.length).toBe(5);
    expect(s.match(/<extraFieldvaleurs>/g)!.length).toBe(5);
    expect(s).toMatch(/<codeEdi>821<\/codeEdi>\r\n\t+<\/cellule>\r\n\t+<valeur>Impôt sur les sociétés comptabilisé \(6701\)<\/valeur>\r\n\t+<numeroLigne>1<\/numeroLigne>/);
    expect(s).toContain('<valeur>Amendes &amp; pénalités</valeur>');
    // Ordre des éléments d'un tableau : tableau, groupeValeurs, extraFieldvaleurs.
    const first = s.slice(s.indexOf('<ValeursTableau>'), s.indexOf('</ValeursTableau>'));
    expect(first.indexOf('<tableau>')).toBeLessThan(first.indexOf('<groupeValeurs>'));
    expect(first.indexOf('</groupeValeurs>')).toBeLessThan(first.indexOf('<extraFieldvaleurs>'));
  });
});
