export type WorkflowStage = 'ingest' | 'prepare' | 'estimate' | 'report';

export type CellValue = string | number | boolean | null | undefined;
export type DataRow = Record<string, CellValue>;

export type ColumnType = 'numeric' | 'categorical' | 'id' | 'weight';

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  count: number;
  missingCount: number;
  missingPct: number;
  uniqueCount: number;
  mean?: number;
  median?: number;
  stdDev?: number;
  min?: number;
  max?: number;
  q1?: number;
  q3?: number;
  iqr?: number;
  skewness?: number;
  outlierCountIQR: number;
  outlierCountZ: number;
  outlierRowIndicesIQR: number[];
  outlierRowIndicesZ: number[];
  topCategories?: Array<{ value: string; count: number; pct: number }>;
  negativeCount?: number;
}

export interface DatasetProfile {
  rowCount: number;
  columnCount: number;
  totalCells: number;
  missingCells: number;
  missingPct: number;
  duplicateRows: number;
  totalOutliersIQR: number;
  completenessScore: number;
  columns: ColumnProfile[];
}

export type ImputationStrategy = 'none' | 'median' | 'mean' | 'mode' | 'knn' | 'ffill' | 'drop';
export type OutlierMethod = 'iqr_1_5' | 'iqr_3_0' | 'zscore_3' | 'zscore_2_5' | 'winsor_5';
export type OutlierAction = 'none' | 'flag' | 'cap' | 'median' | 'remove';

export interface ColumnCleaningOverride {
  imputation?: ImputationStrategy;
  outlierAction?: OutlierAction;
}

export type ValidationRuleType = 'range' | 'cross_lte';

export interface CustomValidationRule {
  id: string;
  type: ValidationRuleType;
  column: string;
  min?: number;
  max?: number;
  compareColumn?: string; // for cross_lte: column <= compareColumn
  action: 'recode_missing' | 'flag';
}

export interface ValidationRuleConfig {
  removeDuplicates: boolean;
  trimAndStandardizeText: boolean;
  enforceNonNegativeColumns: string[];
  customRules: CustomValidationRule[];
}

export interface CleaningConfig {
  globalNumericImputation: ImputationStrategy;
  globalCategoricalImputation: ImputationStrategy;
  knnK: number;
  outlierMethod: OutlierMethod;
  globalOutlierAction: OutlierAction;
  columnOverrides: Record<string, ColumnCleaningOverride>;
  validation: ValidationRuleConfig;
}

export interface CleaningAuditEntry {
  id: string;
  step: string;
  column: string;
  method: string;
  affectedRows: number;
  details: string;
  timestamp: string;
}

export interface AIAuditRecommendation {
  column: string;
  issueType: string;
  recommendedImputation: string;
  recommendedOutlierAction: string;
  rationale: string;
}

export interface AIAuditResult {
  summary: string;
  qualityGrade: string;
  suggestedWeightColumn: string;
  suggestedStratumColumn: string;
  recommendations: AIAuditRecommendation[];
  keyRisks: string[];
}

export interface EstimationConfig {
  weightColumn: string; // '' means unweighted
  stratumColumn: string; // '' means no subgroup split
  targetColumns: string[];
  categoricalColumns: string[];
  confidenceLevel: 0.9 | 0.95 | 0.99;
}

export type ReliabilityRating = 'Reliable' | 'Caution' | 'Unreliable';

export interface VariableEstimate {
  column: string;
  sampleSize: number;
  sumOfWeights: number;
  effectiveSampleSize: number;
  designEffect: number;
  unweightedMean: number;
  unweightedSE: number;
  weightedMean: number;
  weightedSE: number;
  weightedTotal: number;
  weightedTotalSE: number;
  marginOfError: number;
  ciLower: number;
  ciUpper: number;
  rsePct: number;
  biasShiftPct: number;
  reliability: ReliabilityRating;
}

export interface SubgroupEstimate {
  stratumValue: string;
  column: string;
  sampleSize: number;
  sumOfWeights: number;
  unweightedMean: number;
  weightedMean: number;
  weightedTotal: number;
  weightedSE: number;
  ciLower: number;
  ciUpper: number;
  rsePct: number;
  reliability: ReliabilityRating;
}

export interface StratumAnovaResult {
  column: string;
  stratumColumn: string;
  fStatistic: number;
  dfBetween: number;
  dfWithin: number;
  pValue: number;
  significant: boolean;
}

export interface CorrelationMatrixResult {
  columns: string[];
  weighted: boolean;
  matrix: number[][];
}

export interface CrossTabCell {
  sampleCount: number;
  weightedCount: number;
  rowPct: number;
}

export interface CrossTabResult {
  rowColumn: string;
  colColumn: string;
  rowLabels: string[];
  colLabels: string[];
  cells: Record<string, Record<string, CrossTabCell>>;
  rowTotals: Record<string, { sampleCount: number; weightedCount: number }>;
  colTotals: Record<string, { sampleCount: number; weightedCount: number }>;
  grandSampleTotal: number;
  grandWeightedTotal: number;
  chiSquare: number;
  df: number;
  pValue: number;
  significant: boolean;
}

export interface CategoricalBreakdown {
  column: string;
  categories: Array<{
    label: string;
    sampleCount: number;
    unweightedPct: number;
    weightedCount: number;
    weightedPct: number;
    sePct: number;
  }>;
}

export interface AIEstimationInterpretation {
  headlineSynthesis: string;
  keyFindings: string[];
  precisionNotes: string;
  weightingImpact: string;
}

export type ReportTone = 'executive' | 'official' | 'academic';

export interface ReportConfig {
  title: string;
  organization: string;
  tone: ReportTone;
  includeExecutiveSummary: boolean;
  includePreparationAudit: boolean;
  includeMethodology: boolean;
  includeKeyEstimates: boolean;
  includeSubgroupAnalysis: boolean;
  includeLimitations: boolean;
}

export interface GeneratedReport {
  generatedAt: string;
  subtitle: string;
  executiveSummary: string;
  dataPreparationNarrative: string;
  methodologyNarrative: string;
  keyFindingsNarrative: string;
  subgroupAnalysisNarrative: string;
  limitationsAndReliability: string;
  keyTakeaways: string[];
}

export interface WorkflowRecipe {
  schemaVersion: string;
  exportedAt: string;
  datasetName: string;
  cleaningConfig: CleaningConfig;
  estimationConfig: EstimationConfig;
  reportConfig: ReportConfig;
}

export interface AIAnalystMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}
