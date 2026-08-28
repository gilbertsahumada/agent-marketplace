# Capa de observación de contratabilidad — SPEC MVP v5 Free-first

**Estado:** WP0 y WP1 completos; WP2 implementado y en gate final mediante Queue Free, con staging en kill switch y sin Cron activo.
**Fecha de corte del diseño:** 2026-08-28.
**Objetivo:** completar la capa de observación necesaria para recorrer:

```text
Discover → Understand → Compare → Hire → Track → Result
```

Esta spec gobierna el futuro repositorio `bnb-agent-probe` y su integración con
este marketplace. El contrato ejecutable de configuración se mantiene primero
en `src/observation/worker-config.ts` para que perfiles y gates se prueben junto
al código existente antes de extraer WP1. No autoriza cambios en producción de
trust8004 durante su ventana de congelación.

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

---

## 1. Hechos que gobiernan la implementación

### 1.1 Verificados en este repositorio

| Hecho | Evidencia | Estado |
| --- | --- | --- |
| BSC Mainnet | `chainId = 56` | `src/trust8004/types.ts` |
| SDK ERC-8183 | `@bnbagent/sdk@0.5.0` | `package.json` |
| TTL máximo del SDK | `NegotiationHandler.MAX_QUOTE_TTL_SECONDS = 900` | dependencia instalada, comprobado 2026-08-27 |
| Edad máxima aceptada | 60 s | `src/readiness/protocols.ts` |
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

La afirmación “0 declaran ERC-8183” queda reemplazada por el conteo reproducible
anterior. El artefacto es
`evidence/funnel-bsc-2026-08-27T19-41-17Z.json`.

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
                    | D1, cinco tablas |
                    +------------------+
                             |
                       BSC RPC / viem

 Marketplace en Vercel
   - lee /observations fuera de la ruta crítica de render
   - conserva fallback estático versionado
   - pide quote fresca al pulsar Hire
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
  chainId          INTEGER NOT NULL CHECK (chainId = 56),
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
```

### 3.2 Invariantes de escritura

- `probe_observations`, `funnel_snapshots` y `hire_events` son append-only. La
  aplicación no ejecuta `UPDATE` ni `DELETE` sobre ellas.
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
daily_budget_YYYYMMDD textValue=JSON sanitizado con invocaciones, outcomes,
                      requests, queries y filas D1 observadas antes del propio ledger
```

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
HEADER_LIMIT=25                  máximo Free 50
PROBE_BATCH_SIZE=1              máximo Free 1
SWEEP_LIMIT=4                   máximo Free 40 y siempre <= TRUST8004_REQUESTS_PER_RUN
SWEEP_PAGES_PER_RUN=1           máximo Free 1
TRUST8004_REQUESTS_PER_RUN=4
EXTERNAL_SUBREQUESTS_PER_RUN=12 máximo Free 40, plataforma 50
D1_QUERIES_PER_RUN=40           mínimo 12, máximo Free 40, plataforma D1 50
D1_ROWS_READ_PER_RUN=3000
D1_ROWS_WRITTEN_PER_RUN=60
PROBE_TIMEOUT_MS=5000
MAX_CATALOG_RESPONSE_BYTES=16777216
MAX_SELLER_RESPONSE_BYTES=32768

binding WP2_QUEUE                  Queue del mismo entorno
consumer max_batch_size=1, max_batch_timeout=1, max_retries=3,
         max_concurrency=1, retry_delay=60
