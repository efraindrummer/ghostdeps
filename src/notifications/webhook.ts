/**
 * Notificador de alertas vía Webhooks (Slack, Discord y genéricos).
 * Permite enviar resúmenes ejecutivos a canales de seguridad en CI/CD.
 */
import type { Summary } from '../types.js';

export interface WebhookNotificationOptions {
  webhookUrl: string;
  projectName: string | null;
  version: string;
  summary: Summary;
  criticalPackages: Array<{ name: string; score: number; mainAlert?: string }>;
  failUnder?: number;
  failingCount?: number;
  timeoutMs?: number;
}

export async function sendWebhookNotification(opts: WebhookNotificationOptions): Promise<boolean> {
  const { webhookUrl, projectName, version, summary, criticalPackages, failUnder, failingCount } = opts;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const projectTitle = projectName ? `Proyecto: ${projectName}` : 'Auditoría GhostDeps';

  const hasIssues = summary.critical > 0 || (failingCount !== undefined && failingCount > 0);
  const statusEmoji = hasIssues ? '🚨' : '✅';
  const colorHex = hasIssues ? '#ef4444' : '#10b981';

  let body: Record<string, unknown>;

  if (webhookUrl.includes('hooks.slack.com')) {
    // Formato Slack Blocks
    const critList =
      criticalPackages.length > 0
        ? criticalPackages
            .slice(0, 8)
            .map((p) => `• *${p.name}* (Score: ${p.score}) — ${p.mainAlert ?? 'Riesgo alto'}`)
            .join('\n')
        : 'Ningún paquete crítico detectado.';

    body = {
      text: `${statusEmoji} GhostDeps v${version}: ${projectTitle}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${statusEmoji} GhostDeps v${version} — ${projectName ?? 'Auditoría'}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Total:* ${summary.total}` },
            { type: 'mrkdwn', text: `*🔴 Críticos:* ${summary.critical}` },
            { type: 'mrkdwn', text: `*🟡 Precaución:* ${summary.caution}` },
            { type: 'mrkdwn', text: `*🟢 Saludables:* ${summary.healthy}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Detalle de Dependencias en Riesgo:*\n${critList}`,
          },
        },
      ],
    };
  } else if (webhookUrl.includes('discord.com/api/webhooks')) {
    // Formato Discord Embeds
    const critList =
      criticalPackages.length > 0
        ? criticalPackages
            .slice(0, 8)
            .map((p) => `• **${p.name}** (Score: ${p.score}) — ${p.mainAlert ?? 'Riesgo alto'}`)
            .join('\n')
        : 'Ningún paquete crítico detectado.';

    body = {
      content: `${statusEmoji} **GhostDeps Security Alert** — ${projectName ?? 'Auditoría'}`,
      embeds: [
        {
          title: `Resultados de Auditoría (v${version})`,
          color: hasIssues ? 0xef4444 : 0x10b981,
          fields: [
            { name: 'Total', value: String(summary.total), inline: true },
            { name: '🔴 Críticos', value: String(summary.critical), inline: true },
            { name: '🟡 Precaución', value: String(summary.caution), inline: true },
            { name: '🟢 Saludables', value: String(summary.healthy), inline: true },
            { name: 'Dependencias Críticas', value: critList, inline: false },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };
  } else {
    // Formato JSON Genérico
    body = {
      tool: 'ghostdeps',
      version,
      projectName,
      timestamp: new Date().toISOString(),
      summary,
      failUnder: failUnder ?? null,
      failingCount: failingCount ?? 0,
      criticalPackages,
    };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
