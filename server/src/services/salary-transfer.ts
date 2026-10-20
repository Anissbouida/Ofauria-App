/**
 * Ordre de virement groupe des salaires — fonctions PURES.
 *
 * Il n'existe pas de format unique impose aux entreprises par les banques
 * marocaines pour le virement de masse : chaque portail (Attijari, BOA,
 * Banque Populaire, CIH, SGMB...) importe un fichier tabulaire « beneficiaire
 * / RIB 24 chiffres / montant / motif » qu'on mappe a l'import. On produit
 * donc :
 *  - un CSV point-virgule (UTF-8, sans BOM, montant a 2 decimales avec point),
 *    une ligne par salarie, colonnes stables ;
 *  - un ordre de virement PDF (lettre au banquier + liste + total en
 *    lettres) a signer, voir hr-documents-pdf.service.ts.
 *
 * RIB marocain (Bank Al-Maghrib) : 24 chiffres = code banque (3) + code
 * localite (3) + numero de compte (16) + cle (2). La cle verifie
 * RIB complet mod 97 = 0 (cle = 97 - (22 premiers chiffres x 100) mod 97).
 */

export interface TransferLine {
  payrollId: string;
  employeeId: string;
  name: string;
  rib: string | null;
  bankName: string | null;
  amount: number;
}

export interface TransferIssue { name: string; problem: string }

export const normalizeRib = (v: string | null | undefined): string | null => {
  const s = (v ?? '').replace(/[\s-]/g, '');
  return s ? s : null;
};

/** Cle RIB marocaine : les 24 chiffres forment un nombre divisible par 97. */
export function ribKeyValid(rib: string): boolean {
  if (!/^\d{24}$/.test(rib)) return false;
  return BigInt(rib) % 97n === 0n;
}

/** Calcule la cle (2 chiffres) a partir des 22 premiers chiffres. */
export function ribKey(first22: string): string {
  const k = 97n - ((BigInt(first22) * 100n) % 97n);
  return String(k).padStart(2, '0');
}

/** Formate un RIB par blocs (banque, localite, compte, cle) pour l'affichage. */
export const formatRib = (rib: string) =>
  /^\d{24}$/.test(rib) ? `${rib.slice(0, 3)} ${rib.slice(3, 6)} ${rib.slice(6, 22)} ${rib.slice(22)}` : rib;

/**
 * Separe les lignes virables des lignes a corriger (RIB absent, mal forme ou
 * cle fausse, montant nul). Seules les lignes valides entrent dans l'ordre.
 */
export function splitTransferLines(lines: TransferLine[]): { valid: TransferLine[]; issues: TransferIssue[] } {
  const valid: TransferLine[] = [];
  const issues: TransferIssue[] = [];
  for (const l of lines) {
    const rib = normalizeRib(l.rib);
    if (!(l.amount > 0)) issues.push({ name: l.name, problem: 'Net à virer nul' });
    else if (!rib) issues.push({ name: l.name, problem: 'RIB absent sur la fiche' });
    else if (!/^\d{24}$/.test(rib)) issues.push({ name: l.name, problem: 'RIB mal formé (24 chiffres attendus)' });
    else if (!ribKeyValid(rib)) issues.push({ name: l.name, problem: `Clé RIB incorrecte (${formatRib(rib)})` });
    else valid.push({ ...l, rib });
  }
  return { valid, issues };
}

const csvCell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** Nom en majuscules sans accents : les portails bancaires refusent souvent les diacritiques. */
export const bankName = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 '.-]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

/** CSV de l'ordre de virement (une ligne par beneficiaire). */
export function buildTransferCsv(lines: TransferLine[], motif: string): string {
  const head = ['N°', 'Bénéficiaire', 'RIB', 'Banque', 'Montant', 'Motif'];
  const rows = lines.map((l, i) => [
    String(i + 1), bankName(l.name), l.rib ?? '', l.bankName ?? '', l.amount.toFixed(2), motif,
  ].map(csvCell).join(';'));
  return [head.join(';'), ...rows].join('\r\n') + '\r\n';
}
