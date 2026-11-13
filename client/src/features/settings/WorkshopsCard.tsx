import { useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Factory, Pencil, Plus, X } from 'lucide-react';
import { productionApi, type Workshop } from '../../api/production.api';
import { categoriesApi } from '../../api/categories.api';
import { rolesApi, usersApi } from '../../api/users.api';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { notify } from '../../components/ui/InlineNotification';
import { SettingsSection } from './SettingsPrimitives';

/**
 * Ateliers de production (mig 511, plan Production générique P2).
 *
 * Un atelier fabrique des catégories de produits et réunit des membres (rôles ou
 * utilisateurs). Ses plans, ses demandes boutique et ses notifications vont à ses
 * membres. Remplace l'ancien « atelier = rôle du chef » codé en dur.
 */
type Draft = { code: string; isNew: boolean; label: string; isDefault: boolean; isActive: boolean; sortOrder: number;
  categoryIds: number[]; memberRoles: string[]; memberUsers: string[] };

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'a_$1').slice(0, 30);

export default function WorkshopsCard() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const { data } = useQuery({ queryKey: ['production-workshops'], queryFn: productionApi.workshops });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const { data: roleRows = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const { data: userRows = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const workshops = data?.workshops ?? [];
  const cats = categories as { id: number; name: string }[];
  const users = (userRows as { id: string; firstName: string; lastName: string; isActive?: boolean }[]).filter(u => u.isActive !== false);
  const roleLabel = (code: string) => roleRows.find(r => r.code === code)?.label ?? code;
  const ownerOf = (catId: number) => workshops.find(w => w.categoryIds.includes(catId));

  const save = useMutation({
    mutationFn: (d: Draft) => productionApi.saveWorkshop(d.code, {
      label: d.label.trim(), workCenterId: null, isDefault: d.isDefault, isActive: d.isActive, sortOrder: d.sortOrder,
      categoryIds: d.categoryIds, memberRoles: d.memberRoles, memberUsers: d.memberUsers,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-workshops'] });
      setDraft(null);
      notify.success('Atelier enregistré');
    },
    onError: (e: unknown) => notify.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Enregistrement impossible'),
  });

  const open = (w?: Workshop) => setDraft(w
    ? { code: w.code, isNew: false, label: w.label, isDefault: w.isDefault, isActive: w.isActive, sortOrder: w.sortOrder,
        categoryIds: [...w.categoryIds], memberRoles: [...w.memberRoles], memberUsers: [...w.memberUsers] }
    : { code: '', isNew: true, label: '', isDefault: false, isActive: true, sortOrder: (workshops.length + 1) * 10,
        categoryIds: [], memberRoles: [], memberUsers: [] });

  const toggle = <K extends 'categoryIds' | 'memberRoles' | 'memberUsers'>(key: K, value: Draft[K][number]) =>
    setDraft(d => {
      if (!d) return d;
      const list = d[key] as (typeof value)[];
      return { ...d, [key]: list.includes(value) ? list.filter(x => x !== value) : [...list, value] };
    });

  const box: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', cursor: 'pointer' };
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6, maxHeight: 200, overflowY: 'auto' };
  const field: CSSProperties = { width: '100%', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.875rem' };
  const codeValid = !draft || /^[a-z][a-z0-9_]{1,29}$/.test(draft.code);

  return (
    <SettingsSection title="Ateliers" columns={1}
      description="Un atelier fabrique des catégories de produits et réunit ses membres (rôles ou utilisateurs). Ses plans de production, ses demandes boutique et ses notifications vont à ses membres.">
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="odoo-btn-primary" onClick={() => open()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Nouvel atelier
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Atelier</th><th>Catégories fabriquées</th><th>Membres</th><th>Statut</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {workshops.map(w => (
                <tr key={w.code} style={{ opacity: w.isActive ? 1 : 0.6 }}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}><Factory size={13} /> {w.label}</span>
                    {w.isDefault && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6 }}>Par défaut</span>}
                  </td>
                  <td>{w.categoryIds.length ? `${w.categoryIds.length} catégorie(s)` : '—'}</td>
                  <td>{[...w.memberRoles.map(roleLabel), ...(w.memberUsers.length ? [`${w.memberUsers.length} utilisateur(s)`] : [])].join(', ') || '—'}</td>
                  <td><span className={`odoo-tag ${w.isActive ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{w.isActive ? 'Actif' : 'Inactif'}</span></td>
                  <td><button type="button" className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => open(w)} aria-label={`Modifier ${w.label}`}><Pencil size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {draft && (
        <ModalBackdrop onClose={() => setDraft(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="odoo-scope" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--odoo-bg)', borderRadius: 6, border: '1px solid var(--odoo-border)', width: '100%', maxWidth: 680, margin: '0 16px', display: 'grid', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
              <div style={{ fontWeight: 600 }}>{draft.isNew ? 'Nouvel atelier' : `Atelier — ${draft.label}`}</div>
              <button type="button" onClick={() => setDraft(null)} aria-label="Fermer" style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--odoo-text-muted)' }}><X size={16} /></button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ flex: '2 1 220px', display: 'grid', gap: 4, fontSize: '0.8125rem' }}>Libellé
                  <input style={field} value={draft.label} autoFocus
                    onChange={e => setDraft({ ...draft, label: e.target.value, code: draft.isNew ? slugify(e.target.value) : draft.code })} />
                </label>
                <label style={{ flex: '1 1 160px', display: 'grid', gap: 4, fontSize: '0.8125rem' }}>Code
                  <input style={{ ...field, fontFamily: 'ui-monospace, monospace' }} value={draft.code} disabled={!draft.isNew}
                    onChange={e => setDraft({ ...draft, code: e.target.value })} />
                </label>
              </div>
              {!codeValid && <p className="odoo-setting-help" style={{ color: '#c0392b' }}>Code : minuscules, chiffres et « _ », 2 à 30 caractères, commence par une lettre.</p>}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <label style={box}><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} /> Actif</label>
                <label style={box}><input type="checkbox" checked={draft.isDefault} onChange={e => setDraft({ ...draft, isDefault: e.target.checked })} />
                  Atelier par défaut (reçoit les commandes des catégories sans atelier)</label>
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <div className="odoo-setting-label">Catégories fabriquées</div>
                <p className="odoo-setting-help">Une catégorie relève d'un seul atelier : la cocher ici la retire de l'atelier qui la portait.</p>
                <div style={grid}>
                  {cats.map(c => {
                    const owner = ownerOf(c.id);
                    const elsewhere = owner && owner.code !== draft.code;
                    return (
                      <label key={c.id} style={box} title={elsewhere ? `Actuellement : ${owner!.label}` : undefined}>
                        <input type="checkbox" checked={draft.categoryIds.includes(c.id)} onChange={() => toggle('categoryIds', c.id)} />
                        <span>{c.name}{elsewhere && <span className="odoo-setting-help"> · {owner!.label}</span>}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <div className="odoo-setting-label">Membres — rôles</div>
                <div style={grid}>
                  {roleRows.filter(r => r.is_active && r.code !== 'admin').map(r => (
                    <label key={r.code} style={box}><input type="checkbox" checked={draft.memberRoles.includes(r.code)} onChange={() => toggle('memberRoles', r.code)} /> {r.label}</label>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <div className="odoo-setting-label">Membres — utilisateurs</div>
                <div style={grid}>
                  {users.map(u => (
                    <label key={u.id} style={box}><input type="checkbox" checked={draft.memberUsers.includes(u.id)} onChange={() => toggle('memberUsers', u.id)} /> {u.firstName} {u.lastName}</label>
                  ))}
                </div>
                <p className="odoo-setting-help">Un membre doit aussi avoir le droit d'accès au module Production (Utilisateurs › Rôles).</p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--odoo-border)' }}>
              <button type="button" className="odoo-btn-secondary" onClick={() => setDraft(null)} disabled={save.isPending}>Annuler</button>
              <button type="button" className="odoo-btn-primary" disabled={save.isPending || !draft.label.trim() || !codeValid}
                onClick={() => save.mutate(draft)}>Enregistrer</button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </SettingsSection>
  );
}
