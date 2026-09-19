// What every org screen shows while its data loads: the shape of a
// screen, in paper, pulsing. No spinner, per the catalog's rule that a
// surface is never an empty container. Sized to the Today screen's
// tiles-then-rows layout, which is close enough to every other screen
// that the swap does not jump.
export default function OrgLoading() {
  return (
    <main className="animate-pulse px-4 pt-2" aria-busy="true" aria-label="Loading">
      <div className="mb-4 h-[60px] w-2/3 rounded-[10px] bg-paper" />
      <div className="flex gap-2">
        <div className="h-[62px] flex-1 rounded-[12px] bg-paper" />
        <div className="h-[62px] flex-1 rounded-[12px] bg-paper" />
        <div className="h-[62px] flex-1 rounded-[12px] bg-paper" />
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <div className="h-[58px] rounded-[10px] bg-paper" />
        <div className="h-[58px] rounded-[10px] bg-paper" />
        <div className="h-[58px] rounded-[10px] bg-paper" />
        <div className="h-[58px] rounded-[10px] bg-paper" />
      </div>
    </main>
  );
}
