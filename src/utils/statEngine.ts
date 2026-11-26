import {
  CategoricalBreakdown,
  CellValue,
  CleaningAuditEntry,
  CleaningConfig,
  ColumnProfile,
  ColumnType,
  CorrelationMatrixResult,
  CrossTabCell,
  CrossTabResult,
  DataRow,
  DatasetProfile,
  EstimationConfig,
  OutlierMethod,
  ReliabilityRating,
  StratumAnovaResult,
  SubgroupEstimate,
  VariableEstimate,
} from '../types/statigen';

export function isMissing(val: CellValue): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === 'number') return Number.isNaN(val) || !Number.isFinite(val);
  if (typeof val === 'string') {
    const t = val.trim().toLowerCase();
    return t === '' || t === 'na' || t === 'n/a' || t === 'null' || t === 'nan' || t === 'missing';
  }
  return false;
}

export function toNumeric(val: CellValue): number | null {
  if (isMissing(val)) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,%\s,]/g, '');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function meanOf(nums: number[]): number {
  if (nums.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < nums.length; i++) sum += nums[i];
  return sum / nums.length;
}

function stdDevOf(nums: number[], meanVal?: number): number {
  if (nums.length < 2) return 0;
  const m = meanVal ?? meanOf(nums);
  let sumSq = 0;
  for (let i = 0; i < nums.length; i++) {
    const d = nums[i] - m;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / (nums.length - 1));
}

function skewnessOf(nums: number[], m: number, sd: number): number {
  if (nums.length < 3 || sd === 0) return 0;
  let sumCubed = 0;
  for (let i = 0; i < nums.length; i++) {
    sumCubed += Math.pow((nums[i] - m) / sd, 3);
  }
  return sumCubed / nums.length;
}

function inferColumnType(name: string, rows: DataRow[]): ColumnType {
  const lower = name.toLowerCase();
  const nonMissing = rows.map((r) => r[name]).filter((v) => !isMissing(v));
  if (nonMissing.length === 0) return 'categorical';

  let numericCount = 0;
  for (const v of nonMissing) {
    if (toNumeric(v) !== null) numericCount++;
  }
  const numericRatio = numericCount / nonMissing.length;

  if (numericRatio >= 0.85) {
    if (
      lower.includes('weight') ||
      lower === 'wt' ||
      lower === 'wgt' ||
      lower.endsWith('_wt') ||
      lower.endsWith('_weight')
    ) {
      return 'weight';
    }
    if (lower === 'id' || lower.endsWith('_id') || lower === 'index') {
      return 'id';
    }
    return 'numeric';
  }

  const uniqueVals = new Set(nonMissing.map((v) => String(v).trim()));
  if (
    (lower === 'id' || lower.endsWith('_id') || lower.includes('identifier')) &&
    uniqueVals.size >= nonMissing.length * 0.85
  ) {
    return 'id';
  }
  return 'categorical';
}

