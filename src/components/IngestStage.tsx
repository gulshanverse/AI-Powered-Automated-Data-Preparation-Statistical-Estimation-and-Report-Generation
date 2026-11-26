import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  CheckCircle2,
  FileSpreadsheet,
  Filter,
  Loader2,
  Search,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { AIAuditResult, ColumnType, DataRow, DatasetProfile } from '../types/statigen';
import { SAMPLE_DATASETS } from '../data/sampleDatasets';
import { formatNumber, isMissing, toNumeric } from '../utils/statEngine';

interface IngestStageProps {
  datasetName: string;
  activeSampleId: string | null;
  rawRows: DataRow[];
  rawProfile: DatasetProfile;
  aiAudit: AIAuditResult | null;
  aiAuditLoading: boolean;
  aiAuditError: string | null;
  uploadError: string | null;
  onFileUpload: (file: File) => void;
  onSelectSample: (sampleId: string) => void;
  onRunAiAudit: () => void;
  onApplyAiPlan: () => void;
  onProceedToPrepare: () => void;
}

type GridFilter = 'all' | 'missing' | 'outliers';
type SchemaDiagnosticFilter = 'all' | 'issues' | 'missing' | 'outliers' | 'nominal';
type RoleFilter = 'all' | ColumnType;
type SchemaSortKey = 'name' | 'type' | 'missingPct' | 'mean' | 'stdDev' | 'outliers';

