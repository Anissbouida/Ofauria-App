import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, Trash2, FolderOpen } from 'lucide-react';
import { employeeDocumentsApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { apiErrorMessage, saveBlobResponse } from '../shared';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { SectionTitle, SubmitButton, fieldLabel, inputCls, panel, smallBtn } from '../ui';

export const DOC_TYPES: Record<string, string> = {
  cin: 'CIN', contrat: 'Contrat signé', avenant: 'Avenant signé', cnss: 'Attestation CNSS', diplome: 'Diplôme',
  certificat_medical: 'Certificat médical', visite_medicale: 'Visite médicale', rib: 'RIB', attestation: 'Attestation', photo: 'Photo', autre: 'Autre',
};

/**
 * Pièces du dossier salarié (PDF ou image, 5 Mo max), avec échéance pour les
 * pièces qui expirent (CIN, visite médicale…). Données personnelles : accès
 * réservé au droit Personnel.
 */
export default function EmployeeDocuments({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ docType: string; title: string; expiresOn: string } | null>(null);
  const { data: docs = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['employee-documents', employeeId],
    queryFn: () => employeeDocumentsApi.list(employeeId),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
    queryClient.invalidateQueries({ queryKey: ['hr-alerts'] });
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('docType', draft!.docType);
      fd.append('title', draft!.title || DOC_TYPES[draft!.docType]);
      if (draft!.expiresOn) fd.append('expiresOn', draft!.expiresOn);
      return employeeDocumentsApi.upload(employeeId, fd);
    },
    onSuccess: () => { refresh(); setDraft(null); notify.success('Document ajouté'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur lors de l\'envoi')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => employeeDocumentsApi.remove(id),
    onSuccess: () => { refresh(); notify.success('Document supprimé'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const download = async (d: Record<string, any>) => {
    try { saveBlobResponse(await employeeDocumentsApi.file(d.id), d.file_name); }
    catch (err) { notify.error(apiErrorMessage(err, 'Téléchargement impossible')); }
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SectionTitle icon={FolderOpen} actions={!draft && (
        <button type="button" className="odoo-btn-secondary" style={smallBtn}
          onClick={() => setDraft({ docType: 'contrat', title: '', expiresOn: '' })}><Upload size={11} /> Ajouter</button>
      )}>Documents</SectionTitle>
      {draft && (
        <div className="grid grid-cols-3 gap-3 items-end" style={panel}>
          <div><label style={fieldLabel}>Type</label>
            <select className={inputCls} value={draft.docType} onChange={e => setDraft({ ...draft, docType: e.target.value })}>
              {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label style={fieldLabel}>Titre</label>
            <input className={inputCls} value={draft.title} placeholder={DOC_TYPES[draft.docType]} onChange={e => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div><label style={fieldLabel}>Échéance (si elle expire)</label>
            <input className={inputCls} type="date" value={draft.expiresOn} onChange={e => setDraft({ ...draft, expiresOn: e.target.value })} />
          </div>
          <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
          <div className="col-span-3" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="odoo-btn-secondary" onClick={() => setDraft(null)}>Annuler</button>
            <SubmitButton pending={upload.isPending} onClick={() => fileRef.current?.click()}>
              {upload.isPending ? 'Envoi...' : 'Choisir le fichier (PDF/image, 5 Mo)'}
            </SubmitButton>
          </div>
        </div>
      )}
      {docs.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', margin: 0 }}>Aucun document.</p> : (
        <table className="odoo-table">
          <thead><tr><th>Type</th><th>Titre</th><th>Échéance</th><th style={{ textAlign: 'right' }}>Taille</th><th style={{ width: 60 }}></th></tr></thead>
          <tbody>
            {docs.map(d => {
              const expired = d.expires_on && d.expires_on < today;
              return (
                <tr key={d.id}>
                  <td>{DOC_TYPES[d.doc_type] ?? d.doc_type}</td>
                  <td>{d.title}</td>
                  <td style={{ color: expired ? '#dc3545' : undefined, fontSize: '0.75rem' }}>
                    {d.expires_on ? `${d.expires_on.slice(8, 10)}/${d.expires_on.slice(5, 7)}/${d.expires_on.slice(0, 4)}${expired ? ' (expiré)' : ''}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: '0.75rem' }}>{Math.max(1, Math.round(d.size_bytes / 1024))} Ko</td>
                  <td>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      <button className="odoo-pager-btn" title="Télécharger" onClick={() => download(d)}><Download size={12} /></button>
                      <button className="odoo-pager-btn" title="Supprimer" style={{ color: '#dc3545' }}
                        onClick={async () => {
                          if (!(await confirm(`Supprimer « ${d.title} » ?`, { title: 'Supprimer le document', confirmLabel: 'Supprimer', danger: true }))) return;
                          remove.mutate(d.id);
                        }}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
