export interface D1ResultLike<Meta = unknown, Row = unknown> {
  readonly success: boolean;
  readonly meta: Meta;
  readonly results?: readonly Row[];
}

export interface D1PreparedStatementLike {
  bind(...values: readonly unknown[]): D1PreparedStatementLike;
  first<Row = Record<string, unknown>>(): Promise<Row | null>;
  all<Row = Record<string, unknown>>(): Promise<D1ResultLike<unknown, Row>>;
  run<Meta = unknown>(): Promise<D1ResultLike<Meta>>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<Meta = unknown>(
    statements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1ResultLike<Meta>[]>;
}

export interface RuntimeState {
  readonly key: string;
  readonly textValue: string | null;
  readonly integerValue: number | null;
  readonly updatedAt: number;
}

export async function readRuntimeState(
  db: D1DatabaseLike,
  key: string,
): Promise<RuntimeState | null> {
  assertRuntimeStateKey(key);

  return db
    .prepare(
      `SELECT key, textValue, integerValue, updatedAt
       FROM runtime_state
       WHERE key = ?`,
    )
    .bind(key)
    .first<RuntimeState>();
}

export async function writeRuntimeState(
  db: D1DatabaseLike,
  state: RuntimeState,
): Promise<void> {
  assertRuntimeStateKey(state.key);
  assertEpochMilliseconds(state.updatedAt, "updatedAt");
  if (state.integerValue !== null) {
    assertSafeInteger(state.integerValue, "integerValue");
  }

  const result = await db
    .prepare(
      `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         textValue = excluded.textValue,
         integerValue = excluded.integerValue,
         updatedAt = excluded.updatedAt`,
    )
    .bind(state.key, state.textValue, state.integerValue, state.updatedAt)
    .run();

  if (!result.success) {
    throw new Error(`Could not persist runtime state: ${state.key}`);
  }
}

export function prepareStatement(
  db: D1DatabaseLike,
  query: string,
  values: readonly unknown[] = [],
): D1PreparedStatementLike {
  if (query.trim().length === 0) {
    throw new Error("D1 query must not be empty");
  }

  return db.prepare(query).bind(...values);
}

export async function executeBatch<Meta = unknown>(
  db: D1DatabaseLike,
  statements: readonly D1PreparedStatementLike[],
): Promise<readonly D1ResultLike<Meta>[]> {
  if (statements.length === 0) return [];

  const results = await db.batch<Meta>(statements);
  if (results.length !== statements.length || results.some((result) => !result.success)) {
    throw new Error("D1 batch did not complete successfully");
  }

  return results;
}

function assertRuntimeStateKey(key: string): void {
  if (key.trim().length === 0) {
    throw new Error("runtime_state key must not be empty");
  }
}

function assertEpochMilliseconds(value: number, label: string): void {
  assertSafeInteger(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative`);
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`);
  }
}
