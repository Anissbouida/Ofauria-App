import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

/**
 * Tableau piloté par une définition (plan d'exécution multi-industries, étape 10, pas 10a).
 *
 * Les colonnes sont déclarées une fois par l'écran (clé, en-tête, cellule, tri) ; l'ordre et la
 * visibilité viennent de `order` (clés, résolues par la définition d'écran — mig 646). Sans
 * `order`, toutes les colonnes s'affichent dans l'ordre du code : rendu identique à un
 * tableau écrit à la main (classes odoo-table, en-têtes triables ds-sort).
 */
export type DataColumn<R> = {
  key: string;
  header: ReactNode;
  /** Clé de tri ; absente = en-tête simple. */
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  thClassName?: string;
  cell: (row: R) => ReactNode;
  tdClassName?: string;
  tdStyle?: CSSProperties;
  /** Colonne indisponible dans ce contexte (droit, option) : jamais affichée. */
  hidden?: boolean;
};

export function DataTable<R>({ columns, rows, rowKey, order, onRowClick, sort, onSort, actions, actionsLabel = 'Actions', className = 'odoo-table' }: {
  columns: DataColumn<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  /** Clés des colonnes à afficher, dans l'ordre ; absent = toutes, ordre du code. */
  order?: string[];
  onRowClick?: (row: R) => void;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSort?: (key: string) => void;
  /** Dernière colonne d'actions (hors définition : toujours là). */
  actions?: (row: R) => ReactNode;
  actionsLabel?: string;
  className?: string;
}) {
  const available = columns.filter(c => !c.hidden);
  const shown = order
    ? order.map(k => available.find(c => c.key === k)).filter((c): c is DataColumn<R> => !!c)
    : available;
  return (
    <table className={className}>
      <thead>
        <tr>
          {shown.map(c => {
            if (!c.sortKey || !onSort) return <th key={c.key} className={c.thClassName} style={c.align ? { textAlign: c.align } : undefined}>{c.header}</th>;
            const active = sort?.key === c.sortKey;
            return (
              <th key={c.key} className={c.thClassName} style={{ textAlign: c.align ?? 'left' }}
                aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button type="button" className="ds-sort" onClick={() => onSort(c.sortKey!)}>
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    <span className={`odoo-sort-arrow ${active ? 'active' : ''}`}>
                      {active ? (sort?.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
                    </span>
                  </span>
                </button>
              </th>
            );
          })}
          {actions && <th className="ds-actions"><span className="sr-only">{actionsLabel}</span></th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}>
            {shown.map(c => <td key={c.key} className={c.tdClassName} style={c.tdStyle}>{c.cell(r)}</td>)}
            {actions && <td className="ds-actions" onClick={e => e.stopPropagation()}>{actions(r)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
