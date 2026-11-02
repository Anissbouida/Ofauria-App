import { useState } from 'react';
import { FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { editionsApi } from '../../api/ledger.api';
import type { EditionKind, EditionParams } from '../../api/ledger.api';

/**
 * Boutons d'édition d'un état comptable : PDF imprimable (en-tête légal,
 * pagination, reports de page) et Excel, générés par le serveur avec les mêmes
 * filtres que l'écran.
 */
export default function EditionButtons({ kind, params, disabled }: { kind: EditionKind; params: EditionParams; disabled?: boolean }) {
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const run = async (format: 'pdf' | 'xlsx') => {
    setBusy(format);
    try {
      await editionsApi.download(kind, format, params);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Édition impossible');
    } finally {
      setBusy(null);
    }
  };
  const btn = (format: 'pdf' | 'xlsx', label: string, Icon: typeof FileText) => (
    <button type="button" className="odoo-btn-secondary" disabled={disabled || !!busy} onClick={() => run(format)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: disabled ? 0.5 : 1 }}
      title={format === 'pdf' ? 'Édition imprimable (en-tête légal, pages numérotées)' : 'Classeur Excel'}>
      {busy === format ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />} {label}
    </button>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      {btn('pdf', 'PDF', FileText)}
      {btn('xlsx', 'Excel', FileSpreadsheet)}
    </span>
  );
}
