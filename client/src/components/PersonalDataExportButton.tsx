import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import api from '../api/client';
import { notify } from './ui/InlineNotification';
import { apiErrorMessage } from '../api/errors';

/**
 * Droit d'accès de la loi 09-08 (G3-11) : télécharge en JSON toutes les données d'un
 * salarié ou d'un fournisseur (fiche, pièces liées, compte utilisateur sans secret).
 * Chaque export est tracé côté serveur.
 */
export default function PersonalDataExportButton({ kind, id, label = 'Exporter les données (loi 09-08)' }: {
  kind: 'employee' | 'supplier'; id: string; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const path = kind === 'employee' ? `/employees/${id}/personal-data` : `/suppliers/${id}/personal-data`;
      const data = (await api.get(path)).data.data;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind === 'employee' ? 'salarie' : 'fournisseur'}-${id}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      notify.success('Données exportées');
    } catch (e) {
      notify.error(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="odoo-btn-secondary" disabled={busy} onClick={() => void run()}
      title="Toutes les données de la personne, au format JSON (droit d'accès, loi 09-08)"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {label}
    </button>
  );
}
