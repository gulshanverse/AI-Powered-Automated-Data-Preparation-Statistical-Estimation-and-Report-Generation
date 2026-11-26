import React, { useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Check,
  Database,
  Download,
  FileText,
  FolderOpen,
  Menu,
  MessageSquareText,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import {
  AIAnalystMessage,
  AIAuditResult,
  AIEstimationInterpretation,
  CleaningAuditEntry,
  CleaningConfig,
  ColumnCleaningOverride,
  DataRow,
  EstimationConfig,
  GeneratedReport,
  ImputationStrategy,
  OutlierAction,
  ReportConfig,
  WorkflowRecipe,
  WorkflowStage,
} from './types/statigen';
import { SAMPLE_DATASETS } from './data/sampleDatasets';
import {
  computeCorrelationMatrix,
  computeSurveyEstimates,
  profileDataset,
  runCleaningPipeline,
} from './utils/statEngine';
import {
  exportEstimatesToCSV,
  exportRowsToCSV,
  exportRowsToXLSX,
  exportWorkflowRecipe,
  parseUploadedFile,
  parseWorkflowRecipe,
} from './utils/fileIO';
import { IngestStage } from './components/IngestStage';
import { PrepareStage } from './components/PrepareStage';
import { EstimateStage } from './components/EstimateStage';
import { ReportStage } from './components/ReportStage';
import { AiAnalystDrawer } from './components/AiAnalystDrawer';

function buildDefaultConfigs(
  rows: DataRow[],
  datasetName: string,
  defaultWeight?: string,
  defaultStratum?: string
) {
  const profile = profileDataset(rows);
  const weightCol =
    defaultWeight ?? profile.columns.find((c) => c.type === 'weight')?.name ?? '';
  const catCols = profile.columns.filter((c) => c.type === 'categorical').map((c) => c.name);
  const stratumCol = defaultStratum ?? catCols[0] ?? '';
  const numericCols = profile.columns
    .filter((c) => c.type === 'numeric' && c.name !== weightCol)
    .map((c) => c.name);

  const nonNegCols = profile.columns
    .filter((c) => c.type === 'numeric' && (c.negativeCount ?? 0) > 0)
    .map((c) => c.name);

  const cleaningConfig: CleaningConfig = {
    globalNumericImputation: 'median',
    globalCategoricalImputation: 'mode',
    knnK: 5,
    outlierMethod: 'iqr_1_5',
    globalOutlierAction: 'cap',
    columnOverrides: {},
    validation: {
      removeDuplicates: true,
      trimAndStandardizeText: true,
      enforceNonNegativeColumns: nonNegCols.length > 0 ? nonNegCols : numericCols.slice(0, 3),
      customRules: [],
    },
  };

  const estimationConfig: EstimationConfig = {
    weightColumn: weightCol,
    stratumColumn: stratumCol,
    targetColumns: numericCols.slice(0, 4),
    categoricalColumns: catCols.slice(0, 2),
    confidenceLevel: 0.95,
  };

  const reportConfig: ReportConfig = {
    title: `Statistical Findings: ${datasetName}`,
    organization: 'Survey Research & Statistical Analysis Unit',
    tone: 'official',
    includeExecutiveSummary: true,
    includePreparationAudit: true,
    includeMethodology: true,
    includeKeyEstimates: true,
    includeSubgroupAnalysis: true,
    includeLimitations: true,
  };

  return { cleaningConfig, estimationConfig, reportConfig };
}

const STAGE_ITEMS: Array<{
  id: WorkflowStage;
  num: string;
  label: string;
  breadcrumb: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    id: 'ingest',
    num: '01',
    label: 'Data Ingestion',
    breadcrumb: '01. Data Ingestion',
    icon: Database,
  },
  {
    id: 'prepare',
    num: '02',
    label: 'Data Preparation',
    breadcrumb: '02. Data Preparation',
    icon: SlidersHorizontal,
  },
  {
    id: 'estimate',
    num: '03',
    label: 'Survey Estimation',
    breadcrumb: '03. Survey Estimation',
    icon: BarChart3,
  },
  {
    id: 'report',
    num: '04',
    label: 'Report Studio',
    breadcrumb: '04. Report Studio',
    icon: FileText,
  },
];

