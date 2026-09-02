# Capa de observación de contratabilidad — SPEC MVP v5 Free-first

**Estado:** WP0, WP1, WP3, WP4, WP5 y WP6 están completos. WP2 conserva pendiente únicamente su ventana canónica de evidencia de 24 horas; la corrida UTC 2026-08-29 fue un ensayo. WP6 (`POST /hire-events`, ruta same-origin y reporte desde el navegador) está implementado y probado; su despliegue en staging requiere el secreto `BSC_TESTNET_RPC_URL` además de `BSC_RPC_URL`. Staging opera desde el 2026-08-30 con Cron de cinco minutos, Queue, D1 y RPC público BSC. El índice normalizado v2 y sus rutas públicas están desplegados en staging; producción y validation continúan safe-off y sin Cron.
**Fecha de corte del diseño:** 2026-08-31.
**Objetivo:** completar la capa de observación necesaria para recorrer:

```text
Discover → Understand → Compare → Hire → Track → Result
```

Esta spec gobierna el repositorio `bnb-agent-probe` y su integración con este
marketplace. El contrato ejecutable de configuración vive en
`bnb-agent-probe/src/config.ts`; el bootstrap previo del marketplace se eliminó
el 2026-08-29 al completarse la mudanza de la política de rotación al Worker.
No autoriza cambios en producción de trust8004 durante su ventana de
congelación.

---

## 0. Reglas de lectura

### 0.1 Niveles de evidencia

| Marca | Significado | Puede publicarse |
| --- | --- | --- |
| `VERIFICADO_LOCAL` | Comprobado en código o dependencias instaladas | Sí, citando archivo/versión |
| `VERIFICADO_PLATAFORMA` | Comprobado contra documentación oficial vigente | Sí, citando URL y fecha |
| `SNAPSHOT_REQUERIDO` | Observado durante research, pero sin artefacto reproducible versionado | No, hasta WP0 |
| `ONCHAIN_REQUERIDO` | Debe leerse de BSC en el momento de uso | Solo con bloque, timestamp y tx/hash cuando aplique |

Una afirmación `SNAPSHOT_REQUERIDO` no entra en landing, presentación ni
comunicado. WP0 la reemplaza por un artefacto versionado.

### 0.2 Invariantes del producto

- Cada dato se etiqueta como `declared`, `observed`, `onchain` o `derived`.
- Nunca se persiste un booleano `hireable` ni un score compuesto.
- MCP/A2A disponible no equivale a ERC-8183 contratable.
- Identidad, contratos, fondos, allowance y estado del job se resuelven desde
  BSC; trust8004 se consume solo por API.
- La contratación sigue siendo no custodial. La llave del comprador nunca pasa
  por el marketplace, el Worker ni trust8004.
- Token, allowance exacto, presupuesto, deadline y propósito de cada transacción
  se muestran antes de pedir una firma.
- Un fallo de sondeo no borra silenciosamente un agente ya visible.
- Los sellers operados por el marketplace se identifican como tales y nunca se
  presentan como agentes oficiales de BNB.
- Las cuatro categorías siguen siendo de primera clase: `rebalancing`,
  `grid_trading`, `yield_optimisation` y `health_factor_monitoring`.
- Cada CTA primario tiene un destino funcional; no se publica `Hire` si el flujo
  no puede pedir y validar una quote fresca.

### 0.3 Supremacía del artefacto

Si una cifra del spec difiere del artefacto que la respalda, gana el artefacto y
el spec se corrige en el mismo PR que detecta la diferencia. Ninguna cifra del
spec cita como fuente otra cosa que un artefacto versionado, código de este
repositorio o documentación oficial fechada.

---

## 1. Hechos que gobiernan la implementación

### 1.1 Verificados en este repositorio

| Hecho | Evidencia | Estado |
| --- | --- | --- |
| BSC Mainnet | `chainId = 56` | `src/trust8004/types.ts` |
| SDK ERC-8183 | `@bnbagent/sdk@0.5.0` | `package.json` |
| TTL máximo del SDK | `NegotiationHandler.MAX_QUOTE_TTL_SECONDS = 900` | dependencia instalada, comprobado 2026-08-27 |
| Edad máxima aceptada al validar una quote recién recibida | 60 s | `src/readiness/protocols.ts` |
| Tolerancia de reloj | 60 s | `src/readiness/protocols.ts` |
| Respuesta máxima de seller | 64 KiB | `src/readiness/protocols.ts` y `src/verification/safe-http.ts` |
| Timeout seguro por defecto | 10 s | `src/verification/safe-http.ts` |
| Skill de negociación | `negotiate-erc8183-job` o `negotiate` | `src/erc8183/skills.ts` |
| Skill posterior a funding | exactamente `notify_funded` | `src/erc8183/skills.ts` |
| Seller propio | Agent `303779`, A2A, operado por el marketplace | `docs/DECISIONS.md` |
| Registry ERC-8004 BSC | `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432` | configuración validada del proyecto |
| Commerce | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` | `src/mainnet/contracts.ts` |
| Router | `0x51895229E12F9876011789B04f8698af06cCD6DA` | `src/mainnet/contracts.ts` |
| Policy | `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5` | `src/mainnet/contracts.ts` |
| Token `$U` | `0xcE24439F2D9C6a2289F741120FE202248B666666` | `src/mainnet/contracts.ts` |

Las direcciones son configuración esperada, no sustituyen lecturas onchain. En
cada probe se comprueba `paymentToken()` y que la Policy continúa allowlisted.

### 1.2 Verificados contra Cloudflare

Consulta oficial revisada el 2026-08-28:

- Workers Free dispone de 128 MiB por isolate, 10 ms de CPU, 50 subrequests
  externos por invocación y 15 min de wall time para Cron Triggers.
- Workers Free permite 100.000 requests por día para la cuenta.
- Cloudflare Queues está disponible en Workers Free: incluye 10.000 operaciones
  por día y 24 horas de retención. Un mensaje exitoso usa tres operaciones
  nominales —write, read y delete— y cada retry añade otra lectura.
- Un Queue consumer dispone por defecto de 30 s de CPU configurable y 15 min de
  wall time. Esta cuota es distinta de los 10 ms del Cron producer Free.
- D1 Free permite 5 millones de filas leídas/día, 100.000 escritas/día y 5 GB
  totales, con máximo de 500 MB para una base. Esta spec reserva 20 % de las
  cuotas diarias.
- D1 permite como máximo 50 queries por invocación Worker Free y 1.000 en Paid;
  cada sentencia de `db.batch()` cuenta como una query. El presupuesto operativo
  reserva 20 % y deja capacidad explícita para liberar el lease.
- Una query D1 admite como máximo 100 parámetros enlazados.
- Workers Paid, cuando se active explícitamente, permite 30 s de CPU para un
  cron menor de una hora y 10.000 subrequests externos por invocación.
- D1 `batch()` es transaccional y revierte el lote si falla una sentencia.
- Cada invocación es independiente; memoria no sirve como lock/rate limiter
  global.

Fuentes:

- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://developers.cloudflare.com/d1/platform/pricing/>
- <https://developers.cloudflare.com/d1/platform/limits/>
- <https://developers.cloudflare.com/d1/worker-api/return-object/>
- <https://developers.cloudflare.com/d1/observability/metrics-analytics/>
- <https://developers.cloudflare.com/d1/worker-api/d1-database/#batch>
- <https://developers.cloudflare.com/workers/reference/how-workers-works/>
- <https://developers.cloudflare.com/workers/observability/metrics-and-analytics/>
- <https://developers.cloudflare.com/queues/platform/pricing/>
- <https://developers.cloudflare.com/queues/platform/limits/>

Consecuencia normativa: no existe token bucket global en memoria. El Cron Free
solo publica un tick versionado; un Queue consumer de batch unitario deduplica el
tick y ejecuta una fase bajo lease D1. Un presupuesto fijo limita cada entrega.
Los 10 ms del producer y los 30 s de CPU del consumer son CPU activa, no wall
time. El Worker no puede medirla con precisión desde el código; el gate usa
métricas de staging de Cloudflare y lotes máximos estrictos.

### 1.3 Baseline que WP0 debe reemplazar

Research del 2026-08-27 registró provisionalmente:

| Métrica | Baseline provisional | Publicable ahora |
| --- | ---: | --- |
| Total BSC | 309.897, bloque inicial 118441354, 2026-08-27T19:41:17.543Z | Sí, artefacto WP0 |
| `metadataReason=ok` | 182.679 (58,95 %) | Sí, artefacto WP0 |
| `http_unreachable` | 109.506 (35,34 %) | Sí, artefacto WP0 |
| Declarantes ERC-8183 | 16: 12 solo ERC-8183 + 4 también A2A | Sí, artefacto WP0 |
| `a2aOnly` | 21.194 | Sí, artefacto WP0 |
| Declarantes A2A/ERC-8183 | 21.210 agentes; 21.213 endpoints declarados, 21.202 HTTPS públicos | Sí, artefacto WP0 |

La afirmación “0 declaran ERC-8183” queda reemplazada por el conteo reproducible
anterior. El artefacto es
`evidence/funnel-bsc-2026-08-27T19-41-17Z.json`. Los declarantes A2A/ERC-8183
superan 4x el gate de 5.000: son la cifra que motivó el perfil Free-first y el
conjunto live acotado (decisión 2026-08-28).

### 1.4 Supuestos de API que WP0 revalida

WP0 guarda respuesta y headers que prueben o corrijan:

- ruta gratuita `/api/app/agents`;
- límite anunciado de 60 req/min;
- `limit=2000` devuelve 2.000 registros y el snapshot WP0 midió una página máxima
  de 7.056.330 bytes. El cliente de catálogo usa un límite independiente de
  16 MiB (`MAX_CATALOG_RESPONSE_BYTES=16777216`); no reutiliza el límite de
  respuestas de sellers;
- `sortBy=id` ordena lexicográficamente y no se usa; la pasada usa
  `sortBy=registered&sortOrder=asc`, tolera timestamps ausentes, deduplica IDs y
  confirma primera/media/última página por relectura exacta;
- campos de servicios, endpoints, metadata y timestamps;
- detalle `/api/app/agents/56:AGENT_ID`;
- el `agentWallet` del detalle HTTP no es fuente onchain; `getAgentWallet` se lee
  directamente de BSC, con fallback `ownerOf` cuando es zero/vacío;
- el RPC público no garantiza estado histórico reciente. El artefacto distingue
  bloque inicial del barrido y bloque de lectura wallet, sin fingir un corte HTTP
  transaccional.

Si cambia un punto, se actualiza esta spec antes de WP1.

### 1.5 Snapshot normalizado v2 que gobierna el catálogo actual

La pasada ascendente completa del 2026-08-30 reemplaza la cifra de 21.210 como
techo de ingeniería. Esa cifra sigue siendo un hecho histórico de WP0, no el
tamaño de un conjunto fijo. El artefacto
`evidence/catalog-v2-bsc-2026-08-30T21-58-00Z.json` midió:

| Métrica | Medición v2 |
| --- | ---: |
| identidades registradas | 319.851 |
| candidatos con al menos una declaración normalizable | 29.801 |
| relaciones agente–endpoint | 30.721 |
| endpoints únicos | 1.330 |
| endpoints representativos por origin+protocolo | 218 |

`sourceSha256=293704c31298e629db95ac5f6f47b166245e3385845921832d94ea8e8d087610`.
El conteo de candidatos se deriva de criterios y puede subir o bajar en cada
snapshot; nunca se rellena hasta 21.000 ni se trunca en ese valor. La pasada
tolera crecimiento monotónico del total mientras pagina por registro ascendente,
deduplica Agent IDs y falla ante regresión del total.

El SQL derivado conserva todas las relaciones pero sondea un solo representante
por `originKey+protocol`, evitando hacer fetch repetido a cientos de identidades
que publican el mismo servicio. La importación inicial escribió 61.854 filas
lógicas y D1 contabilizó 247.408 filas incluyendo índices. Por tanto, una
instalación nueva en Free debe fragmentar la reconciliación entre ventanas UTC;
no se presupuesta como trabajo normal del Cron. Una vez sembrado, el runtime
permanece dentro de sus presupuestos Free por invocación y día.

---

## 2. Arquitectura mínima

```text
 trust8004 /api/app                  sellers externos
 catálogo + metadata                A2A / HTTP ERC-8183
          |                                  |
          v                                  v
 +---------------------------------------------------------+
 | Cloudflare Worker Free por defecto                      |
 | cron → Queue; consumer → lease → fase → cursor          |
 | GET  /observations  público y cacheado                  |
 | GET  /health        público, sin secretos               |
 | POST /hire-events   solo servidor-a-servidor            |
 +---------------------------+-----------------------------+
                             |
                    +--------v---------+
                    | D1, tablas legacy + índice v2 |
                    +------------------+
                             |
                       BSC RPC / viem

 Marketplace en Vercel
   - lee /observations fuera de la ruta crítica de render
   - si falla, conserva solo declaraciones live de trust8004 y marca observaciones unavailable
   - ofrece pedir una quote fresca bajo demanda para cada seller ERC-8183 compatible admitido por el allowlist activo
   - pide y valida esa quote al pulsar Hire o Refresh quote; Worker/D1 no autorizan Hire
   - publica después solo el resultado sanitizado como nueva evidencia observada
   - el navegador firma directamente contra BSC
   - una ruta server-side reenvía telemetría mínima
```

Se añade exactamente una Cloudflare Queue por entorno para aislar las fases del
límite de CPU del Cron producer. No se añaden Durable Object, KV, R2 ni otro
Worker. El funnel global usa
el snapshot WP0 versionado. Como ese artefacto conservó el conteo de 16
declarantes ERC-8183 pero no sus IDs, el conjunto live inicial contiene el
inventario curado que preserva las cuatro categorías y añade declaraciones
ERC-8183 observadas por HEADER. No se afirma que los 16 históricos estén live
sin un artefacto de IDs versionado, ni se ejecuta un rescan global dentro de
Workers Free. La Queue no amplía el catálogo ni habilita Paid; solo proporciona
el presupuesto de CPU que las mediciones directas demostraron necesario.

El índice v2 separa cuatro entidades que no deben conflarse:

```text
catalog_agents 1──N catalog_agent_endpoints N──1 catalog_endpoints
       │                                                │
       └────────── catalog_observations ────────────────┘
