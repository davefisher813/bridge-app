// How long a target has gone without an update, said the way a person
// would: a row touched today reads "updated today", not "no update in 0
// days". The day count is whole days (daysSince on the Today screen).
export function noUpdateText(days: number): string {
  if (days <= 0) return "updated today";
  return `no update in ${days} ${days === 1 ? "day" : "days"}`;
}