```

Con cinco minutos hay 288 ticks/día. Queue consume 864 operaciones nominales
(write+read+delete) y 1.728 si cada mensaje usa los tres retries. D1 puede recibir
288 intentos nominales o hasta 1.152 intentos (entrega inicial + tres retries por
tick); son presupuestos distintos. Con los defaults, la proyección D1 es
864.000/17.280 filas leídas/escritas nominales y 3.456.000/69.120 en el peor
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
completa (25 por defecto y máximo 50 en Free; 200 por defecto en Paid);
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
write. Los upserts se fragmentan dentro del mismo batch atómico para que ningún
parámetro enlazado supere 1,5 MB, con margen frente al máximo D1 de 2 MB.

Un elemento inválido o sin `registeredAt` se contabiliza como `invalidItems` y
no bloquea los elementos válidos de la página. No participa del high-water; si
la ventana completa contiene inválidos, `header_window_exhausted=true` fuerza la
señal conservadora de posible hueco.

Si una caída supera la ventana, `/health` muestra
`header_window_exhausted=true`; SWEEP recupera lo omitido dentro del conjunto
live. El check de frescura se calcula contra la cadencia y el límite del perfil,
no contra una constante de dos minutos.

### 5.3 SWEEP — reconciliación rodante

Lee páginas ascendentes desde `sweep_offset`. En Free reconcilia únicamente IDs
ERC-8183 persistidos por HEADER y el inventario curado de cuatro categorías;
no intenta materializar los 309.897 registros globales. El cursor pagina esa
unión de IDs en D1 y resuelve un detalle trust8004 por agente. Por eso
`SWEEP_LIMIT` no puede superar `TRUST8004_REQUESTS_PER_RUN` en Free. Por página:

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
Worker disponible -> snapshot cacheado -> etiqueta calculada al leer
Worker no disponible -> snapshot público versionado -> aviso de frescura
```

La ficha puede consultar trust8004 en vivo, pero una caída no elimina contenido.

### 5.7 HIRE y TRACK

1. `Hire` registra `clicked` mediante ruta server-side.
2. Marketplace vuelve a resolver perfil, endpoint y wallet.
3. Pide quote fresca; nunca reutiliza la del probe.
4. Valida con sección 8.
5. Muestra token, allowance, budget, deadline y transacciones.
6. Wallet inyectada firma/envía directamente a BSC.
7. Tras cada receipt, lee receipt/estado onchain antes de emitir
   `chain_verified`.
8. Track/Result leen BSC; D1 conserva solo referencia idempotente observada.

`SHARED_SECRET` solo existe en Vercel server y Worker. El navegador llama una
ruta same-origin; esta valida, elimina contexto y reenvía.

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
el funnel, no targets live en Free.
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
- rechazar `localhost`, `.localhost`, `.local` y literales IP no públicos;
- portar todos los rangos de `src/verification/safe-http.ts`, no solo RFC1918;
- usar proxy de salida público de Workers; no fingir DNS pinning;
- `redirect: "error"`;
- timeout total 10 s por target;
- máximo 64 KiB descomprimidos, abortando el stream;
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
4. firma EIP-191/ERC-1271 válida;
5. signer/provider igual a wallet resuelta onchain en el mismo probe, nunca a la
   address autodeclarada por quote;
6. `negotiated_at`: máximo 60 s futuro y edad máxima 60 s;
7. expiración futura/posterior a negociación y ventana máxima 900 s;
8. price entero positivo raw;
9. currency igual a `paymentToken()` y `$U` configurado;
10. `verifying_contract` igual a Commerce;
11. Router/Policy/Commerce allowlisted y `policyWhitelist(policy)=true`;
12. para HTTP, `/status` coincide en agent, contratos, currency y decimals.

El probe no crea, financia ni ejecuta jobs.

---

## 9. Etiqueta calculada al leer

```text
removed              -> Declaration changed
metadata_unavailable -> Metadata unavailable · last good <timestamp>
metadata version != observed -> Reverification required
latest unreachable   -> Unreachable at <timestamp> · last verified <timestamp|null>

latest quote_verified
AND now <= quoteExpiresAt
AND now - quoteNegotiatedAt <= 60 s
AND metadata version matches
AND endpoint current
  -> Hireable now · verified <timestamp>

otherwise -> literal outcome + timestamp
```

En una vista filtrada por categoría se usa la última observación de esa categoría,
no la última observación global del endpoint. Para targets sin categoría se usa
la observación neutra/global.

`Hireable now` significa que pasó la política con evidencia vigente, no promesa
ni endorsement. Hire vuelve a pedir quote y leer wallet/allowlist antes de firma.
`ownerOf` se muestra como `onchain default`, no wallet específica verificada.

---

## 10. Contrato HTTP del Worker

### 10.1 `GET /observations`

Público:

```text
Cache-Control: public, s-maxage=60, stale-while-revalidate=300
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
};

type ObservationsResponse = {
  schemaVersion: 1;
  generatedAt: number;
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
    latest: LatestObservation | null;
    latestByCategory: Partial<Record<MarketplaceCategory, LatestObservation>>;
    lastQuoteVerifiedAt: number | null;
    lastQuoteVerifiedAtByCategory: Partial<Record<MarketplaceCategory, number>>;
  }>;
};
```

