import process from "node:process";

const username = process.argv[2];

if (!username) {
  throw new Error("Usage: node profile-comments.mjs <reddit-username>");
}

const response = await fetch(`https://www.reddit.com/user/${username}/comments.json?limit=10`, {
  headers: {
    "user-agent": "pinyinka-ops/1.0",
    accept: "application/json",
  },
});

if (!response.ok) {
  throw new Error(`Request failed ${response.status}`);
}

const payload = await response.json();
const comments = payload?.data?.children ?? [];

for (const child of comments) {
  const data = child?.data;
  console.log(`URL https://www.reddit.com${data.permalink}`);
  console.log(`SUBREDDIT ${data.subreddit}`);
  console.log(`BODY ${String(data.body ?? "").replace(/\s+/g, " ").slice(0, 220)}`);
  console.log("---");
}
