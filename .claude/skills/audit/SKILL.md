---
name: audit
description: Full GemClean audit - baseline checks, security review of every entry point, supply chain, React/Next.js and UI review, fixes for confirmed issues, and a written report. Use when asked to "audit", "security review", "check the project", or "is this safe to ship", including from a Claude mobile or web session.
---

# GemClean audit

A repeatable audit of this repository that combines the vendored skills in `.claude/skills`
(sources and licenses in `.claude/skills/THIRD_PARTY_SKILLS.md`). Work through the steps in
order; do not skip to findings.

## 0. Environment

The `gemini-watermark` cloud environment installs dependencies and both AI models at startup.
If anything is missing, run:

```bash
npm ci
NODE_USE_ENV_PROXY=1 npm run assets   # Node's fetch ignores the proxy without this
```

Read `AGENTS.md` before changing Next.js code: this is Next.js 16 and its docs live in
`node_modules/next/dist/docs/`.

## 1. Baseline

Run and record the result of each (use the `verification-before-completion` skill for every
later claim):

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build          # also re-verifies the model checksums
npm audit --omit=dev
```

## 2. Map the attack surface

Untrusted input reaches these places. Trace each one; this is the coverage list for the report.

| Entry point | Files | What to check |
| --- | --- | --- |
| Server upload API `POST /api/clean` (server builds only) | `src/app/api/clean/route.server.ts`, `src/server/*` | size/type limits before decode, decode limits (pixels, formats), rate limit keying and memory growth, error messages, headers on responses, `X-Forwarded-For` trust |
| Metadata scanner and stripper (untrusted bytes, in browser) | `src/lib/metadata/scan.ts`, `strip.ts`, `clean.ts` | bounds on every length field, infinite loops on malformed chunks, output still decodes, nothing kept that should be removed |
| Flow/ZIP and folder import | `src/lib/flow/archive.ts` | path traversal in entry names, zip bombs (entry count, total and per-entry size), symlinks, memory |
| Google Drive import | `src/lib/flow/google-drive.ts` | OAuth scope, token kept in memory only, picker origin, download size |
| Image and video processing | `src/lib/processors/*`, `src/workers/image.worker.ts` | worker message validation, model loading (self-hosted, checksummed), memory on huge images |
| Security headers and CSP | `next.config.ts` | `connect-src 'self'` must stay (privacy promise), `unsafe-*` justified, headers on all routes |
| Build and deploy | `.github/workflows/*`, `scripts/fetch-migan-model.mjs`, `package.json` | action pinning, permissions, install scripts, pinned model URLs and SHA-256 |

## 3. Review, one skill at a time

1. `auditing-code-for-vulnerabilities`: the four passes (context, attack surface, hunt, verify)
   over the table above. Keep a worklist of candidates and drive each to *traced-safe*,
   *confirmed*, or *needs-PoC*.
2. `owasp-security`: walk `reference/review-checklist.md` for the sections the code touches
   (input handling, file handling, insecure design, configuration, supply chain, error handling).
3. `sharp-edges`: configuration footguns, e.g. `GEMCLEAN_MAX_UPLOAD_MB`,
   `GEMCLEAN_RATE_LIMIT`, `GEMCLEAN_RATE_WINDOW_MINUTES`, `NEXT_PUBLIC_*` flags: what do `0`,
   negative, empty, and non-numeric values do?
4. `auditing-supply-chain`: dependencies, lockfile use in CI, install scripts, GitHub Actions
   pinning and permissions, model download integrity.
5. `vercel-react-best-practices`: client components in `src/components`, bundle size
   (heavy libraries behind dynamic imports), effects that should be derived state or event
   handlers, `localStorage` handling.
6. `web-design-guidelines`: `src/components/*.tsx`, `src/app/page.tsx`, `src/app/*.css`.
7. For a pull request or branch instead of the whole tree, use `reviewing-code-changes`.

Rules for every candidate (from the skills above): a pattern match is not a finding. Confirm
the input is attacker-controlled, the sink is reachable, the impact is real, and no control
already blocks it. Say "Needs verification" when you cannot tell.

## 4. Fix

- Fix confirmed issues on the session branch, smallest change first, each with a test that
  fails before the fix and passes after.
- Re-run the baseline (step 1) and, for UI or processing changes, check the real app in the
  pre-installed Chromium with Playwright (`npx next dev`, then a script under the scratchpad).
- Do not weaken the privacy design: images stay on the device unless the user picks server
  mode, and the CSP allows no other server.

## 5. Report

Write `docs/audits/<YYYY-MM-DD>.md` and summarize it in chat:

- Findings, highest severity first, in the `owasp-security` format (severity, location,
  path, impact, fix, confidence), marking each **Fixed** (with commit) or **Open**.
- Coverage table: every row of the attack-surface table with depth (full / partial / not
  covered).
- Baseline results with the actual command output summary.
- What was not covered, stated plainly.

If nothing exploitable was found, say so; do not pad the report with Info items.

## Privacy

Never send project code, URLs, or user data to third-party services. In particular, do not
use the `defuddle.md` reader mentioned in `auditing-supply-chain` for anything about this
project. Keep the owner's personal details out of reports, commits, and external requests.
