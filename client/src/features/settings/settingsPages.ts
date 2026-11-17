import type { LucideIcon } from 'lucide-react';
import {
  Building2, Store, Paintbrush, Printer, Radio, Factory, Truck, Percent, Hash, FileText,
  BookOpen, Database, Ruler, HardDrive, Bell, ShieldCheck, LayoutDashboard, ClipboardCheck, Coins, Mail, Timer, BellRing, SlidersHorizontal, Layers, Webhook, ShoppingCart, Landmark, Bot, Activity } from 'lucide-react';
import type { AppModule, SettingsSection as SettingsSectionKey } from '@ofauria/shared';
import { settingAnchor } from './SettingsPrimitives';

/**
 * Plan des écrans Paramètres (refonte lot A) : pages regroupées par domaine,
 * une URL par page (?page=…), et l'index statique de la recherche ⌘K.
 * Une page est visible si l'utilisateur a sa section (droit « Paramètres ») et, quand
 * elle règle un module, si ce module est activé pour la société (lot S1).
 */

export type SettingsPageKey =
  | 'home'
  | 'company' | 'sector' | 'stores' | 'appearance' | 'integrations'
  | 'print' | 'channels' | 'salesRules' | 'posRules' | 'productCategories'
  | 'production' | 'purchasing'
  | 'tax' | 'currencies' | 'numbering' | 'documents' | 'ledger'
  | 'referentiel' | 'units' | 'customFields' | 'data' | 'dataQuality'
  | 'notifications' | 'mail' | 'jobs' | 'approvals' | 'audit';

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
  /** Modules réglés par la page : masquée si aucun n'est activé (absent = toujours visible). */
  modules?: AppModule[];
  /** Clé de vocabulaire du secteur pour le libellé (mig 514), ex. « production ». */
  labelKey?: string;
  /** Sections supplémentaires qui ouvrent aussi la page (page fusionnée, lot S3). */
  alsoSections?: SettingsSectionKey[];
  /** Table suivie par le journal pour « Historique de cette page » (lot S4). */
  auditTable?: string;
}

/** Anciennes pages fusionnées (lot S3) : leurs adresses et points mènent à la nouvelle. */
export const LEGACY_PAGES: Record<string, SettingsPageKey> = { sachets: 'posRules' };

export const SETTINGS_GROUPS = [
  'Mon entreprise', 'Activité et modules', 'Ventes et caisse', 'Achats, stock et production', 'Finance', 'Données',
  'Utilisateurs et sécurité', 'Automatisation',
] as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/** Icône de chaque groupe (tuiles de l'accueil, lot S2). */
export const GROUP_ICONS: Record<SettingsGroup, LucideIcon> = {
  'Mon entreprise': Building2, 'Activité et modules': Layers, 'Ventes et caisse': ShoppingCart,
  'Achats, stock et production': Factory, Finance: Landmark, Données: Database,
  'Utilisateurs et sécurité': ShieldCheck, Automatisation: Bot,
};

/** Groupe qui accueille le lien « Utilisateurs et droits » (écran hors des Paramètres). */
export const USERS_GROUP = 'Utilisateurs et sécurité';

const LEGAL = [
  'Identité légale', 'Raison sociale', 'Nom commercial', 'Forme juridique', 'Capital social', 'Sous-titre',
  'Coordonnées', 'Siège social', 'Ville', 'Téléphone', 'E-mail', 'Site web',
  'Identifiants fiscaux et sociaux', 'ICE', 'Identifiant fiscal (IF)', 'Registre de commerce (RC)', 'Patente', 'Code commune DGI', 'N° CNSS',
];

/** Accueil (lot B) : hors des groupes, visible de tout utilisateur ayant le droit « Paramètres ». */
export const HOME_PAGE: SettingsPageDef = {
  key: 'home', group: '', section: 'company', label: "Vue d'ensemble", icon: LayoutDashboard,
  description: 'Avancement du paramétrage, points à compléter et dernières modifications',
};

