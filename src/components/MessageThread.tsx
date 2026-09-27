import type { ThreadMessage } from "@/lib/data/messages";
import { longDate } from "@/lib/copy/dates";
import { Body, Card, Label } from "@/components/kit";

// An athlete's thread, oldest first. One component for the staff and the
// family screens so the two cannot drift. Each message is a static card:
// it is prose, not a record to open, and the composer under it is the
// action (the clickability audit leaves static cards alone). A family
// login cannot read a co-guardian's users row, so a named author the
// reader cannot see reads as Family; only a deleted author left.
export function MessageThread({ messages, meId }: { messages: ThreadMessage[]; meId: string }) {
  return (
    <>
      {messages.map((m) => (
        <Card key={m.id} isStatic>
          <Label>{`${m.authorName ?? (m.authorId === null ? "Someone Who Left" : "Family")} · ${longDate(m.createdAt)}${m.authorId !== null && m.authorId === meId ? " · you" : ""}`}</Label>
          <Body>{m.body}</Body>
        </Card>
      ))}
    </>
  );
}
