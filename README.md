# 👻 GhostDeps

> Detecta **dependencias fantasma** en tu `package.json`: paquetes abandonados, con *bus factor* bajo o con señales de posible secuestro (hijacking), evaluando la **salud social y de mantenimiento** del repositorio origen — no solo CVEs.

Los escáneres de vulnerabilidades te avisan cuando ya existe un CVE. GhostDeps intenta avisarte **antes**: cuando una dependencia lleva años sin commits, depende de una sola persona, está archivada/deprecated o cambió de manos de forma sospechosa (el patrón de `event-stream`, `ua-parser-js` o `xz`).

```
👻 GhostDeps v0.1.0 · mi-app
┌──────────────┬───────┬─────────────────┬───────────────┬──────────────────────────────────────────────┐
│ Paquete      │ Score │ Días últ. commit │ Mant. activos │ Alerta principal                             │
├──────────────┼───────┼─────────────────┼───────────────┼──────────────────────────────────────────────┤
│ left-pad     │ 0     │ 2900            │ 0             │ Repositorio archivado (solo lectura)         │
│ request      │ 0     │ 2100            │ 0             │ Repositorio archivado (solo lectura)         │
│ some-lib     │ 45    │ 410             │ 1             │ Sin commits desde hace 410 días (~13 meses)  │
│ express      │ 100   │ 2               │ 14            │ Sin alertas                                  │
│ internal-pkg │ N/E   │ —               │ —             │ No evaluable: Repo en GitLab: solo GitHub…   │
└──────────────┴───────┴─────────────────┴───────────────┴──────────────────────────────────────────────┘

Resumen (5 dependencias):  ● Crítico/Fantasma (<40): 2   ● Precaución (40-69): 1   ● Saludable (≥70): 1   ○ No evaluable: 1
```
*(salida ilustrativa)*

## Instalación

Requiere **Node.js ≥ 20**.

```bash
# Sin instalar
npx ghostdeps

# Global
npm i -g ghostdeps

# Desde el código fuente
git clone https://github.com/<tu-usuario>/ghostdeps && cd ghostdeps
npm install && npm run build
node dist/cli.js --path ../mi-proyecto
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

Verás una barra de progreso (`Analizando 3/20: lodash`) y luego la tabla ordenada de **peor a mejor** score, seguida del resumen por categoría.

### Sintaxis

```bash
ghostdeps [opciones]
ghostdeps --help      # ayuda completa
ghostdeps --version
```

| Flag | Descripción | Default |
|---|---|---|
| `-p, --path <dir>` | Directorio con el `package.json` | directorio actual |
| `-d, --dev` | Incluye también `devDependencies` | `false` |
| `--json` | Salida JSON en stdout (avisos en stderr) | `false` |
| `--fail-under <score>` | Exit code `1` si algún paquete **evaluado** tiene score menor | — |
| `-c, --concurrency <n>` | Paquetes analizados en paralelo (1–32) | `4` |
| `--explain` | Muestra el desglose de penalizaciones de cada paquete | `false` |
| `--no-cache` | No lee ni escribe la caché en disco | caché activa |
| `--cache-ttl <horas>` | TTL de la caché | `24` |
| `--timeout <ms>` | Timeout por request | `15000` |
| `--max-wait <seg>` | Espera máxima ante rate limit antes de abortar | `60` |

**Códigos de salida:** `0` OK · `1` `--fail-under` incumplido · `2` error fatal (package.json inexistente/inválido, argumentos incorrectos).

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
ghostdeps -p ./packages/api
```

**Ver por qué un paquete tiene cierto score** (desglose de cada penalización):
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

### Cómo leer la tabla

| Columna | Significado |
|---|---|
| **Paquete** | Nombre en tu `package.json`. `(dev)` si viene de `devDependencies`. |
| **Score** | 0–100, en 🟢 verde (≥ 70), 🟡 amarillo (40–69) o 🔴 rojo (< 40). `N/E` = no evaluable, `ERROR` = falló la consulta. |
| **Días últ. commit** | Días desde el último commit en la rama por defecto (o en la carpeta del paquete si es monorepo). |
| **Mant. activos** | Personas distintas que hicieron commits en los últimos 12 meses (sin bots). En rojo si es 0–1, amarillo si es 2. `N+` = se alcanzó el tope de lectura. |
| **Alerta principal** | La penalización de mayor peso, o la razón de `N/E` / `ERROR`. |

