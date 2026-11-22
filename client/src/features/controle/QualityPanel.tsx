import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus } from 'lucide-react';
import { qualityApi, type InspectionLinks, type QualityItem } from '../../api/quality.api';
import { StatusTag } from '../../components/ui/StatusTag';
import api from '../../api/client';
import { InspectionForm } from './QualityTab';
import { DataPanel } from '../../components/ds';

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
  // M7-03 : sur un ordre, les relevés de procédé (CCP compris) dans le même écran.
  type Reading = { id: string; at: string; step: string; parametre: string; consigne: number | null; tolerance: number | null; mesure: number; conforme: boolean | null; est_ccp: boolean; by_name: string | null };
  const { data: records } = useQuery({
    queryKey: ['quality', 'records', filter.planId], enabled: !!filter.planId,
    queryFn: () => api.get(`/quality/records/plan/${filter.planId}`).then(r => r.data.data as { readings: Reading[] }),
  });
  const readings = records?.readings ?? [];
  const day = (d: string) => d.slice(0, 10).split('-').reverse().join('/');

  return (
    <div className="odoo-section" style={{ margin: '1rem' }}>
      <div className="odoo-section-header flex items-center gap-2"><ShieldCheck size={13} /> Qualité
        {canInspect && <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setForm({ title })}><Plus size={12} /> Inspection</button>}
      </div>
      <div style={{ padding: '0.5rem 1rem' }}>
        {data.length === 0 ? <span style={{ fontSize: '13px', color: 'var(--ds-muted)' }}>Aucune inspection rattachée.</span> : (
          <DataPanel label="Inspections rattachées">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Date</th><th>Inspection</th><th>Par</th><th>Résultat</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
            <tbody>{data.map(r => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{day(r.inspected_on)}</td>
                <td className="ds-strong">{r.title}<div style={{ fontSize: '12px', fontWeight: 400, color: 'var(--ds-muted)' }}>{r.template_name}</div></td>
                <td>{r.inspected_by_name ?? '—'}</td>
                <td>
                  {r.status === 'a_faire' ? <StatusTag tone="todo" label="À faire" />
                    : r.conformity ? <StatusTag tone="done" label="Conforme" /> : <StatusTag tone="blocked" label={`Non conforme (${r.failed})`} />}
                </td>
                <td className="ds-num">
                  {r.status === 'a_faire' && canInspect && (
                    <button type="button" className="odoo-btn-secondary"
                      onClick={() => setForm({ pendingId: r.id, items: r.pending_items ?? null, title: r.title })}>Réaliser</button>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
          </DataPanel>
        )}
        {readings.length > 0 && (
          <DataPanel label="Relevés de procédé">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Relevé</th><th>Étape</th><th className="ds-num">Mesure</th><th className="ds-num">Consigne</th><th>Résultat</th></tr></thead>
            <tbody>{readings.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500 }}>{r.parametre}{r.est_ccp ? ' · CCP' : ''}<div style={{ fontSize: '12px', fontWeight: 400, color: 'var(--ds-muted)' }}>{new Date(r.at).toLocaleString('fr-FR')}{r.by_name ? ` · ${r.by_name}` : ''}</div></td>
                <td>{r.step}</td>
                <td className="ds-num">{r.mesure}</td>
                <td className="ds-num">{r.consigne != null ? `${r.consigne}${r.tolerance != null ? ` ± ${r.tolerance}` : ''}` : '—'}</td>
                <td>{r.conforme == null ? '—' : r.conforme ? <StatusTag tone="done" label="Conforme" /> : <StatusTag tone="blocked" label="Hors tolérance" />}</td>
              </tr>
            ))}</tbody>
          </table>
          </DataPanel>
        )}
      </div>
      {form && (
        <InspectionForm links={links} defaultTitle={form.title ?? title} pendingId={form.pendingId ?? null} items={form.items ?? null}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); qc.invalidateQueries({ queryKey: ['quality'] }); }} />
      )}
    </div>
  );
}
