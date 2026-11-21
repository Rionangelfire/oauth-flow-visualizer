# OAuth 2.0 Flow Visualizer — polish notes (Nov 21, 2026)

Source: Robert's pasted single-file simulator (Authorization Code + PKCE,
Client Credentials, Refresh Token rotation, Device Code RFC 8628). His file
is kept byte-identical at `index.original.html`; the polished file is
`index.html`.

## File stats (verified)

- `index.original.html` — 1,249 lines, 63,101 bytes. Starts with
  `<!DOCTYPE html>`, ends with `</html>`. Complete, no truncation.
- `index.html` (polished) — 1,285 lines, 65,371 bytes. Diff vs original is
  exactly the changes below (68 diff lines, all accounted for).
- JavaScript syntax: `node --check` passed on all 3 inline script blocks
  (Tailwind config + the 941-line engine), original and polished.

## What was already good (verified, not re-done)

1. **Frame-rate-independent packets** — `p.progress += p.speed * dt * 60`
   with `dt` clamped to 0.05s, and ripples use the same `dt`. Same pattern
   as the Circuit Breaker fix, already present here.
2. **Protocol log capped at 150 lines** — oldest rows drop off; verified by
   flooding `logProtocol` 160 times in the playtest (150 children remain).
3. **Canvas resize hardening** — `ctx.setTransform(1,0,0,1,0,0)` before
   scaling, so transforms can never compound across resizes.
4. **No packet-flood vector** — `spawnPacket` is called only from
   `goToStep`, once per step, so at most ~1–2 packets are ever in flight.
   No packet cap was needed (unlike the Circuit Breaker, which had a
   user-spammable send button).
5. **Reduced-motion handling** — packet trails and glow are skipped when
   `prefers-reduced-motion` is set.

## What changed (polish only — no new features, design untouched)

1. **Wired the two dead buttons (real bug)** — the Reset button
   (`#resetFlowBtn`) and the Auto Flow button (`#autoPlayBtn`) had no click
   listeners at all: both were in the `els` map and both handler functions
   existed, but nothing connected them. Clicking either did nothing.
   Both are now wired (`resetFlowBtn` → `resetFlow()`,
   `autoPlayBtn` → `toggleAutoPlay()`). Verified in the playtest: Reset
   restores UNAUTHENTICATED / step 0 / empty vault, and Auto Flow runs the
   full 5 steps to AUTHENTICATED on its own.
2. **Token vault now follows each flow's real issuance step (real bug)** —
   `hasToken` was hardcoded to `currentStep >= 3`, which is only correct
   for Auth Code and Device Code. In Client Credentials the token is issued
   at step 2 (index 1) and in Refresh Token at step 3 (index 2), so the
   vault kept showing "not issued yet" and UNAUTHENTICATED for one or two
   steps after the token arrived. Each flow definition now carries
   `tokenStep` (auth_code 3, client_credentials 1, refresh_token 2,
   device_code 3) and `tokenTtl` (3600 / 900 / 3600 / 3600 — the old code
   also showed "TTL: 3600s" for Client Credentials, whose payload says
   `expires_in: 900`). The token tone and the green log row are keyed to
   `tokenStep` too, instead of a hardcoded step 3.
3. **Step-3 banner no longer goes stale when toggles change (real bug)** —
   Auth Code step 3's `http`, `color`, and `desc` were computed once, when
   `FLOW_DEFINITIONS` was built at load time (attack off, PKCE on). The
   wire `payload` is a function and updated correctly, but the explanation
   banner and HTTP badge kept showing the non-attack text even while the
   payload showed the 400 `invalid_grant` response — the banner
   contradicted the payload. Those three fields are now functions
   evaluated at render time, and a one-line `stepField()` resolver handles
   both shapes; every consumer (banner, badge, log line, packet color) goes
   through it — verified by grep that no raw `st.http` / `st.desc` /
   `st.color` read remains.
4. **Tailwind config guard (robustness)** — the inline `tailwind.config`
   assignment threw `ReferenceError: tailwind is not defined` whenever the
   Tailwind CDN was unreachable (offline, blocked), failing the whole
   headless run. It is now wrapped in `if (window.tailwind) { ... }`.
   In a real browser the CDN script loads synchronously before it, so the
   config still applies exactly as before.
5. **Small a11y/meta** — meta description tag; `role="img"` + `aria-label`
   on the canvas container; flow tabs now expose `role="tab"` +
   `aria-selected` (kept in sync on click); the current stepper card gets
   `aria-current="step"`.

## Playtest (headless Chromium, `playtest.js`)

72/72 checks passed on the final run: initial state; all 5 steps of each
of the 4 flows (manual stepping); Prev + stepper jumps; Restart Flow
regenerates tokens; Reset restores the initial state; Auto Flow completes
to AUTHENTICATED with the completion toast; PKCE toggle on/off changes the
vault and the step-1 payload; attack armed with PKCE on blocks at step 3
(banner, payload, and log all agree on `invalid_grant`); attack armed
with PKCE off succeeds with the SECURITY WARNING log; per-flow token
steps and TTLs (900s for Client Credentials); scope changes update the
wire payload; log cap at 150; Clear empties the log. Zero page JS errors.
Screenshots in `shots/` (4 unstyled headless + 3 styled, captured from a
vendored test copy in /tmp with local Tailwind/fonts — zero page errors in
that run too).

The first playtest run caught 2 test bugs, both mine — the sim was right:
my device_code step numbering was off by one, and my stream-call needle
was `/api/v1/media/stream` where the real URL is
`api.example.com/v1/media/stream`. It also surfaced the Tailwind
ReferenceError, which the config guard (change 4 above) fixed.

## Left alone (observed, not a bug)

- Reset keeps the selected flow, the PKCE/attack toggles, and the scope
  checkboxes — those are user configuration, not flow state. (Contrast
  with the Circuit Breaker, where Reset restores the sliders because the
  demo had changed them.)
- The Refresh Token flow starts with an empty vault even though its story
  is "an old token expired" — the sim's model is that tokens appear when
  issued. Not changed.
- The toast builds Tailwind classes dynamically
  (`border-${tone}-500/60`); the Play CDN generates those at runtime in a
  real browser, so this works live and is only unstyled headless.

## Status

Local-only. NOT published to the portfolio site, NOT on GitHub, NOT in the
résumé, NOT posted anywhere. No GitHub issues created for it. Publish only
on Robert's word.

## Needs his decision

- Publish as a named portfolio exception (repo + GitHub Pages + LinkedIn),
  the way the Circuit Breaker sim shipped — or keep it local.
- Firefox and Mobile Safari are untested (harness is Chromium-only),
  same open item as the Circuit Breaker release.
