# Plan de implementación: pagos fiables, discovery rápido y catálogo multired

Fecha: 2026-09-06. Estado: **implementación parcial publicada; aceptación integral pendiente**.

## Reconciliación — 2026-09-06, posterior al PR #117

Este registro sustituye los estados históricos de las listas detalladas inferiores, que se conservan como alcance de aceptación, no como inventario fiable de código ausente. No marcar una fase completa solo porque exista un test o un despliegue.

| Frente | Implementado | Desplegado | Validación integral / pendiente |
|---|---|---|---|
| Recibos batch y recuperación explícita | Sí, ver HIRE_RECOVERY.md y tests/erc8183-batched-hire.test.ts | Correcciones publicadas, PR #115 | Quedan casos legacy/pending tras recarga y quote vencida |
| Notificación separada del pago | Sí, PR #115 | Sí | Mantener prueba de cero nuevos pagos en reintentos |
| Formularios SDK y precio del vendedor | Sí, IMPLEMENTATION_SDK_NEGOTIATION.md | Flujo externo observado en producción | Adaptadores especializados y aceptación por red pendientes |
| Migraciones 0025/0026 | Rollout registrado en la sesión previa | Aplicadas según registro de operación previo | No se ha releído el ledger D1 en esta reconciliación; verificarlo antes de otro despliegue Worker |
| Catálogo multired | Lecturas y UI implementadas | Publicadas | No equivale a contratación Testnet integral |
| Discovery | Baseline y auditoría acotada realizados | No acredita aceleración remota | Canary, agentes únicos/minuto y límites necesitan evidencia actual |
| Entrega y cierre de lectura | Sí, PR #117 | Sí, main 5a4eeb5, producción Ready | Job 56719: SUBMITTED, contenido recuperado, formato no verificado, revisión hasta 2026-09-13T13:44:37Z |
| Usabilidad Jobs | Sí, PR #117 | Sí | Sort limitado a página cargada; no orden global |
| Disputa/liquidación con wallet | No | No | Nueva fase 11; no prometer cierre desde la UI |

Evidencia de PR #117: 1.180 tests, typecheck, build CLI/web y checks remotos correctos. Comprobación de producción: /agents, /jobs, /jobs/mainnet/56719 y su API delivery respondieron 200; la carga terminó en navegador. Esto no acredita un cierre ni la calidad de la entrega.

## Avance comprobable — 2026-09-06

Responsable: equipo de implementación y revisión local. Los checks siguientes acreditan piezas concretas, no la finalización de todas las fases.

- [x] Incorporar recibos canónicos al journal batch; rechazar asignaciones ambiguas y comprobar eventos Created/Funded contra comprador, proveedor, job y presupuesto. Evidencia: `tests/erc8183-batched-hire.test.ts`.
- [x] Separar la recuperación explícita de un job del bloqueo que exige una nueva quote. Evidencia: `tests/seller-parameters.test.tsx`.
- [x] Evitar nuevas pruebas de quote mientras la capacidad y compatibilidad sigan vigentes; reservar presupuesto compartido por origen. Evidencia: `bnb-agent-probe/test/integration/catalog-capability.test.ts`.
- [x] Implementar reutilización acotada de fallos estructurales públicos para el mismo endpoint/transporte, sin crear quotes ni extender el timestamp original. Evidencia: `bnb-agent-probe/test/integration/shared-discovery.test.ts`. Desactivada por defecto.
- [x] Añadir aislamiento de lecturas por red y tabs de Agents que conservan filtros y reinician paginación. Evidencia: `catalog-network.test.ts`, `catalog-candidate-feed.test.ts`, `catalog-scope.test.ts`.
- [x] Documentar el incidente de job 56717 con recibo RPC exitoso y eventos indexados: `PAYMENT_INCIDENT_56717.md`.
- [x] Capturar línea base remota e inventario completo Testnet: 2.182 identidades, 356 combinaciones de endpoint/protocolo comprobadas, 0 contratos de entrada compatibles encontrados. Evidencia y comparación provisional: `DISCOVERY_BASELINE_2026-09-06.md`.
- [x] Auditar 39 candidatos prioritarios Mainnet (46 endpoints únicos entre cohorts), sin repetir el agente ya requestable. No se encontraron nuevos formularios compatibles; no se solicitó ninguna quote ni pago.
- [x] Incorporar snapshot por red y auditoría reanudable con deduplicación y límites de concurrencia, sin promoción automática de resultados locales a D1.
- [ ] Validar recuperación de batches pendientes tras caducidad de quote y compatibilidad de journals antiguos.
- [ ] Aplicar migración 0025 con backup/paridad, desplegar y verificar datos remotos.
- [ ] Ejecutar canary de aceleración y medir agentes únicos por minuto; no se ha activado más tráfico remoto.
- [ ] Implementar discovery y negociación Testnet completos. Las nuevas lecturas por red NO habilitan contratación Testnet.
- [ ] Completar las restantes pruebas de aceptación y rollout de este plan.