Orden de las filas: paquetes evaluados de peor a mejor score → no evaluables → errores.

**¿Qué hago con un paquete en rojo?**
1. Ejecuta `ghostdeps --explain` para ver todas las señales.
2. Si es **deprecated/archivado**: busca el reemplazo recomendado (el mensaje de deprecación suele indicarlo).
3. Si es **abandonado / bus factor bajo**: evalúa un fork mantenido, una alternativa, o *vendorizarlo* si es pequeño.
4. Si hay **señales de secuestro**: revisa el diff de la última versión (`npm diff --diff=<pkg>@<anterior> --diff=<pkg>@<última>`), quién la publicó y fija la versión anterior hasta confirmarlo.

### Salida JSON

`--json` escribe el informe en **stdout**; avisos y progreso van a **stderr**, así que se puede redirigir o encadenar sin problemas.

```bash
ghostdeps --json > ghostdeps-report.json

# Solo los paquetes críticos
ghostdeps --json | jq -r '.packages[] | select(.result.category=="critical") | "\(.name)\t\(.result.score)\t\(.result.mainAlert.message)"'

# Resumen
ghostdeps --json | jq '.summary'
```

Estructura (resumida):

```jsonc
{
  "tool": "ghostdeps",
  "version": "0.1.0",
  "generatedAt": "2026-11-19T14:16:15.000Z",
  "manifest": "/ruta/package.json",
  "options": { "dev": false, "failUnder": 40, "authenticated": true },
  "summary": { "total": 6, "healthy": 2, "caution": 0, "critical": 3, "notEvaluable": 1, "errors": 0 },
  "failUnder": { "threshold": 40, "failing": ["left-pad", "request", "is-promise"] },
  "packages": [
    {
      "name": "left-pad",
      "registryName": "left-pad",
      "spec": "^1",
      "kind": "dependencies",
      "status": "evaluated",            // evaluated | not-evaluable | error
      "reason": null,                   // motivo si no es "evaluated"
      "npm":    { "latestVersion": "1.3.0", "deprecated": "...", "latestPublisher": "...", "maintainersChange": { "added": [], "removed": [] }, "...": "..." },
      "github": { "fullName": "left-pad/left-pad", "redirected": true, "archived": true, "lastCommitAt": "...", "activeMaintainers": 0, "unansweredIssues": 2, "...": "..." },
      "signals": { "daysSinceLastCommit": 2806, "activeMaintainers": 0, "...": "..." },
      "result": {
        "score": 0,
        "category": "critical",          // healthy | caution | critical
        "penalties": [ { "id": "abandoned", "points": 45, "message": "Sin commits desde hace 2806 días (~93 meses)" } ],
        "mainAlert": { "id": "abandoned", "points": 45, "message": "..." }
      }
    }
  ]
}
```

IDs de penalización posibles: `archived`, `deprecated`, `abandoned`, `stale-publish`, `bus-factor`, `unanswered-issues`, `repo-redirect`, `maintainers-changed`, `new-publisher`, `hijack-pattern`.

### Integración continua (CI)

`--fail-under <score>` devuelve exit code `1` si **algún paquete evaluado** queda por debajo del umbral.

**GitHub Actions:**
```yaml
name: GhostDeps
on:
  pull_request:
    paths: ['package.json']
  schedule:
    - cron: '0 8 * * 1'   # cada lunes
jobs:
  ghostdeps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx ghostdeps --fail-under 40
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Reporte JSON (artefacto)
        if: always()
        run: npx ghostdeps --json > ghostdeps-report.json || true
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: ghostdeps-report, path: ghostdeps-report.json }
```

**GitLab CI:**
```yaml
ghostdeps:
  image: node:20
  script:
    - npx ghostdeps --fail-under 40
  variables:
    GITHUB_TOKEN: $GITHUB_TOKEN   # define la variable en Settings > CI/CD
```

> Recomendación: empieza con `--fail-under 40` (solo bloquea los "fantasma") y súbelo cuando el proyecto esté limpio.

### Solución de problemas