export function profileDataset(rows: DataRow[]): DatasetProfile {
  if (rows.length === 0) {
    return {
      rowCount: 0,
      columnCount: 0,
      totalCells: 0,
      missingCells: 0,
      missingPct: 0,
      duplicateRows: 0,
      totalOutliersIQR: 0,
      completenessScore: 100,
      columns: [],
    };
  }

  const colNames = Object.keys(rows[0]);
  const seenSignatures = new Set<string>();
  let duplicateRows = 0;
  for (const row of rows) {
    const sig = colNames.map((c) => String(row[c] ?? '')).join('\u0001');
    if (seenSignatures.has(sig)) {
      duplicateRows++;
    } else {
      seenSignatures.add(sig);
    }
  }

  let totalMissingCells = 0;
  let totalOutliersIQR = 0;
  const columns: ColumnProfile[] = [];

  for (const name of colNames) {
    const colType = inferColumnType(name, rows);
    let missingCount = 0;
    const uniqueSet = new Set<string>();

    const numericEntries: Array<{ idx: number; val: number }> = [];
    const categoryCounts = new Map<string, number>();

    for (let i = 0; i < rows.length; i++) {
      const val = rows[i][name];
      if (isMissing(val)) {
        missingCount++;
        continue;
      }
      if (colType === 'numeric' || colType === 'weight') {
        const num = toNumeric(val);
        if (num === null) {
          missingCount++;
        } else {
          numericEntries.push({ idx: i, val: num });
          uniqueSet.add(String(num));
        }
      } else {
        const str = String(val).trim();
        uniqueSet.add(str);
        categoryCounts.set(str, (categoryCounts.get(str) ?? 0) + 1);
      }
    }

    totalMissingCells += missingCount;

    if (colType === 'numeric' || colType === 'weight') {
      const vals = numericEntries.map((e) => e.val);
      const sorted = [...vals].sort((a, b) => a - b);
      const m = meanOf(vals);
      const sd = stdDevOf(vals, m);
      const q1 = quantile(sorted, 0.25);
      const med = quantile(sorted, 0.5);
      const q3 = quantile(sorted, 0.75);
      const iqr = q3 - q1;
      const lowerFence = q1 - 1.5 * iqr;
      const upperFence = q3 + 1.5 * iqr;

      const outlierRowIndicesIQR: number[] = [];
      const outlierRowIndicesZ: number[] = [];
      let negativeCount = 0;

      for (const entry of numericEntries) {
        if (entry.val < 0) negativeCount++;
        if (colType === 'numeric') {
          if (iqr > 0 && (entry.val < lowerFence || entry.val > upperFence)) {
            outlierRowIndicesIQR.push(entry.idx);
          }
          if (sd > 0 && Math.abs((entry.val - m) / sd) > 3.0) {
            outlierRowIndicesZ.push(entry.idx);
          }
        }
      }

      totalOutliersIQR += outlierRowIndicesIQR.length;

      columns.push({
        name,
        type: colType,
        count: numericEntries.length,
        missingCount,
        missingPct: rows.length > 0 ? (missingCount / rows.length) * 100 : 0,
        uniqueCount: uniqueSet.size,
        mean: m,
        median: med,
        stdDev: sd,
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        q1,
        q3,
        iqr,
        skewness: skewnessOf(vals, m, sd),
        outlierCountIQR: outlierRowIndicesIQR.length,
        outlierCountZ: outlierRowIndicesZ.length,
        outlierRowIndicesIQR,
        outlierRowIndicesZ,
        negativeCount,
      });
    } else {
      const nonMissingCount = rows.length - missingCount;
      const topCategories = Array.from(categoryCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([value, count]) => ({
          value,
          count,
          pct: nonMissingCount > 0 ? (count / nonMissingCount) * 100 : 0,
        }));

      columns.push({
        name,
        type: colType,
        count: nonMissingCount,
        missingCount,
        missingPct: rows.length > 0 ? (missingCount / rows.length) * 100 : 0,
        uniqueCount: uniqueSet.size,
        outlierCountIQR: 0,
        outlierCountZ: 0,
        outlierRowIndicesIQR: [],
        outlierRowIndicesZ: [],
        topCategories,
      });
    }
  }

  const totalCells = rows.length * colNames.length;
  const missingPct = totalCells > 0 ? (totalMissingCells / totalCells) * 100 : 0;

  return {
    rowCount: rows.length,
    columnCount: colNames.length,
    totalCells,
    missingCells: totalMissingCells,
    missingPct,
    duplicateRows,
    totalOutliersIQR,
    completenessScore: Math.max(0, 100 - missingPct),
    columns,
  };
}

function getOutlierBounds(values: number[], method: OutlierMethod): { lower: number; upper: number } {
  if (values.length === 0) return { lower: -Infinity, upper: Infinity };
  const sorted = [...values].sort((a, b) => a - b);
  if (method === 'iqr_1_5' || method === 'iqr_3_0') {
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const mult = method === 'iqr_1_5' ? 1.5 : 3.0;
    return { lower: q1 - mult * iqr, upper: q3 + mult * iqr };
  }
  if (method === 'winsor_5') {
    return { lower: quantile(sorted, 0.05), upper: quantile(sorted, 0.95) };
  }
  const m = meanOf(values);
  const sd = stdDevOf(values, m);
  const zThresh = method === 'zscore_2_5' ? 2.5 : 3.0;
  return { lower: m - zThresh * sd, upper: m + zThresh * sd };
}

function toTitleCase(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => {
      if (word.includes('-')) {
        return word
          .split('-')
          .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
          .join('-');
      }
      return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : '';
    })
    .join(' ');
}

export interface CleaningExecutionResult {
  cleanedRows: DataRow[];
  auditLog: CleaningAuditEntry[];
  flaggedOutlierCells: Set<string>; // `${rowIdx}::${colName}`
  imputedCells: Set<string>;
  adjustedCells: Set<string>;
}