Nunca devuelve firma, payload crudo, headers o errores externos.

### 10.2 `GET /health`

Público, sanitizado y de costo constante: una sola lectura acotada de
`runtime_state`, sin `COUNT`/scan de `probe_targets`. Expone última fase,
offset/vuelta, lease como booleano+expiración (no runId), requests, CPU/wall
time, último código de error, kill switch y ledger UTC corriente. Los conteos de
targets se marcan no disponibles aquí y pertenecen a endpoints/artefactos de
observación deliberados. Devuelve 200 con `status=degraded` ante una fase mala o
si el scheduler está activo sin ledger diario válido/fresco. Fresco significa
`updatedAt` dentro de tres intervalos Cron, con mínimo de 15 min, y no más de
cinco minutos en el futuro; 503 solo si no lee D1.

### 10.3 `POST /hire-events`

Privado servidor-a-servidor:

- Bearer secret, body JSON máximo 8 KiB, enum cerrado/campos desconocidos fuera;
- comparación constante del secreto;
- telemetría con `marketplace_observed`;
- fases onchain con `chain_verified`, jobId y txHash obligatorios;
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
CRON_INTERVAL_MINUTES=5
HEADER_LIMIT=25
SWEEP_LIMIT=4
SWEEP_PAGES_PER_RUN=1
PROBE_BATCH_SIZE=1
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
El Cron falla cerrado si falta el binding y nunca ejecuta la fase directamente.

`bnb-agent-probe/src/config.ts` es la fuente ejecutable WP1 de defaults, máximos
y validación. Mientras convive con el bootstrap previo
`src/observation/worker-config.ts`, un test de paridad impide drift entre ambos;
WP2 elimina el bootstrap al mover la política de rotación al Worker. Free es el
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
npm install
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
- tests prueban que las tablas append-only no reciben `UPDATE`/`DELETE` desde la
  aplicación;
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
un secreto. No tiene CORS y cada llamada autorizada ejecuta una sola fase.