```

Una observación puede pertenecer al agente, al endpoint compartido o a ambos.
`browser_reported`, `worker_probe`, `marketplace_probe` y `chain_index` son
fuentes distintas. Un resultado del browser se publica como evidencia del
usuario, pero jamás satisface los filtros operados por la plataforma.

---

## 3. Modelo de datos D1

Timestamps: epoch milisegundos. IDs/cantidades onchain: `TEXT` decimal para no
depender del límite seguro de JavaScript.

### 3.1 Schema normativo

```sql
CREATE TABLE probe_targets (
  agentId                   TEXT NOT NULL,
  chainId                   INTEGER NOT NULL CHECK (chainId = 56),
  transport                 TEXT NOT NULL
    CHECK (transport IN ('a2a', 'erc8183_http')),
  endpoint                  TEXT NOT NULL,
  name                      TEXT,
  categoriesJson            TEXT NOT NULL DEFAULT '[]',
  categoryProvenance        TEXT CHECK (
    categoryProvenance IS NULL OR categoryProvenance = 'derived:marketplace-inventory'
  ),
  declarationState          TEXT NOT NULL
    CHECK (declarationState IN ('current', 'removed', 'metadata_unavailable')),
  currentMetadataUpdatedAt  INTEGER,
  lastMetadataCheckedAt     INTEGER NOT NULL,
  firstSeenAt               INTEGER NOT NULL,
  lastChangedAt             INTEGER NOT NULL,
  lastSeenAt                INTEGER NOT NULL,
  priority                  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chainId, agentId, transport, endpoint)
);
CREATE INDEX idx_targets_probe
  ON probe_targets (declarationState, priority DESC, chainId, agentId);

CREATE TABLE probe_observations (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  agentId                    TEXT NOT NULL,
  chainId                    INTEGER NOT NULL CHECK (chainId = 56),
  transport                  TEXT NOT NULL
    CHECK (transport IN ('a2a', 'erc8183_http')),
  endpoint                   TEXT NOT NULL,
  probedAt                   INTEGER NOT NULL,
  probeCategory              TEXT CHECK (
    probeCategory IS NULL OR probeCategory IN (
      'rebalancing', 'grid_trading', 'yield_optimisation',
      'health_factor_monitoring'
    )
  ),
  outcome                    TEXT NOT NULL CHECK (outcome IN (
    'quote_verified', 'protocol_valid', 'quote_rejected', 'quote_invalid',
    'reachable', 'unreachable', 'unsafe_url', 'error'
  )),
  observedMetadataUpdatedAt  INTEGER,
  observedWallet             TEXT,
  observedWalletSource       TEXT
    CHECK (observedWalletSource IS NULL OR observedWalletSource IN ('agentWallet', 'ownerOf')),
  observedBlockNumber        TEXT,
  onchainObservedAt          INTEGER,
  commerce                   TEXT,
  router                     TEXT,
  policy                     TEXT,
  priceRaw                   TEXT,
  currency                   TEXT,
  decimals                   INTEGER,
  signatureMethod            TEXT
    CHECK (signatureMethod IS NULL OR signatureMethod IN ('eip191', 'erc1271')),
  signer                     TEXT,
  requestHash                TEXT,
  negotiationHash            TEXT,
  quoteNegotiatedAt          INTEGER,
  quoteExpiresAt             INTEGER,
  httpStatus                 INTEGER,
  errorCode                  TEXT,
  durationMs                 INTEGER NOT NULL
);
CREATE INDEX idx_obs_agent
  ON probe_observations (chainId, agentId, probedAt DESC);
CREATE INDEX idx_obs_target
  ON probe_observations (chainId, agentId, transport, endpoint, probedAt DESC);
CREATE INDEX idx_obs_target_category
  ON probe_observations (
    chainId, agentId, transport, endpoint, probeCategory, probedAt DESC
  );

CREATE TABLE funnel_snapshots (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  measuredAt                 INTEGER NOT NULL,
  blockNumber                TEXT NOT NULL,
  sourcePath                 TEXT NOT NULL,
  sourceSha256               TEXT NOT NULL,
  registeredTotal            INTEGER NOT NULL,
  metadataOk                 INTEGER NOT NULL,
  metadataHttpUnreachable    INTEGER NOT NULL,
  metadataOther              INTEGER NOT NULL,
  a2aOnly                    INTEGER NOT NULL,
  erc8183Only                INTEGER NOT NULL,
  both                       INTEGER NOT NULL,
  mcpOnly                    INTEGER NOT NULL,
  otherOrNone                INTEGER NOT NULL,
  protocolUnknown            INTEGER NOT NULL,
  declaredCandidateEndpoints INTEGER NOT NULL,
  publicCandidateEndpoints   INTEGER NOT NULL
);

CREATE TABLE hire_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  eventKey         TEXT NOT NULL UNIQUE,
  agentId          TEXT NOT NULL,
  chainId          INTEGER NOT NULL CHECK (chainId IN (56, 97)),
  phase            TEXT NOT NULL CHECK (phase IN (
    'clicked', 'quoted', 'quote_rejected',
    'created', 'funded', 'submitted', 'settled', 'refunded'
  )),
  provenance       TEXT NOT NULL
    CHECK (provenance IN ('marketplace_observed', 'chain_verified')),
  jobId            TEXT,
  txHash           TEXT,
  blockNumber      TEXT,
  occurredAt       INTEGER NOT NULL,
  verifiedAt       INTEGER
);
CREATE INDEX idx_hire_agent
  ON hire_events (chainId, agentId, occurredAt DESC);

CREATE TABLE runtime_state (
  key          TEXT PRIMARY KEY,
  textValue    TEXT,
  integerValue INTEGER,
  updatedAt    INTEGER NOT NULL
);

CREATE TABLE scheduler_attempts (
  id                              INTEGER PRIMARY KEY AUTOINCREMENT,
  messageId                       TEXT NOT NULL CHECK (length(messageId) BETWEEN 1 AND 256),
  scheduledTime                   INTEGER NOT NULL,
  attempt                         INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 4),
  phase                           TEXT CHECK (phase IS NULL OR phase IN ('header', 'sweep', 'probe')),
  outcome                         TEXT NOT NULL
    CHECK (outcome IN ('completed', 'failed', 'duplicate', 'locked')),
  startedAt                       INTEGER NOT NULL,
  finishedAt                      INTEGER NOT NULL CHECK (finishedAt >= startedAt),
  upstreamRequests                INTEGER NOT NULL CHECK (upstreamRequests >= 0),
  d1Queries                       INTEGER NOT NULL CHECK (d1Queries BETWEEN 1 AND 40),
  rowsReadObservedBeforeLedger    INTEGER NOT NULL CHECK (rowsReadObservedBeforeLedger >= 0),
  rowsWrittenObservedBeforeLedger INTEGER NOT NULL CHECK (rowsWrittenObservedBeforeLedger >= 0),
  errorCode                       TEXT,
  UNIQUE (messageId, attempt)
);
CREATE INDEX idx_scheduler_attempts_window
  ON scheduler_attempts (scheduledTime, messageId, attempt);
-- Triggers BEFORE UPDATE / BEFORE DELETE hacen RAISE(ABORT,
-- 'scheduler_attempts is append-only'): el append-only se aplica en la base,
-- no solo por disciplina de aplicación.
```

### 3.2 Invariantes de escritura

- `probe_observations`, `funnel_snapshots`, `hire_events` y
  `scheduler_attempts` son append-only. La aplicación no ejecuta `UPDATE` ni
  `DELETE` sobre ellas; `scheduler_attempts` además lo garantiza con triggers
  en la propia base.
- `probe_targets` solo se escribe si cambia un campo material. `lastSeenAt` se
  refresca como máximo una vez por hora.
- Un endpoint retirado pasa a `declarationState=removed`; no se borra ni se
  vuelve a sondear, pero permanece visible con explicación.
- `MAX(probedAt)` deriva la última observación; no existe `lastProbedAt` mutable.
- `eventKey` hace idempotentes los reintentos:
  - telemetría: UUID generado server-side;
  - chain: `chainId:txHash:phase`.
- `expired` se deriva del deadline/estado onchain y no se persiste como evento.
- No se guardan user ID, IP, cookie, sesión, user-agent, headers, payloads crudos
  del seller ni entregables arbitrarios.
- No hay purga automática durante la ventana de submission. WP0 estima el
  crecimiento de 30 días; cualquier retención posterior requiere un ADR y una
  exportación verificable antes de borrar observaciones.
- Buckets exclusivos:
  `a2aOnly + erc8183Only + both + mcpOnly + otherOrNone + protocolUnknown = registeredTotal`.
  `protocolUnknown` contiene metadata no resoluble; nunca se mezcla “desconocido”
  con “no declara protocolo”.

### 3.3 Claves de `runtime_state`

```text
scheduler_lease       textValue=runId, integerValue=expiresAt
sweep_offset          integerValue=offset
sweep_round           integerValue=vueltas completas
header_high_water     textValue=registeredAt:agentId
last_header_summary   textValue=JSON sanitizado
last_sweep_summary    textValue=JSON sanitizado
last_probe_summary    textValue=JSON sanitizado
last_scheduler_summary textValue=JSON sanitizado (`skipped_locked`, sin runId)
last_funnel_snapshot  integerValue=funnel_snapshots.id
next_scheduler_phase  textValue=header|sweep|probe
last_queue_scheduled_time integerValue=último scheduledTime encolado (dedup de ticks)
daily_budget_YYYYMMDD textValue=JSON sanitizado con invocaciones, outcomes,
                      requests, queries y filas D1 observadas antes del propio ledger
```

### 3.4 Índice de candidatos v2

La migración `0006_catalog_index.sql` añade:

- `catalog_agents`: identidad BSC, metadata de presentación acotada, categorías,
  estado de índice y si existe una configuración de contratación admitida;
- `catalog_endpoints`: endpoint normalizado único, protocolo, `originKey`,
  seguridad, representante y backoff;
- `catalog_agent_endpoints`: relación current/removed entre una identidad y un
  endpoint compartido;
- `catalog_observations`: evidencia append-only con `source`, `outcome`, TTL,
  status HTTP, duración, error normalizado y detalles sanitizados.

La migración `0007_bridge_probe_observations.sql` proyecta el historial legacy
de `probe_observations` hacia `catalog_observations` y crea un trigger
append-only para observaciones futuras. Así WP3 y el índice v2 cuentan el mismo
hecho una sola vez en sus respectivas vistas, sin hacer que una observación
genérica autorice una contratación.

Las rutas públicas son `GET /catalog-agents` y `GET /catalog-agent?agentId=`.
La lista acepta estado, búsqueda, categoría, página y límite. Los estados
`a2a`, `mcp`, `quote_capable` y `failed` consideran únicamente evidencia de
plataforma. `hireable` se deriva de una configuración de compra explícitamente
admitida y una declaración current; no depende de que la quote informativa del
Cron siga dentro de su ventana de 60 segundos, porque Hire solicita y valida una
quote nueva. Observar MCP/A2A o incluso una quote de investigación no basta para
exponer un CTA que pueda firmar y ejecutar el flujo completo.

La ficha devuelve el total exacto de intentos de plataforma y las últimas 50
observaciones detalladas. Si varias identidades comparten endpoint, la ficha lo
explica y atribuye esa evidencia compartida; no duplica requests para fabricar
conteos por identidad.

---

## 4. Scheduler, concurrencia y presupuesto

### 4.1 Un Cron producer y un Queue consumer Free-first

`*/5 * * * *` invoca `scheduled()` en el perfil Free. Esa invocación solo envía
`{schemaVersion: 1, scheduledTime}` a `WP2_QUEUE`. Un consumer con batch máximo
uno serializa mediante lease y comprueba el último timestamp completado; un
duplicado o tick anterior se confirma sin ejecutar trabajo. Cada entrega
aceptada ejecuta exactamente una
fase (`HEADER`, `SWEEP` o `PROBE`) y persiste la siguiente en
`next_scheduler_phase`; nunca carga el funnel completo en memoria. La expresión
Cron se despliega desde la configuración y debe coincidir con
`CRON_INTERVAL_MINUTES`.

Por tanto, con la rotación Free `HEADER → SWEEP → PROBE`, el Cron ocurre cada
cinco minutos y una fase PROBE ocurre nominalmente cada quince minutos. Esto no
significa que cada agente sea sondeado cada quince minutos: con
`PROBE_BATCH_SIZE=1`, la antigüedad por agente también depende de la rotación de
targets. Ninguna de esas cadencias controla si el comprador puede solicitar una
quote nueva bajo demanda.

1. Rechaza un batch distinto de uno y valida versión/timestamp del mensaje.
2. Genera `runId` aleatorio.
3. Adquiere `scheduler_lease` mediante `INSERT ... ON CONFLICT DO UPDATE ...
   WHERE integerValue <= now RETURNING key`.
4. Si no obtiene la fila, registra `skipped_locked`; el consumer no confirma el
   mensaje y solicita retry con 240 s de demora, compatible con el lease Free.
5. Ya como dueño, lee `last_queue_scheduled_time` junto al estado de fase. Un
   timestamp completado o anterior termina sin otra fase.
6. El lease Free expira antes de la siguiente ventana útil y siempre bajo el
   límite de 15 min de wall time.
7. Persiste `last_queue_scheduled_time` en el mismo `db.batch()` que el resumen,
   cursor y próxima fase; un fallo deja el tick reintentable y un éxito no puede
   avanzar dos fases al reentregarse.
8. Libera con `UPDATE ... WHERE textValue = runId`; una corrida no libera el
   lease de otra.

El lock es obligatorio aunque normalmente la corrida dure segundos. La fase no
avanza si su batch o resumen falla.

El perfil Paid queda bloqueado en runtime hasta validar su pipeline
`HEADER → SWEEP → PROBE` en staging y configurar explícitamente
`CLOUDFLARE_WORKERS_PLAN=paid`. Cambiar el perfil no desactiva `KILL_SWITCH` ni
activa el Cron por sí solo.

### 4.2 Presupuesto trust8004

```text
Free: max(1 HEADER, SWEEP_PAGES_PER_RUN, PROBE_BATCH_SIZE detalles)
Paid pipeline: 1 HEADER + SWEEP_PAGES_PER_RUN + PROBE_BATCH_SIZE detalles
+ 0 retries automáticos
<= TRUST8004_REQUESTS_PER_RUN

