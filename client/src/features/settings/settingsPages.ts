import type { LucideIcon } from 'lucide-react';
import {
  Building2, Store, Paintbrush, Printer, Radio, ShoppingBag, Factory, Truck, Percent, Hash, FileText,
  BookOpen, Database, HardDrive, Bell, ShieldCheck,
} from 'lucide-react';
import type { SettingsSection as SettingsSectionKey } from '@ofauria/shared';
import { settingAnchor } from './SettingsPrimitives';

/**
 * Plan des écrans Paramètres (refonte lot A) : pages regroupées par domaine,
 * une URL par page (?page=…), et l'index statique de la recherche ⌘K.
 * Une page est visible si l'utilisateur a sa section (droit « Paramètres »).
 */

export type SettingsPageKey =
  | 'company' | 'stores' | 'appearance'
  | 'print' | 'channels' | 'sachets'
  | 'production' | 'purchasing'
  | 'tax' | 'numbering' | 'documents' | 'ledger'
  | 'referentiel' | 'data'
  | 'notifications' | 'audit';

export interface SettingsPageDef {
  key: SettingsPageKey;
  group: string;
  section: SettingsSectionKey;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Mots-clés supplémentaires pour la recherche ⌘K. */
  keywords?: string;
  /** Réglages de la page indexés par la recherche (titre de bloc ou de réglage → ancre). */
  fields?: string[];
}

export const SETTINGS_GROUPS = [
  'Entreprise', 'Ventes et caisse', 'Achats et production', 'Comptabilité', 'Données de base', 'Sécurité et contrôle',
] as const;

const LEGAL = [
  'Identité légale', 'Forme juridique', 'Capital social', 'Raison sociale', 'Siège social', 'Ville', 'Téléphone', 'Email',
  'Registre de commerce (RC)', 'Identifiant fiscal (IF)', 'ICE', 'Patente / Taxe professionnelle', 'Site web', "N° d'affiliation CNSS",
];

