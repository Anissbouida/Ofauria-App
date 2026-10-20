import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, AlertTriangle, X } from 'lucide-react';
import { payrollConfigApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { MONTH_NAMES, apiErrorMessage, saveBlobResponse } from '../shared';

const fmt = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ribBlocks = (r: string) => r.replace(/^(\d{3})(\d{3})(\d{16})(\d{2})$/, '$1 $2 $3 $4');

/**
 * Ordre de virement groupe des salaires du mois (mig 325) : bulletins payes
 * par virement (ou a payer), RIB controles (cle mod 97), fichier CSV a
 * importer sur le portail de la banque et lettre d'ordre de virement a signer.
 */
export default function SalaryTransferDialog({ month, year, onClose }: { month: number; year: number; onClose: () => void }) {
  const [includeUnpaid, setIncludeUnpaid] = useState(false);
  const { data, isLoading } = useQuery<Record<string, any>>({
    queryKey: ['payroll-transfer', month, year, includeUnpaid],
    queryFn: () => payrollConfigApi.transfer(month, year, includeUnpaid),
  });
  const download = async (format: 'csv' | 'pdf') => {
    try { saveBlobResponse(await payrollConfigApi.transferFile(month, year, includeUnpaid, format), `virement_salaires.${format}`); }
    catch (err) {
      // Reponse en blob : le message d'erreur JSON est dans le blob.
      const blob = (err as { response?: { data?: unknown } }).response?.data;
      let msg: string | null = null;
      if (blob instanceof Blob) { try { msg = JSON.parse(await blob.text()).error?.message ?? null; } catch { /* non JSON */ } }
      notify.error(msg || apiErrorMessage(err, 'Erreur'));
    }
  };
  const lines: Record<string, any>[] = data?.lines ?? [];
  const issues: Array<{ name: string; problem: string }> = data?.issues ?? [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Virement des salaires — {MONTH_NAMES[month - 1]} {year}</h2>
          <button onClick={onClose} className="odoo-pager-btn"><X size={16} /></button>
        </div>
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={includeUnpaid} onChange={e => setIncludeUnpaid(e.target.checked)} />
          Inclure les bulletins pas encore payés (préparer l'ordre avant de pointer les paiements par virement)
        </label>
        {!data?.employerRib && !isLoading && (
          <div className="odoo-alert warning" style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem' }}>
            <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} />
            RIB de l'entreprise absent : renseignez-le dans Paramètres de paie pour éditer la lettre d'ordre de virement.
          </div>
        )}
        {data?.employerRib && !data.employerRibValid && (
          <div className="odoo-alert warning" style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem' }}>
            Clé du RIB de l'entreprise incorrecte ({data.employerRib}) : vérifiez-le avant d'envoyer l'ordre.
          </div>
        )}
        {issues.length > 0 && (
          <div className="odoo-alert warning" style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem' }}>
            <strong>Exclus de l'ordre ({issues.length})</strong> — à corriger sur la fiche employé ou à payer autrement :
            <ul style={{ margin: '4px 0 0 16px', listStyle: 'disc' }}>{issues.map(i => <li key={i.name}>{i.name} : {i.problem}</li>)}</ul>
          </div>
        )}
        <table className="odoo-table">
          <thead><tr><th>Bénéficiaire</th><th>RIB</th><th>Banque</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.payrollId}><td>{l.name}</td><td style={{ fontFamily: 'monospace' }}>{ribBlocks(l.rib)}</td><td>{l.bankName ?? '—'}</td><td style={{ textAlign: 'right' }}>{fmt(l.amount)}</td></tr>
            ))}
            {!lines.length && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
              {isLoading ? 'Chargement…' : 'Aucun salaire à virer : bulletins payés en espèces, ou RIB manquants.'}</td></tr>}
          </tbody>
          {lines.length > 0 && <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={3}>{lines.length} virement(s)</td><td style={{ textAlign: 'right' }}>{fmt(data!.total)} DH</td></tr></tfoot>}
        </table>
        <div className="flex justify-end gap-2">
          <button className="odoo-btn-secondary" disabled={!lines.length} onClick={() => download('csv')}
            title="Fichier à importer sur le portail de la banque (bénéficiaire ; RIB ; banque ; montant ; motif)"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Download size={13} /> Fichier banque (CSV)</button>
          <button className="odoo-btn-primary" disabled={!lines.length || !data?.employerRib} onClick={() => download('pdf')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileText size={13} /> Ordre de virement (PDF)</button>
        </div>
      </div>
    </div>
  );
}
