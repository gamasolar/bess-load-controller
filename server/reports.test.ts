import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "local",
    passwordHash: null,
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("bess.reports (paginated)", () => {
  it("returns paginated response with items, totalCount, page, pageSize, totalPages", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bess.reports({ limit: 10, page: 1 });

    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("totalCount");
    expect(result).toHaveProperty("page");
    expect(result).toHaveProperty("pageSize");
    expect(result).toHaveProperty("totalPages");
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.totalCount).toBe("number");
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
  });

  it("accepts slug filter parameter", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bess.reports({ slug: "piscinao", limit: 10, page: 1 });

    expect(Array.isArray(result.items)).toBe(true);
    expect(result).toHaveProperty("totalCount");
  });

  it("returns reports with expected shape when data exists", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // Generate a report first
    const genResult = await caller.bess.generateReport({
      slug: "piscinao",
      reportType: "daily",
    });

    // If generation succeeded, verify the report shape
    if (genResult.success) {
      const result = await caller.bess.reports({ slug: "piscinao", limit: 1, page: 1 });
      expect(result.items.length).toBeGreaterThan(0);

      const report = result.items[0];
      expect(report).toHaveProperty("id");
      expect(report).toHaveProperty("siteId");
      expect(report).toHaveProperty("reportType");
      expect(report).toHaveProperty("periodStart");
      expect(report).toHaveProperty("periodEnd");
      expect(report).toHaveProperty("avgSoc");
      expect(report).toHaveProperty("minSoc");
      expect(report).toHaveProperty("maxSoc");
      expect(report).toHaveProperty("totalReadings");
      expect(report).toHaveProperty("loadOnMinutes");
      expect(report).toHaveProperty("estimatedEnergyKwh");
      expect(report).toHaveProperty("totalEvents");
      expect(report).toHaveProperty("totalAlarms");
      expect(report).toHaveProperty("maneuverCount");
      expect(report).toHaveProperty("notificationSent");
      expect(report).toHaveProperty("createdAt");
      expect(report!.reportType).toBe("daily");
    }
  });

  it("respects page parameter for pagination", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const page1 = await caller.bess.reports({ limit: 5, page: 1 });
    const page2 = await caller.bess.reports({ limit: 5, page: 2 });

    expect(page1.page).toBe(1);
    expect(page2.page).toBe(2);
    // If there are enough reports, pages should have different items
    if (page1.totalCount > 5 && page2.items.length > 0) {
      expect(page1.items[0].id).not.toBe(page2.items[0].id);
    }
  });

  it("totalPages is consistent with totalCount and pageSize", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bess.reports({ limit: 5, page: 1 });

    expect(result.totalPages).toBe(Math.ceil(result.totalCount / result.pageSize));
  });
});

describe("bess.generateReport", () => {
  it("generates a daily report for a valid site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bess.generateReport({
      slug: "piscinao",
      reportType: "daily",
    });

    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("message");
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.message).toBe("string");
  });

  it("generates a weekly report for a valid site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bess.generateReport({
      slug: "barragem",
      reportType: "weekly",
    });

    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("message");
  });

  it("returns failure for non-existent site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bess.generateReport({
      slug: "site-inexistente",
      reportType: "daily",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("não encontrado");
  });

  it("includes report metrics when generation succeeds", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bess.generateReport({
      slug: "piscinao",
      reportType: "daily",
    });

    if (result.success && result.report) {
      expect(typeof result.report.avgSoc).toBe("number");
      expect(typeof result.report.minSoc).toBe("number");
      expect(typeof result.report.maxSoc).toBe("number");
      expect(typeof result.report.loadOnMinutes).toBe("number");
      expect(typeof result.report.estimatedEnergyKwh).toBe("number");
      expect(typeof result.report.totalEvents).toBe("number");
      expect(typeof result.report.totalAlarms).toBe("number");
      expect(typeof result.report.maneuverCount).toBe("number");
      // SOC values should be within valid range
      expect(result.report.avgSoc).toBeGreaterThanOrEqual(0);
      expect(result.report.avgSoc).toBeLessThanOrEqual(100);
      expect(result.report.minSoc).toBeLessThanOrEqual(result.report.avgSoc);
      expect(result.report.maxSoc).toBeGreaterThanOrEqual(result.report.avgSoc);
    }
  });
});

