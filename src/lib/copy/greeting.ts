// The Today greeting by the person's own clock (live test V1, 2026-10-16:
// it said "Good morning" at 8:22 PM). Before noon is morning, noon to
// five is afternoon, the rest is evening.
export function greetingFor(hour: number): "Good morning" | "Good afternoon" | "Good evening" {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}
