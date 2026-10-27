import type { CSSProperties, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/** Briques communes aux onglets de la Journée boutique (style odoo, pas de Tailwind coloré). */

export const n2 = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const n0 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
export const toNum = (v: unknown) => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : 0;
};

/** Champ de saisie aligné sur les tableaux odoo (pas de classe globale pour les inputs). */
export const inputStyle: CSSProperties = {
  border: '1px solid var(--odoo-border)', borderRadius: 3, padding: '4px 8px',
  fontSize: '0.8125rem', background: 'var(--odoo-bg)', color: 'var(--odoo-text)',
};

export const tableWrap: CSSProperties = { overflowX: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 };
export const muted: CSSProperties = { fontSize: '0.6875rem', color: 'var(--theme-text-muted)' };
export const sectionTitle: CSSProperties = {
  fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--odoo-text-muted)', margin: '4px 0 0',
};

export function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0, display: 'inline-block' }} />;
}

export function Loading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ textAlign: 'center', padding: '2rem', color: 'var(--theme-text-muted)' }}>{children}</td>
    </tr>
  );
}
