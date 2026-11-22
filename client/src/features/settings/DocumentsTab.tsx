import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDirtyForm, useDraft } from './DirtyForms';
import { FileText, Eye } from 'lucide-react';
import { PageNote } from './SettingsPrimitives';
import { settingsApi, type DocumentTemplate } from '../../api/settings.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { FormField, LoadingState, SectionHeader } from '../../components/ds';

/**
 * Modèles de documents (audit Paramètres, lot 6, mig 332) : mentions des pièces
 * envoyées aux tiers. Le pied de page légal (raison sociale, forme, capital,
 * siège, RC, IF, ICE, patente) vient de la fiche Société ; le compte bancaire,
 * du compte par défaut.
 */

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

export default function DocumentsTab() {
  const { data = [], isLoading } = useQuery({ queryKey: ['document-templates'], queryFn: settingsApi.documentTemplates });
  if (isLoading) return <LoadingState />;
  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      <PageNote help="Le pied de page légal (raison sociale, forme juridique, capital, siège, RC, IF, ICE, patente) vient de la page Société, et le compte bancaire du compte par défaut. Réglez ici les mentions propres à chaque pièce, puis vérifiez avec l'aperçu.">
        Mentions propres à chaque pièce. Le pied de page légal vient de Société.
      </PageNote>
      {!data.length && <StatusBanner tone="warning" icon={FileText} title="Modèles indisponibles">La migration 332 n'est pas appliquée sur cette base.</StatusBanner>}
      {data.map(t => <TemplateCard key={t.doc_type} tpl={t} />)}
    </div>
  );
}

function TemplateCard({ tpl }: { tpl: DocumentTemplate }) {
  const queryClient = useQueryClient();
  const { canEdit } = usePermissions();
  const editable = canEdit('settings');
  const { draft: form, setDraft: setForm, changes, reset, adopt } = useDraft({
    paymentTerms: tpl.payment_terms ?? '', latePenalty: tpl.late_penalty ?? '', footerNote: tpl.footer_note ?? '',
    showBank: tpl.show_bank, showLegalForm: tpl.show_legal_form,
  });
  const [previewing, setPreviewing] = useState(false);
  const dirty = changes > 0;

  useDirtyForm(`doc:${tpl.doc_type}`, {
    dirty, changes, reset,
    save: async () => {
      await settingsApi.updateDocumentTemplate(tpl.doc_type, form);
      adopt();
      await queryClient.invalidateQueries({ queryKey: ['document-templates'] });
    },
  });

  const preview = async () => {
    setPreviewing(true);
    try {
      const blob = await settingsApi.documentPreview(tpl.doc_type);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      notify.error(errorMessage(err, 'Aperçu indisponible'));
    } finally {
      setPreviewing(false);
    }
  };

  const isInvoice = tpl.doc_type === 'invoice';
  const id = (k: string) => `doc-${tpl.doc_type}-${k}`;

  return (
    <section id={`doc-${tpl.doc_type}`} className="ds-panel" style={{ padding: '16px 18px', display: 'grid', gap: 12, scrollMarginTop: '1rem' }} aria-label={tpl.label}>
      <SectionHeader title={tpl.label}
        note={tpl.updated_by_name ? `Modifié le ${new Date(tpl.updated_at).toLocaleDateString('fr-FR')} par ${tpl.updated_by_name}` : 'Réglages d\'origine'}>
        <button type="button" className="odoo-btn-secondary" onClick={preview} disabled={previewing || dirty} title={dirty ? 'Enregistrez avant l\'aperçu' : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Eye size={13} /> {previewing ? 'Génération…' : 'Aperçu PDF'}
        </button>
      </SectionHeader>
      <FormField label={isInvoice ? 'Conditions de paiement' : 'Conditions de livraison et de facturation'} htmlFor={id('terms')}>
        <textarea id={id('terms')} rows={2} maxLength={500} className="ds-input" style={{ minHeight: 60 }} disabled={!editable}
          value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: e.target.value })} />
      </FormField>
      {isInvoice && (
        <FormField label="Pénalités de retard" htmlFor={id('penalty')} hint="Mention conseillée par la loi n° 69-21 sur les délais de paiement.">
          <textarea id={id('penalty')} rows={2} maxLength={500} className="ds-input" style={{ minHeight: 60 }} disabled={!editable}
            value={form.latePenalty} onChange={e => setForm({ ...form, latePenalty: e.target.value })} />
        </FormField>
      )}
      <FormField label="Note de pied de page" htmlFor={id('footer')}>
        <input id={id('footer')} maxLength={300} className="ds-input" disabled={!editable}
          value={form.footerNote} onChange={e => setForm({ ...form, footerNote: e.target.value })} placeholder="Merci de votre confiance" />
      </FormField>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '14px' }}>
        {isInvoice && (
          <label htmlFor={id('bank')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input id={id('bank')} type="checkbox" disabled={!editable} checked={form.showBank} onChange={e => setForm({ ...form, showBank: e.target.checked })} />
            Afficher le compte bancaire
          </label>
        )}
        <label htmlFor={id('form')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input id={id('form')} type="checkbox" disabled={!editable} checked={form.showLegalForm} onChange={e => setForm({ ...form, showLegalForm: e.target.checked })} />
          Forme juridique et capital dans le pied de page
        </label>
      </div>
    </section>
  );
}
