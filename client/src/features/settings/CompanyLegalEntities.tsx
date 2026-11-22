import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Building, Loader2 } from 'lucide-react';
import { settingsApi, type LegalEntity } from '../../api/settings.api';
import { useSettings } from '../../context/SettingsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { settingAnchor } from './SettingsPrimitives';

/**
 * Entités juridiques (G6-03, mig 608) : chaque établissement appartient à une société
 * qui émet ses pièces (factures, BC, bulletins…). Une installation a une seule entité au
 * départ, l'entité par défaut, qui reprend la fiche société ci-dessus (même source :
 * la modifier ici ou là revient au même, la fiche est donc éditée en haut de page).
 */

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string; details?: Record<string, string[]> } | string } } };
  const er = e?.response?.data?.error;
  if (typeof er === 'string') return er;
  const detail = er?.details ? Object.values(er.details).flat()[0] : undefined;
  return detail || er?.message || fallback;
}

type Draft = {
  code: string; legalName: string; tradeName: string; legalForm: string; ice: string; ifNumber: string; rc: string;
  patente: string; cnss: string; address: string; city: string; phone: string; email: string; currencyCode: string;
  countryCode: string; isActive: boolean;
};
const EMPTY: Draft = {
  code: '', legalName: '', tradeName: '', legalForm: '', ice: '', ifNumber: '', rc: '', patente: '', cnss: '',
  address: '', city: '', phone: '', email: '', currencyCode: '', countryCode: '', isActive: true,
};
const TEXT_FIELDS: [keyof Draft, string, number, string?][] = [
  ['code', 'Code', 12, 'FILIALE1'], ['legalName', 'Raison sociale', 120], ['tradeName', 'Nom commercial', 100],
  ['legalForm', 'Forme juridique', 30, 'SARL'], ['ice', 'ICE (15 chiffres)', 15], ['ifNumber', 'Identifiant fiscal', 30],
  ['rc', 'Registre du commerce', 30], ['patente', 'Patente', 30], ['cnss', 'N° CNSS employeur', 30],
  ['address', 'Adresse du siège', 500], ['city', 'Ville', 80], ['phone', 'Téléphone', 40], ['email', 'E-mail', 120],
  ['currencyCode', 'Devise (ISO)', 3, 'Devise de base'], ['countryCode', 'Pays (ISO)', 2, 'MA'],
];
const STORE_LIMIT = 50;

