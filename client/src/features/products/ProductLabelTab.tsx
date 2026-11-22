import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Printer, Save, Tag } from 'lucide-react';
import { productsApi, type ProductLabelData } from '../../api/products.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import PrintOverlay from '../../components/PrintOverlay';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { DataPanel } from '../../components/ds';

/**
 * Étiquette réglementaire d'un produit (G2-09) : dénomination, ingrédients par poids
 * décroissant tirés de la nomenclature (semi-finis remplacés par leurs ingrédients),
 * allergènes en évidence, traces, poids net, date limite, conservation.
 * L'impression est refusée tant qu'un ingrédient n'a pas ses allergènes renseignés.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const weight = (g: number) => (g >= 1000 ? `${(g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} kg` : `${g.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} g`);
const limitDate = (days: number | null) => {
  if (days === null) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('fr-FR');
};

/** Liste des ingrédients en HTML : ceux qui portent un allergène en majuscules et en gras. */
const ingredientsHtml = (d: ProductLabelData) => d.ingredients
  .map(i => (i.contains.length ? `<b>${esc(i.name.toLocaleUpperCase('fr'))}</b>` : esc(i.name.toLocaleLowerCase('fr'))))
  .join(', ');

/** Une étiquette, en HTML (écran et impression). */
function labelHtml(d: ProductLabelData): string {
  const dlc = limitDate(d.product.shelfLifeDays);
  return `
    <div class="lbl">
      <div class="lbl-name">${esc(d.product.legalName)}</div>
      <div class="lbl-ing"><b>Ingrédients :</b> ${ingredientsHtml(d)}.</div>
      ${d.tracesText ? `<div class="lbl-tr">${esc(d.tracesText)}</div>` : ''}
      <div class="lbl-row">
        ${d.product.netWeightG !== null ? `<span><b>Poids net :</b> ${weight(d.product.netWeightG)}</span>` : ''}
        ${dlc ? `<span><b>À consommer jusqu'au :</b> ${dlc}</span>` : ''}
      </div>
      ${d.product.storageConditions ? `<div class="lbl-sm">${esc(d.product.storageConditions)}</div>` : ''}
      ${d.product.mentions ? `<div class="lbl-sm">${esc(d.product.mentions)}</div>` : ''}
    </div>`;
}

const LABEL_CSS = `
  .lbl { box-sizing: border-box; border: 1px solid #111; border-radius: 4px; padding: 6mm 5mm; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 9pt; line-height: 1.3; overflow: hidden; }
  .lbl-name { font-size: 13pt; font-weight: 700; margin-bottom: 2mm; }
  .lbl-ing { margin-bottom: 1.5mm; }
  .lbl-tr { font-style: italic; margin-bottom: 1.5mm; }
  .lbl-row { display: flex; gap: 6mm; flex-wrap: wrap; margin-top: 1mm; }
  .lbl-sm { font-size: 8pt; margin-top: 1mm; }`;

/** Planche A4 : huit étiquettes de 99 × 67 mm (2 colonnes × 4 lignes). */
function sheetHtml(d: ProductLabelData): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquette — ${esc(d.product.legalName)}</title>
    <style>
      @page { size: A4; margin: 10mm 6mm; }
      body { margin: 0; }
      .sheet { display: grid; grid-template-columns: repeat(2, 99mm); grid-auto-rows: 67mm; gap: 2mm 0; justify-content: center; }
      ${LABEL_CSS}
    </style></head><body><div class="sheet">${Array.from({ length: 8 }, () => labelHtml(d)).join('')}</div></body></html>`;
}

const field: React.CSSProperties = { width: '100%', fontSize: '0.875rem', padding: '8px 10px', border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', boxSizing: 'border-box' };
const label: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 };

export default function ProductLabelTab({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['product-label', productId], queryFn: () => productsApi.labelData(productId) });
  const [form, setForm] = useState({ legalName: '', storageConditions: '', labelMentions: '' });
  const [printing, setPrinting] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm({
      legalName: data.product.legalName === data.product.name ? '' : data.product.legalName,
      storageConditions: data.product.storageConditions ?? '', labelMentions: data.product.mentions ?? '',
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () => productsApi.saveLabelFields(productId, form),
    onSuccess: d => { qc.setQueryData(['product-label', productId], d); notify.success('Mentions enregistrées'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  if (isLoading || !data) return <div style={{ padding: 16 }}><Loader2 size={16} className="animate-spin" /></div>;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {data.blockers.length > 0 && (
        <StatusBanner tone="danger" icon={AlertTriangle} title="Étiquette non imprimable">
          <ul style={{ margin: 0, paddingLeft: 18 }}>{data.blockers.map(b => <li key={b}>{b}</li>)}</ul>
          {data.blockers.some(b => b.startsWith('Allergènes')) && <div style={{ marginTop: 4 }}>À renseigner dans Paramètres › Qualité des données › Allergènes.</div>}
        </StatusBanner>
      )}
      {data.warnings.length > 0 && (
        <StatusBanner tone="warning" icon={AlertTriangle} title="Mentions à compléter">
          <ul style={{ margin: 0, paddingLeft: 18 }}>{data.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </StatusBanner>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <label style={label} htmlFor="label-legal">Dénomination légale de vente</label>
          <input id="label-legal" style={field} maxLength={200} placeholder={data.product.name} value={form.legalName}
            onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))} />
        </div>
        <div>
          <label style={label} htmlFor="label-storage">Conditions de conservation</label>
          <input id="label-storage" style={field} maxLength={300} placeholder="À conserver entre 0 et 4 °C" value={form.storageConditions}
            onChange={e => setForm(f => ({ ...f, storageConditions: e.target.value }))} />
        </div>
        <div>
          <label style={label} htmlFor="label-mentions">Mentions libres</label>
          <input id="label-mentions" style={field} maxLength={500} placeholder="Origine, mode d'emploi, fabricant…" value={form.labelMentions}
            onChange={e => setForm(f => ({ ...f, labelMentions: e.target.value }))} />
        </div>
        <div>
          <button type="button" className="odoo-btn-secondary" disabled={save.isPending} onClick={() => save.mutate()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer les mentions
          </button>
        </div>
      </div>

      <div>
        <div style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}><Tag size={13} /> Aperçu de l'étiquette</div>
        {data.ingredients.length > 0 ? (
          <>
            <style>{LABEL_CSS}</style>
            <div style={{ maxWidth: 420, background: '#fff' }} dangerouslySetInnerHTML={{ __html: labelHtml(data) }} />
          </>
        ) : <div style={{ color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>Aucun ingrédient à afficher.</div>}
      </div>

      {data.ingredients.length > 0 && (
        <DataPanel><table className="odoo-table ds-dense">
          <thead><tr><th style={{ textAlign: 'left' }}>Ingrédient</th><th className="ds-num">Part du poids</th><th style={{ textAlign: 'left' }}>Allergènes</th></tr></thead>
          <tbody>
            {data.ingredients.map(i => (
              <tr key={i.ingredientId}>
                <td>{i.name}</td>
                <td className="ds-num">{i.sharePct === null ? '—' : `${i.sharePct.toLocaleString('fr-FR')} %`}</td>
                <td style={{ fontSize: '0.8rem' }}>
                  {!i.reviewed ? <span style={{ color: 'var(--ds-danger)', fontWeight: 600 }}>Non renseigné</span>
                    : i.contains.length + i.traces.length === 0 ? <span style={{ color: 'var(--theme-text-muted)' }}>Aucun</span>
                    : [i.contains.length ? `Contient : ${i.contains.join(', ')}` : '', i.traces.length ? `Traces : ${i.traces.join(', ')}` : ''].filter(Boolean).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table></DataPanel>
      )}

      <div>
        <button type="button" className="odoo-btn-primary" disabled={!data.printable} onClick={() => setPrinting(sheetHtml(data))}
          title={data.printable ? 'Planche A4 de huit étiquettes' : 'Impression refusée : voir les blocages ci-dessus'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Printer size={14} /> Imprimer une planche A4
        </button>
      </div>

      {printing && <PrintOverlay html={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
