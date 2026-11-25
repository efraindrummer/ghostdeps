/**
 * Asesor de ciberseguridad asistido por IA.
 * Conecta de forma nativa (mediante fetch, sin dependencias pesadas) con:
 *  - Google Gemini (GEMINI_API_KEY / GOOGLE_API_KEY)
 *  - Anthropic Claude (ANTHROPIC_API_KEY)
 *  - OpenAI ChatGPT (OPENAI_API_KEY)
 */
import type { PackageReport, Summary } from '../types.js';

export type AiProvider = 'gemini' | 'anthropic' | 'openai';

export interface AiAdvisorOptions {
  provider?: AiProvider;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface AiAnalysisResult {
  provider: AiProvider;
  model: string;
  analysis: string;
}

export function detectAiConfig(options: AiAdvisorOptions = {}): {
  provider: AiProvider;
  apiKey: string;
  model: string;
} | null {
  const env = process.env;

  const geminiKey = options.apiKey || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const anthropicKey = options.apiKey || env.ANTHROPIC_API_KEY;
  const openaiKey = options.apiKey || env.OPENAI_API_KEY;

  if (options.provider === 'gemini') {
    if (!geminiKey) return null;
    return { provider: 'gemini', apiKey: geminiKey, model: options.model || 'gemini-1.5-flash' };
  }
  if (options.provider === 'anthropic') {
    if (!anthropicKey) return null;
    return { provider: 'anthropic', apiKey: anthropicKey, model: options.model || 'claude-3-5-haiku-20241022' };
  }
  if (options.provider === 'openai') {
    if (!openaiKey) return null;
    return { provider: 'openai', apiKey: openaiKey, model: options.model || 'gpt-4o-mini' };
  }

  // Auto-detección por variables de entorno disponibles
  if (geminiKey) {
    return { provider: 'gemini', apiKey: geminiKey, model: options.model || 'gemini-1.5-flash' };
  }
  if (anthropicKey) {
    return { provider: 'anthropic', apiKey: anthropicKey, model: options.model || 'claude-3-5-haiku-20241022' };
  }
  if (openaiKey) {
    return { provider: 'openai', apiKey: openaiKey, model: options.model || 'gpt-4o-mini' };
  }

  return null;
}

export function buildAiPrompt(reports: PackageReport[], summary: Summary): string {
  const problematic = reports.filter(
    (r) => r.status === 'evaluated' && r.result && r.result.score < 70,
  );

  const payload = problematic.map((r) => ({
    name: r.name,
    version: r.spec,
    kind: r.kind,
    via: r.via,
    score: r.result?.score,
    category: r.result?.category,
    mainAlert: r.result?.mainAlert?.message,
    penalties: r.result?.penalties.map((p) => p.message),
    daysSinceLastCommit: r.signals?.daysSinceLastCommit,
    activeMaintainers: r.signals?.activeMaintainers,
    archived: r.signals?.archived,
    deprecated: r.signals?.deprecated,
  }));

  return `Actúa como un Ingeniero Principal de Ciberseguridad y Supply Chain Security experto en el ecosistema Node.js / JavaScript.

Se ha ejecutado la herramienta GhostDeps sobre un proyecto y se han detectado ${problematic.length} dependencias en riesgo (de un total de ${summary.total}):
- Críticas/Fantasma: ${summary.critical}
- Precaución: ${summary.caution}

A continuación tienes el detalle de las dependencias problemáticas:
\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

Por favor, proporciona una respuesta en Markdown clara, profesional y concisa (en español):
1. **Diagnóstico Ejecutivo de Ciberseguridad**: Resumen rápido del nivel de exposición del proyecto.
2. **Alternativas y Reemplazos Recomendados**: Para cada dependencia crítica o con bajo score, sugiere un reemplazo moderno, activo y seguro del ecosistema npm (o APIs nativas de Node.js como \`fetch\`, \`crypto\`, etc., si aplica).
3. **Plan de Remediación Priorizado**: Qué acciones inmediatas debe tomar el equipo (ej. overrides en package.json para transitivas, vendorización, o actualización de paquetes directos).

Mantén la respuesta práctica y orientada a código.`;
}

export async function queryGemini(apiKey: string, model: string, prompt: string, timeoutMs = 25000): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Error en API de Gemini (HTTP ${res.status}): ${errorText.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Respuesta vacía o inesperada de la API de Gemini.');
  return text;
}

export async function queryAnthropic(apiKey: string, model: string, prompt: string, timeoutMs = 25000): Promise<string> {
  const url = 'https://api.anthropic.com/v1/messages';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Error en API de Anthropic (HTTP ${res.status}): ${errorText.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = json.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('Respuesta vacía o inesperada de la API de Anthropic.');
  return text;
}

export async function queryOpenAI(apiKey: string, model: string, prompt: string, timeoutMs = 25000): Promise<string> {
  const url = 'https://api.openai.com/v1/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Error en API de OpenAI (HTTP ${res.status}): ${errorText.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('Respuesta vacía o inesperada de la API de OpenAI.');
  return text;
}

export async function analyzeWithAi(
  reports: PackageReport[],
  summary: Summary,
  options: AiAdvisorOptions = {},
): Promise<AiAnalysisResult | null> {
  const config = detectAiConfig(options);
  if (!config) return null;

  const prompt = buildAiPrompt(reports, summary);
  const timeoutMs = options.timeoutMs ?? 30000;

  let analysis: string;
  if (config.provider === 'gemini') {
    analysis = await queryGemini(config.apiKey, config.model, prompt, timeoutMs);
  } else if (config.provider === 'anthropic') {
    analysis = await queryAnthropic(config.apiKey, config.model, prompt, timeoutMs);
  } else {
    analysis = await queryOpenAI(config.apiKey, config.model, prompt, timeoutMs);
  }

  return {
    provider: config.provider,
    model: config.model,
    analysis,
  };
}
