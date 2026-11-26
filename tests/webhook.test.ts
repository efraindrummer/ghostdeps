import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendWebhookNotification } from '../src/notifications/webhook.js';
import type { Summary } from '../src/types.js';

describe('sendWebhookNotification', () => {
  const summary: Summary = {
    total: 10,
    healthy: 8,
    caution: 1,
    critical: 1,
    notEvaluable: 0,
    errors: 0,
  };

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('formatea y despacha webhook de Slack correctamente', async () => {
    const ok = await sendWebhookNotification({
      webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXXX',
      projectName: 'my-app',
      version: '0.5.0',
      summary,
      criticalPackages: [{ name: 'evil-pkg', score: 10, mainAlert: 'Script malicioso' }],
    });

    expect(ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const callArgs = (globalThis.fetch as any).mock.calls[0];
    expect(callArgs[0]).toBe('https://hooks.slack.com/services/T00/B00/XXXX');
    const sentBody = JSON.parse(callArgs[1].body);
    expect(sentBody.blocks).toBeDefined();
    expect(sentBody.text).toContain('GhostDeps');
    expect(sentBody.text).toContain('my-app');
  });

  it('formatea y despacha webhook de Discord correctamente', async () => {
    const ok = await sendWebhookNotification({
      webhookUrl: 'https://discord.com/api/webhooks/123/xyz',
      projectName: 'my-app',
      version: '0.5.0',
      summary,
      criticalPackages: [{ name: 'evil-pkg', score: 10, mainAlert: 'Script malicioso' }],
    });

    expect(ok).toBe(true);
    const callArgs = (globalThis.fetch as any).mock.calls[0];
    const sentBody = JSON.parse(callArgs[1].body);
    expect(sentBody.embeds).toBeDefined();
    expect(sentBody.embeds[0].title).toContain('Resultados de Auditoría');
  });

  it('devuelve false cuando fetch falla o lanza error', async () => {
    (globalThis.fetch as any).mockRejectedValueOnce(new Error('Network error'));
    const ok = await sendWebhookNotification({
      webhookUrl: 'https://example.com/webhook',
      projectName: 'test',
      version: '0.5.0',
      summary,
      criticalPackages: [],
    });
    expect(ok).toBe(false);
  });
});
