export type HrTab = 'employees' | 'attendance' | 'leaves' | 'payroll' | 'advances' | 'schedule' | 'analytics' | 'me';

export const LEAVE_STATUS_COLORS: Record<string, string> = { pending: 'odoo-tag-yellow', approved: 'odoo-tag-green', rejected: 'odoo-tag-red' };
export const ATTENDANCE_STATUS: { value: string; label: string; color: string }[] = [
  { value: 'present', label: 'Présent', color: 'odoo-tag-green' },
  { value: 'absent', label: 'Absent', color: 'odoo-tag-red' },
  { value: 'late', label: 'Retard', color: 'odoo-tag-yellow' },
  { value: 'half_day', label: 'Demi-journée', color: 'odoo-tag-blue' },
  // Repos hebdomadaire paye (comptabilise comme jour travaille pour la paie).
  { value: 'repos', label: 'Repos', color: 'odoo-tag-purple' },
  // Deux shifts le meme jour : compte 2 jours payes dans la paie.
  { value: 'double', label: 'Double shift', color: 'odoo-tag-orange' },
];
export const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

/**
 * Extrait YYYY-MM-DD d'une date colonne PG sans passer par new Date().
 * pg renvoie DATE comme Date object → JSON donne "YYYY-MM-DDT00:00:00.000Z"
 * → `<input type="date">` n'accepte que "YYYY-MM-DD" pur, sinon affiche vide.
 * Idem pour eviter les shifts timezone +/- 1 jour.
 */
export function isoDate(raw: unknown): string {
  if (!raw) return '';
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

export function syncSalaryFields(form: HTMLFormElement | null) {
  if (!form) return;
  const freq = (form.elements.namedItem('payFrequency') as HTMLSelectElement | null)?.value;
  const monthlyEl = form.elements.namedItem('monthlySalary') as HTMLInputElement | null;
  const weeklyEl = form.elements.namedItem('weeklySalary') as HTMLInputElement | null;
  const monthly = parseFloat(monthlyEl?.value || '');
  if (weeklyEl && freq === 'weekly') {
    weeklyEl.value = monthly > 0 ? (monthly * 12 / 52).toFixed(2) : '';
  }
}

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: 'congé annuel',
  paid: 'congé payé',
  sick: 'congé maladie',
  unpaid: 'congé sans solde',
  maternity: 'congé maternité',
  paternity: 'congé paternité',
  other: 'congé',
};

/** Message d'erreur API lisible (error.message du serveur) ou repli. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const msg = err && typeof err === 'object' && 'response' in err
    ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
    : null;
  return msg || fallback;
}

/** Telecharge une reponse axios `responseType: 'blob'` (nom tire de Content-Disposition). */
export function saveBlobResponse(response: { data: Blob; headers: Record<string, any> }, fallbackName: string) {
  const cd = String(response.headers?.['content-disposition'] ?? '');
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Export CSV (separateur ;, BOM UTF-8 pour Excel). */
export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const cell = (v: string | number | null | undefined) => {
    const t = v === null || v === undefined ? '' : typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v);
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.map(cell).join(';'))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Couleur des shifts sur la palette des etiquettes odoo (meme rendu que les
 * statuts du module Achats), a la place des classes Tailwind du paquet partage.
 */
const SHIFT_TONES = {
  SALES_AM: 'yellow', SALES_PM: 'orange', PROD_EARLY: 'green', PROD_MID: 'blue', NIGHT: 'purple', ADMIN_DAY: 'grey',
} as const;
const TONE_STYLE: Record<string, { background: string; color: string }> = {
  yellow: { background: '#fff3cd', color: '#856404' },
  orange: { background: '#ffe5d0', color: '#b85d1a' },
  green: { background: '#d4edda', color: '#155724' },
  blue: { background: '#d6e9f8', color: '#1f6391' },
  purple: { background: 'var(--theme-accent-light)', color: 'var(--theme-accent)' },
  grey: { background: '#e9ecef', color: '#495057' },
};
/** Classe d'etiquette d'un shift (`odoo-tag ${shiftTag(code)}`). */
export function shiftTag(code: string): string {
  return `odoo-tag-${SHIFT_TONES[code as keyof typeof SHIFT_TONES] ?? 'grey'}`;
}
/** Style de fond/texte d'un shift pour une cellule ou une liste deroulante. */
export function shiftStyle(code: string): { background: string; color: string } {
  return TONE_STYLE[SHIFT_TONES[code as keyof typeof SHIFT_TONES] ?? 'grey'];
}
