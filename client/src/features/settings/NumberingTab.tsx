import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Hash } from 'lucide-react';
import { PageNote } from './SettingsPrimitives';
import { settingsApi, type DocumentSequence, type DocumentSequenceInput } from '../../api/settings.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { DataPanel, FormField, FormFooter, LoadingState, SectionHeader } from '../../components/ds';

/**
 * Séries de numéros des pièces (mig 329) : modèle, nombre de chiffres et
 * remise à zéro de chaque type de pièce. Le compteur ne recule jamais et se
 * cale sur le plus grand numéro existant : changer le modèle ne crée pas de doublon.
 */

const RESET_LABELS: Record<DocumentSequence['reset_period'], string> = {
  never: 'Jamais', year: 'Chaque année', month: 'Chaque mois', day: 'Chaque jour',
};
const TOKENS: [string, string][] = [
  ['{YYYY}', 'année (2026)'], ['{YY}', 'année courte (26)'], ['{MM}', 'mois'], ['{DD}', 'jour'], ['{SEQ}', 'compteur'],
];

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

export default function NumberingTab() {
  const { canEdit } = usePermissions();
  const [editing, setEditing] = useState<DocumentSequence | null>(null);
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['document-sequences'], queryFn: settingsApi.documentSequences });

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12 }}>
      <PageNote help="Le numéro est attribué à l'enregistrement ; s'il échoue, le numéro est rendu. Le compteur ne revient jamais en arrière, même après une suppression ou un changement de modèle. Les factures clients ont une numérotation continue : elles ne se suppriment pas, elles s'annulent.">
        Numéros attribués à l'enregistrement, sans doublon ni retour en arrière.
      </PageNote>

      {isLoading ? (
        <LoadingState />
      ) : !rows.length ? (
        <StatusBanner tone="warning" icon={Hash} title="Aucune série">
          Les séries de numéros n'existent pas encore : la migration 329 n'est pas appliquée sur cette base.
        </StatusBanner>
      ) : (
        <DataPanel label="Séries de numéros">
          <table className="odoo-table">
            <thead>
              <tr><th>Pièce</th><th>Modèle</th><th>Remise à zéro</th><th>Prochain numéro</th><th>Modifié</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.doc_type} id={`seq-row-${s.doc_type}`}>
                  <td className="ds-strong">
                    {s.label}
                    {s.gapless && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6 }}>Continue</span>}
                  </td>
                  <td className="ds-ref">{s.pattern} <span style={{ color: 'var(--ds-muted)' }}>· {s.padding} chiffres</span></td>
                  <td>{RESET_LABELS[s.reset_period]}</td>
                  <td className="ds-ref">{s.next_number}</td>
                  <td style={{ color: 'var(--ds-muted)', fontSize: '0.8125rem' }}>
                    {s.updated_by_name ? `${s.updated_by_name}, ${new Date(s.updated_at).toLocaleDateString('fr-FR')}` : 'Format d\'origine'}
                  </td>
                  <td className="ds-actions">
                    {canEdit('settings') && (
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setEditing(s)} aria-label={`Modifier la série ${s.label}`}>
                        Modifier
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}

      {editing && <SequenceEditor seq={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SequenceEditor({ seq, onClose }: { seq: DocumentSequence; onClose: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [form, setForm] = useState<DocumentSequenceInput>({ pattern: seq.pattern, padding: seq.padding, resetPeriod: seq.reset_period });
  const [preview, setPreview] = useState<{ valid: boolean; sample?: string; error?: string } | null>(null);

  // Aperçu calculé par le serveur (mêmes règles que l'enregistrement), après une courte pause de frappe.
  useEffect(() => {
    const t = setTimeout(() => {
      settingsApi.previewDocumentSequence(form).then(setPreview).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [form]);

  const save = useMutation({
    mutationFn: () => settingsApi.updateDocumentSequence(seq.doc_type, form),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['document-sequences'] });
      notify.success(`Série enregistrée : prochain numéro ${r.next_number}`);
      onClose();
    },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });

  const changed = form.pattern !== seq.pattern || form.padding !== seq.padding || form.resetPeriod !== seq.reset_period;
  const submit = async () => {
    if (seq.gapless && !(await confirm(
      `Les factures clients déjà émises gardent leur numéro ; les suivantes prendront le nouveau modèle. Le compteur continue sans trou.`,
      { title: `Modifier la série « ${seq.label} » ?`, confirmLabel: 'Modifier la série' },
    ))) return;
    save.mutate();
  };

  const id = (k: string) => `seq-${k}-${seq.doc_type}`;

  return (
    <section className="ds-panel" style={{ padding: '16px 18px', display: 'grid', gap: 12 }} aria-labelledby={id('title')}>
      <SectionHeader title={<span id={id('title')}>Série « {seq.label} »</span>} />
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(220px, 1fr) 110px 170px' }}>
        <FormField label="Modèle" htmlFor={id('pattern')} required hint="Ajoutez les éléments ci-dessous ; {SEQ} est le compteur.">
          <input id={id('pattern')} className="ds-input" style={{ fontFamily: 'ui-monospace, monospace' }} value={form.pattern}
            onChange={e => setForm({ ...form, pattern: e.target.value })} maxLength={60} />
        </FormField>
        <FormField label="Chiffres" htmlFor={id('padding')} required>
          <input id={id('padding')} type="number" min={1} max={10} className="ds-input" value={form.padding}
            onChange={e => setForm({ ...form, padding: parseInt(e.target.value, 10) || 0 })} />
        </FormField>
        <FormField label="Remise à zéro" htmlFor={id('reset')}>
          <select id={id('reset')} className="ds-input" value={form.resetPeriod}
            onChange={e => setForm({ ...form, resetPeriod: e.target.value as DocumentSequenceInput['resetPeriod'] })}>
            {Object.entries(RESET_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </FormField>
      </div>
      <div style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {TOKENS.map(([t, l]) => (
          <button key={t} type="button" className="odoo-filter-chip" onClick={() => setForm({ ...form, pattern: form.pattern + t })} title={`Ajouter ${t}`}>
            <code>{t}</code> {l}
          </button>
        ))}
      </div>
      {preview && (preview.valid
        ? <div style={{ fontSize: '0.875rem' }}>Exemple : <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{preview.sample}</strong> <span style={{ color: 'var(--ds-muted)' }}>(le compteur reprend après le dernier numéro existant)</span></div>
        : <StatusBanner tone="warning" icon={Hash} title="Modèle invalide">{preview.error}</StatusBanner>)}
      <FormFooter dirty={changed} onCancel={onClose} busy={save.isPending} disabled={!changed || !preview?.valid} onSubmit={() => { void submit(); }} />
    </section>
  );
}
