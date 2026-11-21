// Playtest for the polished OAuth 2.0 Flow Visualizer.
// Loads the file in headless Chromium and drives all four grant flows:
// auth_code (manual + auto flow), client_credentials, refresh_token,
// device_code — plus the PKCE toggle, the attack-simulation toggle (both
// PKCE-on and PKCE-off), Reset, Prev, stepper jumps, scope changes, and
// the protocol-log cap. Screenshots to ./shots/.
//
// NOTE: headless Chromium cannot reach the Tailwind / Google Fonts CDNs,
// so the page loads unstyled. The test sets the canvas container height
// itself (the file's own CSS class normally does this) so the canvas draws.
const puppeteer = require('/home/hatch/workspace/.harness/node_modules/puppeteer-core');
const crypto = require('crypto');
const fs = require('fs');
const POLICY_PATH = '/home/hatch/workspace/.harness/webgl-policy.txt';
const POLICY_SHA = crypto.createHash('sha256').update(fs.readFileSync(POLICY_PATH)).digest('hex');

const FILE = 'file:///home/hatch/workspace/portfolio/oauth-flow-visualizer/index.html';
const SHOTS = '/home/hatch/workspace/portfolio/oauth-flow-visualizer/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let checks = 0;
function check(name, cond, detail = '') {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/meta-chromium/chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage',
      '--hatch-webgl-allowed-domains-file=' + POLICY_PATH,
      '--hatch-webgl-allowed-domains-sha256=' + POLICY_SHA],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('requestfailed', (r) => failedRequests.push(r.url()));

  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 45000 });
  await sleep(600);

  const snap = () => page.evaluate(() => ({
    session: document.getElementById('sessionText').textContent,
    progress: document.getElementById('stepProgressLabel').textContent,
    flowBadge: document.getElementById('flowBadge').textContent,
    stepTitle: document.getElementById('stepTitle').textContent,
    stepHttp: document.getElementById('stepHttpBadge').textContent,
    stepDesc: document.getElementById('stepDesc').textContent,
    access: document.getElementById('accessTokenValue').textContent,
    refresh: document.getElementById('refreshTokenValue').textContent,
    ttl: document.getElementById('tokenExpiryLabel').textContent,
    pkce: document.getElementById('pkceStatusLabel').textContent,
    verifier: document.getElementById('pkceVerifierVal').textContent,
    payload: document.getElementById('wirePayloadView').textContent,
    log: document.getElementById('protocolLog').textContent,
    logCount: document.getElementById('protocolLog').children.length,
    stepperCount: document.getElementById('stepStepperList').children.length,
    nextLabel: document.getElementById('nextStepLabel').textContent,
    prevDisabled: document.getElementById('stepBackBtn').disabled,
    autoLabel: document.getElementById('autoPlayLabel').textContent,
    pkceChecked: document.getElementById('pkceToggle').checked,
    attackChecked: document.getElementById('attackSimToggle').checked,
    step: (typeof sim !== 'undefined' ? sim.currentStep : null),
    flow: (typeof sim !== 'undefined' ? sim.flow : null),
    packets: (typeof sim !== 'undefined' ? sim.packets.length : null),
  }));
  const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const clickFlow = (flow) => page.evaluate((f) => document.querySelector(`[data-flow="${f}"]`).click(), flow);
  const next = async (n = 1) => { for (let i = 0; i < n; i++) { await click('#nextStepBtn'); await sleep(150); } };
  const setChecked = (sel, want) => page.evaluate((s, w) => {
    const el = document.querySelector(s);
    if (el.checked !== w) el.click();
  }, sel, want);

  // Give the canvas its height (Tailwind class does this in a real browser).
  await page.evaluate(() => {
    document.getElementById('canvasContainer').style.height = '350px';
    window.resizeCanvas();
  });
  await sleep(400);
  await page.screenshot({ path: `${SHOTS}/01-initial.png` });

  // 1. Initial state
  let s = await snap();
  check('initial session UNAUTHENTICATED', s.session === 'UNAUTHENTICATED', s.session);
  check('initial step 0 of 5, auth_code flow', s.step === -1 && s.flow === 'auth_code' && s.progress.includes('Step 0 of 5'), s.progress);
  check('initial flow badge Auth Code + PKCE', s.flowBadge === 'Auth Code + PKCE', s.flowBadge);
  check('initial vault shows no tokens', s.access.includes('not issued yet') && s.refresh.includes('not issued yet'), `access=${s.access}`);
  check('initial PKCE ENABLED (S256)', s.pkce === 'ENABLED (S256)' && s.pkceChecked, s.pkce);
  check('initial 5 stepper cards, Prev disabled', s.stepperCount === 5 && s.prevDisabled, `steppers=${s.stepperCount} prevDisabled=${s.prevDisabled}`);
  check('initial TTL --', s.ttl === 'TTL: --', s.ttl);

  // 2. Auth code flow, manual stepping, all 5 steps
  await next(1);
  s = await snap();
  check('step 1: Authorization Request', s.step === 0 && s.stepTitle.includes('Authorization Request'), s.stepTitle);
  check('step 1 payload has code_challenge (PKCE on)', s.payload.includes('code_challenge'), s.payload.slice(0, 120));
  check('step 1 session HANDSHAKE IN PROGRESS', s.session === 'HANDSHAKE IN PROGRESS', s.session);
  await next(1);
  s = await snap();
  check('step 2: User Consent & Auth Code', s.step === 1 && s.stepTitle.includes('User Consent'), s.stepTitle);
  check('step 2 still unauthenticated (no token yet)', s.session === 'HANDSHAKE IN PROGRESS' && s.access.includes('not issued yet'));
  await next(1);
  s = await snap();
  check('step 3: Token Exchange, normal (no attack)', s.step === 2 && s.stepTitle.includes('Token Exchange'), s.stepTitle);
  check('step 3 banner shows POST /oauth/token', s.stepHttp.includes('POST /oauth/token'), s.stepHttp);
  check('step 3 payload has code_verifier', s.payload.includes('code_verifier='), s.payload.slice(0, 100));
  await next(1);
  s = await snap();
  check('step 4: tokens issued, AUTHENTICATED', s.step === 3 && s.session === 'AUTHENTICATED', `${s.step} / ${s.session}`);
  check('step 4 access token looks like a JWT', s.access.startsWith('eyJhbGciOiJSUzI1NiJ9.'), s.access.slice(0, 30));
  check('step 4 refresh token issued', s.refresh.startsWith('rt_'), s.refresh.slice(0, 12));
  check('step 4 TTL 3600s', s.ttl === 'TTL: 3600s', s.ttl);
  await next(1);
  s = await snap();
  check('step 5: Protected Resource Call', s.step === 4 && s.stepTitle.includes('Protected Resource'), s.stepTitle);
  check('step 5 payload has Bearer token', s.payload.includes('Authorization: Bearer eyJ'), s.payload.slice(0, 80));
  check('step 5 Next button becomes Restart Flow', s.nextLabel === 'Restart Flow', s.nextLabel);
  await page.screenshot({ path: `${SHOTS}/02-auth-code-tokens.png` });

  // 3. Prev button + stepper jump
  await click('#stepBackBtn');
  await sleep(150);
  s = await snap();
  check('Prev goes back to step 4', s.step === 3, `step=${s.step}`);
  await page.evaluate(() => document.querySelectorAll('#stepStepperList button')[4].click());
  await sleep(150);
  s = await snap();
  check('stepper card jumps to step 5', s.step === 4, `step=${s.step}`);

  // 4. Restart Flow regenerates tokens and returns to step 1
  const tokenBefore = s.access;
  await click('#nextStepBtn'); // Restart Flow
  await sleep(200);
  s = await snap();
  check('Restart Flow returns to step 1', s.step === 0, `step=${s.step}`);
  const tokenAfter = await page.evaluate(() => sim.tokens.accessToken);
  check('Restart Flow regenerates the access token', tokenAfter.startsWith('eyJ') && tokenAfter !== tokenBefore, tokenAfter.slice(0, 30));
  check('Restart Flow: vault correctly empty at step 1', s.access.includes('not issued yet'), s.access);

  // 5. Reset button (newly wired) restores the initial state
  await next(2);
  await click('#resetFlowBtn');
  await sleep(200);
  s = await snap();
  check('Reset restores UNAUTHENTICATED', s.session === 'UNAUTHENTICATED', s.session);
  check('Reset returns to step 0 / -1', s.step === -1 && s.progress.includes('Step 0 of 5'), s.progress);
  check('Reset clears the vault', s.access.includes('not issued yet') && s.ttl === 'TTL: --');
  check('Reset logs the reset', s.log.includes('Flow state reset'), s.log.slice(-120));

  // 6. Auto Flow completes on its own
  await click('#autoPlayBtn');
  await sleep(500);
  s = await snap();
  check('Auto Flow starts (label becomes Pause)', s.autoLabel === 'Pause', s.autoLabel);
  const autoDone = await page.waitForFunction(
    () => document.getElementById('sessionText').textContent === 'AUTHENTICATED'
      && document.getElementById('autoPlayLabel').textContent === 'Auto Flow',
    { timeout: 15000 },
  ).then(() => true).catch(() => false);
  check('Auto Flow completes to AUTHENTICATED', autoDone);
  s = await snap();
  check('Auto Flow ends at step 5', s.step === 4, `step=${s.step}`);
  const toastText = await page.evaluate(() => document.getElementById('toastBox').textContent);
  check('Auto Flow completion toasted', toastText.includes('OAuth 2.0 Flow Completed'), toastText);
  await click('#resetFlowBtn');
  await sleep(200);

  // 7. PKCE toggle changes the vault + payload
  await setChecked('#pkceToggle', false);
  await sleep(200);
  s = await snap();
  check('PKCE off: vault shows DISABLED', s.pkce === 'DISABLED', s.pkce);
  check('PKCE off: verifier shows <disabled>', s.verifier === '<disabled>', s.verifier);
  await next(1);
  s = await snap();
  check('PKCE off: step 1 payload warns, no challenge', s.payload.includes('WARNING: PKCE disabled') && !s.payload.includes('code_challenge        ='), s.payload.slice(0, 200));
  await setChecked('#pkceToggle', true);
  await sleep(200);
  s = await snap();
  check('PKCE back on: vault ENABLED', s.pkce === 'ENABLED (S256)', s.pkce);
  await click('#resetFlowBtn');
  await sleep(200);

  // 8. Attack simulation, PKCE ON: step 3 is blocked (banner + payload agree)
  await setChecked('#attackSimToggle', true);
  await sleep(150);
  s = await snap();
  check('attack armed', s.attackChecked, `attack=${s.attackChecked}`);
  await next(3);
  s = await snap();
  check('attack+PKCE step 3: banner shows 400 invalid_grant', s.stepHttp.includes('400 Bad Request') && s.stepHttp.includes('invalid_grant'), s.stepHttp);
  check('attack+PKCE step 3: banner desc shows interception blocked', s.stepDesc.includes('Interception blocked'), s.stepDesc);
  check('attack+PKCE step 3: payload shows invalid_grant', s.payload.includes('"error": "invalid_grant"'), s.payload.slice(0, 200));
  check('attack+PKCE step 3: log shows PKCE PROTECTED', s.log.includes('PKCE PROTECTED'), s.log.slice(-200));
  check('attack+PKCE step 3: no token issued', s.access.includes('not issued yet') && s.session === 'HANDSHAKE IN PROGRESS');
  await page.screenshot({ path: `${SHOTS}/03-attack-blocked.png` });
  await click('#resetFlowBtn');
  await sleep(200);

  // 9. Attack simulation, PKCE OFF: the interception succeeds
  await setChecked('#pkceToggle', false);
  await sleep(150);
  await next(3);
  s = await snap();
  check('attack, no PKCE: banner shows POST (exchange proceeds)', s.stepHttp.includes('POST /oauth/token'), s.stepHttp);
  check('attack, no PKCE: banner desc shows interception', s.stepDesc.includes('ATTACKER INTERCEPTED'), s.stepDesc);
  check('attack, no PKCE: log shows SECURITY WARNING', s.log.includes('SECURITY WARNING'), s.log.slice(-200));
  check('attack, no PKCE: payload has no invalid_grant', !s.payload.includes('invalid_grant'), s.payload.slice(0, 120));
  await setChecked('#pkceToggle', true);
  await setChecked('#attackSimToggle', false);
  await click('#resetFlowBtn');
  await sleep(200);

  // 10. Client Credentials flow: token issued at step 2 (index 1), TTL 900s
  await clickFlow('client_credentials');
  await sleep(200);
  s = await snap();
  check('client_credentials selected', s.flow === 'client_credentials' && s.flowBadge === 'Client Credentials', s.flowBadge);
  await next(1);
  s = await snap();
  check('client_credentials step 1: still no token', s.step === 0 && s.access.includes('not issued yet'));
  await next(1);
  s = await snap();
  check('client_credentials step 2: AUTHENTICATED already', s.step === 1 && s.session === 'AUTHENTICATED', `${s.step} / ${s.session}`);
  check('client_credentials step 2: TTL 900s', s.ttl === 'TTL: 900s', s.ttl);
  check('client_credentials: refresh token omitted', s.refresh.includes('omitted for client_credentials'), s.refresh);
  check('client_credentials step 2 payload has access_token', s.payload.includes('"access_token"'), s.payload.slice(0, 120));
  await page.screenshot({ path: `${SHOTS}/04-client-credentials.png` });
  await next(3);
  s = await snap();
  check('client_credentials completes at step 5', s.step === 4, `step=${s.step}`);

  // 11. Refresh Token flow: token issued at step 3 (index 2)
  await clickFlow('refresh_token');
  await sleep(200);
  await next(2);
  s = await snap();
  check('refresh_token step 2: not yet authenticated', s.step === 1 && s.session === 'HANDSHAKE IN PROGRESS', `${s.step} / ${s.session}`);
  await next(1);
  s = await snap();
  check('refresh_token step 3: AUTHENTICATED, rotated pair', s.step === 2 && s.session === 'AUTHENTICATED' && s.refresh.startsWith('rt_'), `${s.step} / ${s.session} / ${s.refresh.slice(0, 8)}`);
  check('refresh_token step 3: TTL 3600s', s.ttl === 'TTL: 3600s', s.ttl);
  await next(2);
  s = await snap();
  check('refresh_token completes at step 5', s.step === 4, `step=${s.step}`);

  // 12. Device Code flow: full 5 steps
  await clickFlow('device_code');
  await sleep(200);
  s = await snap();
  check('device_code selected', s.flow === 'device_code' && s.flowBadge === 'Device Grant (RFC 8628)', s.flowBadge);
  await next(3);
  s = await snap();
  check('device_code step 3: polling, not yet authenticated', s.step === 2 && s.session === 'HANDSHAKE IN PROGRESS', `${s.step} / ${s.session}`);
  check('device_code step 3 payload is authorization_pending', s.payload.includes('authorization_pending'), s.payload.slice(0, 120));
  await next(1);
  s = await snap();
  check('device_code step 4: tokens issued, AUTHENTICATED', s.step === 3 && s.session === 'AUTHENTICATED', `${s.step} / ${s.session}`);
  check('device_code step 4 payload has tokens', s.payload.includes('"access_token"'), s.payload.slice(0, 100));
  await next(1);
  s = await snap();
  check('device_code step 5: AUTHENTICATED', s.step === 4 && s.session === 'AUTHENTICATED', `${s.step} / ${s.session}`);
  check('device_code step 5 payload is the stream call', s.payload.includes('/v1/media/stream'), s.payload.slice(0, 80));

  // 13. Scope change updates the wire payload
  await clickFlow('auth_code');
  await sleep(200);
  await setChecked('.scope-cb[value="openid"]', false);
  await setChecked('.scope-cb[value="profile"]', false);
  await setChecked('.scope-cb[value="email"]', true);
  await setChecked('.scope-cb[value="api:read"]', true);
  await sleep(200);
  await next(1);
  s = await snap();
  check('scope change: payload shows email api:read', s.payload.includes('scope         = "email api:read"'), s.payload.slice(0, 300));
  await setChecked('.scope-cb[value="openid"]', true);
  await setChecked('.scope-cb[value="profile"]', true);
  await setChecked('.scope-cb[value="email"]', false);
  await setChecked('.scope-cb[value="api:read"]', false);

  // 14. Log cap: flood logProtocol, oldest lines must drop off at 150
  const logCount = await page.evaluate(() => {
    for (let i = 0; i < 160; i++) logProtocol('cap-test ' + i, 'info');
    return document.getElementById('protocolLog').children.length;
  });
  check('protocol log capped at 150 lines', logCount === 150, `children=${logCount}`);
  await click('#clearLogsBtn');
  await sleep(200);
  s = await snap();
  check('Clear empties the log', s.logCount === 0, `children=${s.logCount}`);

  // 15. No page JS errors (CDN request failures are environmental, listed separately)
  check('no page JS errors', pageErrors.length === 0, pageErrors.join(' | '));
  const nonCdnFailures = failedRequests.filter(
    (u) => !u.includes('tailwindcss') && !u.includes('googleapis') && !u.includes('gstatic') && !u.includes('cdnjs'),
  );
  check('no non-CDN failed requests', nonCdnFailures.length === 0, nonCdnFailures.join(' | '));
  console.log('CDN requests that failed headless (expected, no network to CDNs):');
  failedRequests.forEach((u) => console.log('  - ' + u));

  await browser.close();
  console.log(failures === 0 ? `\nALL ${checks} CHECKS PASSED` : `\n${failures} OF ${checks} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('PLAYTEST CRASHED:', e);
  process.exit(2);
});
