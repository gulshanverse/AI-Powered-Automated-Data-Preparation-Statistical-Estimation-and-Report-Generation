import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Download,
  Loader2,
  Sparkles,
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
  AIEstimationInterpretation,
  CategoricalBreakdown,
  DataRow,
  DatasetProfile,
  EstimationConfig,
  ReliabilityRating,
  SubgroupEstimate,
  VariableEstimate,
} from '../types/statigen';
import {
  computeCorrelationMatrix,
  computeCrossTabulation,
  computeStratumAnova,
  formatCompactNumber,
  formatNumber,
} from '../utils/statEngine';

interface EstimateStageProps {
  cleanedRows: DataRow[];
  cleanedProfile: DatasetProfile;
  estimationConfig: EstimationConfig;
  overallEstimates: VariableEstimate[];
  subgroupEstimates: SubgroupEstimate[];
  categoricalBreakdowns: CategoricalBreakdown[];
  aiInterpretation: AIEstimationInterpretation | null;
  aiInterpLoading: boolean;
  aiInterpError: string | null;
  onUpdateEstimationConfig: (updater: (prev: EstimationConfig) => EstimationConfig) => void;
  onRunAiInterpretation: () => void;
  onExportEstimatesCSV: () => void;
  onProceedToReport: () => void;
}

function reliabilityTextClass(rating: ReliabilityRating): string {
  if (rating === 'Reliable') return 'text-emerald-700 font-medium';
  if (rating === 'Caution') return 'text-amber-700 font-medium';
  return 'text-red-700 font-medium';
}

function correlationCellStyle(r: number, isDiag: boolean): string {
  if (isDiag) return 'bg-slate-100 text-slate-500';
  const abs = Math.abs(r);
  if (abs >= 0.7) return r > 0 ? 'bg-blue-100 text-blue-900 font-semibold' : 'bg-red-100 text-red-900 font-semibold';
  if (abs >= 0.4) return r > 0 ? 'bg-blue-50 text-blue-800 font-medium' : 'bg-red-50 text-red-800 font-medium';
  return 'bg-white text-slate-700';
}