## 0. Objetivo y reglas de seguimiento

Facilitar descubrir y contratar agentes realmente compatibles, nuevos o antiguos, sin confundir actividad histórica, disponibilidad técnica, capacidad pública de negociar y una cotización activa del comprador.

Todas las casillas empiezan pendientes. Marcarlas solo con evidencia: commit, test, resultado remoto o captura. Un test local no acredita un despliegue; un despliegue no acredita una contratación integral.

- [ ] Mantener en este archivo fecha, responsable, evidencia y bloqueos por fase.
- [ ] Registrar los hallazgos adicionales sin ampliar silenciosamente el alcance.
- [ ] Mantener un commit por archivo, conforme a la preferencia del proyecto.
- [ ] No enviar transacciones Mainnet. La prueba de pago Testnet requerirá wallet y presupuesto autorizados.
- [ ] No borrar journals, jobs, recibos ni observaciones para ocultar inconsistencias.
- [ ] No inventar parámetros, firmas, capacidades o agentes Testnet.
- [ ] No contactar vendedores ni modificar sus servicios sin autorización específica.

### Evidencia inicial y límites de certeza

- El flujo batch de `src/data/erc8183/browser-wallet-adapter.ts` entrega hash y `confirmedAt` a `withProgress`, pero omite `receipt`. Este último solo guarda confirmaciones cuando recibe ambos datos.
- `Erc8183TransactionList` deriva confirmado exclusivamente del recibo local; un hash sin recibo aparece pendiente. El banner deriva funding de otra fuente: el estado del job o el recibo de funding.
- Esto explica la contradicción del screenshot, pero **no establece el resultado on-chain de esa transacción concreta**: hay que recuperar el hash completo y su receipt.
- El scheduler permite actualmente un origen por tick; bootstrap tiene presupuesto separado del mantenimiento, pero ambos comparten ese límite.
- Las rutas de cotización y el payload de la cola contienen restricciones explícitas a chain 56. Jobs e identidades tienen soporte parcial para 56/97, no un catálogo de contratación multired completo.
- Los contadores actuales son ejecuciones físicas por hora, no agentes únicos ni una serie histórica suficiente para prometer un ETA.
- `docs/COMPATIBILITY_SCAN_OPERATIONS.md` todavía describe una selección previa a deduplicación, desactualizada respecto del selector SQL actual.

## 1. Orden y dependencias

1. Diagnóstico y corrección del pago batch; bloquear regresiones de recuperación.
2. Medición del conjunto pendiente y diseño del scheduler; acelerar con canary.
3. Modelo multired, indexación y APIs; después filtros y contratación Testnet.
4. Documentación alineada, regresión integral, rollout y medición posterior.

Las tareas de lectura del scheduler y del modelo multired pueden avanzar mientras se prueba el pago. No activar más tráfico sin observar límites; no publicar Testnet como contratable antes de verificar el flujo completo de esa red.

## 2. P0 — Reconstruir la contratación afectada

