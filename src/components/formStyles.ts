// Shared form styling, per the locked catalog (docs/STYLING_CATALOG.md).
// Every form component in this folder imports these rather than declaring
// its own copy. Before this existed all six forms carried a byte-identical
// set of these constants, so a catalog change meant six edits and five
// chances to miss one.

// Catalog item F3: filled, no border. There is no border to recolor on
// focus, so focus is a 2px accent ring instead. bg-paper sits a step above
// the bg-bg page behind it, which is what makes a borderless field still
// read as a field.
export const inputClass =
  "w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent";

// The same field in its error state: a danger ring, always visible rather
// than only on focus, so the field itself carries the error and not just
// the message under it.
export const inputErrorClass =
  "w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 text-[14px] text-ink placeholder:text-muted ring-2 ring-danger focus:outline-none focus:ring-2 focus:ring-danger";

export const labelClass = "mb-1.5 block text-[11px] font-bold text-muted";

export const errorClass = "mt-1 text-[11.5px] font-semibold text-danger";

// Catalog item BT3: solid rounded rectangle, not a pill. The fill carries
// its paired foreground, which is what keeps the label legible: white on
// the raw accent is 3.4:1 and fails.
export const submitClass =
  "mt-1 rounded-[8px] bg-solid-accent py-3 text-center text-[14px] font-bold text-solid-accent-on disabled:opacity-60";

// The same button at the size the inline sub-forms (contact, visit,
// communication) use.
export const submitSmallClass =
  "rounded-[8px] bg-solid-accent py-2.5 text-center text-[13px] font-bold text-solid-accent-on disabled:opacity-60";

// Picks the field class by whether that field currently has an error.
export function fieldClass(hasError: boolean | string | undefined): string {
  return hasError ? inputErrorClass : inputClass;
}
