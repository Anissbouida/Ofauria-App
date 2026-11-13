import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, MapPin, IdCard, CheckCircle2, AlertTriangle, Eye, HelpCircle, ExternalLink } from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';
import { settingsApi } from '../../api/settings.api';
import { serverUrl } from '../../api/client';
import CompanyBankAccounts, { formatRib } from './CompanyBankAccounts';
import ParametersPanel from './ParametersPanel';
import { settingAnchor } from './SettingsPrimitives';
import { useDirtyForm, useDraft } from './DirtyForms';
import type { SettingsPageKey } from './settingsPages';

/**
 * Page Société en « fiche d'identité » (refonte après S5) : carte d'en-tête (logo,
 * raison sociale, état de la fiche), trois blocs par thème aux largeurs adaptées,
 * contrôles pendant la saisie et aperçu en direct de l'en-tête de facture.
 * Un seul brouillon pour toute la fiche (nom commercial + identité légale, mig 326/331).
 */

const LEGAL_FORMS: [string, string][] = [
  ['', '—'], ['SARL', 'SARL'], ['SARL AU', 'SARL à associé unique'], ['SA', 'SA'], ['SAS', 'SAS'], ['SNC', 'SNC'],
  ['SCS', 'SCS'], ['EI', 'Entreprise individuelle'], ['AUTO_ENTREPRENEUR', 'Auto-entrepreneur'], ['COOPERATIVE', 'Coopérative'], ['AUTRE', 'Autre'],
];
/** Formes dont les factures doivent mentionner le capital social. */
const CAPITAL_FORMS = new Set(['SARL', 'SARL AU', 'SA', 'SAS']);

type Draft = Record<
  'companyName' | 'subtitle' | 'legalName' | 'legalForm' | 'legalCapital' | 'legalAddress' | 'legalCity' | 'legalPhone'
  | 'legalEmail' | 'legalWebsite' | 'legalIce' | 'legalIf' | 'legalRc' | 'legalPatente' | 'legalCommuneCode', string>;

type Hint = { tone: 'ok' | 'warn' | 'error'; text: string } | null;

