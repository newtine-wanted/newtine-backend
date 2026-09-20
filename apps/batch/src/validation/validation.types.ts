import type {
  Catalog,
  GenerationConfig,
  GenerationResult,
  Usage,
} from '../generation/generation.types.js';
export const FIELDS = [
  'title',
  'eventAt',
  'eventEvidence',
  'integratedSummary',
  'summaryLines',
  'viewpoints',
  'sharedConditionalImpact',
  'impacts',
  'llmEstimatedImportance',
  'importanceReason',
  'generations',
  'terms',
  'followUp',
  'classification',
  'glossary',
] as const;
export type Field = (typeof FIELDS)[number];
export const TONE_FIELDS = [
  'title',
  'integratedSummary',
  'summaryLines',
  'viewpoints',
  'sharedConditionalImpact',
  'impacts',
  'importanceReason',
  'followUp',
  'glossary',
] as const satisfies readonly Field[];
export interface Finding {
  field: Field | 'source' | 'scores';
  category: 'RULE' | 'TONE';
  reason: string;
  articleIds: string[];
}
export interface Review {
  findings: Finding[];
}
export interface Patch {
  field: Field;
  value: unknown;
}
export interface ValidationResult {
  termLimit?: { removedTerms: string[] };
  original: GenerationResult;
  current: GenerationResult;
  reviews: { phase: 'INITIAL' | 'FINAL'; rules: Finding[]; semantic?: Review }[];
  repair?: { fields: Field[]; patches: Patch[]; error?: string };
  status?: 'PASSED' | 'HELD';
}
export interface ValidationSnapshot {
  validationMode?: 'AI' | 'RULES_ONLY' | 'TONE';
  aiValidationEnabled?: boolean;
  at: string;
  generationAt: string;
  config: GenerationConfig;
  catalog: Catalog;
  results: ValidationResult[];
  usage: Usage[];
}
export interface ValidationRun {
  id: string;
  generationRunId: string;
  owner: string;
  completed: boolean;
  snapshot: ValidationSnapshot;
}
export interface ValidationStore {
  claim(source: string, at: Date, aiValidationEnabled?: boolean): Promise<ValidationRun>;
  save(run: ValidationRun): Promise<void>;
  heartbeat(run: ValidationRun): Promise<void>;
  complete(run: ValidationRun): Promise<void>;
  fail(run: ValidationRun, reason: string): Promise<void>;
}
export interface ValidationModel {
  usage: Usage[];
  review(result: GenerationResult, context: ValidationSnapshot): Promise<Review>;
  repair(
    result: GenerationResult,
    findings: Finding[],
    fields: Field[],
    context: ValidationSnapshot,
  ): Promise<Patch[]>;
}