export const IngestStage: React.FC<IngestStageProps> = ({
  datasetName,
  activeSampleId,
  rawRows,
  rawProfile,
  aiAudit,
  aiAuditLoading,
  aiAuditError,
  uploadError,
  onFileUpload,
  onSelectSample,
  onRunAiAudit,
  onApplyAiPlan,
  onProceedToPrepare,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'schema' | 'preview'>('schema');

  // AI Audit search & issue-type filter
  const [auditSearch, setAuditSearch] = useState('');
  const [auditIssueFilter, setAuditIssueFilter] = useState<string>('all');

  // Schema Profile search, role, diagnostic filters & sorting
  const [schemaSearch, setSchemaSearch] = useState('');
  const [schemaRoleFilter, setSchemaRoleFilter] = useState<RoleFilter>('all');
  const [schemaDiagFilter, setSchemaDiagFilter] = useState<SchemaDiagnosticFilter>('all');
  const [schemaSortKey, setSchemaSortKey] = useState<SchemaSortKey | null>(null);
  const [schemaSortDir, setSchemaSortDir] = useState<'asc' | 'desc'>('asc');

  // Raw Data Grid row search, row filter, column filter & sorting
  const [searchTerm, setSearchTerm] = useState('');
  const [gridFilter, setGridFilter] = useState<GridFilter>('all');
  const [gridColumnScope, setGridColumnScope] = useState<string>('all');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    setAuditSearch('');
    setAuditIssueFilter('all');
    setSchemaSearch('');
    setSchemaRoleFilter('all');
    setSchemaDiagFilter('all');
    setSchemaSortKey(null);
    setSearchTerm('');
    setGridFilter('all');
    setGridColumnScope('all');
    setSortCol(null);
  }, [datasetName]);

  const auditIssueTypes = useMemo(() => {
    if (!aiAudit) return [];
    const unique = Array.from(new Set(aiAudit.recommendations.map((r) => r.issueType).filter(Boolean)));
    return unique;
  }, [aiAudit]);

  const filteredAuditRecommendations = useMemo(() => {
    if (!aiAudit) return [];
    const q = auditSearch.trim().toLowerCase();
    return aiAudit.recommendations.filter((rec) => {
      if (auditIssueFilter !== 'all' && rec.issueType !== auditIssueFilter) return false;
      if (!q) return true;
      return (
        rec.column.toLowerCase().includes(q) ||
        rec.issueType.toLowerCase().includes(q) ||
        rec.recommendedImputation.toLowerCase().includes(q) ||
        rec.recommendedOutlierAction.toLowerCase().includes(q) ||
        rec.rationale.toLowerCase().includes(q)
      );
    });
  }, [aiAudit, auditSearch, auditIssueFilter]);

  const filteredSchemaColumns = useMemo(() => {
    const q = schemaSearch.trim().toLowerCase();
    let cols = rawProfile.columns.filter((col) => {
      if (schemaRoleFilter !== 'all' && col.type !== schemaRoleFilter) return false;

      const hasOutlierOrNeg = col.outlierCountIQR > 0 || (col.negativeCount ?? 0) > 0;
      const hasMissing = col.missingCount > 0;
      const hasAnyIssue = hasOutlierOrNeg || hasMissing;

      if (schemaDiagFilter === 'issues' && !hasAnyIssue) return false;
      if (schemaDiagFilter === 'missing' && !hasMissing) return false;
      if (schemaDiagFilter === 'outliers' && !hasOutlierOrNeg) return false;
      if (schemaDiagFilter === 'nominal' && hasAnyIssue) return false;

      if (!q) return true;
      const topCatMatch = col.topCategories?.some((c) => c.value.toLowerCase().includes(q)) ?? false;
      return col.name.toLowerCase().includes(q) || col.type.toLowerCase().includes(q) || topCatMatch;
    });

    if (schemaSortKey) {
      cols = [...cols].sort((a, b) => {
        let cmp = 0;
        if (schemaSortKey === 'name') {
          cmp = a.name.localeCompare(b.name);
        } else if (schemaSortKey === 'type') {
          cmp = a.type.localeCompare(b.type);
        } else if (schemaSortKey === 'missingPct') {
          cmp = a.missingPct - b.missingPct;
        } else if (schemaSortKey === 'mean') {
          cmp = (a.mean ?? -Infinity) - (b.mean ?? -Infinity);
        } else if (schemaSortKey === 'stdDev') {
          cmp = (a.stdDev ?? -Infinity) - (b.stdDev ?? -Infinity);
        } else if (schemaSortKey === 'outliers') {
          cmp =
            a.outlierCountIQR +
            (a.negativeCount ?? 0) -
            (b.outlierCountIQR + (b.negativeCount ?? 0));
        }
        return schemaSortDir === 'asc' ? cmp : -cmp;
      });
    }

    return cols;
  }, [rawProfile.columns, schemaSearch, schemaRoleFilter, schemaDiagFilter, schemaSortKey, schemaSortDir]);

  const visibleGridColumns = useMemo(() => {
    if (gridColumnScope === 'all') return rawProfile.columns;
    if (gridColumnScope === 'role:numeric') {
      return rawProfile.columns.filter((c) => c.type === 'numeric' || c.type === 'weight');
    }
    if (gridColumnScope === 'role:categorical') {
      return rawProfile.columns.filter((c) => c.type === 'categorical' || c.type === 'id');
    }
    if (gridColumnScope === 'flagged') {
      const flagged = rawProfile.columns.filter(
        (c) => c.missingCount > 0 || c.outlierCountIQR > 0 || (c.negativeCount ?? 0) > 0
      );
      return flagged.length > 0 ? flagged : rawProfile.columns;
    }
    const exact = rawProfile.columns.filter((c) => c.name === gridColumnScope || c.type === 'id');
    return exact.length > 0 ? exact : rawProfile.columns;
  }, [rawProfile.columns, gridColumnScope]);

  const outlierCellSet = useMemo(() => {
    const s = new Set<string>();
    for (const col of rawProfile.columns) {
      for (const idx of col.outlierRowIndicesIQR) {
        s.add(`${idx}::${col.name}`);
      }
    }
    return s;
  }, [rawProfile]);

  const outlierRowSet = useMemo(() => {
    const s = new Set<number>();
    for (const col of rawProfile.columns) {
      for (const idx of col.outlierRowIndicesIQR) {
        s.add(idx);
      }
    }
    return s;
  }, [rawProfile]);

  const filteredPreviewRows = useMemo(() => {
    const indexed = rawRows.map((row, idx) => ({ row, idx }));
    const colNames = visibleGridColumns.map((c) => c.name);

    let list = indexed.filter(({ row, idx }) => {
      if (gridFilter === 'missing') {
        const hasMissing = colNames.some((c) => isMissing(row[c]));
        if (!hasMissing) return false;
      } else if (gridFilter === 'outliers') {
        const hasVisibleOutlier = colNames.some((c) => outlierCellSet.has(`${idx}::${c}`));
        if (!hasVisibleOutlier && !outlierRowSet.has(idx)) return false;
      }

      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        return colNames.some((c) => String(row[c] ?? '').toLowerCase().includes(q));
      }
      return true;
    });

    if (sortCol) {
      list = [...list].sort((a, b) => {
        const av = a.row[sortCol];
        const bv = b.row[sortCol];
        const an = toNumeric(av);
        const bn = toNumeric(bv);
        let cmp = 0;
        if (an !== null && bn !== null) {
          cmp = an - bn;
        } else {
          cmp = String(av ?? '').localeCompare(String(bv ?? ''));
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return list.slice(0, 100);
  }, [rawRows, visibleGridColumns, gridFilter, searchTerm, sortCol, sortDir, outlierCellSet, outlierRowSet]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileUpload(file);
  };

  const handleSort = (colName: string) => {
    if (sortCol === colName) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(colName);
      setSortDir('asc');
    }
  };

  const handleSchemaSort = (key: SchemaSortKey) => {
    if (schemaSortKey === key) {
      setSchemaSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSchemaSortKey(key);
      setSchemaSortDir(key === 'name' || key === 'type' ? 'asc' : 'desc');
    }
  };

  const hasActiveSchemaFilters =
    schemaSearch.trim() !== '' || schemaRoleFilter !== 'all' || schemaDiagFilter !== 'all';

  const resetSchemaFilters = () => {
    setSchemaSearch('');
    setSchemaRoleFilter('all');
    setSchemaDiagFilter('all');
  };

  return (
    <div className="space-y-8">
      {/* Stage Heading */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">Stage 01 · Ingestion &amp; Schema Audit</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {datasetName}
          </h1>
        </div>
        <button
          type="button"
          onClick={onProceedToPrepare}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap shrink-0"
        >
          Configure Cleaning Pipeline
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {/* Upload & Sample Switcher Surface */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`lg:col-span-5 flex flex-col justify-between rounded-xl border p-6 transition-colors ${
            isDragging
              ? 'border-[#1D4ED8] bg-blue-50/40'
              : 'border-slate-200 bg-white'
          }`}
        >
          <div>
            <div className="flex items-center gap-2.5 text-slate-900">
              <FileSpreadsheet className="h-5 w-5 text-[#1D4ED8]" />
              <h2 className="text-base font-semibold">Import Survey Microdata</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Drop a CSV or Excel workbook (.xlsx, .xls) to inspect schema types, missingness patterns, sampling weights, and extreme outliers locally in your browser.
            </p>
          </div>

          <div className="mt-5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.tsv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileUpload(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 whitespace-nowrap"
            >
              <Upload className="h-4 w-4 text-slate-600" />
              Select CSV or Excel File
            </button>
            {uploadError && (
              <p className="mt-2 text-xs font-medium text-red-700" role="alert">
                {uploadError}
              </p>
            )}
          </div>
        </div>

        {/* Benchmark Datasets */}
        <div className="lg:col-span-7 flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Benchmark Survey Datasets</h2>
            <p className="mt-1 text-sm text-slate-600">
              Switch between pre-configured survey microdata with realistic sampling weights, missing responses, and coding errors.
            </p>
          </div>
          <div className="mt-4 divide-y divide-slate-200 border-t border-slate-200">
            {SAMPLE_DATASETS.map((sample) => {
              const isSelected = activeSampleId === sample.id;
              return (
                <div
                  key={sample.id}
                  className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {sample.shortLabel}
                      </span>
                      {isSelected && (
                        <span className="text-xs font-medium text-[#1D4ED8] whitespace-nowrap">
                          · Active
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{sample.sourceNote}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectSample(sample.id)}
                    disabled={isSelected}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      isSelected
                        ? 'bg-slate-100 text-slate-400 cursor-default'
                        : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    {isSelected ? 'Loaded' : 'Load Dataset'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">Total Records &amp; Variables</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {rawProfile.rowCount.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {rawProfile.columnCount} columns · {rawProfile.duplicateRows} duplicates
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">Completeness Rate</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {rawProfile.completenessScore.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {rawProfile.missingCells.toLocaleString()} missing of{' '}
            {rawProfile.totalCells.toLocaleString()} cells
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">IQR Outliers Detected</p>
          <p
            className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${
              rawProfile.totalOutliersIQR > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {rawProfile.totalOutliersIQR}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {rawProfile.totalOutliersIQR > 0 ? 'Review required before estimation' : 'Nominal range'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">Detected Design Variables</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {rawProfile.columns.filter((c) => c.type === 'weight').length}
          </p>
          <p className="mt-1 text-xs text-slate-500 truncate">
            {rawProfile.columns.find((c) => c.type === 'weight')?.name
              ? `Weight: ${rawProfile.columns.find((c) => c.type === 'weight')?.name}`
              : 'No weight column auto-detected'}
          </p>
        </div>
      </div>

      {/* AI Data Quality Audit Section */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              AI Data Quality Audit &amp; Preparation Advisor
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Evaluate skewness, missingness, and survey structure to generate a grounded imputation and outlier plan.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onRunAiAudit}
              disabled={aiAuditLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1E40AF] disabled:opacity-60 whitespace-nowrap"
            >
              {aiAuditLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {aiAuditLoading ? 'Auditing Schema...' : aiAudit ? 'Re-run AI Audit' : 'Run AI Quality Audit'}
            </button>
          </div>
        </div>

        {aiAuditError && (
          <div
            className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50/60 p-4 text-sm text-red-800"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
            <span>{aiAuditError}</span>
          </div>
        )}

        {aiAudit && (
          <div className="mt-6 border-t border-slate-200 pt-5 space-y-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                  <span className="text-slate-900 font-semibold">
                    Assessment: {aiAudit.qualityGrade}
                  </span>
                  {aiAudit.suggestedWeightColumn && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Suggested Weight: {aiAudit.suggestedWeightColumn}</span>
                    </>
                  )}
                  {aiAudit.suggestedStratumColumn && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Suggested Stratum: {aiAudit.suggestedStratumColumn}</span>
                    </>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-slate-700">{aiAudit.summary}</p>
              </div>

              <button
                type="button"
                onClick={onApplyAiPlan}
                className="inline-flex items-center gap-2 rounded-lg border border-[#1D4ED8] bg-white px-4 py-2 text-sm font-medium text-[#1D4ED8] transition-colors hover:bg-blue-50 whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="h-4 w-4" />
                Apply AI Plan to Pipeline
              </button>
            </div>

            {aiAudit.recommendations.length > 0 && (
              <div className="space-y-3">
                {/* Audit Findings Filter & Search Toolbar */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => setAuditIssueFilter('all')}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                          auditIssueFilter === 'all'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        All Findings ({aiAudit.recommendations.length})
                      </button>
                      {auditIssueTypes.map((issueType) => (
                        <button
                          key={issueType}
                          type="button"
                          onClick={() => setAuditIssueFilter(issueType)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                            auditIssueFilter === issueType
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {issueType}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="Filter audit findings..."
                      aria-label="Search AI audit findings"
                      className="w-full sm:w-56 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-7 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1D4ED8] focus:bg-white focus:outline-none"
                    />
                    {auditSearch && (
                      <button
                        type="button"
                        onClick={() => setAuditSearch('')}
                        aria-label="Clear audit search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                        <th className="py-2.5 pr-4">Variable</th>
                        <th className="py-2.5 pr-4">Issue</th>
                        <th className="py-2.5 pr-4">Imputation</th>
                        <th className="py-2.5 pr-4">Outlier Action</th>
                        <th className="py-2.5">Statistical Rationale</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredAuditRecommendations.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-xs text-slate-500">
                            No audit findings match your filter.{' '}
                            <button
                              type="button"
                              onClick={() => {
                                setAuditSearch('');
                                setAuditIssueFilter('all');
                              }}
                              className="font-medium text-[#1D4ED8] hover:underline"
                            >
                              Reset filters
                            </button>
                          </td>
                        </tr>
                      ) : (
                        filteredAuditRecommendations.map((rec, idx) => (
                          <tr key={`${rec.column}-${idx}`} className="text-slate-700">
                            <td className="py-2.5 pr-4 font-mono text-xs font-medium text-slate-900">
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveTab('schema');
                                  setSchemaSearch(rec.column);
                                  setSchemaRoleFilter('all');
                                  setSchemaDiagFilter('all');
                                }}
                                title="Inspect variable in Schema Profile"
                                className="hover:text-[#1D4ED8] hover:underline text-left"
                              >
                                {rec.column}
                              </button>
                            </td>
                            <td className="py-2.5 pr-4 text-xs text-slate-600">{rec.issueType}</td>
                            <td className="py-2.5 pr-4 font-mono text-xs text-slate-800">
                              {rec.recommendedImputation}
                            </td>
                            <td className="py-2.5 pr-4 font-mono text-xs text-slate-800">
                              {rec.recommendedOutlierAction}
                            </td>
                            <td className="py-2.5 text-xs leading-relaxed text-slate-600">
                              {rec.rationale}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Schema Profile & Data Grid Explorer */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 self-start">
            <button
              type="button"
              onClick={() => setActiveTab('schema')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'schema'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Schema Profile ({rawProfile.columnCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'preview'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Raw Data Grid ({rawProfile.rowCount})
            </button>
          </div>

          {activeTab === 'schema' ? (
            <div className="flex flex-wrap items-center gap-3">
              {/* Diagnostic Status Filter */}
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'issues', label: 'Issues' },
                    { id: 'missing', label: 'Missing' },
                    { id: 'outliers', label: 'Outliers' },
                    { id: 'nominal', label: 'Nominal' },
                  ] as Array<{ id: SchemaDiagnosticFilter; label: string }>
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSchemaDiagFilter(item.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      schemaDiagFilter === item.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Column Role Filter */}
              <div className="relative flex items-center">
                <Filter className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
                <select
                  value={schemaRoleFilter}
                  onChange={(e) => setSchemaRoleFilter(e.target.value as RoleFilter)}
                  aria-label="Filter variables by role"
                  className="rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-7 text-xs font-medium text-slate-700 focus:border-[#1D4ED8] focus:bg-white focus:outline-none"
                >
                  <option value="all">All Roles</option>
                  <option value="numeric">Numeric</option>
                  <option value="categorical">Categorical</option>
                  <option value="weight">Weight</option>
                  <option value="id">Identifier</option>
                </select>
              </div>

              {/* Variable Search Bar */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={schemaSearch}
                  onChange={(e) => setSchemaSearch(e.target.value)}
                  placeholder="Search variables..."
                  aria-label="Search schema variables"
                  className="w-48 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-7 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1D4ED8] focus:bg-white focus:outline-none"
                />
                {schemaSearch && (
                  <button
                    type="button"
                    onClick={() => setSchemaSearch('')}
                    aria-label="Clear variable search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {/* Row Filter */}
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                {(['all', 'missing', 'outliers'] as GridFilter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setGridFilter(f)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      gridFilter === f
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {f === 'all' ? 'All Rows' : f === 'missing' ? 'Missing Only' : 'Outliers Only'}
                  </button>
                ))}
              </div>

              {/* Column Scope Filter */}
              <div className="relative flex items-center">
                <Filter className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
                <select
                  value={gridColumnScope}
                  onChange={(e) => setGridColumnScope(e.target.value)}
                  aria-label="Filter visible grid columns"
                  className="rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-7 text-xs font-medium text-slate-700 focus:border-[#1D4ED8] focus:bg-white focus:outline-none max-w-[190px]"
                >
                  <option value="all">All Columns ({rawProfile.columnCount})</option>
                  <option value="flagged">Flagged Columns Only</option>
                  <option value="role:numeric">Numeric &amp; Weights</option>
                  <option value="role:categorical">Categorical &amp; IDs</option>
                  <optgroup label="Focus Single Variable">
                    {rawProfile.columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Record Search Input */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search records..."
                  aria-label="Search raw records"
                  className="w-44 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-7 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1D4ED8] focus:bg-white focus:outline-none"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    aria-label="Clear record search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {activeTab === 'schema' ? (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                    <th className="px-6 py-3">
                      <button
                        type="button"
                        onClick={() => handleSchemaSort('name')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>Variable</span>
                        <ArrowUpDown className="h-3 w-3 text-slate-400" />
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleSchemaSort('type')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>Inferred Role</span>
                        <ArrowUpDown className="h-3 w-3 text-slate-400" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSchemaSort('missingPct')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>Missing</span>
                        <ArrowUpDown className="h-3 w-3 text-slate-400" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSchemaSort('mean')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>Mean / Mode</span>
                        <ArrowUpDown className="h-3 w-3 text-slate-400" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">Median</th>
                    <th className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSchemaSort('stdDev')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>Std Dev</span>
                        <ArrowUpDown className="h-3 w-3 text-slate-400" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">Range / Unique</th>
                    <th className="px-6 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSchemaSort('outliers')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>Diagnostics</span>
                        <ArrowUpDown className="h-3 w-3 text-slate-400" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSchemaColumns.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-10 text-center text-sm text-slate-500">
                        No variables match the active search or column filters.{' '}
                        <button
                          type="button"
                          onClick={resetSchemaFilters}
                          className="font-medium text-[#1D4ED8] hover:underline"
                        >
                          Reset filters
                        </button>
                      </td>
                    </tr>
                  ) : (
                    filteredSchemaColumns.map((col) => {
                      const isNum = col.type === 'numeric' || col.type === 'weight';
                      return (
                        <tr key={col.name} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-6 py-3 font-mono text-xs font-medium text-slate-900">
                            <button
                              type="button"
                              onClick={() => {
                                setGridColumnScope(col.name);
                                setActiveTab('preview');
                              }}
                              title="Focus this variable in Raw Data Grid"
                              className="hover:text-[#1D4ED8] hover:underline text-left"
                            >
                              {col.name}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600 capitalize">{col.type}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                            <span
                              className={
                                col.missingCount > 0 ? 'font-medium text-amber-700' : 'text-slate-500'
                              }
                            >
                              {col.missingCount} ({col.missingPct.toFixed(1)}%)
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-800 tabular-nums">
                            {isNum
                              ? formatNumber(col.mean ?? 0)
                              : col.topCategories?.[0]?.value ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-800 tabular-nums">
                            {isNum ? formatNumber(col.median ?? 0) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                            {isNum ? formatNumber(col.stdDev ?? 0) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                            {isNum
                              ? `${formatNumber(col.min ?? 0, 1)} – ${formatNumber(col.max ?? 0, 1)}`
                              : `${col.uniqueCount} unique`}
                          </td>
                          <td className="px-6 py-3 text-right text-xs">
                            {col.outlierCountIQR > 0 || (col.negativeCount ?? 0) > 0 ? (
                              <span className="font-medium text-red-700">
                                {[
                                  col.outlierCountIQR > 0
                                    ? `${col.outlierCountIQR} IQR outliers`
                                    : null,
                                  (col.negativeCount ?? 0) > 0
                                    ? `${col.negativeCount} negative`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            ) : col.missingCount > 0 ? (
                              <span className="font-medium text-amber-700">Missing values</span>
                            ) : (
                              <span className="text-emerald-700">Nominal</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 text-xs text-slate-500">
              <span>
                Showing {filteredSchemaColumns.length} of {rawProfile.columnCount} variables
              </span>
              {hasActiveSchemaFilters && (
                <button
                  type="button"
                  onClick={resetSchemaFilters}
                  className="font-medium text-[#1D4ED8] hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="overflow-x-auto max-h-[460px]">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 font-mono text-slate-500">#</th>
                    {visibleGridColumns.map((col) => (
                      <th key={col.name} className="px-4 py-2.5 font-semibold text-slate-700">
                        <button
                          type="button"
                          onClick={() => handleSort(col.name)}
                          className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                        >
                          <span>{col.name}</span>
                          <ArrowUpDown className="h-3 w-3 text-slate-400" />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPreviewRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={visibleGridColumns.length + 1}
                        className="px-6 py-10 text-center text-sm text-slate-500"
                      >
                        No records match the current filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredPreviewRows.map(({ row, idx }) => (
                      <tr key={idx} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2 font-mono text-slate-400 tabular-nums">
                          {idx + 1}
                        </td>
                        {visibleGridColumns.map((col) => {
                          const val = row[col.name];
                          const missing = isMissing(val);
                          const isOutlier = outlierCellSet.has(`${idx}::${col.name}`);
                          const isNum = col.type === 'numeric' || col.type === 'weight';
                          return (
                            <td
                              key={col.name}
                              className={`px-4 py-2 whitespace-nowrap ${
                                isNum ? 'text-right font-mono tabular-nums' : 'text-slate-800'
                              } ${
                                missing
                                  ? 'bg-amber-50/80 text-amber-800 font-medium'
                                  : isOutlier
                                  ? 'bg-red-50/80 text-red-800 font-medium'
                                  : ''
                              }`}
                            >
                              {missing
                                ? 'Missing'
                                : isOutlier
                                ? `${String(val)} (Outlier)`
                                : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 text-xs text-slate-500">
              <span>
                Showing {filteredPreviewRows.length} of {rawProfile.rowCount.toLocaleString()} records ·{' '}
                {visibleGridColumns.length} of {rawProfile.columnCount} columns
              </span>
              {(gridColumnScope !== 'all' || gridFilter !== 'all' || searchTerm.trim() !== '') && (
                <button
                  type="button"
                  onClick={() => {
                    setGridColumnScope('all');
                    setGridFilter('all');
                    setSearchTerm('');
                  }}
                  className="font-medium text-[#1D4ED8] hover:underline"
                >
                  Reset grid view
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