toda llamada trust8004 + BSC RPC + seller
<= EXTERNAL_SUBREQUESTS_PER_RUN
<= máximo operativo del perfil
```

Defaults iniciales:

```text
CLOUDFLARE_WORKERS_PLAN=free
CRON_INTERVAL_MINUTES=5
SCHEDULER_MODE=single_phase (derivado, no sobreescribible en Free)
HEADER_LIMIT=25                  producción/validation; máximo Free 100
PROBE_BATCH_SIZE=1              máximo Free 1
PROBE_AGENT_ALLOWLIST=303779    default seguro hasta cerrar gate egress general
PROBE_ENDPOINT_ALLOWLIST=https://bnb-agent-marketplace-ruby.vercel.app/grid
PROBE_GENERAL_EGRESS_APPROVED=0 wildcard falla cerrado sin gate explícito
CATALOG_PROBE_ENABLED=0         producción/validation
CATALOG_PROBE_BATCH_SIZE=1
SWEEP_LIMIT=4                   máximo Free 4 y siempre <= TRUST8004_REQUESTS_PER_RUN
SWEEP_PAGES_PER_RUN=1           máximo Free 1
TRUST8004_REQUESTS_PER_RUN=4
EXTERNAL_SUBREQUESTS_PER_RUN=12 máximo Free 40, plataforma 50
D1_QUERIES_PER_RUN=40           mínimo Free 38, máximo Free 40, plataforma D1 50
D1_ROWS_READ_PER_RUN=3000
D1_ROWS_WRITTEN_PER_RUN=60
PROBE_TIMEOUT_MS=5000
MAX_CATALOG_RESPONSE_BYTES=16777216
MAX_SELLER_RESPONSE_BYTES=32768

staging activo: HEADER_LIMIT=100, PROBE_GENERAL_EGRESS_APPROVED=1,
CATALOG_PROBE_ENABLED=1, PROBE_TIMEOUT_MS=10000 y ambos kill switches en 0

binding WP2_QUEUE                  Queue del mismo entorno
consumer max_batch_size=1, max_batch_timeout=1, max_retries=3,
         max_concurrency=1, retry_delay=60
```

La cotización bajo demanda corre en la ruta server-side del marketplace, no en
el Cron, y tiene un sobre separado respaldado por
`src/mainnet/browser-demo-config.ts`:

```text
ON_DEMAND_QUOTE_TIMEOUT_MS=30000  rango 1000..30000
MAX_SELLER_RESPONSE_BYTES=32768   rango 1024..65536
QUOTE_MIN_REMAINING_SECONDS=120   rango 1..900
SDK MAX_QUOTE_TTL_SECONDS=900     límite superior no sobreescribible
```

`ON_DEMAND_QUOTE_TIMEOUT_MS` es un deadline único de extremo a extremo para
resolver RPC, identidad, Agent Card, negociación y validación criptográfica;
no se reinicia por subrequest. La sincronización posterior de evidencia tiene
su propio presupuesto y no invalida una quote ya verificada.

El default Free es 30 s porque ahora cubre el recorrido completo y no cada
subrequest por separado. La medición E2E local del vendedor admitido superó
5 s; conservar aquel valor tras cambiar su semántica hacía fallar una quote
legítima antes de completar las comprobaciones. El límite sigue siendo
configurable y falla cerrado al vencer.

Estos parámetros pueden ampliarse dentro de sus rangos sin convertir D1 o el
probe periódico en autoridad de Hire. No se documenta cooldown configurable
hasta que exista enforcement ejecutable. Antes de exposición pública, el
endpoint server-side debe usar rate limiting distribuido por comprador/origen;
un contador en memoria de la Function sería engañoso por concurrencia y cambios
de instancia. Reintentar una quote hoy sigue sujeto a los límites del endpoint
server-side y cada respuesta se valida de nuevo.

Con cinco minutos hay 288 ticks/día. Queue consume 864 operaciones nominales
(write+read+delete) y 1.728 si cada mensaje usa los tres retries. D1 puede recibir
288 intentos nominales o hasta 1.152 intentos (entrega inicial + tres retries por
tick); son presupuestos distintos. Con los defaults, la proyección D1 es
864.000/17.856 filas leídas/escritas nominales y 3.456.000/71.424 en el peor
caso de retries. La configuración valida este último caso contra los techos
Free reservados de 4.000.000/80.000 y rechaza Queue por encima de 8.000
operaciones, manteniendo 20 % de margen. Con rotación de tres fases hay hasta
96 ejecuciones de SWEEP por día. A cuatro detalles son 384 agentes/día: una reconciliación global sería
inaceptablemente lenta, por lo que SWEEP Free opera sobre el conjunto live
priorizado y el funnel global permanece snapshot-backed. WP2 solo aumenta un
valor dentro del sobre Free si dos vueltas prueban:

- Cron producer con margen bajo 10 ms y Queue consumer con margen bajo 30 s de
  CPU, ambos sin `exceededCpu`;
- `memoryUsageBytesP999 < 100663296` (96 MiB) y cero outcomes de memoria
  excedida. Analytics expone percentiles muestreados, no un máximo literal;
- wall time p95 < 30 s;
- máximo 40 subrequests externos por invocación y presupuesto upstream
  configurado, incluyendo detalles;
- máximo 40 queries D1 por invocación; la deduplicación previa de Queue cuenta
  como una query, cada sentencia dentro de `db.batch()` cuenta individualmente y
  el contador rechaza el exceso antes de acceder a D1;
- proyección retry-aware y una ventana controlada real de 24 h por debajo de 4
  millones de filas D1 leídas/día y 80.000 escritas/día;
- cero 429;
- una página se procesa/libera antes de pedir la siguiente.

El código rechaza al arrancar una configuración Free que exceda el sobre o la
proyección diaria. Los valores medidos se documentan en `docs/DECISIONS.md`.

---

## 5. Flujos

### 5.1 WP0 / SNAPSHOT — evidencia y dimensionamiento

Una pasada completa ordenada por `registeredAt` ascendente, acotada a 55 req/min,
genera:

```text
evidence/funnel-bsc-YYYY-MM-DDTHH-mm-ssZ.json
```

Contiene:

- schemaVersion, generatedAt, chainId, bloque inicial y bloque de lectura wallet;
- URL base/parámetros sin secretos y headers de rate limit;
- total y distribución de metadata;
- buckets `a2aOnly`, `erc8183Only`, `both`, `mcpOnly`, `otherOrNone` y
  `protocolUnknown`;
- endpoints candidatos declarados y HTTPS sintácticamente públicos;
- top 10 dominios agregado, sin payloads;
- páginas, primer/último ID, timestamps ausentes, IDs duplicados por deriva de
  offset, errores y duración;
- SHA-256 del contenido canónico.

`sourceSha256` se calcula sobre el JSON canónico omitiendo el propio campo
`sourceSha256`; después se inserta el digest. Así el artefacto no contiene un hash
autorreferencial.

Clasificación exclusiva del protocolo:

1. metadata no resoluble/parseable → `protocolUnknown`;
2. A2A y ERC-8183 → `both`;
3. solo ERC-8183 → `erc8183Only`;
4. solo A2A → `a2aOnly`;
5. MCP sin A2A/ERC-8183 → `mcpOnly`;
6. cualquier otro caso con metadata resoluble → `otherOrNone`.

Checks bloqueantes:

- los seis buckets suman `registeredTotal`;
- `metadataOk + metadataHttpUnreachable + metadataOther = registeredTotal`;
- total a menos de 1 % del `countOnly` leído al inicio de la misma ventana de
  observación; la API no ofrece pinning transaccional y esa limitación queda
  explícita;
- una segunda lectura de páginas de muestra confirma el orden;
- artefacto sin secretos ni payloads completos;
- si declarantes A2A/ERC-8183 o endpoints candidatos superan 5.000, se detiene
  WP1 y se recalcula almacenamiento/cadencia. El snapshot encontró 21.210
  declarantes y 21.213 endpoints; el gate queda resuelto por el perfil Free y el
  conjunto live priorizado de esta versión, no aumentando infraestructura.

Después se actualiza la landing. WP1 importa el mismo resumen en
`funnel_snapshots` al sembrar la base por primera vez.

### 5.2 HEADER — registros recientes

Cada fase HEADER pide `HEADER_LIMIT` registros más recientes y procesa la página
completa para el conjunto legacy (25 en producción/validation, 100 en staging y
máximo 100 en Free; 200 por defecto en Paid);
nunca corta al encontrar el primer ID conocido.

Por elemento:

1. valida payload;
2. actualiza high-water `(registeredAt, agentId)`;
3. aplica filtro de sección 6;
4. upsert solo si cambió;
5. target nuevo/modificado recibe `priority=1`.

HEADER obtiene los targets existentes con una lectura acotada y agrupa todos los
writes de la página. No ejecuta `SELECT + INSERT/UPDATE` por elemento. El batch,
el resumen, el avance de fase y la liberación del lease deben caber juntos en
`D1_QUERIES_PER_RUN`; si el preflight excede el presupuesto, no se inicia ningún
write. Los upserts ORM se fragmentan en hasta siete targets por statement: 98
parámetros enlazados como máximo, por debajo del límite operativo de 100. Los
límites de schema mantienen cada string individual muy por debajo del máximo D1
de 2 MB.

Un elemento inválido o sin `registeredAt` se contabiliza como `invalidItems` y
no bloquea los elementos válidos de la página. No participa del high-water; si
la ventana completa contiene inválidos, `header_window_exhausted=true` fuerza la
señal conservadora de posible hueco.

Si una caída supera la ventana, `/health` muestra
`header_window_exhausted=true`; SWEEP recupera lo omitido dentro del conjunto
live. El check de frescura se calcula contra la cadencia y el límite del perfil,
no contra una constante de dos minutos.

Además, HEADER extrae identidades candidatas para el índice v2. Este write está
acotado a seis candidatos y tres declaraciones por candidato en cada tick Free.
El resumen publica `candidatesSeen`, `candidatesIndexed` y
`candidatesDeferred`. Los diferidos no se presentan como indexados en tiempo
real: entran en la siguiente reconciliación snapshot. Esta separación es
deliberada porque persistir cada identidad de una ráfaga compartida puede
superar la cuota diaria de D1 aun cuando solo represente un endpoint único.
Staging midió una página con 74 candidatos, seis indexados, 68 diferidos y un
endpoint único el 2026-08-30T22:20Z.

### 5.3 SWEEP — reconciliación rodante

Lee páginas ascendentes desde `sweep_offset`. En Free reconcilia únicamente IDs
ERC-8183 persistidos por HEADER y el inventario curado de cuatro categorías;
no intenta materializar los 309.897 registros globales. El cursor pagina esa
unión de IDs en D1 y resuelve un detalle trust8004 por agente. Por eso
`SWEEP_LIMIT` no puede superar `TRUST8004_REQUESTS_PER_RUN` en Free. Por página:

SWEEP agrupa por agente los retiros y la transición `metadata_unavailable`, de
modo que un historial acumulado no genera una sentencia por endpoint. Cada
agente usa como máximo dos upserts/refreshes y un UPDATE agrupado. Config conserva
un envelope deliberadamente más conservador equivalente a seis slots por agente;
por eso Free limita `SWEEP_LIMIT<=4` y exige `D1_QUERIES_PER_RUN>=38`, quedando
el default 4/40 bajo el límite duro de 50.
Antes del batch calcula también las filas que afectarán los updates agrupados y
aborta si target writes más estados de fase superarían el presupuesto restante;
así una acumulación histórica anómala no avanza cursor/completion antes de que el
wrapper pueda observar las filas escritas.

La unión usa todos los IDs que ya tienen un target elegible persistido,
independientemente de transporte o `declarationState`, más los IDs curados. Esa
base es monotónica: marcar un target `removed` o `metadata_unavailable` no reduce
el conjunto bajo un `OFFSET` ya persistido.

1. valida/procesa una respuesta en memoria;
2. compara candidatos;
3. actualiza solo cambios;
4. marca `removed` endpoints antes declarados que ya no aparecen;
5. ejecuta writes y nuevo offset en un `db.batch()`.

Cada sentencia del batch consume una query del presupuesto. SWEEP calcula el
costo completo antes de ejecutar el batch; no lo divide después de comenzar a
escribir. La lectura de candidatos usa una consulta acotada y respeta el máximo
de 100 parámetros enlazados por query.

Al final guarda resumen y vuelve el offset a cero. Un fallo antes del batch no
adelanta cursor; repetir página es idempotente.

### 5.4 PROBE — candidatos

Selección inicial Free: declarantes ERC-8183 primero y después inventario curado;
los A2A globales no curados no consumen probes. Selección:

```sql
SELECT current targets
LEFT JOIN latest observation per target
ORDER BY priority DESC, latest.probedAt ASC NULLS FIRST
LIMIT PROBE_BATCH_SIZE
```

Después del target legacy, el mismo tick puede ejecutar un probe genérico v2 si
`CATALOG_PROBE_ENABLED=1`. Selecciona endpoints seguros con representante por
`nextProbeAt ASC`, prioridad y antigüedad; así un endpoint prioritario ya
programado no bloquea para siempre uno nunca probado. El lote Free es uno. A2A
valida Agent Card, MCP realiza `initialize` + `tools/list`, web/HTTP exige JSON
válido y ERC-8183 se conserva como protocolo separado. Éste es un chequeo de
transporte: no convierte MCP/A2A en una quote ni en contratación.

Éxito programa 15 minutos; fallo aplica backoff acotado y mantiene la última
evidencia. Toda observación es append-only y los logs exponen solo conteos,
protocolos y códigos normalizados, nunca endpoint/payload/secreto.

Cada target, secuencialmente:

1. pide perfil actual y reconcilia metadata/endpoints; si falla, marca
   `metadata_unavailable`, conserva la última observación, no contacta al seller
   y no lo clasifica como `unreachable`;
2. si endpoint ya no está declarado, actualiza target y no lo contacta;
3. elige la categoría menos recientemente probada de `categoriesJson`, usando el
   orden estable `rebalancing`, `grid_trading`, `yield_optimisation`,
   `health_factor_monitoring` para desempatar; si está vacío usa readiness neutro;
4. resuelve `getAgentWallet`; si zero/vacío, usa `ownerOf` y
   `walletSource=ownerOf`;
5. crea transporte seguro;
6. obtiene Agent Card o `/erc8183/health` + `/erc8183/status`;
7. envía términos deterministas de categoría;
8. valida rechazo/quote;
9. inserta una observación sanitizada, incluido `probeCategory`;
10. mantiene `priority=1` mientras alguna categoría curada no tenga observación;
    cuando todas tengan al menos una, pone `priority=0`.

WP3 aplica dos allowlists acumulativas y fail-closed antes de cualquier request
trust8004, seller o RPC: `agentId` debe pertenecer a
`PROBE_AGENT_ALLOWLIST` y el endpoint reconciliado debe coincidir exactamente
con una URL de `PROBE_ENDPOINT_ALLOWLIST` (scheme, host, puerto y path; sin
query ni fragment). Un ID o endpoint fuera de allowlist no consume red ni crea
observación. En Free ambas listas admiten un único elemento; ampliar cualquiera
requiere promoción explícita del perfil y repetir los gates de staging.
Para el target Grid de WP3, la Agent Card también debe anunciar exactamente la
ruta derivada `https://bnb-agent-marketplace-ruby.vercel.app/api/sellers/grid/a2a`;
otra ruta, aunque comparta origin, falla antes del POST.

