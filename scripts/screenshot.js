// Usage: npm run screenshots
// PRELAUNCH_URL (default http://localhost:3000) = site with no mint set
// LIVE_URL (default http://localhost:3001) = site with a launched coin (e.g. .env.ansemmas.example)
// Uses playwright-core with system Chrome (CHROME_PATH or /usr/bin/google-chrome).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const PRE = process.env.PRELAUNCH_URL || 'http://localhost:3000';
const LIVE = process.env.LIVE_URL || 'http://localhost:3001';
const ADMIN = process.env.ADMIN_TOKEN || 'local-dev-admin-change-me';
const SAMPLE = process.env.SAMPLE_IMAGE || '/tmp/community.png';
const out = new URL('../screenshots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const shot = async (page, name) => { await page.waitForTimeout(900); await page.screenshot({ path: out + name, fullPage: true }); console.log(out + name); };
const desk = await browser.newPage({ viewport: { width: 1280, height: 860 } });

await desk.goto(PRE + '/'); await desk.waitForSelector('.prelaunch'); await shot(desk, 'home-prelaunch.png');
await desk.goto(PRE + '/#/vote'); await desk.waitForSelector('.prelaunch'); await shot(desk, 'vote-prelaunch.png');

await desk.goto(LIVE + '/'); await desk.waitForSelector('.stat'); await desk.waitForSelector('#ads .tile'); await shot(desk, 'home.png');
await desk.goto(LIVE + '/#/vote'); await desk.waitForSelector('.cand'); await shot(desk, 'vote.png');
await desk.goto(LIVE + '/#/designs'); await desk.waitForSelector('#df'); await shot(desk, 'designs.png');
await desk.setInputFiles('#df input[type=file]', SAMPLE);
await desk.fill('#df input[name=title]', 'Ho Ho Hold (snow edition)'); await desk.fill('#df input[name=x_handle]', '@santa_degen');
await desk.click('#dsub'); await desk.waitForSelector('a.btn.x'); await shot(desk, 'designs-submitted.png');
const designHref = await desk.getAttribute('a.btn[href^="/design/"]', 'href');
await desk.goto(LIVE + designHref); await desk.waitForSelector('.design-hero img'); await shot(desk, 'design-page.png');
await desk.goto(LIVE + '/#/admin'); await desk.fill('#tok', ADMIN); await desk.click('#login'); await desk.waitForSelector('#sf'); await shot(desk, 'admin.png');

const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
await mob.goto(LIVE + '/'); await mob.waitForSelector('#ads .tile'); await shot(mob, 'home-mobile.png');
await mob.goto(LIVE + '/#/vote'); await mob.waitForSelector('.cand'); await shot(mob, 'vote-mobile.png');
await browser.close();
