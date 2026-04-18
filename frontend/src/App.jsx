import React, {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

const STORAGE_KEY = "reviewiq:workspace:v1";
const API_BASE = "/api";
const MIN_PROCESSING_MS = 2200;

const DEFAULT_WEIGHTS = {
  battery: 1.95,
  camera: 1.25,
  ui: 1.05,
  crash: 2.0,
  payment: 1.85,
  performance: 1.55,
  support: 1.1,
  search: 1.2,
  notifications: 0.95,
  storage: 1.25,
  ads: 0.8,
  delivery: 1.4,
  overall: 1.0,
};

const DEFAULT_WORKSPACE = {
  productName: "Aurora X1",
  primaryCsvText: "",
  competitorCsvText: "",
  reviewUrl: "",
  urlManualText: "",
  sourceName: "",
  competitorSourceName: "",
  urlSourceName: "",
  weights: DEFAULT_WEIGHTS,
  analysis: null,
  urlAnalysis: null,
  selectedIssueId: "",
  urlSelectedIssueId: "",
  playQuery: "",
  playSearchResults: [],
  selectedApp: null,
  playAnalysis: null,
  playSelectedIssueId: "",
  focusFeature: "",
  search: "",
  lastRun: "",
};

const NAV_ITEMS = [
  { id: "home", label: "Home" },
  { id: "csv", label: "CSV Analyzer" },
  { id: "url", label: "URL Analyzer" },
  { id: "play", label: "Play Store Analyzer" },
  { id: "compare", label: "Compare / Aggregate" },
];

const DEFAULT_PIPELINE = [
  { name: "1. Ingestion", detail: "Waiting for raw review text.", progress: 5 },
  {
    name: "2. ABSA",
    detail: "Aspect extraction will appear here.",
    progress: 10,
  },
  {
    name: "3. Trend Intelligence",
    detail: "Spike detection is idle.",
    progress: 10,
  },
  {
    name: "4. Multilingual Layer",
    detail: "Language handling is ready.",
    progress: 10,
  },
  {
    name: "5. Priority Scoring",
    detail: "Ranking will be calculated after upload.",
    progress: 10,
  },
  {
    name: "6. Recommendations",
    detail: "Root-cause guidance is waiting.",
    progress: 10,
  },
  {
    name: "7. Dashboard",
    detail: "Summary cards will populate after analysis.",
    progress: 10,
  },
];

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeParseWorkspace(raw) {
  if (!raw) return { ...DEFAULT_WORKSPACE };
  try {
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_WORKSPACE,
      ...parsed,
      weights: { ...DEFAULT_WEIGHTS, ...(parsed.weights || {}) },
    };
  } catch {
    return { ...DEFAULT_WORKSPACE };
  }
}

function loadWorkspace() {
  if (typeof window === "undefined") return { ...DEFAULT_WORKSPACE };
  return safeParseWorkspace(window.localStorage.getItem(STORAGE_KEY));
}

function sanitizeWorkspace(workspace) {
  const maxChars = 250000;
  return {
    ...workspace,
    primaryCsvText: (workspace.primaryCsvText || "").slice(0, maxChars),
    competitorCsvText: (workspace.competitorCsvText || "").slice(0, maxChars),
    urlManualText: (workspace.urlManualText || "").slice(0, maxChars),
  };
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value)))
    return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

function formatSignedPercent(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value)))
    return "—";
  const rounded = Number(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(rounded), digits)}%`;
}

function formatDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatShortDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function capitalize(value) {
  if (!value) return "";
  return `${value}`.charAt(0).toUpperCase() + `${value}`.slice(1);
}

function toneForPriority(priority) {
  if (priority === "HIGH") return "bad";
  if (priority === "MEDIUM") return "warn";
  return "good";
}

function toneForSeverity(severity) {
  if (severity === "critical" || severity === "high") return "bad";
  if (severity === "medium") return "warn";
  return "good";
}

function sentimentTone(score) {
  if (score >= 0.25) return "positive";
  if (score <= -0.25) return "negative";
  return "neutral";
}

function sentimentColor(score) {
  if (score >= 0.6) return "#33d17a";
  if (score >= 0.25) return "#55d6be";
  if (score > -0.25) return "#8ca0be";
  if (score > -0.6) return "#ffb020";
  return "#ff6b5e";
}

function softenColor(color, alpha = 0.16) {
  if (!color) return `rgba(85, 214, 190, ${alpha})`;
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const expanded =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => `${c}${c}`)
            .join("")
        : hex;
    const num = parseInt(expanded, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

function shorten(text, max = 96) {
  if (!text) return "";
  const value = String(text).trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function approximateRows(text) {
  if (!text) return 0;
  const lines = text.split(/\r?\n/).filter(Boolean);
  return Math.max(lines.length - 1, lines.length);
}

function csvPreview(text, lines = 8) {
  if (!text) return "";
  return text.split(/\r?\n/).slice(0, lines).join("\n");
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildPoints(values, width, height, padding, maxValue) {
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const normalizedMax = Math.max(maxValue, 1);
  return values
    .map((value, index) => {
      const x =
        padding +
        (values.length <= 1
          ? usableWidth / 2
          : (index * usableWidth) / (values.length - 1));
      const y = height - padding - (value / normalizedMax) * usableHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function normalizeView(value) {
  const candidate = String(value || "")
    .trim()
    .toLowerCase();
  if (NAV_ITEMS.some((item) => item.id === candidate)) {
    return candidate;
  }
  return "home";
}

function getViewFromHash() {
  if (typeof window === "undefined") return "home";
  const raw = window.location.hash.replace(/^#/, "");
  return normalizeView(raw);
}

function setHashView(view) {
  if (typeof window === "undefined") return;
  const hash = `#${normalizeView(view)}`;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

function MetricCard({ label, value, tone = "neutral" }) {
  return (
    <div className="panel metric-card">
      <div className="metric-label">{label}</div>
      <div
        className="metric-value"
        style={{ color: tone === "accent" ? "var(--accent)" : undefined }}
      >
        {value}
      </div>
    </div>
  );
}

