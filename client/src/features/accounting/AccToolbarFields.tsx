import { Calendar } from 'lucide-react';

/**
 * Filtre de période à dates libres d'une barre d'outils comptable (états : grand livre, balance,
 * CPC, TVA…). Le Design System n'a pas encore de champ « période du … au … » : celui-ci reprend
 * ses classes (`ds-input sm`) et reste propre au module Comptabilité.
 */
export function DateRangeField({ from, to, onFrom, onTo, label = 'Période' }: {
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; label?: string;
}) {
  return (
    <span role="group" aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ds-muted)' }}>
      <Calendar size={14} aria-hidden="true" /> {label}
      <input type="date" aria-label={`${label} : début`} value={from} onChange={e => onFrom(e.target.value)} className="ds-input sm" style={{ width: 150 }} />
      <span aria-hidden="true">→</span>
      <input type="date" aria-label={`${label} : fin`} value={to} onChange={e => onTo(e.target.value)} className="ds-input sm" style={{ width: 150 }} />
    </span>
  );
}

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/** Filtre « mois + année » d'une barre d'outils comptable (caisse, résumé du mois). */
export function MonthYearField({ month, year, onMonth, onYear }: {
  month: number; year: number; onMonth: (m: number) => void; onYear: (y: number) => void;
}) {
  return (
    <span role="group" aria-label="Période" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ds-muted)' }}>
      <Calendar size={14} aria-hidden="true" /> Mois
      <select value={month} onChange={e => onMonth(parseInt(e.target.value, 10))} className="ds-input sm" style={{ width: 'auto' }} aria-label="Mois">
        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <input type="number" value={year} onChange={e => onYear(+e.target.value)} className="ds-input sm" style={{ width: 90 }} aria-label="Année" />
    </span>
  );
}
