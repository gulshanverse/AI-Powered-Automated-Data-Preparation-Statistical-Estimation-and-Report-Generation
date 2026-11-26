import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Download,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CleaningAuditEntry,
  CleaningConfig,
  CustomValidationRule,
  DataRow,
  DatasetProfile,
  ImputationStrategy,
  OutlierAction,
  OutlierMethod,
  ValidationRuleType,
} from '../types/statigen';
import { buildComparisonHistogram, formatNumber, isMissing } from '../utils/statEngine';

interface PrepareStageProps {
  datasetName: string;
  rawRows: DataRow[];
  cleanedRows: DataRow[];
  rawProfile: DatasetProfile;
  cleanedProfile: DatasetProfile;
  cleaningConfig: CleaningConfig;
  auditLog: CleaningAuditEntry[];
  imputedCells: Set<string>;
  adjustedCells: Set<string>;
  flaggedOutlierCells: Set<string>;
  hasRunCleaning: boolean;
  onUpdateConfig: (updater: (prev: CleaningConfig) => CleaningConfig) => void;
  onExecuteCleaning: () => void;
  onResetCleaning: () => void;
  onExportCSV: () => void;
  onExportXLSX: () => void;
  onProceedToEstimate: () => void;
}

export const PrepareStage: React.FC<PrepareStageProps> = ({
  rawRows,
  cleanedRows,
  rawProfile,
  cleanedProfile,
  cleaningConfig,
  auditLog,
  imputedCells,
  adjustedCells,
  flaggedOutlierCells,
  hasRunCleaning,
  onUpdateConfig,
  onExecuteCleaning,
  onResetCleaning,
  onExportCSV,
  onExportXLSX,
  onProceedToEstimate,
}) => {
  const numericCols = useMemo(
    () => rawProfile.columns.filter((c) => c.type === 'numeric'),
    [rawProfile]
  );

  const editableCols = useMemo(
    () => rawProfile.columns.filter((c) => c.type !== 'id'),
    [rawProfile]
  );

  const [rightTab, setRightTab] = useState<'diagnostics' | 'overrides' | 'preview'>('diagnostics');
  const [selectedHistCol, setSelectedHistCol] = useState<string>(() => numericCols[0]?.name ?? '');

  // Custom validation rule form state
  const [ruleType, setRuleType] = useState<ValidationRuleType>('range');
  const [ruleCol, setRuleCol] = useState<string>(() => numericCols[0]?.name ?? '');
  const [ruleMin, setRuleMin] = useState<string>('0');
  const [ruleMax, setRuleMax] = useState<string>('120');
  const [ruleCompareCol, setRuleCompareCol] = useState<string>(() => numericCols[1]?.name ?? '');
  const [ruleAction, setRuleAction] = useState<'recode_missing' | 'flag'>('recode_missing');

  const activeHistCol = numericCols.some((c) => c.name === selectedHistCol)
    ? selectedHistCol
    : numericCols[0]?.name ?? '';

  const activeRuleCol = numericCols.some((c) => c.name === ruleCol)
    ? ruleCol
    : numericCols[0]?.name ?? '';

  const activeCompareCol = numericCols.some((c) => c.name === ruleCompareCol && c.name !== activeRuleCol)
    ? ruleCompareCol
    : numericCols.find((c) => c.name !== activeRuleCol)?.name ?? '';

  const histogramData = useMemo(() => {
    if (!activeHistCol) return [];
    return buildComparisonHistogram(rawRows, cleanedRows, activeHistCol, 10);
  }, [rawRows, cleanedRows, activeHistCol]);

  const toggleNonNegativeCol = (colName: string) => {
    onUpdateConfig((prev) => {
      const exists = prev.validation.enforceNonNegativeColumns.includes(colName);
      return {
        ...prev,
        validation: {
          ...prev.validation,
          enforceNonNegativeColumns: exists
            ? prev.validation.enforceNonNegativeColumns.filter((c) => c !== colName)
            : [...prev.validation.enforceNonNegativeColumns, colName],
        },
      };
    });
  };

  const handleAddCustomRule = () => {
    if (!activeRuleCol) return;
    const newRule: CustomValidationRule =
      ruleType === 'range'
        ? {
            id: `rule-${Date.now()}`,
            type: 'range',
            column: activeRuleCol,
            min: ruleMin.trim() !== '' ? Number(ruleMin) : undefined,
            max: ruleMax.trim() !== '' ? Number(ruleMax) : undefined,
            action: ruleAction,
          }
        : {
            id: `rule-${Date.now()}`,
            type: 'cross_lte',
            column: activeRuleCol,
            compareColumn: activeCompareCol,
            action: ruleAction,
          };

    onUpdateConfig((prev) => ({
      ...prev,
      validation: {
        ...prev.validation,
        customRules: [...(prev.validation.customRules ?? []), newRule],
      },
    }));
  };

  const handleRemoveCustomRule = (id: string) => {
    onUpdateConfig((prev) => ({
      ...prev,
      validation: {
        ...prev.validation,
        customRules: (prev.validation.customRules ?? []).filter((r) => r.id !== id),
      },
    }));
  };

  const updateColumnOverride = (
    colName: string,
    field: 'imputation' | 'outlierAction',
    value: string
  ) => {
    onUpdateConfig((prev) => {
      const existing = prev.columnOverrides[colName] ?? {};
      const nextOverride = {
        ...existing,
        [field]: value === 'default' ? undefined : value,
      };
      const nextMap = { ...prev.columnOverrides };
      if (!nextOverride.imputation && !nextOverride.outlierAction) {
        delete nextMap[colName];
      } else {
        nextMap[colName] = nextOverride;
      }
      return { ...prev, columnOverrides: nextMap };
    });
  };

  const overrideCount = Object.keys(cleaningConfig.columnOverrides).length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Stage 02 · Automated Data Preparation &amp; Validation
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Cleaning Pipeline &amp; Diagnostics
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onResetCleaning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to Raw
          </button>
          <button
            type="button"
            onClick={onExecuteCleaning}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D4ED8] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap"
          >
            <Play className="h-3.5 w-3.5" />
            Run Cleaning Pipeline
          </button>
          <button
            type="button"
            onClick={onProceedToEstimate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap"
          >
            Survey Estimation
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main 2-Column Workspace */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Pipeline Configuration */}
        <div className="xl:col-span-5 space-y-6">
          {/* Missing Value Imputation */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                01. Missing Value Imputation
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Configure global imputation defaults. Use the Per-Column Rules tab to assign custom methods per variable.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Numeric Strategy
                </label>
                <select
                  value={cleaningConfig.globalNumericImputation}
                  onChange={(e) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      globalNumericImputation: e.target.value as ImputationStrategy,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
                >
                  <option value="median">Median (Skew-Robust)</option>
                  <option value="mean">Arithmetic Mean</option>
                  <option value="knn">K-Nearest Neighbors (KNN)</option>
                  <option value="ffill">Forward Fill</option>
                  <option value="drop">Drop Incomplete Rows</option>
                  <option value="none">Leave Unchanged</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Categorical Strategy
                </label>
                <select
                  value={cleaningConfig.globalCategoricalImputation}
                  onChange={(e) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      globalCategoricalImputation: e.target.value as ImputationStrategy,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
                >
                  <option value="mode">Mode (Most Frequent)</option>
                  <option value="ffill">Forward Fill</option>
                  <option value="drop">Drop Incomplete Rows</option>
                  <option value="none">Leave Unchanged</option>
                </select>
              </div>
            </div>

            {cleaningConfig.globalNumericImputation === 'knn' && (
              <div>
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-slate-700">KNN Neighbor Count (k)</label>
                  <span className="font-mono text-slate-900 tabular-nums">
                    k = {cleaningConfig.knnK}
                  </span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={12}
                  value={cleaningConfig.knnK}
                  onChange={(e) =>
                    onUpdateConfig((prev) => ({ ...prev, knnK: Number(e.target.value) }))
                  }
                  className="mt-2 w-full accent-[#1D4ED8]"
                />
              </div>
            )}
          </div>

          {/* Outlier Detection & Handling */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                02. Outlier Detection &amp; Treatment
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Applies to numeric analysis variables while preserving sampling weights and record identifiers.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Detection Method
                </label>
                <select
                  value={cleaningConfig.outlierMethod}
                  onChange={(e) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      outlierMethod: e.target.value as OutlierMethod,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
                >
                  <option value="iqr_1_5">IQR Fence (1.5x)</option>
                  <option value="iqr_3_0">Extreme IQR Fence (3.0x)</option>
                  <option value="zscore_3">Z-Score (|z| &gt; 3.0)</option>
                  <option value="zscore_2_5">Z-Score (|z| &gt; 2.5)</option>
                  <option value="winsor_5">5th–95th Percentile Bounds</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Treatment Action
                </label>
                <select
                  value={cleaningConfig.globalOutlierAction}
                  onChange={(e) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      globalOutlierAction: e.target.value as OutlierAction,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
                >
                  <option value="cap">Winsorize / Cap to Fence</option>
                  <option value="median">Replace with Median</option>
                  <option value="flag">Flag Only (Retain Values)</option>
                  <option value="remove">Remove Outlier Records</option>
                  <option value="none">No Outlier Treatment</option>
                </select>
              </div>
            </div>
          </div>

          {/* Rule-Based Consistency & Custom Domain Validation */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                03. Validation &amp; Consistency Rules
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Enforce Fellegi-Holt style structural edits: deduplication, casing normalization, non-negative bounds, and custom range/cross-field edits.
              </p>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cleaningConfig.validation.removeDuplicates}
                  onChange={(e) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      validation: { ...prev.validation, removeDuplicates: e.target.checked },
                    }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#1D4ED8]"
                />
                <span className="text-xs leading-relaxed text-slate-700">
                  <strong className="font-semibold text-slate-900">Remove Exact Duplicates</strong>{' '}
                  — Detected {rawProfile.duplicateRows} duplicate record(s) in raw input.
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cleaningConfig.validation.trimAndStandardizeText}
                  onChange={(e) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      validation: {
                        ...prev.validation,
                        trimAndStandardizeText: e.target.checked,
                      },
                    }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#1D4ED8]"
                />
                <span className="text-xs leading-relaxed text-slate-700">
                  <strong className="font-semibold text-slate-900">
                    Trim &amp; Standardize Categories
                  </strong>{' '}
                  — Strip spaces and harmonize capitalization.
                </span>
              </label>
            </div>

            {numericCols.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs font-medium text-slate-700 mb-2">
                  Enforce Non-Negative Domain Bounds (&ge; 0)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {numericCols.map((col) => {
                    const checked = cleaningConfig.validation.enforceNonNegativeColumns.includes(
                      col.name
                    );
                    return (
                      <label
                        key={col.name}
                        className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleNonNegativeCol(col.name)}
                          className="h-3.5 w-3.5 rounded border-slate-300 accent-[#1D4ED8]"
                        />
                        <span className="font-mono truncate">{col.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Custom Range / Cross-Field Rule Builder */}
            {numericCols.length > 0 && (
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <p className="text-xs font-semibold text-slate-800">
                  Custom Domain &amp; Cross-Variable Rules
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={ruleType}
                    onChange={(e) => setRuleType(e.target.value as ValidationRuleType)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                  >
                    <option value="range">Numeric Range [Min, Max]</option>
                    {numericCols.length >= 2 && (
                      <option value="cross_lte">Cross-Field (Var A &le; Var B)</option>
                    )}
                  </select>
                  <select
                    value={activeRuleCol}
                    onChange={(e) => setRuleCol(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                  >
                    {numericCols.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {ruleType === 'range' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={ruleMin}
                      onChange={(e) => setRuleMin(e.target.value)}
                      placeholder="Min bound"
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                    />
                    <input
                      type="number"
                      value={ruleMax}
                      onChange={(e) => setRuleMax(e.target.value)}
                      placeholder="Max bound"
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="whitespace-nowrap">must be &le;</span>
                    <select
                      value={activeCompareCol}
                      onChange={(e) => setRuleCompareCol(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                    >
                      {numericCols
                        .filter((c) => c.name !== activeRuleCol)
                        .map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <select
                    value={ruleAction}
                    onChange={(e) => setRuleAction(e.target.value as 'recode_missing' | 'flag')}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                  >
                    <option value="recode_missing">Recode Violation to Missing (Impute)</option>
                    <option value="flag">Flag Violation Only</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleAddCustomRule}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Rule
                  </button>
                </div>

                {(cleaningConfig.validation.customRules?.length ?? 0) > 0 && (
                  <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
                    {cleaningConfig.validation.customRules.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-2 py-2 text-xs"
                      >
                        <span className="font-mono text-slate-700 truncate">
                          {r.type === 'range'
                            ? `${r.column} ∈ [${r.min ?? '-∞'}, ${r.max ?? '+∞'}]`
                            : `${r.column} <= ${r.compareColumn}`}{' '}
                          <span className="font-sans text-slate-500">
                            · {r.action === 'recode_missing' ? 'Recode' : 'Flag'}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomRule(r.id)}
                          aria-label="Remove custom rule"
                          className="text-slate-400 hover:text-red-700 shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Diagnostics / Per-Column Overrides / Prepared Data Preview */}
        <div className="xl:col-span-7 space-y-6">
          {/* Right View Switcher Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
              <button
                type="button"
                onClick={() => setRightTab('diagnostics')}
                className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  rightTab === 'diagnostics'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Before/After &amp; Audit ({auditLog.length})
              </button>
              <button
                type="button"
                onClick={() => setRightTab('overrides')}
                className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  rightTab === 'overrides'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Per-Column Rules ({overrideCount})
              </button>
              <button
                type="button"
                onClick={() => setRightTab('preview')}
                className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  rightTab === 'preview'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Prepared Data ({cleanedProfile.rowCount})
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onExportCSV}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={onExportXLSX}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                Export Excel
              </button>
            </div>
          </div>

          {rightTab === 'diagnostics' && (
            <>
              {/* Before vs After Summary */}
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Before vs. After Preparation Summary
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {hasRunCleaning
                      ? 'Active cleaned dataset compared against original raw microdata.'
                      : 'Run the cleaning pipeline to apply transformations and inspect delta metrics.'}
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-xs text-slate-500">Records</p>
                    <p className="mt-1 font-mono text-base font-semibold text-slate-900 tabular-nums">
                      {rawProfile.rowCount} &rarr; {cleanedProfile.rowCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Missing Cells</p>
                    <p className="mt-1 font-mono text-base font-semibold text-emerald-700 tabular-nums">
                      {rawProfile.missingCells} &rarr; {cleanedProfile.missingCells}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Duplicates</p>
                    <p className="mt-1 font-mono text-base font-semibold text-slate-900 tabular-nums">
                      {rawProfile.duplicateRows} &rarr; {cleanedProfile.duplicateRows}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">IQR Outliers</p>
                    <p className="mt-1 font-mono text-base font-semibold text-slate-900 tabular-nums">
                      {rawProfile.totalOutliersIQR} &rarr; {cleanedProfile.totalOutliersIQR}
                    </p>
                  </div>
                </div>

                <div className="mt-5 overflow-x-auto border-t border-slate-200 pt-4">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3 font-semibold">Numeric Variable</th>
                        <th className="py-2 px-3 text-right font-semibold">Raw Mean</th>
                        <th className="py-2 px-3 text-right font-semibold">Cleaned Mean</th>
                        <th className="py-2 px-3 text-right font-semibold">Raw SD</th>
                        <th className="py-2 px-3 text-right font-semibold">Cleaned SD</th>
                        <th className="py-2 pl-3 text-right font-semibold">Missing (Raw &rarr; Clean)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {numericCols.map((rawCol) => {
                        const cleanCol = cleanedProfile.columns.find((c) => c.name === rawCol.name);
                        return (
                          <tr key={rawCol.name} className="text-slate-700">
                            <td className="py-2.5 pr-3 font-mono font-medium text-slate-900">
                              {rawCol.name}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                              {formatNumber(rawCol.mean ?? 0)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-slate-900">
                              {formatNumber(cleanCol?.mean ?? 0)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                              {formatNumber(rawCol.stdDev ?? 0)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                              {formatNumber(cleanCol?.stdDev ?? 0)}
                            </td>
                            <td className="py-2.5 pl-3 text-right font-mono tabular-nums">
                              {rawCol.missingCount} &rarr; {cleanCol?.missingCount ?? 0}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Distribution Histogram Comparison */}
              {activeHistCol && (
                <div className="rounded-xl border border-slate-200 bg-white p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        Distribution Shift Verification
                      </h2>
                      <p className="text-xs text-slate-500">
                        Compare binned frequency counts before and after imputation and outlier treatment.
                      </p>
                    </div>
                    <select
                      value={activeHistCol}
                      onChange={(e) => setSelectedHistCol(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                    >
                      {numericCols.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={histogramData}
                        margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'IBM Plex Mono' }}
                          axisLine={{ stroke: '#CBD5E1' }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'IBM Plex Mono' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#FFFFFF',
                            borderColor: '#E2E8F0',
                            borderRadius: '8px',
                            fontSize: '12px',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        <Bar dataKey="rawCount" name="Raw Data" fill="#94A3B8" radius={[3, 3, 0, 0]} />
                        <Bar
                          dataKey="cleanedCount"
                          name="Prepared Data"
                          fill="#1D4ED8"
                          radius={[3, 3, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Reproducible Audit Log */}
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <h2 className="text-base font-semibold text-slate-900">
                  Preparation Audit Trail ({auditLog.length} operations)
                </h2>
                {auditLog.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">
                    No cleaning operations have been executed yet. Adjust the rules on the left and click{' '}
                    <strong>Run Cleaning Pipeline</strong> to generate an auditable preparation log.
                  </p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 pr-3 font-semibold">Operation</th>
                          <th className="py-2 pr-3 font-semibold">Variable</th>
                          <th className="py-2 pr-3 font-semibold">Method</th>
                          <th className="py-2 px-3 text-right font-semibold">Affected</th>
                          <th className="py-2 pl-3 font-semibold">Audit Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {auditLog.map((entry) => (
                          <tr key={entry.id} className="text-slate-700">
                            <td className="py-2.5 pr-3 font-medium text-slate-900 whitespace-nowrap">
                              {entry.step}
                            </td>
                            <td className="py-2.5 pr-3 font-mono text-slate-800 whitespace-nowrap">
                              {entry.column}
                            </td>
                            <td className="py-2.5 pr-3 text-slate-600">{entry.method}</td>
                            <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900 tabular-nums">
                              {entry.affectedRows}
                            </td>
                            <td className="py-2.5 pl-3 text-slate-600">{entry.details}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {rightTab === 'overrides' && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Per-Column Imputation &amp; Outlier Overrides
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Override the global strategy for individual variables. Click Run Cleaning Pipeline after making changes.
                  </p>
                </div>
                {overrideCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onUpdateConfig((prev) => ({ ...prev, columnOverrides: {} }))}
                    className="text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap"
                  >
                    Clear All Overrides
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-semibold">Variable</th>
                      <th className="py-2 px-3 font-semibold">Role</th>
                      <th className="py-2 px-3 font-semibold">Imputation Override</th>
                      <th className="py-2 pl-3 font-semibold">Outlier Override</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {editableCols.map((col) => {
                      const ov = cleaningConfig.columnOverrides[col.name];
                      const isNumeric = col.type === 'numeric';
                      return (
                        <tr key={col.name} className="text-slate-700">
                          <td className="py-2.5 pr-3 font-mono font-medium text-slate-900">
                            {col.name}
                          </td>
                          <td className="py-2.5 px-3 capitalize text-slate-500">{col.type}</td>
                          <td className="py-2.5 px-3">
                            <select
                              value={ov?.imputation ?? 'default'}
                              onChange={(e) =>
                                updateColumnOverride(col.name, 'imputation', e.target.value)
                              }
                              className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 focus:border-[#1D4ED8] focus:bg-white focus:outline-none"
                            >
                              <option value="default">Use Global Default</option>
                              {isNumeric || col.type === 'weight' ? (
                                <>
                                  <option value="median">Median</option>
                                  <option value="mean">Mean</option>
                                  <option value="knn">KNN (k={cleaningConfig.knnK})</option>
                                  <option value="ffill">Forward Fill</option>
                                  <option value="drop">Drop Rows</option>
                                  <option value="none">Leave Unchanged</option>
                                </>
                              ) : (
                                <>
                                  <option value="mode">Mode</option>
                                  <option value="ffill">Forward Fill</option>
                                  <option value="drop">Drop Rows</option>
                                  <option value="none">Leave Unchanged</option>
                                </>
                              )}
                            </select>
                          </td>
                          <td className="py-2.5 pl-3">
                            {isNumeric ? (
                              <select
                                value={ov?.outlierAction ?? 'default'}
                                onChange={(e) =>
                                  updateColumnOverride(col.name, 'outlierAction', e.target.value)
                                }
                                className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 focus:border-[#1D4ED8] focus:bg-white focus:outline-none"
                              >
                                <option value="default">Use Global Default</option>
                                <option value="cap">Winsorize / Cap</option>
                                <option value="median">Replace with Median</option>
                                <option value="flag">Flag Only</option>
                                <option value="remove">Remove Rows</option>
                                <option value="none">No Treatment</option>
                              </select>
                            ) : (
                              <span className="text-slate-400">Not applicable</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {rightTab === 'preview' && (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-6 py-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Prepared Microdata Inspector
                  </h2>
                  <p className="text-xs text-slate-500">
                    Inspect transformed cells: {imputedCells.size} imputed · {adjustedCells.size}{' '}
                    outlier-adjusted · {flaggedOutlierCells.size} flagged.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[520px]">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5 font-mono text-slate-500">#</th>
                      {cleanedProfile.columns.map((col) => (
                        <th
                          key={col.name}
                          className="px-4 py-2.5 font-semibold text-slate-700 whitespace-nowrap"
                        >
                          {col.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cleanedRows.slice(0, 100).map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2 font-mono text-slate-400 tabular-nums">
                          {idx + 1}
                        </td>
                        {cleanedProfile.columns.map((col) => {
                          const val = row[col.name];
                          const key = `${idx}::${col.name}`;
                          const isImp = imputedCells.has(key);
                          const isAdj = adjustedCells.has(key);
                          const isFlag = flaggedOutlierCells.has(key);
                          const missing = isMissing(val);
                          const isNum = col.type === 'numeric' || col.type === 'weight';

                          return (
                            <td
                              key={col.name}
                              className={`px-4 py-2 whitespace-nowrap ${
                                isNum ? 'text-right font-mono tabular-nums' : 'text-slate-800'
                              } ${
                                missing
                                  ? 'bg-amber-50/80 text-amber-800 font-medium'
                                  : isImp
                                  ? 'bg-blue-50/80 text-[#1D4ED8] font-medium'
                                  : isAdj
                                  ? 'bg-emerald-50/80 text-emerald-800 font-medium'
                                  : isFlag
                                  ? 'bg-red-50/80 text-red-800 font-medium'
                                  : ''
                              }`}
                            >
                              {missing
                                ? 'Missing'
                                : isImp
                                ? `${String(val)} (Imputed)`
                                : isAdj
                                ? `${String(val)} (Adjusted)`
                                : isFlag
                                ? `${String(val)} (Flagged)`
                                : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-200 px-6 py-3 text-xs text-slate-500">
                Showing first {Math.min(100, cleanedRows.length)} of {cleanedRows.length} prepared
                records.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
