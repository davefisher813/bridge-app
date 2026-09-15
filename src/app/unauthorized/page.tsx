export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px] rounded-[18px] border border-line bg-paper p-6 text-center">
        <div className="text-[18px] font-extrabold text-ink">Not authorized</div>
        <p className="mt-2 text-[13px] text-muted">Your account does not have access to this page. Contact your organization's owner if you think this is wrong.</p>
      </div>
    </main>
  );
}
