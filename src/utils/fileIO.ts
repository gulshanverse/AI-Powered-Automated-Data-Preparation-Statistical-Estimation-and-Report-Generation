import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  CategoricalBreakdown,
  CleaningAuditEntry,
  DataRow,
  DatasetProfile,
  EstimationConfig,
  GeneratedReport,
  ReportConfig,
  SubgroupEstimate,
  VariableEstimate,
  WorkflowRecipe,
} from '../types/statigen';
import { formatCompactNumber, formatNumber } from './statEngine';

export async function parseUploadedFile(file: File): Promise<{ name: string; rows: DataRow[] }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    return new Promise((resolve, reject) => {
      Papa.parse<DataRow>(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0 && results.data.length === 0) {
            reject(new Error(results.errors[0].message));
            return;
          }
          resolve({ name: file.name.replace(/\.[^/.]+$/, ''), rows: results.data });
        },
        error: (err) => reject(err),
      });
    });
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('The uploaded workbook contains no worksheets.');
    }
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<DataRow>(worksheet, { defval: null });
    return { name: file.name.replace(/\.[^/.]+$/, ''), rows };
  }

  throw new Error('Unsupported file format. Please upload a .csv, .xlsx, or .xls file.');
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'statigen_export'
  );
}

export function exportRowsToCSV(rows: DataRow[], baseName: string) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `${safeSlug(baseName)}.csv`);
}

export function exportRowsToXLSX(rows: DataRow[], baseName: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cleaned_Data');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `${safeSlug(baseName)}.xlsx`);
}

export function exportEstimatesToCSV(estimates: VariableEstimate[], baseName: string) {
  const flat = estimates.map((e) => ({
    Variable: e.column,
    Sample_n: e.sampleSize,
    Sum_of_Weights: Number(e.sumOfWeights.toFixed(2)),
    Effective_n: Number(e.effectiveSampleSize.toFixed(2)),
    Design_Effect: Number(e.designEffect.toFixed(3)),
    Unweighted_Mean: Number(e.unweightedMean.toFixed(4)),
    Weighted_Mean: Number(e.weightedMean.toFixed(4)),
    Weight_Shift_Pct: Number(e.biasShiftPct.toFixed(2)),
    Weighted_Total: Number(e.weightedTotal.toFixed(2)),
    Weighted_SE: Number(e.weightedSE.toFixed(4)),
    CI_Lower: Number(e.ciLower.toFixed(4)),
    CI_Upper: Number(e.ciUpper.toFixed(4)),
    RSE_Pct: Number(e.rsePct.toFixed(2)),
    Reliability: e.reliability,
  }));
  exportRowsToCSV(flat, `${baseName}_estimates`);
}

export interface ReportExportPayload {
  reportConfig: ReportConfig;
  report: GeneratedReport;
  datasetName: string;
  rawProfile: DatasetProfile;
  cleanedProfile: DatasetProfile;
  auditLog: CleaningAuditEntry[];
  estimationConfig: EstimationConfig;
  estimates: VariableEstimate[];
  subgroups: SubgroupEstimate[];
  categorical: CategoricalBreakdown[];
}