export default function CompanyLegalEntities() {
  const queryClient = useQueryClient();
  const { refreshSettings } = useSettings();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [storeFilter, setStoreFilter] = useState('');
  const { data, isLoading, isError } = useQuery({ queryKey: ['legal-entities'], queryFn: settingsApi.legalEntities, retry: false });
  const entities = data?.entities ?? [];
  const stores = data?.stores ?? [];
  const available = !isError && entities.length > 0;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['legal-entities'] });

  const save = useMutation({
    mutationFn: () => {
      const d = editing!.draft;
      const body: Record<string, unknown> = { ...d };
      for (const k of Object.keys(body)) if (body[k] === '' && k !== 'code' && k !== 'legalName') body[k] = null;
      if (!d.currencyCode) delete body.currencyCode;
      if (!d.countryCode) delete body.countryCode;
      body.ice = d.ice.replace(/\s/g, '') || null;
      return settingsApi.saveLegalEntity(editing!.id, body);
    },
    onSuccess: () => { refresh(); notify.success('Entité enregistrée'); setEditing(null); },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => settingsApi.saveLegalEntity(id, { isDefault: true }),
    onSuccess: async () => { refresh(); await refreshSettings(); notify.success('Entité par défaut changée : la fiche société a été mise à jour'); },
    onError: (err) => notify.error(errorMessage(err, 'Changement refusé')),
  });

  const assign = useMutation({
    mutationFn: ({ storeId, entityId }: { storeId: string; entityId: string }) => settingsApi.assignStoreEntity(storeId, entityId),
    onSuccess: () => { refresh(); notify.success('Établissement rattaché'); },
    onError: (err) => notify.error(errorMessage(err, 'Rattachement refusé')),
  });

  const open = (e?: LegalEntity) => setEditing(e
    ? {
      id: e.id, draft: {
        code: e.code, legalName: e.legal_name, tradeName: e.trade_name ?? '', legalForm: e.legal_form ?? '', ice: e.ice ?? '',
        ifNumber: e.if_number ?? '', rc: e.rc ?? '', patente: e.patente ?? '', cnss: e.cnss ?? '', address: e.address ?? '',
        city: e.city ?? '', phone: e.phone ?? '', email: e.email ?? '', currencyCode: e.currency_code, countryCode: e.country_code,
        isActive: e.is_active,
      },
    }
    : { id: null, draft: { ...EMPTY } });

  const shownStores = useMemo(() => {
    const q = storeFilter.trim().toLowerCase();
    return (q ? stores.filter(s => `${s.name} ${s.code ?? ''}`.toLowerCase().includes(q)) : stores).slice(0, STORE_LIMIT);
  }, [stores, storeFilter]);
  const activeEntities = entities.filter(e => e.is_active);

  const field: React.CSSProperties = { fontSize: 14, padding: '0 10px', minHeight: 36, border: '1px solid var(--ds-line)', borderRadius: 8, background: 'var(--ds-card)', color: 'var(--ds-ink)' };
  const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--ds-muted)' };
  const set = (k: keyof Draft, v: string | boolean) => setEditing(e => e && { ...e, draft: { ...e.draft, [k]: v } });
  const iceDigits = editing?.draft.ice.replace(/\s/g, '') ?? '';

  return (
    <div id={settingAnchor('Entités juridiques')} data-toc="Entités juridiques" className="odoo-scope" style={{ display: 'grid', gap: 10, scrollMarginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Entités juridiques</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)' }}>
            Société qui émet les pièces de chaque établissement. L'entité par défaut reprend la fiche ci-dessus.
          </div>
        </div>
        {!editing && available && (
          <button type="button" className="odoo-btn-primary" onClick={() => open()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Ajouter une entité
          </button>
        )}
      </div>

      {isError && <StatusBanner tone="warning" icon={Building} title="Entités juridiques indisponibles">La migration 608 n'est pas appliquée sur cette base.</StatusBanner>}
      {isLoading ? <Loader2 className="animate-spin" size={16} /> : entities.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Code</th><th>Raison sociale</th><th>ICE</th><th>Ville</th><th>Devise</th><th>Établissements</th><th>Statut</th><th style={{ width: 120 }}></th></tr></thead>
            <tbody>
              {entities.map(e => (
                <tr key={e.id} style={{ opacity: e.is_active ? 1 : 0.6 }}>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}>{e.code}</td>
                  <td>{e.legal_name} {e.is_default && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 4 }}>Par défaut</span>}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}>{e.ice ?? '—'}</td>
                  <td>{e.city ?? '—'}</td>
                  <td>{e.currency_code}</td>
                  <td>{e.store_count}</td>
                  <td><StatusTag tone={e.is_active ? 'done' : 'cancelled'} label={e.is_active ? 'Active' : 'Désactivée'} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {e.is_default
                      ? <span style={{ fontSize: '0.75rem', color: 'var(--ds-muted)' }}>Fiche ci-dessus</span>
                      : <>
                        <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => open(e)} aria-label={`Modifier ${e.legal_name}`}><Pencil size={13} /></button>
                        {e.is_active && (
                          <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 8px', marginLeft: 4 }} disabled={makeDefault.isPending}
                            onClick={() => makeDefault.mutate(e.id)} title="Les pièces sans établissement et la fiche société reprendront cette entité">
                            Par défaut
                          </button>
                        )}
                      </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg-alt)' }}>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
            {TEXT_FIELDS.map(([k, label, max, placeholder]) => (
              <label key={k} style={lab}>{label}
                <input id={`entity-${k}`} style={field} maxLength={max} placeholder={placeholder}
                  value={editing.draft[k] as string}
                  onChange={ev => set(k, k === 'code' || k === 'currencyCode' || k === 'countryCode' ? ev.target.value.toUpperCase() : ev.target.value)} />
                {k === 'ice' && iceDigits && !/^\d{15}$/.test(iceDigits) && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--odoo-danger, #b3261e)' }}>{iceDigits.length}/15 chiffres</span>
                )}
              </label>
            ))}
          </div>
          {editing.id && (
            <label htmlFor="entity-isActive" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.875rem' }}>
              <input id="entity-isActive" type="checkbox" checked={editing.draft.isActive} onChange={ev => set('isActive', ev.target.checked)} /> Entité active
            </label>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="odoo-btn-secondary" onClick={() => setEditing(null)}>Annuler</button>
            <button type="button" className="odoo-btn-primary"
              disabled={save.isPending || !/^[A-Z0-9]{2,12}$/.test(editing.draft.code) || !editing.draft.legalName.trim() || (!!iceDigits && !/^\d{15}$/.test(iceDigits))}
              onClick={() => save.mutate()}>
              {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {available && entities.length > 1 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Rattachement des établissements</div>
            {stores.length > 8 && (
              <input aria-label="Rechercher un établissement" style={{ ...field, width: 220 }} placeholder="Rechercher un établissement"
                value={storeFilter} onChange={ev => setStoreFilter(ev.target.value)} />
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th>Établissement</th><th>Code</th><th>Statut</th><th style={{ width: 280 }}>Entité juridique</th></tr></thead>
              <tbody>
                {shownStores.map(s => (
                  <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.6 }}>
                    <td>{s.name}</td>
                    <td>{s.code ?? '—'}</td>
                    <td><StatusTag tone={s.is_active ? 'done' : 'cancelled'} label={s.is_active ? 'Ouvert' : 'Fermé'} /></td>
                    <td>
                      <select aria-label={`Entité de ${s.name}`} style={{ ...field, width: '100%' }} value={s.legal_entity_id}
                        disabled={assign.isPending}
                        onChange={ev => assign.mutate({ storeId: s.id, entityId: ev.target.value })}>
                        {entities.filter(e => e.is_active || e.id === s.legal_entity_id).map(e => (
                          <option key={e.id} value={e.id} disabled={!e.is_active}>{e.code} — {e.legal_name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stores.length > shownStores.length && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--ds-muted)' }}>
              {shownStores.length} établissements affichés sur {stores.length} : précisez la recherche.
            </p>
          )}
        </div>
      )}
      {available && entities.length === 1 && activeEntities.length === 1 && (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--ds-muted)' }}>
          Une seule société : tous les établissements ({stores.length}) émettent leurs pièces sous la fiche ci-dessus.
          Ajoutez une entité pour rattacher un établissement à une autre société.
        </p>
      )}
    </div>
  );
}
