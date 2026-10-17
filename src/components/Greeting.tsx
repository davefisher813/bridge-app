"use client";

import { useSyncExternalStore } from "react";
import { greetingFor } from "@/lib/copy/greeting";

const subscribe = () => () => {};

// The server cannot know the person's clock, so it says a plain "Hello"
// and the phone or browser swaps in the right word once it is showing.
export function Greeting({ name }: { name: string }) {
  const word = useSyncExternalStore(
    subscribe,
    () => greetingFor(new Date().getHours()),
    () => "Hello",
  );
  return <>{`${word}, ${name}.`}</>;
}
