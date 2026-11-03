/**
 * Liasse IS en EDI (Simpl-IS) : codes DGI des cellules, sans accès à la base.
 *
 * Source : annexes EDI SIMPL-IS 2026 de la DGI (« Codification des cellules
 * modèle Normal / Simplifié », exemples liasse_Modele_Normal_1.xml et
 * liasse_Modele_simplifie_7.xml, cahier des charges V2.0.3). Les schémas XSD
 * de l'archive datent de 2017 : la structure y est la même, mais leur liste de
 * codes ignore des cellules ajoutées depuis ; la codification fait foi.
 *
 *   - Modèle normal (id 1) : bilan actif = tableau 2, bilan passif = 1,
 *     CPC = 6, passage au résultat fiscal = 7, ESG = 32.
 *   - Modèle simplifié (id 7) : actif = 61, passif = 65, CPC = 78, passage
 *     = 7 et ESG = 32 (mêmes codes que le modèle normal pour ces deux-là).
 * Les autres tableaux de la liasse (immobilisations, amortissements,
 * provisions, TVA…) se complètent sur le portail, où le fichier déposé
 * devient une liasse brouillon.
 *
 * Colonnes : actif = brut, amortissements et provisions, net, net N−1 ;
 * passif = N, N−1 ; CPC = opérations propres à l'exercice, opérations des
 * exercices précédents, total N, total N−1 (Kalum ne sépare pas les
 * opérations des exercices précédents : la 2e colonne reste à zéro).
 */
import type { LiasseModel } from './liasse.rules.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const LIASSE_MODEL_ID: Record<LiasseModel, number> = { normal: 1, simplifie: 7 };

/* ─── Modèle normal ───────────────────────────────────────────────── */

/** Bilan actif (tableau 2) : rubrique liasse.rules → [brut, amort., net, net N−1]. */
const ACTIF_N: Record<string, [number, number, number, number][]> = {
  A: [[497, 498, 499, 500]], A1: [[238, 241, 244, 247]], A2: [[239, 242, 245, 248]], A3: [[240, 243, 246, 249]],
  B: [[502, 503, 504, 505]], B1: [[274, 278, 282, 286]], B2: [[275, 279, 283, 287]], B3: [[276, 280, 284, 288]], B4: [[277, 281, 285, 289]],
  C: [[507, 508, 509, 510]], C1: [[207, 214, 221, 228]], C2: [[208, 215, 222, 229]], C3: [[209, 216, 223, 230]], C4: [[210, 217, 224, 231]],
  C5: [[211, 218, 225, 232]], C6: [[212, 219, 226, 233]], C7: [[213, 220, 227, 234]],
  D: [[512, 513, 514, 515]], D1: [[254, 258, 262, 266]], D2: [[255, 259, 263, 267]], D3: [[256, 260, 264, 268]], D4: [[257, 261, 265, 269]],
  E: [[517, 518, 519, 520]], E1: [[192, 194, 196, 198]], E2: [[193, 195, 197, 199]],
  T1: [[291, 292, 293, 294]],
  F: [[522, 523, 524, 525]], F1: [[160, 165, 170, 175]], F2: [[161, 166, 171, 176]], F3: [[162, 167, 172, 177]], F4: [[163, 168, 173, 178]], F5: [[164, 169, 174, 179]],
  G: [[527, 528, 529, 530]], G1: [[122, 129, 136, 143]], G2: [[123, 130, 137, 144]], G3: [[124, 131, 138, 145]], G4: [[125, 132, 139, 146]],
  G5: [[126, 133, 140, 147]], G6: [[127, 134, 141, 148]], G7: [[128, 135, 142, 149]],
  H: [[181, 182, 183, 184]], I: [[151, 152, 153, 154]],
  T2: [[296, 297, 298, 299]],
  J1: [[303, 306, 309, 312]], J2: [[304, 307, 310, 313]], J3: [[305, 308, 311, 314]],
  // « Trésorerie-Actif » et « TOTAL III » portent le même montant.
  T3: [[532, 533, 534, 535], [316, 317, 318, 319]],
  TG: [[186, 187, 188, 189]],
};

