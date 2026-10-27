import {z} from 'zod';
const candidate = z.string().regex(/^[a-f0-9]{64}$/);
export const experienceCaseSchema = z.object({
  summary: z.string().min(1),
  cause: z.string().min(1),
  prevention: z.string().min(1),
  actor: z.string().min(1),
  classification: z.enum([
    'general',
    'site-preference',
    'hard-failure',
    'local-reference',
    'unclassified',
  ]),
  scope: z.object({
    pages: z.array(z.string()).min(1),
    site: z.string().optional(),
    component: z.string().optional(),
  }),
  evidence: z.array(z.object({candidate}).passthrough()).min(1),
  verification: z
    .object({
      retested: z.boolean().optional(),
      designerApproved: z.boolean().optional(),
      candidate: candidate.optional(),
      pages: z.array(z.string()).optional(),
    })
    .optional(),
  learning: z
    .object({
      key: z.string().regex(/^[a-z][a-z0-9.-]{3,99}$/),
      when: z.string().min(8),
      exceptions: z.array(z.string()).default([]),
      transferable: z.boolean().default(false),
    })
    .optional(),
  source: z
    .object({
      site: z.string().min(1),
      task: z.string().min(1),
      checkIds: z.array(z.string()).min(1),
    })
    .optional(),
  approval: z
    .object({
      decision: z.literal('approve'),
      actor: z.string().min(1),
      text: z.string().min(1),
      candidate,
      at: z.string().datetime(),
      feedbackId: z.string().optional(),
    })
    .optional(),
});
export const experienceSearchSchema = {
  pages: z.array(z.string()).optional(),
  site: z.string().optional(),
  query: z.string().optional(),
  key: z.string().optional(),
  component: z.string().optional(),
  includePending: z.boolean().optional(),
  includeCreative: z.boolean().optional(),
  includeRetired: z.boolean().optional(),
  includeVisualSpecs: z.boolean().optional(),
  siteType: z.enum(['coupon','app','games']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  knownHash: z.string().optional(),
};

export const experienceManageSchema = {
  action: z.enum(['inspect', 'retract', 'replace']),
  id: z.string(),
  expectedRevision: z.number().int().optional(),
  actor: z.string().optional(),
  reason: z.string().optional(),
  case: experienceCaseSchema.optional(),
  supportCaseIds: z.array(z.string()).optional(),
  observation: z.string().min(1).max(1000).optional(),
  sentiment: z.enum(['positive','negative']).optional(),
  visualSpec: z.object({observations:z.array(z.object({aspect:z.enum(['layout','spacing','color','typography','components','imagery','interaction','responsive','other']),description:z.string().min(1).max(600)})).min(1).max(12),applicability:z.string().min(1).max(600),limits:z.string().min(1).max(600)}).optional(),
};
