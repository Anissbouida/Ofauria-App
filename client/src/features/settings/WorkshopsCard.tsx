import { useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Factory, Plus } from 'lucide-react';
import { productionApi, type Workshop } from '../../api/production.api';
import { categoriesApi } from '../../api/categories.api';
import { recipesApi, type RecipeCategory } from '../../api/recipes.api';
import { rolesApi, usersApi } from '../../api/users.api';
import { DataPanel, FormField, FormFooter, FormSection, Modal } from '../../components/ds';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { SettingsSection } from './SettingsPrimitives';

/**
 * Ateliers de production (mig 511, plan Production générique P2).
 *
 * Un atelier fabrique des catégories de produits et réunit des membres (rôles ou
 * utilisateurs). Ses plans, ses demandes boutique et ses notifications vont à ses
 * membres. Remplace l'ancien « atelier = rôle du chef » codé en dur.
 */
type Draft = { code: string; isNew: boolean; label: string; isDefault: boolean; isActive: boolean; sortOrder: number;
  categoryIds: number[]; recipeCategoryIds: string[]; memberRoles: string[]; memberUsers: string[] };

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'a_$1').slice(0, 30);

export default function WorkshopsCard() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const { data } = useQuery({ queryKey: ['production-workshops'], queryFn: productionApi.workshops });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const { data: recipeCats = [] } = useQuery<RecipeCategory[]>({ queryKey: ['recipe-categories'], queryFn: recipesApi.listCategories });
  const { data: roleRows = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const { data: userRows = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const workshops = data?.workshops ?? [];
  const cats = categories as { id: number; name: string }[];
  const users = (userRows as { id: string; firstName: string; lastName: string; isActive?: boolean }[]).filter(u => u.isActive !== false);
  const roleLabel = (code: string) => roleRows.find(r => r.code === code)?.label ?? code;
  const ownerOf = (catId: number) => workshops.find(w => w.categoryIds.includes(catId));
  const recipeOwnerOf = (catId: string) => workshops.find(w => (w.recipeCategoryIds ?? []).includes(catId));

  const save = useMutation({
    mutationFn: (d: Draft) => productionApi.saveWorkshop(d.code, {
      label: d.label.trim(), workCenterId: null, isDefault: d.isDefault, isActive: d.isActive, sortOrder: d.sortOrder,
      categoryIds: d.categoryIds, recipeCategoryIds: d.recipeCategoryIds, memberRoles: d.memberRoles, memberUsers: d.memberUsers,
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
        categoryIds: [...w.categoryIds], recipeCategoryIds: [...(w.recipeCategoryIds ?? [])], memberRoles: [...w.memberRoles], memberUsers: [...w.memberUsers] }
    : { code: '', isNew: true, label: '', isDefault: false, isActive: true, sortOrder: (workshops.length + 1) * 10,
        categoryIds: [], recipeCategoryIds: [], memberRoles: [], memberUsers: [] });

  const toggle = <K extends 'categoryIds' | 'recipeCategoryIds' | 'memberRoles' | 'memberUsers'>(key: K, value: Draft[K][number]) =>
    setDraft(d => {
      if (!d) return d;
      const list = d[key] as (typeof value)[];
      return { ...d, [key]: list.includes(value) ? list.filter(x => x !== value) : [...list, value] };
    });

  const box: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', cursor: 'pointer' };
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6, maxHeight: 200, overflowY: 'auto' };
  const codeValid = !draft || /^[a-z][a-z0-9_]{1,29}$/.test(draft.code);

  return (
    <SettingsSection title="Ateliers" columns={1}
      description="Un atelier fabrique des catégories de produits et réunit ses membres (rôles ou utilisateurs). Ses plans de production, ses demandes boutique et ses notifications vont à ses membres ; ses chefs modifient ses fiches techniques.">
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="odoo-btn-primary" onClick={() => open()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Nouvel atelier
          </button>
        </div>
        <DataPanel label="Ateliers">
          <table className="odoo-table">
            <thead><tr><th>Atelier</th><th>Catégories fabriquées</th><th>Membres</th><th>Statut</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
            <tbody>
              {workshops.map(w => (
                <tr key={w.code} style={{ opacity: w.isActive ? 1 : 0.6 }}>
                  <td>
                    <span className="ds-strong" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Factory size={13} aria-hidden="true" /> {w.label}</span>
                    {w.isDefault && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6 }}>Par défaut</span>}
                  </td>
                  <td>{w.categoryIds.length ? `${w.categoryIds.length} catégorie(s)` : '—'}</td>
                  <td>{[...w.memberRoles.map(roleLabel), ...(w.memberUsers.length ? [`${w.memberUsers.length} utilisateur(s)`] : [])].join(', ') || '—'}</td>
                  <td><StatusTag tone={w.isActive ? 'done' : 'cancelled'} label={w.isActive ? 'Actif' : 'Inactif'} /></td>
                  <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => open(w)} aria-label={`Modifier ${w.label}`}>Modifier</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      </div>

      {draft && (
        <Modal title={draft.isNew ? 'Nouvel atelier' : `Atelier — ${draft.label}`} onClose={() => setDraft(null)} width={680} locked={save.isPending}
          footer={<FormFooter onCancel={() => setDraft(null)} busy={save.isPending} disabled={!draft.label.trim() || !codeValid} onSubmit={() => save.mutate(draft)} />}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '2 1 220px' }}>
                  <FormField label="Libellé" htmlFor="workshop-label" required>
                    <input id="workshop-label" className="ds-input" value={draft.label} autoFocus
                      onChange={e => setDraft({ ...draft, label: e.target.value, code: draft.isNew ? slugify(e.target.value) : draft.code })} />
                  </FormField>
                </div>
                <div style={{ flex: '1 1 160px' }}>
                  <FormField label="Code" htmlFor="workshop-code" required
                    error={!codeValid ? 'Code : minuscules, chiffres et « _ », 2 à 30 caractères, commence par une lettre.' : undefined}>
                    <input id="workshop-code" className="ds-input" style={{ fontFamily: 'ui-monospace, monospace' }} value={draft.code} disabled={!draft.isNew}
                      aria-invalid={!codeValid || undefined} onChange={e => setDraft({ ...draft, code: e.target.value })} />
                  </FormField>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <label style={box}><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} /> Actif</label>
                <label style={box}><input type="checkbox" checked={draft.isDefault} onChange={e => setDraft({ ...draft, isDefault: e.target.checked })} />
                  Atelier par défaut (reçoit les commandes des catégories sans atelier)</label>
              </div>

              <FormSection title="Catégories fabriquées">
                <div style={{ display: 'grid', gap: 6 }}>
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
              </FormSection>

              <FormSection title="Catégories de fiches techniques">
                <div style={{ display: 'grid', gap: 6 }}>
                <p className="odoo-setting-help">Atelier des fiches sans produit lié (sinon, c'est la catégorie du produit qui compte). Un chef ne modifie que les fiches de ses ateliers ; une fiche d'une catégorie sans atelier (préparations de base) reste commune.</p>
                <div style={grid}>
                  {recipeCats.map(c => {
                    const owner = recipeOwnerOf(c.id);
                    const elsewhere = owner && owner.code !== draft.code;
                    return (
                      <label key={c.id} style={box} title={elsewhere ? `Actuellement : ${owner!.label}` : undefined}>
                        <input type="checkbox" checked={draft.recipeCategoryIds.includes(c.id)} onChange={() => toggle('recipeCategoryIds', c.id)} />
                        <span>{c.label}{elsewhere && <span className="odoo-setting-help"> · {owner!.label}</span>}</span>
                      </label>
                    );
                  })}
                </div>
                </div>
              </FormSection>

              <FormSection title="Membres — rôles">
                <div style={{ display: 'grid', gap: 6 }}>
                <div style={grid}>
                  {roleRows.filter(r => r.is_active && r.code !== 'admin').map(r => (
                    <label key={r.code} style={box}><input type="checkbox" checked={draft.memberRoles.includes(r.code)} onChange={() => toggle('memberRoles', r.code)} /> {r.label}</label>
                  ))}
                </div>
                </div>
              </FormSection>
              <FormSection title="Membres — utilisateurs">
                <div style={{ display: 'grid', gap: 6 }}>
                <div style={grid}>
                  {users.map(u => (
                    <label key={u.id} style={box}><input type="checkbox" checked={draft.memberUsers.includes(u.id)} onChange={() => toggle('memberUsers', u.id)} /> {u.firstName} {u.lastName}</label>
                  ))}
                </div>
                <p className="odoo-setting-help">Un membre doit aussi avoir le droit d'accès au module Production (Utilisateurs › Rôles).</p>
                </div>
              </FormSection>
            </div>
        </Modal>
      )}
    </SettingsSection>
  );
}