| Síntoma | Causa / solución |
|---|---|
| `⚠ GITHUB_TOKEN no configurado` | Solo tienes 60 req/h. Configura `GITHUB_TOKEN` o `GH_TOKEN`. |
| Varios paquetes en `ERROR: Rate limit de GitHub agotado hasta las HH:MM` | Se agotó el cupo. Lo ya analizado queda en caché: vuelve a ejecutar tras el reset, usa token, o sube `--max-wait` para que espere en lugar de abortar. |
| `Timeout (15000 ms)` | Red lenta: `--timeout 30000` y/o baja `--concurrency`. |
| `No se encontró package.json` (exit 2) | Ejecuta dentro del proyecto o usa `--path <dir>`. |
| `N/E: Repo en GitLab…` / `Sin campo "repository"` | Limitación del MVP: solo se evalúan repos de GitHub. |
| `N/E: No existe en el registry público` | Paquete privado o de un registry propio; no se evalúa. |
| Detrás de un proxy corporativo | El `fetch` nativo de Node no usa `HTTP(S)_PROXY` por defecto. En Node ≥ 22.21/24 exporta `NODE_USE_ENV_PROXY=1` junto con `HTTPS_PROXY`. |
| Datos desactualizados | `--no-cache`, o borra la caché (ver abajo). |
| En PowerShell no veo el exit code | Consulta `$LASTEXITCODE` tras ejecutar. |

**Borrar la caché:**
```bash
rm -rf ~/.cache/ghostdeps                                   # Linux/macOS
Remove-Item -Recurse "$env:LOCALAPPDATA\ghostdeps\cache"   # Windows
```

### Preguntas frecuentes

**¿Por qué una librería estable y "terminada" sale en rojo?** Porque GhostDeps mide el riesgo de que nadie responda ante un incidente (vulnerabilidad, secuestro de cuenta), no la calidad del código. Usa `--explain` y decide con contexto.

**¿Puedo ajustar los pesos?** Sí: edita las constantes de `DEFAULT_WEIGHTS` y `THRESHOLDS` en [`src/scoring/scoring.ts`](src/scoring/scoring.ts) y recompila (`npm run build`). Un archivo de configuración `.ghostdepsrc` está en el roadmap.

**¿Envía mi código a algún sitio?** No. Solo lee tu `package.json` localmente y consulta las APIs públicas de npm y GitHub con los nombres de los paquetes.

**¿Una señal de "posible secuestro" significa que el paquete está comprometido?** No necesariamente: son indicios indirectos (ver *Limitaciones conocidas*). Significa "revisa la última versión antes de confiar en ella".

## Cómo se calcula el Health Score

Se parte de **100** y se restan penalizaciones (pesos en [`src/scoring/scoring.ts`](src/scoring/scoring.ts)). En las escalas por tramos solo se aplica el tramo más alto.

| Señal | Penalización |
|---|---|
| Repo archivado | −40 |
| Paquete `deprecated` en npm | −40 |
| Sin commits en la rama por defecto: > 6 / > 12 / > 24 meses | −10 / −25 / −45 |
| Sin publicar en npm > 24 meses | −5 |
| Mantenedores activos (autores únicos de commits en 12 meses): 0 / 1 / 2 | −20 / −15 / −5 |
| Issues abiertos > 30 días con 0 comentarios: ≥ 3 / ≥ 10 / ≥ 25 | −5 / −10 / −15 |
| El repo redirige (301) a otro owner/nombre | −10 |
| Maintainers nuevos en la última versión respecto a la anterior | −15 |
| La última versión la publicó un usuario que no publicó ninguna de las 5 anteriores | −15 |
| **Patrón combinado**: publicador nuevo + (maintainers nuevos, redirect o > 365 días sin publicar) | −15 extra |

| Score | Categoría |
|---|---|
| 70–100 | 🟢 Saludable |
| 40–69 | 🟡 Precaución |
| 0–39 | 🔴 Crítico/Fantasma |

El resultado es explicable: cada paquete incluye `score`, `category`, la lista `penalties` (id, puntos, mensaje) y `mainAlert` (la de mayor peso). Usa `--explain` o `--json` para verlo.

Paquetes sin repo en GitHub (GitLab, Bitbucket, sin campo `repository`, dependencias `file:`/`git:`/`workspace:`…) se marcan como **No evaluable** con la razón; nunca rompen el análisis.

## Decisiones tomadas ante ambigüedades

