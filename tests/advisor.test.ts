import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAiPrompt,
  detectAiConfig,
  queryAnthropic,
  queryGemini,
  queryOpenAI,
} from '../src/ai/advisor.js';
import type { PackageReport, Summary } from '../src/types.js';

describe('detectAiConfig', () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('detecta Gemini por variable de entorno', () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const config = detectAiConfig();
    expect(config).toEqual({
      provider: 'gemini',
      apiKey: 'test-gemini-key',
      model: 'gemini-1.5-flash',
    });
  });

  it('detecta Anthropic por variable de entorno', () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    delete process.env.OPENAI_API_KEY;

    const config = detectAiConfig();
    expect(config).toEqual({
      provider: 'anthropic',
      apiKey: 'test-anthropic-key',
      model: 'claude-3-5-haiku-20241022',
    });
  });

  it('detecta OpenAI por variable de entorno', () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const config = detectAiConfig();
    expect(config).toEqual({
      provider: 'openai',
      apiKey: 'test-openai-key',
      model: 'gpt-4o-mini',
    });
  });

  it('devuelve null si no hay keys configuradas', () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    expect(detectAiConfig()).toBeNull();
  });

  it('respeta proveedor y modelo personalizado si se especifican', () => {
    const config = detectAiConfig({
      provider: 'gemini',
      apiKey: 'custom-key',
      model: 'gemini-2.5-pro',
    });
    expect(config).toEqual({
      provider: 'gemini',
      apiKey: 'custom-key',
      model: 'gemini-2.5-pro',
    });
  });
});

describe('buildAiPrompt', () => {
  it('incluye solo paquetes con score < 70 y sus detalles', () => {
    const reports: PackageReport[] = [
      {
        name: 'request',
        registryName: 'request',
        spec: '^2.88.2',
        kind: 'dependencies',
        depth: 1,
        via: [],
        status: 'evaluated',
        reason: null,
        npm: null,
        github: null,
        signals: {
          daysSinceLastCommit: 2400,
          daysSinceLastPublish: 2400,
          publishGapDays: 100,
          archived: false,
          deprecated: true,
          activeMaintainers: 0,
          unansweredIssues: 19,
          repoRedirected: false,
          maintainersAdded: [],
          newPublisher: false,
        },
        result: {
          score: 10,
          category: 'critical',
          penalties: [{ id: 'deprecated', points: 40, message: 'Paquete deprecated' }],
          mainAlert: { id: 'deprecated', points: 40, message: 'Paquete deprecated' },
        },
      },
      {
        name: 'express',
        registryName: 'express',
        spec: '^4.21.0',
        kind: 'dependencies',
        depth: 1,
        via: [],
        status: 'evaluated',
        reason: null,
        npm: null,
        github: null,
        signals: null,
        result: {
          score: 100,
          category: 'healthy',
          penalties: [],
          mainAlert: null,
        },
      },
    ];

    const summary: Summary = {
      total: 2,
      healthy: 1,
      caution: 0,
      critical: 1,
      notEvaluable: 0,
      errors: 0,
    };

    const prompt = buildAiPrompt(reports, summary);
    expect(prompt).toContain('request');
    expect(prompt).toContain('deprecated');
    // express (score 100) no debe estar en la lista de paquetes problemáticos
    expect(prompt).not.toContain('"name": "express"');
  });
});

describe('AI API Handlers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('queryGemini parsea la respuesta exitosa', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Gemini security recommendation' }] } }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await queryGemini('key', 'gemini-1.5-flash', 'prompt');
    expect(res).toBe('Gemini security recommendation');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('queryAnthropic parsea la respuesta exitosa', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Claude security recommendation' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await queryAnthropic('key', 'claude-3-5-haiku-20241022', 'prompt');
    expect(res).toBe('Claude security recommendation');
  });

  it('queryOpenAI parsea la respuesta exitosa', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ChatGPT security recommendation' } }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await queryOpenAI('key', 'gpt-4o-mini', 'prompt');
    expect(res).toBe('ChatGPT security recommendation');
  });
});
