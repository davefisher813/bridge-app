// What a person is told when Supabase refuses to send a sign-in or
// invitation email. Its own wording ("email rate limit exceeded") reads
// like a fault in the app; it means the project is sending too many
// emails too fast, which on the built-in mailer is a handful an hour and
// is already being hit (production auth logs, 2026-10-04: four of six
// sign-in requests refused with over_email_send_rate_limit).
export function sendFailureMessage(message: string): string {
  if (/rate limit|too many requests|over_email_send_rate_limit|over_request_rate_limit/i.test(message)) {
    return "Too many sign-in emails were sent in a short time. Wait a few minutes and ask again.";
  }
  return message;
}
