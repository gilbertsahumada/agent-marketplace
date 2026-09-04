import { env } from "cloudflare:workers";

export async function clearCatalogObservationFixtures(): Promise<void> {
  await env.DB.prepare("DROP TRIGGER IF EXISTS catalog_observations_no_update").run();
  await env.DB.prepare("DROP TRIGGER IF EXISTS catalog_observations_no_delete").run();
  await env.DB.prepare("DELETE FROM catalog_observations").run();
  await env.DB.prepare("DELETE FROM sqlite_sequence WHERE name='catalog_observations'").run();
  await env.DB.prepare(`CREATE TRIGGER catalog_observations_no_update
    BEFORE UPDATE ON catalog_observations
    BEGIN SELECT RAISE(ABORT, 'catalog_observations is append-only'); END`).run();
  await env.DB.prepare(`CREATE TRIGGER catalog_observations_no_delete
    BEFORE DELETE ON catalog_observations
    BEGIN SELECT RAISE(ABORT, 'catalog_observations is append-only'); END`).run();
}

export async function clearCatalogFixtures(): Promise<void> {
  await clearCatalogObservationFixtures();
  await env.DB.prepare("DELETE FROM hire_events").run();
  await env.DB.prepare("DELETE FROM commerce_jobs").run();
  await env.DB.prepare("DELETE FROM catalog_quote_attempts").run();
  await env.DB.prepare("DELETE FROM catalog_quote_requests").run();
  await env.DB.prepare("DELETE FROM catalog_seller_capabilities").run();
  await env.DB.prepare("DELETE FROM catalog_validation_requests").run();
  await env.DB.prepare("DELETE FROM catalog_ingest_tasks").run();
  await env.DB.prepare("DELETE FROM catalog_directed_tracking").run();
  await env.DB.prepare("DELETE FROM catalog_agent_admission").run();
  await env.DB.prepare("DELETE FROM catalog_agent_endpoints").run();
  await env.DB.prepare("DELETE FROM catalog_endpoints").run();
  await env.DB.prepare("DELETE FROM catalog_agents").run();
}
