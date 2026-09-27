import type { ThreadMessage } from "@/lib/data/messages";
import { longDate } from "@/lib/copy/dates";
import { Body, Card, ConfirmButton, Form, Label } from "@/components/kit";

// An athlete's thread, oldest first. One component for the staff and the
// family screens so the two cannot drift. Each message is a static card:
// it is prose, not a record to open, and the composer under it is the
// action (the clickability audit leaves static cards alone). A family
// login cannot read a co-guardian's users row, so a named author the
// reader cannot see reads as Family; only a deleted author left.
//
// `remove` is the staff screen only (audit crud F9): each message gets a
// Remove behind a confirm, bound to its id. The family screen passes
// nothing and shows none.
export function MessageThread({ messages, meId, remove }: { messages: ThreadMessage[]; meId: string; remove?: (messageId: string) => Promise<void> }) {
  return (
    <>
      {messages.map((m) => (
        <Card key={m.id} isStatic>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Label>{`${m.authorName ?? (m.authorId === null ? "Someone Who Left" : "Athlete")} · ${longDate(m.createdAt)}${m.authorId !== null && m.authorId === meId ? " · you" : ""}`}</Label>
              <Body>{m.body}</Body>
            </div>
            {remove && (
              <Form action={remove.bind(null, m.id)}>
                <ConfirmButton inline title="Remove This Message?" body="It comes off the thread for Admins and the athlete login. It cannot be brought back." confirmLabel="Remove">
                  Remove
                </ConfirmButton>
              </Form>
            )}
          </div>
        </Card>
      ))}
    </>
  );
}