- [ ] Obtener hash completo, chain, wallet compradora, job ID, quoteRequestId y momento del intento sin exponer secretos ni el brief.
- [ ] Consultar por RPC, en modo lectura, transacción, receipt, bloque y logs; distinguir revert, pendiente, reemplazada y confirmada.
- [ ] Comparar el job actual con comprador, provider, Commerce, Router, Policy, token y presupuesto esperados.
- [ ] Reconstruir la secuencia wallet → batch → confirmación → lectura del job → notificación → respuesta del vendedor.
- [ ] Determinar si el segundo clic solo notificó/leyó el job o ejecutó una acción adicional; respaldarlo con hashes y registros.
- [ ] Identificar el endpoint y código concreto que originaron el error genérico del vendedor/RPC.
- [ ] Guardar un informe sanitizado del incidente con hechos confirmados, inferencias y datos no disponibles.

**Salida:** explicar qué ocurrió con ese pago sin deducirlo del color, spinner o texto de la UI.

## 3. P0 — TDD y corrección del batch

Archivos de partida: `src/data/erc8183/browser-wallet-adapter.ts`, `src/data/erc8183/batched-hire.ts`, entidades del journal y `components/spikes/erc8183-browser-spike.tsx`.

### 3.1 Tests RED antes del arreglo

- [ ] Reproducir batch exitoso con un receipt compartido: cinco llamadas deben tener evidencia válida de confirmación.
- [ ] Reproducir respuestas con múltiples receipts y comprobar su asociación, sin aceptar asignaciones ambiguas.
- [ ] Reproducir batch revertido: ninguna llamada pasa a confirmada.
- [ ] Reproducir receipt ausente, incompleto, de otra red, otro job o logs inconsistentes: no confirmar.
- [ ] Reproducir funding confirmado y notificación fallida: conservar confirmación y detener loaders de pago.
- [ ] Reproducir timeout RPC: mostrar estado desconocido/pendiente de verificación, no fracaso ni éxito inventados.
- [ ] Reproducir segundo clic tras funding: cero llamadas nuevas a la wallet.

### 3.2 Verificación y persistencia

- [ ] Normalizar receipts de la wallet y obtener receipts canónicos por RPC cuando falten datos necesarios.
- [ ] Verificar éxito, chain, hashes, bloque y eventos de Commerce/Router esperados.
- [ ] Verificar job creado, comprador, provider y financiación contra el plan original.
- [ ] Tratar smart accounts/bundlers correctamente: no exigir que el emisor exterior sea una EOA si el comprador es una smart account; documentar la evidencia equivalente exigida.
- [ ] Validar atomicidad y la forma de respuesta soportada; rechazar formatos ambiguos antes de marcar llamadas completas.
- [ ] Pasar evidencia real a `withProgress`, sin convertir tipos incompletos mediante un cast para fabricar campos.
- [ ] Persistir batchId cuando esté disponible, hashes y relación llamada/receipt para retomar comprobaciones tras recarga.
- [ ] Deduplicar receipt, coste de gas y conteo de transacciones cuando varias llamadas comparten hash.
- [ ] Guardar el avance durable antes de notificar al vendedor.
- [ ] Separar estado del pago, estado de verificación del receipt, estado de notificación y estado on-chain del job.

### 3.3 Recuperación y errores

- [ ] Nueva quote empieza sin transacciones; nunca hereda un batch o job anterior.
- [ ] Restaurar una contratación solo mediante selección explícita, con wallet, red, job y fecha visibles.
- [ ] Revalidar en cadena journals antiguos incompletos; conservarlos como referencias, no como prueba de confirmación.
- [ ] Al cambiar wallet/red/request, cancelar respuestas obsoletas y desacoplar el checkout activo.
- [ ] Reintentar notificación de un job financiado sin entrar a aprobación/funding.
- [ ] No volver a notificar si una lectura ya muestra Submitted/Completed.
- [ ] Hacer idempotente el endpoint de notificación por red/job/quote request y evitar doble clic concurrente.
- [ ] Separar rechazo del vendedor, timeout del vendedor, RPC no disponible y receipt revertido en códigos sanitizados.

### 3.4 UI del pago

