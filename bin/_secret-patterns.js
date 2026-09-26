"use strict";
// bin/_secret-patterns.js — secret and PII patterns shared by the JS guardrails:
// bin/testing/detect-secrets.js (pre-commit), bin/validate-generated.js (generation
// gate) and .claude/hooks/*. bin/detect-secrets.sh keeps its own grep copy.

const SECRET_PATTERNS = [
  { id: "bearer-jwt", label: "JWT Bearer token", re: /Bearer\s+eyJ[A-Za-z0-9_\-.]{20,}/ },
  { id: "aws-access-key", label: "AWS Access Key ID", re: /AKIA[0-9A-Z]{16}/ },
  { id: "aws-secret-key", label: "AWS Secret Access Key", re: /AWS_SECRET_ACCESS_KEY\s*=\s*[A-Za-z0-9+/]{40}/ },
  { id: "private-key", label: "PEM private key", re: /-----BEGIN\s+(RSA\s+|EC\s+)?PRIVATE KEY-----/ },
  {
    id: "api-key",
    label: "API key assignment",
    re: /['"]?(?:api[_-]?key|apikey|api_secret)['"]?\s*[:=]\s*['"][A-Za-z0-9_\-.]{16,}['"]/,
  },
  // The value excludes ${...} (interpolation) and __ENV.X (k6 env reference):
  // both are placeholders by construction, not credentials.
  {
    id: "password",
    label: "Hard-coded password",
    re: /['"]?(?:password|passwd|secret)['"]?\s*[:=]\s*['"](?!__ENV\.)[^'"${}\s]{8,}['"]/i,
  },
  // Not a credential when the userinfo is the placeholder literal
  // (password/pass/user/username), masked (***) or bracketed (documented URL format).
  {
    id: "connection-string",
    label: "Connection string with credentials",
    re: /(?:postgres|mysql|mongodb|redis):\/\/(?![[<])[^:\s[<]*:(?!(?:password|passwd|pass|user|username|\*+)@|<)[^@\s]+@/i,
  },
  { id: "github-pat", label: "GitHub Personal Access Token", re: /ghp_[A-Za-z0-9]{36}/ },
  { id: "github-app-token", label: "GitHub App token", re: /ghs_[A-Za-z0-9]{36}/ },
  { id: "sk-key", label: "API secret key (sk- prefix)", re: /sk-[A-Za-z0-9]{20,}/ },
  { id: "slack-token", label: "Slack token", re: /xox[baprs]-[0-9A-Za-z]{10,}/ },
];

// A line carrying one of these is not a finding: explicit opt-out or a placeholder.
const LINE_ALLOW_RE = /secret-allow|secretsignore|\$\{__ENV\.|__ENV\[|{{.*}}|<YOUR_|YOUR_API|example|placeholder/i;

// PII an AI artifact must never carry (flow recordings, reports).
const PII_PATTERNS = [
  { id: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { id: "jwt", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: "authorization-value", re: /\bauthorization["']?\s*[:=]\s*["']?(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i },
  { id: "cookie-value", re: /\b(set-)?cookie["']?\s*[:=]\s*["']?[^\s"';=]+=[^\s"';]{6,}/i },
  { id: "long-digit-run", re: /(?<![\d.])\d{9,}(?![\d.])/ },
];

// Documentation-only addresses, never real people.
const PII_EMAIL_ALLOW = /@(example\.(com|org|net)|test\.local|localhost)\b/i;

/** Scan text line by line. @returns {{id:string,line:number}[]} */
function scan(text, patterns, isAllowed) {
  const hits = [];
  String(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const p of patterns) {
        const m = p.re.exec(line);
        if (m && !isAllowed(line, p.id, m[0])) hits.push({ id: p.id, line: i + 1 });
      }
    });
  return hits;
}

const findSecrets = (text) => scan(text, SECRET_PATTERNS, (line) => LINE_ALLOW_RE.test(line));
const findPII = (text) => scan(text, PII_PATTERNS, (line, id, match) => id === "email" && PII_EMAIL_ALLOW.test(match));

module.exports = { SECRET_PATTERNS, LINE_ALLOW_RE, PII_PATTERNS, findSecrets, findPII };
