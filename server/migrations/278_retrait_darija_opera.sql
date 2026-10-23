-- Migration 278 : Retrait du texte darija de l'Opera classique
--
-- POURQUOI
--   Le darija injecte par la mig 277 vient de la colonne arabe du fichier
--   `fiche_opera_masterclass.html`. Verification faite : les 17 chaines du
--   systeme sont identiques a ce fichier, a une espace pres. Aucune n'a ete
--   redigee ici.
--
--   Le chef juge ce texte artificiel : ce sont des transpositions mot a mot du
--   francais (« تقطاع الجراحين » pour « coupe chirurgicale », « نواة مطاطية »
--   pour « noyau elastique »), pas la langue parlee au labo. Un mode operatoire
--   que personne ne lit dans sa propre langue ne sert a rien, et pire, il fait
--   douter du reste de la fiche.
--
--   On retire donc le TEXTE. On garde la MECANIQUE.
--
-- CE QUI RESTE EN PLACE — a dessein
--   - les cles `nom_ar` / `checklist_items_ar` dans le JSONB des etapes ;
--   - les schemas zod qui les preservent (sans quoi une sauvegarde depuis l'UI
--     les effacerait silencieusement) ;
--   - l'affichage bilingue de EtapesSection, conditionne a la presence de texte ;
--   - la police Cairo et le rendu arabe du PDF, conditionnes de meme.
--   Le jour ou le chef dicte ses vraies formulations, il n'y a qu'a remplir les
--   champs : rien a recoder.
--
-- EFFET IMMEDIAT
--   L'app et le PDF n'affichent le bloc arabe que si du texte est present. Vider
--   les champs le fait donc disparaitre des deux, sans autre intervention.
--
-- PORTEE
--   UPDATE du seul JSONB etapes de l'Opera + retrait de la ligne allergenes en
--   arabe des instructions. Rejouable. Le francais n'est pas touche.
--
-- INVERSION
--   Rejouer la mig 277 (elle reapplique le patch darija par numero d'ordre).

UPDATE recipes r
SET etapes = (
      SELECT jsonb_agg(
               (e.value - 'nom_ar' - 'checklist_items_ar')
               ORDER BY (e.value->>'ordre')::int
             )
        FROM jsonb_array_elements(r.etapes) e
    ),
    -- La ligne allergenes arabe ajoutee par la mig 277 : on coupe a partir
    -- d'elle, le francais qui precede est conserve tel quel.
    instructions = regexp_replace(
                     COALESCE(r.instructions, ''),
                     E'\\n+مسببات الحساسية.*$', '', 'g'
                   ),
    updated_at = NOW()
WHERE r.id = '0be7a000-0000-4000-8000-000000000001';
