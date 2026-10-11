import { cookies } from "next/headers";
import { redirect } from "next/navigation";
export async function requireHiringSession(role) {
  const jar = await cookies();
  const token = jar.get("access_token")?.value;
  if (!token) redirect("/login");
  let response;
  try {
    response = await fetch(
      `${process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000/api/v1"}/hiring/session`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(1900),
      },
    );
  } catch {
    throw new Error("The hiring service is unavailable. Please retry shortly.");
  }
  if (response.status === 401) redirect("/auth/session-expired");
  if (response.status === 403) redirect("/user");
  if (!response.ok)
    throw new Error("Unable to verify access to the hiring workspace.");
  const actor = await response.json();
  if (actor.role !== role) redirect("/user");
  return actor;
}