Clasificación:

```text
URL rechazada antes de fetch                         -> unsafe_url
timeout, red, HTTP 5xx                               -> unreachable
HTTP responde pero JSON/protocolo es inválido        -> reachable
rechazo ERC-8183 estructurado y validado              -> quote_rejected
protocolo válido sin quote por condición demostrable -> protocol_valid
quote presente que falla una condición               -> quote_invalid
quote que pasa todas las condiciones                  -> quote_verified
error interno/RPC/D1                                  -> error
```

Un 4xx u objeto con `error` no prueba el protocolo. El rechazo debe pasar el
parser ERC-8183/A2A cubierto por tests.

### 5.5 Términos por categoría

Los strings siguientes son normativos: cambiar un carácter cambia el hash y
requiere actualizar fixture, test y `schemaVersion` del template.

| Categoría | `taskDescription` exacto |
| --- | --- |
| `rebalancing` | `REBALANCE_READINESS_V1:{"currentBps":{"BNB":6000,"USDT":4000},"targetBps":{"BNB":5000,"USDT":5000}}` |
| `grid_trading` | `GRID_PLAN_V1:{"pair":"BNB/USDT","lowerPrice":"700","upperPrice":"900","capital":"1000","gridCount":9}` |
| `yield_optimisation` | `YIELD_READINESS_V1:{"capital":"1000","currency":"USDT","maxProtocols":3,"risk":"moderate"}` |
| `health_factor_monitoring` | `HEALTH_FACTOR_READINESS_V1:{"collateral":"10 BNB","debt":"2000 USDT","warningThreshold":"1.50","criticalThreshold":"1.20"}` |

`TermSpecification` exacta:

| Categoría | `deliverables` | `qualityStandards` |
| --- | --- | --- |
| `rebalancing` | `Deterministic portfolio rebalancing plan with target deltas and assumptions` | `Analysis only, deterministic output, no order execution and no custody` |
| `grid_trading` | `Deterministic Grid plan JSON with levels, allocation, triggers and assumptions` | `Deterministic output, no order execution and no custody` |
| `yield_optimisation` | `Deterministic comparison of yield options with allocation rationale and assumptions` | `Analysis only, no deposits, no transaction execution and no custody` |
| `health_factor_monitoring` | `Deterministic health-factor assessment with thresholds, alerts and suggested actions` | `Analysis only, no transaction execution and no custody` |

El diccionario normativo producido por `@bnbagent/sdk@0.5.0` incluye además
`terms.evaluation_required=true` y `terms.evaluator_type="uma_oov3"`. Esos dos
campos participan en el hash y no pueden omitirse. La versión del artefacto es
`probeRequestSchemaVersion=1`; vive junto a los templates del Worker y todo
cambio de bytes incrementa esa versión y regenera fixtures y hashes.

Hashes esperados, calculados con `@bnbagent/sdk@0.5.0` el 2026-08-27:

| Categoría | `NegotiationRequest.computeHash()` |
| --- | --- |
| `rebalancing` | `0x30c4d87009384d98601811722a9982fbe95d4efd65b5f891e46937832e9c0288` |
| `grid_trading` | `0x697a15f62a1748230d3e4bdbbe24f6a619d1b82d45f1e4c82787e268ab2497d3` |
| `yield_optimisation` | `0xf932f814bf58850fca34c32d25dc38890041079f75014d4e400bb92d607c9970` |
| `health_factor_monitoring` | `0xb31d452e27e497cb57af53f4f0caa9ed394d1c19acdab34e18aefe4924378ef4` |

El template Grid coincide con `GRID_CANONICAL_INPUT`, `GRID_NEGOTIATION_TERMS` y
`gridTaskDescription()` del marketplace; WP3 compara ambos hashes como gate. Cada
template tiene fixture, hash esperado y test. Si no se puede asignar categoría,
se usa el `NegotiationRequest` neutro de `src/readiness/protocols.ts` y
`categoriesJson=[]`; nunca se autoasigna categoría por la respuesta del seller.

### 5.6 RENDER

```text
Worker disponible -> feed cacheado hasta 60 s -> evidencia informativa calculada al leer
Worker no disponible -> observación no disponible; conservar solo declaraciones live
```

La ficha consulta trust8004 en vivo para identidad y declaraciones. Una caída del
Worker no elimina ese contenido, pero tampoco autoriza reutilizar observaciones
vencidas ni el snapshot de release como estado actual. Los 60 segundos son el
TTL de transporte/cache del feed, no la cadencia de PROBE, la vigencia máxima de
una quote ni una condición para mostrar la entrada al flujo de contratación.

La portada es Mainnet-first. Sin wallet conectada, durante SSR/hidratación, en
`chainId=56` y en cualquier red no soportada, CTA, copy y tarjeta principal
apuntan a BSC Mainnet. Solo una wallet conectada que reporte `chainId=97` cambia
esa isla de UI a la demo y prueba histórica de BSC Testnet. El cambio de red se
refleja sin recargar. Job Testnet `551` nunca es fallback ni prueba Mainnet; si
el artefacto canónico Mainnet todavía no contiene un job completado, la tarjeta
se presenta como flujo de contratación/cotización y no como `Onchain proof`.

### 5.7 HIRE y TRACK

1. Todo seller ERC-8183 compatible admitido por el allowlist activo muestra una acción funcional para pedir una
   quote; la disponibilidad o antigüedad de `/observations` no la oculta.
2. `Hire` o `Refresh quote` registra `clicked` mediante ruta server-side.
3. Marketplace vuelve a resolver perfil, endpoint y wallet.
4. Pide una quote fresca bajo demanda; nunca reutiliza la del probe ni una quote
   transaccional anterior. El comprador puede volver a pedirla antes de firmar.
5. Valida con sección 8.
6. Publica al Worker solamente el outcome y los campos sanitizados permitidos
   por 10.1, con provenance de refresh solicitado por comprador. La quote
   completa, firma, headers y payloads nunca entran al feed público.
7. Muestra token, allowance, budget, deadline y transacciones.
8. Wallet inyectada firma/envía directamente a BSC.
9. Tras cada receipt, lee receipt/estado onchain antes de emitir
   `chain_verified`.
10. Track/Result leen BSC; D1 conserva solo referencia idempotente observada.

`BUYER_OBSERVATION_SECRET` solo existe en Vercel server y Worker y es distinto
del `SHARED_SECRET` administrativo. Vercel solo lo envía por HTTPS, sin userinfo,
hacia el origen que coincide exactamente con
`BUYER_OBSERVATION_ALLOWED_ORIGIN`. El navegador llama una ruta same-origin;
esta valida, elimina contexto y reenvía.

`OBSERVATIONS_URL` es una URL server-side del feed público del Worker, por
ejemplo `https://worker.example/observations`; desde su origen también se
derivan `/catalog-agents`, `/catalog-agent` y las rutas internas de escritura.
`BUYER_OBSERVATION_ALLOWED_ORIGIN` contiene solamente el origen HTTPS exacto
del Worker y funciona como allowlist de salida para impedir SSRF o exfiltración
del bearer; no es una configuración CORS ni contiene el dominio del
marketplace. Toda validación ejecutada por marketplace devuelve además el
resultado de persistencia (`recorded`, `partial`, `failed`, `not_configured` o
`not_attempted`) y sus conteos. La UI no puede decir ni insinuar que el índice
compartido fue actualizado si ese estado no es `recorded`.

La respuesta separa además admisión de validación. Un tercero que responde una
quote válida queda como `quote_verified_candidate`, con `canHire=false`, hasta
una admisión manual; guardar evidencia nunca lo promueve. Un seller que ya
estaba configurado por el marketplace devuelve `marketplace_configured` y
`canHire=true`, sin afirmar que la validación lo promovió. En ambos casos el
CTA Hire pide y valida una quote nueva antes de solicitar firmas.

La autoridad para continuar a `prepare` y pedir firmas es la quote transaccional
recién solicitada y validada, junto con las relecturas onchain requeridas. Ni una
fila D1, ni `/observations`, ni el snapshot de release autorizan Hire. Si
Worker/D1 falla, el catálogo marca la evidencia compartida como no disponible,
pero un seller ERC-8183 compatible y admitido todavía puede recibir una solicitud bajo
demanda. Si la validación de esa solicitud falla, la UI muestra el motivo y
permite reintentar; nunca sustituye silenciosamente el flujo por la demo.

La escritura de evidencia sanitizada es posterior y no es autoridad
transaccional. Si no puede confirmarse, la sesión válida puede continuar con un
estado explícito `evidence sync pending`, mientras el feed público conserva su
último hecho confirmado y no finge haberse actualizado.

---

## 6. Descubrimiento y catálogo monotónico

### 6.1 Filtro

Un endpoint entra como target actual si cumple el filtro técnico siguiente y,
en Free, su agente declara ERC-8183 o pertenece al inventario curado:

1. `chainId === 56`;
2. metadata disponible y parseada;
3. está en `services[]` o `endpoints[]`;
4. nombre normalizado con `toLowerCase().replace(/[^a-z0-9]/g, "")`:
   - `a2a` → `a2a`;
   - `erc8183` → `erc8183_http`;
5. HTTPS sin credenciales y aceptada por política segura;
6. máximo dos endpoints por agente, en orden estable.

No se exige `agentWallet` de trust8004. MCP-only y A2A global no curado alimentan
el funnel, no targets live en Free ni sellers contratables. Un agente que solo
declara MCP permanece visible con explicación literal y `View evidence`; nunca
recibe un CTA de contratación ERC-8183.
`categoriesJson` es un array ordenado y sin duplicados exportado desde
`marketplaceInventoryEntries()` de
`src/data/inventory/marketplace-inventory.ts`, con provenance
`derived:marketplace-inventory` y estado `candidate_unverified`. El Worker no
ejecuta `classifyProfile()` sobre el catálogo global y la respuesta del probe
nunca añade categorías. Targets fuera del inventario curado usan `[]`.

### 6.2 Estados visibles

- `current`: declarado; elegible para probe.
- `removed`: ya no declarado; visible sin Hire.
- `metadata_unavailable`: no reconciliado; visible con última evidencia buena.
- `unreachable`: target actual cuyo último probe falló; visible.

Ausencia temporal nunca equivale a eliminación o fraude.

---

## 7. Transporte seguro

La implementación Node existente no se copia literalmente: Workers no ofrece el
mismo pinning mediante `undici.Agent`. Se reutilizan listas, normalización,
límites, mensajes y tests; se escribe adaptador Workers.

Controles:

- solo `https:` y sin username/password;
- rechazar query y fragment; un endpoint persistido nunca contiene secretos URL;
- rechazar `localhost`, `.localhost`, `.local` y literales IP no públicos;
- portar todos los rangos de `src/verification/safe-http.ts`, no solo RFC1918;
- usar proxy de salida público de Workers; no fingir DNS pinning. Para WP3 el
  hostname/path exacto queda fijado por allowlist; aceptar el egress de
  Cloudflare como frontera de confianza para targets generales es un gate de
  arquitectura de WP4, no una garantía ya demostrada;
- `redirect: "manual"`, rechazar todo 3xx/`opaqueredirect` y nunca leer/seguir
  `Location`;
- deadline monotónico único configurable para todo el target (reconciliación,
  RPC y seller): 5 s por defecto Free y máximo configurable 10 s;
- 32 KiB descomprimidos por respuesta por defecto Free, máximo configurable
  64 KiB; además máximo agregado 64 KiB por target, abortando el stream;
- `Accept: application/json` y parseo en el borde;
- máximo dos endpoints por agente; probes secuenciales;
- nunca enviar cookies, Authorization, secretos ni headers de usuario;
- nunca persistir/reflejar payloads o errores crudos.

Tests mínimos: IPv4/IPv6 privados/reservados/documentación/multicast/mapped,
credenciales, redirects, timeout, body mayor de 64 KiB (también comprimido), DNS
sin respuesta, JSON inválido y sanitización de query/body.

El egress real se prueba en staging; Miniflare no demuestra el proxy productivo.

---

## 8. Quote verificada

`quote_verified` exige:

1. request/response pasan parser SDK;
2. `request_hash` coincide con `NegotiationRequest` exacto;
3. `negotiation_hash` válido y conservado;
4. firma EIP-191/ERC-1271 válida en el bloque fijado para el probe;
5. `provider_address` es obligatorio; provider y signer recuperado son iguales
   a la wallet resuelta onchain en el mismo bloque, nunca a una address
   autodeclarada sin verificación;
6. `negotiated_at`: máximo 60 s futuro y edad máxima 60 s;
7. expiración futura/posterior a negociación y ventana máxima 900 s;
8. price entero positivo raw;
9. currency igual a `paymentToken()` y `$U` configurado;
10. `verifying_contract` igual a Commerce;
11. Commerce y Router coinciden con las constantes BSC Mainnet versionadas,
    Policy coincide con la constante y `policyWhitelist(policy)=true`;
12. para HTTP, `/status` coincide en agent, contratos, currency y `decimals()`
    leído del payment token en el mismo bloque.

El Worker toma primero un bloque BSC fresco y fija `blockNumber` en todas las
lecturas del verdict: `getAgentWallet`/`ownerOf`, `paymentToken`, `decimals`,
`policyWhitelist`, bytecode y ERC-1271. Verifica `chainId=56`; el RPC HTTPS
configurado es una fuente operativa explícitamente confiada y toda llamada usa
el mismo contador de subrequests. Un bloque con timestamp futuro o más de 120 s
de atraso aborta el probe como `error`, sin contactar al seller.
Las lecturas read-only se agrupan en Multicall después de fijar el bloque. El
peor caso WP3 usa 1 trust8004 + 2 seller + 7 RPC: contexto inicial
(`eth_chainId`, bloque y Multicall) y verificación SDK (`eth_chainId`, relectura
del mismo bloque, bytecode e `isValidSignature`). Son 10 subrequests en total,
por debajo del default Free 12; EOA evita las dos últimas y usa 8.

