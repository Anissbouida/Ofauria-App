import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Loader2 } from 'lucide-react';
import api from '../../api/client';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { money } from '../../utils/money';

/**
 * Version de nomenclature (M4-01) : version active et sa date d'effet, modifications de
 * la fiche pas encore activées (avec le détail), activation d'une nouvelle version avec
 * motif, liste des versions et comparaison de deux versions.
 */
type Version = { id: string; version_no: number; status: 'brouillon' | 'active' | 'obsolete'; valid_from: string | null; valid_to: string | null; reason: string | null; unit_cost: number | null; activated_by_name: string | null };
type Diff = { section: string; name: string; before: string | null; after: string | null; change: 'ajout' | 'retrait' | 'quantite' };
const CHANGE = { ajout: 'Ajout', retrait: 'Retrait', quantite: 'Modifié' } as const;
const fr = (d: string | null) => (d ? new Date(`${d}T12:00`).toLocaleDateString('fr-FR') : '—');

function DiffTable({ rows }: { rows: Diff[] }) {
  if (!rows.length) return <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Aucune différence.</div>;
  return (
    <table className="odoo-table" style={{ fontSize: '0.8125rem' }}>
      <thead><tr><th>Partie</th><th>Ligne</th><th>Avant</th><th>Après</th><th>Changement</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i}><td>{r.section}</td><td>{r.name}</td><td>{r.before ?? '—'}</td><td>{r.after ?? '—'}</td><td>{CHANGE[r.change]}</td></tr>
      ))}</tbody>
    </table>
  );
}

export default function BomVersionBanner({ recipeId }: { recipeId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['bom-versions', recipeId], queryFn: () => api.get(`/recipes/${recipeId}/bom-versions`).then(r => r.data.data as { versions: Version[]; pendingChanges: boolean }) });
  const [showPending, setShowPending] = useState(false);
  const [showList, setShowList] = useState(false);
  const [reason, setReason] = useState('');
  const [cmp, setCmp] = useState<{ a: number; b: number } | null>(null);
  const { data: pending } = useQuery({ queryKey: ['bom-pending', recipeId], queryFn: () => api.get(`/recipes/${recipeId}/bom-versions/pending`).then(r => r.data.data as Diff[]), enabled: showPending });
  const { data: diff } = useQuery({ queryKey: ['bom-compare', recipeId, cmp], queryFn: () => api.get(`/recipes/${recipeId}/bom-versions/compare`, { params: cmp! }).then(r => r.data.data as Diff[]), enabled: !!cmp });
  const activate = useMutation({
    mutationFn: () => api.post(`/recipes/${recipeId}/bom-versions/activate`, { reason }).then(r => r.data.data),
    onSuccess: (v: { version_no?: number; pending?: boolean }) => {
      setReason(''); setShowPending(false);
      qc.invalidateQueries({ queryKey: ['bom-versions', recipeId] });
      notify.success(v.pending ? `Version ${v.version_no} soumise à approbation` : `Version ${v.version_no} active`);
    },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  if (!data) return null;
  const active = data.versions.find(v => v.status === 'active');

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <StatusBanner tone={data.pendingChanges ? 'warning' : 'info'} icon={GitBranch}
        title={active ? `Version ${active.version_no} active depuis le ${fr(active.valid_from)}` : 'Aucune version active'}
        actions={<>
          {data.pendingChanges && <button type="button" className="odoo-btn-secondary" onClick={() => setShowPending(v => !v)}>{showPending ? 'Masquer' : 'Voir les modifications'}</button>}
          <button type="button" className="odoo-btn-secondary" onClick={() => setShowList(v => !v)}>Versions ({data.versions.length})</button>
        </>}>
        {data.pendingChanges
          ? 'La fiche a des modifications qui ne sont pas encore une version : les ordres confirmés gardent la version active. Activez une nouvelle version pour les appliquer.'
          : 'La fiche est identique à la version active.'}
      </StatusBanner>

      {showPending && data.pendingChanges && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 10, display: 'grid', gap: 8 }}>
          {pending ? <DiffTable rows={pending} /> : <Loader2 size={14} className="animate-spin" />}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Motif de la nouvelle version" aria-label="Motif de la nouvelle version" style={{ flex: '1 1 260px' }} />
            <button type="button" className="odoo-btn-primary" disabled={reason.trim().length < 3 || activate.isPending} onClick={() => activate.mutate()}>
              Créer la version {(data.versions[0]?.version_no ?? 0) + 1}
            </button>
          </div>
        </div>
      )}

      {showList && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 10, display: 'grid', gap: 8 }}>
          <table className="odoo-table" style={{ fontSize: '0.8125rem' }}>
            <thead><tr><th>Version</th><th>Statut</th><th>Valide du</th><th>au</th><th>Motif</th><th className="ds-num">Coût unitaire</th><th /></tr></thead>
            <tbody>{data.versions.map(v => (
              <tr key={v.id}>
                <td>{v.version_no}</td>
                <td><StatusTag tone={v.status === 'active' ? 'done' : v.status === 'obsolete' ? 'cancelled' : 'draft'} label={v.status === 'active' ? 'Active' : v.status === 'obsolete' ? 'Obsolète' : 'Brouillon'} /></td>
                <td>{fr(v.valid_from)}</td><td>{fr(v.valid_to)}</td><td>{v.reason ?? ''}</td>
                <td className="ds-num">{v.unit_cost != null ? money(v.unit_cost) : '—'}</td>
                <td>{v.version_no > 1 && <button type="button" className="odoo-btn-secondary" onClick={() => setCmp({ a: v.version_no - 1, b: v.version_no })}>Comparer à {v.version_no - 1}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
          {cmp && <><strong style={{ fontSize: '0.8125rem' }}>Version {cmp.a} → {cmp.b}</strong>{diff ? <DiffTable rows={diff} /> : <Loader2 size={14} className="animate-spin" />}</>}
        </div>
      )}
    </div>
  );
}