const formLabel = (v: string) => LEGAL_FORMS.find(([k]) => k === v)?.[1] ?? v;
const initials = (s: string) => s.split(/\s+/).filter(w => /^[\p{L}\d]/u.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

export default function CompanyPage({ onOpen, onLeave }: {
  onOpen: (page: SettingsPageKey, anchor?: string) => void;
  onLeave: (href: string) => void;
}) {
  const { settings, updateSettings } = useSettings();
  const { data: accounts = [] } = useQuery({ queryKey: ['company-bank-accounts'], queryFn: settingsApi.bankAccounts, retry: false });

  const { draft: d, set, mark, changes, reset, adopt } = useDraft<Draft>({
    companyName: settings.companyName ?? '', subtitle: settings.subtitle ?? '',
    legalName: settings.legalName ?? '', legalForm: settings.legalForm ?? '',
    legalCapital: settings.legalCapital === null || settings.legalCapital === undefined ? '' : String(settings.legalCapital),
    legalAddress: settings.legalAddress ?? '', legalCity: settings.legalCity ?? '', legalPhone: settings.legalPhone ?? '',
    legalEmail: settings.legalEmail ?? '', legalWebsite: settings.legalWebsite ?? '', legalIce: settings.legalIce ?? '',
    legalIf: settings.legalIf ?? '', legalRc: settings.legalRc ?? '', legalPatente: settings.legalPatente ?? '',
    legalCommuneCode: settings.legalCommuneCode ?? '',
  });

  const iceDigits = d.legalIce.replace(/\s/g, '');
  const iceValid = /^\d{15}$/.test(iceDigits);
  const iceInvalid = !!iceDigits && !iceValid;
  const capitalInvalid = d.legalCapital !== '' && !(Number(d.legalCapital) >= 0);
  const capitalRequired = CAPITAL_FORMS.has(d.legalForm);

  useDirtyForm('company', {
    dirty: changes > 0, changes, reset,
    invalid: iceInvalid ? 'L\'ICE doit compter 15 chiffres.' : capitalInvalid ? 'Le capital social doit être un montant positif.' : null,
    save: async () => {
      await updateSettings({ ...d, legalCapital: d.legalCapital === '' ? null : Number(d.legalCapital) } as Partial<typeof settings>);
      adopt();
    },
  });

  const missing = (v: string, text: string): Hint => (v.trim() ? null : { tone: 'warn', text });
  const hints: Partial<Record<keyof Draft, Hint>> = {
    legalName: missing(d.legalName, 'Obligatoire sur les factures'),
    legalCapital: capitalInvalid ? { tone: 'error', text: 'Montant positif attendu' }
      : capitalRequired && !d.legalCapital ? { tone: 'warn', text: `Exigé sur les factures d'une ${formLabel(d.legalForm)}` } : null,
    legalIce: iceValid ? { tone: 'ok', text: '15 chiffres' }
      : iceInvalid ? { tone: 'error', text: `15 chiffres attendus (${iceDigits.length} saisis)` }
      : { tone: 'warn', text: 'Obligatoire sur les factures' },
    legalIf: missing(d.legalIf, 'Obligatoire sur les factures'),
    legalRc: missing(d.legalRc, 'Obligatoire sur les factures'),
    legalAddress: missing(d.legalAddress, 'Obligatoire sur les factures'),
    legalCommuneCode: missing(d.legalCommuneCode, 'Nécessaire pour l\'état 9421'),
  };

  // Complétude de la fiche : champs utiles aux documents légaux + un compte bancaire.
  const checks: [string, boolean][] = [
    ['Raison sociale', !!d.legalName.trim()], ['Forme juridique', !!d.legalForm],
    ...(capitalRequired ? [['Capital social', !!d.legalCapital && !capitalInvalid] as [string, boolean]] : []),
    ['Siège social', !!d.legalAddress.trim()], ['Ville', !!d.legalCity.trim()], ['Téléphone', !!d.legalPhone.trim()],
    ['E-mail', !!d.legalEmail.trim()], ['ICE', iceValid], ['Identifiant fiscal (IF)', !!d.legalIf.trim()],
    ['Registre de commerce (RC)', !!d.legalRc.trim()], ['Patente', !!d.legalPatente.trim()],
    ['Code commune DGI', !!d.legalCommuneCode.trim()],
  ];
  const activeAccounts = accounts.filter(a => a.is_active);
  const todo = checks.filter(([, ok]) => !ok);
  const total = checks.length + 1;
  const done = checks.length - todo.length + (activeAccounts.length ? 1 : 0);
  const pct = Math.round((done / total) * 100);
  const firstMissing = todo[0]?.[0] ?? (activeAccounts.length ? null : 'Comptes bancaires');
  const goToField = (title: string) => {
    const el = document.getElementById(settingAnchor(title));
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.querySelector<HTMLElement>('input, select')?.focus({ preventScroll: true });
  };

  const bank = activeAccounts.find(a => a.is_default && a.show_on_invoices) ?? activeAccounts.find(a => a.show_on_invoices);
  const displayName = d.legalName.trim() || d.companyName.trim() || 'Votre société';

  const field = (k: keyof Draft, label: string, input: ReactNode, opts: { help?: string; span?: number } = {}) => {
    const h = hints[k];
    const m = mark(k);
    return (
      <div id={settingAnchor(label)} className={`odoo-company-field${h?.tone === 'warn' ? ' todo' : ''}${h?.tone === 'error' ? ' error' : ''}`}
        style={opts.span ? { gridColumn: `span ${opts.span}` } : undefined}>
        <label htmlFor={`company-${k}`}>
          {label}
          {opts.help && <span className="odoo-company-help" title={opts.help} aria-label={opts.help}><HelpCircle size={12} /></span>}
          {m.changed && <span className="odoo-setting-changed">Modifié</span>}
          {m.changed && <button type="button" className="odoo-setting-revert" onClick={m.onRevert}>Rétablir</button>}
        </label>
        {input}
        {h && (
          <span className={`odoo-company-hint ${h.tone}`}>
            {h.tone === 'ok' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {h.text}
          </span>
        )}
      </div>
    );
  };
  const text = (k: keyof Draft, placeholder?: string, type = 'text') => (
    <input id={`company-${k}`} type={type} className="odoo-input" value={d[k]} placeholder={placeholder}
      onChange={e => set(k, e.target.value)} />
  );

  return (
    <div className="odoo-company">
      {/* ── Carte d'identité ── */}
      <section className="odoo-company-id" aria-label="Fiche société">
        <div className="odoo-company-logo">
          {settings.logoUrl ? <img src={serverUrl(settings.logoUrl)} alt="" /> : <span>{initials(displayName)}</span>}
          <button type="button" onClick={() => onOpen('print', settingAnchor('Logo'))}>Changer</button>
        </div>
        <div className="odoo-company-id-main">
          <div className="odoo-company-id-name">
            {displayName}
            {d.companyName.trim() && d.companyName.trim() !== displayName && <span> · nom commercial {d.companyName}</span>}
          </div>
          <div className="odoo-company-pills">
            {d.legalForm && <span className="odoo-company-pill">{formLabel(d.legalForm)}</span>}
            {d.legalCity.trim() && <span className="odoo-company-pill">{d.legalCity}</span>}
            {iceValid ? <span className="odoo-company-pill ok"><CheckCircle2 size={12} /> ICE valide</span>
              : <span className="odoo-company-pill warn"><AlertTriangle size={12} /> ICE à compléter</span>}
            {activeAccounts.length
              ? <span className="odoo-company-pill ok"><CheckCircle2 size={12} /> {activeAccounts.length} compte{activeAccounts.length > 1 ? 's' : ''} bancaire{activeAccounts.length > 1 ? 's' : ''}</span>
              : <span className="odoo-company-pill warn"><AlertTriangle size={12} /> Aucun compte bancaire</span>}
          </div>
        </div>
        <div className="odoo-company-progress">
          <span>Fiche complète à <strong>{pct} %</strong></span>
          <div className="odoo-company-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
          {firstMissing
            ? <button type="button" onClick={() => goToField(firstMissing)}>
                {total - done} point{total - done > 1 ? 's' : ''} à compléter →
              </button>
            : <span className="odoo-company-hint ok"><CheckCircle2 size={12} /> Tout est renseigné</span>}
        </div>
      </section>

      <div className="odoo-company-layout">
        <div className="odoo-company-forms">
          <section id={settingAnchor('Identité légale')} data-toc="Identité" className="odoo-company-card">
            <h3><span className="odoo-company-card-icon"><Building2 size={14} /></span>Identité</h3>
            <div className="odoo-company-grid" style={{ gridTemplateColumns: '2fr 1.4fr 1fr' }}>
              {field('legalName', 'Raison sociale', text('legalName'), { help: 'Nom légal (ex. « SARL ») sur les factures, bons de commande, bulletins et attestations' })}
              {field('companyName', 'Nom commercial', text('companyName'), { help: 'Affiché dans l\'application et sur les tickets' })}
              {field('legalForm', 'Forme juridique', (
                <select id="company-legalForm" className="odoo-input" value={d.legalForm} onChange={e => set('legalForm', e.target.value)}>
                  {LEGAL_FORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ))}
              {field('legalCapital', 'Capital social', text('legalCapital', 'ex. 100 000', 'number'), { help: 'En dirhams, mentionné sur les factures avec la forme juridique' })}
              {field('subtitle', 'Sous-titre', text('subtitle', 'Boulangerie & Pâtisserie'), { help: 'Texte affiché sous le logo', span: 2 })}
            </div>
          </section>

          <section id={settingAnchor('Coordonnées')} data-toc="Coordonnées" className="odoo-company-card">
            <h3><span className="odoo-company-card-icon"><MapPin size={14} /></span>Coordonnées</h3>
            <div className="odoo-company-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
              {field('legalAddress', 'Siège social', text('legalAddress'), { help: 'Adresse légale complète' })}
              {field('legalCity', 'Ville', text('legalCity'), { help: 'Utilisée dans « Fait à … » des attestations et pièces RH' })}
            </div>
            <div className="odoo-company-grid" style={{ gridTemplateColumns: '1fr 1.4fr 1.4fr', paddingTop: 0 }}>
              {field('legalPhone', 'Téléphone', text('legalPhone', '05 22 00 00 00', 'tel'))}
              {field('legalEmail', 'E-mail', text('legalEmail', 'contact@exemple.ma', 'email'))}
              {field('legalWebsite', 'Site web', text('legalWebsite', 'www.exemple.ma'))}
            </div>
          </section>

          <section id={settingAnchor('Identifiants fiscaux et sociaux')} data-toc="Identifiants" className="odoo-company-card">
            <h3>
              <span className="odoo-company-card-icon"><IdCard size={14} /></span>Identifiants fiscaux et sociaux
              <span className="odoo-company-card-note">Format vérifié pendant la saisie</span>
            </h3>
            <div className="odoo-company-grid odoo-company-ids">
              {field('legalIce', 'ICE', text('legalIce', '000000000000000'), { help: 'Identifiant commun de l\'entreprise : 15 chiffres' })}
              {field('legalIf', 'Identifiant fiscal (IF)', text('legalIf'))}
              {field('legalRc', 'Registre de commerce (RC)', text('legalRc'))}
              {field('legalPatente', 'Patente', text('legalPatente'), { help: 'Numéro de patente du siège (chaque établissement peut avoir la sienne)' })}
              {field('legalCommuneCode', 'Code commune DGI', text('legalCommuneCode', '111.01.01'), { help: 'Commune du siège selon le référentiel de la DGI (état 9421, Simpl-IR)' })}
              <div id={settingAnchor('N° CNSS')} className="odoo-company-field">
                <label>N° CNSS <span className="odoo-company-help" title="Tenu dans Personnel › Paie › Paramètres de paie (déclarations sociales)"><HelpCircle size={12} /></span></label>
                <div className="odoo-company-readonly">
                  <span>{settings.employerCnssNumber || 'Non renseigné'}</span>
                  <button type="button" onClick={() => onLeave('/employees?tab=payroll')}>Paie <ExternalLink size={11} /></button>
                </div>
              </div>
            </div>
          </section>

          <section className="odoo-company-card odoo-company-bank">
            <CompanyBankAccounts />
          </section>

          <ParametersPanel keys={['company.country_code']} />
        </div>

        {/* ── Aperçu de l'en-tête de facture ── */}
        <aside className="odoo-company-preview" aria-label="Aperçu sur une facture">
          <div className="odoo-company-preview-title"><Eye size={13} /> Aperçu sur une facture</div>
          <div className="odoo-company-paper">
            <div className="odoo-company-paper-head">
              <div>
                <div className="odoo-company-paper-name">{displayName}</div>
                {d.legalForm && (
                  <div>
                    {formLabel(d.legalForm)}
                    {capitalRequired && (d.legalCapital && !capitalInvalid
                      ? <> au capital de {Number(d.legalCapital).toLocaleString('fr-FR')} DH</>
                      : <> au capital de <span className="miss">à compléter</span></>)}
                  </div>
                )}
              </div>
              <strong>FACTURE</strong>
            </div>
            <div>{d.legalAddress || <span className="miss">Siège social</span>}</div>
            <div>{d.legalCity}</div>
            {(d.legalPhone || d.legalEmail) && <div>{[d.legalPhone, d.legalEmail].filter(Boolean).join(' · ')}</div>}
            {d.legalWebsite && <div>{d.legalWebsite}</div>}
            <hr />
            <div>ICE {iceValid ? iceDigits : <span className="miss">{iceDigits || 'à compléter'}</span>}</div>
            <div>IF {d.legalIf || <span className="miss">—</span>} · RC {d.legalRc || <span className="miss">—</span>}</div>
            {d.legalPatente && <div>Patente {d.legalPatente}</div>}
            <hr />
            {bank
              ? <><div>{bank.bank_name}</div><div className="mono">RIB {formatRib(bank.rib)}</div></>
              : <span className="miss">Aucun compte bancaire sur les factures</span>}
          </div>
          <p className="odoo-company-preview-note">
            Se met à jour pendant la saisie. Le modèle de document peut masquer certaines mentions
            {' '}(<button type="button" onClick={() => onOpen('documents')}>Documents</button>).
          </p>
        </aside>
      </div>
    </div>
  );
}
