/**
 * Comparador de seguridad entre versiones de un paquete (ghostdeps diff <pkg>).
 * Detecta cambios bruscos entre versiones: cambio de publicador (_npmUser),
 * incorporación de scripts de instalación sospechosos, dependencias nuevas,
 * alteración de repositorios o bifurcación de mantenimiento.
 */
import { inspectInstallScripts, registryUrl, type NpmPackument } from '../clients/npm.js';
import { fetchJson } from '../clients/http.js';
import type { DiskCache } from '../clients/cache.js';
import { detectAiConfig, queryAnthropic, queryGemini, queryOpenAI, type AiAdvisorOptions } from '../ai/advisor.js';
import type { InstallScript } from '../types.js';

export interface DiffScriptChange {
  stage: string;
  from?: string;
  to?: string;
  suspicious?: boolean;
}

export interface DiffDepChange {
  name: string;
  from?: string;
  to?: string;
}

export interface PackageDiffReport {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  publisher: {
    from: string | null;
    to: string | null;
    changed: boolean;
  };
  maintainers: {
    added: string[];
    removed: string[];
  };
  installScripts: {
    added: DiffScriptChange[];
    removed: DiffScriptChange[];
    modified: DiffScriptChange[];
    hasSuspicious: boolean;
  };
  dependencies: {
    added: DiffDepChange[];
    removed: DiffDepChange[];
    modified: DiffDepChange[];
  };
  repository: {
    from: string | null;
    to: string | null;
    changed: boolean;
  };
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  alerts: string[];
  aiAnalysis?: string;
}

function parsePerson(p: unknown): string | null {
  if (!p) return null;
  if (typeof p === 'string') return p.replace(/\s*<.*$/, '').trim() || null;
  if (typeof p === 'object' && p !== null) {
    const obj = p as { name?: string; email?: string };
    return obj.name ?? obj.email ?? null;
  }
  return null;
}

function parseRepoUrl(repo: unknown): string | null {
  if (!repo) return null;
  if (typeof repo === 'string') return repo;
  if (typeof repo === 'object' && repo !== null && 'url' in repo) {
    return String((repo as { url?: unknown }).url ?? '');
  }
  return null;
}

/**
 * Función pura que calcula el diff de seguridad entre dos versiones de un packument.
 */