export function runCleaningPipeline(
  rawRows: DataRow[],
  config: CleaningConfig
): CleaningExecutionResult {
  let rows: DataRow[] = rawRows.map((r) => ({ ...r }));
  const auditLog: CleaningAuditEntry[] = [];
  const flaggedOutlierCells = new Set<string>();
  const imputedCells = new Set<string>();
  const adjustedCells = new Set<string>();
  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (rows.length === 0) {
    return { cleanedRows: [], auditLog, flaggedOutlierCells, imputedCells, adjustedCells };
  }

  const initialProfile = profileDataset(rows);
  const colNames = initialProfile.columns.map((c) => c.name);
  const numericCols = initialProfile.columns
    .filter((c) => c.type === 'numeric')
    .map((c) => c.name);

  // Step 1: Text whitespace trim & categorical standardization
  if (config.validation.trimAndStandardizeText) {
    let standardizedCount = 0;
    const catCols = initialProfile.columns
      .filter((c) => c.type === 'categorical')
      .map((c) => c.name);
    for (let i = 0; i < rows.length; i++) {
      for (const col of catCols) {
        const val = rows[i][col];
        if (typeof val === 'string' && !isMissing(val)) {
          const normalized = toTitleCase(val);
          if (normalized !== val) {
            rows[i][col] = normalized;
            standardizedCount++;
          }
        }
      }
    }
    if (standardizedCount > 0) {
      auditLog.push({
        id: 'step-text-norm',
        step: 'Text Standardization',
        column: 'All Categorical Columns',
        method: 'Trim & Title Case',
        affectedRows: standardizedCount,
        details: `Normalized whitespace and inconsistent casing across ${standardizedCount} cell entries.`,
        timestamp: nowStr,
      });
    }
  }

  // Step 2: Deduplication
  if (config.validation.removeDuplicates) {
    const seen = new Set<string>();
    const deduped: DataRow[] = [];
    let removed = 0;
    for (const r of rows) {
      const sig = colNames.map((c) => String(r[c] ?? '')).join('\u0001');
      if (seen.has(sig)) {
        removed++;
      } else {
        seen.add(sig);
        deduped.push(r);
      }
    }
    rows = deduped;
    if (removed > 0) {
      auditLog.push({
        id: 'step-dedup',
        step: 'Deduplication',
        column: 'All Columns',
        method: 'Exact Row Match',
        affectedRows: removed,
        details: `Removed ${removed} exact duplicate survey records.`,
        timestamp: nowStr,
      });
    }
  }

  // Step 3: Domain Rule — Non-negative numeric enforcement (convert negative sentinel codes to missing so imputation handles them)
  for (const col of config.validation.enforceNonNegativeColumns) {
    let converted = 0;
    for (let i = 0; i < rows.length; i++) {
      const n = toNumeric(rows[i][col]);
      if (n !== null && n < 0) {
        rows[i][col] = null;
        converted++;
      }
    }
    if (converted > 0) {
      auditLog.push({
        id: `step-nonneg-${col}`,
        step: 'Domain Validation',
        column: col,
        method: 'Non-Negative Constraint',
        affectedRows: converted,
        details: `Flagged ${converted} negative invalid value(s) as missing prior to imputation.`,
        timestamp: nowStr,
      });
    }
  }

  // Step 3b: Custom Range & Cross-Column Consistency Validation Rules (Fellegi-Holt style)
  for (const rule of config.validation.customRules ?? []) {
    let violations = 0;
    for (let i = 0; i < rows.length; i++) {
      const val = toNumeric(rows[i][rule.column]);
      if (val === null) continue;

      let violated = false;
      if (rule.type === 'range') {
        if (rule.min !== undefined && val < rule.min) violated = true;
        if (rule.max !== undefined && val > rule.max) violated = true;
      } else if (rule.type === 'cross_lte' && rule.compareColumn) {
        const ref = toNumeric(rows[i][rule.compareColumn]);
        if (ref !== null && val > ref) violated = true;
      }

      if (violated) {
        violations++;
        if (rule.action === 'recode_missing') {
          rows[i][rule.column] = null;
        } else {
          flaggedOutlierCells.add(`${i}::${rule.column}`);
        }
      }
    }

    if (violations > 0) {
      const ruleDesc =
        rule.type === 'range'
          ? `Range [${rule.min ?? '-∞'}, ${rule.max ?? '+∞'}]`
          : `Consistency (${rule.column} <= ${rule.compareColumn})`;
      auditLog.push({
        id: `step-rule-${rule.id}`,
        step: 'Custom Validation Rule',
        column: rule.column,
        method: `${ruleDesc} -> ${rule.action === 'recode_missing' ? 'Recode Missing' : 'Flag'}`,
        affectedRows: violations,
        details: `Detected ${violations} record(s) violating ${ruleDesc}.`,
        timestamp: nowStr,
      });
    }
  }

  // Step 4: Missing Value Imputation
  const dropIndices = new Set<number>();
  const postRuleProfile = profileDataset(rows);

  // Precompute standardized numeric matrix for KNN if any column uses KNN
  const colMeans: Record<string, number> = {};
  const colSDs: Record<string, number> = {};
  for (const cp of postRuleProfile.columns) {
    if (cp.type === 'numeric') {
      colMeans[cp.name] = cp.mean ?? 0;
      colSDs[cp.name] = cp.stdDev && cp.stdDev > 0 ? cp.stdDev : 1;
    }
  }

  for (const cp of postRuleProfile.columns) {
    if (cp.type === 'id' || cp.missingCount === 0) continue;
    const override = config.columnOverrides[cp.name]?.imputation;
    const strategy =
      override ??
      (cp.type === 'numeric' || cp.type === 'weight'
        ? config.globalNumericImputation
        : config.globalCategoricalImputation);

    if (strategy === 'none') continue;

    if (strategy === 'drop') {
      let count = 0;
      for (let i = 0; i < rows.length; i++) {
        if (isMissing(rows[i][cp.name])) {
          dropIndices.add(i);
          count++;
        }
      }
      if (count > 0) {
        auditLog.push({
          id: `step-imp-${cp.name}`,
          step: 'Missing Value Handling',
          column: cp.name,
          method: 'Listwise Deletion',
          affectedRows: count,
          details: `Marked ${count} incomplete record(s) in ${cp.name} for removal.`,
          timestamp: nowStr,
        });
      }
      continue;
    }

    if (cp.type === 'numeric' || cp.type === 'weight') {
      let imputedCount = 0;
      const fillVal =
        strategy === 'mean'
          ? Math.round((cp.mean ?? 0) * 100) / 100
          : Math.round((cp.median ?? 0) * 100) / 100;

      if (strategy === 'knn') {
        const k = Math.max(1, Math.min(15, config.knnK || 5));
        const donorRows: Array<{ idx: number; target: number }> = [];
        for (let i = 0; i < rows.length; i++) {
          const tv = toNumeric(rows[i][cp.name]);
          if (tv !== null) donorRows.push({ idx: i, target: tv });
        }

        const otherNumeric = numericCols.filter((c) => c !== cp.name);

        for (let i = 0; i < rows.length; i++) {
          if (!isMissing(rows[i][cp.name])) continue;
          if (donorRows.length === 0) {
            rows[i][cp.name] = fillVal;
          } else {
            const distances = donorRows.map((donor) => {
              let distSq = 0;
              let dims = 0;
              for (const oc of otherNumeric) {
                const a = toNumeric(rows[i][oc]);
                const b = toNumeric(rows[donor.idx][oc]);
                if (a !== null && b !== null) {
                  const diff = (a - b) / colSDs[oc];
                  distSq += diff * diff;
                  dims++;
                }
              }
              return { target: donor.target, dist: dims > 0 ? Math.sqrt(distSq / dims) : 999 };
            });
            distances.sort((a, b) => a.dist - b.dist);
            const topK = distances.slice(0, k);
            const avg = meanOf(topK.map((d) => d.target));
            rows[i][cp.name] = Math.round(avg * 100) / 100;
          }
          imputedCells.add(`${i}::${cp.name}`);
          imputedCount++;
        }

        if (imputedCount > 0) {
          auditLog.push({
            id: `step-imp-${cp.name}`,
            step: 'Imputation',
            column: cp.name,
            method: `K-Nearest Neighbors (k=${k})`,
            affectedRows: imputedCount,
            details: `Imputed ${imputedCount} missing numeric value(s) using standardized Euclidean neighbors.`,
            timestamp: nowStr,
          });
        }
      } else if (strategy === 'ffill') {
        let lastValid = fillVal;
        for (let i = 0; i < rows.length; i++) {
          const v = toNumeric(rows[i][cp.name]);
          if (v !== null) {
            lastValid = v;
          } else {
            rows[i][cp.name] = lastValid;
            imputedCells.add(`${i}::${cp.name}`);
            imputedCount++;
          }
        }
        if (imputedCount > 0) {
          auditLog.push({
            id: `step-imp-${cp.name}`,
            step: 'Imputation',
            column: cp.name,
            method: 'Forward Fill',
            affectedRows: imputedCount,
            details: `Carried forward prior valid observation for ${imputedCount} missing value(s).`,
            timestamp: nowStr,
          });
        }
      } else {
        for (let i = 0; i < rows.length; i++) {
          if (isMissing(rows[i][cp.name])) {
            rows[i][cp.name] = fillVal;
            imputedCells.add(`${i}::${cp.name}`);
            imputedCount++;
          }
        }
        if (imputedCount > 0) {
          auditLog.push({
            id: `step-imp-${cp.name}`,
            step: 'Imputation',
            column: cp.name,
            method: strategy === 'mean' ? 'Mean Imputation' : 'Median Imputation',
            affectedRows: imputedCount,
            details: `Replaced ${imputedCount} missing value(s) with ${strategy} (${fillVal.toLocaleString()}).`,
            timestamp: nowStr,
          });
        }
      }
    } else {
      // Categorical imputation (Mode or Forward Fill)
      const modeVal = cp.topCategories?.[0]?.value ?? 'Unknown';
      let imputedCount = 0;
      let lastVal = modeVal;
      for (let i = 0; i < rows.length; i++) {
        if (isMissing(rows[i][cp.name])) {
          rows[i][cp.name] = strategy === 'ffill' ? lastVal : modeVal;
          imputedCells.add(`${i}::${cp.name}`);
          imputedCount++;
        } else {
          lastVal = String(rows[i][cp.name]);
        }
      }
      if (imputedCount > 0) {
        auditLog.push({
          id: `step-imp-${cp.name}`,
          step: 'Imputation',
          column: cp.name,
          method: strategy === 'ffill' ? 'Forward Fill' : 'Mode Imputation',
          affectedRows: imputedCount,
          details: `Filled ${imputedCount} missing category value(s) with "${modeVal}".`,
          timestamp: nowStr,
        });
      }
    }
  }

  if (dropIndices.size > 0) {
    rows = rows.filter((_, idx) => !dropIndices.has(idx));
  }

  // Step 5: Outlier Detection & Handling (on numeric columns, excluding weights & IDs)
  const outlierRemoveIndices = new Set<number>();
  const postImpProfile = profileDataset(rows);

  for (const cp of postImpProfile.columns) {
    if (cp.type !== 'numeric') continue;
    const action = config.columnOverrides[cp.name]?.outlierAction ?? config.globalOutlierAction;
    if (action === 'none') continue;

    const vals: number[] = [];
    for (const r of rows) {
      const n = toNumeric(r[cp.name]);
      if (n !== null) vals.push(n);
    }
    if (vals.length < 4) continue;

    const { lower, upper } = getOutlierBounds(vals, config.outlierMethod);
    const medVal = Math.round((cp.median ?? 0) * 100) / 100;
    let affected = 0;

    for (let i = 0; i < rows.length; i++) {
      const n = toNumeric(rows[i][cp.name]);
      if (n === null) continue;
      if (n < lower || n > upper) {
        affected++;
        if (action === 'flag') {
          flaggedOutlierCells.add(`${i}::${cp.name}`);
        } else if (action === 'cap') {
          const capped = n < lower ? lower : upper;
          rows[i][cp.name] = Math.round(capped * 100) / 100;
          adjustedCells.add(`${i}::${cp.name}`);
        } else if (action === 'median') {
          rows[i][cp.name] = medVal;
          adjustedCells.add(`${i}::${cp.name}`);
        } else if (action === 'remove') {
          outlierRemoveIndices.add(i);
        }
      }
    }

    if (affected > 0) {
      const methodLabels: Record<OutlierMethod, string> = {
        iqr_1_5: 'IQR 1.5x Fence',
        iqr_3_0: 'IQR 3.0x Extreme Fence',
        zscore_3: 'Z-Score (|z| > 3.0)',
        zscore_2_5: 'Z-Score (|z| > 2.5)',
        winsor_5: '5th–95th Percentile Bounds',
      };
      const actionLabels: Record<string, string> = {
        flag: 'Flagged for Review',
        cap: 'Winsorized / Capped to Fence',
        median: 'Replaced with Column Median',
        remove: 'Removed Outlier Rows',
      };
      auditLog.push({
        id: `step-out-${cp.name}`,
        step: 'Outlier Treatment',
        column: cp.name,
        method: `${methodLabels[config.outlierMethod]} -> ${actionLabels[action]}`,
        affectedRows: affected,
        details: `Detected ${affected} outlier(s) outside [${(Math.round(lower * 10) / 10).toLocaleString()}, ${(Math.round(upper * 10) / 10).toLocaleString()}].`,
        timestamp: nowStr,
      });
    }
  }

  if (outlierRemoveIndices.size > 0) {
    rows = rows.filter((_, idx) => !outlierRemoveIndices.has(idx));
  }

  return {
    cleanedRows: rows,
    auditLog,
    flaggedOutlierCells,
    imputedCells,
    adjustedCells,
  };
}

