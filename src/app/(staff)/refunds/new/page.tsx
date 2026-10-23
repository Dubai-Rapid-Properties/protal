import { requireCapability } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { dubaiToday } from "@/lib/calendar";
import { REFUND_PEOPLE } from "@/lib/refunds";
import { RefundForm } from "./refund-form";

export const metadata = { title: "New refund" };

export default async function NewRefundPage() {
  const profile = await requireCapability("refunds.view");
  // The signed-in person, when they are on the list ("Dulshan Imantha" -> Dulshan).
  const first = (profile.full_name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const me = REFUND_PEOPLE.find((p) => p.toLowerCase() === first) ?? "";

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Refunds", href: "/refunds" }, { label: "New" }]}
        title="New refund"
        description="Something for the office paid with your own money: claim it back."
      />
      <RefundForm defaultPerson={me} today={dubaiToday()} />
    </>
  );
}