- [ ] Un indicador de actividad para el batch; filas con estados estáticos derivados de evidencia.
- [ ] Estados explícitos: no enviado, esperando wallet, enviado, verificando, confirmado, revertido, verificación interrumpida.
- [ ] Explicar «1 transacción · 5 llamadas» solo cuando lo demuestre el resultado; antes indicar el modo previsto sin prometerlo.
- [ ] Mostrar funding confirmado aunque falle una operación posterior; evitar el título genérico «tx falló».
- [ ] Botón «Reintentar notificación» exclusivo de esa operación; «Comprobar transacción» para incertidumbre de receipt.
- [ ] Mostrar error junto al paso afectado, duración y acción recuperable; finalizar siempre busy en success/error/timeout/cancelación.
- [ ] Distinguir Submitted del job de submitted de una transacción.
- [ ] Mantener un único anuncio accesible de progreso y respetar reduced motion.
- [ ] Verificar recarga, navegación atrás, rechazo wallet, doble clic, cambio wallet/red y recuperación explícita con tests.

**Gate P0:** no hay filas girando tras finalizar una operación; no hay confirmación sin evidencia; un retry posterior al funding no puede enviar otro pago.

## 4. P1 — Medir por qué el barrido no llena su presupuesto

- [ ] Tomar una nueva lectura remota con timestamp y versión desplegada; no reutilizar cifras anteriores como actuales.
- [ ] Contar pendientes únicos por agente, endpoint y origen, separando redes.
- [ ] Desglosar por elegibilidad, declaración vigente, agente vigente, nextProbeAt futuro, lease activo y estado suspendido.
- [ ] Medir candidatos debidos antes/después de joins, ranking, deduplicación y límites por origen/cohorte.
- [ ] Identificar los principales orígenes y cuántos pendientes concentran.
- [ ] Distinguir nunca comprobados de reintentos y mantenimiento de éxitos.
- [ ] Desglosar errores reales por código, HTTP status, transporte y origen; no asumir que todos los clasificados temporales lo son.
- [ ] Verificar que redeliveries y leases expirados no multiplican intentos lógicos.
- [ ] Medir latencia de cola y operación en p50/p95, timeout rate, 429, consultas/filas D1 y subrequests.
- [ ] Revisar coste del ranking SQL con índices y plan de consulta sobre cardinalidad real, con consultas acotadas.
- [ ] Guardar baseline comparable y definir duración de observación antes de publicar ETA.

**Salida:** tabla de causas de exclusión y concentración por origen, no una propuesta de aumentar consumidores a ciegas.

## 5. P1 — Scheduler de primera pasada y mantenimiento

### 5.1 Política de selección

- [ ] Separar explícitamente discovery inicial, refresco de compatibilidad, probe de quote y reintentos.
- [ ] Dar prioridad al primer chequeo; mantener una cuota pequeña reservada para mantenimiento vencido y recuperación.
- [ ] Excluir éxitos con evidencia vigente de la primera pasada.
- [ ] Invalidar compatibilidad cuando cambien endpoint, transporte, schema o identidad relevante, sin esperar el TTL.
- [ ] No extender evidencia de quote al comprobar solo parámetros.
- [ ] Mantener la distinción entre TTL público de capacidad y expiración real de quote del comprador.
- [ ] No pedir una quote automática si no existe muestra pública segura declarada por el vendedor.
- [ ] Conservar vendedores compatibles sin muestra como requestables; no marcarlos fallidos por requerir inputs del comprador.
- [ ] Garantizar progreso a candidatos menos prioritarios mediante antigüedad/fairness.

### 5.2 Presupuesto adaptable por origen

- [ ] Sustituir el rígido «1 origen por minuto» por un presupuesto persistente de solicitudes y concurrencia por origen.
- [ ] Definir límites globales, por origen, por transporte y por cohorte configurables.
- [ ] Coordinar el límite entre consumidores e invocaciones; un contador en memoria no es suficiente.
- [ ] Empezar el canary con valores conservadores derivados del baseline y fijar techo explícito.
- [ ] Incrementar gradualmente solo con buena latencia y sin 429; reducir ante saturación y timeouts.
- [ ] Respetar Retry-After válido, con límites defensivos, y aplicar jitter al backoff.
- [ ] Implementar circuit breaker por origen con recuperación gradual y revisión periódica, no exclusión irreversible.
- [ ] Diferenciar fallos de endpoint de fallos de host: no bloquear todos sus agentes por un único schema inválido.
- [ ] No trasladar automáticamente la sobrecarga a RPC o D1 al elevar el dispatch.