function zCriticalForConfidence(level: 0.9 | 0.95 | 0.99): number {
  if (level === 0.9) return 1.6449;
  if (level === 0.99) return 2.5758;
  return 1.96;
}

function classifyRSE(rsePct: number): ReliabilityRating {
  if (rsePct < 15) return 'Reliable';
  if (rsePct <= 25) return 'Caution';
  return 'Unreliable';
}

function computeSingleVariableEstimate(
  rows: DataRow[],
  column: string,
  weightColumn: string,
  confidenceLevel: 0.9 | 0.95 | 0.99
): VariableEstimate {
  const pairs: Array<{ y: number; w: number }> = [];

  for (const r of rows) {
    const y = toNumeric(r[column]);
    if (y === null) continue;
    let w = 1;
    if (weightColumn) {
      const wNum = toNumeric(r[weightColumn]);
      if (wNum === null || wNum <= 0) continue;
      w = wNum;
    }
    pairs.push({ y, w });
  }

  const n = pairs.length;
  if (n === 0) {
    return {
      column,
      sampleSize: 0,
      sumOfWeights: 0,
      effectiveSampleSize: 0,
      designEffect: 1,
      unweightedMean: 0,
      unweightedSE: 0,
      weightedMean: 0,
      weightedSE: 0,
      weightedTotal: 0,
      weightedTotalSE: 0,
      marginOfError: 0,
      ciLower: 0,
      ciUpper: 0,
      rsePct: 0,
      biasShiftPct: 0,
      reliability: 'Unreliable',
    };
  }

  const yVals = pairs.map((p) => p.y);
  const unweightedMean = meanOf(yVals);
  const unweightedSD = stdDevOf(yVals, unweightedMean);
  const unweightedSE = n > 0 ? unweightedSD / Math.sqrt(n) : 0;

  let sumW = 0;
  let sumW2 = 0;
  let sumWY = 0;
  for (const p of pairs) {
    sumW += p.w;
    sumW2 += p.w * p.w;
    sumWY += p.w * p.y;
  }

  const weightedMean = sumW > 0 ? sumWY / sumW : 0;
  const weightedTotal = sumWY;

  // Kish Effective Sample Size & Design Effect due to unequal weights
  const effectiveSampleSize = sumW2 > 0 ? (sumW * sumW) / sumW2 : n;
  const designEffect = effectiveSampleSize > 0 ? n / effectiveSampleSize : 1;

  // Taylor linearization variance estimator for Hájek ratio mean
  let varNum = 0;
  for (const p of pairs) {
    const resid = p.y - weightedMean;
    varNum += p.w * p.w * resid * resid;
  }
  const finiteAdj = n > 1 ? n / (n - 1) : 1;
  const weightedVar = sumW > 0 ? (finiteAdj * varNum) / (sumW * sumW) : 0;
  const weightedSE = Math.sqrt(Math.max(0, weightedVar));
  const weightedTotalSE = weightedSE * sumW;

  const z = zCriticalForConfidence(confidenceLevel);
  const marginOfError = z * weightedSE;
  const ciLower = weightedMean - marginOfError;
  const ciUpper = weightedMean + marginOfError;

  const rsePct = Math.abs(weightedMean) > 1e-9 ? (weightedSE / Math.abs(weightedMean)) * 100 : 0;
  const biasShiftPct =
    Math.abs(unweightedMean) > 1e-9
      ? ((weightedMean - unweightedMean) / Math.abs(unweightedMean)) * 100
      : 0;

  return {
    column,
    sampleSize: n,
    sumOfWeights: sumW,
    effectiveSampleSize,
    designEffect,
    unweightedMean,
    unweightedSE,
    weightedMean,
    weightedSE,
    weightedTotal,
    weightedTotalSE,
    marginOfError,
    ciLower,
    ciUpper,
    rsePct,
    biasShiftPct,
    reliability: classifyRSE(rsePct),
  };
}

