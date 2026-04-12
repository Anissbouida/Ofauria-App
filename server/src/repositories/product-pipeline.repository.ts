import { db } from '../config/database.js';

/* ═══ Stage progression order ═══ */
const STAGE_ORDER = [
  'proposition',
  'recipe_development',
  'cost_calculation',
  'production_test',
  'tasting_evaluation',
  'admin_validation',
  'catalog_integration',
] as const;

type PipelineStage = (typeof STAGE_ORDER)[number];

function nextStage(current: PipelineStage): PipelineStage | null {
  const idx = STAGE_ORDER.indexOf(current);
  return idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
}

function previousStage(current: PipelineStage): PipelineStage | null {
  const idx = STAGE_ORDER.indexOf(current);
  return idx > 0 ? STAGE_ORDER[idx - 1] : null;
}

export const productPipelineRepository = {
  /* ─── List pipelines with filters ─── */
  async findAll(params: { status?: string; stage?: string; search?: string; responsibleUserId?: string; limit?: number; offset?: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.status) {
      conditions.push(`pp.status = $${i++}`);
      values.push(params.status);
    }
    if (params.stage) {
      conditions.push(`pp.current_stage = $${i++}`);
      values.push(params.stage);
    }
    if (params.search) {
      conditions.push(`pp.name ILIKE $${i++}`);
      values.push(`%${params.search}%`);
    }
    if (params.responsibleUserId) {
      conditions.push(`pp.responsible_user_id = $${i++}`);
      values.push(params.responsibleUserId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = params.limit || 50;
    const offset = params.offset || 0;

    const countResult = await db.query(`SELECT COUNT(*) FROM product_pipeline pp ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(limit, offset);
    const result = await db.query(
      `SELECT pp.*,
              c.name as category_name,
              u.first_name as responsible_first_name, u.last_name as responsible_last_name,
              cr.first_name as creator_first_name, cr.last_name as creator_last_name,
              r.name as recipe_name, r.total_cost as recipe_total_cost
       FROM product_pipeline pp
       LEFT JOIN categories c ON c.id = pp.category_id
       LEFT JOIN users u ON u.id = pp.responsible_user_id
       LEFT JOIN users cr ON cr.id = pp.created_by
       LEFT JOIN recipes r ON r.id = pp.recipe_id
       ${where}
       ORDER BY pp.updated_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  /* ─── Get single pipeline with full details ─── */
  async findById(id: string) {
    const result = await db.query(
      `SELECT pp.*,
              c.name as category_name,
              u.first_name as responsible_first_name, u.last_name as responsible_last_name,
              cr.first_name as creator_first_name, cr.last_name as creator_last_name,
              r.name as recipe_name, r.total_cost as recipe_total_cost,
              r.yield_quantity as recipe_yield_quantity, r.instructions as recipe_instructions,
              cv.first_name as cost_validator_first_name, cv.last_name as cost_validator_last_name,
              tv.first_name as test_validator_first_name, tv.last_name as test_validator_last_name,
              tav.first_name as tasting_validator_first_name, tav.last_name as tasting_validator_last_name,
              adm.first_name as admin_first_name, adm.last_name as admin_last_name,
              prod.name as product_name
       FROM product_pipeline pp
       LEFT JOIN categories c ON c.id = pp.category_id
       LEFT JOIN users u ON u.id = pp.responsible_user_id
       LEFT JOIN users cr ON cr.id = pp.created_by
       LEFT JOIN recipes r ON r.id = pp.recipe_id
       LEFT JOIN users cv ON cv.id = pp.cost_validated_by
       LEFT JOIN users tv ON tv.id = pp.test_validated_by
       LEFT JOIN users tav ON tav.id = pp.tasting_validated_by
       LEFT JOIN users adm ON adm.id = pp.admin_decided_by
       LEFT JOIN products prod ON prod.id = pp.product_id
       WHERE pp.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  /* ─── Stage 1: Create proposition ─── */
  async create(data: {
    name: string; description?: string; categoryId?: number;
    responsibleUserId?: string; targetDate?: string; createdBy: string;
  }) {
    const result = await db.query(
      `INSERT INTO product_pipeline (name, description, category_id, responsible_user_id, target_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.name, data.description || null, data.categoryId || null,
       data.responsibleUserId || null, data.targetDate || null, data.createdBy]
    );
    const pipeline = result.rows[0];

    // Log creation
    await this.logHistory(pipeline.id, null, 'proposition', 'created', { name: data.name }, data.createdBy);

    return pipeline;
  },

  /* ─── Update stage data (within current stage only) ─── */
  async updateStageData(id: string, stage: string, data: Record<string, unknown>, userId: string) {
    const pipeline = await this.findById(id);
    if (!pipeline) throw new Error('Pipeline introuvable');
    if (pipeline.status !== 'active') throw new Error('Ce pipeline n\'est plus actif');
    if (pipeline.current_stage !== stage) {
      throw new Error(`Impossible de modifier les données de l'étape "${stage}" car l'étape actuelle est "${pipeline.current_stage}"`);
    }

    const allowedFieldsByStage: Record<string, Record<string, string>> = {
      proposition: {
        name: 'name', description: 'description', categoryId: 'category_id',
        responsibleUserId: 'responsible_user_id', targetDate: 'target_date',
      },
      recipe_development: {
        recipeId: 'recipe_id', recipeNotes: 'recipe_notes',
      },
      cost_calculation: {
        estimatedCost: 'estimated_cost', targetPrice: 'target_price',
        targetMargin: 'target_margin', costNotes: 'cost_notes',
      },
      production_test: {
        testDate: 'test_date', testQuantity: 'test_quantity',
        testYield: 'test_yield', testObservations: 'test_observations',
        recipeRevised: 'recipe_revised',
      },
      tasting_evaluation: {
        tastingDate: 'tasting_date', tastingScores: 'tasting_scores',
        tastingComments: 'tasting_comments',
      },
      admin_validation: {
        adminComments: 'admin_comments',
      },
    };

    const mapping = allowedFieldsByStage[stage];
    if (!mapping) throw new Error(`Étape "${stage}" non modifiable`);

    const fields: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let i = 1;

    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = $${i++}`);
        values.push(key === 'tastingScores' ? JSON.stringify(data[key]) : data[key]);
      }
    }

    if (values.length === 0) return this.findById(id);

    // Date chronology validation on save
    if (stage === 'production_test' && data.testDate) {
      const targetDate = pipeline.target_date ? new Date(String(pipeline.target_date)) : null;
      const testDate = new Date(String(data.testDate));
      if (targetDate && testDate < targetDate) {
        throw new Error('La date de test ne peut pas être antérieure à la date cible');
      }
    }
    if (stage === 'tasting_evaluation' && data.tastingDate) {
      const testDate = pipeline.test_date ? new Date(String(pipeline.test_date)) : null;
      const tastingDate = new Date(String(data.tastingDate));
      if (testDate && tastingDate < testDate) {
        throw new Error('La date de dégustation ne peut pas être antérieure à la date de test de production');
      }
    }

    values.push(id);
    await db.query(
      `UPDATE product_pipeline SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    await this.logHistory(id, stage as PipelineStage, stage as PipelineStage, 'updated', data, userId);

    return this.findById(id);
  },

  /* ─── Advance to next stage (with validation) ─── */
  async advanceStage(id: string, userId: string) {
    const pipeline = await this.findById(id);
    if (!pipeline) throw new Error('Pipeline introuvable');
    if (pipeline.status !== 'active') throw new Error('Ce pipeline n\'est plus actif');

    const currentStage = pipeline.current_stage as PipelineStage;
    const next = nextStage(currentStage);
    if (!next) throw new Error('Ce pipeline est déjà à la dernière étape');

    // Validate current stage is complete before advancing
    this.validateStageCompletion(pipeline, currentStage);

    // Stage-specific validation actions
    const validationFields: Record<string, string[]> = {
      cost_calculation: ['cost_validated = true', `cost_validated_at = NOW()`, `cost_validated_by = '${userId}'`],
      production_test: ['test_validated = true', `test_validated_at = NOW()`, `test_validated_by = '${userId}'`],
      tasting_evaluation: ['tasting_validated = true', `tasting_validated_at = NOW()`, `tasting_validated_by = '${userId}'`],
    };

    const extraFields = validationFields[currentStage] || [];
    const setClauses = [`current_stage = $1`, `updated_at = NOW()`, ...extraFields];

    await db.query(
      `UPDATE product_pipeline SET ${setClauses.join(', ')} WHERE id = $2`,
      [next, id]
    );

    await this.logHistory(id, currentStage, next, 'stage_advanced', {
      from: currentStage,
      to: next,
    }, userId);

    return this.findById(id);
  },

  /* ─── Stage 6: Admin decision ─── */
  async adminDecision(id: string, decision: 'approved' | 'rejected' | 'revision_requested', comments: string, userId: string) {
    const pipeline = await this.findById(id);
    if (!pipeline) throw new Error('Pipeline introuvable');
    if (pipeline.current_stage !== 'admin_validation') {
      throw new Error('Ce pipeline n\'est pas à l\'étape de validation admin');
    }

    if (decision === 'approved') {
      // Advance to catalog integration
      await db.query(
        `UPDATE product_pipeline SET
           admin_decision = 'approved', admin_comments = $1,
           admin_decided_at = NOW(), admin_decided_by = $2,
           current_stage = 'catalog_integration', updated_at = NOW()
         WHERE id = $3`,
        [comments, userId, id]
      );
      await this.logHistory(id, 'admin_validation', 'catalog_integration', 'admin_approved', { comments }, userId);
    } else if (decision === 'rejected') {
      await db.query(
        `UPDATE product_pipeline SET
           admin_decision = 'rejected', admin_comments = $1,
           admin_decided_at = NOW(), admin_decided_by = $2,
           status = 'rejected', updated_at = NOW()
         WHERE id = $3`,
        [comments, userId, id]
      );
      await this.logHistory(id, 'admin_validation', null, 'admin_rejected', { comments }, userId);
    } else if (decision === 'revision_requested') {
      // Send back to recipe development
      await db.query(
        `UPDATE product_pipeline SET
           admin_decision = 'revision_requested', admin_comments = $1,
           admin_decided_at = NOW(), admin_decided_by = $2,
           current_stage = 'recipe_development', updated_at = NOW()
         WHERE id = $3`,
        [comments, userId, id]
      );
      await this.logHistory(id, 'admin_validation', 'recipe_development', 'revision_requested', { comments }, userId);
    }

    return this.findById(id);
  },

  /* ─── Stage 7: Integrate into catalog ─── */
  async integrateCatalog(id: string, userId: string) {
    const pipeline = await this.findById(id);
    if (!pipeline) throw new Error('Pipeline introuvable');
    if (pipeline.current_stage !== 'catalog_integration') {
      throw new Error('Ce pipeline n\'est pas à l\'étape d\'intégration catalogue');
    }

    // Create the product in the products table
    const slug = pipeline.name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const productResult = await db.query(
      `INSERT INTO products (name, slug, category_id, description, price, cost_price, is_available, responsible_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING *`,
      [
        pipeline.name,
        slug + '-' + Date.now(),
        pipeline.category_id,
        pipeline.description,
        pipeline.target_price || 0,
        pipeline.estimated_cost || pipeline.recipe_total_cost || 0,
        pipeline.responsible_user_id,
      ]
    );

    const product = productResult.rows[0];

    // Link recipe to product if exists
    if (pipeline.recipe_id) {
      await db.query('UPDATE recipes SET product_id = $1 WHERE id = $2', [product.id, pipeline.recipe_id]);
    }

    // Update pipeline as completed
    await db.query(
      `UPDATE product_pipeline SET
         product_id = $1, integrated_at = NOW(), status = 'completed', updated_at = NOW()
       WHERE id = $2`,
      [product.id, id]
    );

    await this.logHistory(id, 'catalog_integration', null, 'catalog_integrated', {
      productId: product.id,
      productName: product.name,
    }, userId);

    return this.findById(id);
  },

  /* ─── Cancel pipeline ─── */
  async cancel(id: string, reason: string, userId: string) {
    const pipeline = await this.findById(id);
    if (!pipeline) throw new Error('Pipeline introuvable');
    if (pipeline.status !== 'active') throw new Error('Ce pipeline n\'est plus actif');

    await db.query(
      `UPDATE product_pipeline SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    await this.logHistory(id, pipeline.current_stage as PipelineStage, null, 'cancelled', { reason }, userId);

    return this.findById(id);
  },

  /* ─── History ─── */
  async findHistory(pipelineId: string) {
    const result = await db.query(
      `SELECT h.*, u.first_name, u.last_name
       FROM product_pipeline_history h
       LEFT JOIN users u ON u.id = h.performed_by
       WHERE h.pipeline_id = $1
       ORDER BY h.created_at DESC`,
      [pipelineId]
    );
    return result.rows;
  },

  /* ─── Dashboard stats ─── */
  async getStats() {
    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int as active_count,
        COUNT(*) FILTER (WHERE status = 'completed')::int as completed_count,
        COUNT(*) FILTER (WHERE status = 'rejected')::int as rejected_count,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int as cancelled_count,
        COUNT(*)::int as total_count,
        COUNT(*) FILTER (WHERE current_stage = 'proposition' AND status = 'active')::int as stage_proposition,
        COUNT(*) FILTER (WHERE current_stage = 'recipe_development' AND status = 'active')::int as stage_recipe,
        COUNT(*) FILTER (WHERE current_stage = 'cost_calculation' AND status = 'active')::int as stage_cost,
        COUNT(*) FILTER (WHERE current_stage = 'production_test' AND status = 'active')::int as stage_test,
        COUNT(*) FILTER (WHERE current_stage = 'tasting_evaluation' AND status = 'active')::int as stage_tasting,
        COUNT(*) FILTER (WHERE current_stage = 'admin_validation' AND status = 'active')::int as stage_validation,
        COUNT(*) FILTER (WHERE current_stage = 'catalog_integration' AND status = 'active')::int as stage_integration
      FROM product_pipeline
    `);
    return result.rows[0];
  },

  /* ═══ Internal helpers ═══ */

  validateStageCompletion(pipeline: Record<string, unknown>, stage: PipelineStage) {
    switch (stage) {
      case 'proposition':
        if (!pipeline.name) throw new Error('Le nom du produit est requis');
        if (!pipeline.category_id) throw new Error('La catégorie est requise');
        if (!pipeline.responsible_user_id) throw new Error('Le responsable est requis');
        break;
      case 'recipe_development':
        if (!pipeline.recipe_id) throw new Error('La recette doit être assignée');
        break;
      case 'cost_calculation':
        if (!pipeline.estimated_cost && !pipeline.recipe_total_cost)
          throw new Error('Le coût estimé doit être renseigné');
        if (!pipeline.target_price) throw new Error('Le prix cible doit être renseigné');
        break;
      case 'production_test':
        if (!pipeline.test_date) throw new Error('La date de test est requise');
        if (!pipeline.test_quantity) throw new Error('La quantité testée est requise');
        // Vérifier que la date de test est postérieure à la date cible si elle existe
        if (pipeline.target_date && pipeline.test_date) {
          const targetDate = new Date(String(pipeline.target_date));
          const testDate = new Date(String(pipeline.test_date));
          if (testDate < targetDate) {
            throw new Error('La date de test ne peut pas être antérieure à la date cible du projet');
          }
        }
        break;
      case 'tasting_evaluation': {
        if (!pipeline.tasting_date) throw new Error('La date de dégustation est requise');
        // Vérifier que la date de dégustation est postérieure à la date de test production
        if (pipeline.test_date && pipeline.tasting_date) {
          const testDate = new Date(String(pipeline.test_date));
          const tastingDate = new Date(String(pipeline.tasting_date));
          if (tastingDate < testDate) {
            throw new Error('La date de dégustation ne peut pas être antérieure à la date du test de production');
          }
        }
        const scores = pipeline.tasting_scores as Record<string, unknown> | null;
        if (!scores || !scores.visual || !scores.taste || !scores.texture || !scores.originality) {
          throw new Error('Toutes les notes de dégustation sont requises (visuel, goût, texture, originalité)');
        }
        const overall = (Number(scores.visual) + Number(scores.taste) + Number(scores.texture) + Number(scores.originality)) / 4;
        if (overall < 7) {
          throw new Error(`Score global insuffisant (${overall.toFixed(1)}/10). Un minimum de 7/10 est requis pour la commercialisation.`);
        }
        break;
      }
      case 'admin_validation':
        // Admin decision handled separately via adminDecision method
        break;
      case 'catalog_integration':
        break;
    }
  },

  async logHistory(
    pipelineId: string,
    fromStage: PipelineStage | null,
    toStage: PipelineStage | null,
    action: string,
    details: Record<string, unknown>,
    performedBy: string
  ) {
    await db.query(
      `INSERT INTO product_pipeline_history (pipeline_id, from_stage, to_stage, action, details, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [pipelineId, fromStage, toStage, action, JSON.stringify(details), performedBy]
    );
  },
};
