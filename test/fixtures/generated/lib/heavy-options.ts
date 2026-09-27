// Fixture: helper-built options that break the resolved-options checks
// (no thresholds, 'url' system tag, VU and arrival-rate ceilings exceeded).
import type { Options } from "k6/options";

const build = (peak: number): Options => ({
  scenarios: {
    browse: { executor: "ramping-vus", stages: [{ duration: "1m", target: peak }] },
    orders: {
      executor: "ramping-arrival-rate",
      preAllocatedVUs: 10,
      maxVUs: 20,
      stages: [{ duration: "1m", target: peak * 2 }],
    },
  },
  systemTags: ["status", "url"],
});

export const heavyOptions = build(150);
