import { describe, it, expect, afterEach } from 'vitest';
import { MODULE_LABELS, formatMoney } from '@ofauria/shared';
import {
  t, translate, interpolate, dirOf, applyDocumentLocale, setCurrentLocale, getLocale,
  formatNumber, DICTIONARIES, isLocale,
} from '../core';
import { fr } from '../fr';
import type { Dictionary, TranslationKey } from '../types';
import { navLabel, navGroupTitle, NAV_GROUPS, NAV_HOME } from '../../config/navigation';

afterEach(() => setCurrentLocale('fr'));

describe('G6-05 — t() et translate()', () => {
  it('traduit dans la langue demandée', () => {
    expect(translate('fr', 'common.save')).toBe('Enregistrer');
    expect(translate('ar', 'common.save')).toBe('حفظ');
    expect(translate('en', 'common.save')).toBe('Save');
  });

  it('retombe sur le français quand la clé manque dans la langue', () => {
    const saved = DICTIONARIES.en['common.cancel'];
    delete (DICTIONARIES.en as Dictionary)['common.cancel'];
    try {
      expect(translate('en', 'common.cancel')).toBe('Annuler');
    } finally {
      (DICTIONARIES.en as Dictionary)['common.cancel'] = saved;
    }
  });

  it('rend la clé elle-même si elle est inconnue partout (repérable à l\'écran)', () => {
    expect(translate('ar', 'clé.inconnue' as TranslationKey)).toBe('clé.inconnue');
  });

  it('remplace les paramètres, laisse un jeton sans valeur intact', () => {
    expect(translate('en', 'common.error.server', { status: 503 })).toBe('Server error (503)');
    expect(translate('fr', 'auth.continueWith', { provider: 'Google' })).toBe('Continuer avec Google');
    expect(interpolate('{a} et {b}', { a: 1 })).toBe('1 et {b}');
    expect(interpolate('sans paramètre')).toBe('sans paramètre');
  });

  it('t() suit la langue courante', () => {
    setCurrentLocale('ar');
    expect(getLocale()).toBe('ar');
    expect(t('header.logout')).toBe('تسجيل الخروج');
    setCurrentLocale('en');
    expect(t('header.logout')).toBe('Sign out');
  });

  it('isLocale ne reconnaît que fr, ar, en', () => {
    expect(['fr', 'ar', 'en'].every(isLocale)).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('G6-05 — sens d\'écriture', () => {
  it('arabe = rtl, français et anglais = ltr', () => {
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('fr')).toBe('ltr');
    expect(dirOf('en')).toBe('ltr');
  });

  it('pose lang et dir sur <html>', () => {
    const doc = { documentElement: { lang: 'fr', dir: '' } };
    applyDocumentLocale('ar', doc);
    expect(doc.documentElement).toEqual({ lang: 'ar', dir: 'rtl' });
    applyDocumentLocale('en', doc);
    expect(doc.documentElement).toEqual({ lang: 'en', dir: 'ltr' });
  });
});

describe('G6-05 — formats Intl', () => {
  it('nombres selon la langue courante', () => {
    setCurrentLocale('en');
    expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe('1,234.50');
    expect(formatNumber(null)).toBe('—');
  });

  it('formatMoney (helper partagé) accepte la locale, français par défaut', () => {
    const cur = { code: 'MAD', symbol: 'DH', decimals: 2 };
    expect(formatMoney(1234.5, cur, { locale: 'en-GB' })).toBe('1,234.50 DH');
    expect(formatMoney(1234.5, cur).replace(/\s/g, ' ')).toBe('1 234,50 DH');
  });
});

describe('G6-05 — dictionnaires et navigation', () => {
  it('les noms de modules français sont ceux de MODULE_LABELS', () => {
    for (const [module, label] of Object.entries(MODULE_LABELS)) {
      expect(fr[`module.${module}` as TranslationKey]).toBe(label);
    }
  });

  it('la tranche 1 est entièrement traduite en arabe et en anglais', () => {
    const keys = Object.keys(fr) as TranslationKey[];
    expect(keys.filter(k => !DICTIONARIES.ar[k])).toEqual([]);
    expect(keys.filter(k => !DICTIONARIES.en[k])).toEqual([]);
  });

  it('libellés du lanceur : français inchangé, arabe et anglais traduits', () => {
    expect(navLabel(NAV_HOME)).toBe(MODULE_LABELS.dashboard);
    expect(navLabel(NAV_HOME, undefined, 'ar')).toBe('لوحة القيادة');
    const approvals = NAV_GROUPS.flatMap(g => g.items).find(i => i.href === '/approvals')!;
    expect(navLabel(approvals)).toBe('Approbations');
    expect(navLabel(approvals, undefined, 'en')).toBe('Approvals');
    expect(NAV_GROUPS.map(g => navGroupTitle(g))).toEqual(NAV_GROUPS.map(g => g.title));
    expect(navGroupTitle(NAV_GROUPS[0], 'ar')).toBe('المبيعات');
  });
});