Para A2A, `notify_funded` significa un único skill ID exacto presente; skills
adicionales son válidas. Si ambos aliases de negociación existen se prefiere
`negotiate-erc8183-job`. El probe jamás invoca `notify_funded`. Un hash de
negociación repetido dentro de la ventana solo es una observación fresca, no una
prueba única de liveness; Hire siempre vuelve a cotizar.

Un rechazo verificable es una respuesta SDK bien formada, ligada al
`request_hash` enviado, con `accepted=false` y un reason/code de protocolo
sanitizable. `protocol_valid` requiere Agent Card/health/status completos pero
una condición previa demostrable impide pedir quote. HTTP 4xx, redirect, JSON
inválido o body excedido prueban como máximo reachability; 5xx/red/timeout son
`unreachable`. Los campos financieros solo se persisten para quotes que pasaron
su validación correspondiente.

El probe no crea, financia ni ejecuta jobs.

---

## 9. Etiqueta y acción calculadas al leer

```text
removed              -> Declaration changed
metadata_unavailable -> Metadata unavailable · last good <timestamp>
metadata version != observed -> Reverification required
latest unreachable   -> Unreachable at <timestamp> · last verified <timestamp|null>

latest quote_verified
AND metadata version matches
AND endpoint current
  -> Recently verified <timestamp>; evidencia informativa

seller current con transporte ERC-8183 compatible y allowlist activo
  -> Get fresh quote / Refresh quote, aunque la observación sea antigua o unavailable

MCP-only o sin transporte ERC-8183 compatible
  -> Not hireable through marketplace + View evidence

otherwise -> literal outcome + timestamp
```

En una vista filtrada por categoría se usa la última observación de esa categoría,
no la última observación global del endpoint. Para targets sin categoría se usa
la observación neutra/global.

`Recently verified` significa que el probe pasó la política en ese timestamp;
no es promesa, endorsement ni autorización transaccional. La acción de contratar
siempre vuelve a pedir quote y leer wallet/allowlist antes de firma. La quote
obtenida bajo demanda sí debe conservar al menos la vigencia exigida por la
política al preparar las transacciones; si ya no la conserva, se solicita otra.
`ownerOf` se muestra como `onchain default`, no wallet específica verificada.

---

## 10. Contrato HTTP del Worker

### 10.1 `GET /observations`

Público:

```text
Cache-Control: public, s-maxage=60, must-revalidate
Content-Type: application/json
```

```ts
type Outcome =
  | "quote_verified" | "protocol_valid" | "quote_rejected" | "quote_invalid"
  | "reachable" | "unreachable" | "unsafe_url" | "error";

type MarketplaceCategory =
  | "rebalancing" | "grid_trading"
  | "yield_optimisation" | "health_factor_monitoring";

type LatestObservation = {
  probedAt: number;
  probeCategory: MarketplaceCategory | null;
  outcome: Outcome;
  observedMetadataUpdatedAt: number | null;
  observedWallet: string | null;
  observedWalletSource: "agentWallet" | "ownerOf" | null;
  observedBlockNumber: string | null;
  onchainObservedAt: number | null;
  commerce: string | null;
  router: string | null;
  policy: string | null;
  priceRaw: string | null;
  currency: string | null;
  decimals: number | null;
  requestHash: string | null;
  negotiationHash: string | null;
  quoteNegotiatedAt: number | null;
  quoteExpiresAt: number | null;
  signatureMethod: "eip191" | "erc1271" | null;
  errorCode: string | null;
  httpStatus: number | null;
  durationMs: number;
};

type ObservationsResponse = {
  schemaVersion: 1;
  generatedAt: number;
  monitoring: {
    lastSchedulerAttemptAt: number | null;
    lastSchedulerPhase: "header" | "sweep" | "probe" | null;
    lastSchedulerOutcome: "completed" | "failed" | "duplicate" | "locked" | null;
    producerEnabled: boolean;
    consumerEnabled: boolean;
    cronIntervalMinutes: number;
  };
  funnel: {
    measuredAt: number;
    blockNumber: string;
    sourceSha256: string;
    registeredTotal: number;
    metadataOk: number;
    metadataHttpUnreachable: number;
    metadataOther: number;
    a2aOnly: number;
    erc8183Only: number;
    both: number;
    mcpOnly: number;
    otherOrNone: number;
    protocolUnknown: number;
    declaredCandidateEndpoints: number;
    publicCandidateEndpoints: number;
  } | null;
  targets: Array<{
    agentId: string;
    chainId: 56;
    transport: "a2a" | "erc8183_http";
    endpoint: string;
    name: string | null;
    categories: MarketplaceCategory[];
    categoryProvenance: "derived:marketplace-inventory" | null;
    declarationState: "current" | "removed" | "metadata_unavailable";
    currentMetadataUpdatedAt: number | null;
    lastMetadataCheckedAt: number;
    attemptCount: number;
    firstProbedAt: number | null;
    lastProbedAt: number | null;
    latest: LatestObservation | null;
    latestByCategory: Partial<Record<MarketplaceCategory, LatestObservation>>;
    lastQuoteVerifiedAt: number | null;
    lastQuoteVerifiedAtByCategory: Partial<Record<MarketplaceCategory, number>>;
  }>;
};
```

Nunca devuelve firma, payload crudo, headers o errores externos.

`generatedAt` es la hora de construir esta respuesta, no transforma una
observación histórica en un hecho actual. `latest` y `latestByCategory` siempre
conservan su `probedAt`; las etiquetas de lectura derivan frescura y expiración
contra ese timestamp y los timestamps de metadata/quote.

La última observación por target/categoría se elige por mayor `probedAt` y usa
el mayor `id` solo para desempatar timestamps iguales; un backfill insertado más
tarde no puede reemplazar una observación cronológicamente nueva.

El Worker rechaza query strings en `/observations` y guarda la respuesta 200
canónica en Cache API con una clave interna ligada al SHA-256 del allowlist de
agentes; cambiar el scope nunca puede reutilizar el feed anterior. Un 503 nunca
se cachea. El marketplace puede reutilizar una
respuesta HTTP en su cache local solamente durante 60 segundos. Después vuelve
a consultar al Worker. No usa `stale-if-error` ni promueve el snapshot de release
a fallback de observaciones. Una observación antigua que el Worker devuelve con
su `probedAt` real sí se conserva como evidencia histórica; nunca se presenta
como estado actual. Este TTL limita la reutilización del feed; no impone PROBE
cada minuto y no bloquea una nueva quote bajo demanda. Reachability actual usa
la ventana operativa de 15 minutos; la quote transaccional sigue requiriendo una
negociación nueva y su propia ventana de 60 segundos. Si
Worker/D1 no responde:

Mientras rige el allowlist exacto, las cuatro lecturas del feed se filtran por
esos agent IDs antes de leer filas; el crecimiento de targets descubiertos por
HEADER no agranda la respuesta pública. El wildcard general requiere antes un
contrato paginado/materializado y su gate de egress, no un scan público sin
techo. Aunque el egress general se apruebe, `/observations` responde 503 cuando
la lista de agentes queda wildcard/vacía hasta que exista ese contrato acotado.

- el catálogo puede seguir mostrando identidad, metadata y endpoints declarados
  obtenidos en vivo de trust8004;
- toda procedencia `observed` se muestra como `Temporalmente no disponible`, con
  la última fecha solo cuando se presenta explícitamente como evidencia histórica;
- reachability actual y claims derivados de observaciones quedan
  deshabilitados; la acción para solicitar una quote nueva sigue disponible
  únicamente para sellers ERC-8183 compatibles admitidos por el allowlist activo;
- si trust8004 tampoco responde, se muestra catálogo temporalmente no disponible,
  no una lista de agentes tomada de un snapshot vencido.

El snapshot WP0 del funnel es una excepción deliberada: es una medición histórica
agregada, visible siempre con fecha, bloque y SHA-256. Nunca se etiqueta `current`
ni sustituye el estado actual de agentes individuales.

El snapshot de release generado el 2026-08-25 expiró el
2026-08-28T23:39:15.884Z. Puede conservarse en una ruta de metodología
etiquetada como histórica, pero no existe ningún adaptador activo que lo use
como catálogo, observación o autorización de Hire.

### 10.2 `GET /health`

Público, sanitizado y de costo constante: una sola lectura acotada de
`runtime_state`, sin `COUNT`/scan de `probe_targets`. Expone última fase,
offset/vuelta, lease como booleano+expiración (no runId), requests, CPU/wall
time, último código de error, kill switch y ledger UTC corriente. Los conteos de
targets se marcan no disponibles aquí y pertenecen a endpoints/artefactos de
observación deliberados. Devuelve 200 con `status=degraded` ante una fase mala,
un error de scheduler posterior a la última fase sana o scheduler activo sin
ledger diario válido/fresco. Fresco significa
`updatedAt` dentro de tres intervalos Cron, con mínimo de 15 min, y no más de
cinco minutos en el futuro; 503 solo si no lee D1.

### 10.3 `POST /hire-events`

Privado servidor-a-servidor:

- Bearer secret, body JSON máximo 8 KiB, enum cerrado/campos desconocidos fuera;
- comparación constante del secreto;
- telemetría con `marketplace_observed`;
- fases onchain con `chain_verified`, jobId y txHash obligatorios;
- `chainId` 56 o 97: `hire_events` es la única tabla que admite Testnet, porque
  la demo de contratación y el comprador agente ejecutan allí; cada cadena se
  verifica contra su propio despliegue y su propio RPC (`BSC_RPC_URL`,
  `BSC_TESTNET_RPC_URL`), y sin RPC la fase responde 503 y no se guarda;
- receipt, contrato, evento y jobId verificados por RPC antes del insert; el
  estado actual debe existir y ser compatible con haber pasado por la fase, no
  ser exactamente una fase histórica que el job ya superó;
- `occurredAt` lo asigna el servidor: hora de recepción para telemetría y
  timestamp del bloque para chain; nunca se acepta como verdad desde browser;
- conflicto `eventKey` devuelve 200 idempotente;
- sin CORS de escritura; navegador nunca conoce la ruta.

---

## 11. Configuración

Secrets:

```text
SHARED_SECRET
BSC_RPC_URL
```

Variables:

```text
TRUST8004_BASE_URL=https://trust8004.xyz/api/app
CLOUDFLARE_WORKERS_PLAN=free
KILL_SWITCH=1
PRODUCER_KILL_SWITCH=1
DEPLOYMENT_ENV=production   # staging|validation en sus entornos Wrangler
STAGING_MANUAL_RUN=0
CRON_INTERVAL_MINUTES=5
HEADER_LIMIT=25
SWEEP_LIMIT=4
SWEEP_PAGES_PER_RUN=1
PROBE_BATCH_SIZE=1
PROBE_AGENT_ALLOWLIST=303779
PROBE_ENDPOINT_ALLOWLIST=https://bnb-agent-marketplace-ruby.vercel.app/grid
PROBE_GENERAL_EGRESS_APPROVED=0
CATALOG_PROBE_ENABLED=0
CATALOG_PROBE_BATCH_SIZE=1
TRUST8004_REQUESTS_PER_RUN=4
EXTERNAL_SUBREQUESTS_PER_RUN=12
D1_QUERIES_PER_RUN=40
D1_ROWS_READ_PER_RUN=3000
D1_ROWS_WRITTEN_PER_RUN=60
PROBE_TIMEOUT_MS=5000
MAX_CATALOG_RESPONSE_BYTES=16777216
MAX_SELLER_RESPONSE_BYTES=32768
```

`WP2_QUEUE` no es una variable: es un binding Wrangler obligatorio cuando el
kill switch está abierto. Staging y producción usan nombres de Queue distintos.
Vercel configura `OBSERVATIONS_URL` con el endpoint público `/observations` del
entorno Cloudflare correspondiente; no es secreto y nunca se expone como
`NEXT_PUBLIC_` porque la lectura ocurre en Server Components.
Estado previo a la promoción, medido 2026-08-31: Preview de Vercel contenía las
tres variables y el desarrollo local leía el catálogo público de staging,
mientras Production todavía carecía de `OBSERVATIONS_URL`,
`BUYER_OBSERVATION_ALLOWED_ORIGIN` y `BUYER_OBSERVATION_SECRET`. Ese estado se
usó como baseline y no se declaró productivo.

Promoción staging medida 2026-08-31: D1 aplicó
`0007_bridge_probe_observations.sql`, importó 180 observaciones históricas y el
Worker `bnb-agent-probe-staging` quedó en version
`80c76b08-0467-4e14-ba41-08f3902164b0`, con Cron `*/5 * * * *`. Consultas HTTP
desde el Preview del commit `24fdea3` mostraron 29.930 candidatos declarados,
14 con declaración ERC-8183 y exactamente un seller configurado como
contratable (`303779`). Una validación real de ese seller verificó A2A y quote,
persistió 2/2 observaciones y devolvió `marketplace_configured`, `canHire=true`
y Passport `hireable`.

El cierre de Production se midió el 2026-08-31 después de rotar, sin exponer su
valor, un mismo `BUYER_OBSERVATION_SECRET` en Vercel Preview, Vercel Production
y Worker staging. Las tres variables server-side quedaron confirmadas por
nombre en ambos entornos Vercel. El PR #43 se fusionó a `main` en el commit
`750c90232232fcf100af04f7814f9fb04a247afd` a las 09:42:42Z y Vercel dejó
`dpl_H7HuJ64Zb5vU72SzzRCCFdNPUrea` Ready en Production.

Las consultas Production a `/agents?view=marketplace`,
`/agents?view=marketplace&status=hireable` y
`/agents?view=marketplace&status=erc8183` devolvieron HTTP 200, monitorización
conectada y la narrativa del índice normalizado, no el fallback híbrido. El
índice compartido midió 29.994 candidatos declarados, 14 con declaración
ERC-8183 y exactamente un hireable (`303779`) entre 09:45:22Z y 09:45:25Z.

La validación Production de `303779` a las 09:46:26Z verificó identidad en el
bloque BSC `119129868`, A2A y quote; devolvió `observationSync=recorded` 2/2,
`marketplace_configured`, `canHire=true` y Passport `hireable`. El conteo D1
filtrado para ese agente y fuente `marketplace_probe` subió de 199 a 201; las
filas nuevas `247` y `248` registraron respectivamente
`erc8183/quote_verified` y `a2a/protocol_valid`.

