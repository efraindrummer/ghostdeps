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

## Uso

```bash
ghostdeps [opciones]
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

### Ejemplos

```bash
ghostdeps --dev --explain
ghostdeps --path ./packages/api --json > ghostdeps-report.json
ghostdeps --fail-under 40           # rompe el build si hay algún paquete "fantasma"
```

### GitHub Actions

```yaml
- name: GhostDeps
  run: npx ghostdeps --fail-under 40
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

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