import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium, firefox, webkit } from "playwright";

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function toOldRedditUrl(inputUrl) {
  const url = new URL(inputUrl);
  url.hostname = "old.reddit.com";
  return url.toString();
}

async function ensureLoggedIn(page, username, password) {
  await page.goto("https://old.reddit.com/login/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  const usernameInput = page.locator('input[name="user"]').first();
  if (await usernameInput.count()) {
    await usernameInput.fill(username);
    await page.locator('input[name="passwd"]').first().fill(password);
    await page.locator('button[type="submit"], input[type="submit"]').first().click();
    await page.waitForTimeout(3500);
  }
}

async function lookupLatestComment(username, replyText) {
  const response = await fetch(`https://www.reddit.com/user/${username}/comments.json?limit=10`, {
    headers: {
      "user-agent": "pinyinka-ops/1.0",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const children = payload?.data?.children ?? [];
  const needle = replyText.replace(/\s+/g, " ").slice(0, 80);

  for (const child of children) {
    const data = child?.data;
    const body = String(data?.body ?? "").replace(/\s+/g, " ");
    if (body.startsWith(needle.slice(0, 40))) {
      return `https://www.reddit.com${data.permalink}`;
    }
  }

  return null;
}

async function main() {
  const url = getArg("--url");
  const textFile = getArg("--text-file");
  const browserName = getArg("--browser") ?? "firefox";

  if (!url || !textFile) {
    throw new Error("Usage: node post-reply.mjs --url <reddit-url> --text-file <path> [--browser firefox]");
  }

  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;
  if (!username || !password) {
    throw new Error("Missing REDDIT_USERNAME or REDDIT_PASSWORD");
  }

  const replyText = (await fs.readFile(path.resolve(textFile), "utf8")).trim();
  if (!replyText) {
    throw new Error("Reply text file is empty");
  }

  const browserType = { chromium, firefox, webkit }[browserName];
  if (!browserType) {
    throw new Error(`Unsupported browser: ${browserName}`);
  }

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, username, password);
    await page.goto(toOldRedditUrl(url), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const textArea = page.locator('form.usertext textarea, textarea[name="text"]').first();
    await textArea.waitFor({ state: "visible", timeout: 15000 });

    await textArea.fill(replyText);

    const submitButton = page.locator('form.usertext button[type="submit"], form.usertext input[type="submit"]').first();
    await submitButton.waitFor({ state: "visible", timeout: 15000 });

    await submitButton.click();
    await page.waitForTimeout(3500);

    console.log(`POSTED ${url}`);
    const permalink = await lookupLatestComment(username, replyText);
    if (permalink) {
      console.log(`COMMENT_URL ${permalink}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