La rotación dejó activa al 100 % la versión Worker
`b492f10e-7285-4345-8586-d3eae3e7e421`, disparada por cambio de secreto, con
D1 staging `6fbeea3e-4516-4c4e-a5c4-392cb067198a`, Queue staging y ambos kill
switches en `0`. El feed confirmó productor y consumidor activos, intervalo de
cinco minutos y un HEADER completado a las 09:45:26Z; el Cron declarado sigue
siendo `*/5 * * * *`.
La sincronización de quotes configura además `BUYER_OBSERVATION_ALLOWED_ORIGIN`
y `BUYER_OBSERVATION_SECRET`; Cloudflare recibe este último como secret del
Worker. `SHARED_SECRET` permanece reservado para la ruta administrativa de
staging y no autentica escrituras de compradores.
El Cron falla cerrado si falta el binding y nunca ejecuta la fase directamente.

`bnb-agent-probe/src/config.ts` es la fuente ejecutable WP1 de defaults, máximos
y validación, y es la única fuente ejecutable: el bootstrap previo del
marketplace y su test de paridad se eliminaron el 2026-08-29, cumplido el
criterio de WP2 de mover la política de rotación al Worker. Free es el
fallback cuando falta la variable de plan. En Paid los
defaults vuelven a 200/2000×2/10 y pipeline, pero requieren
`CLOUDFLARE_WORKERS_PLAN=paid`; cualquier cambio de plan se despliega primero con
`KILL_SWITCH=1` y sin Cron Trigger activo.

### 11.1 Runbook local obligatorio con Wrangler

WP1–WP3 se validan primero contra el runtime y D1 locales de Wrangler. Ningún
comando local usa `--remote`, crea recursos productivos ni necesita activar el
plan Paid.

Desde `bnb-agent-probe`:

```bash
npm ci
npx wrangler d1 migrations list bnb-agent-probe --local
npx wrangler d1 migrations apply bnb-agent-probe --local
npx wrangler dev --test-scheduled
```

Con el servidor local activo:

