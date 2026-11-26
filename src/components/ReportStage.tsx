import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileCode2,
  FileText,
  Loader2,
  Pencil,
  Printer,
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
  CategoricalBreakdown,
  CleaningAuditEntry,
  DatasetProfile,
  EstimationConfig,
  GeneratedReport,
  ReportConfig,
  ReportTone,
  SubgroupEstimate,
  VariableEstimate,
} from '../types/statigen';
import { formatCompactNumber, formatNumber } from '../utils/statEngine';
import {
  buildReportMarkdown,
  exportReportToHTML,
  exportReportToPDF,
  exportReportToWord,
  ReportExportPayload,
} from '../utils/fileIO';

interface ReportStageProps {
  datasetName: string;
  rawProfile: DatasetProfile;
  cleanedProfile: DatasetProfile;
  auditLog: CleaningAuditEntry[];
  estimationConfig: EstimationConfig;
  overallEstimates: VariableEstimate[];
  subgroupEstimates: SubgroupEstimate[];
  categoricalBreakdowns: CategoricalBreakdown[];
  reportConfig: ReportConfig;
  report: GeneratedReport | null;
  reportLoading: boolean;
  reportError: string | null;
  onUpdateReportConfig: (updater: (prev: ReportConfig) => ReportConfig) => void;
  onUpdateReport: (updater: (prev: GeneratedReport) => GeneratedReport) => void;
  onGenerateReport: () => void;
}