export const SETTINGS_PAGES: SettingsPageDef[] = [
  { key: 'company', group: 'Entreprise', section: 'company', label: 'Société', icon: Building2,
    description: 'Identité légale, comptes bancaires et remise du personnel',
    keywords: 'entreprise rib banque iban remise personnel pays',
    fields: ["Informations de l'entreprise", "Nom de l'entreprise", 'Sous-titre', ...LEGAL] },
  { key: 'stores', group: 'Entreprise', section: 'stores', label: 'Établissements', icon: Store,
    description: 'Boutiques, laboratoire, entrepôt, siège', keywords: 'boutique magasin point de vente laboratoire entrepot siege adresse' },
  { key: 'appearance', group: 'Entreprise', section: 'appearance', label: 'Apparence', icon: Paintbrush,
    description: 'Thème, couleurs et affichage', keywords: 'theme couleur design',
    fields: ['Thèmes prédéfinis', 'Surfaces', 'Texte', 'Accents', 'Bouton principal', 'Aperçu en direct'] },

  { key: 'print', group: 'Ventes et caisse', section: 'print', label: 'Caisse et tickets', icon: Printer,
    description: 'Contenu du ticket, imprimantes et tiroir-caisse', keywords: 'impression recu ticket imprimante thermique escpos',
    fields: ['Logo', 'Afficher le logo sur le reçu', 'Contenu du reçu', 'En-tête supplémentaire', 'Message de pied de page',
      'Lignes supplémentaires', "Options d'affichage", 'Nom du caissier', 'Date et heure', 'Détail du paiement',
      'Imprimante thermique', 'Impression automatique', 'Ouvrir le tiroir-caisse', 'Nombre de copies',
      "Format d'impression", 'Taille de police', 'Largeur du papier'] },
  { key: 'channels', group: 'Ventes et caisse', section: 'production', label: 'Canaux de vente', icon: Radio,
    description: 'Boutique, commande, événement, gros, livraison', keywords: 'canal vente prix par canal' },
  { key: 'sachets', group: 'Ventes et caisse', section: 'sachets', label: 'Sachets', icon: ShoppingBag,
    description: 'Contrôle des sachets de caisse', keywords: 'sachet emballage ratio vendeuse',
    fields: ['Réglage global', 'Ratio par catégorie'] },

  { key: 'production', group: 'Achats et production', section: 'production', label: 'Production', icon: Factory,
    description: 'Charges fixes, étapes, arrondi des prix et majoration', keywords: 'cout charges loyer energie arrondi prix majoration approvisionnement',
    fields: ['Majoration globale', 'Majoration par catégorie'] },
  { key: 'purchasing', group: 'Achats et production', section: 'business', label: 'Achats et réception', icon: Truck,
    description: 'Règles des bons de commande, réceptions et factures fournisseurs', keywords: 'achat bc fournisseur reception tolerance dlc lot facture caisse' },

  { key: 'tax', group: 'Comptabilité', section: 'tax', label: 'TVA', icon: Percent,
    description: 'Taux de TVA datés', keywords: 'taxe taux tva' },
  { key: 'numbering', group: 'Comptabilité', section: 'numbering', label: 'Numérotation', icon: Hash,
    description: 'Séries de numéros des pièces', keywords: 'serie numero compteur piece' },
  { key: 'documents', group: 'Comptabilité', section: 'documents', label: 'Documents', icon: FileText,
    description: 'Mentions des factures et bons de commande', keywords: 'modele facture pdf conditions paiement penalites pied de page' },
  { key: 'ledger', group: 'Comptabilité', section: 'business', label: 'Règles comptables', icon: BookOpen,
    description: 'Mode de passation des écritures', keywords: 'ecriture comptabilisation journal grand livre' },

  { key: 'referentiel', group: 'Données de base', section: 'referentiel', label: 'Référentiel', icon: Database,
    description: 'Tables de paramétrage', keywords: 'table categorie unite motif' },
  { key: 'data', group: 'Données de base', section: 'data', label: 'Import et export', icon: HardDrive,
    description: 'Import, export et état de la base', keywords: 'donnees csv excel sauvegarde import export' },

  { key: 'notifications', group: 'Sécurité et contrôle', section: 'notifications', label: 'Notifications', icon: Bell,
    description: 'Qui est prévenu, et de quoi', keywords: 'alerte notification destinataire' },
  { key: 'audit', group: 'Sécurité et contrôle', section: 'audit', label: 'Journal', icon: ShieldCheck,
    description: 'Modifications du paramétrage et connexions', keywords: 'audit historique connexion trace' },
];

/** Page d'un paramètre métier du catalogue serveur (services/parameters-catalog.ts). */
export function pageOfParameter(key: string): SettingsPageKey {
  if (key.startsWith('purchasing.')) return 'purchasing';
  if (key.startsWith('ledger.')) return 'ledger';
  if (key.startsWith('sales.') || key.startsWith('company.')) return 'company';
  return 'production';
}

export const normalizeSearch = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface SearchEntry {
  id: string;
  kind: 'page' | 'field' | 'parameter' | 'table' | 'series' | 'rule';
  label: string;
  page: SettingsPageKey;
  anchor?: string;
  /** Paramètres d'URL en plus de ?page= (ex. table du référentiel). */
  extra?: Record<string, string>;
  haystack: string;
}

export function staticSearchEntries(pages: SettingsPageDef[]): SearchEntry[] {
  return pages.flatMap(p => [
    { id: `page:${p.key}`, kind: 'page' as const, label: p.label, page: p.key,
      haystack: normalizeSearch(`${p.label} ${p.group} ${p.description} ${p.keywords ?? ''}`) },
    ...(p.fields ?? []).map(f => ({
      id: `field:${p.key}:${f}`, kind: 'field' as const, label: f, page: p.key, anchor: settingAnchor(f),
      haystack: normalizeSearch(`${f} ${p.label}`),
    })),
  ]);
}
