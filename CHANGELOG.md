# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).

## [0.4.0] - 2026-11-25

### Añadido
- **Detección de Lifecycle Scripts sospechosos**: inspección heurística de scripts (`preinstall`, `install`, `postinstall`) para detectar descargas remotas (`curl`, `wget`), ejecución de shells (`powershell`, `cmd.exe`, `bash`), ofuscación o evaluación en memoria (`eval`, `Buffer.from`, `base64`) y acceso a credenciales (`.env`, `.ssh`). Penalización configurable (`suspiciousScripts`, -35 pts) y regla SARIF `GD011`.
- **Soporte completo para `pnpm-lock.yaml`**: resolución recursiva de dependencias transitivas deduplicadas respetando `--depth` y árbol de procedencia (`via`). Soporta ahora los 3 grandes del ecosistema: `npm`, `yarn` y `pnpm`.
- **Reporte visual interactivo y autónomo en HTML (`--html` o `-f html`)**: informe web 100% self-contained (cero CDNs externas o dependencias remotas) con filtrado instantáneo por nivel de riesgo, búsqueda reactiva, visualización de scripts de instalación y enlaces de auditoría.
- **Subcomando de remediación automática (`ghostdeps fix`)**: genera e inyecta `overrides` (npm), `resolutions` (yarn) o `pnpm.overrides` (pnpm) en `package.json` para neutralizar dependencias transitivas vulnerables o críticas. Admite `--dry-run`, `--no-backup` y `--override <pkg=ver>`.
- **Inspector forense de diferencias entre versiones (`ghostdeps diff <paquete>`)**: comparativa de seguridad entre versiones de un paquete en npm. Alerta si cambió de publicador (`_npmUser`), adición de scripts sospechosos, nuevos mantenedores o cambios abruptos de repositorio. Admite análisis forense asistido por IA (`--ai`).
- **GitHub Action oficial (`action.yml`)**: permite integrar GhostDeps en flujos de CI/CD de GitHub (`uses: efraindrummer/ghostdeps@v0.4.0`) con soporte nativo para reportes en Markdown en el PR Summary y SARIF para GitHub Code Scanning.

## [0.3.0] - 2026-11-25

### Añadido
- **Asesor de Ciberseguridad con IA (`--ai`)**: Integración nativa sin dependencias pesadas con **Google Gemini**, **Anthropic Claude** y **OpenAI ChatGPT**. Detecta automáticamente claves de API (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) y genera recomendaciones concretas de migración, alternativas seguras y plan de mitigación priorizado.
- **Servidor MCP (Model Context Protocol) (`--mcp`)**: Permite a agentes de IA (Claude Desktop, Cursor, Gemini CLI, etc.) invocar a GhostDeps como una herramienta (`ghostdeps_audit`) mediante stdio (JSON-RPC 2.0).
- Flags `--ai-provider <gemini|anthropic|openai>` y `--ai-model <model>`.

## [0.2.0] - 2026-11-24

### Añadido
- **Dependencias transitivas** (`--transitive`, `--depth <n>`) leyendo `package-lock.json` / `npm-shrinkwrap.json` (lockfile v2/v3) y `yarn.lock` (Yarn v1). Cada transitiva muestra el camino más corto por el que llega (`↳ express › debug`).
- **Formato SARIF 2.1.0** (`--format sarif`): exportación estándar para integración directa con **GitHub Code Scanning** (`github/codeql-action/upload-sarif`), GitLab Security y visores SARIF, clasificando riesgos en reglas tipadas (`GD001`–`GD010`).
- **Archivo de configuración**: `.ghostdepsrc.json`, `.ghostdepsrc` o clave `"ghostdeps"` en `package.json` (o `--config <file>`). Permite ajustar pesos, umbrales, `ignore`, `failUnder`, `dev`, `transitive`, `depth` y `concurrency`. Validación estricta con mensajes claros y JSON Schema para autocompletado (`schema/ghostdepsrc.schema.json`).
- **Ignorar paquetes**: `--ignore a,b,"@types/*"` y `"ignore"` en la configuración (admite `*`).
- **Salida Markdown** (`--format markdown`) para comentarios de PR y `$GITHUB_STEP_SUMMARY`.
- `--format table|json|markdown|sarif` (`--json` se mantiene como atajo) y `-o, --output <file>`.
- Workflow de CI (Linux/Windows/macOS × Node 20/22/24) y análisis de las propias dependencias del proyecto.

### Cambiado
- `computeScore` y `categorize` aceptan umbrales personalizados.
- El JSON incluye `config`, `thresholds`, `ignored`, y por paquete `depth` y `via`.

## [0.1.0] - 2026-11-19

### Añadido
- MVP: análisis de `dependencies`/`devDependencies`, cliente npm y GitHub, Health Score explicable, tabla con colores, `--json`, `--fail-under`, `--concurrency`, caché con TTL, manejo de rate limits y reintentos.
