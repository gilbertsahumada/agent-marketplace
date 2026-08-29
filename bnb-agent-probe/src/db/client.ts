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
  raw?<Row extends unknown[]>(options?: { columnNames?: boolean }): Promise<Row[]>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<Meta = unknown>(
    statements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1ResultLike<Meta>[]>;
}
