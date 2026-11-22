import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers, Loader2, Save, X, ChevronDown, ChevronRight } from 'lucide-react';
import { productionApi, type PolicyField, type PolicyScopeType, type ProductionPolicy } from '../../api/production.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import '../settings/settings.css';

import { DataPanel, LoadingState, TableFooter } from '../../components/ds';
/**
 * Production › Paramétrage › Politiques (M1-04).
 *
 * Une ligne par politique : la valeur effective au niveau regardé, le niveau d'où elle
 * vient, et de quoi la surcharger pour un atelier ou un établissement. La valeur la plus
 * précise gagne : article → type d'ordre → atelier → établissement → société → défaut.
 */

const SOURCE_TONE: Record<PolicyScopeType | 'default', StatusTone> = {
  default: 'draft', company: 'done', store: 'progress', workshop: 'progress', order_type: 'progress', product: 'progress',
};

/** « 90 % », « 1,5 DH / kWh », « 07:00 » : la valeur d'un champ avec son unité. */
function formatField(f: PolicyField, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (f.type === 'time' || f.type === 'date') return String(v);
  if (f.type === 'boolean') return v ? 'Oui' : 'Non';
  if (f.type === 'enum') return f.options?.find(o => o.value === v)?.label ?? String(v);
  const n = Number(v);
  const text = Number.isFinite(n) ? n.toLocaleString('fr-FR', { maximumFractionDigits: 4 }) : String(v);
  const unit = f.type === 'percent' ? '%' : f.unit;
  return unit ? `${text} ${unit}` : text;
}

function formatValue(p: ProductionPolicy, value: Record<string, unknown>): string {
  return p.fields.map(f => (p.fields.length > 1 ? `${f.label} : ` : '') + formatField(f, value[f.name])).join(' · ');
}

type Level = { type: PolicyScopeType; id: string; label: string };

