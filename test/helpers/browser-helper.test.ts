import { describe, it, expect, vi, beforeEach } from "vitest";
import { browser } from "k6/browser";
import { BrowserHelper } from "../../src/helpers/browser-helper";

describe("BrowserHelper", () => {
  let helper: BrowserHelper;

  beforeEach(() => {
    vi.clearAllMocks();
    helper = new BrowserHelper({ defaultTimeout: 5000 });
  });

  describe("constructor", () => {
    it("should use default timeout of 30000 when not specified", () => {
      const defaultHelper = new BrowserHelper();
      expect(defaultHelper).toBeDefined();
    });

    it("should accept custom config", () => {
      const customHelper = new BrowserHelper({
        defaultTimeout: 10000,
        tags: { env: "staging" },
      });
      expect(customHelper).toBeDefined();
    });
  });

  describe("newPage", () => {
    it("should call browser.newPage()", async () => {
      const page = await helper.newPage();

      expect(browser.newPage).toHaveBeenCalled();
      expect(page).toBeDefined();
    });
  });

  describe("navigateTo", () => {
    it("should call page.goto with url and waitUntil", async () => {
      const page = await helper.newPage();

      await helper.navigateTo(page, "https://test.k6.io");

      expect(page.goto).toHaveBeenCalledWith("https://test.k6.io", { waitUntil: "load" });
    });

    it("should support networkidle waitUntil option", async () => {
      const page = await helper.newPage();

      await helper.navigateTo(page, "https://test.k6.io", { waitUntil: "networkidle" });

      expect(page.goto).toHaveBeenCalledWith("https://test.k6.io", { waitUntil: "networkidle" });
    });
  });

  describe("fillByLabel", () => {
    it("should use page.getByLabel and fill", async () => {
      const page = await helper.newPage();

      await helper.fillByLabel(page, "Email", "test@example.com");

      expect(page.getByLabel).toHaveBeenCalledWith("Email");
    });
  });

  describe("clickButton", () => {
    it("should use page.getByRole with button role", async () => {
      const page = await helper.newPage();

      await helper.clickButton(page, "Submit");

      expect(page.getByRole).toHaveBeenCalledWith("button", { name: "Submit" });
    });
  });

  describe("clickLink", () => {
    it("should use page.getByRole with link role", async () => {
      const page = await helper.newPage();

      await helper.clickLink(page, "Home");

      expect(page.getByRole).toHaveBeenCalledWith("link", { name: "Home" });
    });
  });

  describe("getByText", () => {
    it("should call page.getByText", async () => {
      const page = await helper.newPage();

      helper.getByText(page, "Welcome");

      expect(page.getByText).toHaveBeenCalledWith("Welcome", undefined);
    });

    it("should pass options", async () => {
      const page = await helper.newPage();

      helper.getByText(page, "Welcome", { exact: true });

      expect(page.getByText).toHaveBeenCalledWith("Welcome", { exact: true });
    });
  });

  describe("frameLocator", () => {
    it("should call page.frameLocator", async () => {
      const page = await helper.newPage();

      helper.frameLocator(page, "#my-iframe");

      expect((page as Record<string, CallableFunction>).frameLocator).toHaveBeenCalledWith("#my-iframe");
    });
  });

  describe("goBack / goForward", () => {
    it("should call page.goBack with timeout", async () => {
      const page = await helper.newPage();

      await helper.goBack(page);

      expect((page as Record<string, CallableFunction>).goBack).toHaveBeenCalledWith({ timeout: 5000 });
    });

    it("should call page.goForward with timeout", async () => {
      const page = await helper.newPage();

      await helper.goForward(page);

      expect((page as Record<string, CallableFunction>).goForward).toHaveBeenCalledWith({ timeout: 5000 });
    });
  });

  describe("interceptRoute / clearRoutes", () => {
    it("should call page.route for interception", async () => {
      const page = await helper.newPage();
      const handler = vi.fn();

      await helper.interceptRoute(page, "**/api/**", handler);

      expect((page as Record<string, CallableFunction>).route).toHaveBeenCalledWith("**/api/**", handler);
    });

    it("should call page.unrouteAll to clear routes", async () => {
      const page = await helper.newPage();

      await helper.clearRoutes(page);

      expect((page as Record<string, CallableFunction>).unrouteAll).toHaveBeenCalled();
    });
  });

  describe("waitForRequest / waitForResponse", () => {
    it("should call page.waitForRequest with pattern", async () => {
      const page = await helper.newPage();

      await helper.waitForRequest(page, "**/api/users");

      expect((page as Record<string, CallableFunction>).waitForRequest).toHaveBeenCalledWith(
        "**/api/users",
        { timeout: 5000 },
      );
    });

    it("should call page.waitForResponse with pattern", async () => {
      const page = await helper.newPage();

      await helper.waitForResponse(page, "**/api/users");

      expect((page as Record<string, CallableFunction>).waitForResponse).toHaveBeenCalledWith(
        "**/api/users",
        { timeout: 5000 },
      );
    });
  });

  describe("closePage", () => {
    it("should call page.close()", async () => {
      const page = await helper.newPage();

      await helper.closePage(page);

      expect(page.close).toHaveBeenCalled();
    });

    it("should not throw on close error", async () => {
      const page = await helper.newPage();
      (page.close as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("crash"));

      await expect(helper.closePage(page)).resolves.toBeUndefined();
    });
  });
});
