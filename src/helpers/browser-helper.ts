/** T-021: BrowserHelper — Enterprise browser testing utilities (k6 v1.2.1–v1.6.0+ APIs) */

import { browser } from "k6/browser";
import { check } from "k6";
import type { Page, Locator, FrameLocator, Response, Request } from "k6/browser";

export interface BrowserHelperConfig {
  /** Default navigation timeout in ms (default: 30000) */
  defaultTimeout?: number;
  /** Tags for k6 metrics */
  tags?: Record<string, string>;
}

/**
 * BrowserHelper — enterprise wrapper around the k6 browser module.
 *
 * Exposes APIs introduced in k6 v1.2.1–v1.6.0:
 * - Semantic locators: getByRole, getByLabel, getByText (v1.2.1+)
 * - Frame locators: frameLocator (v1.6.0+)
 * - Navigation: goBack, goForward (v1.6.0+)
 * - Route interception: route, unroute, unrouteAll (v1.2.1–v1.4.0)
 * - Wait helpers: waitForURL, waitForRequest, waitForResponse, waitForEvent (v1.2.1–v1.5.0)
 * - Input: pressSequentially (v1.5.0+)
 * - Locator chaining: locator.locator(), filter, all (v1.2.1–v1.3.0)
 */
export class BrowserHelper {
  private config: BrowserHelperConfig;

  constructor(config: BrowserHelperConfig = {}) {
    this.config = {
      defaultTimeout: 30000,
      ...config,
    };
  }

  /** Create a new browser page */
  async newPage(): Promise<Page> {
    return browser.newPage();
  }

  /**
   * Navigate to URL with automatic check.
   * Uses page.goto() with configurable waitUntil strategy.
   */
  async navigateTo(
    page: Page,
    url: string,
    opts: { waitUntil?: "load" | "domcontentloaded" | "networkidle" } = {}
  ): Promise<void> {
    const waitUntil = opts.waitUntil ?? "load";
    await page.goto(url, { waitUntil });
    check(page, {
      [`navigate: loaded ${url}`]: (p) => p.url().includes(new URL(url).hostname),
    });
  }

  /**
   * Wait for URL to match a pattern (k6 v1.2.1+).
   */
  async waitForUrl(page: Page, urlPattern: string | RegExp): Promise<void> {
    await (page as unknown as Record<string, CallableFunction>).waitForURL(urlPattern, {
      timeout: this.config.defaultTimeout,
    });
  }

  /**
   * Fill a form field using semantic label locator (k6 v1.2.1+).
   * Uses page.getByLabel() for accessible element targeting.
   */
  async fillByLabel(page: Page, label: string, value: string): Promise<void> {
    const locator = page.getByLabel(label);
    await locator.fill(value);
  }

  /**
   * Click a button by its accessible role and name (k6 v1.2.1+).
   * Uses page.getByRole() for semantic targeting.
   */
  async clickButton(page: Page, name: string): Promise<void> {
    const locator = page.getByRole("button", { name });
    await locator.click();
  }

  /**
   * Click a link by its accessible text (k6 v1.2.1+).
   * Uses page.getByRole() with "link" role.
   */
  async clickLink(page: Page, name: string): Promise<void> {
    const locator = page.getByRole("link", { name });
    await locator.click();
  }

  /**
   * Get a locator by text content (k6 v1.2.1+).
   */
  getByText(page: Page, text: string, opts?: { exact?: boolean }): Locator {
    return page.getByText(text, opts);
  }

  /**
   * Get a frame locator for iframe interaction (k6 v1.6.0+).
   */
  frameLocator(page: Page, selector: string): FrameLocator {
    return (page as unknown as Record<string, CallableFunction>).frameLocator(
      selector
    ) as FrameLocator;
  }

  /**
   * Navigate back in browser history (k6 v1.6.0+).
   */
  async goBack(page: Page): Promise<void> {
    await (page as unknown as Record<string, CallableFunction>).goBack({
      timeout: this.config.defaultTimeout,
    });
  }

  /**
   * Navigate forward in browser history (k6 v1.6.0+).
   */
  async goForward(page: Page): Promise<void> {
    await (page as unknown as Record<string, CallableFunction>).goForward({
      timeout: this.config.defaultTimeout,
    });
  }

  /**
   * Type text character by character (k6 v1.5.0+).
   * Useful for simulating real user typing with delays.
   */
  async typeSequentially(locator: Locator, text: string, opts?: { delay?: number }): Promise<void> {
    await (locator as unknown as Record<string, CallableFunction>).pressSequentially(text, {
      delay: opts?.delay ?? 100,
    });
  }

  /**
   * Setup HTTP route interception on a page (k6 v1.2.1+).
   * Allows intercepting and modifying network requests.
   */
  async interceptRoute(
    page: Page,
    urlPattern: string | RegExp,
    handler: (route: unknown, request: unknown) => void
  ): Promise<void> {
    await (page as unknown as Record<string, CallableFunction>).route(urlPattern, handler);
  }

  /**
   * Remove all route interceptions from a page (k6 v1.4.0+).
   */
  async clearRoutes(page: Page): Promise<void> {
    await (page as unknown as Record<string, CallableFunction>).unrouteAll();
  }

  /**
   * Wait for a network request matching a URL pattern (k6 v1.4.0+).
   */
  async waitForRequest(page: Page, urlPattern: string | RegExp): Promise<Request> {
    return (page as unknown as Record<string, CallableFunction>).waitForRequest(urlPattern, {
      timeout: this.config.defaultTimeout,
    }) as Promise<Request>;
  }

  /**
   * Wait for a network response matching a URL pattern (k6 v1.3.0+).
   */
  async waitForResponse(page: Page, urlPattern: string | RegExp): Promise<Response> {
    return (page as unknown as Record<string, CallableFunction>).waitForResponse(urlPattern, {
      timeout: this.config.defaultTimeout,
    }) as Promise<Response>;
  }

  /**
   * Wait for a specific event on the page (k6 v1.5.0+).
   */
  async waitForEvent(page: Page, event: string): Promise<unknown> {
    return (page as unknown as Record<string, CallableFunction>).waitForEvent(event, {
      timeout: this.config.defaultTimeout,
    }) as Promise<unknown>;
  }

  /**
   * Get all matching locators as an array (k6 v1.2.1+).
   */
  async getAll(locator: Locator): Promise<Locator[]> {
    return (locator as unknown as Record<string, CallableFunction>).all() as Promise<Locator[]>;
  }

  /**
   * Safely close page with error handling.
   */
  async closePage(page: Page): Promise<void> {
    try {
      await page.close();
    } catch (err) {
      console.warn(`[BrowserHelper] Error closing page: ${err}`);
    }
  }
}
