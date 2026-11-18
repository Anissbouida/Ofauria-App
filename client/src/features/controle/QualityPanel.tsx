import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus } from 'lucide-react';
import { qualityApi, type InspectionLinks, type QualityItem } from '../../api/quality.api';
import { StatusTag } from '../../components/ui/StatusTag';
import { InspectionForm } from './QualityTab';

/**
 * Onglet « Qualité » d'une fiche (M7-01) : inspections rattachées à l'ordre, au lot ou à
 * la réception ; les inspections « à faire » (plan de contrôle, M7-02) se réalisent ici.
 */
type Row = Awaited<ReturnType<typeof qualityApi.inspections>>[number] & { pending_items?: QualityItem[] | null };

export default function QualityPanel({ filter, links, title, canInspect = true }: {
  filter: InspectionLinks; links: InspectionLinks; title: string; canInspect?: boolean;
}) {
  const qc = useQueryClient();
  const key = ['quality', 'inspections', filter];
  const { data = [] } = useQuery({ queryKey: key, queryFn: () => qualityApi.inspections(undefined, filter) as Promise<Row[]> });
  const [form, setForm] = useState<{ pendingId?: string; items?: QualityItem[] | null; title?: string } | null>(null);
  const day = (d: string) => d.slice(0, 10).split('-').reverse().join('/');

  return (
    <div className="odoo-section" style={{ margin: '1rem' }}>
      <div className="odoo-section-header flex items-center gap-2"><ShieldCheck size={13} /> Qualité
        {canInspect && <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setForm({ title })}><Plus size={12} /> Inspection</button>}
      </div>
      <div style={{ padding: '0.5rem 1rem' }}>
        {data.length === 0 ? <span className="text-xs text-gray-500">Aucune inspection rattachée.</span> : (
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500"><th className="text-left px-2 py-1">Date</th><th className="text-left px-2">Inspection</th><th className="text-left px-2">Par</th><th className="text-left px-2">Résultat</th><th /></tr></thead>
            <tbody>{data.map(r => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="px-2 py-1">{day(r.inspected_on)}</td>
                <td className="px-2">{r.title}<div className="text-gray-500">{r.template_name}</div></td>
                <td className="px-2">{r.inspected_by_name ?? '—'}</td>
                <td className="px-2">
                  {r.status === 'a_faire' ? <StatusTag tone="todo" label="À faire" />
                    : r.conformity ? <StatusTag tone="done" label="Conforme" /> : <StatusTag tone="blocked" label={`Non conforme (${r.failed})`} />}
                </td>
                <td className="px-2 text-right">
                  {r.status === 'a_faire' && canInspect && (
                    <button type="button" className="odoo-btn-secondary" style={{ padding: '0.15rem 0.5rem' }}
                      onClick={() => setForm({ pendingId: r.id, items: r.pending_items ?? null, title: r.title })}>Réaliser</button>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {form && (
        <InspectionForm links={links} defaultTitle={form.title ?? title} pendingId={form.pendingId ?? null} items={form.items ?? null}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); qc.invalidateQueries({ queryKey: ['quality'] }); }} />
      )}
    </div>
  );
}