### 5.3 Deduplicación y caché segura

- [ ] Reutilizar documentos públicos de discovery idénticos por URL canónica, transporte, versión de protocolo y contexto de autenticación.
- [ ] No compartir documentos entre rutas diferentes solo porque coincidan en origen.
- [ ] Guardar hash, fetch/expiry y versión del parser; invalidar al cambiar cualquiera de ellos.
- [ ] Compartir solo descubrimiento público: identidad, autorización y quote se verifican por agente/red/comprador.
- [ ] No reutilizar sesiones MCP, credenciales, briefs o quotes de otro comprador.
- [ ] Mantener HTTPS público, defensa SSRF/DNS, sin redirects, límites de bytes y timeouts también en cache misses y refrescos.
- [ ] Registrar dedupe/cache hit y ahorro real de requests sin falsear cantidad de agentes verificados.

### 5.4 Retries y observabilidad durable

- [ ] Mantener backoff progresivo de errores recuperables y ventana larga para cambios requeridos al proveedor.
- [ ] No volver a negociar durante un TTL válido salvo solicitud explícita del comprador o invalidación relevante.
- [ ] Mantener leases atómicos, finalización idempotente y política de dead-letter/reprocesamiento auditable.
- [ ] No contar un mensaje duplicado como nuevo agente comprobado.
- [ ] Retener una serie temporal acotada, además del contador de la hora actual, para medir throughput y errores.
- [ ] Añadir cobertura, pendientes nunca vistos, reintentos, antigüedad, motivos de exclusión y consumo de presupuesto por red/cohorte.
- [ ] Calcular ETA de primera pasada solo con throughput sostenido de candidatos únicos y advertir nuevas altas/servidores bloqueados.
- [ ] Definir retención y presupuesto de escritura de métricas; no guardar briefs ni errores sin sanitizar.

### 5.5 TDD y gate de carga

- [ ] Tests RED: miles de candidatos en un origen no impiden progreso de otros.
- [ ] Tests RED: éxitos vigentes no consumen bootstrap ni reciben quotes repetidas.
- [ ] Tests RED: concurrencia distribuida respeta presupuesto, leases y dedupe.
- [ ] Tests RED: 429/Retry-After, breaker, recuperación, reloj y mensajes duplicados.
- [ ] Tests RED: cambio de schema invalida solo la evidencia correspondiente.
- [ ] Tests RED: mismo documento no implica mismo provider ni quote reusable.
- [ ] Ejecutar carga con sellers fixture, no disparar una prueba masiva contra terceros.
- [ ] Comparar canary con baseline: candidatos únicos/minuto, p95, 429, coste D1 y fairness.
- [ ] Aprobar ampliación solo con mejora sostenida y sin superar los presupuestos acordados.

## 6. P2 — Contratación multired real

### 6.1 Inventario y contrato de red

- [ ] Inventariar todas las restricciones a 56 en catálogo, discovery, quotes, firma, colas, jobs, cache, MCP y frontend.
- [ ] Verificar direcciones oficiales/desplegadas de registros, Commerce, Router, Policy y token en 56 y 97 mediante fuentes y lecturas RPC.
- [ ] Definir un registro central de red con pins y límites por red; sin fallback de Testnet a contratos Mainnet.
- [ ] Definir clave de identidad por chain + registry + agentId, incluyendo endpoints, capacidades y cachés.
- [ ] Verificar fuente de discovery Testnet: el índice parcial derivado de hires no equivale a un censo ERC-8004.
- [ ] Asegurar que agentes Testnet nuevos sin jobs puedan descubrirse.
- [ ] Decidir y documentar cobertura inicial Testnet y condiciones de contratación soportadas; no prometer simetría antes de verificarla.

### 6.2 Modelo y migraciones

