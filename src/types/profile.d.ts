/** Load profile types for k6 Enterprise Framework */

export type ProfileName =
  | "smoke"
  | "quick"
  | "load"
  | "load-vu"
  | "rampup"
  | "capacity"
  | "stress"
  | "stress-vu"
  | "spike"
  | "spike-vu"
  | "breakpoint"
  | "soak"
  | "soak-vu"
  | "throughput-low"
  | "throughput-medium"
  | "throughput-high"
  | "throughput-ramp";

export interface StageDefinition {
  duration: string;
  target: number;
}

export interface ThresholdDefinition {
  [metric: string]: string[];
}

/** VU-based profile — uses ramping-vus executor (closed model) */
export interface VUBasedProfile {
  name: ProfileName;
  description: string;
  executor?: undefined;
  stages: StageDefinition[];
  thresholds: ThresholdDefinition;
  /** Maximum test duration including ramp-down */
  maxDuration?: string;
}

/** Arrival-rate profile — uses constant/ramping-arrival-rate executor (open model) */
export interface ArrivalRateProfile {
  name: ProfileName;
  description: string;
  executor: "constant-arrival-rate" | "ramping-arrival-rate";
  rate?: number;
  timeUnit?: string;
  duration?: string;
  stages?: StageDefinition[];
  preAllocatedVUs: number;
  maxVUs: number;
  thresholds: ThresholdDefinition;
  maxDuration?: string;
}

export type LoadProfile = VUBasedProfile | ArrivalRateProfile;
