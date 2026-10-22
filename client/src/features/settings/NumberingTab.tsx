import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Hash, Loader2, Pencil, ShieldCheck } from 'lucide-react';
import { settingsApi, type DocumentSequence, type DocumentSequenceInput } from '../../api/settings.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';

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
      <StatusBanner tone="neutral" icon={ShieldCheck} title="Numéros sans doublon">
        Chaque pièce reçoit le numéro suivant de sa série au moment où elle est enregistrée. Si l'enregistrement
        échoue, le numéro est rendu. Le compteur ne revient jamais en arrière, même après une suppression ou un
        changement de modèle. Les factures clients ont une numérotation continue : elles ne peuvent plus être
        supprimées, seulement annulées.
      </StatusBanner>

      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto' }} />
        </div>
      ) : !rows.length ? (
        <StatusBanner tone="warning" icon={Hash} title="Aucune série">
          Les séries de numéros n'existent pas encore : la migration 329 n'est pas appliquée sur cette base.
        </StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr><th>Pièce</th><th>Modèle</th><th>Remise à zéro</th><th>Prochain numéro</th><th>Modifié</th><th style={{ width: 40 }}></th></tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.doc_type} id={`seq-row-${s.doc_type}`}>
                  <td>
                    {s.label}
                    {s.gapless && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6 }}>Continue</span>}
                  </td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}>{s.pattern} <span style={{ color: 'var(--odoo-text-muted)' }}>· {s.padding} chiffres</span></td>
                  <td>{RESET_LABELS[s.reset_period]}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{s.next_number}</td>
                  <td style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>
                    {s.updated_by_name ? `${s.updated_by_name}, ${new Date(s.updated_at).toLocaleDateString('fr-FR')}` : 'Format d\'origine'}
                  </td>
                  <td>
                    {canEdit('settings') && (
                      <button className="odoo-btn-secondary" onClick={() => setEditing(s)} aria-label={`Modifier la série ${s.label}`} style={{ padding: '2px 8px' }}>
                        <Pencil size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

  const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' };
  const label: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };

  return (
    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg-alt)' }}>
      <div style={{ fontWeight: 600 }}>Série « {seq.label} »</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ ...label, flex: '1 1 220px' }}>
          Modèle
          <input id={`seq-pattern-${seq.doc_type}`} style={{ ...field, fontFamily: 'ui-monospace, monospace' }} value={form.pattern}
            onChange={e => setForm({ ...form, pattern: e.target.value })} maxLength={60} />
        </label>
        <label style={{ ...label, width: 110 }}>
          Chiffres
          <input id={`seq-padding-${seq.doc_type}`} type="number" min={1} max={10} style={field} value={form.padding}
            onChange={e => setForm({ ...form, padding: parseInt(e.target.value, 10) || 0 })} />
        </label>
        <label style={{ ...label, width: 170 }}>
          Remise à zéro
          <select id={`seq-reset-${seq.doc_type}`} style={field} value={form.resetPeriod}
            onChange={e => setForm({ ...form, resetPeriod: e.target.value as DocumentSequenceInput['resetPeriod'] })}>
            {Object.entries(RESET_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {TOKENS.map(([t, l]) => (
          <button key={t} type="button" className="odoo-filter-chip" onClick={() => setForm({ ...form, pattern: form.pattern + t })} title={`Ajouter ${t}`}>
            <code>{t}</code> {l}
          </button>
        ))}
      </div>
      {preview && (preview.valid
        ? <div style={{ fontSize: '0.875rem' }}>Exemple : <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{preview.sample}</strong> <span style={{ color: 'var(--odoo-text-muted)' }}>(le compteur reprend après le dernier numéro existant)</span></div>
        : <StatusBanner tone="warning" icon={Hash} title="Modèle invalide">{preview.error}</StatusBanner>)}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button className="odoo-btn-primary" onClick={submit} disabled={!changed || !preview?.valid || save.isPending}>
          {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