- [ ] Auditar schema real desplegado e historial de migraciones antes de asignar el próximo número.
- [ ] Determinar si ampliar claves existentes basta o hacen falta columnas/tablas; no duplicar commerce_jobs ni sus eventos.
- [ ] Incluir red en solicitudes, intentos, capacidades, leases, dedupe, rate limits semánticos y vínculos de hire.
- [ ] Compartir límite físico por origen entre redes cuando ambas golpeen el mismo servidor.
- [ ] Evitar colisiones cuando agentId/jobId coincidan en 56 y 97.
- [ ] Backfill idempotente: preservar filas Mainnet existentes como 56, sin generar registros Testnet ficticios.
- [ ] Verificar índices por red/estado/fecha y joins sobre datasets reales.
- [ ] Probar migración desde backup sanitizado, paridad de conteos y rollback compatible antes de aplicar remoto.
- [ ] Usar expansión compatible primero; retirar modelo viejo solo después de verificar lectores y writers.

### 6.3 Backend y descubrimiento

- [ ] Hacer explícita la red en discovery y mensajes de cola versionados; rechazar redes no soportadas.
- [ ] Mantener compatibilidad controlada de mensajes antiguos para 56 durante rollout.
- [ ] Añadir cursores y presupuestos por red al indexador de identidades y endpoints.
- [ ] Propagar red por input, creación de quote, result, fallback, historial, prepare, notify y tracking.
- [ ] Validar firma, provider, chain, token, contratos, policy, request hash, precio y expiración contra pins de la red solicitada.
- [ ] No admitir quote de 56 para preparar/fundear en 97 ni viceversa.
- [ ] Devolver network/chain y cobertura en facets, contadores y errores.
- [ ] Preservar compatibilidad de URLs/API anteriores como Mainnet explícitamente documentado.
- [ ] Reutilizar indexador y detalle de jobs existentes, conservando atribución por agente frente a actividad de wallet.

### 6.4 UI y filtros

- [ ] Agregar pestañas Mainnet / Testnet en Agents con selección explícita en URL.
- [ ] Mantener búsqueda, transportes, outcome y evidencia al cambiar red; reiniciar página/cursor.
- [ ] No activar filtros de estado implícitos al entrar ni al limpiar filtros.
- [ ] Aplicar red a todas las consultas, facets, cards, tabla y contadores; no filtrar solo lo ya paginado en cliente.
- [ ] Mantener semántica OR dentro del grupo de estados y combinación entre grupos documentada y probada.
- [ ] Mostrar vacíos honestos: sin compatibles, sin indexación de esta red, servicio no disponible y filtro sin resultados son estados distintos.
- [ ] Dar acceso secundario explícito a pendientes/no compatibles, sin confundirlos con contratación disponible.
- [ ] Propagar red en links a hire, jobs, compare, quotes, diagnósticos y retorno al catálogo.
- [ ] Incluir red en claves de actualización optimista/cache y evitar contaminación al navegar atrás.
- [ ] En el checkout mostrar red antes de conectar wallet y solicitar cambio de red solo al preparar/firmar.
- [ ] Generar explorer y copia correctos por red; no fabricar enlaces de transacción para request hashes.
- [ ] Mantener máximo cinco filas por página en historiales y pestañas de red accesibles, con un solo loader por operación.
- [ ] Testnet no debe aparecer usable solo por tener jobs históricos o un endpoint online.

### 6.5 Tests multired

- [ ] Tests de agentes con mismo ID en redes distintas y de un endpoint público compartido.
- [ ] Tests de filtros combinados, facets, paginación y URLs legacy.
- [ ] Tests de quote válida en cada red y rechazo de chain/provider/pins incorrectos.
- [ ] Tests de caché, sesión, dedupe y recuperación sin cruces de red.
- [ ] Fixtures A2A, HTTP y MCP: compatibles, sin muestra pública, inválidos y con CORS fallback.
- [ ] Contratación Testnet autorizada: quote → wallet → receipt → funding → notificación/watcher → job indexado.
- [ ] Verificar que un agente nuevo compatible sin historial puede recibir una quote.
- [ ] Confirmar mediante lecturas que el rollout no altera jobs ni capacidades Mainnet existentes.

## 7. Documentación interna y pública

