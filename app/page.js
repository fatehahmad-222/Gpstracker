import { requireSignedIn } from "@/lib/authGuard";

export const metadata = {
  title: "Fleet Console",
};

export default async function HomePage() {
  // Resolves the session, profile and role in one place and always redirects:
  // anon -> /login, deactivated/profile-less -> /inactive, otherwise the app.
  await requireSignedIn();
  return null;
}