export const EstimateStage: React.FC<EstimateStageProps> = ({
  cleanedRows,
  cleanedProfile,
  estimationConfig,
  overallEstimates,
  subgroupEstimates,
  categoricalBreakdowns,
  aiInterpretation,
  aiInterpLoading,
  aiInterpError,
  onUpdateEstimationConfig,
  onRunAiInterpretation,
  onExportEstimatesCSV,
  onProceedToReport,
}) => {
  const [analysisTab, setAnalysisTab] = useState<'estimates' | 'correlations' | 'crosstab'>(
    'estimates'
  );
  const [estimateViewMode, setEstimateViewMode] = useState<'means' | 'totals'>('means');

  const numericAndWeightCols = useMemo(
    () => cleanedProfile.columns.filter((c) => c.type === 'numeric' || c.type === 'weight'),
    [cleanedProfile]
  );

  const numericTargetCandidates = useMemo(
    () =>
      cleanedProfile.columns.filter(
        (c) =>
          (c.type === 'numeric' || c.type === 'weight') &&
          c.name !== estimationConfig.weightColumn
      ),
    [cleanedProfile, estimationConfig.weightColumn]
  );

  const categoricalCandidates = useMemo(
    () => cleanedProfile.columns.filter((c) => c.type === 'categorical'),
    [cleanedProfile]
  );

  const [chartVar, setChartVar] = useState<string>(
    () => estimationConfig.targetColumns[0] ?? ''
  );
  const [crossRowCol, setCrossRowCol] = useState<string>(() => categoricalCandidates[0]?.name ?? '');
  const [crossColCol, setCrossColCol] = useState<string>(() => categoricalCandidates[1]?.name ?? '');
  const [crossDisplay, setCrossDisplay] = useState<'rowPct' | 'weighted' | 'sample'>('rowPct');

  const activeChartVar = estimationConfig.targetColumns.includes(chartVar)
    ? chartVar
    : estimationConfig.targetColumns[0] ?? '';

  const activeCrossRow = categoricalCandidates.some((c) => c.name === crossRowCol)
    ? crossRowCol
    : categoricalCandidates[0]?.name ?? '';

  const activeCrossCol = categoricalCandidates.some(
    (c) => c.name === crossColCol && c.name !== activeCrossRow
  )
    ? crossColCol
    : categoricalCandidates.find((c) => c.name !== activeCrossRow)?.name ?? '';

  const subgroupChartData = useMemo(() => {
    if (!activeChartVar) return [];
    return subgroupEstimates
      .filter((s) => s.column === activeChartVar)
      .map((s) => ({
        domain: s.stratumValue,
        unweighted: Number(s.unweightedMean.toFixed(2)),
        weighted: Number(s.weightedMean.toFixed(2)),
        rse: Number(s.rsePct.toFixed(2)),
      }));
  }, [subgroupEstimates, activeChartVar]);

  const stratumAnova = useMemo(() => {
    if (!activeChartVar || !estimationConfig.stratumColumn) return null;
    return computeStratumAnova(cleanedRows, activeChartVar, estimationConfig.stratumColumn);
  }, [cleanedRows, activeChartVar, estimationConfig.stratumColumn]);

  const correlationResult = useMemo(() => {
    const cols = numericTargetCandidates.map((c) => c.name);
    if (cols.length < 2) return null;
    return computeCorrelationMatrix(cleanedRows, cols, estimationConfig.weightColumn);
  }, [cleanedRows, numericTargetCandidates, estimationConfig.weightColumn]);

  const crossTabResult = useMemo(() => {
    if (!activeCrossRow || !activeCrossCol) return null;
    return computeCrossTabulation(
      cleanedRows,
      activeCrossRow,
      activeCrossCol,
      estimationConfig.weightColumn
    );
  }, [cleanedRows, activeCrossRow, activeCrossCol, estimationConfig.weightColumn]);

  const toggleTargetCol = (colName: string) => {
    onUpdateEstimationConfig((prev) => {
      const exists = prev.targetColumns.includes(colName);
      return {
        ...prev,
        targetColumns: exists
          ? prev.targetColumns.filter((c) => c !== colName)
          : [...prev.targetColumns, colName],
      };
    });
  };

  const toggleCategoricalCol = (colName: string) => {
    onUpdateEstimationConfig((prev) => {
      const exists = prev.categoricalColumns.includes(colName);
      return {
        ...prev,
        categoricalColumns: exists
          ? prev.categoricalColumns.filter((c) => c !== colName)
          : [...prev.categoricalColumns, colName],
      };
    });
  };

  const ciLabel = `${Math.round(estimationConfig.confidenceLevel * 100)}%`;
  const zMult =
    estimationConfig.confidenceLevel === 0.9
      ? 1.6449
      : estimationConfig.confidenceLevel === 0.99
      ? 2.5758
      : 1.96;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Stage 03 · Survey Weighting, Inference &amp; Estimation
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Population Estimates &amp; Statistical Analysis
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onExportEstimatesCSV}
            disabled={overallEstimates.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Export Estimates CSV
          </button>
          <button
            type="button"
            onClick={onProceedToReport}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D4ED8] px-4 py-2 text-xs font-medium text-white hover:bg-[#1E40AF] whitespace-nowrap"
          >
            Draft Statistical Report
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Survey Design Parameter Panel */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Survey Design Weight Variable
            </label>
            <select
              value={estimationConfig.weightColumn}
              onChange={(e) => {
                const newWeight = e.target.value;
                onUpdateEstimationConfig((prev) => ({
                  ...prev,
                  weightColumn: newWeight,
                  targetColumns: prev.targetColumns.filter((c) => c !== newWeight),
                }));
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
            >
              <option value="">Unweighted (Equal Weights = 1.0)</option>
              {numericAndWeightCols.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Stratification / Domain Breakdown
            </label>
            <select
              value={estimationConfig.stratumColumn}
              onChange={(e) =>
                onUpdateEstimationConfig((prev) => ({
                  ...prev,
                  stratumColumn: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
            >
              <option value="">No Subgroup Disaggregation</option>
              {categoricalCandidates.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.uniqueCount} levels)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Confidence Interval Level
            </label>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
              {([0.9, 0.95, 0.99] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() =>
                    onUpdateEstimationConfig((prev) => ({ ...prev, confidenceLevel: lvl }))
                  }
                  className={`rounded-md py-1.5 font-mono text-xs font-medium transition-colors tabular-nums ${
                    estimationConfig.confidenceLevel === lvl
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {Math.round(lvl * 100)}%
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Target Variable Selection */}
        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">
              Target Estimation Variables (Numeric)
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {numericTargetCandidates.map((col) => (
                <label
                  key={col.name}
                  className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={estimationConfig.targetColumns.includes(col.name)}
                    onChange={() => toggleTargetCol(col.name)}
                    className="h-3.5 w-3.5 rounded border-slate-300 accent-[#1D4ED8]"
                  />
                  <span className="font-mono">{col.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">
              Weighted Proportions (Categorical)
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {categoricalCandidates.map((col) => (
                <label
                  key={col.name}
                  className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={estimationConfig.categoricalColumns.includes(col.name)}
                    onChange={() => toggleCategoricalCol(col.name)}
                    className="h-3.5 w-3.5 rounded border-slate-300 accent-[#1D4ED8]"
                  />
                  <span className="font-mono">{col.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Analytical View Tabs */}
      <div className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
        <button
          type="button"
          onClick={() => setAnalysisTab('estimates')}
          className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
            analysisTab === 'estimates'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Weighted Estimates &amp; Domains
        </button>
        <button
          type="button"
          onClick={() => setAnalysisTab('correlations')}
          className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
            analysisTab === 'correlations'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Weighted Correlation Matrix
        </button>
        <button
          type="button"
          onClick={() => setAnalysisTab('crosstab')}
          className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
            analysisTab === 'crosstab'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Cross-Tabulation &amp; Chi-Square
        </button>
      </div>

      {analysisTab === 'estimates' && (
        <div className="space-y-8">
          {/* Main Weighted vs Unweighted Estimates Table */}
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Weighted Population Estimates (Horvitz-Thompson / Hájek)
                </h2>
                <p className="text-xs text-slate-500">
                  Taylor-linearized standard errors, Kish design effect (DEFF), {ciLabel} confidence intervals, and RSE reliability ratings.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {overallEstimates[0] && (
                  <span className="text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                    n = {overallEstimates[0].sampleSize} · N&#770; ={' '}
                    {formatCompactNumber(overallEstimates[0].sumOfWeights)} · DEFF ={' '}
                    {overallEstimates[0].designEffect.toFixed(2)}
                  </span>
                )}
                <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setEstimateViewMode('means')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      estimateViewMode === 'means'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Means
                  </button>
                  <button
                    type="button"
                    onClick={() => setEstimateViewMode('totals')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      estimateViewMode === 'totals'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Population Totals
                  </button>
                </div>
              </div>
            </div>

            {overallEstimates.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Select at least one numeric target variable above to compute survey estimates.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600">
                      <th className="px-6 py-3 font-semibold">Variable</th>
                      <th className="px-3 py-3 text-right font-semibold">n</th>
                      {estimateViewMode === 'means' ? (
                        <>
                          <th className="px-3 py-3 text-right font-semibold">Unweighted Mean</th>
                          <th className="px-3 py-3 text-right font-semibold">Weighted Mean</th>
                          <th className="px-3 py-3 text-right font-semibold">Shift %</th>
                          <th className="px-3 py-3 text-right font-semibold">Weighted SE</th>
                          <th className="px-3 py-3 text-right font-semibold">{ciLabel} CI</th>
                        </>
                      ) : (
                        <>
                          <th className="px-3 py-3 text-right font-semibold">Eff. n</th>
                          <th className="px-3 py-3 text-right font-semibold">Population Total</th>
                          <th className="px-3 py-3 text-right font-semibold">Total SE</th>
                          <th className="px-3 py-3 text-right font-semibold">
                            Total {ciLabel} CI
                          </th>
                        </>
                      )}
                      <th className="px-3 py-3 text-right font-semibold">RSE %</th>
                      <th className="px-6 py-3 text-right font-semibold">Reliability</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {overallEstimates.map((est) => {
                      const totMoe = zMult * est.weightedTotalSE;
                      return (
                        <tr key={est.column} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-6 py-3 font-mono font-medium text-slate-900">
                            {est.column}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-slate-600 tabular-nums">
                            {est.sampleSize}
                          </td>
                          {estimateViewMode === 'means' ? (
                            <>
                              <td className="px-3 py-3 text-right font-mono text-slate-500 tabular-nums">
                                {formatNumber(est.unweightedMean)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums">
                                {formatNumber(est.weightedMean)}
                              </td>
                              <td
                                className={`px-3 py-3 text-right font-mono tabular-nums ${
                                  Math.abs(est.biasShiftPct) >= 5
                                    ? 'text-[#1D4ED8] font-medium'
                                    : 'text-slate-500'
                                }`}
                              >
                                {est.biasShiftPct >= 0 ? '+' : ''}
                                {est.biasShiftPct.toFixed(1)}%
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-slate-600 tabular-nums">
                                &plusmn;{formatNumber(est.weightedSE)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                                [{formatNumber(est.ciLower)}, {formatNumber(est.ciUpper)}]
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-3 text-right font-mono text-slate-600 tabular-nums">
                                {est.effectiveSampleSize.toFixed(1)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums">
                                {formatCompactNumber(est.weightedTotal)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-slate-600 tabular-nums">
                                &plusmn;{formatCompactNumber(est.weightedTotalSE)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                                [{formatCompactNumber(est.weightedTotal - totMoe)},{' '}
                                {formatCompactNumber(est.weightedTotal + totMoe)}]
                              </td>
                            </>
                          )}
                          <td className="px-3 py-3 text-right font-mono text-slate-800 tabular-nums">
                            {est.rsePct.toFixed(2)}%
                          </td>
                          <td className={`px-6 py-3 text-right ${reliabilityTextClass(est.reliability)}`}>
                            {est.reliability}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Stratified Subgroup Chart & Breakdown with One-Way ANOVA Test */}
          {estimationConfig.stratumColumn && subgroupEstimates.length > 0 && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
              <div className="xl:col-span-6 rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Weighted vs. Unweighted by {estimationConfig.stratumColumn}
                    </h2>
                    <p className="text-xs text-slate-500">
                      Visualizes domain-level weighting adjustment for the selected indicator.
                    </p>
                  </div>
                  <select
                    value={activeChartVar}
                    onChange={(e) => setChartVar(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                  >
                    {estimationConfig.targetColumns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={subgroupChartData}
                      margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis
                        dataKey="domain"
                        tick={{ fontSize: 11, fill: '#475569' }}
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
                      <Bar
                        dataKey="unweighted"
                        name="Unweighted Mean"
                        fill="#94A3B8"
                        radius={[3, 3, 0, 0]}
                      />
                      <Bar
                        dataKey="weighted"
                        name="Weighted Mean"
                        fill="#1D4ED8"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="xl:col-span-6 rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Domain Breakdown — {activeChartVar}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Subgroup sample size, weighted mean, {ciLabel} interval, and RSE precision.
                    </p>
                  </div>
                  {stratumAnova && (
                    <div className="text-right font-mono text-xs tabular-nums">
                      <p className="text-slate-700">
                        ANOVA F({stratumAnova.dfBetween},{stratumAnova.dfWithin}) ={' '}
                        {stratumAnova.fStatistic.toFixed(2)}
                      </p>
                      <p
                        className={
                          stratumAnova.significant
                            ? 'text-emerald-700 font-medium'
                            : 'text-slate-500'
                        }
                      >
                        p = {stratumAnova.pValue < 0.0001 ? '< 0.0001' : stratumAnova.pValue.toFixed(4)} ·{' '}
                        {stratumAnova.significant ? 'Significant (p < 0.05)' : 'Not Significant'}
                      </p>
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3 font-semibold">{estimationConfig.stratumColumn}</th>
                        <th className="py-2 px-2 text-right font-semibold">n</th>
                        <th className="py-2 px-2 text-right font-semibold">Weighted Mean</th>
                        <th className="py-2 px-2 text-right font-semibold">{ciLabel} CI</th>
                        <th className="py-2 px-2 text-right font-semibold">RSE %</th>
                        <th className="py-2 pl-2 text-right font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {subgroupEstimates
                        .filter((s) => s.column === activeChartVar)
                        .map((s) => (
                          <tr key={`${s.stratumValue}-${s.column}`} className="text-slate-700">
                            <td className="py-2.5 pr-3 font-medium text-slate-900">
                              {s.stratumValue}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600">
                              {s.sampleSize}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                              {formatNumber(s.weightedMean)}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                              [{formatNumber(s.ciLower, 1)}, {formatNumber(s.ciUpper, 1)}]
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-800">
                              {s.rsePct.toFixed(2)}%
                            </td>
                            <td
                              className={`py-2.5 pl-2 text-right ${reliabilityTextClass(s.reliability)}`}
                            >
                              {s.reliability}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Weighted Categorical Proportions */}
          {categoricalBreakdowns.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-900">
                Weighted Categorical Proportions
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Comparison of unweighted sample share vs. design-weighted population share with Kish standard errors.
              </p>
              <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
                {categoricalBreakdowns.map((cat) => (
                  <div key={cat.column} className="border-t border-slate-200 pt-4">
                    <h3 className="font-mono text-xs font-semibold text-slate-900 mb-3">
                      {cat.column}
                    </h3>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 pr-3 font-semibold">Category</th>
                          <th className="py-2 px-2 text-right font-semibold">Sample n</th>
                          <th className="py-2 px-2 text-right font-semibold">Unweighted %</th>
                          <th className="py-2 px-2 text-right font-semibold">Weighted %</th>
                          <th className="py-2 pl-2 text-right font-semibold">SE (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {cat.categories.map((item) => (
                          <tr key={item.label} className="text-slate-700">
                            <td className="py-2 pr-3 font-medium text-slate-900">{item.label}</td>
                            <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-600">
                              {item.sampleCount}
                            </td>
                            <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-500">
                              {item.unweightedPct.toFixed(1)}%
                            </td>
                            <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                              {item.weightedPct.toFixed(1)}%
                            </td>
                            <td className="py-2 pl-2 text-right font-mono tabular-nums text-slate-600">
                              &plusmn;{item.sePct.toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {analysisTab === 'correlations' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {correlationResult?.weighted ? 'Design-Weighted' : 'Unweighted'} Pearson Correlation Matrix
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Pairwise linear association coefficients (r ∈ [-1, +1]) across all numeric survey variables.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>Strong positive (&ge; 0.70): Cobalt tint</span>
              <span aria-hidden="true">·</span>
              <span>Strong negative (&le; -0.70): Crimson tint</span>
            </div>
          </div>

          {!correlationResult ? (
            <p className="py-8 text-center text-sm text-slate-500">
              At least two numeric variables are required to compute a correlation matrix.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="py-2.5 pr-4 text-left font-semibold text-slate-600">Variable</th>
                    {correlationResult.columns.map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2.5 text-right font-mono font-semibold text-slate-700 whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {correlationResult.columns.map((rowCol, i) => (
                    <tr key={rowCol}>
                      <td className="py-2.5 pr-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                        {rowCol}
                      </td>
                      {correlationResult.columns.map((colName, j) => {
                        const rVal = correlationResult.matrix[i][j];
                        return (
                          <td
                            key={colName}
                            className={`px-3 py-2.5 text-right font-mono tabular-nums border-l border-slate-100 ${correlationCellStyle(
                              rVal,
                              i === j
                            )}`}
                          >
                            {i === j ? '1.00' : rVal.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {analysisTab === 'crosstab' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Two-Way Contingency Cross-Tabulation &amp; Chi-Square Test
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Inspect joint categorical distributions and test statistical independence via Pearson&apos;s &chi;&sup2;.
              </p>
            </div>

            {categoricalCandidates.length >= 2 && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Rows:</span>
                  <select
                    value={activeCrossRow}
                    onChange={(e) => setCrossRowCol(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                  >
                    {categoricalCandidates.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Cols:</span>
                  <select
                    value={activeCrossCol}
                    onChange={(e) => setCrossColCol(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                  >
                    {categoricalCandidates
                      .filter((c) => c.name !== activeCrossRow)
                      .map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  {(
                    [
                      { id: 'rowPct', label: 'Weighted Row %' },
                      { id: 'weighted', label: 'Weighted N' },
                      { id: 'sample', label: 'Sample n' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setCrossDisplay(m.id)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        crossDisplay === m.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {!crossTabResult ? (
            <p className="py-8 text-center text-sm text-slate-500">
              At least two categorical variables with 2 or more levels are required for cross-tabulation.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600">
                      <th className="px-4 py-2.5 font-semibold">
                        {crossTabResult.rowColumn} \ {crossTabResult.colColumn}
                      </th>
                      {crossTabResult.colLabels.map((cl) => (
                        <th key={cl} className="px-4 py-2.5 text-right font-semibold">
                          {cl}
                        </th>
                      ))}
                      <th className="px-4 py-2.5 text-right font-semibold text-slate-900">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {crossTabResult.rowLabels.map((rl) => (
                      <tr key={rl} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-medium text-slate-900">{rl}</td>
                        {crossTabResult.colLabels.map((cl) => {
                          const cell = crossTabResult.cells[rl][cl];
                          return (
                            <td
                              key={cl}
                              className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700"
                            >
                              {crossDisplay === 'rowPct'
                                ? `${cell.rowPct.toFixed(1)}%`
                                : crossDisplay === 'weighted'
                                ? formatCompactNumber(cell.weightedCount)
                                : cell.sampleCount}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {crossDisplay === 'rowPct'
                            ? '100.0%'
                            : crossDisplay === 'weighted'
                            ? formatCompactNumber(crossTabResult.rowTotals[rl].weightedCount)
                            : crossTabResult.rowTotals[rl].sampleCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/50 font-semibold text-slate-900">
                      <td className="px-4 py-2.5">All Domains</td>
                      {crossTabResult.colLabels.map((cl) => {
                        const colShare =
                          crossTabResult.grandWeightedTotal > 0
                            ? (crossTabResult.colTotals[cl].weightedCount /
                                crossTabResult.grandWeightedTotal) *
                              100
                            : 0;
                        return (
                          <td
                            key={cl}
                            className="px-4 py-2.5 text-right font-mono tabular-nums"
                          >
                            {crossDisplay === 'rowPct'
                              ? `${colShare.toFixed(1)}%`
                              : crossDisplay === 'weighted'
                              ? formatCompactNumber(crossTabResult.colTotals[cl].weightedCount)
                              : crossTabResult.colTotals[cl].sampleCount}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {crossDisplay === 'rowPct'
                          ? '100.0%'
                          : crossDisplay === 'weighted'
                          ? formatCompactNumber(crossTabResult.grandWeightedTotal)
                          : crossTabResult.grandSampleTotal}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs font-mono tabular-nums text-slate-600">
                <span>
                  Pearson &chi;&sup2; = {crossTabResult.chiSquare.toFixed(2)} · df ={' '}
                  {crossTabResult.df} · p ={' '}
                  {crossTabResult.pValue < 0.0001
                    ? '< 0.0001'
                    : crossTabResult.pValue.toFixed(4)}
                </span>
                <span
                  className={
                    crossTabResult.significant
                      ? 'font-sans font-medium text-emerald-700'
                      : 'font-sans text-slate-500'
                  }
                >
                  {crossTabResult.significant
                    ? 'Statistically significant association (p < 0.05)'
                    : 'No statistically significant association (p >= 0.05)'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Interpretation Panel */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              AI Statistical Interpretation
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Synthesize weighting shifts, subgroup disparities, and design-effect precision directly from these computed estimates.
            </p>
          </div>
          <button
            type="button"
            onClick={onRunAiInterpretation}
            disabled={aiInterpLoading || overallEstimates.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1E40AF] disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {aiInterpLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {aiInterpLoading
              ? 'Synthesizing Findings...'
              : aiInterpretation
              ? 'Refresh Interpretation'
              : 'Interpret Estimates with AI'}
          </button>
        </div>

        {aiInterpError && (
          <div
            className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50/60 p-4 text-sm text-red-800"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
            <span>{aiInterpError}</span>
          </div>
        )}

        {aiInterpretation && (
          <div className="mt-6 border-t border-slate-200 pt-5 space-y-5">
            <p className="text-sm leading-relaxed text-slate-800">
              {aiInterpretation.headlineSynthesis}
            </p>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 border-t border-slate-100 pt-4">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 mb-2">Key Analytical Findings</h3>
                <ul className="space-y-2 text-sm text-slate-700 list-disc pl-5">
                  {aiInterpretation.keyFindings.map((finding, i) => (
                    <li key={i} className="leading-relaxed">
                      {finding}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 mb-1.5">
                    Weighting Impact &amp; Bias Adjustment
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-700">
                    {aiInterpretation.weightingImpact}
                  </p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 mb-1.5">
                    Precision &amp; Reliability Notes
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-700">
                    {aiInterpretation.precisionNotes}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
