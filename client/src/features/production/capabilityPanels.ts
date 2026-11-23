import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Panneaux métier enregistrés par capacité (plan d'exécution multi-industries, étape 10,
 * pas 10c). Un panneau dont la capacité est éteinte n'est ni affiché ni CHARGÉ : son code est
 * dans un module séparé, importé à la demande. Ce qui est métier reste un composant écrit à
 * la main ; seul son branchement dépend du profil.
 */
type PanelEntry<P> = { capability: string; component: LazyExoticComponent<ComponentType<P>> };

export const CAPABILITY_PANELS = {
  /** Température de base de la pâte (eau de coup) : saisie par fournée seulement. */
  'launch.temperature-base': {
    capability: 'mode_fournee',
    component: lazy(() => import('./panels/TemperatureDeBase')),
  } as PanelEntry<{ cibleC: number }>,
};

/** Composant du panneau si sa capacité est active, sinon null (rien n'est chargé). */
export function capabilityPanel<K extends keyof typeof CAPABILITY_PANELS>(key: K, hasFeature: (k: string) => boolean) {
  const e = CAPABILITY_PANELS[key];
  return hasFeature(e.capability) ? e.component : null;
}