export function buildReportMarkdown(payload: ReportExportPayload): string {
  const {
    reportConfig,
    report,
    datasetName,
    rawProfile,
    cleanedProfile,
    auditLog,
    estimationConfig,
    estimates,
    subgroups,
  } = payload;

  const ciLabel = `${Math.round(estimationConfig.confidenceLevel * 100)}%`;
  const lines: string[] = [];

  lines.push(`# ${reportConfig.title}`);
  if (report.subtitle) lines.push(`*${report.subtitle}*`);
  lines.push('');
  lines.push(
    `**Organization:** ${reportConfig.organization} | **Dataset:** ${datasetName} | **Generated:** ${report.generatedAt}`
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  if (reportConfig.includeExecutiveSummary) {
    lines.push('## 1. Executive Summary');
    lines.push(report.executiveSummary);
    lines.push('');
    if (report.keyTakeaways.length > 0) {
      lines.push('### Key Takeaways');
      for (const t of report.keyTakeaways) {
        lines.push(`- ${t}`);
      }
      lines.push('');
    }
  }

  if (reportConfig.includePreparationAudit) {
    lines.push('## 2. Data Quality & Preparation Audit');
    lines.push(report.dataPreparationNarrative);
    lines.push('');
    lines.push(
      `Raw records: **${rawProfile.rowCount}** (Missing cells: ${rawProfile.missingCells}, Duplicates: ${rawProfile.duplicateRows}, IQR Outliers: ${rawProfile.totalOutliersIQR}) -> Cleaned records: **${cleanedProfile.rowCount}** (Missing cells: ${cleanedProfile.missingCells}, Completeness: ${cleanedProfile.completenessScore.toFixed(1)}%).`
    );
    lines.push('');
    if (auditLog.length > 0) {
      lines.push('| Step | Variable | Method | Affected | Details |');
      lines.push('| --- | --- | --- | ---: | --- |');
      for (const entry of auditLog) {
        lines.push(
          `| ${entry.step} | ${entry.column} | ${entry.method} | ${entry.affectedRows} | ${entry.details} |`
        );
      }
      lines.push('');
    }
  }

  if (reportConfig.includeMethodology) {
    lines.push('## 3. Survey Methodology & Weighting');
    lines.push(report.methodologyNarrative);
    lines.push('');
  }

  if (reportConfig.includeKeyEstimates && estimates.length > 0) {
    lines.push('## 4. Key Statistical Estimates');
    lines.push(report.keyFindingsNarrative);
    lines.push('');
    lines.push(
      `| Variable | n | Unweighted Mean | Weighted Mean | Weighted Total | ${ciLabel} CI | RSE (%) | Reliability |`
    );
    lines.push('| --- | ---: | ---: | ---: | ---: | --- | ---: | --- |');
    for (const e of estimates) {
      lines.push(
        `| ${e.column} | ${e.sampleSize} | ${formatNumber(e.unweightedMean)} | ${formatNumber(e.weightedMean)} | ${formatCompactNumber(e.weightedTotal)} | [${formatNumber(e.ciLower)}, ${formatNumber(e.ciUpper)}] | ${e.rsePct.toFixed(2)}% | ${e.reliability} |`
      );
    }
    lines.push('');
  }

  if (reportConfig.includeSubgroupAnalysis && subgroups.length > 0) {
    lines.push(`## 5. Subgroup Analysis (${estimationConfig.stratumColumn})`);
    lines.push(report.subgroupAnalysisNarrative);
    lines.push('');
    lines.push('| Domain | Variable | n | Weighted Mean | Weighted SE | RSE (%) | Reliability |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | --- |');
    for (const s of subgroups.slice(0, 30)) {
      lines.push(
        `| ${s.stratumValue} | ${s.column} | ${s.sampleSize} | ${formatNumber(s.weightedMean)} | ${formatNumber(s.weightedSE)} | ${s.rsePct.toFixed(2)}% | ${s.reliability} |`
      );
    }
    lines.push('');
  }

  if (reportConfig.includeLimitations) {
    lines.push('## 6. Reliability & Methodological Limitations');
    lines.push(report.limitationsAndReliability);
    lines.push('');
  }

  return lines.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphsToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join('\n');
}

export function exportReportToHTML(payload: ReportExportPayload) {
  const {
    reportConfig,
    report,
    datasetName,
    rawProfile,
    cleanedProfile,
    auditLog,
    estimationConfig,
    estimates,
    subgroups,
  } = payload;
  const ciLabel = `${Math.round(estimationConfig.confidenceLevel * 100)}%`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(reportConfig.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; line-height: 1.65; max-width: 880px; margin: 40px auto; padding: 0 28px; background: #fff; }
    header { border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 32px; }
    h1 { font-size: 28px; margin: 0 0 8px 0; line-height: 1.2; }
    .subtitle { color: #475569; font-size: 15px; margin: 0 0 14px 0; }
    .meta { font-size: 12px; color: #64748b; }
    h2 { font-size: 18px; margin-top: 32px; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    p { margin: 0 0 12px 0; color: #1e293b; font-size: 14px; }
    ul { margin: 8px 0 16px 20px; padding: 0; font-size: 14px; }
    li { margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0 24px 0; font-size: 12px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
    th { background: #f8fafc; font-weight: 600; color: #334155; }
    .num { text-align: right; font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, monospace; }
    footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(reportConfig.title)}</h1>
    <p class="subtitle">${escapeHtml(report.subtitle)}</p>
    <div class="meta">${escapeHtml(reportConfig.organization)} &middot; Dataset: ${escapeHtml(datasetName)} &middot; Generated ${escapeHtml(report.generatedAt)}</div>
  </header>
  ${
    reportConfig.includeExecutiveSummary
      ? `<section>
      <h2>1. Executive Summary</h2>
      ${paragraphsToHtml(report.executiveSummary)}
      ${
        report.keyTakeaways.length > 0
          ? `<ul>${report.keyTakeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
          : ''
      }
    </section>`
      : ''
  }
  ${
    reportConfig.includePreparationAudit
      ? `<section>
      <h2>2. Data Quality &amp; Preparation Audit</h2>
      ${paragraphsToHtml(report.dataPreparationNarrative)}
      <p><strong>Summary:</strong> Raw dataset (${rawProfile.rowCount} records, ${rawProfile.missingCells} missing cells, ${rawProfile.duplicateRows} duplicates) transformed to ${cleanedProfile.rowCount} records (${cleanedProfile.missingCells} missing cells, ${cleanedProfile.completenessScore.toFixed(1)}% completeness).</p>
      ${
        auditLog.length > 0
          ? `<table>
              <thead><tr><th>Step</th><th>Variable</th><th>Method</th><th class="num">Affected</th><th>Details</th></tr></thead>
              <tbody>${auditLog
                .map(
                  (a) =>
                    `<tr><td>${escapeHtml(a.step)}</td><td>${escapeHtml(a.column)}</td><td>${escapeHtml(a.method)}</td><td class="num">${a.affectedRows}</td><td>${escapeHtml(a.details)}</td></tr>`
                )
                .join('')}</tbody>
            </table>`
          : ''
      }
    </section>`
      : ''
  }
  ${
    reportConfig.includeMethodology
      ? `<section>
      <h2>3. Survey Methodology &amp; Weighting</h2>
      ${paragraphsToHtml(report.methodologyNarrative)}
    </section>`
      : ''
  }
  ${
    reportConfig.includeKeyEstimates && estimates.length > 0
      ? `<section>
      <h2>4. Key Statistical Estimates</h2>
      ${paragraphsToHtml(report.keyFindingsNarrative)}
      <table>
        <thead><tr><th>Variable</th><th class="num">n</th><th class="num">Unweighted Mean</th><th class="num">Weighted Mean</th><th class="num">Population Total</th><th class="num">${ciLabel} CI</th><th class="num">RSE (%)</th><th>Reliability</th></tr></thead>
        <tbody>${estimates
          .map(
            (e) =>
              `<tr><td>${escapeHtml(e.column)}</td><td class="num">${e.sampleSize}</td><td class="num">${formatNumber(e.unweightedMean)}</td><td class="num">${formatNumber(e.weightedMean)}</td><td class="num">${formatCompactNumber(e.weightedTotal)}</td><td class="num">[${formatNumber(e.ciLower)}, ${formatNumber(e.ciUpper)}]</td><td class="num">${e.rsePct.toFixed(2)}%</td><td>${escapeHtml(e.reliability)}</td></tr>`
          )
          .join('')}</tbody>
      </table>
    </section>`
      : ''
  }
  ${
    reportConfig.includeSubgroupAnalysis && subgroups.length > 0
      ? `<section>
      <h2>5. Stratified Subgroup Analysis (${escapeHtml(estimationConfig.stratumColumn)})</h2>
      ${paragraphsToHtml(report.subgroupAnalysisNarrative)}
      <table>
        <thead><tr><th>Domain</th><th>Variable</th><th class="num">n</th><th class="num">Weighted Mean</th><th class="num">Weighted SE</th><th class="num">RSE (%)</th><th>Reliability</th></tr></thead>
        <tbody>${subgroups
          .slice(0, 30)
          .map(
            (s) =>
              `<tr><td>${escapeHtml(s.stratumValue)}</td><td>${escapeHtml(s.column)}</td><td class="num">${s.sampleSize}</td><td class="num">${formatNumber(s.weightedMean)}</td><td class="num">${formatNumber(s.weightedSE)}</td><td class="num">${s.rsePct.toFixed(2)}%</td><td>${escapeHtml(s.reliability)}</td></tr>`
          )
          .join('')}</tbody>
      </table>
    </section>`
      : ''
  }
  ${
    reportConfig.includeLimitations
      ? `<section>
      <h2>6. Reliability &amp; Methodological Limitations</h2>
      ${paragraphsToHtml(report.limitationsAndReliability)}
    </section>`
      : ''
  }
  <footer>Compiled via StatiGen AI Statistical Workbench</footer>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  triggerDownload(blob, `${safeSlug(reportConfig.title)}.html`);
}

export function exportReportToPDF(payload: ReportExportPayload) {
  const {
    reportConfig,
    report,
    datasetName,
    auditLog,
    estimationConfig,
    estimates,
    subgroups,
  } = payload;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  let y = 54;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 54) {
      doc.addPage();
      y = 54;
    }
  };

  const addSectionHeading = (title: string) => {
    ensureSpace(36);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text(title, margin, y);
    y += 6;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, pageWidth - margin, y);
    y += 16;
  };

  const addParagraphs = (text: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    const paras = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    for (const para of paras) {
      const wrapped = doc.splitTextToSize(para.trim(), maxWidth);
      ensureSpace(wrapped.length * 14 + 8);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 14 + 8;
    }
  };

  // Title Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(reportConfig.title, maxWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 22 + 4;

  if (report.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    const subLines = doc.splitTextToSize(report.subtitle, maxWidth);
    doc.text(subLines, margin, y);
    y += subLines.length * 15 + 6;
  }

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `${reportConfig.organization}  |  Dataset: ${datasetName}  |  Generated: ${report.generatedAt}`,
    margin,
    y
  );
  y += 10;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(1.2);
  doc.line(margin, y, pageWidth - margin, y);
  doc.setLineWidth(0.5);
  y += 18;

  if (reportConfig.includeExecutiveSummary) {
    addSectionHeading('1. Executive Summary');
    addParagraphs(report.executiveSummary);
    if (report.keyTakeaways.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      for (const item of report.keyTakeaways) {
        const lines = doc.splitTextToSize(`•  ${item}`, maxWidth - 10);
        ensureSpace(lines.length * 13 + 4);
        doc.text(lines, margin + 6, y);
        y += lines.length * 13 + 4;
      }
      y += 6;
    }
  }

  if (reportConfig.includePreparationAudit) {
    addSectionHeading('2. Data Quality & Preparation Audit');
    addParagraphs(report.dataPreparationNarrative);
    if (auditLog.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Step', 'Variable', 'Method', 'Affected', 'Details']],
        body: auditLog.map((a) => [a.step, a.column, a.method, String(a.affectedRows), a.details]),
        styles: { fontSize: 8, cellPadding: 5, textColor: [30, 41, 59] },
        headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 18;
    }
  }

  if (reportConfig.includeMethodology) {
    addSectionHeading('3. Survey Methodology & Weighting');
    addParagraphs(report.methodologyNarrative);
  }

  if (reportConfig.includeKeyEstimates && estimates.length > 0) {
    addSectionHeading('4. Key Statistical Estimates');
    addParagraphs(report.keyFindingsNarrative);
    const ciLabel = `${Math.round(estimationConfig.confidenceLevel * 100)}% CI`;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [
        [
          'Variable',
          'n',
          'Unweighted',
          'Weighted',
          'Total',
          ciLabel,
          'RSE %',
          'Reliability',
        ],
      ],
      body: estimates.map((e) => [
        e.column,
        String(e.sampleSize),
        formatNumber(e.unweightedMean),
        formatNumber(e.weightedMean),
        formatCompactNumber(e.weightedTotal),
        `[${formatNumber(e.ciLower)}, ${formatNumber(e.ciUpper)}]`,
        `${e.rsePct.toFixed(2)}%`,
        e.reliability,
      ]),
      styles: { fontSize: 8, cellPadding: 5, textColor: [30, 41, 59] },
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 18;
  }

  if (reportConfig.includeSubgroupAnalysis && subgroups.length > 0) {
    addSectionHeading(`5. Subgroup Analysis (${estimationConfig.stratumColumn})`);
    addParagraphs(report.subgroupAnalysisNarrative);
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Domain', 'Variable', 'n', 'Weighted Mean', 'Weighted SE', 'RSE %', 'Reliability']],
      body: subgroups.slice(0, 28).map((s) => [
        s.stratumValue,
        s.column,
        String(s.sampleSize),
        formatNumber(s.weightedMean),
        formatNumber(s.weightedSE),
        `${s.rsePct.toFixed(2)}%`,
        s.reliability,
      ]),
      styles: { fontSize: 8, cellPadding: 5, textColor: [30, 41, 59] },
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 18;
  }

  if (reportConfig.includeLimitations) {
    addSectionHeading('6. Reliability & Methodological Limitations');
    addParagraphs(report.limitationsAndReliability);
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `StatiGen AI Statistical Report  ·  Page ${i} of ${pageCount}`,
      margin,
      pageHeight - 24
    );
  }

  doc.save(`${safeSlug(reportConfig.title)}.pdf`);
}

export function exportReportToWord(payload: ReportExportPayload) {
  const {
    reportConfig,
    report,
    datasetName,
    rawProfile,
    cleanedProfile,
    auditLog,
    estimationConfig,
    estimates,
    subgroups,
  } = payload;
  const ciLabel = `${Math.round(estimationConfig.confidenceLevel * 100)}%`;

  const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(reportConfig.title)}</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; color: #0f172a; line-height: 1.5; font-size: 11pt; }
    h1 { font-size: 20pt; color: #0f172a; margin-bottom: 4pt; }
    h2 { font-size: 13pt; color: #0f172a; border-bottom: 1pt solid #cbd5e1; padding-bottom: 3pt; margin-top: 18pt; }
    p { margin: 6pt 0; }
    .meta { color: #475569; font-size: 9.5pt; margin-bottom: 14pt; }
    table { width: 100%; border-collapse: collapse; margin: 10pt 0 14pt 0; font-size: 9.5pt; }
    th, td { border: 1pt solid #cbd5e1; padding: 5pt 6pt; text-align: left; }
    th { background-color: #f1f5f9; font-weight: bold; }
    .num { text-align: right; }
  </style>
</head>
<body>
  <h1>${escapeHtml(reportConfig.title)}</h1>
  ${report.subtitle ? `<p><em>${escapeHtml(report.subtitle)}</em></p>` : ''}
  <p class="meta">${escapeHtml(reportConfig.organization)} | Dataset: ${escapeHtml(datasetName)} | Generated: ${escapeHtml(report.generatedAt)}</p>
  ${
    reportConfig.includeExecutiveSummary
      ? `<h2>1. Executive Summary</h2>${paragraphsToHtml(report.executiveSummary)}${
          report.keyTakeaways.length > 0
            ? `<ul>${report.keyTakeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
            : ''
        }`
      : ''
  }
  ${
    reportConfig.includePreparationAudit
      ? `<h2>2. Data Quality &amp; Preparation Audit</h2>${paragraphsToHtml(report.dataPreparationNarrative)}<p><strong>Records:</strong> ${rawProfile.rowCount} raw &rarr; ${cleanedProfile.rowCount} prepared (${cleanedProfile.completenessScore.toFixed(1)}% completeness).</p>${
          auditLog.length > 0
            ? `<table><thead><tr><th>Step</th><th>Variable</th><th>Method</th><th class="num">Affected</th><th>Details</th></tr></thead><tbody>${auditLog
                .map(
                  (a) =>
                    `<tr><td>${escapeHtml(a.step)}</td><td>${escapeHtml(a.column)}</td><td>${escapeHtml(a.method)}</td><td class="num">${a.affectedRows}</td><td>${escapeHtml(a.details)}</td></tr>`
                )
                .join('')}</tbody></table>`
            : ''
        }`
      : ''
  }
  ${
    reportConfig.includeMethodology
      ? `<h2>3. Survey Methodology &amp; Weighting</h2>${paragraphsToHtml(report.methodologyNarrative)}`
      : ''
  }
  ${
    reportConfig.includeKeyEstimates && estimates.length > 0
      ? `<h2>4. Key Population Estimates</h2>${paragraphsToHtml(report.keyFindingsNarrative)}<table><thead><tr><th>Variable</th><th class="num">n</th><th class="num">Unweighted</th><th class="num">Weighted</th><th class="num">Total</th><th class="num">${ciLabel} CI</th><th class="num">RSE %</th><th>Rating</th></tr></thead><tbody>${estimates
          .map(
            (e) =>
              `<tr><td>${escapeHtml(e.column)}</td><td class="num">${e.sampleSize}</td><td class="num">${formatNumber(e.unweightedMean)}</td><td class="num">${formatNumber(e.weightedMean)}</td><td class="num">${formatCompactNumber(e.weightedTotal)}</td><td class="num">[${formatNumber(e.ciLower)}, ${formatNumber(e.ciUpper)}]</td><td class="num">${e.rsePct.toFixed(2)}%</td><td>${escapeHtml(e.reliability)}</td></tr>`
          )
          .join('')}</tbody></table>`
      : ''
  }
  ${
    reportConfig.includeSubgroupAnalysis && subgroups.length > 0
      ? `<h2>5. Stratified Subgroup Analysis (${escapeHtml(estimationConfig.stratumColumn)})</h2>${paragraphsToHtml(report.subgroupAnalysisNarrative)}<table><thead><tr><th>Domain</th><th>Variable</th><th class="num">n</th><th class="num">Weighted Mean</th><th class="num">Weighted SE</th><th class="num">RSE %</th><th>Rating</th></tr></thead><tbody>${subgroups
          .slice(0, 30)
          .map(
            (s) =>
              `<tr><td>${escapeHtml(s.stratumValue)}</td><td>${escapeHtml(s.column)}</td><td class="num">${s.sampleSize}</td><td class="num">${formatNumber(s.weightedMean)}</td><td class="num">${formatNumber(s.weightedSE)}</td><td class="num">${s.rsePct.toFixed(2)}%</td><td>${escapeHtml(s.reliability)}</td></tr>`
          )
          .join('')}</tbody></table>`
      : ''
  }
  ${
    reportConfig.includeLimitations
      ? `<h2>6. Reliability &amp; Methodological Limitations</h2>${paragraphsToHtml(report.limitationsAndReliability)}`
      : ''
  }
</body>
</html>`;

  const blob = new Blob(['\ufeff', wordHtml], { type: 'application/msword;charset=utf-8' });
  triggerDownload(blob, `${safeSlug(reportConfig.title)}.doc`);
}

export function exportWorkflowRecipe(recipe: WorkflowRecipe) {
  const json = JSON.stringify(recipe, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  triggerDownload(blob, `${safeSlug(recipe.datasetName)}_recipe.json`);
}

export async function parseWorkflowRecipe(file: File): Promise<WorkflowRecipe> {
  const text = await file.text();
  const parsed = JSON.parse(text) as WorkflowRecipe;
  if (!parsed || !parsed.cleaningConfig || !parsed.estimationConfig || !parsed.reportConfig) {
    throw new Error('Invalid StatiGen workflow recipe file.');
  }
  return parsed;
}
