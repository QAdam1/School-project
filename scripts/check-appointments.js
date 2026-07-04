// Maccabi appointment availability checker.
// Reads credentials from env (MACCABI_ID / MACCABI_PASSWORD) so they never
// appear in source, logs, or command-line args.
//
// NOTE: everything past login is written from a verbal description of the
// flow, not from inspecting the real DOM (it's behind auth). Selectors are
// grouped in SELECTORS below specifically so they're easy to correct after
// a real run. Screenshots are taken after every step and uploaded as a CI
// artifact for that reason.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MACCABI_ID = process.env.MACCABI_ID;
const MACCABI_PASSWORD = process.env.MACCABI_PASSWORD;
const TARGET_DATE = process.env.TARGET_DATE; // 'YYYY-MM-DD', required
const EXCLUDE_DOCTOR = process.env.EXCLUDE_DOCTOR || 'שם טוב יוסף';

if (!MACCABI_ID || !MACCABI_PASSWORD) {
  console.error('Missing MACCABI_ID / MACCABI_PASSWORD env vars.');
  process.exit(1);
}
if (!TARGET_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(TARGET_DATE)) {
  console.error('TARGET_DATE env var must be set as YYYY-MM-DD.');
  process.exit(1);
}

const ARTIFACTS_DIR = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

// Best-guess selectors for the post-login flow (unverifiable from here).
// Update these based on the first real run's screenshots/HTML dumps.
const SELECTORS = {
  loginIdInput: ['#username', 'input[name="username"]', 'input[name="id"]'],
  nextButton: ['button:has-text("הבא")', 'button:has-text("המשך")'],
  passwordLoginLink: [
    'text=כניסה עם סיסמה',
    'text=היכנס עם סיסמה',
    'text=התחברות עם סיסמה',
  ],
  passwordInput: ['#password', 'input[name="password"]', 'input[type="password"]'],
  searchHealthServices: 'text=חיפוש ואיתור שירותי בריאות',
  doctorsOption: 'text=רופאים/ות',
  treatmentFieldLabel: 'תחום טיפול',
  treatmentValue: 'אף אוזן וגרון',
  addressFieldLabel: 'כתובת',
  addressValue: 'רחוב טשרניחובסקי 55, תל אביב יפו',
  sortButton: 'text=מיון',
  nearestAppointmentOption: 'text=תור פנוי קרוב',
};