/** Bilan passif (tableau 1) : rubrique → [N, N−1]. */
const PASSIF_N: Record<string, [number, number]> = {
  K1: [13400, 13411], K2: [13404, 13415], K3: [13405, 13416], K4: [13406, 13417], K5: [13407, 13418],
  K6: [13408, 13419], K7: [14001, 14002], K8: [13409, 13420], K: [13410, 13421],
  L: [13397, 13422], L1: [13398, 13423], L2: [13399, 13424],
  M: [13393, 13426], M1: [13394, 13427], M2: [13395, 13428],
  N: [13389, 13430], N1: [13390, 13431], N2: [13391, 13432],
  O: [13386, 13433], O1: [13387, 13434], O2: [13388, 13435],
  U1: [13385, 13436],
  P: [13376, 13437], P1: [13377, 13438], P2: [13378, 13439], P3: [13379, 13440], P4: [13380, 13441],
  P5: [13381, 13442], P6: [13382, 13443], P7: [13383, 13444], P8: [13384, 13445],
  Q: [13375, 13446], R: [13374, 13447], U2: [13373, 13448],
  S1: [13370, 13449], S2: [13371, 13450], S3: [13372, 13451], U3: [13369, 13452],
  UG: [13368, 13453],
};

/** CPC (tableau 6) : rubrique → [exercice, exercices précédents, total N, total N−1]. */
const CPC_N: Record<string, [number, number, number, number][]> = {
  // Les groupes ont deux cellules : l'en-tête (I. PRODUITS…) et la ligne « Total I ».
  I: [[11176, 11177, 11178, 11179], [11216, 11217, 11218, 11219]],
  I1: [[11181, 11182, 11183, 11184]], I2: [[11186, 11187, 11188, 11189]], I3: [[14021, 14022, 14023, 14024]],
  I4: [[11191, 11192, 11193, 11194]], I5: [[11196, 11197, 11198, 11199]], I6: [[11201, 11202, 11203, 11204]],
  I7: [[11206, 11207, 11208, 11209]], I8: [[11211, 11212, 11213, 11214]],
  II: [[11226, 11227, 11228, 11229], [11236, 11237, 11238, 11239]],
  II1: [[11221, 11222, 11223, 11224]], II2: [[11256, 11257, 11258, 11259]], II3: [[11261, 11262, 11263, 11264]],
  II4: [[11251, 11252, 11253, 11254]], II5: [[11266, 11267, 11268, 11269]], II6: [[11246, 11247, 11248, 11249]],
  II7: [[11241, 11242, 11243, 11244]],
  III: [[11231, 11232, 11233, 11234]],
  IV: [[11326, 11327, 11328, 11329], [11291, 11292, 11293, 11294]],
  IV1: [[11271, 11272, 11273, 11274]], IV2: [[11276, 11277, 11278, 11279]], IV3: [[11281, 11282, 11283, 11284]], IV4: [[11286, 11287, 11288, 11289]],
  V: [[11321, 11322, 11323, 11324], [11316, 11317, 11318, 11319]],
  V1: [[11296, 11297, 11298, 11299]], V2: [[11301, 11302, 11303, 11304]], V3: [[11306, 11307, 11308, 11309]], V4: [[11311, 11312, 11313, 11314]],
  VI: [[11331, 11332, 11333, 11334]],
  VII: [[11336, 11337, 11338, 11339]],
  VIII: [[11391, 11392, 11393, 11394], [11366, 11367, 11368, 11369]],
  VIII1: [[11341, 11342, 11343, 11344]], VIII2: [[11346, 11347, 11348, 11349]], VIII3: [[11351, 11352, 11353, 11354]],
  VIII4: [[11356, 11357, 11358, 11359]], VIII5: [[11361, 11362, 11363, 11364]],
  IX: [[11396, 11397, 11398, 11399], [11406, 11407, 11408, 11409]],
  IX1: [[11371, 11372, 11373, 11374]], IX2: [[11376, 11377, 11378, 11379]], IX3: [[11381, 11382, 11383, 11384]], IX4: [[11386, 11387, 11388, 11389]],
  X: [[11401, 11402, 11403, 11404]],
  XI: [[11411, 11412, 11413, 11414]],
  XII: [[11416, 11417, 11418, 11419]],
  XIII: [[11421, 11422, 11423, 11424]],
  XIV: [[11426, 11427, 11428, 11429]],
  XV: [[11431, 11432, 11433, 11434]],
  XVI: [[11436, 11437, 11438, 11439]],
};

/* ─── ESG (tableau 32, communs aux deux modèles) ─────────────────── */

