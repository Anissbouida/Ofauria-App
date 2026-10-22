import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, MapPin, Loader2, Building } from 'lucide-react';
import { storesApi } from '../../api/stores.api';
import { usersApi } from '../../api/users.api';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Établissements (audit Paramètres, lot 5, mig 331) : boutiques, laboratoire,
 * entrepôt, siège. Code court (repris dans les rapports), responsable, patente
 * propre à l'établissement et horaires d'ouverture.
 */

const KINDS: [string, string][] = [
  ['shop', 'Boutique'], ['workshop', 'Laboratoire / atelier'], ['warehouse', 'Entrepôt'], ['office', 'Bureau / siège'], ['mixed', 'Boutique et atelier'],
];
const DAYS: [string, string][] = [['mon', 'Lundi'], ['tue', 'Mardi'], ['wed', 'Mercredi'], ['thu', 'Jeudi'], ['fri', 'Vendredi'], ['sat', 'Samedi'], ['sun', 'Dimanche']];
type Day = { closed: boolean; open: string; close: string };
type Hours = Record<string, Day>;
const DEFAULT_HOURS: Hours = Object.fromEntries(DAYS.map(([d]) => [d, { closed: false, open: '07:00', close: '21:00' }]));

type Draft = {
  name: string; code: string; kind: string; city: string; address: string; phone: string; email: string;
  patente: string; managerUserId: string; isHeadquarters: boolean; isActive: boolean; hours: Hours | null;
};

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

/** Résumé lisible des horaires : « Lun-Sam 07:00-21:00 · Dim fermé ». */
function hoursSummary(h: Hours | null | undefined): string {
  if (!h) return '—';
  const parts: string[] = [];
  let start = 0;
  const key = (d: Day | undefined) => (!d || d.closed ? 'fermé' : `${d.open}-${d.close}`);
  for (let i = 1; i <= DAYS.length; i++) {
    if (i === DAYS.length || key(h[DAYS[i][0]]) !== key(h[DAYS[start][0]])) {
      const a = DAYS[start][1].slice(0, 3), b = DAYS[i - 1][1].slice(0, 3);
      parts.push(`${start === i - 1 ? a : `${a}-${b}`} ${key(h[DAYS[start][0]])}`);
      start = i;
    }
  }
  return parts.join(' · ');
}

