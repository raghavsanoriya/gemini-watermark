# Third-party skills

These skills are copied from public repositories so that every Claude Code session on this
repository (including cloud sessions started from the Claude mobile or web app) can use them.
Each was read in full before it was added; only the files listed were copied. Upstream files
are unmodified. `audit/` and `hallmark/` are this project's own skills.

| Skill | Source (pinned commit) | License | Files copied |
| --- | --- | --- | --- |
| `auditing-code-for-vulnerabilities` | [trilwu/secskills](https://github.com/trilwu/secskills) `ca53957bcd8e3b83b5d4d190bb3ad008a4f15c84`, `secskills-core/skills/` | MIT (copy in folder) | `SKILL.md`, `references/bug-class-checklist.md` |
| `auditing-supply-chain` | same | MIT | `SKILL.md` |
| `reviewing-code-changes` | same | MIT | `SKILL.md` |
| `sharp-edges` | [trailofbits/skills](https://github.com/trailofbits/skills) `149d7b21f4067765b82e67029730b42d228ef4b4`, `plugins/sharp-edges/skills/sharp-edges/` | CC BY-SA 4.0 (copy in folder); © Trail of Bits | `SKILL.md`; `references/` for JavaScript, config, auth, crypto, case studies |
| `owasp-security` | [agamm/claude-code-owasp](https://github.com/agamm/claude-code-owasp) `1ae29cb22518560e3625d77f2ae64f61647d9201`, `.claude/skills/owasp-security/` | MIT (copy in folder) | `SKILL.md`, `reference/review-checklist.md`, `reference/config-and-supply-chain.md` |
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `5a37a6329fbad3666c3207392a6a7c0110e92efb`, `skills/react-best-practices/` | MIT (stated in the upstream README; no license file upstream) | `SKILL.md`; 20 of the 70 `rules/` (waterfalls, bundle size, shared server state, client storage, re-renders, conditional rendering) |
| `web-design-guidelines` | same repository, `skills/web-design-guidelines/` | MIT (as above) | `SKILL.md`, `references/command.md` |
| `verification-before-completion` | [obra/superpowers](https://github.com/obra/superpowers) `22f0b463e7a5e579904dd6211a520321035526f7`, `skills/verification-before-completion/` | MIT (copy in folder) | `SKILL.md` |

## Left out on purpose

- Reference files for other languages (sharp-edges: C, Go, Rust, Java, PHP, Python, Ruby,
  Swift, Kotlin, C#; owasp-security: `languages.md`) and the 44 KB `owasp-report.md`. The
  skills mention them; they are not needed for this TypeScript project.
- The other 50 React rules, which target server components and data fetching this app does
  not use. The full guide is upstream.
- Skills from the owner's local list that do not fit this project (blockchain scanners,
  malware and forensics, payload, password and web-shell collections) or that need tools this
  environment lacks.

## Updating

Re-copy from a newer upstream commit, read the changes, and update the commit hashes above.
