// Title Case, the way a screen title, a button or a label is written.
//
// Dave, 2026-09-20, after the first pass through the rebuilt app: "make
// sure everything is title cased as well, I saw a bunch that wasn't."
// A screen title, a section label, a button, a field label, a chip, a
// stat label and an empty-state title are all titles. A lede, a meta
// line, a hint and a notice body are sentences and stay sentences.
//
// Small words stay lowercase unless they open or close the title.
// Acronyms (GPA, NCAA, ACT) and anything with a digit are left as they
// are. The law in src/laws/copyLaws.test.ts reads every literal title
// in the UI through this and fails on one it would change.

const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of", "on", "or", "per", "the", "to", "vs", "via", "with"]);

function capWord(word: string): string {
  // Already carries capitals after the first letter (GPA, iPhone, F-1):
  // leave it alone.
  if (/[A-Z0-9]/.test(word.slice(1)) || /\d/.test(word)) return word;
  // A slash or hyphen joins two words that each take a capital.
  return word.replace(/(^|[/-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

export function titleCase(text: string): string {
  const words = text.split(" ");
  return words
    .map((w, i) => {
      if (!w) return w;
      const bare = w.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
      const edge = i === 0 || i === words.length - 1;
      if (!edge && SMALL.has(bare)) return w.toLowerCase();
      return capWord(w);
    })
    .join(" ");
}

// The strings the law holds to Title Case: short, and not a sentence.
export function isTitleLike(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 48) return false;
  if (/[.?!:]$/.test(t)) return false;
  if (t.includes("{") || t.includes("$")) return false;
  return t.split(/\s+/).length <= 6;
}
