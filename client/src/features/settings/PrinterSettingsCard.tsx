import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, Plus, Pencil, Trash2, Zap, CheckCircle2 } from 'lucide-react';
import { printersApi, type PrinterConfig, type SystemPrinter } from '../../api/printer.api';
import { Search, Usb } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { DataPanel, EmptyState, FormField, FormFooter, LoadingState } from '../../components/ds';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu } from '../../components/ui/RowMenu';

const PRINTER_MODELS = ['EPSON', 'STAR', 'TANCA', 'DARUMA', 'BROTHER', 'CUSTOM'] as const;
const TYPES: Array<{ value: PrinterConfig['type']; label: string }> = [
  { value: 'receipt', label: 'Ticket de vente' },
  { value: 'kitchen', label: 'Cuisine' },
  { value: 'label', label: 'Etiquette' },
];

type FormData = {
  name: string;
  type: PrinterConfig['type'];
  interface: PrinterConfig['interface'];
  connectionString: string;
  printerModel: PrinterConfig['printer_model'];
  paperWidth: number;
  isDefault: boolean;
  openDrawerOnCash: boolean;
};

const EMPTY_FORM: FormData = {
  name: '', type: 'receipt', interface: 'tcp', connectionString: '',
  printerModel: 'EPSON', paperWidth: 48, isDefault: true, openDrawerOnCash: true,
};

