import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { firefox } from "playwright";

const TARGETS = [
  { subreddit: "ChineseLanguage", query: "app OR website pinyin hanzi", window: "month" },
  { subreddit: "ChineseLanguage", query: "flashcard app", window: "month" },
  { subreddit: "ChineseLanguage", query: "\"learn chinese\" app", window: "month" },
  { subreddit: "languagelearning", query: "\"Chinese\" app", window: "week" },
  { subreddit: "languagelearning", query: "\"Chinese\" resource", window: "week" },
  { subreddit: "ChineseLanguage", query: "resource", window: "week" },
];

const POSITIVE_PATTERNS = [
  /app/i,
  /resource/i,
  /tool/i,
  /website/i,
  /flashcard/i,
  /practice/i,
  /hanzi/i,
  /pinyin/i,
  /dictation/i,
  /recommend/i,
  /\?/,
];

const NEGATIVE_PATTERNS = [
  /translate/i,
  /tattoo/i,
  /name help/i,
];

function scorePost(post) {
  let score = 0;

  for (const pattern of POSITIVE_PATTERNS) {
    if (pattern.test(post.title)) {
      score += 2;
    }
  }

  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(post.title)) {
      score -= 4;
    }
  }

  if (post.num_comments <= 30) {
    score += 2;
  }

  if (post.num_comments === 0) {
    score += 1;
  }

  const ageHours = (Date.now() / 1000 - post.created_utc) / 3600;
  if (ageHours <= 24) {
    score += 3;
  } else if (ageHours <= 72) {
    score += 2;
  } else if (ageHours <= 168) {
    score += 1;
  }

  return score;
}

function toCandidate(post, queryMeta) {
  const permalink = `https://www.reddit.com${post.permalink}`;
  return {
    subreddit: post.subreddit,
    query: queryMeta.query,
    title: post.title,
    permalink,
    created_utc: post.created_utc,
    created_at: new Date(post.created_utc * 1000).toISOString(),
    num_comments: post.num_comments,
    author: post.author,
    score: scorePost(post),
  };
}

async function ensureLoggedIn(page, username, password) {
  await page.goto("https://www.reddit.com/login/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const usernameInput = page.locator('input[name="username"]').first();
  if (!(await usernameInput.count())) {
    return;
  }

  await usernameInput.fill(username);
  await page.locator('input[name="password"]').first().fill(password);
  await page.locator("button.login").first().click();
  await page.waitForTimeout(4000);
}

async function fetchCandidatesWithBrowser(targets, deduped) {
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;

  if (!username || !password) {
    throw new Error("Missing REDDIT_USERNAME or REDDIT_PASSWORD for browser-based Reddit search");
  }

  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, username, password);

    for (const target of targets) {
      const url = new URL(`https://old.reddit.com/r/${target.subreddit}/search/`);
      url.searchParams.set("q", target.query);
      url.searchParams.set("restrict_sr", "on");
      url.searchParams.set("sort", "new");
      url.searchParams.set("t", target.window);

      await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);

      const posts = await page.locator(".search-result").evaluateAll((nodes) =>
        nodes.map((node) => {
          const titleEl = node.querySelector(".search-title");
          const commentsEl = node.querySelector(".search-comments");
          const commentsText = commentsEl?.textContent?.trim() ?? "0 comments";
          const commentsMatch = commentsText.match(/(\d+)/);
          const timeEl = node.querySelector("time");

          return {
            subreddit: node.querySelector(".search-subreddit-link")?.textContent?.replace(/^r\//, "").trim() ?? "",
            permalink: commentsEl?.getAttribute("href") ?? titleEl?.getAttribute("href") ?? "",
            title: titleEl?.textContent?.trim() ?? "",
            created_utc: timeEl?.getAttribute("datetime")
              ? Math.floor(new Date(timeEl.getAttribute("datetime")).getTime() / 1000)
              : Math.floor(Date.now() / 1000),
            num_comments: commentsMatch ? Number(commentsMatch[1]) : 0,
            author:
              node.querySelector(".author")?.textContent?.trim() ??
              node.querySelector(".search-author .author")?.textContent?.trim() ??
              "",
          };
        }),
      );

      for (const post of posts) {
        if (!post?.permalink || !post?.title) {
          continue;
        }

        const normalized = post.permalink.startsWith("http")
          ? post.permalink
          : `https://www.reddit.com${post.permalink}`;
        const candidate = {
          subreddit: post.subreddit || target.subreddit,
          query: target.query,
          title: post.title,
          permalink: normalized,
          created_utc: post.created_utc,
          created_at: new Date(post.created_utc * 1000).toISOString(),
          num_comments: post.num_comments,
          author: post.author,
          score: scorePost(post),
        };

        const existing = deduped.get(candidate.permalink);
        if (!existing || candidate.score > existing.score) {
          deduped.set(candidate.permalink, candidate);
        }
      }
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const outDir = path.resolve("out");
  await fs.mkdir(outDir, { recursive: true });

  const deduped = new Map();

  try {
    await fetchCandidatesWithBrowser(TARGETS, deduped);
  } catch (error) {
    console.error(String(error));
  }

  const candidates = [...deduped.values()]
    .filter((item) => item.score >= 4)
    .sort((a, b) => b.score - a.score || b.created_utc - a.created_utc)
    .slice(0, 20);

  const markdown = [
    "# Reddit Opportunity Queue",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
  ];

  for (const item of candidates) {
    markdown.push(`## [${item.title}](${item.permalink})`);
    markdown.push(`- subreddit: r/${item.subreddit}`);
    markdown.push(`- score: ${item.score}`);
    markdown.push(`- comments: ${item.num_comments}`);
    markdown.push(`- created: ${item.created_at}`);
    markdown.push(`- matched query: ${item.query}`);
    markdown.push("");
  }

  await fs.writeFile(path.join(outDir, "opportunities.json"), `${JSON.stringify(candidates, null, 2)}\n`);
  await fs.writeFile(path.join(outDir, "opportunities.md"), `${markdown.join("\n")}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
