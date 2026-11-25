import { MODULE_LABELS, type AppModule } from '@ofauria/shared';
import type { ModuleImpact } from '../../api/settings.api';
import type { RefScopePreview } from '../../api/referentiel.api';

export default function WizardImpact({ impact }: { impact: ModuleImpact }) {
  const label = (code: string) => MODULE_LABELS[code as AppModule] ?? code;
  return <div className="wz-box" style={{ padding: 0 }}><h3>Analyse d’impact sur la configuration active</h3>
    <div className="ds-form-grid">{[['Modules ajoutés',impact.modulesOn],['Modules masqués',impact.modulesOff],['Capacités ajoutées',impact.featuresOn],['Capacités masquées',impact.featuresOff]].map(([title, values]) => <div className="ds-entry-card" key={title as string}><strong>{title as string}</strong><span className="wz-muted">{(values as string[]).length ? (values as string[]).map(label).join(', ') : 'Aucun changement'}</span></div>)}</div>
    {impact.roles.length > 0 && <div className="ds-scroll"><table className="odoo-table"><thead><tr><th>Rôle touché</th><th>Accès ajoutés</th><th>Accès masqués</th></tr></thead><tbody>{impact.roles.map(r => <tr key={r.code}><td>{r.label}</td><td>{r.gained.map(label).join(', ') || '—'}</td><td>{r.lost.map(label).join(', ') || '—'}</td></tr>)}</tbody></table></div>}
    {impact.hidden.length > 0 && <div className="ds-scroll"><table className="odoo-table"><thead><tr><th>Données conservées mais masquées</th><th className="ds-num">Nombre</th></tr></thead><tbody>{impact.hidden.map((r,i) => <tr key={`${r.scope}:${r.label}:${i}`}><td>{r.scope} · {r.label}</td><td className="ds-num">{r.count}</td></tr>)}</tbody></table></div>}
    <div className="ds-alert info">Aperçu en lecture seule. Il ne constitue pas une simulation transactionnelle ni une autorisation de mise en service.</div>
  </div>;
}

/** Mig 698 : listes de valeurs que l'activation adaptera au secteur et aux spécialités retenus. */
export function WizardReferentials({ preview }: { preview: RefScopePreview }) {
  const changed = preview.tables.filter(t => t.activated.length + t.deactivated.length > 0);
  const short = (v: string[]) => (v.length > 6 ? `${v.slice(0, 6).join(', ')} et ${v.length - 6} autre(s)` : v.join(', '));
  return <div className="wz-box" style={{ padding: 0 }}><h3>Référentiels adaptés au secteur</h3>
    {changed.length === 0
      ? <div className="ds-alert info">Les listes de valeurs correspondent déjà aux profils et spécialités retenus.</div>
      : <div className="ds-scroll"><table className="odoo-table ds-dense"><thead><tr><th style={{ width: 240 }}>Liste</th><th>Valeurs proposées</th><th>Valeurs retirées des listes</th></tr></thead><tbody>
          {changed.map(t => <tr key={t.table_id}><td className="ds-strong">{t.label}</td><td>{short(t.activated) || '—'}</td><td className="wz-muted">{short(t.deactivated) || '—'}</td></tr>)}
        </tbody></table></div>}
    <div className="ds-alert info">Une valeur déjà utilisée par vos données reste disponible ; rien n’est supprimé. Vous pourrez compléter ou ajuster chaque liste dans Paramètres › Référentiel.</div>
  </div>;
}