function Badge({ tone = "neutral", children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Panel({ title, subtitle, actions, children, className = "" }) {
  return (
    <section className={`panel ${className}`.trim()}>
      <div className="panel-head">
        <div className="substack">
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function StepCard({ index, title, text }) {
  return (
    <article className="step-card">
      <div className="step-index">{index}</div>
      <div className="step-copy">
        <div className="step-title">{title}</div>
        <div className="step-text">{text}</div>
      </div>
    </article>
  );
}

function AnalysisSnapshot({
  issue,
  analysisEngine,
  reviewCount,
  fallbackUsed,
  sourceIcon,
}) {
  const hasIssue = Boolean(issue);
  const priority = issue?.priority || "READY";
  const impactValue = hasIssue ? formatNumber(issue.impact_score, 0) : "—";
  const headline = hasIssue
    ? issue.feature_label || issue.feature_key
    : "Awaiting analysis...";
  const summary =
    issue?.executive_summary ||
    issue?.recommendation ||
    issue?.root_cause?.summary ||
    "Upload or paste reviews to generate AI-powered product insights and roadmap recommendations.";
  const rootCause = issue?.root_cause?.summary || "N/A";
  const action = issue?.action_timeline || "N/A";
  const risk =
    issue?.business_risk?.churn_risk_pct !== undefined &&
    issue?.business_risk?.churn_risk_pct !== null
      ? `${formatNumber(issue.business_risk.churn_risk_pct, 1)}% churn risk`
      : "N/A";
  const modelName =
    analysisEngine?.provider === "openrouter"
      ? analysisEngine.model_used ||
        analysisEngine.requested_model ||
        "OpenRouter"
      : analysisEngine?.provider === "heuristic"
        ? "Local Engine"
        : "Disconnected";

  return (
    <div
      className="panel analysis-snapshot"
      style={{
        borderLeft: `4px solid ${hasIssue ? sentimentColor(issue.avg_sentiment) : "var(--border)"}`,
      }}
    >
      <div className="analysis-top">
        {sourceIcon && (
          <img
            src={sourceIcon}
            alt="Source"
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "8px",
              marginRight: "16px",
            }}
          />
        )}
        <div className="substack">
          <Badge tone="accent">AI Verdict</Badge>
          <h2 style={{ marginTop: "8px" }}>{headline}</h2>
          <p style={{ fontSize: "1.1rem", marginTop: "4px" }}>{summary}</p>
        </div>
        <div className="analysis-score">
          <div className="priority-score">{impactValue}</div>
          <div className="mini-note">Impact Score</div>
        </div>
        <div style={{ marginLeft: 12 }}>
          <Sparkline
            values={(issue?.trend_points || issue?.trend || []).slice(-20)}
            width={140}
            height={48}
          />
        </div>
      </div>

      <div className="analysis-points">
        <div className="analysis-point">
          <strong>Next Step</strong>
          <span>{action}</span>
        </div>
        <div className="analysis-point">
          <strong>Root Cause</strong>
          <span>{rootCause}</span>
        </div>
        <div className="analysis-point">
          <strong>Risk Level</strong>
          <span>{risk}</span>
        </div>
        <div className="analysis-point">
          <strong>AI Engine</strong>
          <span>{modelName}</span>
        </div>
      </div>
    </div>
  );
}

function Logo({ size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path
        d="M10 10H22M10 16H18M10 22H22"
        stroke="var(--bg)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle
        cx="24"
        cy="24"
        r="4"
        fill="var(--accent-2)"
        stroke="var(--bg)"
        strokeWidth="2"
      />
    </svg>
  );
}

function NavBar({ activeView, onNavigate }) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar-brand"
        onClick={() => onNavigate("home")}
      >
        <Logo size={32} />
        <div className="topbar-copy">
          <strong>ReviewIQ</strong>
          <small>AI Intelligence</small>
        </div>
      </button>

      <nav className="topbar-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`topbar-link ${activeView === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
            aria-current={activeView === item.id ? "page" : undefined}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

function HomePage({ onNavigate }) {
  return (
    <main
      className="page home-page"
      style={{ maxWidth: "900px", margin: "80px auto", textAlign: "center" }}
    >
      <section
        className="substack"
        style={{ alignItems: "center", gap: "24px" }}
      >
        <Logo size={64} />
        <h1 style={{ fontSize: "3.5rem", letterSpacing: "-0.04em" }}>
          Turn messy reviews into clear decisions.
        </h1>
        <p style={{ fontSize: "1.25rem", maxWidth: "600px", margin: "0 auto" }}>
          ReviewIQ uses AI to cluster customer feedback into actionable roadmap
          items. Stop guessing and start fixing what matters most.
        </p>

        <div
          className="button-row"
          style={{ marginTop: "16px", justifyContent: "center" }}
        >
          <button
            type="button"
            className="button button-primary"
            style={{ padding: "14px 32px", fontSize: "1.1rem" }}
            onClick={() => onNavigate("csv")}
          >
            Analyze CSV Data
          </button>
          <button
            type="button"
            className="button"
            style={{ padding: "14px 32px", fontSize: "1.1rem" }}
            onClick={() => onNavigate("url")}
          >
            Analyze Public URL
          </button>
        </div>
      </section>

      <section
        className="grid-3"
        style={{ marginTop: "80px", textAlign: "left" }}
      >
        <div className="panel metric-card">
          <Badge tone="accent">Simple</Badge>
          <h4 style={{ marginTop: "12px" }}>Upload & Go</h4>
          <p style={{ fontSize: "0.9rem", marginTop: "4px" }}>
            No complex setup. Just paste your reviews and get results in
            seconds.
          </p>
        </div>
        <div className="panel metric-card">
          <Badge tone="accent">Smart</Badge>
          <h4 style={{ marginTop: "12px" }}>AI-Powered</h4>
          <p style={{ fontSize: "0.9rem", marginTop: "4px" }}>
            Advanced NLP detects sentiment, features, and root causes
            automatically.
          </p>
        </div>
        <div className="panel metric-card">
          <Badge tone="accent">Actionable</Badge>
          <h4 style={{ marginTop: "12px" }}>Clear Next Steps</h4>
          <p style={{ fontSize: "0.9rem", marginTop: "4px" }}>
            Don't just see data—see exactly what to fix and why it matters.
          </p>
        </div>
      </section>
    </main>
  );
}

function UrlReviewPage({
  workspace,
  analysisEngine,
  error,
  processing,
  onUrlChange,
  onTextChange,
  onAnalyze,
  onOpenUrl,
  onBackToCsv,
  onSelectIssue,
  onNavigateHome,
}) {
  const analysis = workspace.urlAnalysis;
  const issues = analysis?.issues || [];
  const selectedIssue =
    issues.find((issue) => issue.id === workspace.urlSelectedIssueId) ||
    issues[0] ||
    null;
  const metrics = analysis?.summary || {};
  const previews = analysis?.review_previews || [];
  const heroCount = metrics.review_count || analysis?.processed_reviews || 0;

  return (
    <main
      className="page url-page"
      style={{ maxWidth: "1200px", margin: "0 auto" }}
    >
      <section className="panel" style={{ marginBottom: "24px" }}>
        <div className="substack">
          <Badge tone="accent">URL Analysis</Badge>
          <h2>Analyze Public Reviews</h2>
          <p>Extract insights from any public URL or pasted review text.</p>
        </div>

        <div className="control-group" style={{ marginTop: "24px" }}>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="review-url">Review URL</label>
              <input
                id="review-url"
                className="input"
                value={workspace.reviewUrl}
                onChange={(event) => onUrlChange(event.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="field">
              <label htmlFor="review-url-text">Page Text (Optional)</label>
              <textarea
                id="review-url-text"
                className="textarea"
                style={{ minHeight: "44px" }}
                value={workspace.urlManualText}
                onChange={(event) => onTextChange(event.target.value)}
                placeholder="Paste review text here if fetching is blocked..."
              />
            </div>
          </div>

          <div className="button-row">
            <button
              type="button"
              className="button button-primary"
              onClick={onAnalyze}
              disabled={processing}
            >
              {processing ? "Analyzing..." : "Analyze URL"}
            </button>
            <button
              type="button"
              className="button"
              onClick={onOpenUrl}
              disabled={!workspace.reviewUrl.trim()}
            >
              Open URL
            </button>
            <button type="button" className="button" onClick={onBackToCsv}>
              CSV Analyzer
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div
          className="badge bad"
          style={{
            padding: "12px",
            borderRadius: "var(--radius-sm)",
            width: "100%",
            marginBottom: "24px",
            justifyContent: "center",
          }}
        >
          {error}
        </div>
      )}

      {(analysis || processing) && (
        <div style={{ display: "grid", gap: "24px" }}>
          <AnalysisSnapshot
            issue={selectedIssue}
            analysisEngine={analysisEngine}
            reviewCount={heroCount}
            fallbackUsed={Boolean(analysisEngine.fallback_used)}
            sourceIcon={analysis?.source?.favicon}
          />

          <div className="grid-2">
            <Panel title="Top Issues">
              <IssueList
                issues={issues}
                selectedId={workspace.urlSelectedIssueId}
                onSelect={onSelectIssue}
              />
            </Panel>

            <Panel title="Issue Deep Dive">
              {selectedIssue ? (
                <div className="detail-card">
                  <div className="detail-top">
                    <div style={{ flex: 1 }}>
                      <h3 style={{ marginBottom: 6 }}>
                        {selectedIssue.feature_label ||
                          selectedIssue.feature_key}
                      </h3>
                      <p style={{ marginBottom: 8, color: "var(--muted)" }}>
                        {selectedIssue.executive_summary ||
                          selectedIssue.recommendation}
                      </p>

                      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                        <div
                          style={{
                            background: "rgba(13,148,136,0.06)",
                            padding: 12,
                            borderRadius: 8,
                          }}
                        >
                          <strong>Root Cause</strong>
                          <div style={{ marginTop: 8 }}>
                            {selectedIssue.root_cause?.summary ||
                              "Analyzing..."}
                          </div>
                        </div>
                        <div
                          style={{
                            background: "rgba(13,148,136,0.04)",
                            padding: 12,
                            borderRadius: 8,
                          }}
                        >
                          <strong>Improvement / Next Step</strong>
                          <div style={{ marginTop: 8 }}>
                            {selectedIssue.action_timeline || "Pending"}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: "right", marginLeft: 12 }}>
                      <div
                        className="priority-score"
                        style={{ fontSize: "2rem" }}
                      >
                        {formatNumber(selectedIssue.impact_score, 0)}
                      </div>
                      <Badge tone={toneForPriority(selectedIssue.priority)}>
                        {selectedIssue.priority}
                      </Badge>
                    </div>
                  </div>
                  <div className="detail-grid" style={{ marginTop: "16px" }}>
                    <DetailBlock heading="Business Risk">
                      {selectedIssue.business_risk?.churn_risk_pct
                        ? `${formatNumber(selectedIssue.business_risk.churn_risk_pct, 1)}% risk`
                        : "N/A"}
                    </DetailBlock>
                    <DetailBlock heading="Evidence">
                      {selectedIssue.evidence?.length || 0} samples
                    </DetailBlock>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  Select an issue to see deep-dive details.
                </div>
              )}
            </Panel>
          </div>

          {previews.length > 0 && (
            <Panel title="Evidence Samples">
              <ReviewFeed items={previews} />
            </Panel>
          )}
        </div>
      )}
    </main>
  );
}

