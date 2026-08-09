import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const username = process.env.GITHUB_STATS_USERNAME || "amu815";
const token = process.env.PAT_1;
const legacyDir = path.resolve(
  process.env.GITHUB_STATS_LEGACY_DIR || ".github-readme-stats-legacy",
);
const outputPath = path.resolve(
  process.env.GITHUB_STATS_OUTPUT || "assets/github-stats.svg",
);

if (!token) {
  throw new Error("PAT_1 is required to generate GitHub stats.");
}

const importFromLegacy = (relativePath) =>
  import(pathToFileURL(path.join(legacyDir, relativePath)).href);

const { fetchStats } = await importFromLegacy("src/fetchers/stats-fetcher.js");
const { calculateRank } = await importFromLegacy("src/calculateRank.js");
const { renderStatsCard } = await importFromLegacy("src/cards/stats-card.js");

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

const stats = await fetchStats(username, false, false, []);

const commitsResponse = await fetch(
  `https://api.github.com/search/commits?per_page=1&q=${encodeURIComponent(
    `author:${username}`,
  )}`,
  { headers },
);
if (!commitsResponse.ok) {
  throw new Error(
    `Could not fetch total commits: ${commitsResponse.status} ${commitsResponse.statusText}`,
  );
}
const commits = await commitsResponse.json();
if (!Number.isInteger(commits.total_count)) {
  throw new Error("GitHub returned an invalid total commit count.");
}

const metadataResponse = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `
      query userMetadata($login: String!) {
        user(login: $login) {
          followers { totalCount }
          repositories(ownerAffiliations: OWNER) { totalCount }
        }
      }
    `,
    variables: { login: username },
  }),
});
if (!metadataResponse.ok) {
  throw new Error(
    `Could not fetch user metadata: ${metadataResponse.status} ${metadataResponse.statusText}`,
  );
}
const metadata = await metadataResponse.json();
if (metadata.errors?.length || !metadata.data?.user) {
  throw new Error(
    `GitHub returned invalid user metadata: ${metadata.errors?.[0]?.message || "user not found"}`,
  );
}

stats.totalCommits = commits.total_count;
stats.rank = calculateRank({
  totalCommits: stats.totalCommits,
  totalRepos: metadata.data.user.repositories.totalCount,
  followers: metadata.data.user.followers.totalCount,
  contributions: stats.contributedTo,
  stargazers: stats.totalStars,
  prs: stats.totalPRs,
  issues: stats.totalIssues,
});

let svg = renderStatsCard(stats, {
  hide: [],
  show_icons: true,
  hide_border: true,
  include_all_commits: true,
  theme: "tokyonight",
  border_radius: 20,
});

// The pinned renderer reports the star count as the commit count only in its
// accessibility description. Keep the visible card and its description aligned.
svg = svg.replace(
  /Total Commits\s*: \d+/,
  `Total Commits: ${stats.totalCommits}`,
);
svg = `${svg.replace(/[ \t]+$/gm, "").trim()}\n`;

if (
  svg.includes("Something went wrong") ||
  !svg.includes(`Rank: ${stats.rank.level}`) ||
  !svg.includes(`Total Commits: ${stats.totalCommits}`)
) {
  throw new Error("The generated stats card failed validation.");
}

const temporaryPath = `${outputPath}.tmp`;
await writeFile(temporaryPath, svg, "utf8");
await rename(temporaryPath, outputPath);

console.log(
  `Generated ${path.relative(process.cwd(), outputPath)} with ${stats.totalCommits} commits and rank ${stats.rank.level}.`,
);
