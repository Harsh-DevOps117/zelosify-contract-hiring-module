import { requireHiringSession } from "@/features/hiring/server-session";
import HiringShell from "@/features/hiring/components/HiringShell";
export default async function Layout({ children }) {
  await requireHiringSession("IT_VENDOR");
  return <HiringShell persona="vendor">{children}</HiringShell>;
}
