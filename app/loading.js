export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <div className="space-y-3">
        <div className="skeleton h-4 w-48 rounded-lg" />
        <div className="skeleton h-4 w-32 rounded-lg" />
      </div>
    </div>
  );
}
