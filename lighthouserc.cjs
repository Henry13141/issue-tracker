/**
 * Lighthouse CI — 在 GitHub Actions 中定期对生产站点做合成监控。
 * 覆盖域名可通过环境变量 LHCI_BASE_URL 覆盖（默认 tracker.megami-tech.com）。
 */
const base = process.env.LHCI_BASE_URL || "https://tracker.megami-tech.com";

module.exports = {
  ci: {
    collect: {
      url: [`${base.replace(/\/$/, "")}/login`, `${base.replace(/\/$/, "")}/`],
      numberOfRuns: 2,
      settings: {
        preset: "desktop",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.82 }],
        "categories:accessibility": ["warn", { minScore: 0.85 }],
        "first-contentful-paint": ["warn", { maxNumericValue: 4000 }],
        "largest-contentful-paint": ["warn", { maxNumericValue: 4500 }],
      },
    },
  },
};
