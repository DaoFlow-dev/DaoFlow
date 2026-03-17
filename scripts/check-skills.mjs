#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const errors = [];

const skillRoots = [".agents/skills", ".codex/skills"];
const markdownRoots = ["AGENTS.md", ".agents", ".codex/skills"];
const packageAgentFiles = [
  "packages/cli/AGENTS.md",
  "packages/client/AGENTS.md",
  "packages/server/AGENTS.md",
  "packages/shared/AGENTS.md"
];

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}

function addError(filePath, message) {
  errors.push(`${filePath}: ${message}`);
}

function lineNumberFromIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "").trim();
}

function walkMarkdown(rootPath, result) {
  if (!existsSync(rootPath)) {
    return;
  }

  const entries = readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      walkMarkdown(entryPath, result);
      continue;
    }

    if (entry.name.endsWith(".md")) {
      result.push(entryPath);
    }
  }
}

function validateSkillDir(skillDir) {
  const skillFile = path.join(skillDir, "SKILL.md");
  const relativeSkillDir = path.relative(repoRoot, skillDir);
  const relativeSkillFile = path.relative(repoRoot, skillFile);

  if (!existsSync(skillFile)) {
    addError(relativeSkillDir, "missing SKILL.md");
    return;
  }

  const content = readText(skillFile);
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!frontmatterMatch) {
    addError(relativeSkillFile, "missing YAML frontmatter");
    return;
  }

  const frontmatter = frontmatterMatch[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);

  if (!nameMatch) {
    addError(relativeSkillFile, "frontmatter is missing name");
  }

  if (!descriptionMatch) {
    addError(relativeSkillFile, "frontmatter is missing description");
  }

  if (nameMatch) {
    const skillName = stripQuotes(nameMatch[1]);
    const dirName = path.basename(skillDir);
    if (skillName !== dirName) {
      addError(
        relativeSkillFile,
        `frontmatter name "${skillName}" does not match directory "${dirName}"`
      );
    }
  }

  const lineCount = content.split(/\r?\n/).length;
  if (lineCount > 500) {
    addError(relativeSkillFile, `SKILL.md is ${lineCount} lines; keep skills under 500 lines`);
  }

  if (relativeSkillDir.startsWith(".agents/skills/")) {
    const metadataFile = path.join(skillDir, "agents", "openai.yaml");
    const relativeMetadataFile = path.relative(repoRoot, metadataFile);

    if (!existsSync(metadataFile)) {
      addError(relativeSkillDir, "missing agents/openai.yaml");
      return;
    }

    const metadata = readText(metadataFile);
    if (!/^interface:\s*$/m.test(metadata)) {
      addError(relativeMetadataFile, "missing interface block");
    }
    if (!/^\s*default_prompt:\s*(["']).+\1\s*$/m.test(metadata)) {
      addError(relativeMetadataFile, "missing quoted interface.default_prompt");
    }
    if (!/^policy:\s*$/m.test(metadata) || !/allow_implicit_invocation:\s*true/m.test(metadata)) {
      addError(relativeMetadataFile, "missing policy.allow_implicit_invocation: true");
    }
  }
}

function validateLinks(filePath) {
  const content = readText(filePath);
  const relativeFilePath = path.relative(repoRoot, filePath);
  const linkRegex = /\[[^\]]+\]\(([^)]+)\)/g;
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    const target = match[1].trim();
    if (
      target.startsWith("#") ||
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:")
    ) {
      continue;
    }

    const targetPath = target.split("#")[0];
    if (!targetPath) {
      continue;
    }

    const resolvedPath = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(path.dirname(filePath), targetPath);

    if (!existsSync(resolvedPath)) {
      const line = lineNumberFromIndex(content, match.index);
      addError(relativeFilePath, `line ${line} links to missing path "${target}"`);
    }
  }
}

for (const skillRoot of skillRoots) {
  const absSkillRoot = path.join(repoRoot, skillRoot);
  if (!existsSync(absSkillRoot)) {
    continue;
  }

  const entries = readdirSync(absSkillRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    validateSkillDir(path.join(absSkillRoot, entry.name));
  }
}

const markdownFiles = [];
for (const root of markdownRoots) {
  const absRoot = path.join(repoRoot, root);
  if (!existsSync(absRoot)) {
    continue;
  }

  if (root.endsWith(".md")) {
    markdownFiles.push(absRoot);
    continue;
  }

  walkMarkdown(absRoot, markdownFiles);
}

for (const packageAgentFile of packageAgentFiles) {
  const absPackageAgentFile = path.join(repoRoot, packageAgentFile);
  if (existsSync(absPackageAgentFile)) {
    markdownFiles.push(absPackageAgentFile);
  }
}

for (const markdownFile of markdownFiles) {
  validateLinks(markdownFile);
}

if (errors.length > 0) {
  globalThis.console.error("skills:check failed");
  for (const error of errors) {
    globalThis.console.error(`- ${error}`);
  }
  process.exit(1);
}

globalThis.console.log("skills:check passed");
