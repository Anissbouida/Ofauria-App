import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDirtyForm, useDraft } from './DirtyForms';
import { FileText, Loader2, Eye } from 'lucide-react';
import { settingsApi, type DocumentTemplate } from '../../api/settings.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';

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
  if (isLoading) return <Loader2 className="animate-spin" size={18} />;
  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      <StatusBanner tone="neutral" icon={FileText} title="Une mise en page commune">
        Le pied de page légal est tiré de l'onglet Société (raison sociale, forme juridique, capital, siège, RC, IF, ICE, patente)
        et le compte bancaire du compte par défaut. Réglez ici les mentions propres à chaque pièce, puis vérifiez avec l'aperçu.
      </StatusBanner>
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

  const area: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', width: '100%', resize: 'vertical' };
  const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
  const isInvoice = tpl.doc_type === 'invoice';

  return (
    <div id={`doc-${tpl.doc_type}`} style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg)', scrollMarginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{tpl.label}</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
            {tpl.updated_by_name ? `Modifié le ${new Date(tpl.updated_at).toLocaleDateString('fr-FR')} par ${tpl.updated_by_name}` : 'Réglages d\'origine'}
          </div>
        </div>
        <button className="odoo-btn-secondary" onClick={preview} disabled={previewing || dirty} title={dirty ? 'Enregistrez avant l\'aperçu' : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Eye size={13} /> {previewing ? 'Génération…' : 'Aperçu PDF'}
        </button>
      </div>
      <label style={lab}>{isInvoice ? 'Conditions de paiement' : 'Conditions de livraison et de facturation'}
        <textarea id={`doc-${tpl.doc_type}-terms`} rows={2} maxLength={500} style={area} disabled={!editable}
          value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: e.target.value })} />
      </label>
      {isInvoice && (
        <label style={lab}>Pénalités de retard
          <textarea id={`doc-${tpl.doc_type}-penalty`} rows={2} maxLength={500} style={area} disabled={!editable}
            value={form.latePenalty} onChange={e => setForm({ ...form, latePenalty: e.target.value })} />
          <span style={{ fontSize: '0.75rem' }}>Mention conseillée par la loi n° 69-21 sur les délais de paiement.</span>
        </label>
      )}
      <label style={lab}>Note de pied de page
        <input id={`doc-${tpl.doc_type}-footer`} maxLength={300} style={area} disabled={!editable}
          value={form.footerNote} onChange={e => setForm({ ...form, footerNote: e.target.value })} placeholder="Merci de votre confiance" />
      </label>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.875rem' }}>
        {isInvoice && (
          <label htmlFor={`doc-${tpl.doc_type}-bank`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input id={`doc-${tpl.doc_type}-bank`} type="checkbox" disabled={!editable} checked={form.showBank} onChange={e => setForm({ ...form, showBank: e.target.checked })} />
            Afficher le compte bancaire
          </label>
        )}
        <label htmlFor={`doc-${tpl.doc_type}-form`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input id={`doc-${tpl.doc_type}-form`} type="checkbox" disabled={!editable} checked={form.showLegalForm} onChange={e => setForm({ ...form, showLegalForm: e.target.checked })} />
          Forme juridique et capital dans le pied de page
        </label>
      </div>
    </div>
  );
}