const TFR: Record<string, [number, number]> = {
  '1': [1308, 1333], '2': [1309, 1334], I: [1310, 1335], II: [1311, 1336], '3': [1312, 1337], '4': [1313, 1338], '5': [1314, 1339],
  III: [1315, 1340], '6': [1316, 1341], '7': [1317, 1342], IV: [1318, 1343], '8': [1319, 1344], '9': [1320, 1345], '10': [1321, 1346],
  V: [4063, 4064], '11': [4066, 4067], '12': [1324, 1349], '13': [1325, 1350], '14': [1326, 1351], VI: [1327, 1352],
  VII: [1328, 1353], VIII: [1329, 1354], IX: [1330, 1355], '15': [1331, 1356], X: [1332, 1357],
};
const CAF: Record<string, [number, number]> = {
  '1': [1372, 1386], '2': [1375, 1389], '3': [1376, 1390], '4': [1377, 1391], '5': [1378, 1392], '6': [1379, 1393],
  '7': [1380, 1394], '8': [1381, 1395], '9': [1382, 1396], I: [1383, 1397], '10': [1384, 1398], II: [1385, 1399],
};
const CAF_PROFIT: [number, number] = [1373, 1387];
const CAF_LOSS: [number, number] = [1374, 1388];

/* ─── Modèle simplifié ────────────────────────────────────────────── */

/** Bilan actif simplifié (tableau 61) : cellule → rubriques liasse.rules additionnées. */
const ACTIF_S: { codes: [number, number, number, number]; ids: string[] }[] = [
  { codes: [4562, 4563, 4564, 4565], ids: ['A'] },
  { codes: [4567, 4568, 4569, 4570], ids: ['B'] },
  { codes: [4572, 4573, 4574, 4575], ids: ['B3'] },
  { codes: [4577, 4578, 4579, 4580], ids: ['B1', 'B2', 'B4'] },
  { codes: [4582, 4583, 4584, 4585], ids: ['C'] },
  { codes: [4587, 4588, 4589, 4590], ids: ['C1'] },
  { codes: [4592, 4593, 4594, 4595], ids: ['C2'] },
  { codes: [4597, 4598, 4599, 4600], ids: ['C3'] },
  { codes: [4602, 4603, 4604, 4605], ids: ['C4'] },
  { codes: [4607, 4608, 4609, 4610], ids: ['C5', 'C6', 'C7'] },
  { codes: [4612, 4613, 4614, 4615], ids: ['D'] },
  // Le modèle simplifié n'a pas d'écarts de conversion : ils restent dans les totaux (contrôle).
  { codes: [4617, 4618, 4619, 4620], ids: ['T1'] },
  { codes: [4622, 4623, 4624, 4625], ids: ['F'] },
  { codes: [4627, 4628, 4629, 4630], ids: ['F1'] },
  { codes: [4632, 4633, 4634, 4635], ids: ['F2', 'F3', 'F4', 'F5'] },
  { codes: [4637, 4638, 4639, 4640], ids: ['G'] },
  // Fournisseurs débiteurs, État et personnel (11501-11514) : présents dans la
  // codification 2026 et l'exemple officiel 2023, absents du XSD publié (2017).
  { codes: [11501, 11502, 11503, 11504], ids: ['G1'] },
  { codes: [4642, 4643, 4644, 4645], ids: ['G2'] },
  { codes: [11506, 11507, 11508, 11509], ids: ['G4'] },
  { codes: [11511, 11512, 11513, 11514], ids: ['G3'] },
  { codes: [4647, 4648, 4649, 4650], ids: ['G5'] },
  { codes: [4652, 4653, 4654, 4655], ids: ['G6'] },
  { codes: [4657, 4658, 4659, 4660], ids: ['G7'] },
  { codes: [4662, 4663, 4664, 4665], ids: ['H'] },
  { codes: [4667, 4668, 4669, 4670], ids: ['T2'] },
  { codes: [4672, 4673, 4674, 4675], ids: ['T3'] },
  { codes: [4677, 4678, 4679, 4680], ids: ['J1'] },
  { codes: [4682, 4683, 4684, 4685], ids: ['J2'] },
  { codes: [4687, 4688, 4689, 4690], ids: ['J3'] },
  { codes: [4692, 4693, 4694, 4695], ids: ['T3'] },
  { codes: [4697, 4698, 4699, 4700], ids: ['TG'] },
];

