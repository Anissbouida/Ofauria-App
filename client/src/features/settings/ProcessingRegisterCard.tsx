import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { settingsApi } from '../../api/settings.api';
import { StatusTag } from '../../components/ui/StatusTag';

/**
 * Registre des traitements de données personnelles (loi 09-08, G3-11) : ce que
 * l'application traite, pourquoi, pour qui, et les droits qu'elle permet d'exercer.
 * Les durées de conservation et la base légale relèvent du responsable du traitement
 * (déclarations à la CNDP) : elles ne figurent pas ici.
 */
export default function ProcessingRegisterCard() {
  const { data = [], isLoading } = useQuery({ queryKey: ['processing-register'], queryFn: settingsApi.processingRegister });
  return (
    <section className="prj-panel" style={{ padding: '16px 18px', display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={16} /> Registre des traitements (loi 09-08)
      </h3>
      <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ds-muted)' }}>
        Données personnelles traitées par l'application et droits exerçables. Les durées de conservation et la base légale de chaque
        traitement sont à fixer par le responsable du traitement avec son conseil (déclarations à la CNDP).
      </p>
      {isLoading ? <Loader2 size={16} className="animate-spin" /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table" style={{ width: '100%' }}>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Traitement</th>
              <th style={{ textAlign: 'left' }}>Finalité</th>
              <th style={{ textAlign: 'left' }}>Données</th>
              <th style={{ textAlign: 'left' }}>Destinataires</th>
              <th style={{ textAlign: 'left' }}>Droits</th>
            </tr></thead>
            <tbody>
              {data.map(t => (
                <tr key={t.key} style={{ verticalAlign: 'top' }}>
                  <td style={{ fontWeight: 500 }}>{t.label}</td>
                  <td style={{ fontSize: '0.8rem' }}>{t.purpose}</td>
                  <td style={{ fontSize: '0.8rem' }}>{t.data}</td>
                  <td style={{ fontSize: '0.8rem' }}>{t.recipients}</td>
                  <td style={{ fontSize: '0.8rem' }}>
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
        </div>
      )}
    </section>
  );
}
