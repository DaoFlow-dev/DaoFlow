import { isSafeRepositoryLink } from "./repository-paths.mjs";

export async function validatePublicLinks({ rootDir, sourcePath, marker, errors }) {
  if (
    /\[[^\]]+\](?!\s*\()/.test(marker.body) ||
    /\[[^\]]+\]\s*\[[^\]]*\]/.test(marker.body) ||
    /<a\b/i.test(marker.body)
  ) {
    errors.push(`${marker.id} uses unsupported link syntax; use an inline Markdown link`);
  }

  const targets = new Set();
  for (const match of marker.body.matchAll(/!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g)) {
    targets.add(match[1]);
  }
  for (const match of marker.body.matchAll(/https?:\/\/[^\s<>)\]]+/g)) {
    targets.add(match[0].replace(/[.,;:!?]+$/, ""));
  }

  for (const target of targets) {
    if (!(await isSafeRepositoryLink(rootDir, sourcePath, target))) {
      errors.push(`${marker.id} contains a link outside the repository: ${target}`);
    }
  }
}