- [ ] Actualizar `docs/HIRE_RECOVERY.md`: batch, receipts, incertidumbre RPC, retry de notificación y redes.
- [ ] Actualizar `docs/COMPATIBILITY_SCAN_OPERATIONS.md`: selector real, budgets, colas, reintentos y métricas.
- [ ] Actualizar `docs/MARKETPLACE_ELIGIBILITY.md`: visibilidad principal/secundaria, TTL y semántica multired.
- [ ] Actualizar `docs/SELLER_NEGOTIATION_INPUT.md`: registro por red, schemas, muestras seguras y qué habilita el formulario.
- [ ] Actualizar guía externa `/docs/sellers`, metodología y referencia API/MCP con ejemplos por red.
- [ ] Explicar que identidad/online/jobs no garantizan contratación; que schema compatible permite solicitar y quote activa permite financiar.
- [ ] Explicar cuándo reaparece un agente tras corregir sus requisitos, sin prometer una revisión inmediata.
- [ ] Explicar que faltan agentes porque no cumplen o no se han verificado, distinguiendo ambas causas.
- [ ] Incluir errores accionables para vendedores, sin revelar infraestructura privada o secretos.
- [ ] Publicar límites/funcionalidad realmente desplegados; marcar lo planificado como tal.
- [ ] Validar enlaces, ejemplos, navegación desde footer y correspondencia exacta con filtros/UI.

## 8. Release y rollback

- [ ] Resolver estado de la rama `codex/sweep-observability` respecto de main antes de crear cambios dependientes.
- [ ] Confirmar qué Worker y D1 sirven realmente al frontend; el nombre staging no demuestra aislamiento de producción.
- [ ] Separar flags de reconciliación batch, scheduler adaptable, indexación Testnet y contratación Testnet.
- [ ] Ejecutar suites frontend/Worker, typecheck, build, diff check y pruebas de migración.
- [ ] Revisar seguridad de pagos/SSRF, presupuesto de tráfico y compatibilidad de APIs antes del merge.
- [ ] Crear PR con evidencia RED/GREEN, archivos por commit, cambios de esquema y operaciones remotas requeridas.
- [ ] Aplicar backup y migraciones expandibles si son necesarias; verificar resultado antes de desplegar consumidores nuevos.
- [ ] Desplegar corrección de pagos y probarla con fixtures/lecturas; nunca usar Mainnet como smoke de escritura.
- [ ] Desplegar scheduler en canary; observar ventana representativa antes de subir límites.
- [ ] Desplegar backend multired antes del frontend que lo requiere; activar Testnet solo tras datos reales y prueba autorizada.
- [ ] Si hay operaciones Vercel, verificar/actualizar CLI y seguir procedimiento del proyecto sin exponer variables.
- [ ] Smoke remoto de health, Agents/facets por red, hire/input, quote history, jobs y MCP.
- [ ] Verificar responsive, teclado, aria-busy, reduced motion y ausencia de warnings React.
- [ ] Preparar rollback de código/flags que reduzca tráfico sin borrar datos; no revertir destructivamente migraciones con datos nuevos.
- [ ] Registrar versiones, commits, migraciones aplicadas, flags, métricas y limitaciones conocidas.

## 9. Criterios finales de aceptación

- [ ] Un batch confirmado deja de girar y conserva evidencia verificable tras recarga.
- [ ] Un error del vendedor no se presenta como fallo del pago ni provoca un segundo funding.
- [ ] Ninguna quote nueva hereda una contratación anterior.
- [ ] Primera pasada avanza mediblemente más rápido sin concentrar carga excesiva en terceros.
- [ ] Compatibles vigentes no reciben probes redundantes durante bootstrap; mantenimiento sigue siendo explícito y acotado.
- [ ] Se conocen las causas de pendientes y un ETA solo se muestra cuando la evidencia permite estimarlo.
- [ ] Agents filtra Mainnet/Testnet de extremo a extremo, incluidos facets, historial y navegación.
- [ ] Agentes nuevos y antiguos con requisitos compatibles pueden solicitar quote sin depender de jobs previos.
- [ ] Contratación Testnet completa verificada; Mainnet validada sin nuevas transacciones.
- [ ] Documentación interna/externa explica exactamente qué hace visible y contratable a un agente.

## 10. Registro de ejecución

