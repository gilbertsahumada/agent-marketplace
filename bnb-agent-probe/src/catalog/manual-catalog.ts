import { sql, type SQL } from 'drizzle-orm';

/** Operator-selected Mainnet offers captured 2026-10-08. This permits a buyer
 * to start fresh negotiation, not to reuse expired quotes or verified status.
 * Pin the endpoint and minimum successful requirements check: a replacement,
 * suspension, invalid requirements or a subsequent failure remains blocked.
 * No clock updates, background refresh or persistent availability booleans. */
export const manualCatalogue = [
  ['341565','37b748579f30a1537bd03ec7bc5236a6005a7d01cbf96485e3ae95afece0efed',1791443220696],
  ['341564','e14adde968702c05cf4816315e2d15f1a4613c09915101349b6ebf9f665e2344',1791456398622],
  ['341563','172918fbf135299b4caf4420bf85ea2931cbd7201561c8b021ed31a03ecdf119',1791441679991],
  ['303779','fa19c2da6083ae5d5b3828f270706ff28e041bb94e773ff94b8fa6de213b9b05',1791426604824],
  ['213432','6f94eb6099de7e23093d3c95d809a20d56bc25e17c9f3263f6be0ac2a87f3931',1791424266595],
  ['213378','0dcc191fc06d3e0e370680e65ce42dbac94449125df41de4235903110114442f',1791428705309],
  ['213332','9177f7c7b694cd737e949ea7e20093d4992ff95cfce985149bc41ca9366e3385',1791432669239],
  ['213084','ca77cdf59c64096c7b6cec2089607afcd9ba3ed5851f0c3db9fe67fae0cf84fe',1791427805103],
  ['213053','7a21470218c7623dbfbf742d56d05570da6a086bd427a35d61018d116ade75cc',1791439503706],
  ['213036','e094739c665263c2f784e0bb9072ed764eaa2a5eaf6927139797e475ce104f84',1791488181898],
  ['212989','62d9ed31579920668abe41d498274cb4eb395b75e8b5ba77e160986c1c225fac',1791444303371],
  ['212943','b841fa5f68eae55dd30fdf51c8b0b245590011b331ff1a0ef77902883c760a7a',1791435001904],
  ['212840','d9d542314d8ccbc1eb9b2fb9715a04e50a58ea8e0ff5f8ef1962e440ecaae002',1791430082893],
  ['212769','1135a60468484714ce85159d89bcb5d550b9c783f5dbb0631cb3bf37dbd8fafe',1791492606161],
  ['208760','321f6c7a34e27925500b5142285851b73cf63ffbca9c017b64f43ca135faad26',1791425581086],
  ['204789','a2b49fe3191de3137b3951d6de9d489e468fad79311530cd4c611fdbd2b0759f',1791492542020],
  ['265375','7685e1139c79af6e05f5398225988ba7026521c9b39b2b762f3d2d6deaa8f36d',1791503042371],
  ['269233','2fa77bd29ed0d7f4669449cebd2dc5d756e46c4c863987e18e8d8e8cc70164e9',1791431341514],
] as const;

export function hasManualCatalogueOffer(row: { agentKey?: string; endpointKey?: string; compatibilityCheckedAt?: number | null }): boolean {
  return manualCatalogue.some(([id,endpoint,checked]) => row.agentKey === `eip155:56:${id}`
    && row.endpointKey === endpoint && (row.compatibilityCheckedAt ?? 0) >= checked);
}

export function manualCatalogueOfferSql(column: (field: string) => SQL): SQL {
  // These are validated, immutable code literals, never request input. Binding
  // all 18 tuples at every policy occurrence would exceed D1's 100 parameters.
  for (const [id,endpoint,checked] of manualCatalogue) {
    if (!/^[1-9]\d*$/.test(id) || !/^[a-f0-9]{64}$/.test(endpoint) || !Number.isSafeInteger(checked)) {
      throw new Error('INVALID_MANUAL_CATALOGUE_LITERAL');
    }
  }
  return sql`CASE ${column('agentKey')} ${sql.join(manualCatalogue.map(([id,endpoint,checked]) =>
    sql`WHEN ${sql.raw(`'eip155:56:${id}'`)} THEN (${column('endpointKey')}=${sql.raw(`'${endpoint}'`)} AND ${column('compatibilityCheckedAt')}>=${sql.raw(String(checked))})`),sql` `)} ELSE 0 END`;
}
