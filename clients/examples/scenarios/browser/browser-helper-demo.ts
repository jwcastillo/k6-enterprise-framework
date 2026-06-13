/**
 * browser-helper-demo — BrowserHelper usage with k6 v1.2.1–v1.6.0+ APIs
 *
 * Demonstrates: Semantic locators (getByRole, getByLabel, getByText),
 * form filling, navigation (goBack/goForward), and page lifecycle.
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=browser/browser-helper-demo --profile=smoke
 *
 * Requires: k6 with browser module enabled (chromium)
 */

import { check, sleep } from "k6";
import { Options } from "k6/options";
import { BrowserHelper } from "@helpers/index";

export const options: Options = {
  scenarios: {
    browser_demo: {
      executor: "constant-vus",
      exec: "default",
      vus: 1,
      duration: "30s",
      options: {
        browser: {
          type: "chromium",
        },
      },
    },
  },
  thresholds: {
    checks: ["rate>0.9"],
    browser_web_vital_lcp: ["p(90)<3000"],
  },
};

const SITE_URL = __ENV["SITE_URL"] ?? "https://test.k6.io";

export default async function (): Promise<void> {
  const bh = new BrowserHelper({ defaultTimeout: 10000 });
  const page = await bh.newPage();

  try {
    // 1. Navigate using helper (includes auto-check)
    await bh.navigateTo(page, `${SITE_URL}/`, { waitUntil: "networkidle" });

    // 2. Use semantic locators (k6 v1.2.1+)
    const heading = bh.getByText(page, "Collection of simple");
    check(heading, {
      "heading found": (h) => h !== null,
    });

    // 3. Click a link by role (k6 v1.2.1+)
    await bh.clickLink(page, "Contacts");
    sleep(2);

    // 4. Navigate back (k6 v1.6.0+)
    await bh.goBack(page);
    sleep(1);

    // 5. Navigate forward (k6 v1.6.0+)
    await bh.goForward(page);
    sleep(1);

    check(page, {
      "contacts: returned": (p) => p.url().includes("contacts"),
    });
  } finally {
    await bh.closePage(page);
  }
}
