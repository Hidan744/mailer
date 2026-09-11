const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();
  await page.goto("file://" + path.join(__dirname, "next_steps.html"));
  await page.pdf({ path: path.join(__dirname, "..", "NEXT_STEPS.pdf"), format: "A4", printBackground: true });
  await browser.close();
  console.log("PDF готов");
})();