export function compareVersions(
  packageName: string,
  doc: NpmPackument,
  fromVer?: string,
  toVer?: string,
): PackageDiffReport {
  const versions = doc.versions ?? {};
  const time = doc.time ?? {};

  // Orden cronológico
  const chronological = Object.entries(time)
    .filter(([v]) => v !== 'created' && v !== 'modified' && versions[v] !== undefined)
    .sort(([, a], [, b]) => Date.parse(a) - Date.parse(b))
    .map(([v]) => v);

  const targetTo =
    toVer ??
    doc['dist-tags']?.latest ??
    chronological[chronological.length - 1] ??
    '';

  if (!versions[targetTo]) {
    throw new Error(`La versión destino "${targetTo}" no existe en el registro para ${packageName}`);
  }

  let targetFrom = fromVer;
  if (!targetFrom) {
    const idx = chronological.indexOf(targetTo);
    if (idx > 0) {
      targetFrom = chronological[idx - 1]!;
    } else {
      // Si es la primera versión o no está en cronología, buscar cualquier otra previa
      targetFrom = chronological.find((v) => v !== targetTo) ?? targetTo;
    }
  }

  const vFromDoc = versions[targetFrom] ?? {};
  const vToDoc = versions[targetTo] ?? {};

  // 1. Publisher
  const pubFrom = parsePerson(vFromDoc._npmUser);
  const pubTo = parsePerson(vToDoc._npmUser);
  const publisherChanged = Boolean(pubFrom && pubTo && pubFrom !== pubTo);

  // 2. Maintainers
  const parseMaint = (docPart: typeof vFromDoc): string[] => {
    const m = docPart.maintainers;
    if (!m) return [];
    const arr = Array.isArray(m) ? m : [m];
    return [...new Set(arr.map(parsePerson).filter((n): n is string => !!n))].sort();
  };
  const maintFrom = parseMaint(vFromDoc);
  const maintTo = parseMaint(vToDoc);
  const maintAdded = maintTo.filter((m) => !maintFrom.includes(m));
  const maintRemoved = maintFrom.filter((m) => !maintTo.includes(m));

  // 3. Install scripts
  const scriptsFrom = (vFromDoc.scripts as Record<string, string> | undefined) ?? {};
  const scriptsTo = (vToDoc.scripts as Record<string, string> | undefined) ?? {};
  const stages = ['preinstall', 'install', 'postinstall'] as const;

  const scriptsAdded: DiffScriptChange[] = [];
  const scriptsRemoved: DiffScriptChange[] = [];
  const scriptsModified: DiffScriptChange[] = [];

  const inspTo = inspectInstallScripts(scriptsTo);
  const inspFrom = inspectInstallScripts(scriptsFrom);

  for (const st of stages) {
    const s1 = scriptsFrom[st];
    const s2 = scriptsTo[st];
    if (!s1 && s2) {
      const isSusp = inspectInstallScripts({ [st]: s2 }).suspicious;
      scriptsAdded.push({ stage: st, to: s2, suspicious: isSusp });
    } else if (s1 && !s2) {
      scriptsRemoved.push({ stage: st, from: s1 });
    } else if (s1 && s2 && s1 !== s2) {
      const isSusp = inspectInstallScripts({ [st]: s2 }).suspicious;
      scriptsModified.push({ stage: st, from: s1, to: s2, suspicious: isSusp });
    }
  }

  const hasSuspiciousScripts = inspTo.suspicious && !inspFrom.suspicious;

  // 4. Dependencies
  const depsFrom = (vFromDoc as any).dependencies ?? {};
  const depsTo = (vToDoc as any).dependencies ?? {};

  const depsAdded: DiffDepChange[] = [];
  const depsRemoved: DiffDepChange[] = [];
  const depsModified: DiffDepChange[] = [];

  const allDepKeys = new Set([...Object.keys(depsFrom), ...Object.keys(depsTo)]);
  for (const k of allDepKeys) {
    if (!depsFrom[k] && depsTo[k]) {
      depsAdded.push({ name: k, to: depsTo[k] });
    } else if (depsFrom[k] && !depsTo[k]) {
      depsRemoved.push({ name: k, from: depsFrom[k] });
    } else if (depsFrom[k] !== depsTo[k]) {
      depsModified.push({ name: k, from: depsFrom[k], to: depsTo[k] });
    }
  }

  // 5. Repository
  const repoFrom = parseRepoUrl(vFromDoc.repository ?? doc.repository);
  const repoTo = parseRepoUrl(vToDoc.repository ?? doc.repository);
  const repoChanged = Boolean(repoFrom && repoTo && repoFrom !== repoTo);

  // 6. Riesgo y Alertas
  const alerts: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

  if (publisherChanged) {
    alerts.push(`Cambio de publicador: "${pubFrom}" → "${pubTo}"`);
    riskLevel = 'medium';
  }

  if (maintAdded.length > 0) {
    alerts.push(`Nuevos mantenedores añadidos: ${maintAdded.join(', ')}`);
  }

  if (repoChanged) {
    alerts.push(`El repositorio fue modificado: "${repoFrom}" → "${repoTo}"`);
    if (riskLevel === 'low') riskLevel = 'medium';
  }

  if (scriptsAdded.length > 0 || scriptsModified.length > 0) {
    alerts.push(`Se añadieron o alteraron scripts de instalación en el ciclo de vida`);
    riskLevel = 'medium';
  }

  if (hasSuspiciousScripts) {
    alerts.push(`ALERTA: Se incorporaron scripts de instalación altamente sospechosos (descargas, shell o eval)`);
    riskLevel = 'critical';
  }

  if (publisherChanged && hasSuspiciousScripts) {
    alerts.push(`CRÍTICO: Cambio simultáneo de publicador y adición de scripts sospechosos (Patrón claro de Account Hijacking)`);
    riskLevel = 'critical';
  } else if (publisherChanged && scriptsAdded.length > 0) {
    riskLevel = 'high';
  }

  return {
    packageName,
    fromVersion: targetFrom,
    toVersion: targetTo,
    publisher: { from: pubFrom, to: pubTo, changed: publisherChanged },
    maintainers: { added: maintAdded, removed: maintRemoved },
    installScripts: {
      added: scriptsAdded,
      removed: scriptsRemoved,
      modified: scriptsModified,
      hasSuspicious: inspTo.suspicious,
    },
    dependencies: { added: depsAdded, removed: depsRemoved, modified: depsModified },
    repository: { from: repoFrom, to: repoTo, changed: repoChanged },
    riskLevel,
    alerts,
  };
}

