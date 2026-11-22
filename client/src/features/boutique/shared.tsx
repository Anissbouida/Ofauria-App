import type { CSSProperties, ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { EmptyState, LoadingState } from '../../components/ds';
import '../controle/KlUi';

/** Briques communes aux onglets de la Journée boutique (style odoo, pas de Tailwind coloré). */

export const n2 = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const n0 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
export const toNum = (v: unknown) => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : 0;
};

/** Champ de saisie dans un tableau : mêmes cotes que `ds-input sm` (jetons du Design System). */
export const inputStyle: CSSProperties = {
  border: '1px solid var(--ds-line)', borderRadius: 6, padding: '0 8px', height: 32,
  fontSize: 14, background: 'var(--ds-card)', color: 'var(--ds-ink)',
};

/** Classe d'un tableau en carte (design Ventes) : prj-panel + défilement horizontal. */
export const tableCard = 'prj-panel prj-scroll';
export const muted: CSSProperties = { fontSize: 12, color: 'var(--ds-muted)' };
/** Intertitre de section (design Ventes) : pas de capitales forcées. */
export const sectionTitle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--theme-text-strong)', margin: '4px 4px 0',
};

export function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0, display: 'inline-block' }} />;
}

export function Loading() {
  return <LoadingState bare />;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan}><EmptyState bare icon={Inbox} title={children} /></td>
    </tr>
  );
}
