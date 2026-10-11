import { NextResponse } from "next/server";
import { clearSessionCookies } from "@/features/onboarding/session-cookies";

export function GET() {
  // Server components cannot delete cookies. Clear rejected credentials here
  // before login middleware sees them and redirects back to the workspace.
  return clearSessionCookies(
    // A relative Location preserves the browser's origin behind Docker/proxies.
    new NextResponse(null, { status: 303, headers: { Location: "/login" } })
  );
}