export default function PrinterSettingsCard() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<PrinterConfig | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);

  const { data: printers = [], isLoading } = useQuery({
    queryKey: ['printers'],
    queryFn: printersApi.list,
  });
  // Détection (mig 376) : files d'impression et imprimantes USB vues par la machine du serveur.
  const [detect, setDetect] = useState(false);
  const systemQuery = useQuery({ queryKey: ['printers-system'], queryFn: printersApi.system, enabled: detect });
  const [attachName, setAttachName] = useState('Caisse');
  const attachMutation = useMutation({
    mutationFn: (p: SystemPrinter) => printersApi.attachSystem(attachName, p.uri),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['printers-system'] }); notify.success('File d\'impression créée : choisissez-la ci-dessous'); },
    onError: (err: unknown) => notify.error((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Impossible de créer la file'),
  });
  const selectQueue = (p: SystemPrinter) => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, name: form.name || p.name, interface: 'cups', connectionString: p.name });
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => editing
      ? printersApi.update(editing.id, form)
      : printersApi.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['printers'] });
      notify.success(editing ? 'Imprimante mise a jour' : 'Imprimante ajoutee');
      resetForm();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Erreur lors de l\'enregistrement');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => printersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['printers'] });
      notify.success('Imprimante supprimée');
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => printersApi.test(id),
    onSuccess: () => notify.success('Test imprime — verifier le ticket'),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Test echoue (imprimante injoignable ?)');
    },
  });

  const drawerMutation = useMutation({
    mutationFn: (id: string) => printersApi.openDrawer(id),
    onSuccess: () => notify.success('Tiroir ouvert'),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Echec ouverture tiroir');
    },
  });

  const resetForm = () => {
    setEditing(null);
    setShowForm(false);
    setForm(EMPTY_FORM);
  };

  const startEdit = (p: PrinterConfig) => {
    setEditing(p);
    setShowForm(true);
    setForm({
      name: p.name, type: p.type, interface: p.interface,
      connectionString: p.connection_string,
      printerModel: p.printer_model, paperWidth: p.paper_width,
      isDefault: p.is_default, openDrawerOnCash: p.open_drawer_on_cash,
    });
  };

  return (
    <section className="odoo-setting-section" id="set-imprimantes-physiques" data-toc="Imprimantes physiques">
      <div className="odoo-setting-section-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h3 className="odoo-setting-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Printer size={17} aria-hidden="true" style={{ color: 'var(--ds-accent)' }} /> Imprimantes physiques
          </h3>
          <p className="odoo-setting-section-help">
            Connexion directe ESC/POS (TCP ou USB). Necessaire pour ouvrir le tiroir-caisse.
          </p>
        </div>
        {!showForm && (
          <button type="button" onClick={() => { setShowForm(true); setEditing(null); setForm(EMPTY_FORM); }}
            className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} aria-hidden="true" /> Ajouter
          </button>
        )}
      </div>
      <div style={{ padding: '14px 18px 18px', display: 'grid', gap: 16 }}>

      {/* Liste */}
      {isLoading ? (
        <LoadingState bare />
      ) : printers.length === 0 && !showForm ? (
        <EmptyState icon={Printer} bare title="Aucune imprimante configurée"
          text="L'impression passera par le navigateur (sans tiroir-caisse)." />
      ) : printers.length > 0 && (
        <DataPanel label="Imprimantes physiques">
          <table className="odoo-table">
            <thead><tr><th>Nom</th><th>Type</th><th>Connexion</th><th className="ds-num">Largeur (car.)</th><th className="ds-actions" /></tr></thead>
            <tbody>
              {printers.map(p => (
                <tr key={p.id}>
                  <td>
                    <span className="ds-strong">{p.name}</span>
                    {p.is_default && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 8 }}>Par défaut</span>}
                  </td>
                  <td>{TYPES.find(t => t.value === p.type)?.label}</td>
                  <td><span className="ds-ref" style={{ fontWeight: 400 }}>{p.printer_model} · {p.interface}://{p.connection_string}</span></td>
                  <td className="ds-num">{p.paper_width}</td>
                  <td className="ds-actions">
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" onClick={() => testMutation.mutate(p.id)} disabled={testMutation.isPending}
                        className="odoo-btn-secondary ds-btn-sm">
                        <CheckCircle2 size={13} aria-hidden="true" /> Tester
                      </button>
                      <RowMenu label={`Plus d'actions pour ${p.name}`} items={[
                        { label: 'Ouvrir le tiroir', icon: Zap, disabled: drawerMutation.isPending, onSelect: () => drawerMutation.mutate(p.id) },
                        { label: 'Modifier', icon: Pencil, onSelect: () => startEdit(p) },
                        { label: 'Supprimer', icon: Trash2, danger: true, onSelect: async () => { if (await confirm(`Supprimer l'imprimante « ${p.name} » ?`, { title: 'Supprimer l\'imprimante', confirmLabel: 'Supprimer', danger: true })) deleteMutation.mutate(p.id); } },
                      ]} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}

      {/* Détection sur le poste serveur (mig 376) */}
      <div style={{ borderTop: '1px solid var(--ds-hair)', paddingTop: 12, display: 'grid', gap: 12 }}>
        <div>
          <button type="button" onClick={() => setDetect(true)} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Search size={14} aria-hidden="true" /> Détecter les imprimantes du poste
          </button>
        </div>
        {detect && (
          <div style={{ display: 'grid', gap: 8, fontSize: 14 }}>
            {systemQuery.isLoading && <LoadingState bare label="Recherche…" />}
            {systemQuery.data && !systemQuery.data.available && (
              <p style={{ margin: 0, color: 'var(--ds-warning)' }}>Aucun système d'impression sur la machine du serveur (CUPS absent). Une thermique USB doit être branchée sur la machine qui fait tourner Kalum, ou être en réseau (TCP).</p>
            )}
            {systemQuery.data?.available && systemQuery.data.printers.length === 0 && <p style={{ margin: 0, color: 'var(--ds-muted)' }}>Aucune imprimante détectée.</p>}
            {!!systemQuery.data?.printers.length && (
              <DataPanel label="Imprimantes détectées">
                <table className="odoo-table">
                  <thead><tr><th>Imprimante</th><th>Adresse</th><th className="ds-actions" /></tr></thead>
                  <tbody>
                    {systemQuery.data.printers.map(p => (
                      <tr key={p.uri}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            {p.kind === 'usb' ? <Usb size={16} aria-hidden="true" style={{ color: 'var(--ds-accent)' }} /> : <Printer size={16} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />}
                            <span className="ds-strong">{p.name}</span>
                          </span>
                        </td>
                        <td><span className="ds-ref" style={{ fontWeight: 400 }}>{p.uri}</span>{p.status ? <span style={{ color: 'var(--ds-muted)' }}> · {p.status}</span> : ''}</td>
                        <td className="ds-actions">
                          {p.kind === 'queue' ? (
                            <button type="button" onClick={() => selectQueue(p)} className="odoo-btn-secondary ds-btn-sm">Utiliser cette file</button>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                              <input value={attachName} onChange={e => setAttachName(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))}
                                className="ds-input sm" style={{ width: 120 }} placeholder="Nom de file" aria-label={`Nom de la file pour ${p.name}`} />
                              <button type="button" onClick={() => attachMutation.mutate(p)} disabled={attachMutation.isPending || !attachName} className="odoo-btn-primary ds-btn-sm">Ajouter au système</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataPanel>
            )}
            {systemQuery.data?.available && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-muted)' }}>Une imprimante USB doit d'abord être ajoutée au système (file brute), puis déclarée ici avec l'interface « Système ».</p>
            )}
          </div>
        )}
      </div>

      {/* Formulaire */}
      {showForm && (
        <form className="ds-panel" style={{ padding: '16px 18px', display: 'grid', gap: 14 }}
          onSubmit={e => { e.preventDefault(); if (form.name && form.connectionString && !saveMutation.isPending) saveMutation.mutate(); }}>
          <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--ds-ink)' }}>{editing ? 'Modifier' : 'Nouvelle imprimante'}</h4>
          <div className="ds-form-grid">
            <div style={{ gridColumn: '1 / -1' }}>
              <FormField label="Nom" htmlFor="printer-name" required>
                <input id="printer-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: Caisse principale" className="ds-input" />
              </FormField>
            </div>

            <FormField label="Type" htmlFor="printer-type">
              <select id="printer-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PrinterConfig['type'] })}
                className="ds-input">
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </FormField>

            <FormField label="Modèle" htmlFor="printer-model">
              <select id="printer-model" value={form.printerModel} onChange={(e) => setForm({ ...form, printerModel: e.target.value as PrinterConfig['printer_model'] })}
                className="ds-input">
                {PRINTER_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormField>

            <FormField label="Interface" htmlFor="printer-interface">
              <select id="printer-interface" value={form.interface} onChange={(e) => setForm({ ...form, interface: e.target.value as PrinterConfig['interface'] })}
                className="ds-input">
                <option value="tcp">TCP (reseau)</option>
                <option value="cups">Système du poste (file d'impression)</option>
                <option value="usb">USB</option>
                <option value="serial">Serie</option>
              </select>
            </FormField>

            <FormField label="Largeur (car. par ligne)" htmlFor="printer-width">
              <select id="printer-width" value={form.paperWidth} onChange={(e) => setForm({ ...form, paperWidth: parseInt(e.target.value) })}
                className="ds-input">
                <option value={32}>32 (papier 58 mm)</option>
                <option value={42}>42 (intermediaire)</option>
                <option value={48}>48 (papier 80 mm)</option>
                <option value={64}>64 (papier large)</option>
              </select>
            </FormField>

            <div style={{ gridColumn: '1 / -1' }}>
              <FormField label="Chaîne de connexion" htmlFor="printer-conn" required hint={<>
                {form.interface === 'tcp' && 'IP fixe recommandee. Port standard 9100. Tester avec : telnet IP 9100'}
                {form.interface === 'cups' && 'File d\'impression du système de la machine serveur, créée en mode brut (voir « Détecter »)'}
                {form.interface === 'usb' && 'Necessite un agent local sur le poste caisse'}
                {form.interface === 'serial' && 'Port serie RS-232 (rare aujourd\'hui)'}
              </>}>
                <input id="printer-conn" value={form.connectionString} onChange={(e) => setForm({ ...form, connectionString: e.target.value })}
                  placeholder={
                    form.interface === 'tcp' ? 'tcp://192.168.1.100:9100' :
                    form.interface === 'cups' ? 'Nom de la file (ex. Caisse)' :
                    form.interface === 'usb' ? 'usb:///dev/usb/lp0 ou printer://NomImprimanteWindows' :
                    '/dev/ttyUSB0'
                  }
                  className="ds-input" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }} />
              </FormField>
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
                Par defaut pour ce type
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.openDrawerOnCash}
                  onChange={(e) => setForm({ ...form, openDrawerOnCash: e.target.checked })} />
                Ouvrir tiroir sur paiement espèces
              </label>
            </div>
          </div>

          <FormFooter onCancel={resetForm} busy={saveMutation.isPending}
            disabled={!form.name || !form.connectionString} />
        </form>
      )}
      </div>
    </section>
  );
}
