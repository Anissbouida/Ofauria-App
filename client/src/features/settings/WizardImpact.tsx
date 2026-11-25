import { MODULE_LABELS, type AppModule } from '@ofauria/shared';
import type { ModuleImpact } from '../../api/settings.api';

export default function WizardImpact({ impact }: { impact: ModuleImpact }) {
  const label = (code: string) => MODULE_LABELS[code as AppModule] ?? code;
  return <div className="wz-box" style={{ padding: 0 }}><h3>Analyse d’impact sur la configuration active</h3>
    <div className="ds-form-grid">{[['Modules ajoutés',impact.modulesOn],['Modules masqués',impact.modulesOff],['Capacités ajoutées',impact.featuresOn],['Capacités masquées',impact.featuresOff]].map(([title, values]) => <div className="ds-entry-card" key={title as string}><strong>{title as string}</strong><span className="wz-muted">{(values as string[]).length ? (values as string[]).map(label).join(', ') : 'Aucun changement'}</span></div>)}</div>
    {impact.roles.length > 0 && <div className="ds-scroll"><table className="odoo-table"><thead><tr><th>Rôle touché</th><th>Accès ajoutés</th><th>Accès masqués</th></tr></thead><tbody>{impact.roles.map(r => <tr key={r.code}><td>{r.label}</td><td>{r.gained.map(label).join(', ') || '—'}</td><td>{r.lost.map(label).join(', ') || '—'}</td></tr>)}</tbody></table></div>}
    {impact.hidden.length > 0 && <div className="ds-scroll"><table className="odoo-table"><thead><tr><th>Données conservées mais masquées</th><th className="ds-num">Nombre</th></tr></thead><tbody>{impact.hidden.map((r,i) => <tr key={`${r.scope}:${r.label}:${i}`}><td>{r.scope} · {r.label}</td><td className="ds-num">{r.count}</td></tr>)}</tbody></table></div>}
    <div className="ds-alert info">Aperçu en lecture seule. Il ne constitue pas une simulation transactionnelle ni une autorisation de mise en service.</div>
  </div>;
}