export default function App() {
  const initialSample = SAMPLE_DATASETS[0];
  const initialDefaults = useMemo(
    () =>
      buildDefaultConfigs(
        initialSample.rows,
        initialSample.name,
        initialSample.defaultWeightColumn,
        initialSample.defaultStratumColumn
      ),
    [initialSample]
  );

  const headerFileInputRef = useRef<HTMLInputElement>(null);
  const recipeFileInputRef = useRef<HTMLInputElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [stage, setStage] = useState<WorkflowStage>('ingest');

  const [datasetName, setDatasetName] = useState(initialSample.name);
  const [activeSampleId, setActiveSampleId] = useState<string | null>(initialSample.id);
  const [rawRows, setRawRows] = useState<DataRow[]>(initialSample.rows);
  const [cleanedRows, setCleanedRows] = useState<DataRow[]>(initialSample.rows);
  const [hasRunCleaning, setHasRunCleaning] = useState(false);
  const [auditLog, setAuditLog] = useState<CleaningAuditEntry[]>([]);
  const [imputedCells, setImputedCells] = useState<Set<string>>(new Set());
  const [adjustedCells, setAdjustedCells] = useState<Set<string>>(new Set());
  const [flaggedOutlierCells, setFlaggedOutlierCells] = useState<Set<string>>(new Set());
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [recipeNotice, setRecipeNotice] = useState<string | null>(null);

  const [cleaningConfig, setCleaningConfig] = useState<CleaningConfig>(
    initialDefaults.cleaningConfig
  );
  const [estimationConfig, setEstimationConfig] = useState<EstimationConfig>(
    initialDefaults.estimationConfig
  );
  const [reportConfig, setReportConfig] = useState<ReportConfig>(initialDefaults.reportConfig);

  // AI states
  const [aiAudit, setAiAudit] = useState<AIAuditResult | null>(null);
  const [aiAuditLoading, setAiAuditLoading] = useState(false);
  const [aiAuditError, setAiAuditError] = useState<string | null>(null);

  const [aiInterpretation, setAiInterpretation] = useState<AIEstimationInterpretation | null>(
    null
  );
  const [aiInterpLoading, setAiInterpLoading] = useState(false);
  const [aiInterpError, setAiInterpError] = useState<string | null>(null);

  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // AI Statistical Analyst Drawer state
  const [analystOpen, setAnalystOpen] = useState(false);
  const [analystMessages, setAnalystMessages] = useState<AIAnalystMessage[]>([]);
  const [analystLoading, setAnalystLoading] = useState(false);
  const [analystError, setAnalystError] = useState<string | null>(null);

  // Computed profiles & survey estimates
  const rawProfile = useMemo(() => profileDataset(rawRows), [rawRows]);
  const cleanedProfile = useMemo(() => profileDataset(cleanedRows), [cleanedRows]);

  const {
    overall: overallEstimates,
    subgroups: subgroupEstimates,
    categorical: categoricalBreakdowns,
  } = useMemo(
    () => computeSurveyEstimates(cleanedRows, estimationConfig),
    [cleanedRows, estimationConfig]
  );

  const loadNewDataset = (
    name: string,
    rows: DataRow[],
    sampleId: string | null,
    defaultWeight?: string,
    defaultStratum?: string
  ) => {
    const defaults = buildDefaultConfigs(rows, name, defaultWeight, defaultStratum);
    setDatasetName(name);
    setActiveSampleId(sampleId);
    setRawRows(rows);
    setCleanedRows(rows);
    setHasRunCleaning(false);
    setAuditLog([]);
    setImputedCells(new Set());
    setAdjustedCells(new Set());
    setFlaggedOutlierCells(new Set());
    setUploadError(null);
    setCleaningConfig(defaults.cleaningConfig);
    setEstimationConfig(defaults.estimationConfig);
    setReportConfig(defaults.reportConfig);
    setAiAudit(null);
    setAiAuditError(null);
    setAiInterpretation(null);
    setAiInterpError(null);
    setReport(null);
    setReportError(null);
    setAnalystMessages([]);
    setAnalystError(null);
  };

  const handleFileUpload = async (file: File) => {
    try {
      setUploadError(null);
      const parsed = await parseUploadedFile(file);
      if (parsed.rows.length === 0) {
        setUploadError('The uploaded file contains no data rows.');
        return;
      }
      loadNewDataset(parsed.name, parsed.rows, null);
      setStage('ingest');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Unable to parse uploaded file.');
    }
  };

  const handleSelectSample = (sampleId: string) => {
    const found = SAMPLE_DATASETS.find((s) => s.id === sampleId);
    if (!found) return;
    loadNewDataset(
      found.name,
      found.rows,
      found.id,
      found.defaultWeightColumn,
      found.defaultStratumColumn
    );
  };

  const handleExecuteCleaning = (overrideConfig?: CleaningConfig) => {
    const activeCfg = overrideConfig ?? cleaningConfig;
    const result = runCleaningPipeline(rawRows, activeCfg);
    setCleanedRows(result.cleanedRows);
    setAuditLog(result.auditLog);
    setImputedCells(result.imputedCells);
    setAdjustedCells(result.adjustedCells);
    setFlaggedOutlierCells(result.flaggedOutlierCells);
    setHasRunCleaning(true);
    setAiInterpretation(null);
    setReport(null);
  };

  const handleResetCleaning = () => {
    setCleanedRows(rawRows);
    setAuditLog([]);
    setImputedCells(new Set());
    setAdjustedCells(new Set());
    setFlaggedOutlierCells(new Set());
    setHasRunCleaning(false);
    setAiInterpretation(null);
    setReport(null);
  };

  const handleExportRecipe = () => {
    const recipe: WorkflowRecipe = {
      schemaVersion: '1.0',
      exportedAt: new Date().toISOString(),
      datasetName,
      cleaningConfig,
      estimationConfig,
      reportConfig,
    };
    exportWorkflowRecipe(recipe);
    setRecipeNotice('Recipe exported (.json)');
    setTimeout(() => setRecipeNotice(null), 2500);
  };

  const handleImportRecipe = async (file: File) => {
    try {
      const recipe = await parseWorkflowRecipe(file);
      const mergedCleaning: CleaningConfig = {
        ...recipe.cleaningConfig,
        validation: {
          ...recipe.cleaningConfig.validation,
          customRules: recipe.cleaningConfig.validation.customRules ?? [],
        },
      };
      setCleaningConfig(mergedCleaning);
      setEstimationConfig(recipe.estimationConfig);
      setReportConfig(recipe.reportConfig);
      handleExecuteCleaning(mergedCleaning);
      setRecipeNotice('Recipe loaded & applied');
      setTimeout(() => setRecipeNotice(null), 2800);
    } catch (err) {
      setRecipeNotice(err instanceof Error ? err.message : 'Invalid recipe file');
      setTimeout(() => setRecipeNotice(null), 3500);
    }
  };

  const handleRunAiAudit = async () => {
    setAiAuditLoading(true);
    setAiAuditError(null);
    try {
      const compactColumns = rawProfile.columns.map((c) => ({
        name: c.name,
        type: c.type,
        missingCount: c.missingCount,
        missingPct: Number(c.missingPct.toFixed(2)),
        uniqueCount: c.uniqueCount,
        mean: c.mean !== undefined ? Number(c.mean.toFixed(2)) : undefined,
        median: c.median !== undefined ? Number(c.median.toFixed(2)) : undefined,
        stdDev: c.stdDev !== undefined ? Number(c.stdDev.toFixed(2)) : undefined,
        min: c.min,
        max: c.max,
        skewness: c.skewness !== undefined ? Number(c.skewness.toFixed(2)) : undefined,
        outlierCountIQR: c.outlierCountIQR,
        negativeCount: c.negativeCount,
      }));

      const res = await fetch('/api/ai/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetName,
          rowCount: rawProfile.rowCount,
          columnCount: rawProfile.columnCount,
          duplicateRows: rawProfile.duplicateRows,
          columns: compactColumns,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete AI quality audit.');
      }
      setAiAudit(data as AIAuditResult);
    } catch (err) {
      setAiAuditError(err instanceof Error ? err.message : 'Unable to reach AI audit service.');
    } finally {
      setAiAuditLoading(false);
    }
  };

  const handleApplyAiPlan = () => {
    if (!aiAudit) return;
    const validImputations = new Set<ImputationStrategy>([
      'none',
      'median',
      'mean',
      'mode',
      'knn',
      'ffill',
      'drop',
    ]);
    const validOutliers = new Set<OutlierAction>(['none', 'flag', 'cap', 'median', 'remove']);

    const overrides: Record<string, ColumnCleaningOverride> = {};
    for (const rec of aiAudit.recommendations) {
      const imp = rec.recommendedImputation?.toLowerCase() as ImputationStrategy;
      const out = rec.recommendedOutlierAction?.toLowerCase() as OutlierAction;
      overrides[rec.column] = {
        imputation: validImputations.has(imp) ? imp : undefined,
        outlierAction: validOutliers.has(out) ? out : undefined,
      };
    }

    const updatedConfig: CleaningConfig = {
      ...cleaningConfig,
      columnOverrides: overrides,
      validation: {
        ...cleaningConfig.validation,
        removeDuplicates: rawProfile.duplicateRows > 0,
        trimAndStandardizeText: true,
      },
    };

    setCleaningConfig(updatedConfig);
    if (aiAudit.suggestedWeightColumn) {
      const colExists = rawProfile.columns.some((c) => c.name === aiAudit.suggestedWeightColumn);
      if (colExists) {
        setEstimationConfig((prev) => ({
          ...prev,
          weightColumn: aiAudit.suggestedWeightColumn,
          targetColumns: prev.targetColumns.filter((c) => c !== aiAudit.suggestedWeightColumn),
        }));
      }
    }
    if (aiAudit.suggestedStratumColumn) {
      const colExists = rawProfile.columns.some((c) => c.name === aiAudit.suggestedStratumColumn);
      if (colExists) {
        setEstimationConfig((prev) => ({
          ...prev,
          stratumColumn: aiAudit.suggestedStratumColumn,
        }));
      }
    }

    handleExecuteCleaning(updatedConfig);
    setStage('prepare');
  };

  const handleRunAiInterpretation = async () => {
    setAiInterpLoading(true);
    setAiInterpError(null);
    try {
      const res = await fetch('/api/ai/interpret-estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetName,
          weightColumn: estimationConfig.weightColumn,
          stratumColumn: estimationConfig.stratumColumn,
          confidenceLevel: estimationConfig.confidenceLevel,
          estimates: overallEstimates,
          subgroups: subgroupEstimates.slice(0, 24),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to interpret survey estimates.');
      }
      setAiInterpretation(data as AIEstimationInterpretation);
    } catch (err) {
      setAiInterpError(
        err instanceof Error ? err.message : 'Unable to reach AI interpretation service.'
      );
    } finally {
      setAiInterpLoading(false);
    }
  };

  const handleGenerateReport = async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const includedSections: string[] = [];
      if (reportConfig.includeExecutiveSummary) includedSections.push('Executive Summary');
      if (reportConfig.includePreparationAudit) includedSections.push('Data Preparation Audit');
      if (reportConfig.includeMethodology) includedSections.push('Survey Methodology');
      if (reportConfig.includeKeyEstimates) includedSections.push('Key Population Estimates');
      if (reportConfig.includeSubgroupAnalysis) includedSections.push('Stratified Subgroup Analysis');
      if (reportConfig.includeLimitations) includedSections.push('Limitations & Reliability');

      const res = await fetch('/api/ai/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportTitle: reportConfig.title,
          organization: reportConfig.organization,
          tone: reportConfig.tone,
          datasetName,
          rawStats: {
            rows: rawProfile.rowCount,
            columns: rawProfile.columnCount,
            missingCells: rawProfile.missingCells,
            duplicates: rawProfile.duplicateRows,
            outliersIQR: rawProfile.totalOutliersIQR,
          },
          cleanedStats: {
            rows: cleanedProfile.rowCount,
            columns: cleanedProfile.columnCount,
            missingCells: cleanedProfile.missingCells,
            completenessPct: Number(cleanedProfile.completenessScore.toFixed(2)),
            outliersIQR: cleanedProfile.totalOutliersIQR,
          },
          auditLog,
          estimationConfig,
          estimates: overallEstimates,
          subgroups: subgroupEstimates.slice(0, 28),
          categoricalBreakdowns,
          includedSections,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate automated report.');
      }
      setReport({
        ...(data as Omit<GeneratedReport, 'generatedAt'>),
        generatedAt: new Date().toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
      });
    } catch (err) {
      setReportError(
        err instanceof Error ? err.message : 'Unable to reach AI report generation service.'
      );
    } finally {
      setReportLoading(false);
    }
  };

  const handleAskAnalyst = async (question: string) => {
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: AIAnalystMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: nowTime,
    };

    setAnalystMessages((prev) => [...prev, userMsg]);
    setAnalystLoading(true);
    setAnalystError(null);

    try {
      const numericCols = cleanedProfile.columns
        .filter((c) => c.type === 'numeric' && c.name !== estimationConfig.weightColumn)
        .map((c) => c.name);
      const corr =
        numericCols.length >= 2
          ? computeCorrelationMatrix(cleanedRows, numericCols, estimationConfig.weightColumn)
          : null;

      const context = {
        datasetName,
        rawSummary: {
          rows: rawProfile.rowCount,
          missingCells: rawProfile.missingCells,
          duplicates: rawProfile.duplicateRows,
          outliersIQR: rawProfile.totalOutliersIQR,
        },
        preparedSummary: {
          rows: cleanedProfile.rowCount,
          missingCells: cleanedProfile.missingCells,
          completenessPct: Number(cleanedProfile.completenessScore.toFixed(2)),
          preparationRun: hasRunCleaning,
        },
        auditLog: auditLog.slice(0, 15),
        estimationConfig,
        overallEstimates,
        subgroups: subgroupEstimates.slice(0, 20),
        correlations: corr
          ? {
              weighted: corr.weighted,
              columns: corr.columns,
              matrix: corr.matrix.map((row) => row.map((v) => Number(v.toFixed(3)))),
            }
          : null,
      };

      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history: analystMessages.map((m) => ({ role: m.role, content: m.content })),
          context,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to get response from AI Statistical Analyst.');
      }

      const assistantMsg: AIAnalystMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.answer || 'No response generated.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setAnalystMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setAnalystError(
        err instanceof Error ? err.message : 'Unable to reach AI Statistical Analyst.'
      );
    } finally {
      setAnalystLoading(false);
    }
  };

  const suggestedAnalystQuestions = useMemo(() => {
    const primaryVar = estimationConfig.targetColumns[0] ?? 'the primary numeric indicator';
    const stratum = estimationConfig.stratumColumn || 'subgroups';
    return [
      `Which variable shows the largest weighted vs. unweighted bias shift and why?`,
      `Summarize the precision (RSE% and design effect) of ${primaryVar} estimates.`,
      `How do ${primaryVar} estimates compare across ${stratum}?`,
      `What data quality risks remain in this dataset before publishing a final report?`,
    ];
  }, [estimationConfig]);

  const activeStageMeta = STAGE_ITEMS.find((s) => s.id === stage) ?? STAGE_ITEMS[0];

  const isStageCompleted = (id: WorkflowStage): boolean => {
    if (id === 'ingest') return rawRows.length > 0;
    if (id === 'prepare') return hasRunCleaning;
    if (id === 'estimate') return overallEstimates.length > 0;
    if (id === 'report') return report !== null;
    return false;
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#0F172A] flex">
      {/* Hidden File Inputs */}
      <input
        ref={headerFileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.tsv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload(file);
          e.target.value = '';
        }}
      />
      <input
        ref={recipeFileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportRecipe(file);
          e.target.value = '';
        }}
      />

      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div
          className="no-print fixed inset-0 z-30 bg-slate-900/35 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Left Sidebar Navigation (256px) */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <button
            type="button"
            onClick={() => setStage('ingest')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap"
          >
            StatiGen AI
          </button>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1" aria-label="Statistical Workflow">
          <p className="px-3 pb-2 text-xs font-medium text-slate-400">Workflow Pipeline</p>
          {STAGE_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = stage === item.id;
            const done = isStageCompleted(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setStage(item.id);
                  setMobileNavOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-slate-400'}`}
                  />
                  <span className="truncate">
                    {item.num}. {item.label}
                  </span>
                </span>
                {done && !active && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-label="Ready" />
                )}
              </button>
            );
          })}

          <div className="pt-5 mt-5 border-t border-slate-200 space-y-1">
            <p className="px-3 pb-1 text-xs font-medium text-slate-400">Utilities</p>
            <button
              type="button"
              onClick={() => {
                setAnalystOpen(true);
                setMobileNavOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-[#1D4ED8] transition-colors hover:bg-blue-50"
            >
              <MessageSquareText className="h-4 w-4 shrink-0" />
              <span className="truncate">AI Statistical Analyst</span>
            </button>

            <div className="grid grid-cols-2 gap-1.5 px-1 pt-2">
              <button
                type="button"
                onClick={handleExportRecipe}
                title="Save cleaning, estimation & report settings as JSON"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
              >
                <Download className="h-3 w-3" />
                Save Recipe
              </button>
              <button
                type="button"
                onClick={() => recipeFileInputRef.current?.click()}
                title="Load a previously saved StatiGen workflow JSON recipe"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
              >
                <FolderOpen className="h-3 w-3" />
                Load Recipe
              </button>
            </div>
            {recipeNotice && (
              <p className="px-3 pt-1 text-[11px] font-medium text-emerald-700">{recipeNotice}</p>
            )}
          </div>
        </nav>

        {/* Quiet Active Dataset Metadata Footer */}
        <div className="border-t border-slate-200 px-6 py-4 space-y-1.5">
          <p className="text-xs font-semibold text-slate-900 truncate" title={datasetName}>
            {datasetName}
          </p>
          <p className="font-mono text-xs text-slate-500 tabular-nums">
            {cleanedProfile.rowCount} rows · {cleanedProfile.columnCount} cols
          </p>
          <p className="text-xs text-slate-500">
            {hasRunCleaning
              ? `Prepared (${auditLog.length} steps applied)`
              : 'Raw microdata active'}
          </p>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract: Breadcrumb — Quiet Context — 1 Primary Action */}
        <header className="no-print sticky top-0 z-20 flex h-16 items-center justify-between gap-8 border-b border-slate-200 bg-white/95 px-6 backdrop-blur-xs">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 whitespace-nowrap hidden sm:inline">Workspace</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-slate-900 truncate">
                {activeStageMeta.breadcrumb}
              </span>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
            <span>{cleanedProfile.completenessScore.toFixed(1)}% complete</span>
            <span aria-hidden="true">·</span>
            <span>{estimationConfig.weightColumn || 'Unweighted'}</span>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => headerFileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5 text-slate-600" />
              Import Dataset
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 py-8 print:max-w-none print:p-0">
          {stage === 'ingest' && (
            <IngestStage
              datasetName={datasetName}
              activeSampleId={activeSampleId}
              rawRows={rawRows}
              rawProfile={rawProfile}
              aiAudit={aiAudit}
              aiAuditLoading={aiAuditLoading}
              aiAuditError={aiAuditError}
              uploadError={uploadError}
              onFileUpload={handleFileUpload}
              onSelectSample={handleSelectSample}
              onRunAiAudit={handleRunAiAudit}
              onApplyAiPlan={handleApplyAiPlan}
              onProceedToPrepare={() => setStage('prepare')}
            />
          )}

          {stage === 'prepare' && (
            <PrepareStage
              datasetName={datasetName}
              rawRows={rawRows}
              cleanedRows={cleanedRows}
              rawProfile={rawProfile}
              cleanedProfile={cleanedProfile}
              cleaningConfig={cleaningConfig}
              auditLog={auditLog}
              imputedCells={imputedCells}
              adjustedCells={adjustedCells}
              flaggedOutlierCells={flaggedOutlierCells}
              hasRunCleaning={hasRunCleaning}
              onUpdateConfig={setCleaningConfig}
              onExecuteCleaning={() => handleExecuteCleaning()}
              onResetCleaning={handleResetCleaning}
              onExportCSV={() => exportRowsToCSV(cleanedRows, `${datasetName}_cleaned`)}
              onExportXLSX={() => exportRowsToXLSX(cleanedRows, `${datasetName}_cleaned`)}
              onProceedToEstimate={() => setStage('estimate')}
            />
          )}

          {stage === 'estimate' && (
            <EstimateStage
              cleanedRows={cleanedRows}
              cleanedProfile={cleanedProfile}
              estimationConfig={estimationConfig}
              overallEstimates={overallEstimates}
              subgroupEstimates={subgroupEstimates}
              categoricalBreakdowns={categoricalBreakdowns}
              aiInterpretation={aiInterpretation}
              aiInterpLoading={aiInterpLoading}
              aiInterpError={aiInterpError}
              onUpdateEstimationConfig={setEstimationConfig}
              onRunAiInterpretation={handleRunAiInterpretation}
              onExportEstimatesCSV={() => exportEstimatesToCSV(overallEstimates, datasetName)}
              onProceedToReport={() => setStage('report')}
            />
          )}

          {stage === 'report' && (
            <ReportStage
              datasetName={datasetName}
              rawProfile={rawProfile}
              cleanedProfile={cleanedProfile}
              auditLog={auditLog}
              estimationConfig={estimationConfig}
              overallEstimates={overallEstimates}
              subgroupEstimates={subgroupEstimates}
              categoricalBreakdowns={categoricalBreakdowns}
              reportConfig={reportConfig}
              report={report}
              reportLoading={reportLoading}
              reportError={reportError}
              onUpdateReportConfig={setReportConfig}
              onUpdateReport={(updater) => setReport((prev) => (prev ? updater(prev) : prev))}
              onGenerateReport={handleGenerateReport}
            />
          )}
        </main>
      </div>

      {/* Grounded AI Statistical Analyst Slide-Over */}
      <AiAnalystDrawer
        open={analystOpen}
        datasetName={datasetName}
        messages={analystMessages}
        loading={analystLoading}
        error={analystError}
        suggestedQuestions={suggestedAnalystQuestions}
        onClose={() => setAnalystOpen(false)}
        onSendQuestion={handleAskAnalyst}
        onClearHistory={() => {
          setAnalystMessages([]);
          setAnalystError(null);
        }}
      />
    </div>
  );
}
