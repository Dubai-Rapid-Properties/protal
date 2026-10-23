import { requireCapability, getCompanySettings } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { SettingsForm } from "./settings-form";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Company settings" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const [, settings, { data: approvers }] = await Promise.all([
    requireCapability("settings.manage"),
    getCompanySettings(),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_active", true)
      .in("role", ["super_admin", "finance"])
      .order("full_name"),
  ]);

  return (
    <>
      <PageHeader
        title="Company settings"
        description="Regulatory identifiers, VAT, default fees and the notice periods the system enforces."
      />
      {settings ? (
        <SettingsForm settings={settings} approvers={approvers ?? []} />
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          Company settings row not found. Apply the migrations in
          supabase/migrations before using this screen.
        </p>
      )}
    </>
  );
}
