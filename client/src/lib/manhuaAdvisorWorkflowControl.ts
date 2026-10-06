import type { CreativeVoiceProductionAction } from "@shared/creativeVoiceProduction";

export type AdvisorModelAction = Extract<
  CreativeVoiceProductionAction,
  { action: "modelControl" }
>;
export type AdvisorModelControl = (
  action: AdvisorModelAction,
  signal: AbortSignal
) => Promise<string>;
export type AdvisorModelRegistration = (
  assetId: string,
  control: AdvisorModelControl | null
) => void;
export type AdvisorWorldAction = Extract<
  CreativeVoiceProductionAction,
  { action: "worldControl" }
>;
export type AdvisorWorldControl = (
  action: AdvisorWorldAction,
  signal: AbortSignal
) => Promise<string>;
export type AdvisorWorldRegistration = (
  control: AdvisorWorldControl | null
) => void;

export type AdvisorScoringAction = Extract<
  CreativeVoiceProductionAction,
  { action: "scoring" }
>;
export type AdvisorScoringControl = (
  action: AdvisorScoringAction,
  signal: AbortSignal
) => Promise<string>;
export type AdvisorScoringRegistration = (
  scope: string,
  control: AdvisorScoringControl | null
) => void;
export type AdvisorBgmControl = (
  operation: "inspect" | "analyze" | "applyAdvice",
  signal: AbortSignal,
  question?: string
) => Promise<string>;

export type AdvisorEditAction = Extract<
  CreativeVoiceProductionAction,
  { action: "edit" }
>;
export type AdvisorEditControl = (
  action: AdvisorEditAction,
  signal: AbortSignal
) => Promise<string>;
export type AdvisorEditRegistration = (
  control: AdvisorEditControl | null
) => void;
