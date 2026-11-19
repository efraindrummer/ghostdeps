# Arquitectura de GhostDeps

## Estructura

```
ghostdeps/
├── package.json            # ESM, bin "ghostdeps" -> dist/cli.js
├── tsconfig.json           # strict + noUncheckedIndexedAccess (src + tests, typecheck)
├── tsconfig.build.json     # solo src -> dist
├── vitest.config.ts
├── src/
│   ├── cli.ts              # Commander: flags, orquestación, exit codes, avisos
│   ├── analyzer.ts         # pipeline por paquete (npm -> GitHub -> señales -> score), nunca lanza
│   ├── types.ts            # modelos de dominio serializables (fechas ISO)
│   ├── errors.ts           # GhostDepsError + subclases con `code` estable
│   ├── utils.ts            # fechas, sleep, pool de concurrencia
│   ├── parser/
│   │   ├── manifest.ts     # lectura/validación de package.json, alias npm:, specs no-registry
│   │   └── repoUrl.ts      # normalización de URLs de repo (git+https, ssh, shorthand, directory)
│   ├── clients/
│   │   ├── http.ts         # fetch + timeout + retries/backoff + rate limit gate
│   │   ├── cache.ts        # caché en disco con TTL y escritura atómica
│   │   ├── npm.ts          # registry: extracción pura (extractNpmInfo) + cliente
│   │   └── github.ts       # REST v3: repo, commits, issues
│   ├── scoring/
│   │   ├── scoring.ts      # pesos, umbrales y motor puro computeScore()
│   │   └── signals.ts      # NpmInfo + GitHubInfo -> HealthSignals
│   └── render/
│       └── table.ts        # tabla cli-table3 + resumen + --explain
└── tests/                  # vitest: scoring (casos límite), repoUrl, npm/manifest, http
```

## Decisiones clave

1. **Núcleo puro, bordes con I/O.** `computeScore` y `buildSignals` no hacen I/O ni leen el reloj (`now` se inyecta), por lo que los tests son deterministas y el motor es reutilizable para otros ecosistemas (PyPI, crates.io…): solo hace falta producir `HealthSignals`.
2. **Señales → penalizaciones explicables.** Cada penalización lleva `id`, `points` y `message`; la alerta principal es la de más puntos con desempate por prioridad fija. Señal desconocida (`null`) = sin penalización.
3. **Fallo aislado por paquete.** `analyzePackage` captura todo y devuelve `status: evaluated | not-evaluable | error`. Solo los errores de manifest/argumentos son fatales (exit 2).
4. **Rate limit con compuerta compartida.** Al ver `X-RateLimit-Remaining: 0`, `RateLimitGate` bloquea hasta `X-RateLimit-Reset`: todas las peticiones concurrentes esperan (si ≤ `--max-wait`) o fallan rápido sin tocar la red. 403/429/5xx y errores de red se reintentan con backoff exponencial + jitter; `Retry-After` se respeta (rate limit secundario).
5. **Minimizar llamadas a GitHub.** Una paginación de commits `since=12 meses` da a la vez autores únicos y último commit; solo si está vacía se pide el último commit histórico. Issues: una sola página ordenada por antigüedad. Total: 3 peticiones típicas (+1 en repos inactivos).
6. **Detección de redirect sin seguirlo manualmente.** `fetch` sigue el 301 de GitHub; se compara el `full_name` devuelto con el `owner/repo` declarado en npm.
7. **Caché de datos extraídos, no de respuestas.** Los packuments de npm pueden pesar MB; se cachea `NpmInfo`/`GitHubInfo` (pocos KB) con clave versionada (`v1:`) para invalidar al cambiar el esquema.
8. **Sin dependencias extra** más allá de las exigidas: `fetch` nativo, `AbortSignal.timeout`, pool de concurrencia propio (~15 líneas).
9. **Salida separada**: datos en stdout (tabla o JSON), avisos/progreso en stderr → `--json | jq` funciona siempre.