export default function StoresPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const { data: stores = [], isLoading } = useQuery({ queryKey: ['stores'], queryFn: storesApi.list });
  // Liste des comptes (administrateur) pour le responsable ; champ masqué si indisponible.
  const { data: users = [] } = useQuery<Record<string, any>[]>({ queryKey: ['users'], queryFn: usersApi.list, retry: false });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['stores'] });
  const save = useMutation({
    mutationFn: () => {
      const d = editing!.draft;
      const data = {
        name: d.name, code: d.code || null, kind: d.kind, city: d.city || null, address: d.address || null,
        phone: d.phone || null, email: d.email || null, patente: d.patente || null,
        managerUserId: d.managerUserId || null, isHeadquarters: d.isHeadquarters, isActive: d.isActive, openingHours: d.hours,
      };
      return editing!.id ? storesApi.update(editing!.id, data) : storesApi.create(data);
    },
    onSuccess: () => { invalidate(); notify.success('Établissement enregistré'); setEditing(null); },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => storesApi.remove(id),
    onSuccess: () => { invalidate(); notify.success('Établissement supprimé'); },
    onError: (err) => notify.error(errorMessage(err, 'Suppression refusée : désactivez plutôt l\'établissement')),
  });

  const open = (s?: Record<string, any>) => setEditing({
    id: s?.id ?? null,
    draft: {
      name: s?.name ?? '', code: s?.code ?? '', kind: s?.kind ?? 'shop', city: s?.city ?? '', address: s?.address ?? '',
      phone: s?.phone ?? '', email: s?.email ?? '', patente: s?.patente ?? '', managerUserId: s?.manager_user_id ?? '',
      isHeadquarters: !!s?.is_headquarters, isActive: s ? s.is_active !== false : true, hours: (s?.opening_hours as Hours) ?? null,
    },
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEditing(e => e && { ...e, draft: { ...e.draft, [k]: v } });
  const setDay = (day: string, patch: Partial<Day>) => setEditing(e => e && {
    ...e, draft: { ...e.draft, hours: { ...(e.draft.hours ?? DEFAULT_HOURS), [day]: { ...(e.draft.hours ?? DEFAULT_HOURS)[day], ...patch } } },
  });

  const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' };
  const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {!editing && (
          <button className="odoo-btn-primary" onClick={() => open()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Nouvel établissement
          </button>
        )}
      </div>
      {isLoading ? <Loader2 className="animate-spin" size={16} /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Établissement</th><th>Type</th><th>Adresse</th><th>Responsable</th><th>Horaires</th><th>Personnel</th><th>Statut</th><th style={{ width: 80 }}></th></tr></thead>
            <tbody>
              {stores.map((s: Record<string, any>) => (
                <tr key={s.id} style={{ opacity: s.is_active === false ? 0.6 : 1 }}>
                  <td>
                    <strong>{s.name}</strong>{s.code && <span style={{ marginLeft: 6, fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{s.code}</span>}
                    {s.is_headquarters && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6 }}>Siège</span>}
                  </td>
                  <td>{KINDS.find(k => k[0] === s.kind)?.[1] ?? 'Boutique'}</td>
                  <td>{[s.address, s.city].filter(Boolean).join(', ') || '—'}</td>
                  <td>{s.manager_name || '—'}</td>
                  <td style={{ fontSize: '0.8125rem' }}>{hoursSummary(s.opening_hours)}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.user_count}</td>
                  <td><span className={`odoo-tag ${s.is_active === false ? 'odoo-tag-grey' : 'odoo-tag-green'}`}>{s.is_active === false ? 'Fermé' : 'Ouvert'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => open(s)} aria-label={`Modifier ${s.name}`}><Pencil size={13} /></button>
                    {Number(s.user_count) === 0 && (
                      <button className="odoo-btn-secondary" style={{ padding: '2px 8px', marginLeft: 4 }} aria-label={`Supprimer ${s.name}`}
                        onClick={async () => { if (await confirm(`Supprimer l'établissement « ${s.name} » ?`, { danger: true, confirmLabel: 'Supprimer' })) remove.mutate(s.id); }}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!stores.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--odoo-text-muted)' }}><Building size={14} /> Aucun établissement</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg-alt)' }}>
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={14} /> {editing.id ? 'Modifier l\'établissement' : 'Nouvel établissement'}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ ...lab, flex: '2 1 200px' }}>Nom
              <input id="store-name" style={field} value={editing.draft.name} onChange={e => set('name', e.target.value)} maxLength={100} />
            </label>
            <label style={{ ...lab, width: 110 }}>Code
              <input id="store-code" style={{ ...field, textTransform: 'uppercase' }} value={editing.draft.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="MOH1" maxLength={10} />
            </label>
            <label style={{ ...lab, width: 210 }}>Type
              <select id="store-kind" style={field} value={editing.draft.kind} onChange={e => set('kind', e.target.value)}>
                {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ ...lab, flex: '2 1 240px' }}>Adresse
              <input id="store-address" style={field} value={editing.draft.address} onChange={e => set('address', e.target.value)} maxLength={300} />
            </label>
            <label style={{ ...lab, flex: '1 1 140px' }}>Ville
              <input id="store-city" style={field} value={editing.draft.city} onChange={e => set('city', e.target.value)} maxLength={100} />
            </label>
            <label style={{ ...lab, width: 160 }}>Téléphone
              <input id="store-phone" style={field} value={editing.draft.phone} onChange={e => set('phone', e.target.value)} maxLength={40} />
            </label>
            <label style={{ ...lab, flex: '1 1 200px' }}>E-mail
              <input id="store-email" type="email" style={field} value={editing.draft.email} onChange={e => set('email', e.target.value)} maxLength={120} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ ...lab, width: 180 }}>Patente de l'établissement
              <input id="store-patente" style={field} value={editing.draft.patente} onChange={e => set('patente', e.target.value)} inputMode="numeric" maxLength={15} />
            </label>
            {users.length > 0 && (
              <label style={{ ...lab, width: 240 }}>Responsable
                <select id="store-manager" style={field} value={editing.draft.managerUserId} onChange={e => set('managerUserId', e.target.value)}>
                  <option value="">—</option>
                  {users.filter(u => u.isActive !== false).map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                </select>
              </label>
            )}
            <label htmlFor="store-hq" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.875rem' }}>
              <input id="store-hq" type="checkbox" checked={editing.draft.isHeadquarters} onChange={e => set('isHeadquarters', e.target.checked)} /> Siège social
            </label>
            <label htmlFor="store-active" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.875rem' }}>
              <input id="store-active" type="checkbox" checked={editing.draft.isActive} onChange={e => set('isActive', e.target.checked)} /> Ouvert
            </label>
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <label htmlFor="store-hours-on" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.875rem' }}>
              <input id="store-hours-on" type="checkbox" checked={editing.draft.hours !== null}
                onChange={e => set('hours', e.target.checked ? DEFAULT_HOURS : null)} /> Horaires d'ouverture
            </label>
            {editing.draft.hours && (
              <table className="odoo-table" style={{ maxWidth: 520 }}>
                <tbody>
                  {DAYS.map(([d, l]) => {
                    const day = editing.draft.hours![d] ?? DEFAULT_HOURS[d];
                    return (
                      <tr key={d}>
                        <td style={{ width: 110 }}>{l}</td>
                        <td style={{ width: 110 }}>
                          <label htmlFor={`h-${d}-closed`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8125rem' }}>
                            <input id={`h-${d}-closed`} type="checkbox" checked={day.closed} onChange={e => setDay(d, { closed: e.target.checked })} /> Fermé
                          </label>
                        </td>
                        <td>
                          {!day.closed && (
                            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <input id={`h-${d}-open`} type="time" style={field} value={day.open} onChange={e => setDay(d, { open: e.target.value })} aria-label={`Ouverture ${l}`} />
                              –
                              <input id={`h-${d}-close`} type="time" style={field} value={day.close} onChange={e => setDay(d, { close: e.target.value })} aria-label={`Fermeture ${l}`} />
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="odoo-btn-secondary" onClick={() => setEditing(null)}>Annuler</button>
            <button className="odoo-btn-primary" disabled={!editing.draft.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
