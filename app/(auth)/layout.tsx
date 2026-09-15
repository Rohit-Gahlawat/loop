export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-indigo-600 text-white">L</span>
        LOOP
      </div>
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-8 max-w-sm text-center text-xs text-slate-500">
        Close the loop on customer feedback.
      </p>
    </div>
  );
}
