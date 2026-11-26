import { usePermissions } from '../../context/PermissionsContext';

/**
 * Vocabulaire du module Projets selon le profil (audit des profils, R5) : « Chantier » en BTP,
 * « Contrat » en transport, « Projet » ailleurs. Seul le titre suivait le profil ; les colonnes,
 * boutons, états vides et indicateurs passent désormais par ces termes.
 */
export function useProjectTerms() {
  const { sectorLabel } = usePermissions();
  const project = sectorLabel('project', 'Projet');
  const projects = sectorLabel('projects', 'Projets');
  return { project, projects, projectLc: project.toLowerCase(), projectsLc: projects.toLowerCase() };
}