```bash
curl --fail http://localhost:8787/health
curl --fail "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

El endpoint scheduled local se invoca primero con `KILL_SWITCH=1`: debe devolver
éxito sin encolar, hacer fetch externo ni escribir datos de fases. Después, un
archivo `.dev.vars` no versionado puede usar `KILL_SWITCH=0`: el endpoint encola
un tick y Wrangler entrega un batch unitario al consumer, que adquiere el lease
y ejecuta la fase. Secrets reales nunca se incluyen en fixtures, comandos, logs
o configuración versionada.

El gate local termina con:

```bash
npm test
npm run typecheck
npx wrangler deploy --dry-run --outdir dist/worker
```

Checks bloqueantes:

- migraciones aplican sobre una D1 vacía y una segunda aplicación no altera el
  schema;
- `/health` informa `plan=free`, `schedulerMode=single_phase`, kill switch,
  budgets y disponibilidad D1 sin exponer valores secretos;
- dos adquisiciones concurrentes del lease producen exactamente un ganador;
- cada llamada a `/__scheduled` encola como máximo un tick y cada entrega Queue
  ejecuta como máximo la fase persistida; rota `header → sweep → probe → header`
  solo después de éxito atómico;
- un tick duplicado o anterior queda confirmado sin ejecutar otra fase, y un
  batch de tamaño distinto de uno falla antes de acceder a D1;
- kill switch impide red y writes de fases, aunque permite leer `/health`;
- cada resultado D1 se compara con el presupuesto de filas: la fase aborta
  inmediatamente después del primer resultado que lo cruza y no inicia otra
  query de fase. Como D1 solo informa filas después de ejecutar, una query
  individual puede sobrepasar el límite; cleanup acotado sigue permitido para
  no dejar lease/trabajo completado en retry. Por eso la ventana Analytics de
  24 h, no esta defensa post-query, cierra el gate diario;
- cada `D1Result.meta` acumula `rows_read`/`rows_written`; el ledger
  `daily_budget_YYYYMMDD` usa la fecha UTC de inicio, clasifica cada intento como
  `completed|failed|duplicate|locked` y `/health` solo expone el día UTC actual
  con un allowlist estricto. Sus filas terminan en `BeforeLedger` porque excluyen
  la propia escritura reconciliadora. Ledger y liberación son best-effort: sus
  fallos no convierten una fase ya confirmada en retry ni reemplazan el error
  primario; `/health` degradado por ausencia/staleness y Analytics revelan
  telemetría incompleta. Si el guard de filas salta en la adquisición, se intenta
  siempre la liberación owner-checked antes de relanzar;
- el contador D1 admite como máximo 40 queries Free, incluye el marcador atómico
  de Queue, cuenta cada sentencia de un batch y rechaza la siguiente antes de
  acceder a D1;
- tests prueban que las cuatro tablas append-only (incluida
  `scheduler_attempts`, también protegida por triggers) no reciben
  `UPDATE`/`DELETE` desde la aplicación;
- gate de allowlist (`test/prepare-allowlist.test.ts` contra el fixture
  versionado `test/fixtures/prepare-allowlist.json`): cada callsite crudo
  `.prepare(` queda congelado por archivo + función + fingerprint normalizado
  de la consulta + conteo; un callsite nuevo o alterado falla la suite, una
  entrada sin callsite obliga a borrarla (la lista solo decrece), y al
  completar WP4 solo quedan las excepciones normativas del lease y el
  query-budget;
- el dry-run compila el mismo entrypoint y bindings que staging.

La corrida WP2 local del 2026-08-28 queda registrada en
`evidence/wp2-local-wrangler-2026-08-28.json`. La validación posterior del flujo
real Cron → Queue → HEADER con Wrangler completó en 2.441 ms y dejó HEADER en 4
queries de fase más 1 operación de deduplicación Queue, dentro del presupuesto
Free de 40.

Wrangler/Miniflare valida comportamiento, bindings y persistencia local, pero no
demuestra el límite real de 10 ms de CPU ni el egress productivo de Cloudflare.

### 11.2 Gate de staging Free

Staging usa una D1 separada y comienza sin Cron Trigger. El orden es obligatorio:

1. provisionar `bnb-agent-probe-staging`, su D1 y la Queue
   `bnb-agent-probe-staging`; aplicar migraciones usando explícitamente el
   entorno Wrangler `staging`;
2. desplegar ese entorno con `CLOUDFLARE_WORKERS_PLAN=free`, `KILL_SWITCH=1`,
   producer y consumer enlazados, y sin Cron;
3. comprobar `/health` y que ninguna métrica contiene secretos o payloads;
4. ejecutar manualmente HEADER con límite 1, después 5 y finalmente 25;
5. comprobar en métricas/logs Cloudflare CPU, wall time, outcome, subrequests y
   filas D1 leídas/escritas;
6. ejecutar manualmente una fase SWEEP del conjunto live;
7. ejecutar un único PROBE allowlisted para Grid `303779`;
8. habilitar temporalmente `*/5 * * * *` y comprobar que el Cron solo encola,
   mientras cada consumer recibe exactamente un tick y ejecuta una fase;
9. activar la cadencia continua solo tras dos rotaciones Queue completas sin
   `exceededCpu`, 429, exceso de presupuesto, duplicación ni avance incorrecto
   de cursor.

El disparo manual del deployment nominal usa la ruta administrativa publicada
`POST /__admin/run-scheduled`, cerrada por cuatro condiciones simultáneas:
`DEPLOYMENT_ENV=staging`, `STAGING_MANUAL_RUN=1`, `KILL_SWITCH=0` y un
`SHARED_SECRET` efímero cuyo Bearer se compara mediante hashes. Producción fija
`DEPLOYMENT_ENV=production`; el staging nominal fija `STAGING_MANUAL_RUN=0` y
`KILL_SWITCH=1`, por lo que la ruta responde 404 aunque exista accidentalmente
un secreto. No tiene CORS. Cada llamada autorizada publica exactamente un tick
versionado en `WP2_QUEUE`; nunca ejecuta una fase, lee D1 ni contacta trust8004,
BSC o al seller dentro del request HTTP. El consumer serial es el único que
ejecuta la fase y escribe el marcador Queue, bajo su cuota Free de 30 s CPU.

```bash
# instalar un secreto aleatorio únicamente durante la ventana controlada
npx wrangler secret put BSC_RPC_URL --env staging
npx wrangler secret put SHARED_SECRET --env staging
npx wrangler deploy --env staging --var DEPLOYMENT_ENV:staging \
  --var STAGING_MANUAL_RUN:1 --var KILL_SWITCH:0 --var HEADER_LIMIT:1
curl -X POST -H "Authorization: Bearer $WP2_STAGING_SECRET" \
  https://bnb-agent-probe-staging.<subdomain>.workers.dev/__admin/run-scheduled
```

Para SWEEP se conserva la misma D1 y se invoca de nuevo la ruta después
de que `/health` indique `nextPhase=sweep`. Al cerrar la ventana de medición
desaparece el acceso operativo: se redespliega el perfil nominal con `STAGING_MANUAL_RUN=0`,
`KILL_SWITCH=1`, se elimina `SHARED_SECRET` y se comprueba la lista vacía de
schedules. Los valores y métricas se guardan sin secretos. Esta ruta nunca se
habilita en producción.

La corrida del 2026-08-28 con HEADER 1/5/25 y tres rotaciones está en
`evidence/wp2-staging-wrangler-2026-08-28.json`: prueba cursores, presupuesto
D1 y cero 429. La respuesta GraphQL con ventanas, dimensiones, requests y
subrequests se conserva en
`evidence/wp2-workers-analytics-raw-2026-08-28.json`. Registró muestras
representativas por encima de 10.000 µs: preview HEADER=25 en 15.442 µs,
SWEEP=4 en 11.098 µs y HEADER=1 en 17.124 µs; el trigger HTTP nominal midió
HEADER=1 en 11.676 µs. HTTP incluye routing y autenticación, por lo que esas
muestras no resolvieron el gate de CPU del Cron.

Los intentos directos posteriores sí resolvieron el gate. HEADER=1 midió 21.364
µs inicialmente, 16.336 µs tras reducir D1 y 16.508 µs tras lazy loading. Una
serie de diez ejecuciones registradas en D1 produjo una muestra fría de 14.962
µs y ocho muestras warm entre 5.953 y 9.251 µs; Analytics omitió una muestra.
Por tanto el camino Cron → fase falla el requisito frío/P99 de 10 ms aunque el
warm path pase. La evidencia está en
`evidence/wp2-cron-cpu-raw-2026-08-28.json`.

La mitigación Free implementada es Cron → Queue → fase. El producer observado
midió 1.140 µs. Los consumers reales completaron HEADER=1 en 16.747 µs y
SWEEP=1 en 15.107 µs, ambos dentro de su cuota de 30 s; D1 registró 5 y 10
queries respectivamente, incluyendo la operación de deduplicación, y la rotación
avanzó `header → sweep → probe`. La evidencia raw está en
`evidence/wp2-queue-analytics-raw-2026-08-28.json`. Tras la ventana se eliminaron
los schedules y secretos, se restauró `KILL_SWITCH=1` y se conservaron un
producer y un consumer únicamente en staging.

`durationP50` de `workersInvocationsAdaptive` mide tiempo de ejecución activo,
no el wall time completo que el resumen D1 calcula con reloj de pared; por eso
0,207 s de Analytics y 1.335 ms de HEADER D1 no deben coincidir. La atribución a
consumer sigue siendo inferida por versión, timestamp, subrequest y estado D1,
porque el dataset adaptativo no expone dimensión de tipo de trigger. La
validación remota limpia posterior se ejecutó en un entorno aislado con D1 y
Queue propias. Demostró ambos caminos de reentrega: lease ocupado
`skipped_locked → retry a 240 s → éxito → duplicado`, y excepción de fase
`fallo sin avance → retry automático → éxito → duplicado`. La prueba diagnóstica
previa descubrió que el valor implícito `retry_delay=0` agotaba los cuatro
intentos en unos tres segundos; por eso todos los consumers declaran ahora
`retry_delay=60`. El delay específico de 240 s continúa aplicando solo al lease
ocupado. La evidencia está en
`evidence/wp2-retry-remote-clean-2026-08-28.json`.
La auditoría de esa corrida detectó además que el resumen de un fallo HTTP
guardaba `requests=0` aunque Analytics observaba el intento. El runner cuenta
ahora cada llamada al `fetch` upstream antes de ejecutarla y persiste ese total
en el resumen de error; el cero histórico del artefacto describe la versión
ensayada, no la telemetría vigente.

Cada incremento exige margen del producer bajo 10 ms y del Queue consumer bajo
30 s. Que una ejecución aislada reciba flexibilidad de plataforma no cuenta como
gate pasado. Si un producer, HEADER=1, SWEEP=1 o el probe único excede su cuota
de forma repetible, se reactiva el kill switch y se detiene WP2/WP3. No se activa
Paid automáticamente.

La misma validación ejecutó los defaults Free `HEADER_LIMIT=25` y
`SWEEP_LIMIT=4` hasta incrementar `sweepRound` exactamente de 0 a 2: fueron 12
fases, con máximo observado de 11 queries D1, cuatro requests trust8004, cero
writes materiales en HEADER y cero 429. Analytics observó CPU máxima de consumer
de 18.066 µs y `memoryUsageBytesP999=2503018`, ambos dentro del sobre. El ledger
exacto por `scheduledTime` y la consulta Analytics con los grupos que producen
ambos máximos están en `evidence/wp2-default-rounds-2026-08-28.json`; los
datasets adaptativos de Queue y Workers corroboran métricas, pero no sustituyen
ese ledger D1.

El máximo histórico de 11 queries corresponde a la versión ensayada. La versión
vigente añade dos escrituras de telemetría: reconciliación diaria y un intento
append-only identificado por `(messageId, attempt)` e indexado por
`scheduledTime`; reportaría 13 para esa
misma fase. Conserva el techo duro de 40 reservando cuatro queries fuera del
presupuesto de fase: resumen de fallo, liberación del lease y ambos ledgers.
El ledger diario ayuda a detectar drift, pero no sustituye las métricas de
facturación de Cloudflare: omite sus propias filas escritas y no incluye uso D1
ajeno al Worker. El ledger de intentos existe para reconciliar exactamente los
288 ticks y sus reentregas, no para calcular la cuota account-wide.

WP3 cerró su gate nominal remoto y los negativos deterministas de transporte.
Sigue pendiente únicamente la ventana D1 final de 24 h de WP2. El gate final usa
staging con el código candidato completo y una
ventana completa de cuota `00:00:00Z–24:00:00Z`: 288 ticks esperados, 96 éxitos
por fase en el camino nominal y cada retry/outcome reconciliado por
`scheduledTime`, `messageId` y número de entrega. Cada tick admite un único
mensaje de Queue, debe terminar y debe respetar la rotación cíclica exacta
HEADER → SWEEP → PROBE desde la fase inicial persistida. Se capturan sin resumir el ledger D1, los resultados por query
o base de D1 Analytics y el total de uso de la cuenta, porque las cuotas Free
son account-wide. Debe demostrar `<4.000.000` filas leídas, `<80.000` escritas,
`<=40` queries por intento, cero errores de cuota y explicar cualquier tick o
retry faltante/sobrante. Se registra además el uso ajeno al staging; una corrida
contaminada que no permita atribuir el margen se repite.

El artefacto final se llama `evidence/wp2-d1-24h-<YYYY-MM-DD>.json`, usa
`schemaVersion=1` e incluye commit y deployment exactos, IDs de Worker/Queue/D1,
ventana UTC, límites aplicados, `ledger` de los 288 ticks y `quotaLedger` de los
intentos cuyo `startedAt` cae en el día (con spill-in/spill-out explícitos),
outcomes y retries,
hashes y rutas de las respuestas Analytics crudas por base y por cuenta, uso
ajeno D1 y Queue observado, conteos totales, CPU separada del producer y
consumer, wall time p95, memoria y un veredicto por gate.
Una lectura D1 cruda y hasheada de `next_scheduler_phase` y
`last_queue_scheduled_time`, iniciada y completada dentro de los cinco minutos
anteriores al primer tick, fija la fase inicial y demuestra que el scheduler
persistió el tick inmediatamente anterior. No demuestra por sí sola que su
mensaje Queue ya terminó. El ledger de intentos y las operaciones
`DeleteMessage` prueban por separado la terminalidad de los 288 ticks de la
ventana; inferir la fase inicial del propio ledger tampoco sería evidencia
independiente. Un spill-in solo cierra si termina
en `completed`/`duplicate`, no por agotar retries en `failed`.
La captura se ejecuta con
`npm run evidence:wp2-window-start -- ../evidence/raw/window-start.json`; recibe
token, cuenta y D1 únicamente por `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` y `WP2_D1_DATABASE_ID`, publica atómicamente y
create-only la respuesta D1 literal junto con IDs/query/params, y nunca
serializa la credencial.
El runbook ejecutable completo está en `bnb-agent-probe/README.md`. Sus
productores create-only son, en orden: `evidence:wp2-control preflight`,
`evidence:wp2-control activation`, `evidence:wp2-window-start`,
`evidence:wp2-control drain`, `evidence:wp2-ledger`,
`evidence:wp2-analytics`, `evidence:wp2-control cleanup`,
`evidence:wp2-deployment`, `evidence:wp2-build` y `evidence:wp2-24h`.
Preflight y activación deben finalizar antes del primer tick y no se reconstruyen
retrospectivamente. El builder resuelve los raw desde la raíz del repositorio,
calcula sus SHA-256, deriva ambos ledgers, totales, atribución y cleanup, valida
el resultado completo y solo entonces publica el artefacto.
No se resume ni descarta la respuesta cruda usada para calcular esos campos.
Las cinco respuestas Analytics se publican juntas bajo
`evidence/raw/analytics/` mediante rename atómico de directorio, solo después de
observar exactamente 288 `DeleteMessage` exitosos. Un manifest final comparte
`captureId` con cada respuesta y fija sus cinco SHA-256; el builder rechaza un
directorio parcial, mezclado o modificado.
Desde la promoción de la versión medida hasta publicar `window-start`, el
runbook mantiene un trap de rollback: cualquier error o interrupción despliega
ambos kill switches en `1`, elimina el Cron y verifica por API `schedules=[]`
antes de abortar. El trap solo se retira cuando las dos capturas de inicio ya
existen y el primer tick medido todavía no ocurrió.
Las consultas versionadas están en `bnb-agent-probe/src/evidence/wp2-24h-queries.ts`.
Workers y las operaciones Queue usan inicio inclusivo `00:00:00.000Z` y fin inclusivo
`23:59:59.999Z`; Queue se consulta además sin filtro de ID para demostrar la
cuota Free account-wide, y su serie de backlog se extiende como mínimo hasta
`00:15:00.000Z` y hasta después del último `finishedAt`/`DeleteMessage` si son
posteriores. El artefacto conserva como ventana lógica el final exclusivo del
siguiente `00:00:00.000Z`. D1 Analytics se consulta por la fecha UTC exacta,
tanto para la base de staging como para el total de cuenta, y cada respuesta raw
se conserva con SHA-256 antes de derivar totales.

Antes y después de cada ventana se verifican por API `schedules=[]` y backlog
Queue cero; declarar `crons: []` en un deploy no sustituye esa comprobación por
la propagación eventual de Cron Triggers. Para la ventana final se instala un
Cron staging temporal solo después del preflight y se elimina al finalizar; no
autoriza cadencia productiva. Tras el tick de `23:55Z` se retira el schedule
antes de `00:00Z` y se activa `PRODUCER_KILL_SWITCH=1` como barrera contra un
trigger tardío mientras `KILL_SWITCH=0` mantiene vivo exclusivamente el consumer
durante la gracia de retries pertenecientes al día. La gracia dura como mínimo hasta `00:15Z`
(tres delays de lease de 240 s más margen) y no termina hasta que los 288 ticks
tengan exactamente un `completed` en `scheduler_attempts`, Queue Analytics
demuestre los 288 `DeleteMessage` exitosos y el backlog REST sea cero; este
último solo corrobora y nunca cierra el gate por sí mismo. Esas verificaciones
se hacen con `KILL_SWITCH=0`; solo entonces se autoriza cleanup.
Durante las 24 horas medidas no se consulta D1 directamente, no se llama
`/health`, no se usa la ruta admin y no se ejecutan diagnósticos Worker: todos
ellos alterarían las mismas métricas account-wide que el gate pretende medir.
La lectura `window-start` termina antes de `00:00Z`; ledger y conciliación se
capturan después de `24:00Z` y la gracia. Solo una amenaza de seguridad runtime
autoriza romper la ventana anticipadamente con la barrera del producer.
Los raw de preflight, activación, drain y cleanup incluyen inicio y fin de una
captura acotada a diez segundos. El validador exige activación anterior al
primer tick; drain posterior al último tick pero anterior a `24:00Z`, con
`PRODUCER_KILL_SWITCH=1`, `KILL_SWITCH=0` y Cron vacío; su backlog literal puede
ser mayor que cero mientras termina el drenaje. El snapshot drain consulta solo
el control plane (schedules, bindings, backlog y nombres de secrets): no llama
`/health`, no serializa `healthUrl`/`health`, y el validador rechaza esos campos
si aparecen. Ese modo tampoco requiere `WP2_HEALTH_URL`; preflight, activación
y cleanup sí conservan la validación del endpoint HTTPS exacto. Cleanup exige backlog cero y es
posterior a la gracia y a la conciliación. Cada snapshot autentica además el perfil Free, la
cadencia, presupuestos D1/subrequests, timeout, caps y bindings D1/Queue
desplegados, no valores hardcodeados por el artefacto. Workers Analytics separa el CPU P99
del producer `<10 ms` correlacionando sus timestamps con `WriteMessage`, y deja
un margen máximo de un segundo, `subrequests=0` y un total de requests igual a
las 288 escrituras. Las muestras inequívocas restantes, con subrequests, forman
el consumer `<30 s`; el ledger deriva wall time p95
`<30 s` y Workers conserva también memoria P999. Como Queue Analytics no emite
necesariamente puntos durante la inactividad, se exigen una escritura y un
delete exitoso por mensaje terminal, el último backlog emitido en cero después
del último tick y el backlog REST timestamped en cero tras la gracia mínima; la
consulta se solicita completa hasta un cutoff UTC real capturado después del
último intento y delete, nunca se fija artificialmente en `00:15Z`.
Workers Analytics usa el mismo cutoff de terminalidad, no el fin del día: así
incluye CPU, memoria, errores y versión de cualquier retry spill-out entre
`00:00Z` y el cutoff real. Su cohorte de errores une los intentos del día con esos
spill-out sin cambiar el presupuesto de cuota UTC.
La suma de requests de todas las muestras consumer autenticadas debe coincidir
exactamente con la unión única del cohort durable de intentos cuyo `startedAt`
cae entre el inicio y el cutoff de terminalidad, incluyendo spill-ins,
spill-outs y retries. Una request Worker no explicada por ese ledger invalida el
gate aunque su versión sea auténtica.
Cada intento spill-out debe correlacionar con una muestra consumer autenticada a
no más de un segundo de su `startedAt`; ampliar el rango sin observar ese bucket
no demuestra completitud y falla cerrado. Cada match consume capacidad de
`sum.requests`. Por separado, cada mensaje cuyo intento terminal completado
finaliza en o después del cierre de la ventana consume un único `DeleteMessage`
exitoso causal, a partir del `finishedAt` de esa finalización y con hasta un
segundo de tolerancia por redondeo Analytics. Esto incluye intentos que cruzan
medianoche; los retries no crean deletes adicionales.
El cleanup debe ser posterior no solo a `00:15Z`, sino también al último
`finishedAt` y al último `DeleteMessage` terminal observado.
Recién entonces `KILL_SWITCH` vuelve a `1`; el raw final debe demostrar ambos
switches en `1`.
El deploy medido se publica con annotations Cloudflare
`workers/message=git_commit=<SHA completo>` y `workers/tag=git-<SHA12>`; el raw
de versión vincula esos valores con su `versionId`. Cada versión de drenaje debe
tener el mismo commit y `script.etag`, más un tag `git-<SHA12>-<sufijo>`; sus
muestras Worker también cuentan para CPU, memoria y errores porque pueden
procesar retries. Una versión sin esa procedencia falla. Cualquier emisión extra sigue fallando la
reconciliación exacta de 288 operaciones `WriteMessage`.
Una invocación autenticada de drenaje con cero subrequests y sin `WriteMessage`
correlacionado es tráfico de observer/producer sin explicación y falla cerrado.
Un Cron tardío bloqueado por el switch obliga por tanto a repetir el gate, porque
Analytics no permite distinguirlo de una invocación manual al Worker.
El raw compuesto se crea con `npm run evidence:wp2-deployment -- <salida>
<script> <commit> <version-medida> <version-drain...>`; el comando consulta cada
ID explícito con Wrangler, valida annotations y etag, y publica create-only.
La Queue, su consumer y D1 de staging se conservan: la eliminación aplica solo a
recursos efímeros del entorno `validation`. Como el backlog REST es best-effort y puede omitir
mensajes con retry diferido, cada prueba destructiva de reentrega crea una Queue
de validación con ID nuevo. Después de capturar Analytics elimina, en orden, el
consumer, el Worker temporal y la Queue; la D1 separada se conserva para
auditoría. Un único `backlog_count=0` no demuestra aislamiento ni autoriza
reutilizar una Queue.

### 11.3 Promoción explícita Free → Paid

El cambio requiere confirmación de que la cuenta ya tiene Workers Paid y una
decisión operativa registrada. No existe detección automática del plan.

Checklist:

1. implementar y revisar el pipeline Paid en un bundle nuevo, retirar el guard
   `WP2_PAID_PIPELINE_NOT_VALIDATED` y demostrar sus presupuestos localmente;
2. conservar export/backup de D1 y métricas base Free;
3. desplegar staging con `CLOUDFLARE_WORKERS_PLAN=paid`, `KILL_SWITCH=1` y cron
   todavía desactivado;
4. ejecutar tests, typecheck, dry-run, migraciones y smoke de `/health`;
5. probar manualmente defaults Paid: HEADER 200, SWEEP 2000×2 y PROBE 10;
6. demostrar dos pipelines completos bajo los gates de CPU, memoria, wall time,
   upstream y D1;
7. configurar el cron producer de un minuto manteniendo el kill switch;
8. habilitar con `KILL_SWITCH=0` y observar al menos dos vueltas antes de dar la
   promoción por terminada.

Rollback:

1. poner `KILL_SWITCH=1` inmediatamente;
2. desactivar el cron de un minuto;
3. restaurar `CLOUDFLARE_WORKERS_PLAN=free` y los defaults Free;
4. desplegar y verificar `/health` antes de reactivar el cron de cinco minutos;
5. no revertir ni borrar observaciones append-only; corregir cursor/lease solo
   mediante una migración o reparación documentada e idempotente.

---

## 12. Implementación paso a paso y gates

No se paraleliza antes de estabilizar schema/contratos:

```text
WP0 → WP1 → WP2 → WP3 → WP4 → {WP5, WP6} → WP7
```

### 12.0 Disciplina de ejecución multi-sesión

- Cada sesión trabaja en su propio git worktree y su propia rama; nunca dos
  sesiones sobre el mismo checkout.
- Los WPs que corren en paralelo declaran de antemano conjuntos de archivos
  disjuntos; un PR solo contiene archivos que su sesión creó o modificó.
- Un gate se considera pasado únicamente cuando `npm ci` más el check del
  paquete (`npm run check` en el Worker; typecheck+tests+build en el
  marketplace) pasan en un checkout limpio — CI es el árbitro. Una corrida
  local sobre un árbol compartido no cierra gates.

### WP0 — Evidencia y presupuesto

Entrega: snapshot reproducible, API/headers revalidados, benchmark `limit=2000` y
conteos definitivos.

Gate: sumas/corte pasan, toda cifra tiene artefacto y cualquier exceso del sizing
original produce un perfil documentado que cabe en el plan operativo vigente.

### WP1 — Worker, schema y `/health`

Entrega: repo, Wrangler, Drizzle SQLite, migraciones, las cinco tablas
iniciales (WP2 añade la sexta, `scheduler_attempts`), lease,
`/health`, kill switch, sin cron y manifest versionado de categorías curadas
exportado desde `marketplaceInventoryEntries()`.

Gate:

- config ausente selecciona Free, kill switch encendido y `single_phase`;
- configuraciones Free fuera del sobre fallan antes de acceder a red/D1;
- runbook local completo de sección 11.1 pasa antes de crear staging;
- tests D1 pasan y `wrangler deploy --dry-run` pasa;
- staging responde;
- dos adquisiciones concurrentes producen un ganador;
- el manifest conserva los cinco IDs/categorías actuales, incluido Grid 303779,
  y todo assignment sigue marcado `candidate_unverified`;
- cero UPDATE/DELETE de aplicación sobre las cuatro tablas append-only
  (`probe_observations`, `funnel_snapshots`, `hire_events`,
  `scheduler_attempts`).

Resultado verificado el 2026-08-28: el subproyecto `bnb-agent-probe` pasa
typecheck, 46 tests unitarios/schema, 5 tests dentro del runtime Workers, dos
aplicaciones idempotentes de migraciones locales y `wrangler deploy --dry-run`.
El entorno `bnb-agent-probe-staging` usa una D1 separada, responde en
`/health`; ese baseline se verificó con `KILL_SWITCH=1`, sin Cron Trigger y antes
de implementar las fases de red. La ventana temporal activa descrita en 11.2 es
estado posterior de WP2/WP3 y no cambia el alcance histórico del gate WP1.

### WP2 — HEADER y SWEEP

Entrega: parser, filtro, HEADER completo, SWEEP página+cursor atómico, presupuesto
y métricas.

Gate:

- segunda ejecución idéntica: cero writes materiales;
- fallo de batch no adelanta offset;
- rotación Free ejecuta exactamente una fase y persiste la siguiente;
- dos vueltas Queue del conjunto live cumplen sección 4.2, cero `exceededCpu`,
  cero duplicaciones y cero 429; una vuelta cuenta solo cuando `sweepRound`
  incrementa, no por haber enviado un número fijo de ticks;
- después de WP3, métricas D1 de una ventana UTC controlada de 24 h sobre el
  candidato completo confirman la reserva diaria de 20 %;
- HEADER y SWEEP permanecen en `D1_QUERIES_PER_RUN <= 40`, incluyendo marcador
  Queue, lease, resumen, cursor y rotación; staging demuestra el límite porque
  Miniflare no lo impone;
- gate de staging Free de sección 11.2 pasa antes de activar el cron;
- endpoint retirado queda visible como `removed`.

Estado 2026-08-28: los gates remotos de reentrega, idempotencia, dos vueltas
HEADER/SWEEP con defaults Free, CPU, memoria, queries y 429 están pasados en el
entorno de validación aislado. Esa evidencia valida las mecánicas destructivas
de Queue, pero no sustituye el probe nominal del candidato vigente en staging.
WP2 no se promociona todavía a cadencia continua: falta la ventana D1 real de
24 h del candidato completo descrita en sección 11.2. Una ventana previa a WP3
solo puede etiquetarse baseline.

### WP3 — PROBE solo Grid 303779

```text
PROBE_BATCH_SIZE=1
PROBE_AGENT_ALLOWLIST=303779
PROBE_ENDPOINT_ALLOWLIST=https://bnb-agent-marketplace-ruby.vercel.app/grid
```

Una D1 vacía no se prepara con SQL manual. Si no existe un target `current`, el
runner sintetiza únicamente este par exacto, lo reconcilia primero contra
trust8004 y lo inserta o reactiva atómicamente con provenance
`derived:marketplace-inventory`; un conflicto conserva `firstSeenAt`. Metadata
no disponible o endpoint retirado no materializan el bootstrap.

Gate:

- `quote_verified`, signer=wallet onchain y hash canónico idéntico;
- age, TTL, currency, Commerce, Router y Policy válidos;
- acepta ambas skills de negociación y exige exactamente `notify_funded`;
- Workerd demuestra de forma determinista timeout, body cap y redirects
  bloqueados; staging demuestra el egress nominal real contra Grid. No se
  modifica el seller real ni se incluye fault injection en el Worker candidato;
- no crea ni financia job.

Evidencia WP3: `evidence/wp3-grid-303779-<UTC>.json`, con schema version, commit,
entorno, request/hash, bloque y timestamp, observación D1, resumen de fase,
marcador Queue, métricas Cloudflare crudas enlazadas y conteo pre/post de eventos
`JobCreated`, `BudgetSet` y `JobFunded` sin variación atribuible al probe. Para
hacerlo reproducible se fijan los bloques BSC inmediatamente anterior al
enqueue y posterior al completion marker, y se conserva la respuesta cruda de
`eth_getLogs` del Commerce en ese rango para los tres topic0 versionados en el
runbook. Todo evento global ajeno se conserva y clasifica por transaction hash;
el probe no emite transacción. Se
ejecuta un intento nominal remoto y uno determinista en Workerd por cada gate
negativo de transporte. Un fallo esperado del seller se persiste como observación
sanitizada, baja la prioridad del target a cero y rota la fase atómicamente para
que una caída no bloquee todo el catálogo. Una excepción inesperada de
infraestructura no ejecuta el batch, no cambia fase/prioridad y queda disponible
para retry de Queue.

Si falla, se corrige antes de ampliar.

Estado 2026-08-28: WP3 pasó. La corrida nominal remota `header → sweep → probe`
terminó en `quote_verified` para Grid `303779`, con signer igual al wallet
onchain, hashes canónicos persistidos, 8 subrequests de PROBE, 10 queries D1 y
2.635 ms de reloj de pared. Cloudflare Analytics registró cero errores; entre
sus buckets, el mayor `cpuTimeP99` fue 170.404 µs y el mayor
`memoryUsageBytesP999` fue 11.297.484 bytes. La ejecución terminó sin exceder la
cuota de 30 s CPU del consumer ni 96 MiB. Queue entregó y eliminó con éxito los
tres ticks, sin retry y con backlog final cero.

El rango BSC inclusivo `0x7126285–0x71262eb` devolvió cero eventos
`JobCreated`, `BudgetSet` o `JobFunded` para Commerce y el probe no emitió
transacción. El RPC público oficial de BNB devolvió `-32005 limit exceeded` aun
en rangos pequeños; la auditoría se repitió mediante el endpoint gratuito de
PublicNode y se conserva la respuesta cruda vacía. Los negativos de redirect,
body cap y timeout pasan en Workerd. La evidencia nominal está en
`evidence/wp3-grid-303779-2026-08-28T21-12-31Z.json` y la respuesta cruda de
Workers/Queue Analytics en
`evidence/wp3-grid-303779-analytics-raw-2026-08-28.json`.

Dos intentos diagnósticos previos expusieron formas reales de trust8004: arrays
opcionales `null` y una declaración A2A que apunta a la Agent Card completa.
El parser acepta solo `null`/ausente para esos arrays, y A2A normaliza únicamente
el sufijo exacto `/.well-known/agent-card.json` después de validar la URL. Una
fila staging anterior al fix conserva la URL completa; el allowlist exacto de
WP3 la ignora y un SWEEP completo normalizado la retirará sin mutación manual.
Tras el gate se restauraron `KILL_SWITCH=1`, `STAGING_MANUAL_RUN=0`, schedules
vacíos y se eliminaron el secreto administrativo efímero y su archivo temporal.

### WP4 — Probe general y `/observations`

Entrega actual: lote legacy 1 para Grid y lote genérico 1 para endpoints
representativos en Free, contratos públicos `/observations`, `/catalog-agents`
y `/catalog-agent`, integración cacheada 30 segundos y degradación fail-closed.
El contrato expone historial del scheduler y, por agente, conteo exacto de
intentos de plataforma, últimas observaciones, error, HTTP y duración. Está
desplegado en staging versión `7b6836c5-bd57-473a-a755-8e9d7d669d71`; el primer
tick HEADER del bundle terminó en la primera entrega. El primer PROBE genérico,
programado a las 2026-08-30T22:30:00Z, también terminó en la primera entrega:
procesó un target y persistió `network_error`. Ese resultado fue útil para
detectar que el selector ordenaba por hash después de la cadencia y podía elegir
una página `web` antes de un endpoint de protocolo del mismo candidato. El
candidato de código siguiente ordena, manteniendo intactos presupuesto y
cadencia, `erc8183_http → mcp → a2a → web`; requiere una nueva promoción de
staging antes de atribuir ese orden al runtime desplegado. El frontend Production
requiere configurar `OBSERVATIONS_URL` al promover la aplicación. El snapshot de
release deja de representar estado actual de agentes: una caída de Worker/D1
conserva solo declaraciones live de trust8004, sin claims observados actuales.
Eso no impide que un seller ERC-8183 compatible y admitido reciba una quote nueva bajo
demanda; Worker/D1 no autorizan esa contratación. El funnel WP0 permanece como
medición histórica fechada.

El wildcard general está activo únicamente en staging con
`PROBE_GENERAL_EGRESS_APPROVED=1`; producción y validation conservan 0 y
`CATALOG_PROBE_ENABLED=0`. El
lote 10 de Paid es configuración futura; el pipeline Paid
aborta deliberadamente hasta su promoción y medición separadas.

Gate:

- contract test Worker↔marketplace;
- cache fresca puede reutilizarse por 60 segundos; después se vuelve a consultar.
  Las observaciones antiguas devueltas por el Worker conservan fecha y se muestran
  solo como historial, nunca como reachability actual ni fallback inventado;
- quote expirada degrada sin write;
- metadata propia cambia/degrada en siguiente observación prioritaria;
- Worker apagado no rompe páginas;
- Worker apagado muestra datos declarados live como `verification unavailable`,
  nunca como observación actual; si también falla trust8004, el catálogo muestra
  indisponibilidad explícita;
- unreachable/removed visibles;
- Hire nunca consume quote del probe;
- observación antigua o Worker/D1 unavailable no ocultan `Get fresh quote` para
  un seller ERC-8183 compatible admitido por el allowlist activo;
- cada refresh negocia y valida una quote nueva y, cuando la sincronización se
  confirma, actualiza la evidencia pública solo con campos sanitizados;
- MCP-only permanece visible pero no contratable;
- los call sites crudos heredados quedan migrados a `db/orm.ts` y el grep de
  `.prepare(` pasa en su forma total.

### WP5 — Landing

Empieza después de WP0. Entrega: hero/funnel respaldado, definición y límites de
hireable, procedencias, seller propio identificado y cierre sobre escrow.

Gate: toda cifra con hash/fecha/bloque, ningún cero no demostrado, copy aprobado
por Gilberts antes de merge.

### WP6 — Eventos mínimos de contratación

Entrega: ruta same-origin Vercel, reenvío autenticado, idempotencia y verificación
onchain.

Gate:

- retry no duplica;
- funded/settled falsos se rechazan;
- secreto ausente del bundle browser;
- D1 sin user ID/IP/sesión;
- Track lee BSC, no confía en fase persistida.

### WP7 — Recorrido y release

```text
Discover  catálogo/funnel con fallback
Understand procedencias/frescura visibles
Compare   cuatro categorías presentes
Hire      quote fresca + intención + firmas no custodiales
Track     estado directo BSC
Result    evidencia/hash verificables
```

Gate final: tests Worker/marketplace, production build, smoke staging encendido y
apagado, kill switch, observabilidad/rollback. Solo entonces cron en producción.

---

## 13. Estructura del repositorio nuevo

`bnb-agent-probe/src/config.ts` y los módulos del Worker son la fuente
canónica de perfiles y rotación; el bootstrap del marketplace quedó eliminado.

```text
bnb-agent-probe/
├── wrangler.toml
├── package.json
├── drizzle.config.ts
├── src/
│   ├── index.ts
│   ├── db/{schema.ts,client.ts}
│   ├── phases/{header.ts,sweep.ts,probe.ts}
│   ├── routes/{observations.ts,health.ts,hire-events.ts}
│   ├── lib/{trust8004.ts,chain.ts,candidates.ts,quote.ts,safe-url.ts,
│   │        scheduler-lease.ts,terms.ts}
│   └── types.ts
├── migrations/
├── evidence/
└── test/{candidates,quote,safe-url,scheduler-lease,phases,routes}.test.ts
```

Convenciones:

- acceso a datos en runtime a través de `src/db/orm.ts` (`drizzle-orm/d1`), con
  tipos de fila derivados del schema (`$inferSelect`); `drizzle-orm/sqlite-core`
  para el schema y migraciones versionadas con drizzle-kit; no SQL manual en
  prod;
- excepciones nombradas que permanecen SQL crudo parametrizado:
  `lib/scheduler-lease.ts` (la semántica de contención del lease se audita como
  SQL exacto) y `db/query-budget.ts` (cuenta sentencias al nivel del binding,
  cubriendo también lo que ejecuta Drizzle). Ninguna otra llamada `.prepare(`
  fuera de esos dos archivos y `db/orm.ts`; los call sites crudos existentes
  migran al tocarse y quedan prohibidos en código nuevo;
- `db.batch()` para página+cursor;
- viem y `Address`/`getAddress()` para BSC;
- pin exacto `@bnbagent/sdk@0.5.0` durante WP0–WP7; el SDK construye/valida y
  queda prohibido reimplementar el hash;
- `strict`, `noUncheckedIndexedAccess` y parsers para JSON externo;
- módulo único de enums;
- routes no importa phases; phases no importa routes; lib no importa ninguno;
- lógica que toca D1 se testea contra Miniflare con migraciones aplicadas
  (infra en `test/integration/`); los fakes de D1 se reservan para lógica pura
  sin acceso a datos; staging para egress.

Los resúmenes de fase son los tipos que exporta cada módulo de fase (p. ej.
`SweepPhaseSummary` y `ProbePhaseSummary` en `src/phases/`); no existe un
`PhaseSummary` único. Todo resumen incluye al menos trabajo procesado,
requests usados y duración. Los fallos se persisten separadamente con un
`errorCode` sanitizado; ningún resumen guarda payloads crudos.

---

## 14. Fuera de alcance

- indexer global ERC-8183, multichain o reorg projection;
- cambios productivos en trust8004 durante freeze;
- cuatro sellers propietarios;
- Queues adicionales, Durable Objects, KV, R2 o Workflows especulativos;
- custodia de llaves/fondos;
- social, terminal, x402/B402 para este Worker;
- payloads crudos/entregables arbitrarios;
- backfill global de jobs.

El funnel de jobs sigue siendo harvest único con bloque y JSON versionado.

---

## 15. Evidencia pendiente no bloqueante para WP0–WP4

- Lista canónica de jobs propios: publicar solo tras reconciliar jobId, creador,
  fondos, tx hashes y BSC.
- Job Mainnet `56662`: una fecha futura de settle es plan, no hecho ocurrido.
- Captura final y release build se ejecutan en WP7.

Bloquean claims públicos de track record, no discovery/probe.