/** Bilan passif simplifié (tableau 65). */
const PASSIF_S: { codes: [number, number]; ids: string[] }[] = [
  { codes: [12110, 12111], ids: ['K'] },
  { codes: [5223, 5235], ids: ['K1'] },
  { codes: [5225, 5237], ids: ['K2'] },
  { codes: [5226, 5238], ids: ['K3'] },
  { codes: [5227, 5239], ids: ['K4', 'K5'] },
  { codes: [5228, 5240], ids: ['K6', 'K7'] },
  { codes: [5229, 5241], ids: ['K8'] },
  { codes: [5230, 5242], ids: ['K'] },
  { codes: [5231, 5243], ids: ['L'] },
  { codes: [5232, 5244], ids: ['M'] },
  { codes: [5233, 5245], ids: ['N'] },
  { codes: [5234, 5246], ids: ['U1'] },
  { codes: [5254, 5261], ids: ['P'] },
  { codes: [12113, 12114], ids: ['P2'] },
  { codes: [12116, 12117], ids: ['P5'] },
  { codes: [12119, 12120], ids: ['P3'] },
  { codes: [5255, 5262], ids: ['P1'] },
  { codes: [5256, 5263], ids: ['P6'] },
  { codes: [5257, 5264], ids: ['P4', 'P7'] },
  { codes: [5258, 5265], ids: ['P8'] },
  { codes: [5259, 5266], ids: ['Q'] },
  { codes: [5260, 5267], ids: ['U2'] },
  { codes: [5273, 5278], ids: ['U3'] },
  { codes: [5274, 5279], ids: ['S1', 'S2'] },
  { codes: [5275, 5280], ids: ['S3'] },
  { codes: [5276, 5281], ids: ['U3'] },
  { codes: [5277, 5282], ids: ['UG'] },
];

/** CPC simplifié (tableau 78) : produits et charges financiers dans les éléments courants. */
const CPC_S: { codes: [number, number, number, number]; ids: string[]; sign?: Record<string, -1> }[] = [
  { codes: [12086, 12087, 12088, 12089], ids: ['I', 'IV'] },
  { codes: [5309, 5360, 5369, 5378], ids: ['I1'] },
  { codes: [5310, 5361, 5370, 5379], ids: ['I2'] },
  { codes: [17909, 17910, 17911, 17912], ids: ['I3'] },
  { codes: [5311, 5362, 5371, 5380], ids: ['I4'] },
  { codes: [5312, 5363, 5372, 5381], ids: ['I5'] },
  { codes: [5313, 5364, 5373, 5382], ids: ['I6'] },
  { codes: [5314, 5365, 5374, 5383], ids: ['I7'] },
  { codes: [5315, 5366, 5375, 5384], ids: ['I8'] },
  { codes: [5316, 5367, 5376, 5385], ids: ['IV'] },
  { codes: [5317, 5368, 5377, 5386], ids: ['I', 'IV'] },
  { codes: [12091, 12092, 12093, 12094], ids: ['II', 'V'] },
  { codes: [5327, 5387, 5396, 5405], ids: ['II1'] },
  { codes: [5328, 5388, 5397, 5406], ids: ['II2'] },
  { codes: [5329, 5389, 5398, 5407], ids: ['II3'] },
  { codes: [5330, 5390, 5399, 5408], ids: ['II4'] },
  { codes: [5331, 5391, 5400, 5409], ids: ['II5'] },
  { codes: [5332, 5392, 5401, 5410], ids: ['II6'] },
  { codes: [5333, 5393, 5402, 5411], ids: ['II7'] },
  { codes: [5334, 5394, 5403, 5412], ids: ['V'] },
  { codes: [5335, 5395, 5404, 5413], ids: ['II', 'V'] },
  { codes: [5337, 5414, 5415, 5416], ids: ['VII'] },
  { codes: [5340, 5417, 5419, 5421], ids: ['VIII'] },
  { codes: [5341, 5418, 5420, 5422], ids: ['IX'] },
  { codes: [5343, 5423, 5424, 5425], ids: ['X'] },
  { codes: [5345, 5426, 5427, 5428], ids: ['XI'] },
  { codes: [5347, 5431, 5432, 5433], ids: ['XII'] },
  { codes: [5349, 5434, 5435, 5436], ids: ['XIII'] },
  { codes: [5351, 5437, 5438, 5439], ids: ['XIV'] },
  { codes: [5353, 5440, 5441, 5442], ids: ['XV'] },
  { codes: [5355, 5443, 5444, 5445], ids: ['XVI'] },
  { codes: [5357, 5446, 5447, 5448], ids: ['I1', 'II1'], sign: { II1: -1 } },
  { codes: [5359, 5449, 5450, 5451], ids: ['I1', 'I2', 'I4', 'I5', 'II1', 'II2', 'II3'], sign: { II1: -1, II2: -1, II3: -1 } },
];

