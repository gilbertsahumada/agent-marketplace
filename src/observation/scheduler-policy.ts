import type { ObservationWorkerConfig } from "./worker-config.ts";

export type ObservationPhase = "header" | "sweep" | "probe";

const PIPELINE: readonly ObservationPhase[] = ["header", "sweep", "probe"];

export function rotateObservationPhase(current: ObservationPhase): ObservationPhase {
  if (current === "header") return "sweep";
  if (current === "sweep") return "probe";
  return "header";
}

export function phasesForInvocation(
  config: Pick<ObservationWorkerConfig, "schedulerMode">,
  persistedPhase: ObservationPhase,
): readonly ObservationPhase[] {
  return config.schedulerMode === "single_phase" ? [persistedPhase] : PIPELINE;
}
