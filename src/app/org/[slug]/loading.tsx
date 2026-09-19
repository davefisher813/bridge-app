import { Screen, Skeleton } from "@/components/kit";

// What every org screen shows while its data loads: the shape of a
// screen, in paper, pulsing. No spinner.
export default function OrgLoading() {
  return (
    <Screen>
      <Skeleton />
    </Screen>
  );
}
