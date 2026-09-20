// The kit. Every screen is built from these and nothing else.
//
// Dave, 2026-09-19, after the first day on the live app: "visuals are not
// uniform, borders and spacing clearly have not been established". They
// were not: 14 font sizes, 7 radii, 17 paddings, borders on some cards
// and not others, all chosen screen by screen. So the scale became four
// text sizes, one radius and one spacing step (tailwind.config.ts), and
// this file is the only place those classes are allowed to be composed
// into a component. A page may use layout classes (flex, grid, gap) and
// the kit; src/laws/kitLaws.test.ts fails the build on anything else.
//
// Surfaces are paper on the page, no borders. Inputs are filled paper,
// 16px, 48px tall, so iPhone Safari never zooms. The tab bar is fixed
// above the home indicator. All of it chosen by Dave in the clean slate
// audit; see docs/STYLING_CATALOG.md.

import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { RowGlyph, type RowKind } from "@/components/RowGlyph";
import { DOT, TEXT_ON, scoreRole, type Role } from "@/components/statusHue";
import { TabBar } from "@/components/kit/TabBar";

export type { Role, RowKind };

// ── Text ─────────────────────────────────────────────────────────────
// The four sizes, by role rather than by pixel. Tone is a colour: ink,
// muted, or a status role's text colour (which is the tint foreground,
// already contrast-checked on the page).
type Tone = "ink" | "muted" | "danger" | Role;

function toneClass(tone: Tone): string {
  if (tone === "ink") return "text-ink";
  if (tone === "muted") return "text-muted";
  if (tone === "danger") return "text-tint-danger-on";
  return TEXT_ON[tone];
}

export function Title({ children, tone = "ink" }: { children: ReactNode; tone?: Tone }) {
  return <h1 className={`text-title font-extrabold tracking-tight ${toneClass(tone)}`}>{children}</h1>;
}

export function Heading({ children, tone = "ink" }: { children: ReactNode; tone?: Tone }) {
  return <h2 className={`text-heading font-extrabold tracking-tight ${toneClass(tone)}`}>{children}</h2>;
}

export function Body({ children, tone = "ink", weight = "normal", numeric = false, truncate = false }: { children: ReactNode; tone?: Tone; weight?: "normal" | "semibold" | "bold"; numeric?: boolean; truncate?: boolean }) {
  const w = weight === "bold" ? "font-bold" : weight === "semibold" ? "font-semibold" : "font-normal";
  return <div className={`text-body ${w} ${toneClass(tone)} ${numeric ? "tabular-nums" : ""} ${truncate ? "truncate" : ""}`}>{children}</div>;
}

export function Label({ children, tone = "muted", caps = false, truncate = false, numeric = false }: { children: ReactNode; tone?: Tone; caps?: boolean; truncate?: boolean; numeric?: boolean }) {
  return <div className={`text-label ${caps ? "font-bold uppercase tracking-wide" : ""} ${toneClass(tone)} ${truncate ? "truncate" : ""} ${numeric ? "tabular-nums" : ""}`}>{children}</div>;
}

// A paragraph of running text. Body size, muted by default, because
// most prose in the app explains a number or a rule.
export function Prose({ children, tone = "muted" }: { children: ReactNode; tone?: Tone }) {
  return <p className={`text-body ${toneClass(tone)}`}>{children}</p>;
}

// ── Layout ───────────────────────────────────────────────────────────
// Stack is the vertical rhythm. 2 inside a row, 3 between rows, 4
// between blocks, 6 between sections.
export function Stack({ gap = 3, children }: { gap?: 2 | 3 | 4 | 6; children: ReactNode }) {
  const g = gap === 2 ? "gap-2" : gap === 4 ? "gap-4" : gap === 6 ? "gap-6" : "gap-3";
  return <div className={`flex flex-col ${g}`}>{children}</div>;
}

