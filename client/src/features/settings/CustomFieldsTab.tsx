import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, SlidersHorizontal, ArrowUp, ArrowDown } from 'lucide-react';
import { customFieldsApi, CF_TYPE_LABELS, type CfEntity, type CfType, type CustomFieldDef } from '../../api/custom-fields.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { apiErrorMessage } from '../../api/errors';

/**
 * Paramètres › Champs personnalisés (mig 369) : chaque entreprise ajoute à ses fiches
 * les informations de son métier. Le type et le code d'un champ sont figés après création
 * (les valeurs saisies en dépendent) ; un champ se désactive, il ne se supprime pas.
 */
const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', width: '100%' };
const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
type Draft = { id?: string; label: string; fieldType: CfType; options: string; required: boolean; showInList: boolean; help: string };
const emptyDraft = (): Draft => ({ label: '', fieldType: 'text', options: '', required: false, showInList: false, help: '' });
const EXAMPLES: Record<CfEntity, string> = {
  customer: 'secteur d\'activité, n° de lot client, date d\'anniversaire de l\'entreprise…',
  supplier: 'n° d\'agrément, transporteur habituel, certification…',
  ingredient: 'origine, label bio, n° d\'agrément sanitaire…',
  packaging_item: 'matière, contenance, référence fabricant…',
  product: 'taille, couleur, collection, code douanier…',
  order: 'n° de bon client, lieu de livraison, occasion…',
  intervention: 'kilométrage, n° d\'immatriculation, pièce remplacée…',
  project: 'référence du marché, chef de chantier, lieu…',
};

