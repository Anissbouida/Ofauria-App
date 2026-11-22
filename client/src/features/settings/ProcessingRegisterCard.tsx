import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { settingsApi } from '../../api/settings.api';
import { StatusTag } from '../../components/ui/StatusTag';
import { DataPanel, LoadingState, SectionHeader } from '../../components/ds';

/**
 * Registre des traitements de données personnelles (loi 09-08, G3-11) : ce que
 * l'application traite, pourquoi, pour qui, et les droits qu'elle permet d'exercer.
 * Les durées de conservation et la base légale relèvent du responsable du traitement
 * (déclarations à la CNDP) : elles ne figurent pas ici.
 */
export default function ProcessingRegisterCard() {
  const { data = [], isLoading } = useQuery({ queryKey: ['processing-register'], queryFn: settingsApi.processingRegister });
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><ShieldCheck size={16} aria-hidden="true" /> Registre des traitements (loi 09-08)</span>} />
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ds-muted)' }}>
        Données personnelles traitées par l'application et droits exerçables. Les durées de conservation et la base légale de chaque
        traitement sont à fixer par le responsable du traitement avec son conseil (déclarations à la CNDP).
      </p>
      {isLoading ? <LoadingState bare /> : (
        <DataPanel label="Registre des traitements">
          <table className="odoo-table">
            <thead><tr>
              <th>Traitement</th>
              <th>Finalité</th>
              <th>Données</th>
              <th>Destinataires</th>
              <th>Droits</th>
            </tr></thead>
            <tbody>
              {data.map(t => (
                <tr key={t.key} style={{ verticalAlign: 'top' }}>
                  <td className="ds-strong">{t.label}</td>
                  <td>{t.purpose}</td>
                  <td>{t.data}</td>
                  <td>{t.recipients}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                      <StatusTag tone={t.rights.access ? 'done' : 'draft'} label={t.rights.access ? 'Accès' : 'Pas d\'accès'} />
                      <StatusTag tone={t.rights.erasure ? 'done' : 'draft'} label={t.rights.erasure ? 'Effacement' : 'Pas d\'effacement'} />
                    </div>
                    <span style={{ color: 'var(--ds-muted)' }}>{t.rights.note}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
    </section>
  );
}