export function computeSurveyEstimates(
  rows: DataRow[],
  config: EstimationConfig
): {
  overall: VariableEstimate[];
  subgroups: SubgroupEstimate[];
  categorical: CategoricalBreakdown[];
} {
  const overall = config.targetColumns.map((col) =>
    computeSingleVariableEstimate(rows, col, config.weightColumn, config.confidenceLevel)
  );

  const subgroups: SubgroupEstimate[] = [];
  if (config.stratumColumn) {
    const groups = new Map<string, DataRow[]>();
    for (const r of rows) {
      const rawKey = r[config.stratumColumn];
      const key = isMissing(rawKey) ? 'Unspecified' : String(rawKey).trim();
      const bucket = groups.get(key) ?? [];
      bucket.push(r);
      groups.set(key, bucket);
    }

    const sortedKeys = Array.from(groups.keys()).sort();
    for (const col of config.targetColumns) {
      for (const stratumValue of sortedKeys) {
        const subRows = groups.get(stratumValue) ?? [];
        const est = computeSingleVariableEstimate(
          subRows,
          col,
          config.weightColumn,
          config.confidenceLevel
        );
        subgroups.push({
          stratumValue,
          column: col,
          sampleSize: est.sampleSize,
          sumOfWeights: est.sumOfWeights,
          unweightedMean: est.unweightedMean,
          weightedMean: est.weightedMean,
          weightedTotal: est.weightedTotal,
          weightedSE: est.weightedSE,
          ciLower: est.ciLower,
          ciUpper: est.ciUpper,
          rsePct: est.rsePct,
          reliability: est.reliability,
        });
      }
    }
  }

  const categorical: CategoricalBreakdown[] = [];
  for (const col of config.categoricalColumns) {
    const bucketCounts = new Map<string, { n: number; sumW: number; sumW2: number }>();
    let totalN = 0;
    let totalW = 0;
    let totalW2 = 0;

    for (const r of rows) {
      const rawVal = r[col];
      if (isMissing(rawVal)) continue;
      const label = String(rawVal).trim();
      let w = 1;
      if (config.weightColumn) {
        const wNum = toNumeric(r[config.weightColumn]);
        if (wNum === null || wNum <= 0) continue;
        w = wNum;
      }
      totalN++;
      totalW += w;
      totalW2 += w * w;
      const prev = bucketCounts.get(label) ?? { n: 0, sumW: 0, sumW2: 0 };
      prev.n += 1;
      prev.sumW += w;
      prev.sumW2 += w * w;
      bucketCounts.set(label, prev);
    }

    const nEff = totalW2 > 0 ? (totalW * totalW) / totalW2 : totalN;
    const categories = Array.from(bucketCounts.entries())
      .sort((a, b) => b[1].sumW - a[1].sumW)
      .map(([label, stats]) => {
        const p = totalW > 0 ? stats.sumW / totalW : 0;
        const se = nEff > 1 ? Math.sqrt((p * (1 - p)) / nEff) * 100 : 0;
        return {
          label,
          sampleCount: stats.n,
          unweightedPct: totalN > 0 ? (stats.n / totalN) * 100 : 0,
          weightedCount: stats.sumW,
          weightedPct: p * 100,
          sePct: se,
        };
      });

    categorical.push({ column: col, categories });
  }

  return { overall, subgroups, categorical };
}

