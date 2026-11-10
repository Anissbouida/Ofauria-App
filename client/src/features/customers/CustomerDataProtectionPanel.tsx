import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Download, UserX } from 'lucide-react';
import { customersApi } from '../../api/customers.api';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';

// Protection des données — loi 09-08 (phase 4.6) : consentement, export, et
// anonymisation (effacement qui préserve la comptabilité).

export default function CustomerDataProtectionPanel({ customerId, marketingConsent, anonymizedAt }: {
  customerId: string; marketingConsent: boolean; anonymizedAt: string | null;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [consent, setConsent] = useState(marketingConsent);

  const consentMut = useMutation({
    mutationFn: (v: boolean) => customersApi.setConsent(customerId, v),
    onSuccess: (_d, v) => { setConsent(v); qc.invalidateQueries({ queryKey: ['customer', customerId] }); qc.invalidateQueries({ queryKey: ['customer-history', customerId] }); },
    onError: () => notify.error('Échec de l\'enregistrement du consentement'),
  });

  const anonymizeMut = useMutation({
    mutationFn: () => customersApi.anonymize(customerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', customerId] });
      qc.invalidateQueries({ queryKey: ['customer-history', customerId] });
      notify.success('Client anonymisé');
    },
    onError: () => notify.error('Impossible d\'anonymiser'),
  });

  const doExport = async () => {
    try {
      const data = await customersApi.exportData(customerId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `client-${customerId}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch { notify.error('Échec de l\'export'); }
  };

  const askAnonymize = async () => {
    if (await confirm('Anonymiser définitivement ce client ? Ses données personnelles (nom, contacts, identifiants, adresses) seront effacées ; sa comptabilité (factures, créances) est conservée. Action irréversible.',
      { title: 'Anonymiser (loi 09-08)', confirmLabel: 'Anonymiser', danger: true })) {
      anonymizeMut.mutate();
    }
  };

  if (anonymizedAt) {
    return (
      <div style={{ marginTop: 10, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <ShieldCheck size={13} /> Client anonymisé (loi 09-08) — données personnelles effacées, comptabilité conservée.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--odoo-text-muted)', marginBottom: 6 }}>
        <ShieldCheck size={12} /> Protection des données (loi 09-08)
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={consent} disabled={consentMut.isPending} onChange={e => consentMut.mutate(e.target.checked)} />
        Consentement marketing (prospection, communications)
      </label>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={doExport}>
          <Download size={13} /> Exporter les données
        </button>
        <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#dc3545' }}
          onClick={askAnonymize} disabled={anonymizeMut.isPending}>
          <UserX size={13} /> Anonymiser
        </button>
      </div>
    </div>
  );
}