let stepCount = 0;
async function step(page, name, fn) {
  stepCount += 1;
  const label = `${String(stepCount).padStart(2, '0')}-${name.replace(/\s+/g, '_')}`;
  console.log(`[STEP ${stepCount}] ${name}`);
  try {
    const result = await fn();
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${label}.png`), fullPage: true }).catch(() => {});
    return result;
  } catch (err) {
    console.error(`[STEP ${stepCount} FAILED] ${name}: ${err.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${label}-ERROR.png`), fullPage: true }).catch(() => {});
    await page
      .content()
      .then((html) => fs.writeFileSync(path.join(ARTIFACTS_DIR, `${label}-ERROR.html`), html))
      .catch(() => {});
    throw err;
  }
}

async function clickFirstMatch(page, candidates, description) {
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
      await locator.click();
      return;
    }
  }
  throw new Error(`None of the candidate selectors matched for ${description}: ${candidates.join(' | ')}`);
}

async function fillFirstMatch(page, candidates, value, description) {
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
      await locator.fill(value);
      return;
    }
  }
  throw new Error(`None of the candidate selectors matched for ${description}: ${candidates.join(' | ')}`);
}

function parseIsraeliDate(text) {
  const match = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const page = await context.newPage();

  try {
    await step(page, 'Navigate to login page', () =>
      page.goto('https://mac.maccabi4u.co.il/login', { waitUntil: 'networkidle', timeout: 30000 })
    );

    await step(page, 'Fill ID (first screen)', () =>
      fillFirstMatch(page, SELECTORS.loginIdInput, MACCABI_ID, 'login ID field')
    );

    await step(page, 'Click next (first screen)', () =>
      clickFirstMatch(page, SELECTORS.nextButton, 'first "next" button')
    );

    await step(page, 'Click "sign in with password"', () =>
      clickFirstMatch(page, SELECTORS.passwordLoginLink, 'sign-in-with-password link')
    );

    await step(page, 'Fill ID (second screen)', () =>
      fillFirstMatch(page, SELECTORS.loginIdInput, MACCABI_ID, 'login ID field (second screen)')
    );

    await step(page, 'Fill password', () =>
      fillFirstMatch(page, SELECTORS.passwordInput, MACCABI_PASSWORD, 'password field')
    );

    await step(page, 'Click next (submit login)', () =>
      clickFirstMatch(page, SELECTORS.nextButton, 'second "next" button')
    );

    await step(page, 'Wait for post-login load', () =>
      page.waitForLoadState('networkidle', { timeout: 30000 })
    );

    await step(page, 'Navigate to appointment page', () =>
      page.goto('https://online.maccabi4u.co.il/sonline/appointmentOrder/NewAppointment/?relative=-1', {
        waitUntil: 'networkidle',
        timeout: 30000,
      })
    );

    await step(page, 'Wait for appointment page load', () =>
      page.waitForLoadState('networkidle', { timeout: 30000 })
    );

    await step(page, 'Click "חיפוש ואיתור שירותי בריאות"', () =>
      page.locator(SELECTORS.searchHealthServices).first().click()
    );

    await step(page, 'Click "רופאים/ות"', () => page.locator(SELECTORS.doctorsOption).first().click());

    await step(page, 'Fill "תחום טיפול"', async () => {
      const field = page.getByLabel(SELECTORS.treatmentFieldLabel).first();
      await field.click();
      await field.fill(SELECTORS.treatmentValue);
      await page.getByText(SELECTORS.treatmentValue, { exact: false }).last().click();
    });

    await step(page, 'Fill "כתובת"', async () => {
      const field = page.getByLabel(SELECTORS.addressFieldLabel).first();
      await field.click();
      await field.fill(SELECTORS.addressValue);
      await page.getByText(SELECTORS.addressValue, { exact: false }).last().click();
    });

    await step(page, 'Click next (search form)', () =>
      clickFirstMatch(page, SELECTORS.nextButton, '"next" button on search form')
    );

    await step(page, 'Click "מיון"', () => page.locator(SELECTORS.sortButton).first().click());

    await step(page, 'Choose "תור פנוי קרוב"', () =>
      page.locator(SELECTORS.nearestAppointmentOption).first().click()
    );

    await step(page, 'Wait for results to load', () =>
      page.waitForLoadState('networkidle', { timeout: 30000 })
    );

    const resultsText = await step(page, 'Capture results text', () => page.locator('body').innerText());
    fs.writeFileSync(path.join(ARTIFACTS_DIR, 'results-raw.txt'), resultsText);

    const targetDate = new Date(TARGET_DATE);
    const lines = resultsText.split('\n').map((l) => l.trim()).filter(Boolean);
    const matches = [];
    for (const line of lines) {
      const date = parseIsraeliDate(line);
      if (!date) continue;
      if (date > targetDate) continue;
      if (line.includes(EXCLUDE_DOCTOR)) continue;
      matches.push(line);
    }

    const summary =
      matches.length > 0
        ? `Found ${matches.length} candidate slot(s) on/before ${TARGET_DATE} (excluding "${EXCLUDE_DOCTOR}"):\n${matches.join('\n')}`
        : `No slots found on/before ${TARGET_DATE} (excluding "${EXCLUDE_DOCTOR}"). See results-raw.txt to confirm parsing matched the real layout.`;

    console.log('\n=== SUMMARY ===');
    console.log(summary);

    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## Appointment check result\n\n\`\`\`\n${summary}\n\`\`\`\n`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Flow failed:', err.message);
  process.exit(1);
});
