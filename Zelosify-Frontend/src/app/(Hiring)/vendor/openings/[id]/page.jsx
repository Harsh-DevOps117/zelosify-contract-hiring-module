import OpeningDetail from "@/features/hiring/components/OpeningDetail";
export default async function Page({ params }) {
  const { id } = await params;
  return <OpeningDetail persona="vendor" openingId={id} />;
}
