const START_MARKER =
  /^<!-- readiness-claim: id=([a-z0-9-]+) state=(verified|goal|limitation) -->$/gm;
const END_MARKER = "<!-- /readiness-claim -->";
const ABSOLUTE_CLAIM =
  /\b(all|always|complete|deterministic|entire|entirely|every|fully|guarantee|guaranteed|immutable|never|production-ready|reliable|reliably|safe|safely|zero lock-in|no telemetry|no vendor cloud dependency)\b/i;

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

export function extractClaimMarkers(content, path) {
  const errors = [];
  const markers = [];

  for (const match of content.matchAll(START_MARKER)) {
    const [raw, id, state] = match;
    const start = match.index + raw.length;
    const end = content.indexOf(END_MARKER, start);

    if (end === -1) {
      errors.push(
        `${path}:${lineNumber(content, match.index)} has no closing readiness-claim marker`
      );
      continue;
    }

    markers.push({
      id,
      state,
      body: content.slice(start, end).trim(),
      line: lineNumber(content, match.index),
      startIndex: match.index,
      endIndex: end + END_MARKER.length
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

  let inFence = false;
  const errors = [];
  for (const [lineIndex, line] of characters.join("").split("\n").entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
    } else if (!inFence && !trimmed.startsWith("<!--") && ABSOLUTE_CLAIM.test(trimmed)) {
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
