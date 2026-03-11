import process from "node:process";

const url = process.argv[2];

if (!url) {
  throw new Error("Usage: node inspect-thread.mjs <reddit-thread-url>");
}

async function fetchJson(jsonUrl) {
  const response = await fetch(jsonUrl, {
    headers: {
      "user-agent": "pinyinka-ops/1.0",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${jsonUrl}`);
  }

  return response.json();
}

const jsonUrl = url.endsWith(".json") ? url : `${url.replace(/\/$/, "")}.json`;
const payload = await fetchJson(jsonUrl);
const post = payload?.[0]?.data?.children?.[0]?.data;
const comments = payload?.[1]?.data?.children ?? [];

console.log(`# ${post?.title ?? "Unknown thread"}`);
console.log("");
if (post?.selftext) {
  console.log(post.selftext.trim());
  console.log("");
}

console.log("Top comments:");
for (const child of comments.slice(0, 5)) {
  if (child?.kind !== "t1") {
    continue;
  }

  const data = child.data;
  console.log(`- ${data.author} (${data.score}): ${String(data.body ?? "").replace(/\s+/g, " ").slice(0, 220)}`);
}