export interface HistogramBin {
  label: string;
  rawCount: number;
  cleanedCount: number;
}

export function buildComparisonHistogram(
  rawRows: DataRow[],
  cleanedRows: DataRow[],
  column: string,
  binCount = 10
): HistogramBin[] {
  const rawVals = rawRows.map((r) => toNumeric(r[column])).filter((v): v is number => v !== null);
  const cleanVals = cleanedRows
    .map((r) => toNumeric(r[column]))
    .filter((v): v is number => v !== null);

  if (cleanVals.length === 0 && rawVals.length === 0) return [];

  // Use cleaned range (or 98th percentile of raw) so a single giant raw outlier doesn't squash all bins
  const refSorted = [...(cleanVals.length > 0 ? cleanVals : rawVals)].sort((a, b) => a - b);
  const minVal = refSorted[0];
  const maxVal = refSorted[refSorted.length - 1];
  const span = maxVal - minVal || 1;
  const step = span / binCount;

  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, idx) => {
    const start = minVal + idx * step;
    return {
      label: formatCompactNumber(start),
      rawCount: 0,
      cleanedCount: 0,
    };
  });

  const placeInBin = (val: number) => {
    const rawIdx = Math.floor((val - minVal) / step);
    return Math.max(0, Math.min(binCount - 1, rawIdx));
  };

  for (const v of rawVals) {
    bins[placeInBin(v)].rawCount++;
  }
  for (const v of cleanVals) {
    bins[placeInBin(v)].cleanedCount++;
  }

  return bins;
}