export const SETTINGS_PAGES: SettingsPageDef[] = [
  { key: 'company', group: 'Mon entreprise', auditTable: 'company_settings', section: 'company', label: 'Société', icon: Building2,
    description: 'Identité légale, coordonnées, identifiants et comptes bancaires',
    keywords: 'entreprise rib banque iban pays raison sociale ice if rc patente cnss',
    fields: [...LEGAL, 'Comptes bancaires'] },
  { key: 'sector', group: 'Activité et modules', section: 'company', label: 'Secteur et modules', icon: Layers,
    description: 'Choisir le métier, puis activer ou désactiver chaque module et ses options',
    keywords: 'secteur activite metier pack boulangerie generique negoce modules industrie services activer desactiver options fonctionnalites',
    fields: ["Secteur d'activité", 'Ventes et caisse', 'Catalogue, achats et stock', 'Production', 'Gestion', 'Socle'] },
  { key: 'stores', group: 'Mon entreprise', auditTable: 'stores', section: 'stores', label: 'Établissements', icon: Store,
    description: 'Boutiques, laboratoire, entrepôt, siège', keywords: 'boutique magasin point de vente laboratoire entrepot siege adresse' },
  { key: 'appearance', group: 'Mon entreprise', auditTable: 'company_settings', section: 'appearance', label: 'Apparence', icon: Paintbrush,
    description: 'Thème, couleurs et affichage', keywords: 'theme couleur design',
    fields: ['Thèmes prédéfinis', 'Surfaces', 'Texte', 'Accents', 'Bouton principal', 'Aperçu en direct'] },

  { key: 'print', group: 'Ventes et caisse', auditTable: 'company_settings', modules: ['pos'], section: 'print', label: 'Caisse et tickets', icon: Printer,
    description: 'Contenu du ticket, imprimantes et tiroir-caisse', keywords: 'impression recu ticket imprimante thermique escpos',
    fields: ['Logo', 'Afficher le logo sur le reçu', 'Contenu du reçu', 'En-tête supplémentaire', 'Message de pied de page',
      'Lignes supplémentaires', "Options d'affichage", 'Nom du caissier', 'Date et heure', 'Détail du paiement',
      'Imprimante thermique', 'Impression automatique', 'Ouvrir le tiroir-caisse', 'Nombre de copies',
      "Format d'impression", 'Taille de police', 'Largeur du papier'] },
  { key: 'channels', group: 'Ventes et caisse', auditTable: 'sales_channels', modules: ['pos', 'sales', 'orders'], section: 'production', label: 'Canaux de vente', icon: Radio,
    description: 'Boutique, commande, événement, gros, livraison', keywords: 'canal vente prix par canal' },
  { key: 'posRules', group: 'Ventes et caisse', auditTable: 'module_parameters', modules: ['pos'], section: 'business', label: 'Règles de caisse', icon: ShoppingCart,
    alsoSections: ['sachets'],
    description: 'Vente sans stock vitrine, fermeture de caisse, remise du personnel et sachets',
    keywords: 'caisse rupture stock negatif vente sans stock vitrine sachet emballage ratio vendeuse fermeture remise personnel',
    fields: ['Caisse : produits sans stock vitrine', 'Réglage global', 'Ratio par catégorie'] },
  { key: 'salesRules', group: 'Ventes et caisse', auditTable: 'module_parameters', modules: ['sales', 'orders', 'customers'], section: 'business', label: 'Devis et crédit clients', icon: BellRing,
    description: 'Validité des devis, relances et plafond de crédit', keywords: 'devis proforma validite relance recouvrement impaye plafond credit blocage',
    fields: ['Devis clients', 'Relances clients et contrôle du crédit'] },

  { key: 'production', group: 'Achats, stock et production', auditTable: 'module_parameters', modules: ['production'], labelKey: 'production', section: 'production', label: 'Production', icon: Factory,
    description: 'Ateliers, charges fixes, étapes, arrondi des prix et majoration', keywords: 'atelier ateliers chef boulanger patissier membres categories cout charges loyer energie arrondi prix majoration approvisionnement',
    fields: ['Ateliers', 'Majoration globale', 'Majoration par catégorie'] },
  { key: 'purchasing', group: 'Achats, stock et production', auditTable: 'module_parameters', modules: ['purchasing'], section: 'business', label: 'Achats et réception', icon: Truck,
    description: 'Règles des bons de commande, réceptions et factures fournisseurs', keywords: 'achat bc fournisseur reception tolerance dlc lot facture caisse' },

  { key: 'tax', group: 'Finance', auditTable: 'tax_codes', section: 'tax', label: 'TVA', icon: Percent,
    description: 'Taux de TVA datés', keywords: 'taxe taux tva' },
  { key: 'currencies', group: 'Finance', modules: ['purchasing', 'accounting'], section: 'currencies', label: 'Devises', icon: Coins,
    description: 'Devises d\'achat et taux de change datés', keywords: 'devise monnaie euro dollar taux change import' },
  { key: 'numbering', group: 'Finance', auditTable: 'document_sequences', section: 'numbering', label: 'Numérotation', icon: Hash,
    description: 'Séries de numéros des pièces', keywords: 'serie numero compteur piece' },
  { key: 'documents', group: 'Finance', auditTable: 'document_templates', section: 'documents', label: 'Documents', icon: FileText,
    description: 'Mentions des factures et bons de commande', keywords: 'modele facture pdf conditions paiement penalites pied de page' },
  { key: 'ledger', group: 'Finance', auditTable: 'module_parameters', modules: ['accounting'], section: 'business', label: 'Règles comptables', icon: BookOpen,
    description: 'Passation des écritures, commission carte, comptes de produits',
    keywords: 'ecriture comptabilisation journal grand livre commission carte tpe banque compte produit famille ventilation chiffre affaires 7111 7112',
    fields: ['Comptes de produits par famille'] },

  { key: 'productCategories', group: 'Ventes et caisse', modules: ['products', 'pos'], section: 'referentiel', label: 'Catégories de vente', icon: Layers,
    description: 'Familles et ordre des catégories en caisse', keywords: 'categorie famille caisse pos classement boulangerie patisserie',
    fields: ['Catégories et familles'] },
  { key: 'referentiel', group: 'Données', section: 'referentiel', label: 'Référentiel', icon: Database,
    description: 'Tables de paramétrage', keywords: 'table categorie unite motif' },
  { key: 'units', group: 'Données', section: 'referentiel', label: 'Unités de mesure', icon: Ruler,
    description: 'Dimensions, facteurs de conversion, fiches non rattachées' },
  { key: 'customFields', group: 'Données', section: 'custom_fields', label: 'Champs personnalisés', icon: SlidersHorizontal,
    description: 'Informations propres à votre métier sur les fiches', keywords: 'champ personnalise attribut specifique fiche formulaire colonne' },
  { key: 'data', group: 'Données', section: 'data', label: 'Import et export', icon: HardDrive,
    description: 'Import, export et état de la base', keywords: 'donnees csv excel sauvegarde import export' },
  { key: 'dataQuality', group: 'Données', section: 'data', label: 'Qualité des données', icon: Activity,
    description: 'Fiches incomplètes : poids cuit, allergènes, étapes, doublons, prix',
    keywords: 'qualite completude donnees maitres allergene poids cuit etape doublon homonyme prix aberrant fiche technique etiquette' },

  { key: 'notifications', group: 'Automatisation', auditTable: 'notification_rules', section: 'notifications', label: 'Notifications', icon: Bell,
    description: 'Qui est prévenu, et de quoi', keywords: 'alerte notification destinataire' },
  { key: 'mail', group: 'Automatisation', section: 'notifications', label: 'E-mails', icon: Mail,
    description: 'Serveur d\'envoi, expéditeur et file des e-mails', keywords: 'email mail smtp envoi expediteur courriel' },
  { key: 'jobs', group: 'Automatisation', section: 'notifications', label: 'Tâches planifiées', icon: Timer,
    description: 'Ce que l\'application fait seule et quand', keywords: 'cron planification automatique relance retard echeance tache' },
  { key: 'integrations', group: 'Automatisation', section: 'company', label: 'Intégrations', icon: Webhook,
    description: 'API publique : clés d\'accès et webhooks', keywords: 'api cle key webhook integration site marchand bearer notification sortante' },
  { key: 'approvals', group: 'Utilisateurs et sécurité', section: 'approvals', label: "Circuits d'approbation", icon: ClipboardCheck,
    description: 'Règles qui soumettent une pièce à l\'accord d\'un approbateur', keywords: 'approbation validation seuil bon de commande avoir ecart delegation escalade' },
  { key: 'audit', group: 'Utilisateurs et sécurité', section: 'audit', label: 'Journal', icon: ShieldCheck,
    description: 'Modifications du paramétrage et connexions', keywords: 'audit historique connexion trace' },
];

/** Page d'un paramètre métier du catalogue serveur (services/parameters-catalog.ts). */
export function pageOfParameter(key: string): SettingsPageKey {
  if (key.startsWith('purchasing.')) return 'purchasing';
  if (key.startsWith('ledger.') || key.startsWith('accounting.')) return 'ledger';
  if (key.startsWith('company.')) return 'company';
  if (['sales.pos_stock', 'sales.person_sizes', 'sales.closure', 'sales.staff_discount'].includes(key)) return 'posRules';
  if (key.startsWith('sales.')) return 'salesRules';
  return 'production';
}

export const normalizeSearch = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface SearchEntry {
  id: string;
  kind: 'page' | 'field' | 'parameter' | 'table' | 'series' | 'rule' | 'action' | 'recent';
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
