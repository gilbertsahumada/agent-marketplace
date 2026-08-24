import "server-only";

type Environment = Readonly<Record<string, string | undefined>>;

export function areMainnetWritesEnabled(env: Environment = process.env): boolean {
  return Reflect.get(env, "ERC8183_MAINNET_WRITES_ENABLED") === "true";
}