/* ─── Valeurs ─────────────────────────────────────────────────────── */

/** Ce que la liasse calculée (liasse.repository, modèle normal) fournit. */
export type LiasseValues = {
  actif: { id: string; gross: number; amort: number; net: number; previous_net: number }[];
  passif: { id: string; amount: number; previous: number }[];
  cpc: { id: string; amount: number; previous: number }[];
  tfr: { id: string; amount: number; previous: number }[];
  caf: { id: string; amount: number; previous: number }[];
  passage: { net_result: number; reintegrations: { label: string; amount: number }[]; deductions: { label: string; amount: number }[]; taxable_result: number };
};
export type EdiCell = { code: number; value: string; line?: number };
export type EdiTable = { id: number; label: string; cells: EdiCell[] };

const num = (n: number) => r2(n).toFixed(2);

function byId<T extends { id: string }>(rows: T[]) {
  const m = new Map(rows.map(r => [r.id, r]));
  return (id: string) => {
    const r = m.get(id);
    if (!r) throw new Error(`Rubrique ${id} absente de la liasse`);
    return r;
  };
}

/** Passage au résultat fiscal (tableau 7) : lignes libres numérotées pour les retraitements. */
function passageCells(p: LiasseValues['passage']): EdiCell[] {
  const cells: EdiCell[] = [];
  const reint = r2(p.reintegrations.reduce((s, x) => s + x.amount, 0));
  const deduc = r2(p.deductions.reduce((s, x) => s + x.amount, 0));
  const profit = p.net_result >= 0 ? r2(p.net_result) : 0, loss = p.net_result < 0 ? r2(-p.net_result) : 0;
  cells.push({ code: 817, value: num(profit) }, { code: 820, value: num(loss) });
  cells.push({ code: 18009, value: num(reint) });
  // Réintégrations et déductions sans nature fiscale distincte dans Kalum : rangées en « courantes ».
  p.reintegrations.forEach((x, i) => cells.push(
    { code: 821, value: x.label, line: i + 1 }, { code: 822, value: num(x.amount), line: i + 1 }));
  cells.push({ code: 18012, value: num(deduc) });
  p.deductions.forEach((x, i) => cells.push(
    { code: 827, value: x.label, line: i + 1 }, { code: 830, value: num(x.amount), line: i + 1 }));
  const t1 = r2(profit + reint), t2 = r2(loss + deduc);
  cells.push({ code: 833, value: num(t1) }, { code: 834, value: num(t2) });
  if (t1 >= t2) cells.push({ code: 837, value: num(t1 - t2) });
  else cells.push({ code: 840, value: num(t2 - t1) });
  // Pas de reports déficitaires suivis dans Kalum : résultat net fiscal = résultat brut fiscal.
  if (t1 >= t2) cells.push({ code: 6872, value: num(t1 - t2) });
  else cells.push({ code: 6875, value: num(t2 - t1) });
  return cells;
}

function esgCells(l: LiasseValues): EdiCell[] {
  const tfr = byId(l.tfr), caf = byId(l.caf);
  const cells: EdiCell[] = [];
  for (const [id, [n, p]] of Object.entries(TFR)) cells.push({ code: n, value: num(tfr(id).amount) }, { code: p, value: num(tfr(id).previous) });
  for (const [id, [n, p]] of Object.entries(CAF)) cells.push({ code: n, value: num(caf(id).amount) }, { code: p, value: num(caf(id).previous) });
  const net = caf('1');
  cells.push(
    { code: CAF_PROFIT[0], value: num(Math.max(net.amount, 0)) }, { code: CAF_PROFIT[1], value: num(Math.max(net.previous, 0)) },
    { code: CAF_LOSS[0], value: num(Math.max(-net.amount, 0)) }, { code: CAF_LOSS[1], value: num(Math.max(-net.previous, 0)) },
  );
  return cells;
}

