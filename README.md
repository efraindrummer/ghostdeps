# 👻 GhostDeps

[![CI](https://github.com/<tu-usuario>/ghostdeps/actions/workflows/ci.yml/badge.svg)](https://github.com/<tu-usuario>/ghostdeps/actions/workflows/ci.yml)
![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)

> Detecta **dependencias fantasma** en tu `package.json`: paquetes abandonados, con *bus factor* bajo o con señales de posible secuestro (hijacking), evaluando la **salud social y de mantenimiento** del repositorio origen — no solo CVEs.

Los escáneres de vulnerabilidades te avisan cuando ya existe un CVE. GhostDeps intenta avisarte **antes**: cuando una dependencia lleva años sin commits, depende de una sola persona, está archivada/deprecated o cambió de manos de forma sospechosa (el patrón de `event-stream`, `ua-parser-js` o `xz`).

```
👻 GhostDeps v0.5.0 · mi-app
┌─────────────────────────────┬───────┬──────────────────┬───────────────┬──────────────────────────────────────────────┐
│ Paquete                     │ Score │ Días últ. commit │ Mant. activos │ Alerta principal                             │
├─────────────────────────────┼───────┼──────────────────┼───────────────┼──────────────────────────────────────────────┤
│ left-pad                    │ 0     │ 2806             │ 0             │ Sin commits desde hace 2806 días (~93 meses) │
│ request                     │ 0     │ 2472             │ 0             │ Sin commits desde hace 2472 días (~82 meses) │
│ is-promise                  │ 30    │ 1580             │ 0             │ Sin commits desde hace 1580 días (~52 meses) │
│ cli-table3                  │ 65    │ 218              │ 1             │ Bus factor = 1 (un solo mantenedor activo)   │
│ emoji-regex                 │ 80    │ 69               │ 1             │ Bus factor = 1 (un solo mantenedor activo)   │
│ ↳ cli-table3 › string-width │       │                  │               │                                              │
│ express                     │ 100   │ 16               │ 43            │ Sin alertas                                  │
│ internal-pkg                │ N/E   │ —                │ —             │ No evaluable: Repo en GitLab: solo GitHub…   │
└─────────────────────────────┴───────┴──────────────────┴───────────────┴──────────────────────────────────────────────┘

Resumen (7 dependencias):  ● Crítico/Fantasma (<40): 3   ● Precaución (40-69): 1   ● Saludable (≥70): 2   ○ No evaluable: 1
```

## Índice

- [Características](#características)
- [Instalación](#instalación)
- [Guía de uso](#guía-de-uso)
  - [Inicio rápido](#inicio-rápido-3-pasos) · [Opciones](#opciones) · [Casos de uso](#casos-de-uso-comunes)
  - [Dependencias transitivas](#dependencias-transitivas) · [Configuración](#archivo-de-configuración)
  - [Formatos de salida](#formatos-de-salida) · [Cómo leer la tabla](#cómo-leer-la-tabla) · [CI](#integración-continua-ci)
  - [Solución de problemas](#solución-de-problemas) · [FAQ](#preguntas-frecuentes)
- [Cómo se calcula el Health Score](#cómo-se-calcula-el-health-score)
- [Decisiones de diseño](#decisiones-tomadas-ante-ambigüedades) · [Limitaciones](#limitaciones-conocidas)
- [Desarrollo](#desarrollo) · [Roadmap](#roadmap) · [Contribuir](#contribuir)

## Características

| | |
|---|---|
| 🩺 **Health Score explicable (0–100)** | Cada penalización aplicada viene con sus puntos y un mensaje legible. |
| 🪦 **Abandono** | Último commit en la rama por defecto, repo archivado, paquete `deprecated`, tiempo sin publicar. |
| 🚌 **Bus factor** | Autores únicos de commits en los últimos 12 meses (sin bots). |
| 🕵️ **Señales de secuestro** | Redirect del repo, maintainers nuevos en npm, publicador nuevo, "resurrección" tras años sin publicar. |
| 🌳 **Transitivas** | `--transitive` lee `package-lock.json` y muestra por qué ruta llega cada paquete. |
| ⚙️ **Configurable** | `.ghostdepsrc.json`: pesos, umbrales, ignorados y defaults del proyecto, con JSON Schema. |
| 📄 **3 formatos** | Tabla con colores, JSON para integraciones y Markdown para PRs / `$GITHUB_STEP_SUMMARY`. |
| 🚦 **Listo para CI** | `--fail-under`, exit codes documentados y salida limpia en stdout. |
| 🛡️ **Robusto** | Caché en disco con TTL, reintentos con backoff, manejo de rate limits, timeouts y fallos aislados por paquete. |

## Instalación

Requiere **Node.js ≥ 20**.

```bash
# Sin instalar
npx ghostdeps

# Global
npm i -g ghostdeps

# Como dependencia de desarrollo del proyecto
npm i -D ghostdeps

# Desde el código fuente
git clone https://github.com/<tu-usuario>/ghostdeps && cd ghostdeps
npm install && npm run build
node dist/cli.js --path ../../mi-proyecto
```

### Token de GitHub (muy recomendado)

Sin token la API de GitHub permite **60 peticiones/hora**; GhostDeps usa ~3–4 por paquete, así que solo alcanza para ~15 paquetes. Con token: 5000/h.

1. Crea un *fine-grained token* **sin permisos adicionales** (solo lectura de repos públicos) en https://github.com/settings/tokens
2. Expórtalo:

```bash
export GITHUB_TOKEN=github_pat_xxx          # bash/zsh
$env:GITHUB_TOKEN = "github_pat_xxx"        # PowerShell
```

También se acepta `GH_TOKEN` (compatible con GitHub CLI y GitHub Actions).

## Guía de uso

### Inicio rápido (3 pasos)

```bash
# 1. Configura tu token de GitHub (ver sección anterior)
export GITHUB_TOKEN=github_pat_xxx

# 2. Entra a tu proyecto (donde está el package.json)
cd mi-proyecto

# 3. Ejecuta el análisis
npx ghostdeps
```

Verás el progreso (`Analizando 3/20: lodash`) y luego la tabla ordenada de **peor a mejor** score, seguida del resumen por categoría.

### Opciones

```bash
ghostdeps [opciones]
ghostdeps --help      # ayuda completa con ejemplos
ghostdeps --version
```

| Flag | Descripción | Default |
|---|---|---|
| `-p, --path <dir>` | Directorio con el `package.json` | directorio actual |
| `--config <file>` | Archivo de configuración explícito | autodetección |
| `-d, --dev` | Incluye también `devDependencies` | `false` |
| `-t, --transitive` | Incluye dependencias transitivas (requiere `package-lock.json`, `yarn.lock` o `pnpm-lock.yaml`) | `false` |
| `--depth <n>` | Profundidad máxima con `--transitive` (1 = solo directas) | sin límite |
| `-i, --ignore <lista>` | Paquetes a omitir, separados por coma; admite `*` | — |
| `-f, --format <fmt>` | `table`, `json`, `markdown`, `sarif` o `html` | `table` |
| `--json` | Atajo de `--format json` | `false` |
| `--html [file]` | Genera informe interactivo en HTML (atajo de `--format html`) | `false` |
| `-o, --output <file>` | Escribe el informe en un archivo (sin colores ANSI) | stdout |
| `--fail-under <score>` | Exit code `1` si algún paquete **evaluado** tiene score menor | — |
| `-c, --concurrency <n>` | Paquetes analizados en paralelo (1–32) | `4` |
| `--explain` | Desglose de penalizaciones de cada paquete | `false` |
| `--ai` | Asesor de ciberseguridad con IA (reemplazos y plan de mitigación) | `false` |
| `--ai-provider <prov>` | Proveedor de IA: `gemini`, `anthropic` u `openai` | autodetección |
| `--ai-model <model>` | Modelo específico de IA a consultar | por defecto del proveedor |
| `--mcp` | Inicia el servidor MCP (Model Context Protocol) sobre stdio | `false` |
| `--allow-licenses <lics>` | Lista blanca de licencias permitidas separadas por coma | sin filtro |
| `--deny-licenses <lics>` | Lista negra de licencias denegadas (ej. `GPL-3.0,AGPL-3.0`) | sin filtro |
| `--webhook <url>` | URL de Webhook (Slack, Discord o HTTP) para enviar alertas | — |
| `--no-cache` | No lee ni escribe la caché en disco | caché activa |
| `--cache-ttl <horas>` | TTL de la caché | `24` |
| `--timeout <ms>` | Timeout por petición | `15000` |
| `--max-wait <seg>` | Espera máxima ante rate limit antes de abortar | `60` |

**Códigos de salida:** `0` OK · `1` `--fail-under` incumplido · `2` error fatal (package.json o configuración inválidos, lockfile ausente con `--transitive`, argumentos incorrectos).

**Precedencia:** flags de CLI > archivo de configuración > valores por defecto.

### Casos de uso comunes

**Analizar el proyecto actual (solo `dependencies`):**
```bash
ghostdeps
```

**Incluir `devDependencies`** (se marcan con `(dev)` en la tabla):
```bash
ghostdeps --dev
```

**Analizar otro directorio:**
```bash
ghostdeps --path ../otro-proyecto
```

**Omitir paquetes** (repetible o separado por comas):
```bash
ghostdeps --ignore left-pad --ignore "@types/*,eslint-*"
```

**Ver por qué un paquete tiene cierto score:**
```bash
ghostdeps --explain
```
```
left-pad → 0/100 (Crítico/Fantasma)
  repo: stevemao/left-pad → left-pad/left-pad
   -45  Sin commits desde hace 2806 días (~93 meses)
   -40  Repositorio archivado (solo lectura)
   -40  Paquete marcado como deprecated en npm
   -20  Ningún mantenedor activo en 12 meses
   -10  El repo redirige a otro owner/nombre (posible transferencia)
```

**Forzar datos frescos** (ignora la caché de 24 h):
```bash
ghostdeps --no-cache
```

**Proyectos grandes con token** (más paralelismo y más paciencia con el rate limit):
```bash
ghostdeps --dev --concurrency 8 --max-wait 300
```

**Monorepo con workspaces** (un análisis por paquete):
```bash
for dir in packages/*/; do echo "== $dir"; npx ghostdeps --path "$dir"; done
```
```powershell
Get-ChildItem packages -Directory | ForEach-Object { "== $($_.Name)"; npx ghostdeps --path $_.FullName }
```

### Dependencias transitivas

La mayoría de los incidentes de supply chain ocurren en dependencias que **no** instalaste directamente. Con `--transitive`, GhostDeps lee `package-lock.json` (o `npm-shrinkwrap.json` o `yarn.lock`) y analiza todo el árbol instalado:

```bash
ghostdeps --transitive                 # todo el árbol
ghostdeps --transitive --depth 3       # hasta 3 niveles (1 = directas)
ghostdeps --transitive --dev           # incluye el árbol de las devDependencies
```

Cada transitiva aparece con la **ruta más corta** por la que llega a tu proyecto, para que sepas qué dependencia directa la arrastra:

```
│ emoji-regex                 │ 80    │ 69 │ 1 │ Bus factor = 1 (un solo mantenedor activo) │
│ ↳ cli-table3 › string-width │       │    │   │                                            │
```

Cómo funciona:
- Reproduce la resolución de Node (`node_modules` anidados y *hoisting*) sobre el lockfile y recorre el grafo en anchura.
- Cada paquete se analiza **una sola vez** aunque aparezca varias veces en el árbol (se deduplica por nombre).
- Los paquetes instalados desde git o `file:` se marcan como *No evaluable*; los *workspaces* (`link: true`) no se recorren.
- Soporta `package-lock.json` (npm ≥ 7 v2/v3), `yarn.lock` (Yarn v1 y Yarn Berry v2/v3/v4) y `pnpm-lock.yaml` (pnpm v5/v6/v9).

> [!TIP]
> Un árbol típico tiene cientos de paquetes (~3 peticiones a GitHub cada uno). Usa **siempre** `GITHUB_TOKEN`, y combina `--depth` e `ignore` para acotar. La caché hace que las ejecuciones siguientes sean casi instantáneas.

### Archivo de configuración

Guarda las preferencias del proyecto en un archivo para no repetir flags (y versionarlas). GhostDeps busca, en orden:

1. El archivo indicado con `--config <file>`.
2. `.ghostdepsrc.json` o `.ghostdepsrc` en el directorio analizado.
3. La clave `"ghostdeps"` del `package.json`.

```jsonc
// .ghostdepsrc.json
{
  "$schema": "https://unpkg.com/schema/ghostdepsrc.schema.json",
  "ignore": ["@types/*", "my-internal-*"],   // nombres o patrones con *
  "failUnder": 40,
  "dev": true,
  "transitive": true,
  "depth": 3,
  "concurrency": 6,
  "thresholds": { "healthy": 75, "caution": 45 },
  "weights": {
    "archived": 50,
    "busFactor": { "one": 10 },               // los no indicados mantienen su default
    "abandonment": [                           // los tramos se reemplazan completos
      { "threshold": 1095, "points": 50 },
      { "threshold": 365, "points": 25 }
    ]
  }
}
```

O dentro del `package.json`:

```json
{
  "name": "mi-app",
  "ghostdeps": { "ignore": ["left-pad"], "failUnder": 40 }
}
```

| Clave | Tipo | Descripción |
|---|---|---|
| `ignore` | `string[]` | Paquetes a omitir (admite `*`). Se suman a los de `--ignore`. |
| `failUnder` | `0–100` | Igual que `--fail-under`. |
| `dev` / `transitive` | `boolean` | Igual que `--dev` / `--transitive`. |
| `depth` | `1–100` | Igual que `--depth`. |
| `concurrency` | `1–32` | Igual que `--concurrency`. |
| `thresholds` | `{ healthy, caution }` | Umbrales de las categorías (`caution ≤ healthy`). |
| `weights` | objeto | Pesos del scoring (ver [tabla de pesos](#cómo-se-calcula-el-health-score)). Claves: `archived`, `deprecated`, `abandonment`, `stalePublish`, `busFactor`, `unansweredIssues`, `repoRedirect`, `maintainersChanged`, `newPublisher`, `hijackPattern`, `dormantRevivalDays`. |

La validación es estricta: una clave mal escrita o un valor fuera de rango aborta con un mensaje claro (exit `2`), por ejemplo:

```
✖ .ghostdepsrc.json: clave(s) desconocida(s) en weights: archivd. Permitidas: archived, deprecated, …
```

Con la propiedad `$schema`, VS Code y otros editores ofrecen **autocompletado y validación** mientras editas. Hay un ejemplo completo en [`examples/.ghostdepsrc.json`](examples/.ghostdepsrc.json) y el esquema en [`schema/ghostdepsrc.schema.json`](schema/ghostdepsrc.schema.json).

### Asesor de Ciberseguridad con IA (`--ai`)

GhostDeps integra conexión nativa (sin SDKs pesados) con **Google Gemini**, **Anthropic Claude** y **OpenAI ChatGPT**.

Al activar `--ai`, el motor analiza las dependencias con puntuación baja o en riesgo y consulta al modelo de IA para generar:
1. **Diagnóstico ejecutivo:** Evaluación del nivel de exposición ante ataques a la cadena de suministro.
2. **Reemplazos concretos:** Alternativas activas, mantenidas y seguras (o APIs nativas de Node.js como `fetch`, `crypto`, etc.).
3. **Plan de mitigación:** Instrucciones paso a paso (ej. `overrides` en `package.json` para transitivas, o refactorización).

```bash
# Exporta tu clave favorita (autodetección inteligente)
export GEMINI_API_KEY="AIzaSy..."          # Gemini (por defecto: gemini-1.5-flash)
# o bien:
export ANTHROPIC_API_KEY="sk-ant-..."      # Claude (por defecto: claude-3-5-haiku)
# o bien:
export OPENAI_API_KEY="sk-proj-..."        # OpenAI (por defecto: gpt-4o-mini)

# Ejecutar auditoría con asesoría de IA
ghostdeps --ai

# Elegir proveedor o modelo específico
ghostdeps --ai --ai-provider anthropic --ai-model claude-3-5-sonnet-20241022
ghostdeps --ai --format markdown -o informe-con-ia.md
```

### Servidor MCP para Agentes de IA (`--mcp`)

GhostDeps implementa el estándar abierto **Model Context Protocol (MCP)** sobre `stdio` (JSON-RPC 2.0). Esto permite que agentes como **Claude Desktop**, **Cursor**, **Gemini CLI** o cualquier cliente MCP invoquen a GhostDeps directamente como una herramienta (`ghostdeps_audit`).

#### Configuración en Claude Desktop o Cursor
En tu archivo de configuración MCP (ej. `claude_desktop_config.json` o `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ghostdeps": {
      "command": "npx",
      "args": ["-y", "@efraindrummer/ghostdeps", "--mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_..."
      }
    }
  }
}
```

Una vez configurado, tu agente de IA puede auditar proyectos automáticamente cuando se lo pidas en lenguaje natural:
> *"Revisa las dependencias de este repositorio con GhostDeps y dime cuáles tienen riesgo de abandono o bus factor bajo."*

### Formatos de salida

| Formato | Uso | Ejemplo |
|---|---|---|
| `table` (default) | Terminal, con colores | `ghostdeps` |
| `json` | Integraciones, scripts, dashboards | `ghostdeps --json > report.json` |
| `markdown` | Comentarios de PR, `$GITHUB_STEP_SUMMARY`, wikis | `ghostdeps -f markdown -o ghostdeps.md` |
| `html` | Reporte visual interactivo y autónomo para CI / auditorías | `ghostdeps --html reporte.html` |
| `sarif` | GitHub Code Scanning / Security alerts | `ghostdeps -f sarif -o ghostdeps.sarif` |

En todos los formatos, el informe va a **stdout** (o al archivo de `-o`) y los avisos/progreso a **stderr**, así que se puede redirigir o encadenar sin problemas.

#### JSON

```bash
ghostdeps --json > ghostdeps-report.json

# Solo los paquetes críticos
ghostdeps --json | jq -r '.packages[] | select(.result.category=="critical") | "\(.name)\t\(.result.score)\t\(.result.mainAlert.message)"'

# Transitivas problemáticas y quién las arrastra
ghostdeps --json -t | jq -r '.packages[] | select(.kind=="transitive" and .result.score < 40) | "\(.name) ← \(.via | join(" › "))"'
```

Estructura (resumida):

```jsonc
{
  "tool": "ghostdeps",
  "version": "0.2.0",
  "generatedAt": "2026-11-24T14:47:50.000Z",
  "manifest": "/ruta/package.json",
  "config": "/ruta/.ghostdepsrc.json",       // null si no hay
  "options": { "dev": false, "transitive": true, "depth": 3, "failUnder": 40, "authenticated": true },
  "thresholds": { "healthy": 70, "caution": 40 },
  "summary": { "total": 7, "healthy": 6, "caution": 1, "critical": 0, "notEvaluable": 0, "errors": 0 },
  "ignored": ["@colors/colors"],
  "failUnder": { "threshold": 40, "failing": [] },
  "packages": [
    {
      "name": "emoji-regex",
      "registryName": "emoji-regex",
      "spec": "10.4.0",
      "kind": "transitive",                 // dependencies | devDependencies | transitive
      "depth": 3,                           // 1 = directa
      "via": ["cli-table3", "string-width"],
      "status": "evaluated",                // evaluated | not-evaluable | error
      "reason": null,                       // motivo si no es "evaluated"
      "npm":    { "latestVersion": "…", "deprecated": null, "latestPublisher": "…", "maintainersChange": { "added": [], "removed": [] } },
      "github": { "fullName": "…", "redirected": false, "archived": false, "lastCommitAt": "…", "activeMaintainers": 1, "unansweredIssues": 4 },
      "signals": { "daysSinceLastCommit": 69, "activeMaintainers": 1 },
      "result": {
        "score": 80,
        "category": "healthy",              // healthy | caution | critical
        "penalties": [ { "id": "bus-factor", "points": 15, "message": "Bus factor = 1 (un solo mantenedor activo)" } ],
        "mainAlert": { "id": "bus-factor", "points": 15, "message": "…" }
      }
    }
  ]
}
```

IDs de penalización: `archived`, `deprecated`, `abandoned`, `stale-publish`, `bus-factor`, `unanswered-issues`, `repo-redirect`, `maintainers-changed`, `new-publisher`, `hijack-pattern`.

#### Markdown

Genera una tabla GFM con iconos por categoría, aviso de `--fail-under` (alertas `[!CAUTION]` / `[!TIP]`), la ruta de las transitivas y un desglose plegable (`<details>`) de penalizaciones. Ideal para pegar en un PR o publicar en el resumen del job:

```bash
ghostdeps --format markdown >> "$GITHUB_STEP_SUMMARY"
```

#### SARIF (GitHub Code Scanning)

Genera un informe estándar SARIF 2.1.0 listo para integrarse en la pestaña **Security > Code scanning alerts** de GitHub:

```bash
ghostdeps --transitive --format sarif -o ghostdeps.sarif
```

Reglas SARIF incluidas:
- `GD001`: Repositorio archivado (`error`)
- `GD002`: Paquete deprecated (`error`)
- `GD003`: Repositorio abandonado sin commits (`error`)
- `GD004`: Bus factor crítico (`warning`)
- `GD005`: Issues desatendidos (`note`)
- `GD006`: Redirección/transferencia de repositorio (`warning`)
- `GD007`: Cambios de maintainers en npm (`warning`)
- `GD008`: Publicador nuevo no habitual (`warning`)
- `GD009`: Patrón combinado de secuestro/hijacking (`error`)
- `GD010`: Publicación desactualizada en npm (`note`)
- `GD011`: Script de ciclo de vida de instalación potencialmente peligroso (`error`)
- `GD012`: Posible intento de typosquatting o suplantación de paquete popular (`error`)
- `GD013`: Infracción de compliance legal o política de licencias permitidas/denegadas (`warning`)

#### Reporte Visual Autónomo en HTML (`--html`)

Genera un reporte web 100% self-contained (sin dependencias externas ni fuentes en la nube, ideal para entornos air-gapped o artefactos de CI):

```bash
ghostdeps --transitive --html reporte-seguridad.html
```

Incluye:
- **Filtrado reactivo instantáneo:** Botones para filtrar por Crítico, Precaución, Saludable o solo dependencias con Lifecycle Scripts.
- **Buscador interactivo:** Filtra en tiempo real por nombre de paquete o alertas.
- **Acordeón de detalles:** Al hacer clic en cualquier fila, se expanden penalizaciones exactas, comandos ejecutados en `postinstall`, trazabilidad de transitivas y enlaces directos a npm y GitHub.

### Remediación Automática (`ghostdeps fix`)

Aísla o actualiza dependencias transitivas vulnerables o críticas inyectando resoluciones forzadas en tu `package.json`:
- **npm:** genera bloque `overrides`
- **yarn:** genera bloque `resolutions`
- **pnpm:** genera bloque `pnpm.overrides`

```bash
# Vista previa sin modificar archivos
ghostdeps fix --dry-run

# Aplicar automáticamente overrides propuestos por el escáner (crea package.json.bak)
ghostdeps fix

# Inyectar un override manual específico
ghostdeps fix --override "vulnerable-dep=^2.0.4"
```

### Inspección Forense de Versiones (`ghostdeps diff <paquete>`)

Permite auditar qué cambió exactamente entre dos versiones publicadas en npm de cualquier paquete, detectando cambios bruscos o patrones de secuestro de cuentas (account hijacking):

```bash
# Comparar la última versión con la inmediata anterior
ghostdeps diff event-stream

# Comparar versiones específicas
ghostdeps diff event-stream --from 3.3.5 --to 3.3.6

# Auditoría asistida por IA
ghostdeps diff ua-parser-js --from 0.7.28 --to 0.7.29 --ai
```

Detecta y alerta sobre:
- Cambio de publicador (`_npmUser`)
- Modificaciones en scripts de instalación (`preinstall`, `install`, `postinstall`)
- Nuevos mantenedores añadidos o dados de baja
- Nuevas dependencias agregadas
- Alteración de URL de repositorio o redirecciones

### GitHub Action Oficial (`action.yml`)

Puedes integrar GhostDeps directamente en tus workflows de GitHub Actions:

```yaml
# .github/workflows/security.yml
name: GhostDeps Security Audit

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run GhostDeps Audit
        uses: efraindrummer/ghostdeps@v0.5.0
        with:
          fail-under: '60'
          transitive: 'true'
          format: 'markdown'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Git Pre-commit Hook (`ghostdeps hook`)

Instala un guardia de seguridad local en tu repositorio para que ningún desarrollador cometa por error código con dependencias críticas o vulnerables:

```bash
# Instala automáticamente en .husky/pre-commit o .git/hooks/pre-commit
ghostdeps hook --fail-under 50

# Ver el script que se instalaría sin tocar el disco
ghostdeps hook --dry-run
```

### Auditoría y Compliance de Licencias (`--allow-licenses` / `--deny-licenses`)

Verifica que ninguna dependencia introduzca licencias *copyleft* infecciosas (GPL/AGPL) o licencias no autorizadas en tu proyecto:

```bash
# Prohibir licencias restrictivas
ghostdeps --deny-licenses "GPL-3.0,AGPL-3.0"

# O requerir únicamente licencias de lista blanca
ghostdeps --allow-licenses "MIT,Apache-2.0,ISC,BSD-3-Clause"
```

### Notificaciones a Slack, Discord y Webhooks (`--webhook`)

Envía un resumen ejecutivo del escaneo a tu canal de seguridad o alertas en CI/CD:

```bash
# Notificar a Slack (Block Kit nativo)
ghostdeps --webhook https://hooks.slack.com/services/T00/B00/XXXX

# Notificar a Discord (Embeds nativo)
ghostdeps --webhook https://discord.com/api/webhooks/123/xyz
```

### Cómo leer la tabla

| Columna | Significado |
|---|---|
| **Paquete** | Nombre en tu `package.json`. `(dev)` si viene de `devDependencies`; `↳ a › b` es la ruta por la que llega una transitiva. |
| **Score** | 0–100, en 🟢 verde (≥ 70), 🟡 amarillo (40–69) o 🔴 rojo (< 40). `N/E` = no evaluable, `ERROR` = falló la consulta. |
| **Días últ. commit** | Días desde el último commit en la rama por defecto (o en la carpeta del paquete si es monorepo). |
| **Mant. activos** | Personas distintas con commits en los últimos 12 meses (sin bots). En rojo si es 0–1, amarillo si es 2. `N+` = se alcanzó el tope de lectura. |
| **Alerta principal** | La penalización de mayor peso, o la razón de `N/E` / `ERROR`. |

Orden de las filas: paquetes evaluados de peor a mejor score → no evaluables → errores.

**¿Qué hago con un paquete en rojo?**
1. Ejecuta `ghostdeps --explain` para ver todas las señales.
2. Si es **deprecated/archivado**: busca el reemplazo recomendado (el mensaje de deprecación suele indicarlo).
3. Si es **abandonado / bus factor bajo**: evalúa un fork mantenido, una alternativa, o *vendorizarlo* si es pequeño.
4. Si es una **transitiva**: mira la ruta `↳` y actualiza (o reemplaza) la dependencia directa que la arrastra; como último recurso usa `overrides` en `package.json`.
5. Si hay **señales de secuestro**: revisa el diff de la última versión (`npm diff --diff=<pkg>@<anterior> --diff=<pkg>@<última>`), quién la publicó, y fija la versión anterior hasta confirmarlo.
6. Si aceptas el riesgo conscientemente, añádelo a `ignore` en `.ghostdepsrc.json` para que no bloquee el CI.

### Integración continua (CI)

`--fail-under <score>` devuelve exit code `1` si **algún paquete evaluado** queda por debajo del umbral. Lo más cómodo es fijarlo en `.ghostdepsrc.json` (`"failUnder": 40`) para que local y CI se comporten igual.

**GitHub Actions** (bloquea el PR y publica el informe en el resumen del job):
```yaml
name: GhostDeps
on:
  pull_request:
    paths: ['package.json', 'package-lock.json', '.ghostdepsrc.json']
  schedule:
    - cron: '0 8 * * 1'   # cada lunes
jobs:
  ghostdeps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: GhostDeps (Resumen de PR)
        run: npx ghostdeps --transitive --format markdown --fail-under 40 >> "$GITHUB_STEP_SUMMARY"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Generar SARIF para Code Scanning
        if: always()
        run: npx ghostdeps --transitive --format sarif -o ghostdeps.sarif
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Subir a GitHub Code Scanning
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: ghostdeps.sarif
      - name: Informe JSON (artefacto)
        if: always()
        run: npx ghostdeps --transitive --json -o ghostdeps-report.json || true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: ghostdeps-report, path: ghostdeps-report.json }
```

**GitLab CI:**
```yaml
ghostdeps:
  image: node:20
  script:
    - npx ghostdeps --fail-under 40 --format markdown -o ghostdeps.md
  artifacts:
    when: always
    paths: [ghostdeps.md]
  variables:
    GITHUB_TOKEN: $GITHUB_TOKEN   # define la variable en Settings > CI/CD
```

**Script de npm** (para el equipo):
```json
{ "scripts": { "deps:health": "ghostdeps --dev --explain" } }
```

> [!NOTE]
> Recomendación: empieza con `failUnder: 40` (solo bloquea los "fantasma") y súbelo cuando el proyecto esté limpio.

### Solución de problemas

| Síntoma | Causa / solución |
|---|---|
| `⚠ GITHUB_TOKEN no configurado` | Solo tienes 60 req/h. Configura `GITHUB_TOKEN` o `GH_TOKEN`. |
| Varios paquetes en `ERROR: Rate limit de GitHub agotado hasta las HH:MM` | Se agotó el cupo. Lo ya analizado queda en caché: vuelve a ejecutar tras el reset, usa token, o sube `--max-wait` para que espere en lugar de abortar. |
| `--transitive requiere package-lock.json` | Ejecuta `npm install` para generarlo. pnpm/yarn aún no están soportados. |
| `lockfileVersion 1 no soportado` | Regenera el lockfile con npm ≥ 7 (`npm install --lockfile-version 3`). |
| `clave(s) desconocida(s)` / `debe ser…` | Error en `.ghostdepsrc.json`. Usa `$schema` en el archivo para validarlo en el editor. |
| `Timeout (15000 ms)` | Red lenta: `--timeout 30000` y/o baja `--concurrency`. |
| `No se encontró package.json` (exit 2) | Ejecuta dentro del proyecto o usa `--path <dir>`. |
| `N/E: Repo en GitLab…` / `Sin campo "repository"` | Limitación actual: solo se evalúan repos de GitHub. |
| `N/E: No existe en el registry público` | Paquete privado o de un registry propio; no se evalúa. Añádelo a `ignore`. |
| Detrás de un proxy corporativo | El `fetch` nativo de Node no usa `HTTP(S)_PROXY` por defecto. En Node ≥ 22.21/24 exporta `NODE_USE_ENV_PROXY=1` junto con `HTTPS_PROXY`. |
| Datos desactualizados | `--no-cache`, o borra la caché (ver abajo). |
| En PowerShell no veo el exit code | Consulta `$LASTEXITCODE` tras ejecutar. |

**Borrar la caché:**
```bash
rm -rf ~/.cache/ghostdeps                                   # Linux/macOS
Remove-Item -Recurse "$env:LOCALAPPDATA\ghostdeps\cache"   # Windows
```

### Preguntas frecuentes

**¿Por qué una librería estable y "terminada" sale en rojo?** Porque GhostDeps mide el riesgo de que nadie responda ante un incidente (vulnerabilidad, secuestro de cuenta), no la calidad del código. Usa `--explain` y decide con contexto; si aceptas el riesgo, añádela a `ignore`.

**¿Puedo ajustar los pesos?** Sí, sin tocar código: usa `weights` y `thresholds` en [`.ghostdepsrc.json`](#archivo-de-configuración). Los valores por defecto viven en [`src/scoring/scoring.ts`](src/scoring/scoring.ts).

**¿Envía mi código a algún sitio?** No. Solo lee tu `package.json` / lockfile localmente y consulta las APIs públicas de npm y GitHub con los nombres de los paquetes.

**¿Una señal de "posible secuestro" significa que el paquete está comprometido?** No necesariamente: son indicios indirectos (ver [Limitaciones](#limitaciones-conocidas)). Significa "revisa la última versión antes de confiar en ella".

**¿`--fail-under` cuenta las transitivas?** Sí, cuando usas `--transitive` se evalúan igual que las directas. Los paquetes *No evaluable* y con *error* nunca hacen fallar el build.

## Cómo se calcula el Health Score

Se parte de **100** y se restan penalizaciones. Los valores por defecto están en [`src/scoring/scoring.ts`](src/scoring/scoring.ts) y se pueden cambiar con `weights` en la configuración (clave entre paréntesis). En las escalas por tramos solo se aplica el tramo más alto.

| Señal | Penalización |
|---|---|
| Repo archivado (`archived`) | −40 |
| Paquete `deprecated` en npm (`deprecated`) | −40 |
| Sin commits en la rama por defecto: > 6 / > 12 / > 24 meses (`abandonment`) | −10 / −25 / −45 |
| Sin publicar en npm > 24 meses (`stalePublish`) | −5 |
| Mantenedores activos (autores únicos de commits en 12 meses): 0 / 1 / 2 (`busFactor`) | −20 / −15 / −5 |
| Issues abiertos > 30 días con 0 comentarios: ≥ 3 / ≥ 10 / ≥ 25 (`unansweredIssues`) | −5 / −10 / −15 |
| El repo redirige (301) a otro owner/nombre (`repoRedirect`) | −10 |
| Maintainers nuevos en la última versión respecto a la anterior (`maintainersChanged`) | −15 |
| La última versión la publicó un usuario que no publicó ninguna de las 5 anteriores (`newPublisher`) | −15 |
| **Patrón combinado**: publicador nuevo + (maintainers nuevos, redirect o > 365 días sin publicar) (`hijackPattern`, `dormantRevivalDays`) | −15 extra |

| Score | Categoría |
|---|---|
| 70–100 | 🟢 Saludable |
| 40–69 | 🟡 Precaución |
| 0–39 | 🔴 Crítico/Fantasma |

*(Umbrales configurables con `thresholds`.)*

El resultado es explicable: cada paquete incluye `score`, `category`, la lista `penalties` (id, puntos, mensaje) y `mainAlert` (la de mayor peso). Usa `--explain`, `--json` o `--format markdown` para verlo.

Paquetes sin repo en GitHub (GitLab, Bitbucket, sin campo `repository`, dependencias `file:`/`git:`/`workspace:`…) se marcan como **No evaluable** con la razón; nunca rompen el análisis.

## Decisiones tomadas ante ambigüedades

- **`--dev` añade** `devDependencies` a `dependencies` (no las reemplaza). Si un paquete aparece en ambos, cuenta como `dependencies`.
- **Monorepos**: si npm declara `repository.directory`, el último commit y los mantenedores activos se calculan filtrando por esa ruta (`?path=`). Si el filtro no devuelve commits, se usa el repo completo. Archivado, redirect e issues siempre son a nivel de repo.
- **Último commit** = fecha *committer* del commit más reciente de la rama por defecto.
- **Mantenedores activos**: autores únicos (login de GitHub, o email si el commit no está vinculado a una cuenta) en los últimos 365 días, excluyendo bots (`[bot]`, dependabot, renovate, github-actions…). Se leen como máximo 300 commits (3 páginas); si se alcanza el tope se muestra `N+`.
- **Issues sin respuesta**: se leen los 100 issues abiertos más antiguos (los candidatos naturales) y se excluyen PRs. Si hay más de 100 abiertos, la cifra es una cota inferior.
- **Señales desconocidas no penalizan** (ej. issues deshabilitados): preferimos falsos negativos a castigar por falta de datos.
- **`--fail-under`** solo considera paquetes evaluados; los "No evaluable" y los errores se reportan pero no fallan el build.
- **Transitivas**: se deduplican por nombre (se analiza la versión más cercana a la raíz, que es la que determina el repo) y se reporta el camino más corto.
- **`--ignore` y `ignore`** se suman; un patrón compara contra el nombre en `package.json` y contra el nombre real del registry (alias).
- **Alias** `"foo": "npm:bar@^1"` se evalúan como `bar`.
- Si falta `repository`, se intenta usar `homepage` cuando apunta a GitHub.
- Identificadores del código en inglés; mensajes y documentación en español.

## Limitaciones conocidas

- **Detección de transferencias/hijacking por proxies.** Ni GitHub ni npm exponen un historial de transferencias de propiedad. GhostDeps usa señales indirectas: (1) el repo redirige a otro `full_name` (transferencia **o** simple renombre), (2) cambian los maintainers de npm entre la penúltima y la última versión, (3) la última versión la publicó alguien nuevo. Esto produce **falsos positivos** (rotaciones legítimas de equipo, publicación desde CI con un usuario nuevo, renombres de organización) y **falsos negativos** (un atacante con las credenciales robadas del mantenedor original no altera ninguna de estas señales). Trátalo como una alerta para revisar, no como un veredicto.
- **Solo GitHub.** GitLab, Bitbucket y forjas propias se marcan como No evaluable.
- **Transitivas solo con npm** (lockfile v2/v3). pnpm y yarn están en el roadmap.
- **Paquetes "terminados"**: librerías pequeñas y estables que no necesitan cambios pueden puntuar bajo por "abandono". Es intencional — el riesgo de que nadie responda ante un incidente existe — pero conviene interpretarlo con contexto.
- **Coste de API**: ~3–4 peticiones a GitHub por paquete (0 si está en caché). Sin token el rate limit se agota rápido; al agotarse, los paquetes restantes se reportan como error con la hora de reset y lo ya analizado queda en caché.
- La fecha del último commit puede no reflejar actividad en otras ramas, y el campo `repository` de npm no está verificado (un paquete puede apuntar a un repo que no es el suyo).
- Para paquetes enormes, el documento completo del registry (necesario para `_npmUser` y maintainers por versión) puede pesar varios MB.

## Caché

Se guarda en `$XDG_CACHE_HOME/ghostdeps`, `%LOCALAPPDATA%\ghostdeps\cache` (Windows) o `~/.cache/ghostdeps`; se puede cambiar con `GHOSTDEPS_CACHE_DIR`. Se almacenan los datos ya extraídos (no las respuestas crudas) con TTL configurable (`--cache-ttl`).

## Desarrollo

```bash
cd ghostdeps                              # carpeta del paquete
npm install
npm run dev -- --path ../otro-proyecto    # ejecuta con tsx desde el código fuente
npm test                                  # vitest (114 tests)
npm run typecheck                         # TypeScript strict
npm run build                             # compila a dist/
```

Estructura del repositorio:

```
.
├── README.md                     # este archivo
├── .github/workflows/ci.yml      # CI: Linux/Windows/macOS × Node 20/22/24
└── ghostdeps/                    # paquete npm de la CLI
    ├── src/
    │   ├── cli.ts                # Commander: flags, precedencia, salida, exit codes
    │   ├── analyzer.ts           # pipeline por paquete (nunca lanza)
    │   ├── config.ts             # carga y validación de .ghostdepsrc
    │   ├── parser/               # package.json, package-lock.json, URLs de repo
    │   ├── clients/              # npm, GitHub, HTTP (reintentos/rate limit), caché
    │   ├── scoring/              # motor de Health Score y señales
    │   └── render/               # tabla, Markdown, SARIF
    ├── tests/                    # vitest
    ├── schema/                   # JSON Schema de la configuración
    ├── examples/                 # configuración de ejemplo
    ├── docs/ARCHITECTURE.md      # arquitectura y decisiones de diseño
    └── CHANGELOG.md
```

Stack: Node.js 20+, TypeScript (strict, ESM), Commander, `fetch` nativo, chalk, cli-table3 y vitest. Más detalle en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); historial de cambios en [CHANGELOG.md](CHANGELOG.md).

## Roadmap

- [x] ~~Archivo de configuración `.ghostdepsrc` (pesos, umbrales, ignorados)~~ — v0.2.0
- [x] ~~Dependencias transitivas desde `package-lock.json` y `yarn.lock`~~ — v0.2.0
- [x] ~~Salida Markdown para PRs~~ — v0.2.0
- [x] ~~Salida SARIF para GitHub Code Scanning~~ — v0.2.0
- [ ] **Lockfile de pnpm** (`pnpm-lock.yaml`).
- [ ] **Python – `requirements.txt` / `pyproject.toml`**: cliente PyPI (`https://pypi.org/pypi/<pkg>/json`), repo desde `project_urls` (`Source`, `Repository`, `Homepage`), publicadores vía roles de la API de PyPI.
- [ ] **Go – `go.mod`**: el módulo ya es la URL (`github.com/o/r`); resolver vanity imports con `?go-get=1`; fechas vía `proxy.golang.org/<mod>/@latest`.
- [ ] **Rust – `Cargo.toml`**: API de crates.io (`/api/v1/crates/<crate>`, `owners`, `versions[].published_by`) — permite la misma detección de publicador nuevo que npm.
- [ ] Soporte GitLab/Bitbucket.
- [ ] GraphQL de GitHub para reducir peticiones (1 query por paquete).
- [ ] Salida SARIF para GitHub Code Scanning.
- [ ] Integración con OpenSSF Scorecard y deps.dev.

## Contribuir

1. Haz un fork y crea una rama: `git checkout -b feat/mi-mejora`.
2. Asegúrate de que pasan `npm run typecheck` y `npm test` (el CI lo comprueba en Linux, Windows y macOS).
3. Si cambias el scoring, añade casos límite en `tests/scoring.test.ts`; si añades una opción de configuración, actualiza también `schema/ghostdepsrc.schema.json`.
4. Añade una entrada en `CHANGELOG.md` y abre un Pull Request.

## Licencia

[MIT](LICENSE)

