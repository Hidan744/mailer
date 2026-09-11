const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();
  const htmlPath = path.join(__dirname, "instruction.html");
  await page.goto("file://" + htmlPath);
  await page.pdf({
    path: path.join(__dirname, "..", "INSTRUCTION.pdf"),
    format: "A4",
    printBackground: true,
  });
  await browser.close();
  console.log("PDF готов");
})();
