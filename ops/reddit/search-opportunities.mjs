import fs from "node:fs/promises";
import path from "node:path";

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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "pinyinka-ops/1.0",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }

  return response.json();
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

async function main() {
  const outDir = path.resolve("out");
  await fs.mkdir(outDir, { recursive: true });

  const deduped = new Map();

  for (const target of TARGETS) {
    const url = new URL(`https://www.reddit.com/r/${target.subreddit}/search.json`);
    url.searchParams.set("q", target.query);
    url.searchParams.set("restrict_sr", "on");
    url.searchParams.set("sort", "new");
    url.searchParams.set("t", target.window);
    url.searchParams.set("limit", "12");

    try {
      const payload = await fetchJson(url);
      const children = payload?.data?.children ?? [];

      for (const child of children) {
        const post = child?.data;
        if (!post?.permalink || !post?.title) {
          continue;
        }

        const candidate = toCandidate(post, target);
        const existing = deduped.get(candidate.permalink);
        if (!existing || candidate.score > existing.score) {
          deduped.set(candidate.permalink, candidate);
        }
      }
    } catch (error) {
      console.error(String(error));
    }
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

