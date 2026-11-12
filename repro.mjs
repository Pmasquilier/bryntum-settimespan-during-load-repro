// Runs the plain case and the workaround case N times each, in a fresh page each.
//
//   npm run dev        # in one terminal
//   REPRO_RUNS=10 npm run repro   # in another
import { chromium } from 'playwright-core';

const URL = process.env.REPRO_URL ?? 'http://localhost:5192/';
const RUNS = Number(process.env.REPRO_RUNS ?? 10);

const browser = await chromium.launch();
const failures = { plain: 0, workaround: 0 };
let sample;

for (const mode of ['plain', 'workaround']) {
    for (let i = 0; i < RUNS; i++) {
        const page = await browser.newPage({ viewport : { width : 1280, height : 760 } });
        await page.goto(URL);
        await page.locator('.b-sch-event-wrap').first().waitFor({ timeout : 60_000 });
        await page.waitForTimeout(800);
        const result = await page.evaluate(useWorkaround => window.run(useWorkaround), mode === 'workaround');
        if (!result.fired) {
            console.log(`${mode} #${i + 1}: window never opened (invalid run)`);
        }
        if (result.errors.length) {
            failures[mode]++;
            sample ??= result.errors[0];
        }
        await page.close();
    }
    console.log(`${mode}: ${failures[mode]}/${RUNS} runs threw`);
}
if (sample) {
    console.log(`\nfirst stack:\n${sample}`);
}
await browser.close();
process.exit(failures.plain > 0 && failures.workaround === 0 ? 0 : 1);