| Fase | Estado | Evidencia / commit / despliegue | Bloqueo |
|---|---|---|---|
| Incidente batch | Documentado | PAYMENT_INCIDENT_56717.md | No extender conclusiones a otros jobs |
| Corrección y TDD de pagos | Parcial publicado | HIRE_RECOVERY.md, PR #115 | Aceptación legacy/pending aún abierta |
| Baseline y diagnóstico de pendientes | Baseline realizado | DISCOVERY_BASELINE_2026-09-06.md | Renovar medición para evaluar aceleración |
| Scheduler adaptable y canary | Pendiente | — | Depende del baseline |
| Modelo y APIs multired | Pendiente | — | Verificar registros/pins y fuente Testnet |
| UI multired | Pendiente | — | Depende del backend multired |
| E2E Testnet | Pendiente | — | Wallet/presupuesto autorizado y seller compatible |
| Documentación y rollout | Pendiente | — | Debe reflejar implementación verificada |

## 11. Entrega verificable y cierre seguro (extensión explícita)

Prioridad: cerrar el ciclo de contratación sin confundir contenido accesible, integridad, calidad y estado económico.

- [x] Publicar lectura de entrega/política separada de financiación (PR #117).
- [x] Verificar en producción el endpoint y la UI del job 56719, sin transacciones.
- [x] Extraer criterios originales snake_case/camelCase y listas acotadas para el resaltado; nunca inferirlos de la prosa del vendedor. Implementado local con regresión RED/GREEN en tests/job-delivery.test.ts; aún sin publicar.
- [x] Evitar que disputed oculte un veredicto liquidable; distinguir liquidación por rechazo de finalización favorable. Implementación local; no ejecuta liquidación.
- [ ] Añadir adaptadores de manifiesto solo con esquema/hash reproducibles. Respuestas sin bindings siguen sin verificar.
- [ ] Determinar acciones y bloqueos según estado, política, wallet y reloj de bloque; no inferir éxito por tiempo transcurrido.
- [ ] Releer y simular cada acción antes de solicitar firma; validar receipt y estado final después.
- [ ] Separar journal de cierre de journal de funding por chain/contrato/job/wallet/acción; impedir segundo envío ante receipt incierto.
- [ ] Implementar UI de disputa, liquidación y devolución únicamente para políticas verificadas; sin claves del comprador en backend.
- [ ] Cubrir rechazo wallet, revert, timeout, recarga, cambio de wallet/red, doble clic, carrera de estados y cierre ya efectuado.
- [ ] Validar ciclo completo Testnet con seller compatible y presupuesto/wallet autorizados; no reducir ventanas de producción para acelerar pruebas.
- [ ] Validar después un ciclo externo Mainnet con autorización específica de cada operación económica.
- [ ] Publicar evidencia por etapa y separar capacidad de cotizar, entrega e historial de ciclos completos.

### Avance local del adaptador de cierre

- [x] Caso de uso separado de funding con simulación, doble lectura de wallet/estado, guardado previo a firma y resume sin send.
- [x] Adaptador directo Mainnet de dispute/settle con verificación de pins, recibo, calldata y estado resultante; sin activar en producción.
- [x] Exclusión entre pestañas y bloqueo conservador de intentos inciertos; tests con providers simulados.
- [x] UI detrás de NEXT_PUBLIC_JOB_CLOSURE_ENABLED, ausente/OFF por defecto. Sin cambios de configuración remota.
- [x] Recuperar rechazo explícito de wallet (4001 previo al hash), conservando historial y repitiendo preflight solo ante una nueva acción del usuario; regresión local rojo→verde.
- [ ] Completar recuperación explícita de revert y reemplazos conservando historial; por ahora bloquean nuevos envíos.
- [ ] Adaptador Testnet, pruebas wallet E2E y admisión de smart accounts; no heredar pins Mainnet.
- [ ] Devoluciones y reconciliación final con historial indexado.

Los checks anteriores acreditan implementación local, no firmas ejecutadas ni autorización de despliegue con acciones activas.

Sin migración prevista para el modelo de decisión y lectura. Persistencia/Worker nuevos requieren diseño y revisión de esquema previos. No activar automatismos de firma, disputa o liquidación como consecuencia de este plan.