export function formatCompactNumber(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(val / 1_000).toFixed(1)}k`;
  if (abs >= 100) return Math.round(val).toLocaleString();
  return Number(val.toFixed(2)).toString();
}

export function formatNumber(val: number, decimals = 2): string {
  if (!Number.isFinite(val)) return '—';
  return val.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// --- Advanced Analytical Statistical Functions ---

function logGamma(z: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function gammp(a: number, x: number): number {
  if (x <= 0 || a <= 0) return 0;
  const gln = logGamma(a);
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 100; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 3e-7) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  // Continued fraction for Q(a, x)
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 100; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-7) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - gln) * h;
  return Math.max(0, Math.min(1, 1 - q));
}

function chiSquarePValue(chiSq: number, df: number): number {
  if (df <= 0 || chiSq <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - gammp(df / 2, chiSq / 2)));
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 100;
  const EPS = 3e-7;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

function fDistPValue(fStat: number, df1: number, df2: number): number {
  if (df1 <= 0 || df2 <= 0 || fStat <= 0) return 1;
  const x = df2 / (df2 + df1 * fStat);
  return Math.max(0, Math.min(1, betai(df2 / 2, df1 / 2, x)));
}

export function computeCorrelationMatrix(
  rows: DataRow[],
  columns: string[],
  weightColumn: string
): CorrelationMatrixResult {
  const nCols = columns.length;
  const matrix: number[][] = Array.from({ length: nCols }, () => Array(nCols).fill(0));

  for (let i = 0; i < nCols; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < nCols; j++) {
      const colA = columns[i];
      const colB = columns[j];
      const pairs: Array<{ x: number; y: number; w: number }> = [];

      for (const r of rows) {
        const x = toNumeric(r[colA]);
        const y = toNumeric(r[colB]);
        if (x === null || y === null) continue;
        let w = 1;
        if (weightColumn) {
          const wNum = toNumeric(r[weightColumn]);
          if (wNum === null || wNum <= 0) continue;
          w = wNum;
        }
        pairs.push({ x, y, w });
      }

      if (pairs.length < 3) {
        matrix[i][j] = 0;
        matrix[j][i] = 0;
        continue;
      }

      let sumW = 0;
      let sumWX = 0;
      let sumWY = 0;
      for (const p of pairs) {
        sumW += p.w;
        sumWX += p.w * p.x;
        sumWY += p.w * p.y;
      }
      const meanX = sumWX / sumW;
      const meanY = sumWY / sumW;

      let cov = 0;
      let varX = 0;
      let varY = 0;
      for (const p of pairs) {
        const dx = p.x - meanX;
        const dy = p.y - meanY;
        cov += p.w * dx * dy;
        varX += p.w * dx * dx;
        varY += p.w * dy * dy;
      }

      const denom = Math.sqrt(varX * varY);
      const rVal = denom > 1e-12 ? Math.max(-1, Math.min(1, cov / denom)) : 0;
      matrix[i][j] = rVal;
      matrix[j][i] = rVal;
    }
  }

  return { columns, weighted: Boolean(weightColumn), matrix };
}

export function computeCrossTabulation(
  rows: DataRow[],
  rowColumn: string,
  colColumn: string,
  weightColumn: string
): CrossTabResult | null {
  if (!rowColumn || !colColumn || rowColumn === colColumn) return null;

  const rowSet = new Set<string>();
  const colSet = new Set<string>();
  const rawCounts = new Map<string, { n: number; w: number }>();

  let grandSampleTotal = 0;
  let grandWeightedTotal = 0;

  for (const r of rows) {
    const rv = r[rowColumn];
    const cv = r[colColumn];
    if (isMissing(rv) || isMissing(cv)) continue;
    let w = 1;
    if (weightColumn) {
      const wn = toNumeric(r[weightColumn]);
      if (wn === null || wn <= 0) continue;
      w = wn;
    }
    const rLabel = String(rv).trim();
    const cLabel = String(cv).trim();
    rowSet.add(rLabel);
    colSet.add(cLabel);
    const key = `${rLabel}\u0001${cLabel}`;
    const prev = rawCounts.get(key) ?? { n: 0, w: 0 };
    prev.n += 1;
    prev.w += w;
    rawCounts.set(key, prev);
    grandSampleTotal += 1;
    grandWeightedTotal += w;
  }

  const rowLabels = Array.from(rowSet).sort();
  const colLabels = Array.from(colSet).sort();
  if (rowLabels.length < 2 || colLabels.length < 2 || grandSampleTotal === 0) return null;

  const rowTotals: Record<string, { sampleCount: number; weightedCount: number }> = {};
  const colTotals: Record<string, { sampleCount: number; weightedCount: number }> = {};
  const cells: Record<string, Record<string, CrossTabCell>> = {};

  for (const rl of rowLabels) {
    rowTotals[rl] = { sampleCount: 0, weightedCount: 0 };
    cells[rl] = {};
  }
  for (const cl of colLabels) {
    colTotals[cl] = { sampleCount: 0, weightedCount: 0 };
  }

  for (const rl of rowLabels) {
    for (const cl of colLabels) {
      const entry = rawCounts.get(`${rl}\u0001${cl}`) ?? { n: 0, w: 0 };
      rowTotals[rl].sampleCount += entry.n;
      rowTotals[rl].weightedCount += entry.w;
      colTotals[cl].sampleCount += entry.n;
      colTotals[cl].weightedCount += entry.w;
    }
  }

  let chiSquare = 0;
  for (const rl of rowLabels) {
    for (const cl of colLabels) {
      const entry = rawCounts.get(`${rl}\u0001${cl}`) ?? { n: 0, w: 0 };
      const rWeightedTotal = rowTotals[rl].weightedCount;
      cells[rl][cl] = {
        sampleCount: entry.n,
        weightedCount: entry.w,
        rowPct: rWeightedTotal > 0 ? (entry.w / rWeightedTotal) * 100 : 0,
      };
      // Pearson chi-square computed on observed sample counts to keep sample-size inference valid
      const expected = (rowTotals[rl].sampleCount * colTotals[cl].sampleCount) / grandSampleTotal;
      if (expected > 0) {
        const diff = entry.n - expected;
        chiSquare += (diff * diff) / expected;
      }
    }
  }

  const df = (rowLabels.length - 1) * (colLabels.length - 1);
  const pValue = chiSquarePValue(chiSquare, df);

  return {
    rowColumn,
    colColumn,
    rowLabels,
    colLabels,
    cells,
    rowTotals,
    colTotals,
    grandSampleTotal,
    grandWeightedTotal,
    chiSquare,
    df,
    pValue,
    significant: pValue < 0.05,
  };
}

export function computeStratumAnova(
  rows: DataRow[],
  targetColumn: string,
  stratumColumn: string
): StratumAnovaResult | null {
  if (!targetColumn || !stratumColumn) return null;
  const groups = new Map<string, number[]>();
  const allVals: number[] = [];

  for (const r of rows) {
    const y = toNumeric(r[targetColumn]);
    const g = r[stratumColumn];
    if (y === null || isMissing(g)) continue;
    const key = String(g).trim();
    const arr = groups.get(key) ?? [];
    arr.push(y);
    groups.set(key, arr);
    allVals.push(y);
  }

  const k = groups.size;
  const N = allVals.length;
  if (k < 2 || N <= k) return null;

  const grandMean = meanOf(allVals);
  let ssBetween = 0;
  let ssWithin = 0;

  for (const vals of groups.values()) {
    const gm = meanOf(vals);
    ssBetween += vals.length * Math.pow(gm - grandMean, 2);
    for (const v of vals) {
      ssWithin += Math.pow(v - gm, 2);
    }
  }

  const dfBetween = k - 1;
  const dfWithin = N - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const fStatistic = msWithin > 1e-12 ? msBetween / msWithin : 0;
  const pValue = fDistPValue(fStatistic, dfBetween, dfWithin);

  return {
    column: targetColumn,
    stratumColumn,
    fStatistic,
    dfBetween,
    dfWithin,
    pValue,
    significant: pValue < 0.05,
  };
}