```bash
# instalar un secreto aleatorio únicamente durante la ventana controlada
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
vigente añade una única escritura atómica de reconciliación diaria y reportaría
12 para esa misma fase; conserva el techo duro de 40 reservando tres queries
fuera del presupuesto de fase: resumen de fallo, liberación del lease y ledger.
El ledger ayuda a detectar drift durante una corrida, pero no sustituye las
métricas de facturación de Cloudflare: omite su propia fila escrita y no incluye
uso D1 ajeno al Worker.

Siguen pendientes el gate WP3 y, después de integrarlo, la ventana D1 final de
24 h. Ejecutarla antes de WP3 solo mediría el placeholder PROBE y no dimensiona
la versión candidata. El gate final usa staging con el código candidato y una
ventana completa de cuota `00:00:00Z–24:00:00Z`: 288 ticks esperados, 96 éxitos
por fase en el camino nominal y cada retry/outcome reconciliado por
`scheduledTime`. Se capturan sin resumir el ledger D1, los resultados por query
o base de D1 Analytics y el total de uso de la cuenta, porque las cuotas Free
son account-wide. Debe demostrar `<4.000.000` filas leídas, `<80.000` escritas,
`<=40` queries por intento, cero errores de cuota y explicar cualquier tick o
retry faltante/sobrante. Se registra además el uso ajeno al staging; una corrida
contaminada que no permita atribuir el margen se repite.

Antes y después de cada ventana se verifican por API `schedules=[]` y backlog
Queue cero; declarar `crons: []` en un deploy no sustituye esa comprobación por
la propagación eventual de Cron Triggers. Para la ventana final se instala un
Cron staging temporal solo después del preflight y se elimina al finalizar; no
autoriza cadencia productiva. Como el backlog REST es best-effort y puede omitir
mensajes con retry diferido, cada prueba destructiva de reentrega crea una Queue
de validación con ID nuevo. Después de capturar Analytics elimina, en orden, el
consumer, el Worker temporal y la Queue; la D1 separada se conserva para
auditoría. Un único `backlog_count=0` no demuestra aislamiento ni autoriza
reutilizar una Queue.

### 11.3 Promoción explícita Free → Paid

El cambio requiere confirmación de que la cuenta ya tiene Workers Paid y una
decisión operativa registrada. No existe detección automática del plan.

Checklist:

1. conservar export/backup de D1 y métricas base Free;
2. desplegar staging con `CLOUDFLARE_WORKERS_PLAN=paid`, `KILL_SWITCH=1` y cron
   todavía desactivado;
3. ejecutar tests, typecheck, dry-run, migraciones y smoke de `/health`;
4. probar manualmente defaults Paid: HEADER 200, SWEEP 2000×2 y PROBE 10;
5. demostrar dos pipelines completos bajo los gates de CPU, memoria, wall time,
   upstream y D1;
6. configurar el cron producer de un minuto manteniendo el kill switch;
7. habilitar con `KILL_SWITCH=0` y observar al menos dos vueltas antes de dar la
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

### WP0 — Evidencia y presupuesto

Entrega: snapshot reproducible, API/headers revalidados, benchmark `limit=2000` y
conteos definitivos.

Gate: sumas/corte pasan, toda cifra tiene artefacto y cualquier exceso del sizing
original produce un perfil documentado que cabe en el plan operativo vigente.

### WP1 — Worker, schema y `/health`

Entrega: repo, Wrangler, Drizzle SQLite, migraciones, cinco tablas, lease,
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
- cero UPDATE/DELETE sobre tablas append-only.

Resultado verificado el 2026-08-28: el subproyecto `bnb-agent-probe` pasa
typecheck, 46 tests unitarios/schema, 5 tests dentro del runtime Workers, dos
aplicaciones idempotentes de migraciones locales y `wrangler deploy --dry-run`.
El entorno `bnb-agent-probe-staging` usa una D1 separada, responde en
`/health`, conserva `KILL_SWITCH=1`, no define Cron Trigger y mantiene las fases
de red sin implementar. El gate WP1 no autoriza ejecutar HEADER, SWEEP o PROBE;
esas pruebas y sus métricas corresponden a WP2 y WP3.

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
entorno de validación aislado. WP2 no se promociona todavía a cadencia continua:
falta WP3 y después la ventana D1 real de 24 h del candidato completo descrita
en sección 11.2. Una ventana previa a WP3 solo puede etiquetarse baseline.

### WP3 — PROBE solo Grid 303779

```text
PROBE_BATCH_SIZE=1
PROBE_AGENT_ALLOWLIST=303779
```

Gate:

- `quote_verified`, signer=wallet onchain y hash canónico idéntico;
- age, TTL, currency, Commerce, Router y Policy válidos;
- acepta ambas skills de negociación y exige exactamente `notify_funded`;
- staging demuestra timeout, body cap y redirects bloqueados;
- no crea ni financia job.

Si falla, se corrige antes de ampliar.

### WP4 — Probe general y `/observations`

Entrega: lote 1 en Free (10 por defecto Paid), contrato sección 10.1, fallback e
integración cacheada.

Gate:

- contract test Worker↔marketplace;
- quote expirada degrada sin write;
- metadata propia cambia/degrada en siguiente observación prioritaria;
- Worker apagado no rompe páginas;
- unreachable/removed visibles;
- Hire nunca consume quote del probe.

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

Hasta crear `bnb-agent-probe`, `src/observation/worker-config.ts`,
`src/observation/scheduler-policy.ts` y
`tests/observation-worker-config.test.ts` son la fuente canónica de perfiles y
rotación. WP1 los mueve sin cambiar comportamiento ni defaults.

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

- `drizzle-orm/sqlite-core`, migraciones versionadas, no SQL manual en prod;
- `db.batch()` para página+cursor;
- viem y `Address`/`getAddress()` para BSC;
- pin exacto `@bnbagent/sdk@0.5.0` durante WP0–WP7; el SDK construye/valida y
  queda prohibido reimplementar el hash;
- `strict`, `noUncheckedIndexedAccess` y parsers para JSON externo;
- módulo único de enums;
- routes no importa phases; phases no importa routes; lib no importa ninguno;
- Vitest/Miniflare para lógica; staging para egress.

```ts
type PhaseSummary = {
  processed: number;
  written: number;
  requestsUsed: number;
  durationMs: number;
  errors: string[];
};
```

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