describe("bess.reportTrends", () => {
  it("returns an array of trend data points", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const trends = await caller.bess.reportTrends({ limit: 50 });

    expect(Array.isArray(trends)).toBe(true);
  });

  it("accepts slug filter parameter", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const trends = await caller.bess.reportTrends({ slug: "piscinao", limit: 50 });

    expect(Array.isArray(trends)).toBe(true);
    for (const t of trends) {
      expect(t.siteId).toBeDefined();
    }
  });

  it("accepts reportType filter parameter", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const trends = await caller.bess.reportTrends({ reportType: "daily", limit: 50 });

    expect(Array.isArray(trends)).toBe(true);
    for (const t of trends) {
      expect(t.reportType).toBe("daily");
    }
  });

  it("returns trend data with expected shape", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await caller.bess.generateReport({ slug: "piscinao", reportType: "daily" });

    const trends = await caller.bess.reportTrends({ slug: "piscinao", limit: 10 });

    if (trends.length > 0) {
      const t = trends[0];
      expect(t).toHaveProperty("id");
      expect(t).toHaveProperty("siteId");
      expect(t).toHaveProperty("reportType");
      expect(t).toHaveProperty("periodStart");
      expect(t).toHaveProperty("periodEnd");
      expect(t).toHaveProperty("avgSoc");
      expect(t).toHaveProperty("minSoc");
      expect(t).toHaveProperty("maxSoc");
      expect(t).toHaveProperty("estimatedEnergyKwh");
      expect(t).toHaveProperty("loadOnMinutes");
      expect(t).toHaveProperty("totalEvents");
      expect(t).toHaveProperty("totalAlarms");
      expect(t).toHaveProperty("maneuverCount");
      expect(typeof t.avgSoc).toBe("number");
      expect(typeof t.estimatedEnergyKwh).toBe("number");
    }
  });

  it("returns temperature and alarm data in trend response", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await caller.bess.generateReport({ slug: "piscinao", reportType: "daily" });

    const trends = await caller.bess.reportTrends({ slug: "piscinao", limit: 10 });

    if (trends.length > 0) {
      const t = trends[0];
      expect(t).toHaveProperty("avgTemperature");
      expect(t).toHaveProperty("totalAlarms");
      expect(typeof t.totalAlarms).toBe("number");
      expect(t.totalAlarms).toBeGreaterThanOrEqual(0);
      if (t.avgTemperature !== null) {
        expect(typeof t.avgTemperature).toBe("number");
      }
    }
  });

  it("accepts sinceDays filter parameter", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const trends7 = await caller.bess.reportTrends({ sinceDays: 7, limit: 100 });
    const trends90 = await caller.bess.reportTrends({ sinceDays: 90, limit: 100 });

    expect(Array.isArray(trends7)).toBe(true);
    expect(Array.isArray(trends90)).toBe(true);
    expect(trends90.length).toBeGreaterThanOrEqual(trends7.length);
  });

  it("returns data ordered by periodEnd ascending (oldest first)", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const trends = await caller.bess.reportTrends({ limit: 50 });

    if (trends.length >= 2) {
      for (let i = 1; i < trends.length; i++) {
        const prev = new Date(trends[i - 1].periodEnd).getTime();
        const curr = new Date(trends[i].periodEnd).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    }
  });
});

describe("bess.generateAllReports", () => {
  it("generates reports for all sites and returns summary", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bess.generateAllReports({
      reportType: "daily",
    });

    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("notified");
    expect(result).toHaveProperty("reports");
    expect(Array.isArray(result.reports)).toBe(true);
    expect(typeof result.notified).toBe("boolean");

    for (const r of result.reports) {
      expect(r).toHaveProperty("siteName");
      expect(r).toHaveProperty("success");
      expect(r).toHaveProperty("message");
    }
  });
});

describe("bess.schedulerSettings", () => {
  it("returns scheduler settings with enabled, dailyHour, weeklyDay", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const settings = await caller.bess.schedulerSettings();

    expect(settings).toHaveProperty("enabled");
    expect(settings).toHaveProperty("dailyHour");
    expect(settings).toHaveProperty("weeklyDay");
    expect(typeof settings.enabled).toBe("boolean");
    expect(typeof settings.dailyHour).toBe("number");
    expect(typeof settings.weeklyDay).toBe("number");
    expect(settings.dailyHour).toBeGreaterThanOrEqual(0);
    expect(settings.dailyHour).toBeLessThanOrEqual(23);
    expect(settings.weeklyDay).toBeGreaterThanOrEqual(0);
    expect(settings.weeklyDay).toBeLessThanOrEqual(6);
  });

  it("updates dailyHour setting", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const updated = await caller.bess.updateSchedulerSettings({ dailyHour: 8 });

    expect(updated.dailyHour).toBe(8);
  });

  it("updates weeklyDay setting", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const updated = await caller.bess.updateSchedulerSettings({ weeklyDay: 5 });

    expect(updated.weeklyDay).toBe(5);
  });

  it("updates enabled setting", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const disabled = await caller.bess.updateSchedulerSettings({ enabled: false });
    expect(disabled.enabled).toBe(false);

    // Re-enable
    const enabled = await caller.bess.updateSchedulerSettings({ enabled: true });
    expect(enabled.enabled).toBe(true);
  });

  it("updates multiple settings at once", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const updated = await caller.bess.updateSchedulerSettings({
      dailyHour: 22,
      weeklyDay: 0,
      enabled: true,
    });

    expect(updated.dailyHour).toBe(22);
    expect(updated.weeklyDay).toBe(0);
    expect(updated.enabled).toBe(true);

    // Restore defaults
    await caller.bess.updateSchedulerSettings({ dailyHour: 6, weeklyDay: 1 });
  });
});