export default function ProductionPoliciesPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && ['admin', 'manager'].includes(user.role);
  const [levelKey, setLevelKey] = useState('company:');
  const [editing, setEditing] = useState<{ key: string; draft: Record<string, string> } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const sep = levelKey.indexOf(':');
  const scopeType = levelKey.slice(0, sep) as PolicyScopeType;
  const scopeId = levelKey.slice(sep + 1);
  const { data, isLoading } = useQuery({
    queryKey: ['production-policies-admin', levelKey],
    queryFn: () => productionApi.listPolicies({
      exact: '1', ...(scopeType === 'workshop' ? { workshop: scopeId } : {}), ...(scopeType === 'store' ? { store: scopeId } : {}),
      ...(scopeType === 'order_type' ? { orderType: scopeId } : {}),
    }),
  });

  const levels: Level[] = [
    { type: 'company', id: '', label: 'Société' },
    ...(data?.levels.stores ?? []).map(s => ({ type: 'store' as const, id: s.id, label: `Établissement · ${s.label}` })),
    ...(data?.levels.workshops ?? []).map(w => ({ type: 'workshop' as const, id: w.id, label: `Atelier · ${w.label}` })),
    // Types d'ordre (M2-01) : un type peut porter sa propre valeur (ex. clé de répartition du coût).
    ...(data?.levels.orderTypes ?? []).map(t => ({ type: 'order_type' as const, id: t.id, label: `Type d'ordre · ${t.label}` })),
  ];
  const levelNoun = scopeType === 'workshop' ? 'cet atelier' : scopeType === 'store' ? 'cet établissement' : scopeType === 'order_type' ? 'ce type d\'ordre' : 'la société';

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['production-policies-admin'] });
    qc.invalidateQueries({ queryKey: ['production-policies'] });
  };
  const save = useMutation({
    mutationFn: (v: { key: string; type: PolicyScopeType; id: string; value: Record<string, unknown> | null }) =>
      productionApi.setPolicy(v.key, v.type, v.id, v.value),
    onSuccess: (_d, v) => { notify.success(v.value === null ? 'Valeur retirée' : 'Politique enregistrée'); setEditing(null); refresh(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  // C-09 : ordres non terminés concernés par une valeur posée à ce niveau.
  const { data: impact } = useQuery({
    queryKey: ['production-policy-impact', scopeType, scopeId],
    queryFn: () => productionApi.policyImpact(scopeType, scopeId),
    enabled: !!editing,
  });
  const startEdit = (p: ProductionPolicy) => setEditing({
    key: p.key,
    draft: Object.fromEntries(p.fields.map(f => [f.name, String(p.effective.value[f.name] ?? '')])),
  });
  const submit = (p: ProductionPolicy) => {
    if (!editing) return;
    const value: Record<string, unknown> = {};
    for (const f of p.fields) {
      const raw = editing.draft[f.name];
      value[f.name] = f.type === 'time' || f.type === 'date' || f.type === 'enum' ? raw : Number(String(raw).replace(',', '.'));
    }
    save.mutate({ key: p.key, type: scopeType, id: scopeId, value });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StatusBanner tone="info" icon={Layers} title="Politiques de production">
        Chaque règle a une valeur pour la société, qu'un établissement ou un atelier peut remplacer par la sienne.
        La valeur la plus précise l'emporte : article, type d'ordre, atelier, établissement, société, puis valeur par défaut.
      </StatusBanner>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <span style={{ fontWeight: 600, color: 'var(--ds-ink)' }}>Niveau regardé</span>
        <select className="ds-input" style={{ minWidth: 260, width: 'auto' }} value={levelKey} aria-label="Niveau regardé"
          onChange={e => { setLevelKey(e.target.value); setEditing(null); }}>
          {levels.map(l => <option key={`${l.type}:${l.id}`} value={`${l.type}:${l.id}`}>{l.label}</option>)}
        </select>
      </label>

      {isLoading && <LoadingState />}

      {data && (
        <DataPanel label="Politiques de production" footer={<TableFooter note={`${data.policies.length} politique(s)`} />}>
          <table className="odoo-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Politique</th>
                <th>Valeur effective</th>
                <th>Vient de</th>
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.policies.map(p => {
                const own = p.overrides.find(o => o.scopeType === scopeType && o.scopeId === scopeId);
                const allowed = p.scopes.includes(scopeType);
                const isEditing = editing?.key === p.key;
                const others = p.overrides.filter(o => !(o.scopeType === scopeType && o.scopeId === scopeId));
                return (
                  <tr key={p.key} style={{ verticalAlign: 'top' }}>
                    <td style={{ maxWidth: 380 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="ds-strong">{p.label}</span>
                        {own && <span className="odoo-setting-changed">Modifié</span>}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--ds-muted)', marginTop: 2 }}>{p.help}</div>
                      {others.length > 0 && (
                        <button type="button" onClick={() => setOpen(open === p.key ? null : p.key)} aria-expanded={open === p.key}
                          style={{ marginTop: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--ds-accent-ink)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          {open === p.key ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {others.length} autre{others.length > 1 ? 's' : ''} valeur{others.length > 1 ? 's' : ''} posée{others.length > 1 ? 's' : ''}
                        </button>
                      )}
                      {open === p.key && others.length > 0 && (
                        <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', fontSize: '0.78rem' }}>
                          {others.map(o => (
                            <li key={`${o.scopeType}:${o.scopeId}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                              <span>{o.scopeTypeLabel}{o.scopeType === 'company' ? '' : ` · ${o.scopeLabel}`} : <strong>{formatValue(p, o.value)}</strong></span>
                              {canEdit && (
                                <button type="button" className="odoo-setting-revert" disabled={save.isPending}
                                  onClick={() => save.mutate({ key: p.key, type: o.scopeType, id: o.scopeId, value: null })}>Retirer</button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {p.fields.map(f => (
                            <label key={f.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                              {p.fields.length > 1 && <span style={{ minWidth: 150 }}>{f.label}</span>}
                              <input className="ds-input sm" style={{ width: 110, textAlign: f.type === 'time' ? 'left' : 'right' }} aria-label={f.label}
                                type={f.type === 'time' ? 'time' : 'number'} step={f.type === 'integer' ? 1 : 'any'} min={f.min} max={f.max}
                                value={editing!.draft[f.name] ?? ''}
                                onChange={e => setEditing(ed => ed && { ...ed, draft: { ...ed.draft, [f.name]: e.target.value } })} />
                              {f.type !== 'time' && <span style={{ color: 'var(--ds-muted)' }}>{f.type === 'percent' ? '%' : f.unit}</span>}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{formatValue(p, p.effective.value)}</span>
                      )}
                    </td>
                    <td>
                      <StatusTag tone={SOURCE_TONE[p.effective.source]}
                        label={p.effective.source === 'default' || p.effective.source === 'company' ? p.effective.sourceLabel : `${p.effective.sourceLabel} · ${p.effective.scopeLabel}`} />
                    </td>
                    <td className="ds-actions">
                      {isEditing ? (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={save.isPending} onClick={() => setEditing(null)}>Annuler</button>
                          <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={save.isPending} aria-busy={save.isPending || undefined} onClick={() => submit(p)}>
                            {save.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />} Enregistrer
                          </button>
                          {impact && (impact.draft + impact.underway > 0) && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--ds-muted)', alignSelf: 'center' }}
                              title="Les ordres en cours gardent ce qui a déjà été calculé ; le nouveau réglage s'applique aux calculs à venir.">
                              S'applique à {impact.draft + impact.underway} ordre(s) non terminé(s){impact.underway ? `, dont ${impact.underway} en cours` : ''}
                            </span>
                          )}
                        </span>
                      ) : !allowed ? (
                        scopeType === 'company' && p.companyManagedElsewhere
                          ? <span style={{ fontSize: '0.78rem', color: 'var(--ds-muted)' }}>Se règle dans l'onglet Réglages</span>
                          : <span style={{ fontSize: '0.78rem', color: 'var(--ds-muted)' }}>Non réglable à ce niveau</span>
                      ) : canEdit ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => startEdit(p)}>
                            {own ? 'Modifier' : scopeType === 'company' ? 'Régler' : `Surcharger pour ${levelNoun}`}
                          </button>
                          {own && (
                            <button type="button" className="odoo-setting-revert" disabled={save.isPending}
                              title={scopeType === 'company' ? 'Revenir à la valeur par défaut' : 'Revenir à la valeur héritée'}
                              onClick={() => save.mutate({ key: p.key, type: scopeType, id: scopeId, value: null })}>Rétablir</button>
                          )}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}
    </div>
  );
}