export default function CustomFieldsTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { canCreate, canEdit } = usePermissions();
  const [entity, setEntity] = useState<CfEntity>('customer');
  const [draft, setDraft] = useState<Draft | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['custom-field-defs', 'all'], queryFn: () => customFieldsApi.defs(undefined, true) });
  const all = data?.data ?? [];
  const entities = data?.entities ?? [];
  const list = all.filter(d => d.entity === entity).sort((a, b) => a.display_order - b.display_order);
  const refresh = () => qc.invalidateQueries({ queryKey: ['custom-field-defs'] });

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const options = d.options.split(/\n|;/).map(s => s.trim()).filter(Boolean);
      return d.id
        ? customFieldsApi.updateDef(d.id, { label: d.label, options: d.fieldType === 'select' ? options : undefined, required: d.required, showInList: d.showInList, help: d.help || null })
        : customFieldsApi.createDef({ entity, label: d.label, fieldType: d.fieldType, options, required: d.required, showInList: d.showInList, help: d.help || null });
    },
    onSuccess: (r, d) => { refresh(); setDraft(null); notify.success(d.id ? 'Champ modifié' : `Champ « ${r.label} » ajouté`); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const patch = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof customFieldsApi.updateDef>[1] }) => customFieldsApi.updateDef(id, data),
    onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)),
  });
  const move = (d: CustomFieldDef, dir: -1 | 1) => {
    const i = list.findIndex(x => x.id === d.id); const other = list[i + dir];
    if (!other) return;
    patch.mutate({ id: d.id, data: { displayOrder: other.display_order } });
    patch.mutate({ id: other.id, data: { displayOrder: d.display_order } });
  };
  const toggle = async (d: CustomFieldDef) => {
    if (d.is_active) {
      const u = await customFieldsApi.usage(d.id);
      if (!(await confirm(`Désactiver « ${d.label} » ? Il disparaît des formulaires et des imports ; les ${u.filled} valeur(s) déjà saisie(s) sont conservées et reviendront si vous le réactivez.`))) return;
    }
    patch.mutate({ id: d.id, data: { isActive: !d.is_active } });
  };

  if (isLoading) return <Loader2 className="animate-spin" size={18} />;
  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone="neutral" icon={SlidersHorizontal} title="Les informations propres à votre métier">
        Ajoutez à une fiche les champs dont votre activité a besoin. Ils apparaissent dans le formulaire de la fiche, peuvent
        s'afficher dans sa liste et se remplissent aussi par import. Le type d'un champ ne change plus une fois créé.
      </StatusBanner>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {entities.map(e => {
          const n = all.filter(d => d.entity === e.key && d.is_active).length;
          return (
            <button key={e.key} className={e.key === entity ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => { setEntity(e.key); setDraft(null); }}>
              {e.label}{n ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      {list.length === 0 && !draft ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', margin: 0 }}>Aucun champ sur cette fiche. Exemples : {EXAMPLES[entity]}</p>
      ) : list.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th style={{ width: 60 }}>Ordre</th><th>Champ</th><th>Type</th><th>Obligatoire</th><th>Dans la liste</th><th>Statut</th><th></th></tr></thead>
            <tbody>{list.map((d, i) => (
              <tr key={d.id} style={{ opacity: d.is_active ? 1 : 0.55 }}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {canEdit('settings') && <>
                    <button className="odoo-pager-btn" aria-label="Monter" disabled={i === 0} onClick={() => move(d, -1)}><ArrowUp size={12} /></button>
                    <button className="odoo-pager-btn" aria-label="Descendre" disabled={i === list.length - 1} onClick={() => move(d, 1)}><ArrowDown size={12} /></button>
                  </>}
                </td>
                <td><strong>{d.label}</strong><div style={{ fontSize: '0.7rem', color: 'var(--odoo-text-muted)', fontFamily: 'ui-monospace, monospace' }}>{d.code}</div>
                  {d.help && <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{d.help}</div>}</td>
                <td>{CF_TYPE_LABELS[d.field_type]}{d.field_type === 'select' && <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{d.options.join(' · ')}</div>}</td>
                <td>{d.required ? 'Oui' : 'Non'}</td>
                <td>{d.show_in_list ? 'Oui' : 'Non'}</td>
                <td>{d.is_active ? <span className="odoo-tag odoo-tag-green">Actif</span> : <span className="odoo-tag odoo-tag-grey">Désactivé</span>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canEdit('settings') && <>
                    <button className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setDraft({ id: d.id, label: d.label, fieldType: d.field_type, options: d.options.join('\n'), required: d.required, showInList: d.show_in_list, help: d.help ?? '' })}>Modifier</button>{' '}
                    <button className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => toggle(d)}>{d.is_active ? 'Désactiver' : 'Réactiver'}</button>
                  </>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {!draft && canCreate('settings') && (
        <div><button className="odoo-btn-secondary" onClick={() => setDraft(emptyDraft())} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Ajouter un champ</button></div>
      )}
      {draft && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg-alt)' }}>
          <div style={{ fontWeight: 600 }}>{draft.id ? 'Modifier le champ' : `Nouveau champ · ${entities.find(e => e.key === entity)?.label}`}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <label style={lab}>Libellé<input style={field} maxLength={80} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} placeholder="Ex. : N° d'immatriculation" autoFocus /></label>
            <label style={lab}>Type<select style={field} value={draft.fieldType} disabled={!!draft.id} onChange={e => setDraft({ ...draft, fieldType: e.target.value as CfType })}>
              {(Object.keys(CF_TYPE_LABELS) as CfType[]).map(t => <option key={t} value={t}>{CF_TYPE_LABELS[t]}</option>)}
            </select></label>
            <label style={lab}>Aide (sous le champ)<input style={field} maxLength={200} value={draft.help} onChange={e => setDraft({ ...draft, help: e.target.value })} placeholder="Facultatif" /></label>
          </div>
          {draft.fieldType === 'select' && (
            <label style={lab}>Valeurs possibles (une par ligne)<textarea style={{ ...field, minHeight: 90 }} value={draft.options} onChange={e => setDraft({ ...draft, options: e.target.value })} placeholder={'S\nM\nL\nXL'} /></label>
          )}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.8125rem' }}>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={draft.required} onChange={e => setDraft({ ...draft, required: e.target.checked })} /> Obligatoire</label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={draft.showInList} onChange={e => setDraft({ ...draft, showInList: e.target.checked })} /> Afficher dans la liste</label>
          </div>
          {draft.required && !draft.id && <p style={{ fontSize: '0.75rem', color: '#b85d1a', margin: 0 }}>Un champ obligatoire sera exigé à la prochaine modification de chaque fiche existante.</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="odoo-btn-secondary" onClick={() => setDraft(null)}>Annuler</button>
            <button className="odoo-btn-primary" disabled={save.isPending || draft.label.trim().length < 2 || (draft.fieldType === 'select' && !draft.options.trim())} onClick={() => save.mutate(draft)}>Enregistrer</button>
          </div>
        </div>
      )}
    </div>
  );
}
