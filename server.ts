import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const portFlagIdx = process.argv.indexOf('--port');
  if (portFlagIdx !== -1 && process.argv[portFlagIdx + 1]) {
    const cliPort = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(cliPort) && cliPort > 0) return cliPort;
  }
  const envPort = process.env.PORT ? Number(process.env.PORT) : NaN;
  const nginxPort = process.env.NGINX_PORT ? Number(process.env.NGINX_PORT) : NaN;
  if (Number.isFinite(envPort) && envPort > 0 && envPort !== nginxPort) {
    return envPort;
  }
  const defaultPort = process.env.DEFAULT_APP_PORT ? Number(process.env.DEFAULT_APP_PORT) : NaN;
  if (Number.isFinite(defaultPort) && defaultPort > 0) return defaultPort;
  return 3000;
}

const PORT = resolvePort();
const MODEL_NAME = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please check your key in the Settings > Secrets panel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatApiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('GEMINI_API_KEY is not configured')) {
    return { status: 500, message: raw };
  }
  if (raw.includes('403') || raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message:
        'Gemini API authentication failed. Verify your API key in Settings > Secrets.',
    };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message:
        'API quota limit reached. Please wait a moment before retrying or review your plan.',
    };
  }
  return { status: 500, message: raw || 'Unexpected server error while calling Gemini.' };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // 1. AI Data Quality Audit & Preparation Recommendations
  app.post('/api/ai/audit', async (req, res) => {
    try {
      const { datasetName, rowCount, columnCount, duplicateRows, columns } = req.body ?? {};
      if (!datasetName || !Array.isArray(columns)) {
        res.status(400).json({ error: 'Missing dataset profile payload.' });
        return;
      }

      const ai = getGeminiClient();
      const prompt = `Analyze the following statistical survey dataset profile and recommend an optimal, rigorous data preparation plan.

Dataset: ${datasetName}
Rows: ${rowCount}
Columns: ${columnCount}
Exact Duplicate Rows: ${duplicateRows}

Column Profiles:
${JSON.stringify(columns, null, 2)}

Provide:
1. A concise executive quality assessment (2-3 crisp sentences, referencing actual counts and column names).
2. Detected likely sampling weight column (exact column name or empty string if none) and likely stratification/domain grouping column (exact column name or empty string if none).
3. Actionable per-column cleaning recommendations for columns that have missing values, outliers, or anomalies. For numeric imputation choose between 'median', 'mean', 'knn'; for categorical choose 'mode'; for outlier action choose 'cap', 'median', 'flag', or 'remove'. Keep rationale concise and grounded in skewness/distribution.`;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a senior official statistician specializing in survey methodology, automated data editing, and imputation (Fellegi-Holt, Little & Rubin). Ground every recommendation strictly in the provided numbers. Never invent columns or statistics.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              qualityGrade: {
                type: Type.STRING,
                description: 'One of: Ready, Minor Issues, Needs Preparation, Critical Attention',
              },
              suggestedWeightColumn: { type: Type.STRING },
              suggestedStratumColumn: { type: Type.STRING },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    column: { type: Type.STRING },
                    issueType: {
                      type: Type.STRING,
                      description: 'Missingness, Outliers, Consistency, or Duplicates',
                    },
                    recommendedImputation: {
                      type: Type.STRING,
                      description: 'median, mean, mode, knn, or none',
                    },
                    recommendedOutlierAction: {
                      type: Type.STRING,
                      description: 'cap, median, flag, remove, or none',
                    },
                    rationale: { type: Type.STRING },
                  },
                  required: [
                    'column',
                    'issueType',
                    'recommendedImputation',
                    'recommendedOutlierAction',
                    'rationale',
                  ],
                },
              },
              keyRisks: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              'summary',
              'qualityGrade',
              'suggestedWeightColumn',
              'suggestedStratumColumn',
              'recommendations',
              'keyRisks',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 2. AI Interpretation of Survey Weighted Estimates
  app.post('/api/ai/interpret-estimates', async (req, res) => {
    try {
      const { datasetName, weightColumn, stratumColumn, confidenceLevel, estimates, subgroups } =
        req.body ?? {};
      if (!Array.isArray(estimates) || estimates.length === 0) {
        res.status(400).json({ error: 'Estimates array is required.' });
        return;
      }

      const ai = getGeminiClient();
      const prompt = `Interpret the following computed survey estimates for "${datasetName}".

Design Weight Column: ${weightColumn || 'Unweighted (Equal Weights)'}
Stratification / Domain Column: ${stratumColumn || 'None'}
Confidence Level: ${Math.round((confidenceLevel || 0.95) * 100)}%

Overall Estimates:
${JSON.stringify(estimates, null, 2)}

Stratified Subgroup Breakdown (if any):
${JSON.stringify(subgroups || [], null, 2)}

Provide:
1. A concise headline synthesis (2-3 sentences).
2. 3 to 5 bullet-ready key statistical findings highlighting weighted vs. unweighted bias shifts, population totals, and notable subgroup disparities.
3. Precision & reliability commentary noting design effects (DEFF), effective sample size, and any variables with elevated Relative Standard Error (RSE >= 15%).`;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a chief survey statistician writing analytical briefs for a national statistical agency. Cite exact figures from the JSON input only. Do not fabricate numbers.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headlineSynthesis: { type: Type.STRING },
              keyFindings: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              precisionNotes: { type: Type.STRING },
              weightingImpact: { type: Type.STRING },
            },
            required: ['headlineSynthesis', 'keyFindings', 'precisionNotes', 'weightingImpact'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 3. Automated Publication-Ready Statistical Report Generation
  app.post('/api/ai/generate-report', async (req, res) => {
    try {
      const {
        reportTitle,
        organization,
        tone,
        datasetName,
        rawStats,
        cleanedStats,
        auditLog,
        estimationConfig,
        estimates,
        subgroups,
        categoricalBreakdowns,
        includedSections,
      } = req.body ?? {};

      if (!datasetName) {
        res.status(400).json({ error: 'Dataset context is required to generate report.' });
        return;
      }

      const ai = getGeminiClient();
      const toneGuide: Record<string, string> = {
        executive:
          'Write for senior decision-makers: direct, action-oriented, clear quantitative takeaways, minimal jargon.',
        official:
          'Write in the formal style of an Official Statistical Bulletin (e.g., National Statistical Office / OECD): neutral, methodical, transparent about weighting, margins of error, and RSE reliability.',
        academic:
          'Write in rigorous empirical research style: precise methodological exposition of imputation, outlier fences, Horvitz-Thompson/Hájek estimation, Kish effective sample size, and statistical caveats.',
      };

      const prompt = `Draft a complete, publication-ready statistical report based strictly on the verified computation results below.

Report Title: ${reportTitle || `Statistical Survey Report: ${datasetName}`}
Author / Organization: ${organization || 'Statistical Analysis Unit'}
Requested Tone: ${toneGuide[tone] || toneGuide.official}
Requested Sections: ${(includedSections || []).join(', ')}

Dataset Overview:
- Name: ${datasetName}
- Raw Dimensions: ${JSON.stringify(rawStats)}
- Post-Preparation Dimensions: ${JSON.stringify(cleanedStats)}

Data Preparation & Cleaning Audit Trail:
${JSON.stringify(auditLog || [], null, 2)}

Estimation Configuration:
${JSON.stringify(estimationConfig || {}, null, 2)}

Computed Weighted & Unweighted Estimates:
${JSON.stringify(estimates || [], null, 2)}

Stratified Subgroup Estimates:
${JSON.stringify(subgroups || [], null, 2)}

Weighted Categorical Distributions:
${JSON.stringify(categoricalBreakdowns || [], null, 2)}

Generate crisp, well-structured paragraphs for each section. Never invent statistics—every cited number must match the JSON inputs above. Keep each section thorough (2-3 well-crafted paragraphs or crisp analytical insights) and completely free of markdown clutter inside JSON strings (use clean prose paragraphs separated by double newlines).`;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          systemInstruction:
            'You are StatiGen AI, an automated statistical report author. Produce formal, accurate, publication-ready statistical narratives grounded 100% in the provided numerical outputs.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subtitle: { type: Type.STRING },
              executiveSummary: { type: Type.STRING },
              dataPreparationNarrative: { type: Type.STRING },
              methodologyNarrative: { type: Type.STRING },
              keyFindingsNarrative: { type: Type.STRING },
              subgroupAnalysisNarrative: { type: Type.STRING },
              limitationsAndReliability: { type: Type.STRING },
              keyTakeaways: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              'subtitle',
              'executiveSummary',
              'dataPreparationNarrative',
              'methodologyNarrative',
              'keyFindingsNarrative',
              'subgroupAnalysisNarrative',
              'limitationsAndReliability',
              'keyTakeaways',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 4. Interactive Grounded AI Statistical Analyst Q&A
  app.post('/api/ai/ask', async (req, res) => {
    try {
      const { question, history, context } = req.body ?? {};
      if (!question || typeof question !== 'string') {
        res.status(400).json({ error: 'A question string is required.' });
        return;
      }

      const ai = getGeminiClient();
      const priorHistory = Array.isArray(history)
        ? history
            .slice(-6)
            .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n')
        : '';

      const prompt = `Active Statistical Workspace Context (strict source of truth):
${JSON.stringify(context ?? {}, null, 2)}

${priorHistory ? `Recent Conversation:\n${priorHistory}\n\n` : ''}User Question:
${question}

Answer clearly, concisely, and rigorously using ONLY the computed statistics in the workspace context. Cite exact figures (means, totals, RSE%, DEFF, p-values, audit counts) whenever relevant. If a metric is not present in the context, state that explicitly rather than guessing.`;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          systemInstruction:
            'You are the StatiGen AI Statistical Analyst. You help survey statisticians, researchers, and policy analysts interpret their active dataset, cleaning pipeline, weighted survey estimates, hypothesis tests, and report findings. Keep answers crisp, authoritative, and strictly grounded in the provided JSON numbers.',
        },
      });

      res.json({ answer: (response.text ?? '').trim() });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const viteReady = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          hmr: disableHmr ? false : undefined,
          watch: disableHmr ? null : undefined,
        },
        appType: 'spa',
      })
    );

    viteReady.catch((err) => {
      console.error('Failed to initialize Vite dev middleware:', err);
    });

    app.use((req, res, next) => {
      viteReady
        .then((vite) => vite.middlewares(req, res, next))
        .catch((err) => next(err));
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`StatiGen AI server running on http://0.0.0.0:${PORT}`);
  });

  server.on('error', (err) => {
    console.error(`Failed to bind StatiGen AI server on port ${PORT}:`, err);
    process.exit(1);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting StatiGen AI server:', err);
  process.exit(1);
});
