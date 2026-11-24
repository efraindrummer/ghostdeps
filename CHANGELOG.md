# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).

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