export const ReportStage: React.FC<ReportStageProps> = ({
  datasetName,
  rawProfile,
  cleanedProfile,
  auditLog,
  estimationConfig,
  overallEstimates,
  subgroupEstimates,
  categoricalBreakdowns,
  reportConfig,
  report,
  reportLoading,
  reportError,
  onUpdateReportConfig,
  onUpdateReport,
  onGenerateReport,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [pdfExported, setPdfExported] = useState(false);

  const exportPayload: ReportExportPayload | null = report
    ? {
        reportConfig,
        report,
        datasetName,
        rawProfile,
        cleanedProfile,
        auditLog,
        estimationConfig,
        estimates: overallEstimates,
        subgroups: subgroupEstimates,
        categorical: categoricalBreakdowns,
      }
    : null;

  const handleDownloadPdf = () => {
    if (!exportPayload) return;
    exportReportToPDF(exportPayload);
    setPdfExported(true);
    setTimeout(() => setPdfExported(false), 2200);
  };

  const handlePrintPdf = () => {
    if (!report) return;
    const prevTitle = document.title;
    const restoreTitle = () => {
      document.title = prevTitle;
      window.removeEventListener('afterprint', restoreTitle);
    };

    const triggerPrint = () => {
      document.title = reportConfig.title || 'StatiGen AI Statistical Report';
      window.addEventListener('afterprint', restoreTitle);
      window.print();
      setTimeout(restoreTitle, 1500);
    };

    if (isEditing) {
      setIsEditing(false);
      // Allow React to switch textareas back to clean print prose before invoking native print
      setTimeout(triggerPrint, 60);
    } else {
      triggerPrint();
    }
  };

  const handleCopyMarkdown = async () => {
    if (!exportPayload) return;
    const md = buildReportMarkdown(exportPayload);
    try {
      await navigator.clipboard.writeText(md);
      setCopiedMarkdown(true);
      setTimeout(() => setCopiedMarkdown(false), 2000);
    } catch {
      // Fallback download if clipboard blocked in iframe
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'statigen_report.md';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const ciLabel = `${Math.round(estimationConfig.confidenceLevel * 100)}%`;

  const primaryReportChartVar = estimationConfig.targetColumns[0] ?? '';
  const reportChartData = useMemo(() => {
    if (!primaryReportChartVar) return [];
    return subgroupEstimates
      .filter((s) => s.column === primaryReportChartVar)
      .map((s) => ({
        domain: s.stratumValue,
        unweighted: Number(s.unweightedMean.toFixed(2)),
        weighted: Number(s.weightedMean.toFixed(2)),
      }));
  }, [subgroupEstimates, primaryReportChartVar]);

  const renderParagraphs = (text: string) =>
    text
      .split(/\n\s*\n/)
      .filter((p) => p.trim().length > 0)
      .map((para, i) => (
        <p key={i} className="text-sm leading-7 text-slate-700">
          {para.trim()}
        </p>
      ));

  return (
    <div className="space-y-8 print:space-y-0">
      {/* Stage Heading */}
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Stage 04 · Automated Statistical Report Writing
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Publication Report Studio
          </h1>
        </div>
        {report && exportPayload && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsEditing((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Pencil className="h-3.5 w-3.5" />
              {isEditing ? 'Done Editing' : 'Edit Prose'}
            </button>
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              {copiedMarkdown ? (
                <Check className="h-3.5 w-3.5 text-emerald-700" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedMarkdown ? 'Copied Markdown' : 'Copy Markdown'}
            </button>
            <button
              type="button"
              onClick={() => exportReportToHTML(exportPayload)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <FileCode2 className="h-3.5 w-3.5" />
              HTML
            </button>
            <button
              type="button"
              onClick={() => exportReportToWord(exportPayload)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <FileText className="h-3.5 w-3.5" />
              Word (.doc)
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Printer className="h-3.5 w-3.5" />
              Print / Save PDF
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D4ED8] px-4 py-2 text-xs font-medium text-white hover:bg-[#1E40AF] whitespace-nowrap"
            >
              {pdfExported ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {pdfExported ? 'PDF Downloaded' : 'Download as PDF'}
            </button>
          </div>
        )}
      </div>

      {/* Main Split: Configuration Sidebar + Editorial Document Canvas */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 items-start print:block">
        {/* Configuration Panel */}
        <div className="no-print xl:col-span-4 rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Report Configuration</h2>
            <p className="mt-1 text-xs text-slate-500">
              All narrative figures are strictly bound to your computed preparation log and weighted estimates.
            </p>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Report Title
              </label>
              <input
                type="text"
                value={reportConfig.title}
                onChange={(e) =>
                  onUpdateReportConfig((prev) => ({ ...prev, title: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Publishing Organization / Author
              </label>
              <input
                type="text"
                value={reportConfig.organization}
                onChange={(e) =>
                  onUpdateReportConfig((prev) => ({ ...prev, organization: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Editorial Tone
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                {(
                  [
                    { id: 'executive', label: 'Executive' },
                    { id: 'official', label: 'Official' },
                    { id: 'academic', label: 'Academic' },
                  ] as Array<{ id: ReportTone; label: string }>
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onUpdateReportConfig((prev) => ({ ...prev, tone: t.id }))}
                    className={`rounded-md py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      reportConfig.tone === t.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-2.5">
            <p className="text-xs font-semibold text-slate-700">Included Sections</p>
            {(
              [
                ['includeExecutiveSummary', '1. Executive Summary & Takeaways'],
                ['includePreparationAudit', '2. Data Quality & Preparation Audit'],
                ['includeMethodology', '3. Survey Methodology & Weighting'],
                ['includeKeyEstimates', '4. Key Statistical Estimates Table'],
                ['includeSubgroupAnalysis', '5. Stratified Subgroup Analysis'],
                ['includeLimitations', '6. Reliability & Limitations'],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={reportConfig[key]}
                  onChange={(e) =>
                    onUpdateReportConfig((prev) => ({ ...prev, [key]: e.target.checked }))
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300 accent-[#1D4ED8]"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={onGenerateReport}
            disabled={reportLoading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1E40AF] disabled:opacity-60 whitespace-nowrap"
          >
            {reportLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {reportLoading
              ? 'Drafting Report with AI...'
              : report
              ? 'Regenerate AI Report'
              : 'Generate Report with AI'}
          </button>

          {reportError && (
            <div
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/70 p-3 text-xs text-red-800"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700" />
              <span>{reportError}</span>
            </div>
          )}
        </div>

        {/* Document Canvas */}
        <div className="report-print-sheet xl:col-span-8 rounded-xl border border-slate-200 bg-white">
          {!report && !reportLoading ? (
            <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
              <FileText className="h-10 w-10 text-slate-300" />
              <h2 className="mt-4 text-lg font-semibold text-slate-900">
                Ready to Compile Your Statistical Report
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
                StatiGen AI will synthesize your {auditLog.length} preparation steps,{' '}
                {overallEstimates.length} weighted variable estimates, and subgroup diagnostics into an editable, publication-ready document exportable to PDF, HTML, and Markdown.
              </p>
              <button
                type="button"
                onClick={onGenerateReport}
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#1D4ED8] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#1E40AF] whitespace-nowrap"
              >
                <Sparkles className="h-4 w-4" />
                Generate Publication Draft
              </button>
            </div>
          ) : reportLoading ? (
            <div className="p-10 space-y-6 animate-pulse">
              <div className="h-7 w-2/3 rounded bg-slate-200" />
              <div className="h-4 w-1/2 rounded bg-slate-100" />
              <div className="h-px w-full bg-slate-200" />
              <div className="space-y-2.5">
                <div className="h-3.5 w-full rounded bg-slate-100" />
                <div className="h-3.5 w-11/12 rounded bg-slate-100" />
                <div className="h-3.5 w-4/5 rounded bg-slate-100" />
              </div>
              <div className="space-y-2.5 pt-4">
                <div className="h-5 w-1/3 rounded bg-slate-200" />
                <div className="h-3.5 w-full rounded bg-slate-100" />
                <div className="h-3.5 w-5/6 rounded bg-slate-100" />
              </div>
            </div>
          ) : (
            report && (
              <article className="p-8 sm:p-10 space-y-8">
                {/* Report Masthead */}
                <header className="border-b-2 border-slate-900 pb-6">
                  <p className="text-xs font-medium text-slate-500">
                    {reportConfig.organization} · {reportConfig.tone.charAt(0).toUpperCase() + reportConfig.tone.slice(1)} Edition · {report.generatedAt}
                  </p>
                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                    {reportConfig.title}
                  </h2>
                  {report.subtitle && (
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed">{report.subtitle}</p>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 font-mono tabular-nums">
                    <span>Source: {datasetName}</span>
                    <span aria-hidden="true">·</span>
                    <span>n = {cleanedProfile.rowCount}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Weight: {estimationConfig.weightColumn || 'Unweighted'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>CI: {ciLabel}</span>
                  </div>
                </header>

                {/* 1. Executive Summary */}
                {reportConfig.includeExecutiveSummary && (
                  <section className="space-y-4">
                    <h3 className="text-base font-semibold text-slate-900 border-b border-slate-200 pb-2">
                      01. Executive Summary
                    </h3>
                    {isEditing ? (
                      <textarea
                        rows={5}
                        value={report.executiveSummary}
                        onChange={(e) =>
                          onUpdateReport((prev) => ({
                            ...prev,
                            executiveSummary: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 p-3 text-sm leading-relaxed text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                      />
                    ) : (
                      <div className="space-y-3">{renderParagraphs(report.executiveSummary)}</div>
                    )}

                    {report.keyTakeaways.length > 0 && (
                      <div className="rounded-lg bg-slate-50 p-5 border border-slate-200">
                        <p className="text-xs font-semibold text-slate-900 mb-2.5">
                          Principal Statistical Takeaways
                        </p>
                        <ul className="space-y-2 text-sm text-slate-700 list-disc pl-5">
                          {report.keyTakeaways.map((item, idx) => (
                            <li key={idx} className="leading-relaxed">
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                )}

                {/* 2. Data Quality & Preparation Audit */}
                {reportConfig.includePreparationAudit && (
                  <section className="space-y-4">
                    <h3 className="text-base font-semibold text-slate-900 border-b border-slate-200 pb-2">
                      02. Data Quality &amp; Automated Preparation Audit
                    </h3>
                    {isEditing ? (
                      <textarea
                        rows={4}
                        value={report.dataPreparationNarrative}
                        onChange={(e) =>
                          onUpdateReport((prev) => ({
                            ...prev,
                            dataPreparationNarrative: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 p-3 text-sm leading-relaxed text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                      />
                    ) : (
                      <div className="space-y-3">
                        {renderParagraphs(report.dataPreparationNarrative)}
                      </div>
                    )}

                    {auditLog.length > 0 && (
                      <div className="overflow-x-auto pt-2">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                              <th className="px-3 py-2 font-semibold">Step</th>
                              <th className="px-3 py-2 font-semibold">Variable</th>
                              <th className="px-3 py-2 font-semibold">Method</th>
                              <th className="px-3 py-2 text-right font-semibold">Affected</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {auditLog.map((a) => (
                              <tr key={a.id} className="text-slate-700">
                                <td className="px-3 py-2 font-medium text-slate-900">{a.step}</td>
                                <td className="px-3 py-2 font-mono">{a.column}</td>
                                <td className="px-3 py-2 text-slate-600">{a.method}</td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums">
                                  {a.affectedRows}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}

                {/* 3. Methodology */}
                {reportConfig.includeMethodology && (
                  <section className="space-y-4">
                    <h3 className="text-base font-semibold text-slate-900 border-b border-slate-200 pb-2">
                      03. Survey Methodology &amp; Estimation Framework
                    </h3>
                    {isEditing ? (
                      <textarea
                        rows={4}
                        value={report.methodologyNarrative}
                        onChange={(e) =>
                          onUpdateReport((prev) => ({
                            ...prev,
                            methodologyNarrative: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 p-3 text-sm leading-relaxed text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                      />
                    ) : (
                      <div className="space-y-3">
                        {renderParagraphs(report.methodologyNarrative)}
                      </div>
                    )}
                  </section>
                )}

                {/* 4. Key Estimates */}
                {reportConfig.includeKeyEstimates && overallEstimates.length > 0 && (
                  <section className="space-y-4">
                    <h3 className="text-base font-semibold text-slate-900 border-b border-slate-200 pb-2">
                      04. Key Population Estimates
                    </h3>
                    {isEditing ? (
                      <textarea
                        rows={5}
                        value={report.keyFindingsNarrative}
                        onChange={(e) =>
                          onUpdateReport((prev) => ({
                            ...prev,
                            keyFindingsNarrative: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 p-3 text-sm leading-relaxed text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                      />
                    ) : (
                      <div className="space-y-3">
                        {renderParagraphs(report.keyFindingsNarrative)}
                      </div>
                    )}

                    <div className="overflow-x-auto pt-2">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                            <th className="px-3 py-2 font-semibold">Variable</th>
                            <th className="px-2 py-2 text-right font-semibold">Unweighted</th>
                            <th className="px-2 py-2 text-right font-semibold">Weighted</th>
                            <th className="px-2 py-2 text-right font-semibold">Total</th>
                            <th className="px-2 py-2 text-right font-semibold">{ciLabel} CI</th>
                            <th className="px-2 py-2 text-right font-semibold">RSE %</th>
                            <th className="px-3 py-2 text-right font-semibold">Rating</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {overallEstimates.map((e) => (
                            <tr key={e.column} className="text-slate-700">
                              <td className="px-3 py-2 font-mono font-medium text-slate-900">
                                {e.column}
                              </td>
                              <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-500">
                                {formatNumber(e.unweightedMean)}
                              </td>
                              <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                                {formatNumber(e.weightedMean)}
                              </td>
                              <td className="px-2 py-2 text-right font-mono tabular-nums">
                                {formatCompactNumber(e.weightedTotal)}
                              </td>
                              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                                [{formatNumber(e.ciLower, 1)}, {formatNumber(e.ciUpper, 1)}]
                              </td>
                              <td className="px-2 py-2 text-right font-mono tabular-nums">
                                {e.rsePct.toFixed(2)}%
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-slate-800">
                                {e.reliability}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {/* 5. Subgroup Analysis */}
                {reportConfig.includeSubgroupAnalysis && subgroupEstimates.length > 0 && (
                  <section className="space-y-4">
                    <h3 className="text-base font-semibold text-slate-900 border-b border-slate-200 pb-2">
                      05. Stratified Subgroup Analysis ({estimationConfig.stratumColumn})
                    </h3>
                    {isEditing ? (
                      <textarea
                        rows={4}
                        value={report.subgroupAnalysisNarrative}
                        onChange={(e) =>
                          onUpdateReport((prev) => ({
                            ...prev,
                            subgroupAnalysisNarrative: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 p-3 text-sm leading-relaxed text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                      />
                    ) : (
                      <div className="space-y-3">
                        {renderParagraphs(report.subgroupAnalysisNarrative)}
                      </div>
                    )}

                    {reportChartData.length > 0 && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-4">
                        <p className="text-xs font-semibold text-slate-800 mb-3">
                          Figure 1. Unweighted vs. Weighted Mean of{' '}
                          <span className="font-mono">{primaryReportChartVar}</span> by{' '}
                          {estimationConfig.stratumColumn}
                        </p>
                        <div className="h-52 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={reportChartData}
                              margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
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
                              <Legend wrapperStyle={{ fontSize: '11px' }} />
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
                    )}

                    <div className="overflow-x-auto pt-2">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                            <th className="px-3 py-2 font-semibold">Domain</th>
                            <th className="px-2 py-2 font-semibold">Variable</th>
                            <th className="px-2 py-2 text-right font-semibold">n</th>
                            <th className="px-2 py-2 text-right font-semibold">Weighted Mean</th>
                            <th className="px-2 py-2 text-right font-semibold">Weighted SE</th>
                            <th className="px-2 py-2 text-right font-semibold">RSE %</th>
                            <th className="px-3 py-2 text-right font-semibold">Rating</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {subgroupEstimates.slice(0, 24).map((s) => (
                            <tr key={`${s.stratumValue}-${s.column}`} className="text-slate-700">
                              <td className="px-3 py-2 font-medium text-slate-900">
                                {s.stratumValue}
                              </td>
                              <td className="px-2 py-2 font-mono text-slate-800">{s.column}</td>
                              <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-600">
                                {s.sampleSize}
                              </td>
                              <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                                {formatNumber(s.weightedMean)}
                              </td>
                              <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-600">
                                &plusmn;{formatNumber(s.weightedSE)}
                              </td>
                              <td className="px-2 py-2 text-right font-mono tabular-nums">
                                {s.rsePct.toFixed(2)}%
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-slate-800">
                                {s.reliability}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {/* 6. Limitations */}
                {reportConfig.includeLimitations && (
                  <section className="space-y-4">
                    <h3 className="text-base font-semibold text-slate-900 border-b border-slate-200 pb-2">
                      06. Reliability &amp; Methodological Limitations
                    </h3>
                    {isEditing ? (
                      <textarea
                        rows={4}
                        value={report.limitationsAndReliability}
                        onChange={(e) =>
                          onUpdateReport((prev) => ({
                            ...prev,
                            limitationsAndReliability: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 p-3 text-sm leading-relaxed text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                      />
                    ) : (
                      <div className="space-y-3">
                        {renderParagraphs(report.limitationsAndReliability)}
                      </div>
                    )}
                  </section>
                )}
              </article>
            )
          )}
        </div>
      </div>
    </div>
  );
};