/**
 * Consulta la API y opcionalmente la IA para analizar el diff entre versiones.
 */
export async function inspectPackageDiff(
  packageName: string,
  options: {
    from?: string;
    to?: string;
    cache?: DiskCache;
    ai?: boolean;
    aiOptions?: AiAdvisorOptions;
    timeoutMs?: number;
    retries?: number;
    userAgent?: string;
  } = {},
): Promise<PackageDiffReport> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const retries = options.retries ?? 2;
  const userAgent = options.userAgent ?? 'ghostdeps/diff';

  const { data } = await fetchJson<NpmPackument>(registryUrl(packageName), {
    timeoutMs,
    retries,
    headers: { accept: 'application/json', 'user-agent': userAgent },
  });

  const report = compareVersions(packageName, data, options.from, options.to);

  if (options.ai) {
    const aiConfig = detectAiConfig(options.aiOptions);
    if (aiConfig) {
      const prompt = `Actúa como analista de seguridad de software y malware en npm.
Analiza la siguiente diferencia entre dos versiones del paquete "${report.packageName}":
- Versión base: ${report.fromVersion}
- Versión nueva: ${report.toVersion}
- Publicador anterior: ${report.publisher.from ?? 'N/A'}
- Publicador nuevo: ${report.publisher.to ?? 'N/A'} (¿Cambió?: ${report.publisher.changed ? 'SÍ' : 'NO'})
- Scripts de ciclo de vida añadidos/modificados: ${JSON.stringify(report.installScripts, null, 2)}
- Dependencias añadidas: ${JSON.stringify(report.dependencies.added, null, 2)}
- Repositorio alterado: ${report.repository.changed ? 'SÍ' : 'NO'}
- Alertas automáticas: ${report.alerts.join('; ')}

Emite un diagnóstico forense conciso (máximo 3 párrafos en español):
1. ¿Presenta indicios de toma de control de cuenta (account hijacking) o inyección maliciosa?
2. ¿Qué riesgos específicos conllevan los cambios observados?
3. Recomendación explícita: Aceptar actualización, bloquear en lockfile con override, o reportar a npm security.`;

      try {
        let aiText: string;
        if (aiConfig.provider === 'gemini') {
          aiText = await queryGemini(aiConfig.apiKey, aiConfig.model, prompt, 30000);
        } else if (aiConfig.provider === 'anthropic') {
          aiText = await queryAnthropic(aiConfig.apiKey, aiConfig.model, prompt, 30000);
        } else {
          aiText = await queryOpenAI(aiConfig.apiKey, aiConfig.model, prompt, 30000);
        }
        report.aiAnalysis = aiText;
      } catch (err) {
        report.aiAnalysis = `(Error al consultar IA: ${(err as Error).message})`;
      }
    }
  }

  return report;
}
