/**
 * web-vitals-demo — Browser-based Core Web Vitals measurement
 *
 * Navigates a real Chromium browser through test.k6.io pages collecting
 * LCP, FCP, CLS, TTFB, INP automatically via k6 browser module.
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=browser/web-vitals-demo --profile=smoke
 */

import { browser } from "k6/browser";
import { check, sleep } from "k6";
import { Options } from "k6/options";

export const options: Options = {
  scenarios: {
    browser_vitals: {
      executor: "constant-vus",
      exec: "default",
      vus: 1,
      duration: "60s",
      options: {
        browser: {
          type: "chromium",
        },
      },
    },
  },
  thresholds: {
    browser_web_vital_lcp: ["p(90)<2500"],
    browser_web_vital_fcp: ["p(90)<1800"],
    browser_web_vital_cls: ["p(90)<0.1"],
    browser_web_vital_ttfb: ["p(90)<800"],
    browser_web_vital_inp: ["p(90)<200"],
  },
};

const SITE_URL = "https://test.k6.io";

export default async function (): Promise<void> {
  const page = await browser.newPage();

  try {
    // Page 1: Landing
    await page.goto(`${SITE_URL}/`, { waitUntil: "networkidle" });
    check(page, {
      "landing: loaded": (p) => p.url().includes("test.k6.io"),
    });
    sleep(3);

    // Page 2: Contacts
    await page.goto(`${SITE_URL}/contacts.php`, { waitUntil: "networkidle" });
    check(page, {
      "contacts: loaded": (p) => p.url().includes("contacts"),
    });
    sleep(3);

    // Page 3: News
    await page.goto(`${SITE_URL}/news.php`, { waitUntil: "networkidle" });
    check(page, {
      "news: loaded": (p) => p.url().includes("news"),
    });
    sleep(3);
  } finally {
    await page.close();
  }
}