/** Tableaux EDI de la liasse IS pour un modèle, depuis la liasse calculée en modèle normal. */
export function liasseEdiTables(l: LiasseValues, model: LiasseModel): EdiTable[] {
  const act = byId(l.actif), pas = byId(l.passif), cpc = byId(l.cpc);
  const tables: EdiTable[] = [];
  if (model === 'normal') {
    const a: EdiCell[] = [];
    for (const [id, rows] of Object.entries(ACTIF_N)) {
      const v = act(id);
      for (const [b, am, n, p] of rows) a.push({ code: b, value: num(v.gross) }, { code: am, value: num(v.amort) }, { code: n, value: num(v.net) }, { code: p, value: num(v.previous_net) });
    }
    const p: EdiCell[] = [];
    for (const [id, [n, n1]] of Object.entries(PASSIF_N)) p.push({ code: n, value: num(pas(id).amount) }, { code: n1, value: num(pas(id).previous) });
    const c: EdiCell[] = [];
    for (const [id, rows] of Object.entries(CPC_N)) {
      const v = cpc(id);
      for (const [own, prior, tot, prev] of rows) c.push({ code: own, value: num(v.amount) }, { code: prior, value: num(0) }, { code: tot, value: num(v.amount) }, { code: prev, value: num(v.previous) });
    }
    tables.push({ id: 2, label: 'Bilan (actif)', cells: a }, { id: 1, label: 'Bilan (passif)', cells: p }, { id: 6, label: 'Compte de produits et charges', cells: c });
  } else {
    const sumA = (ids: string[], f: 'gross' | 'amort' | 'net' | 'previous_net') => r2(ids.reduce((s, id) => s + act(id)[f], 0));
    const a: EdiCell[] = ACTIF_S.flatMap(({ codes: [b, am, n, p], ids }) => [
      { code: b, value: num(sumA(ids, 'gross')) }, { code: am, value: num(sumA(ids, 'amort')) },
      { code: n, value: num(sumA(ids, 'net')) }, { code: p, value: num(sumA(ids, 'previous_net')) },
    ]);
    const sumP = (ids: string[], f: 'amount' | 'previous') => r2(ids.reduce((s, id) => s + pas(id)[f], 0));
    const p: EdiCell[] = PASSIF_S.flatMap(({ codes: [n, n1], ids }) => [{ code: n, value: num(sumP(ids, 'amount')) }, { code: n1, value: num(sumP(ids, 'previous')) }]);
    const sumC = (ids: string[], sign: Record<string, -1> | undefined, f: 'amount' | 'previous') => r2(ids.reduce((s, id) => s + (sign?.[id] ?? 1) * cpc(id)[f], 0));
    const c: EdiCell[] = CPC_S.flatMap(({ codes: [own, prior, tot, prev], ids, sign }) => [
      { code: own, value: num(sumC(ids, sign, 'amount')) }, { code: prior, value: num(0) },
      { code: tot, value: num(sumC(ids, sign, 'amount')) }, { code: prev, value: num(sumC(ids, sign, 'previous')) },
    ]);
    tables.push({ id: 61, label: 'Bilan (actif)', cells: a }, { id: 65, label: 'Bilan (passif)', cells: p }, { id: 78, label: 'Compte de produits et charges', cells: c });
  }
  tables.push({ id: 7, label: 'Passage du résultat net comptable au résultat net fiscal', cells: passageCells(l.passage) });
  tables.push({ id: 32, label: 'État des soldes de gestion', cells: esgCells(l) });
  return tables;
}

/** Montants que le modèle simplifié ne sait pas porter (écarts de conversion). */
export function simplifiedGaps(l: LiasseValues) {
  const act = byId(l.actif), pas = byId(l.passif);
  return [
    { id: 'E', label: 'Écarts de conversion — actif (immobilisé)', amount: act('E').net },
    { id: 'I', label: 'Écarts de conversion — actif (circulant)', amount: act('I').net },
    { id: 'O', label: 'Écarts de conversion — passif (durable)', amount: pas('O').amount },
    { id: 'R', label: 'Écarts de conversion — passif (circulant)', amount: pas('R').amount },
  ].filter(g => Math.abs(g.amount) >= 0.005);
}
