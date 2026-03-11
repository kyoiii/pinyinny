import fs from "node:fs/promises";
import path from "node:path";

const TRACKED_PATH = path.resolve("tracked-comments.json");
const STATE_PATH = path.resolve("state", "seen-replies.json");

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

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function walkReplies(node, bucket) {
  if (!node?.kind || !node?.data) {
    return;
  }

  if (node.kind === "t1") {
    bucket.push(node.data);
  }

  const children = node?.data?.replies?.data?.children ?? [];
  for (const child of children) {
    walkReplies(child, bucket);
  }
}

async function main() {
  const outDir = path.resolve("out");
  const stateDir = path.resolve("state");
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });

  const tracked = await readJson(TRACKED_PATH, []);
  const seenReplies = await readJson(STATE_PATH, {});
  const report = [];

  for (const item of tracked) {
    const jsonUrl = item.url.endsWith(".json") ? item.url : `${item.url}.json`;
    try {
      const payload = await fetchJson(jsonUrl);
      const listing = payload?.[1]?.data?.children ?? [];
      const replies = [];

      for (const child of listing) {
        walkReplies(child, replies);
      }

      const newReplies = [];
      for (const reply of replies) {
        if (reply.author === item.username) {
          continue;
        }

        if (!seenReplies[reply.name]) {
          newReplies.push({
            id: reply.name,
            author: reply.author,
            body: reply.body,
            permalink: `https://www.reddit.com${reply.permalink}`,
            created_at: new Date(reply.created_utc * 1000).toISOString(),
            score: reply.score,
          });
          seenReplies[reply.name] = true;
        }
      }

      report.push({
        label: item.label,
        url: item.url,
        new_reply_count: newReplies.length,
        new_replies: newReplies,
      });
    } catch (error) {
      report.push({
        label: item.label,
        url: item.url,
        error: String(error),
      });
    }
  }

  const markdown = [
    "# Reddit Feedback Snapshot",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
  ];

  for (const item of report) {
    markdown.push(`## ${item.label}`);
    markdown.push(`- url: ${item.url}`);
    if (item.error) {
      markdown.push(`- error: ${item.error}`);
      markdown.push("");
      continue;
    }

    markdown.push(`- new replies: ${item.new_reply_count}`);
    for (const reply of item.new_replies) {
      markdown.push(`- ${reply.author}: ${reply.body.replace(/\s+/g, " ").slice(0, 160)}`);
      markdown.push(`  ${reply.permalink}`);
    }
    markdown.push("");
  }

  await fs.writeFile(path.join(outDir, "feedback.json"), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(outDir, "feedback.md"), `${markdown.join("\n")}\n`);
  await fs.writeFile(STATE_PATH, `${JSON.stringify(seenReplies, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