// Inline puts things on one line with the ends pushed apart, which is
// what nearly every row and header wants.
export function Inline({ children, align = "center", gap = 3 }: { children: ReactNode; align?: "center" | "start" | "baseline"; gap?: 2 | 3 | 4 }) {
  const a = align === "start" ? "items-start" : align === "baseline" ? "items-baseline" : "items-center";
  const g = gap === 2 ? "gap-2" : gap === 4 ? "gap-4" : "gap-3";
  return <div className={`flex ${a} justify-between ${g}`}>{children}</div>;
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

// ── Screen ───────────────────────────────────────────────────────────
// Every page is one of these. Side gutter, room for the fixed tab bar,
// an optional back link, a title, a line under it, and one action at the
// top right.
export function Screen({
  title,
  back,
  lede,
  action,
  children,
}: {
  title?: ReactNode;
  back?: { href: string; label: string };
  lede?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="px-4 pt-3 pb-bar">
      {back && (
        <Link href={back.href} className="-my-2 inline-flex min-h-11 items-center pr-3 text-body font-bold text-muted">
          &larr; {back.label}
        </Link>
      )}
      {(title || action) && (
        <div className={`flex items-start justify-between gap-3 ${back ? "mt-3" : ""}`}>
          {/* With no back link the title is the first thing on the
              screen, so it shares its line with the org's wordmark in
              the corner (Chrome). The title keeps clear of it and the
              action drops below it; where there is an action its own
              column already holds most of that width, so the title only
              reserves the remainder. */}
          <div className={`min-w-0 ${back ? "" : action ? "pr-4" : "pr-20"}`}>
            {title && <Title>{title}</Title>}
            {lede && <div className="mt-1 text-body text-muted">{lede}</div>}
          </div>
          {action && <div className={`flex-shrink-0 pt-1 ${back ? "" : "mt-6"}`}>{action}</div>}
        </div>
      )}
      <div className={`flex flex-col gap-6 ${title || action ? "mt-4" : ""}`}>{children}</div>
    </main>
  );
}

// A screen with no org chrome around it: sign-in, the org picker, the
// error pages. One paper panel, centred.
export function Panel({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded border border-line bg-paper p-6">{children}</div>
    </main>
  );
}

// ── Section ──────────────────────────────────────────────────────────
// A coloured dot or a glyph, a caps label, a dotted rule, a count. The
// children are the rows, stacked.
export function Section({ label, count, role = "accent", kind, action, children }: { label: string; count?: number; role?: Role; kind?: RowKind; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-6 items-center gap-2">
        {kind ? <RowGlyph kind={kind} role={role} className="h-4 w-4" /> : <span className={`h-2 w-2 flex-shrink-0 rounded-full ${DOT[role]}`} />}
        <span className="text-label font-bold uppercase tracking-wide text-muted">{label}</span>
        <span className="h-px flex-1 border-b-2 border-dotted border-line" />
        {count !== undefined && <span className="text-label font-bold tabular-nums text-ink">{count}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────
export function Card({ children, href }: { children: ReactNode; href?: string }) {
  const inner = <div className="rounded border border-line bg-paper p-4">{children}</div>;
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// The first fact on a meta line reads in ink, the rest muted, so the
// eye lands on the one that matters: "D2 · Fixture State · Coach".
// Dave's pick, 2026-09-20. Only a plain string with the separator gets
// this; a node is left as it came.
function leadFact(meta: ReactNode): ReactNode {
  if (typeof meta !== "string" || !meta.includes(" · ")) return meta;
  const at = meta.indexOf(" · ");
  return (
    <>
      <span className="font-semibold text-ink">{meta.slice(0, at)}</span>
      {meta.slice(at)}
    </>
  );
}

// A list row: an optional glyph or avatar on the left, a title and a
// line under it, something on the right. 56px minimum so it is a
// comfortable tap. `href` makes the whole row the link.
export function Row({
  href,
  kind,
  role = "neutral",
  leading,
  title,
  meta,
  trailing,
  emphasis = "semibold",
  wrap = false,
}: {
  href?: string;
  kind?: RowKind;
  role?: Role;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  emphasis?: "semibold" | "bold";
  // A row is one line each by default. `wrap` lets the meta run on,
  // for the one case where the second line is the point of the row: a
  // reason, an instruction.
  wrap?: boolean;
}) {
  const body = (
    <div className="flex min-h-14 items-center gap-3 rounded border border-line bg-paper px-4 py-3">
      {leading ?? (kind ? <RowGlyph kind={kind} role={role} /> : null)}
      <div className="min-w-0 flex-1">
        {/* Two lines before an ellipsis. One line cut half the school
            names on the board; two keeps a row a row. */}
        <div className={`line-clamp-2 text-body ${emphasis === "bold" ? "font-bold" : "font-semibold"} text-ink`}>{title}</div>
        {/* Two lines for the meta too: "Transfer (4-to-4)" was the third
            fact on a roster row and lost its second half to an ellipsis. */}
        {meta && <div className={`${wrap ? "" : "line-clamp-2"} text-label text-muted`}>{leadFact(meta)}</div>}
      </div>
      {/* Never wider than half the row. A nowrap trailing ("Awaiting
          decision" on a grant) took the whole row on a narrow layout and
          squeezed the title to a one-pixel column: text that was there
          and could not be seen. */}
      {trailing && <div className="flex max-w-half flex-shrink-0 flex-col items-end gap-1 text-right">{trailing}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

// A stat: the number in the role's colour, the label under it.
export function Stat({ value, label, role = "neutral", kind }: { value: ReactNode; label: string; role?: Role; kind?: RowKind }) {
  return (
    <div className="grow basis-24 rounded border border-line bg-paper px-3 py-3">
      <div className="flex items-center gap-2">
        {kind && <RowGlyph kind={kind} role={role} className="h-4 w-4" />}
        {/* A figure never splits: "$40,000" broke after the comma on a
            320 screen. The tile keeps its content width and the row
            wraps instead (StatRow). */}
        <div className={`whitespace-nowrap text-heading font-extrabold tabular-nums ${TEXT_ON[role]}`}>{value}</div>
      </div>
      {/* 12px sides, not 16: three tiles at 375 wide with COMMITTED in
          caps on one of them is 15px over the screen at 16. */}
      <div className="text-label font-bold text-muted">{label}</div>
    </div>
  );
}

// Tiles wrap rather than shrink: three of them at 320 wide (or 390 with
// Safari's page zoom on) left 64px for the label, and COMMITTED broke in
// the middle of the word. A tile is never narrower than 96px, so the
// third one drops to its own line first.
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}

// A glyph in the role's hue and a word in ink. The one pill.
export function Chip({ label, kind, role = "neutral" }: { label: string; kind?: RowKind; role?: Role }) {
  return (
    <span className="inline-flex items-center gap-2 text-label font-bold text-ink">
      {kind && <RowGlyph kind={kind} role={role} className="h-4 w-4" />}
      {label}
    </span>
  );
}

// A big number: a GPA, a total, a count that is the point of a tile.
export function Figure({ children, tone = "ink" }: { children: ReactNode; tone?: Tone }) {
  return <div className={`text-title font-extrabold tabular-nums ${toneClass(tone)}`}>{children}</div>;
}

// The mark on a row that opens something.
export function Chevron() {
  return <span className="text-body font-bold text-muted">&rsaquo;</span>;
}

// The fit score: a number in the band's colour, one weight heavier than
// the row it sits on.
export function Score({ score }: { score: number }) {
  return <span className={`text-body font-extrabold tabular-nums ${TEXT_ON[scoreRole(score)]}`}>{score}</span>;
}

// Initials on one fixed hue. Fixed rather than per person, so a roster
// does not read as a colour wheel; indigo rather than the old blue-to-
// indigo gradient because white on systemBlue is 3.65:1 and the audit
// reads the corner the text actually sits on.
export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
  const box = size === "lg" ? "h-12 w-12 text-body" : "h-8 w-8 text-label";
  return <div className={`flex flex-shrink-0 items-center justify-center rounded-full bg-ios-indigo font-extrabold text-white ${box}`}>{initials}</div>;
}

// An org's mark: a white shape on a transparent PNG (orgs.branding.logo),
// drawn in ink for the theme by .org-mark in globals.css. Decorative:
// the org's name is always beside it or is the page.
export function OrgMark({ src, size = "md" }: { src: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const h = size === "xl" ? "h-16" : size === "lg" ? "h-12" : size === "sm" ? "h-6" : "h-8";
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={`org-mark ${h} w-auto flex-shrink-0`} />;
}

// A glyph, a title, one line naming the next action. Never an empty
// container and never a bare muted sentence.
export function EmptyState({ kind = "info", role = "neutral", title, action, children }: { kind?: RowKind; role?: Role; title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded border border-line bg-paper px-4 py-8 text-center">
      <RowGlyph kind={kind} role={role} className="h-8 w-8" />
      <div className="text-body font-extrabold text-ink">{title}</div>
      {children && <div className="text-label text-muted">{children}</div>}
      {/* The next action sits inside the empty state, so there is
          nothing to hunt for. Dave's pick, 2026-09-20. */}
      {action && <div className="w-full pt-2">{action}</div>}
    </div>
  );
}

// Something the screen has to tell the person: a saved confirmation, a
// refusal, a warning about a stand-in. Tone picks the glyph and its hue.
export function Notice({ tone, title, children }: { tone: "success" | "danger" | "warning" | "info"; title: ReactNode; children?: ReactNode }) {
  const kind: RowKind = tone === "success" ? "check" : tone === "danger" ? "blocked" : tone === "warning" ? "warning" : "info";
  const role: Role = tone === "success" ? "committed" : tone === "danger" ? "danger" : tone === "warning" ? "time" : "contact";
  return (
    <div className="flex items-start gap-3 rounded border border-line bg-paper px-4 py-3" role={tone === "danger" ? "alert" : "status"}>
      <span className="pt-px">
        <RowGlyph kind={kind} role={role} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-body font-bold text-ink">{title}</div>
        {children && <div className="text-label text-muted">{children}</div>}
      </div>
    </div>
  );
}

// ── Controls ─────────────────────────────────────────────────────────
// One button. Full width by default, because on a phone that is what a
// primary action is. `inline` for a small one inside a row or header.
type ButtonVariant = "primary" | "secondary" | "destructive" | "quiet";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-solid-accent text-solid-accent-on",
  secondary: "border border-line text-ink",
  destructive: "border border-line text-tint-danger-on",
  quiet: "text-tint-accent-on",
};

export function Button({ variant = "primary", inline = false, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; inline?: boolean }) {
  const shape = inline ? "inline-flex min-h-11 px-3" : "flex min-h-12 w-full px-4";
  return (
    <button {...rest} className={`${shape} items-center justify-center rounded text-body font-bold disabled:opacity-60 ${BUTTON[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", inline = false, children }: { href: string; variant?: ButtonVariant; inline?: boolean; children: ReactNode }) {
  const shape = inline ? "inline-flex min-h-11 px-3" : "flex min-h-12 w-full px-4";
  return (
    <Link href={href} className={`${shape} items-center justify-center rounded text-body font-bold ${BUTTON[variant]}`}>
      {children}
    </Link>
  );
}

// The add action in a screen header: a 44px accent disc with a plus.
// Dave's pick, 2026-09-20, over the text link it replaced. The label is
// for the screen reader; the disc says it on its own.
export function AddButton({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} className="flex h-11 w-11 items-center justify-center rounded-full bg-solid-accent text-heading font-bold text-solid-accent-on">
      +
    </Link>
  );
}

// A small text link in the accent colour, for "View All" under a list and
// "View all" under a list. 44px tall so it is a real target.
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="-my-2 inline-flex min-h-11 items-center text-label font-bold text-tint-accent-on">
      {children}
    </Link>
  );
}

// ── Fields ───────────────────────────────────────────────────────────
// 16px, 48px tall, filled paper on the page (or the page colour when the
// form itself sits on paper), a red ring for focus and for an error.
// The label sits above, the error under. Every input in the app is one
// of these three; a raw <input> anywhere else fails the build.
const FIELD_BASE = "w-full rounded border-0 px-4 text-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent";

function fieldSurface(onPaper: boolean, error?: string): string {
  return `${onPaper ? "bg-bg" : "bg-paper"} ${error ? "ring-2 ring-danger" : ""}`;
}

function FieldFrame({ id, label, hint, error, labelHidden = false, children }: { id: string; label: ReactNode; hint?: ReactNode; error?: string; labelHidden?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelHidden ? "sr-only" : "text-label font-bold text-muted"}>
        {label}
      </label>
      {children}
      {error ? <p className="text-label font-semibold text-tint-danger-on">{error}</p> : hint ? <p className="text-label text-muted">{hint}</p> : null}
    </div>
  );
}

export function Field({ id, name, label, hint, error, onPaper = false, labelHidden = false, className = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & { name: string; label: ReactNode; hint?: ReactNode; error?: string; onPaper?: boolean; labelHidden?: boolean }) {
  const fieldId = id ?? name;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error} labelHidden={labelHidden}>
      <input id={fieldId} name={name} aria-invalid={error ? true : undefined} {...rest} className={`${FIELD_BASE} min-h-12 ${fieldSurface(onPaper, error)} ${className}`} />
    </FieldFrame>
  );
}

export function SelectField({ id, name, label, hint, error, onPaper = false, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { name: string; label: ReactNode; hint?: ReactNode; error?: string; onPaper?: boolean }) {
  const fieldId = id ?? name;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error}>
      <select id={fieldId} name={name} aria-invalid={error ? true : undefined} {...rest} className={`${FIELD_BASE} min-h-12 ${fieldSurface(onPaper, error)}`}>
        {children}
      </select>
    </FieldFrame>
  );
}

export function TextAreaField({ id, name, label, hint, error, onPaper = false, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { name: string; label: ReactNode; hint?: ReactNode; error?: string; onPaper?: boolean }) {
  const fieldId = id ?? name;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error}>
      <textarea id={fieldId} name={name} aria-invalid={error ? true : undefined} rows={4} {...rest} className={`${FIELD_BASE} min-h-24 resize-y py-3 ${fieldSurface(onPaper, error)}`} />
    </FieldFrame>
  );
}

// A value the form carries without showing.
export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

// One of several choices in a form, submitted by tapping it. The
// selected one carries a ring. `name`/`value` make the tap the submit.
export function Option({ name, value, selected, title, meta }: { name: string; value: string; selected: boolean; title: ReactNode; meta?: ReactNode }) {
  return (
    <button type="submit" name={name} value={value} disabled={selected} aria-pressed={selected} className={`flex min-h-14 w-full items-center justify-between gap-3 rounded border border-line bg-paper px-4 py-3 text-left ${selected ? "ring-2 ring-accent" : ""}`}>
      <span className="text-body font-semibold text-ink">{title}</span>
      {meta && <span className="text-label text-muted">{meta}</span>}
    </button>
  );
}

// A yes/no as a switch-sized checkbox with its label as the tap target.
export function CheckField({ id, name, label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { name: string; label: ReactNode; hint?: ReactNode }) {
  const fieldId = id ?? name;
  return (
    <label htmlFor={fieldId} className="flex min-h-12 items-center gap-3 rounded border border-line bg-paper px-4">
      <input id={fieldId} name={name} type="checkbox" {...rest} className="h-6 w-6 accent-[var(--accent)]" />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-ink">{label}</span>
        {hint && <span className="block text-label text-muted">{hint}</span>}
      </span>
    </label>
  );
}

// A native file input styled as a paper tile. The tile is the label, so
// the whole thing is the tap target.
export function FileField({ id, name, label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { name: string; label: ReactNode; hint?: ReactNode }) {
  const fieldId = id ?? name;
  return (
    <label htmlFor={fieldId} className="flex min-h-12 cursor-pointer flex-col items-center justify-center gap-2 rounded bg-paper px-4 py-8 text-center">
      <RowGlyph kind="document" role="neutral" className="h-8 w-8" />
      <span className="text-body font-extrabold text-ink">{label}</span>
      {hint && <span className="text-label text-muted">{hint}</span>}
      <input id={fieldId} name={name} type="file" {...rest} className="sr-only" />
    </label>
  );
}

// Choices as a row of chips, one selected. The selected one carries a
// ring, never a fill.
export function ChoiceRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

export function Choice({ on, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) {
  return (
    <button type="button" aria-pressed={on} {...rest} className={`min-h-11 rounded border border-line bg-paper px-4 text-label font-bold ${on ? "text-ink ring-2 ring-accent" : "text-muted"}`}>
      {children}
    </button>
  );
}

// The form itself: a stack of fields with the one submit at the end.
// `error` is the whole-form failure, shown above the fields.
export function Form({ action, error, children, onPaper = false }: { action: (formData: FormData) => void | Promise<void>; error?: string; children: ReactNode; onPaper?: boolean }) {
  return (
    <form action={action} className={`flex flex-col gap-4 ${onPaper ? "" : ""}`}>
      {error && <Notice tone="danger" title={error} />}
      {children}
    </form>
  );
}

// ── Chrome ───────────────────────────────────────────────────────────
// What every org screen sits inside: the org's wordmark in the top
// right corner, the fixed tab bar below. The screen itself pads for the
// bar, and reserves the corner so a title never runs under the mark.
export function Chrome({ orgName, slug, logo, lockup, children }: { orgName: string; slug: string; logo?: string | null; lockup?: string | null; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      {/* 672 wide on a laptop, the whole screen on a phone. Dave's
          pick, 2026-09-20, over the 448 phone column. */}
      <div className="relative mx-auto max-w-2xl">
        {/* Small, in the corner, across from the screen title rather than
            above it. Dave, 2026-09-20. Out of the flow so the title sits
            level with it; Screen keeps the corner clear. */}
        <div className="absolute right-4 top-3 z-10">
          {lockup || logo ? <OrgMark src={(lockup ?? logo) as string} size="sm" /> : null}
          <span className="sr-only">{orgName}</span>
        </div>
        {children}
      </div>
      <TabBar slug={slug} />
    </div>
  );
}

// A metric's log as bars, oldest to newest, the scoring entry in accent.
// Heights are data (the values), drawn as SVG attributes, not styles.
export function Sparkline({ values, lowerIsBetter = false, mark }: { values: number[]; lowerIsBetter?: boolean; mark?: number }) {
  if (values.length === 0) return null;
  const w = 6;
  const gap = 3;
  const h = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = values.length * (w + gap) - gap;
  const name = `${values.length} ${values.length === 1 ? "entry" : "entries"}`;
  return (
    <svg viewBox={`0 0 ${width} ${h}`} width={width} height={h} className="text-tint-contact-on" role="img" aria-label={name}>
      {values.map((v, i) => {
        const t = (v - min) / span;
        const bar = Math.round(6 + (lowerIsBetter ? 1 - t : t) * (h - 6));
        return <rect key={i} x={i * (w + gap)} y={h - bar} width={w} height={bar} rx={2} fill="currentColor" className={mark === i ? "text-tint-accent-on" : ""} />;
      })}
    </svg>
  );
}

// A thin stacked bar: each part is a share of the whole in its role's
// hue. The widths are data, so they are the one inline style in the app.
export function Meter({ parts }: { parts: { role: Role; fraction: number }[] }) {
  return (
    <div className="flex h-1 overflow-hidden rounded-full bg-line" role="img" aria-label="Share of the Total">
      {parts.map((p, i) => (
        <div key={i} className={DOT[p.role]} style={{ width: `${Math.max(0, Math.min(1, p.fraction)) * 100}%` }} />
      ))}
    </div>
  );
}

// A loading placeholder in the shape of a screen.
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-full rounded bg-paper" />
      <div className="flex gap-3">
        <div className="h-16 flex-1 rounded bg-paper" />
        <div className="h-16 flex-1 rounded bg-paper" />
        <div className="h-16 flex-1 rounded bg-paper" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 rounded bg-paper" />
      ))}
    </div>
  );
}

export { ConfirmButton } from "./ConfirmButton";
