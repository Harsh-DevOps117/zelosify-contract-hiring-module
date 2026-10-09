import { requireHiringSession } from "@/features/hiring/server-session";
import HiringShell from "@/features/hiring/components/HiringShell";
export default async function Layout({ children }) {
  await requireHiringSession("HIRING_MANAGER");
  return <HiringShell persona="hiring-manager">{children}</HiringShell>;
}
