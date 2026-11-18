import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Printer, RotateCcw } from 'lucide-react';
import { PRODUCTION_PRINT_DOCS, PRODUCTION_PRINT_DOC_TYPES, type ProductionPrintDoc } from '@ofauria/shared';
import { productionApi, useOrderTypes } from '../../api/production.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';

/**
 * Production › Paramétrage › Impressions (M8-04, mig 582).
 *
 * Pour chaque impression du module (ticket de lot, bon de sortie, fiche de production,
 * fiche technique) : titre, colonnes affichées, cases de signature et mention de pied de page.
 * Le modèle général vaut pour tous les types d'ordre ; une variante propre à un type
 * d'ordre le remplace champ par champ. Les numéros restent attribués par le serveur.
 */
const SOURCE_LABEL = { default: 'Par défaut', base: 'Modèle général', variant: 'Propre au type' } as const;

export default function ProductionPrintTemplatesPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && ['admin', 'manager'].includes(user.role);
  const { types } = useOrderTypes(false);
  const [doc, setDoc] = useState<ProductionPrintDoc>('production_bon_sortie');
  const [scope, setScope] = useState<string>(''); // '' = modèle général, sinon id du type d'ordre
  const def = PRODUCTION_PRINT_DOCS[doc];

  const { data: resolved, isLoading } = useQuery({
    queryKey: ['production-print-templates', scope || null],
    queryFn: () => productionApi.printTemplates(scope || null),
  });
  const { data: stored } = useQuery({ queryKey: ['production-print-template-settings'], queryFn: productionApi.printTemplateSettings, enabled: canEdit });
  const hasVariant = !!scope && !!stored?.variants.some(v => v.doc_type === doc && v.order_type_id === scope);
  const tpl = resolved?.[doc];

  const [title, setTitle] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [signatures, setSignatures] = useState('');
  const [footer, setFooter] = useState('');
  // Formulaire = valeurs effectives du gabarit sélectionné.
  useEffect(() => {
    if (!tpl) return;
    setTitle(tpl.title); setColumns(tpl.columns); setSignatures(tpl.signatures.join('\n')); setFooter(tpl.footer ?? '');
  }, [tpl]);

  const variantsByDoc = useMemo(() => {
    const m = new Map<string, number>();
    stored?.variants.forEach(v => m.set(v.doc_type, (m.get(v.doc_type) ?? 0) + 1));
    return m;
  }, [stored]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['production-print-templates'] });
    qc.invalidateQueries({ queryKey: ['production-print-template-settings'] });
  };
  const save = useMutation({
    mutationFn: () => productionApi.updatePrintTemplate(doc, {
      title: title.trim() || null,
      columns: def.columns.length ? columns : undefined,
      signatures: def.hasSignatures ? signatures.split('\n').map(s => s.trim()).filter(Boolean) : undefined,
      footer: footer.trim() || null,
    }, scope || null),
    onSuccess: () => { refresh(); notify.success('Gabarit enregistré'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () => productionApi.deletePrintTemplateVariant(doc, scope),
    onSuccess: () => { refresh(); notify.success('Le type d\'ordre reprend le modèle général'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const toggle = (k: string) => setColumns(c => c.includes(k) ? c.filter(x => x !== k) : [...c, k]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <StatusBanner tone="info" icon={Printer} title="Impressions du module">
        Titre, colonnes, signatures et mention de chaque impression. Le modèle général vaut pour tous les
        types d'ordre ; un type d'ordre peut avoir sa propre variante. Les numéros de lot et de bon restent
        attribués par le serveur.
      </StatusBanner>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
        <label className="block text-xs font-medium text-gray-500">Document
          <select className="input" value={doc} onChange={e => setDoc(e.target.value as ProductionPrintDoc)}>
            {PRODUCTION_PRINT_DOC_TYPES.map(d => {
              const n = variantsByDoc.get(d) ?? 0;
              return <option key={d} value={d}>{PRODUCTION_PRINT_DOCS[d].label}{n ? ` (${n} variante${n > 1 ? 's' : ''})` : ''}</option>;
            })}
          </select>
        </label>
        <label className="block text-xs font-medium text-gray-500">S'applique à
          <select className="input" value={scope} onChange={e => setScope(e.target.value)}>
            <option value="">Modèle général (tous les types d'ordre)</option>
            {types.map(t => <option key={t.id} value={t.id}>Type : {t.label}</option>)}
          </select>
        </label>
      </div>

      {isLoading || !tpl ? <Loader2 className="animate-spin" size={18} /> : (
        <div className="odoo-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{def.label}</span>
            <StatusTag tone={tpl.source === 'variant' ? 'progress' : tpl.source === 'base' ? 'done' : 'draft'} label={SOURCE_LABEL[tpl.source]} />
          </div>

          <label className="block text-xs font-medium text-gray-500">Titre imprimé
            <input className="input" value={title} maxLength={120} disabled={!canEdit} placeholder={def.defaultTitle}
              onChange={e => setTitle(e.target.value)} />
          </label>

          {def.columns.length > 0 && (
            <fieldset>
              <legend className="text-xs font-medium text-gray-500" style={{ marginBottom: 4 }}>
                {doc === 'production_ticket' ? 'Rubriques affichées' : 'Colonnes affichées'}
              </legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.25rem', fontSize: '0.875rem' }}>
                {def.columns.map(c => (
                  <label key={c.key}>
                    <input type="checkbox" checked={columns.includes(c.key)} disabled={!canEdit} onChange={() => toggle(c.key)} /> {c.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {def.hasSignatures && (
            <label className="block text-xs font-medium text-gray-500">Cases de signature (une par ligne, 6 au plus)
              <textarea className="input" rows={3} value={signatures} disabled={!canEdit}
                onChange={e => setSignatures(e.target.value.split('\n').slice(0, 6).join('\n'))} />
            </label>
          )}

          <label className="block text-xs font-medium text-gray-500">Mention de pied de page
            <input className="input" value={footer} maxLength={300} disabled={!canEdit} placeholder={def.defaultFooter ?? 'Aucune'}
              onChange={e => setFooter(e.target.value)} />
          </label>

          {canEdit && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {hasVariant && (
                <button type="button" className="odoo-btn-secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>
                  <RotateCcw size={14} /> Revenir au modèle général
                </button>
              )}
              <button type="button" className="odoo-btn-primary" disabled={save.isPending || (def.columns.length > 0 && columns.length === 0)}
                onClick={() => save.mutate()}>
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {scope ? ' Enregistrer pour ce type' : ' Enregistrer le modèle général'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
