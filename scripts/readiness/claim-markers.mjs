const START_MARKER =
  /^(<!--|\{\/\*) readiness-claim: id=([a-z0-9-]+) state=(verified|goal|limitation) (-->|\*\/\})$/gm;
const END_MARKERS = {
  "<!--": "<!-- /readiness-claim -->",
  "{/*": "{/* /readiness-claim */}"
};
const COMMENT_PATTERNS = [/<!--[\s\S]*?-->/g, /\{\/\*[\s\S]*?\*\/\}/g];
const ABSOLUTE_CLAIM =
  /\b(all|always|complete|deterministic|entire|entirely|every|fully|guarantee|guaranteed|immutable|never|production-ready|reliable|reliably|safe|safely|zero lock-in|no telemetry|no vendor cloud dependency)\b/i;

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function findNextEndMarker(content, start) {
  return Object.values(END_MARKERS)
    .map((marker) => ({ marker, index: content.indexOf(marker, start) }))
    .filter((candidate) => candidate.index !== -1)
    .sort((left, right) => left.index - right.index)[0];
}

export function extractClaimMarkers(content, path) {
  const errors = [];
  const markers = [];

  for (const match of content.matchAll(START_MARKER)) {
    const [raw, opener, id, state, closer] = match;
    const delimitersMatch =
      (opener === "<!--" && closer === "-->") || (opener === "{/*" && closer === "*/}");
    if (!delimitersMatch) {
      errors.push(`${path}:${lineNumber(content, match.index)} has mismatched claim delimiters`);
      continue;
    }

    const endMarker = END_MARKERS[opener];
    const start = match.index + raw.length;
    const nextEnd = findNextEndMarker(content, start);

    if (!nextEnd) {
      errors.push(
        `${path}:${lineNumber(content, match.index)} has no closing readiness-claim marker`
      );
      continue;
    }
    if (nextEnd.marker !== endMarker) {
      errors.push(
        `${path}:${lineNumber(content, nextEnd.index)} has a closing readiness-claim marker that does not match ${opener}`
      );
      continue;
    }

    const end = nextEnd.index;

    markers.push({
      id,
      state,
      body: content.slice(start, end).trim(),
      line: lineNumber(content, match.index),
      startIndex: match.index,
      endIndex: end + endMarker.length
    });
  }

  const sorted = [...markers].sort((left, right) => left.startIndex - right.startIndex);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startIndex < sorted[index - 1].endIndex) {
      errors.push(`${path}:${sorted[index].line} has nested or overlapping readiness markers`);
    }
  }

  return { errors, markers };
}

function maskRange(characters, start, end) {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== "\n") characters[index] = " ";
  }
}

export function findUnregisteredAbsoluteClaims(content, path, markers) {
  const characters = [...content];
  for (const marker of markers) maskRange(characters, marker.startIndex, marker.endIndex);
  for (const pattern of COMMENT_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      maskRange(characters, match.index, match.index + match[0].length);
    }
  }

  let inFence = false;
  const errors = [];
  for (const [lineIndex, line] of characters.join("").split("\n").entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
    } else if (!inFence && ABSOLUTE_CLAIM.test(trimmed)) {
      errors.push(
        `${path}:${lineIndex + 1} absolute readiness wording must be inside a readiness-claim marker`
      );
    }
  }
  return errors;
}

const QUALIFIED_UNVERIFIED_SENTENCE =
  /\b(aim|aims|aspire|aspires|cannot|can't|goal|limitation|pending|plan|planned|should|target|unverified|until|verification|would)\b|\b(has|have|is|are|was|were|do|does|did|can|could|will) not\b|\bnot (yet|currently|proven|verified|guaranteed)\b/i;

export function findUnsafeAbsoluteClaimsInMarker(marker, path) {
  if (marker.state === "verified") return [];

  const sentences = marker.body.split(/(?<=[.!?;])|<br\s*\/?\s*>|\n+/i).filter(Boolean);
  return sentences.flatMap((sentence, index) => {
    if (!ABSOLUTE_CLAIM.test(sentence)) return [];
    if (index === 0 || QUALIFIED_UNVERIFIED_SENTENCE.test(sentence)) return [];
    return [
      `${path}:${marker.line} ${marker.state} claim ${marker.id} contains unqualified absolute wording`
    ];
  });
}