- **`--dev` añade** `devDependencies` a `dependencies` (no las reemplaza). Si un paquete aparece en ambos, cuenta como `dependencies`.
- **Monorepos**: si npm declara `repository.directory`, el último commit y los mantenedores activos se calculan filtrando por esa ruta (`?path=`). Si el filtro no devuelve commits, se usa el repo completo. Archivado, redirect e issues siempre son a nivel de repo.
- **Último commit** = fecha *committer* del commit más reciente de la rama por defecto.
- **Mantenedores activos**: autores únicos (login de GitHub, o email si el commit no está vinculado a una cuenta) en los últimos 365 días, excluyendo bots (`[bot]`, dependabot, renovate, github-actions…). Se leen como máximo 300 commits (3 páginas); si se alcanza el tope se muestra `N+`.
- **Issues sin respuesta**: se leen los 100 issues abiertos más antiguos (los candidatos naturales) y se excluyen PRs. Si hay más de 100 abiertos, la cifra es una cota inferior.
- **Señales desconocidas no penalizan** (ej. issues deshabilitados): preferimos falsos negativos a castigar por falta de datos.
- **`--fail-under`** solo considera paquetes evaluados; los "No evaluable" y los errores se reportan pero no fallan el build.
- **Alias** `"foo": "npm:bar@^1"` se evalúan como `bar`.
- Si falta `repository`, se intenta usar `homepage` cuando apunta a GitHub.
- Identificadores del código en inglés; mensajes y documentación en español.

## Limitaciones conocidas

- **Detección de transferencias/hijacking por proxies.** Ni GitHub ni npm exponen un historial de transferencias de propiedad. GhostDeps usa señales indirectas: (1) el repo redirige a otro `full_name` (transferencia **o** simple renombre), (2) cambian los maintainers de npm entre la penúltima y la última versión, (3) la última versión la publicó alguien nuevo. Esto produce **falsos positivos** (rotaciones legítimas de equipo, publicación desde CI con un usuario nuevo, renombres de organización) y **falsos negativos** (un atacante con las credenciales robadas del mantenedor original no altera ninguna de estas señales). Trátalo como una alerta para revisar, no como un veredicto.
- **Solo GitHub.** GitLab, Bitbucket y forjas propias se marcan como No evaluable.
- **Solo dependencias directas** de `package.json` (no lee lockfiles ni transitivas).
- **Paquetes "terminados"**: librerías pequeñas y estables que no necesitan cambios (p. ej. utilidades de una sola función) pueden puntuar bajo por "abandono". Es intencional — el riesgo de que nadie responda ante un incidente existe — pero conviene interpretarlo con contexto.
- **Coste de API**: ~3–4 peticiones a GitHub por paquete (1 si está en caché). Sin token el rate limit se agota rápido; al agotarse, los paquetes restantes se reportan como error con la hora de reset y lo ya analizado queda en caché.
- La fecha del último commit puede no reflejar actividad en otras ramas, y el campo `repository` de npm no está verificado (un paquete puede apuntar a un repo que no es el suyo).
- Para paquetes enormes, el documento completo del registry (necesario para `_npmUser` y maintainers por versión) puede pesar varios MB.

## Caché

Se guarda en `$XDG_CACHE_HOME/ghostdeps`, `%LOCALAPPDATA%\ghostdeps\cache` (Windows) o `~/.cache/ghostdeps`; se puede cambiar con `GHOSTDEPS_CACHE_DIR`. Se almacenan los datos ya extraídos (no las respuestas crudas) con TTL configurable.

## Desarrollo

```bash
npm install
npm run dev -- --path ../otro-proyecto   # ejecuta con tsx
npm test                                 # vitest
npm run typecheck
npm run build
```

Arquitectura y decisiones de diseño: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Roadmap

1. **Python – `requirements.txt` / `pyproject.toml`**: cliente PyPI (`https://pypi.org/pypi/<pkg>/json`), repo desde `project_urls` (`Source`, `Repository`, `Homepage`), publicadores vía `ownership` / roles de la API de PyPI.
2. **Go – `go.mod`**: el módulo ya es la URL (`github.com/o/r`); resolver vanity imports con `?go-get=1`; fechas vía `proxy.golang.org/<mod>/@latest`.
3. **Rust – `Cargo.toml`**: API de crates.io (`/api/v1/crates/<crate>`, `owners`, `versions[].published_by`) — permite la misma detección de publicador nuevo que npm.
4. **Dependencias transitivas**: leer `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`, deduplicar por nombre, y propagar el peor score por la ruta de dependencia ("`express` → `debug` → `ms`"). Flag `--depth`.
5. Extras: soporte GitLab/Bitbucket, GraphQL de GitHub para reducir peticiones (1 query por paquete), salida SARIF para GitHub Code Scanning, archivo `.ghostdepsrc` para pesos/ignorados, integración con OpenSSF Scorecard y deps.dev.

## Licencia

MIT
#   g h o s t d e p s  
 