import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import api from '../../api/client';
import { SettingsSection } from './SettingsPrimitives';
import { DataPanel, EmptyState, LoadingState } from '../../components/ds';

/** Lot 14 — profils industriels, leurs versions (créées par la base) et la comparaison. */
type ProfileRow = { code: string; label: string; status: string; base_sector: string | null; inherits: boolean; is_custom: boolean; version: number | null; updated_at: string | null; specialties: number; current: boolean };
type VersionRow = { version: number; created_at: string; author: string | null };
type Change = { field: string; kind: 'list' | 'value' | 'label'; added?: string[]; removed?: string[]; before?: unknown; after?: unknown };

const STATUS: Record<string, [string, string]> = { disponible: ['g', 'Disponible'], a_valider: ['o', 'À valider'], nouveau: ['b', 'Nouveau profil'], sur_demande: ['x', 'Sur demande'] };
const show = (v: unknown) => v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'oui' : 'non') : String(v);

export default function ProfileVersionsSection() {
  const profiles = useQuery({ queryKey: ['sector-versions'], queryFn: () => api.get('/settings/sectors/versions').then(r => r.data.data as ProfileRow[]) });
  const [open, setOpen] = useState<string | null>(null);
  const [pair, setPair] = useState<{ from: number; to: number } | null>(null);
  const versions = useQuery({ queryKey: ['sector-versions', open], enabled: !!open, queryFn: () => api.get(`/settings/sectors/${open}/versions`).then(r => r.data.data as VersionRow[]) });
  const compare = useQuery({ queryKey: ['sector-versions', open, pair], enabled: !!open && !!pair,
    queryFn: () => api.get(`/settings/sectors/${open}/versions/compare`, { params: pair }).then(r => r.data.data as { changes: Change[] }) });
  const label = (code: string | null) => profiles.data?.find(p => p.code === code)?.label ?? code ?? 'Socle Kalum';
  const openVersions = (code: string, latest: number | null) => { setOpen(code); setPair(latest && latest > 1 ? { from: latest - 1, to: latest } : null); };

  return <SettingsSection title="Profils industriels" description="Les modèles que l’assistant propose. Un profil hérite d’un autre et n’enregistre que ses différences ; chaque changement crée une version." columns={1}>
    {profiles.isLoading ? <LoadingState /> : !profiles.data?.length ? <EmptyState icon={Layers} bare title="Aucun profil" text="Les profils apparaissent après la mise à niveau de la base." /> :
      <DataPanel label="Profils industriels"><table className="odoo-table"><thead><tr><th>Profil</th><th>Hérite de</th><th className="ds-num">Spécialités</th><th style={{ width: 90 }}>Version</th><th style={{ width: 140 }}>État</th><th className="ds-actions" style={{ width: 130 }}>Action</th></tr></thead><tbody>
        {profiles.data.map(p => { const [tone, text] = STATUS[p.status] ?? ['x', p.status]; return <tr key={p.code}>
          <td className="ds-strong">{p.label}{p.current && <> <span className="kl-tag b">Utilisé</span></>}{p.is_custom && <> <span className="kl-tag x">Personnalisé</span></>}</td>
          <td>{p.inherits && p.base_sector ? label(p.base_sector) : 'Socle Kalum'}</td>
          <td className="ds-num">{p.specialties}</td>
          <td className="ds-ref">{p.version ? `v${p.version}` : '—'}</td>
          <td><span className={`kl-tag ${tone}`}>{text}</span></td>
          <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => open === p.code ? setOpen(null) : openVersions(p.code, p.version)}>{open === p.code ? 'Fermer' : 'Versions'}</button></td></tr>; })}
      </tbody></table></DataPanel>}
    {open && <DataPanel label={`Versions — ${label(open)}`}>
      {versions.isLoading ? <LoadingState /> : <>
        <table className="odoo-table ds-dense"><thead><tr><th style={{ width: 90 }}>Version</th><th>Date</th><th>Auteur</th><th className="ds-actions" style={{ width: 160 }}>Comparer</th></tr></thead><tbody>
          {(versions.data ?? []).map(v => <tr key={v.version}><td className="ds-ref">v{v.version}</td><td>{new Date(v.created_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>{v.author || 'Mise à niveau'}</td>
            <td className="ds-actions">{v.version > 1 && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setPair({ from: v.version - 1, to: v.version })}>avec v{v.version - 1}</button>}</td></tr>)}
        </tbody></table>
        {pair && <div style={{ padding: '12px 16px', display: 'grid', gap: 6 }}>
          <b style={{ color: 'var(--ds-ink)' }}>v{pair.from} → v{pair.to}</b>
          {compare.isLoading ? <LoadingState /> : !compare.data?.changes.length ? <span className="ds-muted">Aucune différence.</span> :
            compare.data.changes.map((c, i) => <div key={i} style={{ fontSize: 13 }}><strong>{c.field}</strong> : {c.kind === 'list'
              ? <>{c.added?.length ? <span style={{ color: 'var(--ds-success)' }}>+ {c.added.join(', ')} </span> : null}{c.removed?.length ? <span style={{ color: 'var(--ds-danger)' }}>− {c.removed.join(', ')}</span> : null}</>
              : <>{show(c.before)} → {show(c.after)}</>}</div>)}
        </div>}
        {!pair && <div className="ds-muted" style={{ padding: '12px 16px', fontSize: 13 }}>Une seule version pour l’instant.</div>}
      </>}
    </DataPanel>}
  </SettingsSection>;
}