function PlayStorePage({
  workspace,
  analysisEngine,
  error,
  processing,
  onSearch,
  onSelectApp,
  onAnalyzeSelected,
  onSelectIssue,
}) {
  const analysis = workspace.playAnalysis;
  const issues = analysis?.issues || [];
  const selectedIssue =
    issues.find((i) => i.id === workspace.playSelectedIssueId) ||
    issues[0] ||
    null;
  const previews = analysis?.review_previews || [];
  const heroCount = analysis?.summary?.review_count || 0;

  return (
    <main
      className="page play-page"
      style={{ maxWidth: "1200px", margin: "0 auto" }}
    >
      <section className="panel" style={{ marginBottom: "24px" }}>
        <div className="substack">
          <Badge tone="accent">Play Store Analysis</Badge>
          <h2>Analyze Google Play Store Reviews</h2>
          <p>Search for an app and analyze its user feedback instantly.</p>
        </div>

        <div className="control-group" style={{ marginTop: "24px" }}>
          <div className="field">
            <label htmlFor="play-search">App Name</label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                id="play-search"
                className="input"
                style={{ flex: 1 }}
                value={workspace.playQuery}
                onChange={(e) => onSearch(e.target.value, false)}
                onKeyDown={(e) =>
                  e.key === "Enter" && onSearch(workspace.playQuery, true)
                }
                placeholder="e.g. WhatsApp, Spotify..."
              />
              <button
                type="button"
                className="button button-primary"
                onClick={() => onSearch(workspace.playQuery, true)}
                disabled={processing}
              >
                Search
              </button>
            </div>
          </div>

          {workspace.playSearchResults.length > 0 && (
            <div
              className="search-results panel-soft"
              style={{
                marginTop: "16px",
                maxHeight: "300px",
                overflowY: "auto",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
              }}
            >
              {workspace.playSearchResults.map((app, idx) => (
                <button
                  key={app.appId || app.id || `${app.title}-${idx}`}
                  className="search-result-item"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    width: "100%",
                    padding: "12px",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    console.debug("PlayStorePage: selected app ->", app);
                    onSelectApp(app);
                  }}
                >
                  <img
                    src={app.icon}
                    alt=""
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "8px",
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: "600", color: "var(--text)" }}>
                      {app.title}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                      {app.developer}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {workspace.selectedApp && !analysis && !processing && (
        <section
          className="panel"
          style={{ textAlign: "center", padding: "48px" }}
        >
          <img
            src={workspace.selectedApp.icon}
            style={{
              width: "64px",
              borderRadius: "12px",
              marginBottom: "16px",
            }}
            alt=""
          />
          <h3>Analyze {workspace.selectedApp.title}?</h3>
          <p style={{ marginBottom: "24px" }}>
            Ready to fetch and analyze reviews for this app.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              className="button button-primary"
              onClick={() => onAnalyzeSelected && onAnalyzeSelected()}
            >
              Start Analysis
            </button>
            <button
              className="button"
              onClick={() =>
                setWorkspace((prev) => ({ ...prev, selectedApp: null }))
              }
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {workspace.selectedApp &&
        analysis &&
        analysis.summary &&
        Number(analysis.summary.review_count) === 0 && (
          <div className="panel" style={{ marginTop: 12 }}>
            <div style={{ textAlign: "center" }}>
              <strong>No reviews found</strong>
              <div style={{ color: "var(--muted)", marginTop: 8 }}>
                This app appears to have no public Play Store reviews or the
                scraper couldn't fetch them.
              </div>
            </div>
          </div>
        )}

      {error && (
        <div
          className="badge bad"
          style={{
            padding: "12px",
            borderRadius: "var(--radius-sm)",
            width: "100%",
            marginBottom: "24px",
            justifyContent: "center",
          }}
        >
          {error}
        </div>
      )}

      {(analysis || processing) && (
        <div style={{ display: "grid", gap: "24px" }}>
          <AnalysisSnapshot
            issue={selectedIssue}
            analysisEngine={analysisEngine}
            reviewCount={heroCount}
            fallbackUsed={Boolean(analysisEngine.fallback_used)}
            sourceIcon={analysis?.source?.favicon}
          />

          <div className="grid-2">
            <Panel title="Top Issues">
              <IssueList
                issues={issues}
                selectedId={workspace.playSelectedIssueId}
                onSelect={onSelectIssue}
              />
            </Panel>

            <Panel title="Issue Deep Dive">
              {selectedIssue ? (
                <div className="detail-card">
                  <div className="detail-top">
                    <div className="detail-title">
                      <h3>
                        {selectedIssue.feature_label ||
                          selectedIssue.feature_key}
                      </h3>
                      <p>
                        {selectedIssue.executive_summary ||
                          selectedIssue.recommendation}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div
                        className="priority-score"
                        style={{ fontSize: "2rem" }}
                      >
                        {formatNumber(selectedIssue.impact_score, 0)}
                      </div>
                      <Badge tone={toneForPriority(selectedIssue.priority)}>
                        {selectedIssue.priority}
                      </Badge>
                    </div>
                  </div>
                  <div className="detail-grid" style={{ marginTop: "16px" }}>
                    <DetailBlock heading="Root Cause">
                      {selectedIssue.root_cause?.summary || "Analyzing..."}
                    </DetailBlock>
                    <DetailBlock heading="Next Step">
                      {selectedIssue.action_timeline || "Pending"}
                    </DetailBlock>
                    <DetailBlock heading="Business Risk">
                      {selectedIssue.business_risk?.churn_risk_pct
                        ? `${formatNumber(selectedIssue.business_risk.churn_risk_pct, 1)}% risk`
                        : "N/A"}
                    </DetailBlock>
                    <DetailBlock heading="Evidence">
                      {selectedIssue.evidence?.length || 0} samples
                    </DetailBlock>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  Select an issue to see deep-dive details.
                </div>
              )}
            </Panel>
          </div>

          {previews.length > 0 && (
            <Panel title="Evidence Samples">
              <ReviewFeed items={previews} />
            </Panel>
          )}
        </div>
      )}
    </main>
  );
}

function ComparePage({ workspace }) {
  const analyses = [
    workspace.analysis,
    workspace.urlAnalysis,
    workspace.playAnalysis,
  ];
  const combined = combineAnalyses(analyses.filter(Boolean));

  return (
    <main
      className="page compare-page"
      style={{ maxWidth: "1200px", margin: "0 auto" }}
    >
      <section className="panel">
        <div className="substack">
          <Badge tone="accent">Compare / Aggregate</Badge>
          <h2>Combined analysis across sources</h2>
          <p>
            Compare CSV, URL and Play Store analyses side-by-side and view an
            aggregated dashboard.
          </p>
        </div>
      </section>

      <div className="grid-2" style={{ marginTop: 24 }}>
        <Panel title="Source Summary">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {combined.sources.map((s, i) => (
              <div key={i} style={{ flex: 1 }}>
                <div style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                  {s.source}
                </div>
                <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>
                  {formatNumber(s.count, 0)}
                </div>
              </div>
            ))}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                Combined
              </div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>
                {formatNumber(combined.total_reviews, 0)}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Sentiment & Issues">
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                Average Sentiment
              </div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>
                {(combined.avg_sentiment || 0).toFixed(2)}
              </div>
            </div>
            <div style={{ width: 220 }}>
              <Sparkline
                values={combined.issues
                  .slice(0, 8)
                  .map((i) => i.impact_score || 0)}
                width={220}
                height={48}
              />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: "6px 0" }}>Top Merged Issues</h4>
            <div className="issue-list">
              {combined.issues.slice(0, 6).map((issue) => (
                <div
                  key={issue.feature_key || issue.id || issue.feature_label}
                  className="issue-card"
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong>
                        {issue.feature_label || issue.feature_key || issue.id}
                      </strong>
                      <div className="issue-sub">
                        {shorten(
                          issue.executive_summary ||
                            issue.recommendation ||
                            issue.root_cause?.summary ||
                            "",
                          120,
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="priority-score">
                        {formatNumber(issue.impact_score, 0)}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <Sparkline
                          values={(issue.trend_points || []).slice(-8)}
                          width={80}
                          height={28}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </main>
  );
}

function PipelineRail({ stages }) {
  return (
    <div className="pipeline">
      {stages.map((stage, index) => {
        const progress = Number(
          stage.progress ?? (index < stages.length ? 100 : 0),
        );
        return (
          <div className="pipeline-step" key={`${stage.name}-${index}`}>
            <div className="topline">
              <span className="name">{stage.name}</span>
              <Badge tone={progress >= 100 ? "accent" : "neutral"}>
                {progress >= 100 ? "Done" : `${progress}%`}
              </Badge>
              <div className="issue-sub">
                {shorten(
                  issue.executive_summary ||
                    issue.root_cause?.summary ||
                    issue.recommendation,
                  120,
                )}
              </div>
              <div style={{ flex: 1 }} />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  marginLeft: "12px",
                }}
              >
                <div className="priority-score" style={{ fontSize: "1.2rem" }}>
                  {formatNumber(issue.impact_score, 0)}
                </div>
                <div style={{ marginTop: 6 }}>
                  <Sparkline
                    values={(issue.trend_points || issue.trend || []).slice(-8)}
                    width={96}
                    height={28}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IssueList({ issues, selectedId, onSelect }) {
  if (!issues.length) {
    return (
      <div
        className="empty-state"
        style={{ padding: "40px", textAlign: "center" }}
      >
        No issues identified yet. Analyze reviews to see ranked insights.
      </div>
    );
  }

  return (
    <div className="issue-list">
      {issues.map((issue) => {
        const isSelected = issue.id === selectedId;
        return (
          <button
            key={issue.id}
            type="button"
            className={`issue-card ${isSelected ? "selected" : ""}`}
            onClick={() => onSelect(issue.id)}
            style={{
              borderLeft: isSelected
                ? `4px solid ${sentimentColor(issue.avg_sentiment)}`
                : undefined,
            }}
          >
            <div className="toprow">
              <div style={{ flex: 1 }}>
                <h4
                  style={{
                    color: isSelected ? "var(--accent)" : "var(--text)",
                  }}
                >
                  {issue.feature_label || issue.feature || issue.id}
                </h4>
                <div className="issue-sub">
                  {shorten(
                    issue.executive_summary ||
                      issue.root_cause?.summary ||
                      issue.recommendation,
                    120,
                  )}
                </div>
              </div>
              <div
                className="priority-score"
                style={{ fontSize: "1.2rem", marginLeft: "12px" }}
              >
                {formatNumber(issue.impact_score, 0)}
              </div>
            </div>
            {isSelected && (
              <div className="chip-row">
                <Badge tone={toneForPriority(issue.priority)}>
                  {issue.priority}
                </Badge>
                <Badge tone="neutral">
                  {formatSignedPercent(issue.trend_growth_pct, 0)} Trend
                </Badge>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function DetailBlock({ heading, children }) {
  return (
    <div className="detail-block">
      <div className="heading">{heading}</div>
      <div className="body">{children}</div>
    </div>
  );
}

function TrendChart({ timeline }) {
  const weeks = timeline?.weeks || [];
  const series = timeline?.series || [];
  const totals = timeline?.totals || [];
  const width = 1000;
  const height = 320;
  const padding = 30;
  const maxValue = Math.max(
    1,
    ...totals,
    ...series.flatMap((item) => item.values || []),
  );
  const gridColor = "rgba(15, 23, 42, 0.08)";
  const axisColor = "rgba(15, 23, 42, 0.05)";
  const textColor = "rgba(71, 85, 105, 0.78)";
  const totalStroke = "rgba(15, 23, 42, 0.24)";

  const gridYs = [0.25, 0.5, 0.75];

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart"
        role="img"
        aria-label="Trend timeline"
      >
        {gridYs.map((ratio) => {
          const y = padding + (height - padding * 2) * ratio;
          return (
            <line
              key={ratio}
              x1={padding}
              x2={width - padding}
              y1={y}
              y2={y}
              stroke={gridColor}
              strokeDasharray="5 5"
            />
          );
        })}

        {weeks.map((week, index) => {
          const x =
            padding +
            (weeks.length <= 1
              ? (width - padding * 2) / 2
              : (index * (width - padding * 2)) / (weeks.length - 1));
          const label = week.slice(5);
          return (
            <g key={week}>
              <line
                x1={x}
                x2={x}
                y1={padding}
                y2={height - padding}
                stroke={axisColor}
              />
              {index % 2 === 0 ? (
                <text
                  x={x}
                  y={height - 10}
                  textAnchor="middle"
                  fill={textColor}
                  fontSize="12"
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}

        <polyline
          fill="none"
          stroke={totalStroke}
          strokeWidth="2"
          points={buildPoints(totals, width, height, padding, maxValue)}
        />

        {series.map((item) => (
          <polyline
            key={item.feature_key}
            fill="none"
            stroke={item.color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={buildPoints(
              item.values || [],
              width,
              height,
              padding,
              maxValue,
            )}
          />
        ))}

        {series.map((item) => {
          const points = item.values || [];
          return points.map((value, index) => {
            const x =
              padding +
              (points.length <= 1
                ? (width - padding * 2) / 2
                : (index * (width - padding * 2)) / (points.length - 1));
            const y =
              height - padding - (value / maxValue) * (height - padding * 2);
            return (
              <circle
                key={`${item.feature_key}-${index}`}
                cx={x}
                cy={y}
                r="3.5"
                fill={item.color}
              />
            );
          });
        })}

        <text x={18} y={padding + 6} fill={textColor} fontSize="12">
          Complaints
        </text>
        <text x={18} y={height - padding - 4} fill={textColor} fontSize="12">
          0
        </text>
        <text x={18} y={padding + 18} fill={textColor} fontSize="12">
          {formatNumber(maxValue, 0)}
        </text>
      </svg>

      <div className="chart-legend">
        {series.map((item) => (
          <div className="legend-item" key={item.feature_key}>
            <span
              className="legend-swatch"
              style={{ background: item.color }}
            />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmotionMap({ items }) {
  if (!items?.length) {
    return (
      <div className="empty-state">
        Emotion map will appear after you upload data. It ranks features by
        complaint intensity and sentiment balance.
      </div>
    );
  }

  return (
    <div className="emotion-grid">
      {items.map((item) => {
        const color = sentimentColor(item.sentiment_score);
        return (
          <article className="emotion-card" key={item.feature_key}>
            <div className="head">
              <span className="name">{item.label}</span>
              <Badge tone={toneForPriority(item.priority)}>
                {item.priority}
              </Badge>
            </div>
            <div className="meter">
              <div
                className="fill"
                style={{
                  width: `${clamp(item.negative_share * 100, 4, 100)}%`,
                  background: color,
                }}
              />
            </div>
            <div className="sub">
              {formatNumber(item.count, 0)} mentions
              {" · "}
              {formatNumber(item.positive_share * 100, 0)}% positive
              {" · "}
              {formatNumber(item.negative_share * 100, 0)}% negative
            </div>
          </article>
        );
      })}
    </div>
  );
}

function GapPanel({ items }) {
  if (!items?.length) {
    return (
      <div className="empty-state">
        Upload a competitor CSV too, and ReviewIQ will calculate where your
        product is lagging or winning feature by feature.
      </div>
    );
  }

  return (
    <div className="gap-list">
      {items.map((item) => {
        const ours = clamp((item.our_sentiment + 1) / 2, 0, 1);
        const theirs = clamp((item.competitor_sentiment + 1) / 2, 0, 1);
        return (
          <article className="gap-card" key={item.feature_key}>
            <div className="gap-top">
              <div className="gap-title">{item.feature_label}</div>
              <Badge
                tone={
                  item.status === "lagging"
                    ? "bad"
                    : item.status === "ahead"
                      ? "good"
                      : "neutral"
                }
              >
                {item.status}
              </Badge>
            </div>
            <div className="gap-bar">
              <div className="gap-line">
                <div
                  className="competitor"
                  style={{ width: `${theirs * 100}%` }}
                />
                <div
                  className="ours"
                  style={{ width: `${ours * 100}%`, opacity: 0.92 }}
                />
              </div>
              <div className="gap-meta">
                <span>Your sentiment: {item.our_sentiment.toFixed(2)}</span>
                <span>Competitor: {item.competitor_sentiment.toFixed(2)}</span>
              </div>
              <div className="mini-note">{item.recommendation}</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ReviewFeed({ items }) {
  if (!items?.length) {
    return (
      <div className="empty-state">
        The review explorer will show traceable evidence snippets after the
        first analysis run.
      </div>
    );
  }

  return (
    <div className="feed">
      {items.map((item) => {
        const tone = sentimentTone(item.sentiment_score);
        return (
          <article className="feed-card" key={item.id}>
            <div className="meta-row">
              <Badge
                tone={
                  tone === "positive"
                    ? "good"
                    : tone === "negative"
                      ? "bad"
                      : "neutral"
                }
              >
                {item.language}
              </Badge>
              <Badge tone="neutral">{item.platform}</Badge>
              <Badge tone="neutral">{formatShortDate(item.date)}</Badge>
              {item.rating !== null && item.rating !== undefined ? (
                <Badge tone="accent">{formatNumber(item.rating, 0)}★</Badge>
              ) : null}
            </div>
            {item.translated_text && item.translated_text !== item.text ? (
              <div
                style={{
                  marginBottom: 8,
                  background: "rgba(0,0,0,0.02)",
                  padding: 10,
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                  Translation
                </div>
                <div style={{ marginTop: 6 }}>{item.translated_text}</div>
              </div>
            ) : null}
            <div className="review-text">{item.text}</div>
            <div style={{ marginTop: 8 }}>
              <Badge tone="neutral">{item.language || "Unknown"}</Badge>
              {item.analysis?.confidence ? (
                <span style={{ marginLeft: 8, color: "var(--muted)" }}>
                  Confidence: {Number(item.analysis.confidence).toFixed(2)}
                </span>
              ) : null}
            </div>
            {item.aspects?.length ? (
              <div className="chip-row">
                {item.aspects.map((aspect) => (
                  <span
                    key={`${item.id}-${aspect.feature_key}`}
                    className={`chip tone-${sentimentTone(aspect.sentiment)}`}
                  >
                    {aspect.feature_label}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function getDefaultSelectedIssue(issues) {
  return issues?.[0]?.id || "";
}

function combineAnalyses(analyses = []) {
  const result = {
    sources: [],
    total_reviews: 0,
    avg_sentiment: 0,
    issues: [],
  };

  const issueMap = new Map();
  let sentimentSum = 0;

  analyses.forEach((a) => {
    if (!a) return;
    const src = a.source || { mode: "unknown" };
    const count =
      (a.summary && a.summary.review_count) || a.processed_reviews || 0;
    result.sources.push({
      source: src.mode || src.product_name || "unknown",
      count,
    });
    result.total_reviews += count;
    if (a.summary && typeof a.summary.avg_sentiment === "number") {
      sentimentSum += (a.summary.avg_sentiment || 0) * count;
    } else if (Array.isArray(a.issues) && a.issues.length) {
      // fallback: average issue sentiments
      const avg =
        a.issues.reduce((s, it) => s + (it.avg_sentiment || 0), 0) /
        a.issues.length;
      sentimentSum += avg * count;
    }

    (a.issues || []).forEach((issue) => {
      const key =
        issue.feature_key ||
        issue.feature_label ||
        issue.id ||
        JSON.stringify(issue);
      if (!issueMap.has(key)) {
        issueMap.set(key, { ...issue, sources: [src.mode || "unknown"] });
      } else {
        const existing = issueMap.get(key);
        existing.impact_score =
          (existing.impact_score || 0) + (issue.impact_score || 0);
        existing.avg_sentiment =
          ((existing.avg_sentiment || 0) + (issue.avg_sentiment || 0)) / 2;
        existing.sources = Array.from(
          new Set([...(existing.sources || []), src.mode || "unknown"]),
        );
      }
    });
  });

  result.avg_sentiment = result.total_reviews
    ? sentimentSum / Math.max(1, result.total_reviews)
    : 0;
  result.issues = Array.from(issueMap.values()).sort(
    (a, b) => (b.impact_score || 0) - (a.impact_score || 0),
  );
  return result;
}

function LoadingOverlay({ visible }) {
  return visible ? (
    <div
      className="loading-overlay"
      aria-hidden
      style={{ pointerEvents: "none" }}
    >
      <div className="spinner" />
      <div className="loading-label">Analyzing…</div>
    </div>
  ) : null;
}

function Sparkline({
  values = [],
  width = 120,
  height = 36,
  color = "var(--accent)",
}) {
  if (!values || !values.length) return <svg width={width} height={height} />;
  const max = Math.max(...values.map((v) => Number(v) || 0), 1);
  const padding = 4;
  const points = buildPoints(values, width, height, padding, max);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function App() {
  const [workspace, setWorkspace] = useState(() => loadWorkspace());
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [activeView, setActiveView] = useState(() => getViewFromHash());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMoreInsights, setShowMoreInsights] = useState(false);
  const [isPending, startTransition] = useTransition();
  const primaryInputRef = useRef(null);
  const competitorInputRef = useRef(null);
  const startedAtRef = useRef(0);

  const analysis = workspace.analysis;
  const urlAnalysis = workspace.urlAnalysis;
  const playAnalysis = workspace.playAnalysis;
  const issues = analysis?.issues || [];
  const deferredSearch = useDeferredValue(
    (workspace.search || "").trim().toLowerCase(),
  );
  const filteredIssues = issues.filter((issue) => {
    if (!deferredSearch) return true;
    const haystack = [
      issue.feature_label,
      issue.feature_key,
      issue.recommendation,
      issue.root_cause?.summary,
      issue.action_timeline,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(deferredSearch);
  });
  const selectedIssue =
    filteredIssues.find((issue) => issue.id === workspace.selectedIssueId) ||
    filteredIssues[0] ||
    issues.find((issue) => issue.id === workspace.selectedIssueId) ||
    issues[0] ||
    null;
  const metrics = analysis?.summary || {};
  const pipeline = processing
    ? DEFAULT_PIPELINE.map((stage, index) => ({
        ...stage,
        progress: Math.max(
          stage.progress,
          index <= stageIndex ? 100 : Math.max(12, stage.progress - 8),
        ),
      }))
    : analysis?.pipeline || DEFAULT_PIPELINE;
  const alerts = analysis?.alerts || [];
  const emotions = analysis?.emotion_map || [];
  const timeline = analysis?.timeline || { weeks: [], series: [], totals: [] };
  const gapData = analysis?.competitive_gap || [];
  const previews = analysis?.review_previews || [];
  const languageBreakdown = metrics.language_breakdown || [];
  const platformBreakdown = metrics.platform_breakdown || [];
  const lastRun = workspace.lastRun || analysis?.generated_at || "";
  const analysisEngine = analysis?.analysis_engine || {};
  const urlAnalysisEngine = urlAnalysis?.analysis_engine || {};
  const playAnalysisEngine = playAnalysis?.analysis_engine || {};
  const currentIssue = selectedIssue || metrics.top_issue || null;
  const engineLabel =
    analysisEngine.provider === "openrouter"
      ? "OpenRouter free"
      : analysisEngine.provider
        ? "Local fallback"
        : "—";
  const engineDetail =
    analysisEngine.provider === "openrouter"
      ? `Model: ${analysisEngine.model_used || analysisEngine.requested_model || "auto-selected free model"}`
      : "Set OPENROUTER_API_KEY in .env to enable LLM analysis.";

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    if (!window.location.hash) {
      setHashView("home");
      setActiveView("home");
    }

    const handleHashChange = () => {
      setActiveView(getViewFromHash());
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function navigate(view) {
    const nextView = normalizeView(view);
    setActiveView(nextView);
    setHashView(nextView);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
    // Clear view-specific workspace state to avoid showing unrelated analysis
    setWorkspace((prev) => {
      const next = { ...prev };
      if (nextView !== "play") {
        next.selectedApp = null;
        next.playAnalysis = null;
        next.playSearchResults = [];
        next.playSelectedIssueId = "";
      }
      if (nextView !== "url") {
        next.urlAnalysis = null;
        next.urlManualText = "";
        next.urlSelectedIssueId = "";
        next.reviewUrl = "";
      }
      return next;
    });
  }

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(sanitizeWorkspace(workspace)),
        );
      } catch (err) {
        console.warn("Unable to persist workspace in localStorage:", err);
      }
    }, 150);
    return () => window.clearTimeout(saveTimer);
  }, [workspace]);

  useEffect(() => {
    if (!processing) {
      setStageIndex(0);
      return undefined;
    }
    const stagesCount = Math.max(
      DEFAULT_PIPELINE.length,
      analysis?.pipeline?.length || 0,
    );
    const interval = window.setInterval(() => {
      setStageIndex((current) => Math.min(current + 1, stagesCount - 1));
    }, 350);
    return () => window.clearInterval(interval);
  }, [processing, analysis?.pipeline?.length]);

  useEffect(() => {
    if (
      selectedIssue &&
      selectedIssue.id !== workspace.selectedIssueId &&
      !processing
    ) {
      setWorkspace((prev) => ({ ...prev, selectedIssueId: selectedIssue.id }));
    }
  }, [selectedIssue?.id, workspace.selectedIssueId, processing]);

  useEffect(() => {
    if (analysis?.issues?.length && !workspace.selectedIssueId) {
      setWorkspace((prev) => ({
        ...prev,
        selectedIssueId: getDefaultSelectedIssue(analysis.issues),
      }));
    }
  }, [analysis, workspace.selectedIssueId]);

  async function handleFileLoad(target, file) {
    if (!file) return;
    const text = await file.text();
    setWorkspace((prev) => ({
      ...prev,
      ...(target === "primary"
        ? { primaryCsvText: text, sourceName: file.name }
        : { competitorCsvText: text, competitorSourceName: file.name }),
    }));
  }

  async function runAnalysis(overrides = {}) {
    const payload = {
      csv_text: overrides.primaryCsvText ?? workspace.primaryCsvText,
      competitor_csv_text:
        overrides.competitorCsvText ?? workspace.competitorCsvText,
      product_name: overrides.productName ?? workspace.productName,
      settings: {
        ...(overrides.weights ?? workspace.weights),
        focus_feature: overrides.focusFeature ?? workspace.focusFeature,
      },
    };

    if (!payload.csv_text || !payload.csv_text.trim()) {
      setError("Add review text first, or load the demo dataset.");
      return;
    }

    setError("");
    setProcessing(true);
    startedAtRef.current = performance.now();

    try {
      const response = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || data?.message || "Analysis failed");
      }

      const elapsed = performance.now() - startedAtRef.current;
      if (elapsed < MIN_PROCESSING_MS) {
        await sleep(MIN_PROCESSING_MS - elapsed);
      }

      startTransition(() => {
        setWorkspace((prev) => ({
          ...prev,
          primaryCsvText: payload.csv_text,
          competitorCsvText: payload.competitor_csv_text,
          productName: payload.product_name,
          weights: payload.settings,
          analysis: data,
          selectedIssueId: data.issues?.[0]?.id || prev.selectedIssueId || "",
          lastRun: data.generated_at || new Date().toISOString(),
          sourceName: overrides.sourceName ?? prev.sourceName,
          competitorSourceName:
            overrides.competitorSourceName ?? prev.competitorSourceName,
        }));
      });
    } catch (err) {
      setError(
        err?.message ||
          "Unable to analyze reviews. Is the Flask backend running on port 5000?",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function runUrlAnalysis() {
    const reviewUrl = workspace.reviewUrl.trim();
    const manualText = workspace.urlManualText.trim();

    if (!reviewUrl && !manualText) {
      setError("Add a review URL or paste the review text first.");
      return;
    }

    setError("");
    setProcessing(true);
    startedAtRef.current = performance.now();

    try {
      const response = await fetch(`${API_BASE}/analyze-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          review_url: reviewUrl,
          manual_text: manualText,
          product_name: workspace.productName,
          settings: {
            ...workspace.weights,
            focus_feature: workspace.focusFeature,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || data?.message || "URL analysis failed");
      }

      const elapsed = performance.now() - startedAtRef.current;
      if (elapsed < MIN_PROCESSING_MS) {
        await sleep(MIN_PROCESSING_MS - elapsed);
      }

      startTransition(() => {
        setWorkspace((prev) => ({
          ...prev,
          reviewUrl,
          urlManualText: manualText,
          urlAnalysis: data,
          urlSelectedIssueId:
            data.issues?.[0]?.id || prev.urlSelectedIssueId || "",
          lastRun: data.generated_at || new Date().toISOString(),
          urlSourceName: reviewUrl || "Manual review text",
        }));
      });
    } catch (err) {
      setError(
        err?.message ||
          "Unable to analyze the URL. Is the Flask backend running on port 5000?",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function searchPlayStore(query) {
    if (!query.trim()) return;
    setError("");
    setProcessing(true);
    try {
      const response = await fetch(
        `${API_BASE}/search-apps?q=${encodeURIComponent(query)}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed");
      setWorkspace((prev) => ({ ...prev, playSearchResults: data }));
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function runPlayAnalysis(app) {
    // Accept optional parameter; fallback to currently selectedApp
    const selectedApp = app || workspace.selectedApp;
    if (!selectedApp) {
      setError("No app selected. Please search and choose an app first.");
      return;
    }

    // selectedApp may be a string (app id) or an object with various key names
    let appId = null;
    if (typeof selectedApp === "string") appId = selectedApp;
    else if (selectedApp && typeof selectedApp === "object") {
      appId =
        selectedApp.appId ||
        selectedApp.appID ||
        selectedApp.id ||
        selectedApp.app_id ||
        selectedApp.app ||
        selectedApp.packageName ||
        selectedApp.package_name ||
        selectedApp.package ||
        null;
    }

    if (!appId) {
      // persist the selected object for debugging and show a clearer error
      console.debug("runPlayAnalysis: selectedApp has no id", selectedApp);
      setError("Invalid App selection. Please try searching again.");
      return;
    }

    setError("");
    setProcessing(true);
    // persist selected app and clear search results
    setWorkspace((prev) => ({ ...prev, selectedApp, playSearchResults: [] }));
    startedAtRef.current = performance.now();

    // Simple retry for transient Play Store fetch errors
    const maxAttempts = 2;
    let attempt = 0;
    let lastError = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const response = await fetch(`${API_BASE}/analyze-play-store`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_id: appId,
            settings: {
              ...workspace.weights,
              focus_feature: workspace.focusFeature,
            },
          }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Play Store analysis failed");

        const elapsed = performance.now() - startedAtRef.current;
        if (elapsed < MIN_PROCESSING_MS)
          await sleep(MIN_PROCESSING_MS - elapsed);

        setWorkspace((prev) => ({
          ...prev,
          playAnalysis: data,
          playSelectedIssueId: data.issues?.[0]?.id || "",
          lastRun: data.generated_at || new Date().toISOString(),
        }));
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        // if this was not the last attempt, wait a short backoff then retry
        if (attempt < maxAttempts) await sleep(800);
      }
    }

    if (lastError) setError(lastError?.message || String(lastError));
    setProcessing(false);
  }

  async function loadDemo() {
    setError("");
    try {
      const response = await fetch(`${API_BASE}/demo-data`);
      const demo = await response.json();
      if (!response.ok) {
        throw new Error(demo?.error || "Unable to load demo data");
      }
      await runAnalysis({
        primaryCsvText: demo.primary_csv,
        competitorCsvText: demo.competitor_csv,
        productName: demo.product_name || "Aurora X1",
        sourceName: `demo-primary.csv (${demo.primary_row_count || 0} rows)`,
        competitorSourceName: `demo-competitor.csv (${demo.competitor_row_count || 0} rows)`,
        weights: workspace.weights,
      });
    } catch (err) {
      setError(err?.message || "Could not load demo data.");
    }
  }

  function updateWeight(key, value) {
    setWorkspace((prev) => ({
      ...prev,
      weights: {
        ...prev.weights,
        [key]: Number(value),
      },
    }));
  }

  function clearWorkspace() {
    setError("");
    setWorkspace({ ...DEFAULT_WORKSPACE, weights: { ...DEFAULT_WEIGHTS } });
    setStageIndex(0);
    setProcessing(false);
    setShowAdvanced(false);
    setShowMoreInsights(false);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function exportAnalysis() {
    if (!analysis) return;
    downloadJson(`reviewiq-analysis-${Date.now()}.json`, analysis);
  }

  function openReviewUrl() {
    const reviewUrl = workspace.reviewUrl.trim();
    if (!reviewUrl || typeof window === "undefined") return;
    window.open(reviewUrl, "_blank", "noopener,noreferrer");
  }

  const heroReviewCount =
    metrics.review_count || approximateRows(workspace.primaryCsvText);
  const rowHint = workspace.primaryCsvText
    ? `${formatNumber(heroReviewCount, 0)} rows in browser`
    : "No dataset loaded yet";
  const processingLabel = processing
    ? `Processing stage ${Math.min(stageIndex + 1, pipeline.length)} of ${pipeline.length}`
    : analysis
      ? "Analysis complete"
      : "Waiting for upload";
  const topIssue = metrics.top_issue || {};

  return (
    <div className="app-shell">
      <NavBar activeView={activeView} onNavigate={navigate} />
      <div className="ambient-orb orb-a" />
      <div className="ambient-orb orb-b" />
      <div className="ambient-orb orb-c" />
      <LoadingOverlay visible={processing} />

      {activeView === "home" ? (
        <HomePage onNavigate={navigate} />
      ) : activeView === "url" ? (
        <UrlReviewPage
          workspace={workspace}
          analysisEngine={urlAnalysisEngine}
          error={error}
          processing={processing}
          onUrlChange={(value) =>
            setWorkspace((prev) => ({ ...prev, reviewUrl: value }))
          }
          onTextChange={(value) =>
            setWorkspace((prev) => ({ ...prev, urlManualText: value }))
          }
          onAnalyze={runUrlAnalysis}
          onOpenUrl={openReviewUrl}
          onBackToCsv={() => navigate("csv")}
          onSelectIssue={(id) =>
            setWorkspace((prev) => ({ ...prev, urlSelectedIssueId: id }))
          }
          onNavigateHome={() => navigate("home")}
        />
      ) : activeView === "play" ? (
        <PlayStorePage
          workspace={workspace}
          analysisEngine={playAnalysisEngine}
          error={error}
          processing={processing}
          onSearch={(query, performSearch) => {
            setWorkspace((prev) => ({ ...prev, playQuery: query }));
            if (performSearch) searchPlayStore(query);
          }}
          onSelectApp={(app) => {
            // only select app; analyze when user confirms
            const normalizedId =
              app?.appId ||
              app?.appID ||
              app?.id ||
              app?.app_id ||
              app?.app ||
              null;
            const normalized = { ...app, appId: normalizedId };
            setWorkspace((prev) => ({
              ...prev,
              selectedApp: normalized,
              playSearchResults: [],
            }));
          }}
          onAnalyzeSelected={() => runPlayAnalysis()}
          onSelectIssue={(id) =>
            setWorkspace((prev) => ({ ...prev, playSelectedIssueId: id }))
          }
        />
      ) : activeView === "compare" ? (
        <ComparePage workspace={workspace} />
      ) : (
        <div className="layout csv-layout">
          <aside className="sidebar">
            <div className="panel">
              <div className="substack">
                <h3>Workspace</h3>
                <p>Configure your analysis source</p>
              </div>

              <div className="control-group" style={{ marginTop: "20px" }}>
                <div className="field">
                  <label htmlFor="product-name">Product Name</label>
                  <input
                    id="product-name"
                    className="input"
                    value={workspace.productName}
                    onChange={(event) =>
                      setWorkspace((prev) => ({
                        ...prev,
                        productName: event.target.value,
                      }))
                    }
                    placeholder="Aurora X1"
                  />
                </div>

                <div className="upload-card primary-upload">
                  <header>
                    <label className="field">Primary CSV</label>
                    <button
                      type="button"
                      className="button"
                      style={{ padding: "4px 12px", fontSize: "0.8rem" }}
                      onClick={() => primaryInputRef.current?.click()}
                    >
                      Upload
                    </button>
                  </header>
                  <input
                    ref={primaryInputRef}
                    type="file"
                    accept=".csv,.txt"
                    className="sr-only"
                    onChange={(event) =>
                      handleFileLoad("primary", event.target.files?.[0])
                    }
                  />
                  <textarea
                    className="textarea"
                    style={{ minHeight: "120px" }}
                    value={workspace.primaryCsvText}
                    onChange={(event) =>
                      setWorkspace((prev) => ({
                        ...prev,
                        primaryCsvText: event.target.value,
                      }))
                    }
                    placeholder="Paste CSV data here..."
                  />
                </div>

                <div className="button-row" style={{ marginTop: "8px" }}>
                  <button
                    type="button"
                    className="button button-primary"
                    style={{ width: "100%" }}
                    onClick={() => runAnalysis()}
                    disabled={processing}
                  >
                    {processing ? "Analyzing..." : "Analyze Reviews"}
                  </button>
                </div>

                <button
                  type="button"
                  className="button"
                  style={{ width: "100%", justifyContent: "space-between" }}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  <span>Advanced Settings</span>
                  <span>{showAdvanced ? "−" : "+"}</span>
                </button>

                {showAdvanced && (
                  <div
                    className="control-group"
                    style={{
                      paddingTop: "12px",
                      borderTop: "1px solid var(--border)",
                    }}
                  >
                    {analysis?.detected_features?.length > 0 && (
                      <div className="field">
                        <label>Feature Focus</label>
                        <div className="chip-row" style={{ marginTop: "4px" }}>
                          <button
                            type="button"
                            className={`badge ${!workspace.focusFeature ? "accent" : "neutral"}`}
                            onClick={() => {
                              setWorkspace((prev) => ({
                                ...prev,
                                focusFeature: "",
                              }));
                              setTimeout(
                                () => runAnalysis({ focusFeature: "" }),
                                0,
                              );
                            }}
                          >
                            All
                          </button>
                          {analysis.detected_features.map((f) => (
                            <button
                              key={f}
                              type="button"
                              className={`badge ${workspace.focusFeature === f ? "accent" : "neutral"}`}
                              onClick={() => {
                                setWorkspace((prev) => ({
                                  ...prev,
                                  focusFeature: f,
                                }));
                                setTimeout(
                                  () => runAnalysis({ focusFeature: f }),
                                  0,
                                );
                              }}
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                        <p className="mini-note" style={{ marginTop: "8px" }}>
                          Select a feature to center the AI analysis
                          specifically on that topic.
                        </p>
                      </div>
                    )}

                    <div className="field">
                      <label htmlFor="issue-search">Search Keyword</label>
                      <input
                        id="issue-search"
                        className="input"
                        value={workspace.search}
                        onChange={(event) =>
                          setWorkspace((prev) => ({
                            ...prev,
                            search: event.target.value,
                          }))
                        }
                        placeholder="e.g. battery"
                      />
                    </div>

                    <div className="upload-card">
                      <header>
                        <label className="field">Competitor CSV</label>
                        <button
                          type="button"
                          className="button"
                          style={{ padding: "4px 12px", fontSize: "0.8rem" }}
                          onClick={() => competitorInputRef.current?.click()}
                        >
                          Upload
                        </button>
                      </header>
                      <input
                        ref={competitorInputRef}
                        type="file"
                        accept=".csv,.txt"
                        className="sr-only"
                        onChange={(event) =>
                          handleFileLoad("competitor", event.target.files?.[0])
                        }
                      />
                      <textarea
                        className="textarea"
                        style={{ minHeight: "80px" }}
                        value={workspace.competitorCsvText}
                        onChange={(event) =>
                          setWorkspace((prev) => ({
                            ...prev,
                            competitorCsvText: event.target.value,
                          }))
                        }
                        placeholder="Optional competitor data..."
                      />
                    </div>

                    <div className="button-row">
                      <button
                        type="button"
                        className="button"
                        style={{ flex: 1 }}
                        onClick={loadDemo}
                      >
                        Demo
                      </button>
                      <button
                        type="button"
                        className="button"
                        style={{ flex: 1 }}
                        onClick={exportAnalysis}
                        disabled={!analysis}
                      >
                        Export
                      </button>
                    </div>
                    <button
                      type="button"
                      className="button button-danger"
                      style={{ width: "100%" }}
                      onClick={clearWorkspace}
                    >
                      Reset Workspace
                    </button>
                  </div>
                )}
              </div>
            </div>

            {processing && (
              <div className="panel">
                <PipelineRail stages={pipeline} />
              </div>
            )}
          </aside>

          <main className="main">
            {!analysis && !processing && (
              <section
                className="panel"
                style={{ textAlign: "center", padding: "64px 24px" }}
              >
                <div className="substack" style={{ alignItems: "center" }}>
                  <Logo size={56} />
                  <h2
                    style={{
                      fontSize: "2.5rem",
                      marginBottom: "12px",
                      marginTop: "24px",
                    }}
                  >
                    Ready to analyze?
                  </h2>
                  <p
                    style={{
                      maxWidth: "480px",
                      margin: "0 auto 32px",
                      fontSize: "1.1rem",
                    }}
                  >
                    Paste your review data in the sidebar or load the demo
                    dataset to see how ReviewIQ turns noise into clear product
                    decisions.
                  </p>
                  <button
                    type="button"
                    className="button button-primary"
                    style={{ padding: "14px 40px", fontSize: "1.1rem" }}
                    onClick={loadDemo}
                  >
                    Load Demo Data
                  </button>
                </div>
              </section>
            )}

            {(analysis || processing) && (
              <>
                <AnalysisSnapshot
                  issue={selectedIssue}
                  analysisEngine={analysisEngine}
                  reviewCount={heroCount}
                  fallbackUsed={Boolean(analysisEngine.fallback_used)}
                  sourceIcon={analysis?.source?.favicon}
                />

                {error && (
                  <div
                    className="badge bad"
                    style={{
                      padding: "12px",
                      borderRadius: "var(--radius-sm)",
                      width: "100%",
                      justifyContent: "center",
                    }}
                  >
                    {error}
                  </div>
                )}

                <section className="metrics-row">
                  <MetricCard
                    label="Impact Leader"
                    value={
                      topIssue.feature_label
                        ? shorten(topIssue.feature_label, 18)
                        : "—"
                    }
                    tone={toneForPriority(topIssue.priority)}
                  />
                  <MetricCard
                    label="Est. Users Affected"
                    value={formatNumber(
                      metrics.impacted_users_estimate || 0,
                      0,
                    )}
                    tone="accent"
                  />
                  <MetricCard
                    label="Average Rating"
                    value={
                      metrics.avg_rating
                        ? `${Number(metrics.avg_rating).toFixed(1)}/5`
                        : "—"
                    }
                    tone="neutral"
                  />
                  <MetricCard
                    label="Issue Count"
                    value={formatNumber(issues.length, 0)}
                    tone="neutral"
                  />
                </section>

                <div className="grid-2">
                  <Panel
                    title="Top Issues"
                    actions={
                      <Badge tone="accent">{issues.length} Ranked</Badge>
                    }
                  >
                    <IssueList
                      issues={filteredIssues}
                      selectedId={workspace.selectedIssueId}
                      onSelect={(id) =>
                        setWorkspace((prev) => ({
                          ...prev,
                          selectedIssueId: id,
                        }))
                      }
                    />
                  </Panel>

                  <Panel title="Issue Deep Dive">
                    {selectedIssue ? (
                      <div className="detail-card">
                        <div className="detail-top">
                          <div className="detail-title">
                            <h3>
                              {selectedIssue.feature_label ||
                                selectedIssue.feature_key}
                            </h3>
                            <p>
                              {selectedIssue.executive_summary ||
                                selectedIssue.recommendation}
                            </p>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div
                              className="priority-score"
                              style={{ fontSize: "2rem" }}
                            >
                              {formatNumber(selectedIssue.impact_score, 0)}
                            </div>
                            <Badge
                              tone={toneForPriority(selectedIssue.priority)}
                            >
                              {selectedIssue.priority}
                            </Badge>
                          </div>
                        </div>

                        <div
                          className="detail-grid"
                          style={{ marginTop: "16px" }}
                        >
                          <DetailBlock heading="Root Cause">
                            {selectedIssue.root_cause?.summary ||
                              "Analyzing..."}
                          </DetailBlock>
                          <DetailBlock heading="Next Step">
                            {selectedIssue.action_timeline || "Pending"}
                          </DetailBlock>
                          <DetailBlock heading="Business Risk">
                            {selectedIssue.business_risk?.churn_risk_pct
                              ? `${formatNumber(selectedIssue.business_risk.churn_risk_pct, 1)}% churn risk`
                              : "N/A"}
                          </DetailBlock>
                          <DetailBlock heading="Evidence">
                            {selectedIssue.evidence?.length || 0} snippets
                          </DetailBlock>
                        </div>

                        <button
                          type="button"
                          className="button"
                          style={{ marginTop: "24px", width: "100%" }}
                          onClick={() => setShowMoreInsights(!showMoreInsights)}
                        >
                          {showMoreInsights
                            ? "Hide Evidence & Charts"
                            : "Show Evidence & Charts"}
                        </button>
                      </div>
                    ) : (
                      <div className="empty-state">
                        Select an issue to see details.
                      </div>
                    )}
                  </Panel>
                </div>

                {showMoreInsights && (
                  <div
                    className="page"
                    style={{
                      animationDelay: "0.2s",
                      display: "grid",
                      gap: "24px",
                    }}
                  >
                    <div className="grid-2">
                      <Panel title="Trend Timeline">
                        <TrendChart timeline={timeline} />
                      </Panel>
                      <Panel title="Emotion Map">
                        <EmotionMap items={emotions} />
                      </Panel>
                    </div>

                    <Panel title="Review Explorer">
                      <ReviewFeed items={previews} />
                    </Panel>
                  </div>
                )}
              </>
            )}

            <footer
              className="footer"
              style={{ textAlign: "center", marginTop: "64px", opacity: 0.5 }}
            >
              ReviewIQ &middot; Minimalist Product Intelligence
            </footer>
          </main>
        </div>
      )}
    </div>
  );
}

export default App;
