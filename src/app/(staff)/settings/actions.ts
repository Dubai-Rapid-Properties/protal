"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export type ActionState = { error?: string; success?: string };

const schema = z.object({
  legalName: z.string().min(2).max(200),
  tradeName: z.string().min(1).max(100),
  tradeLicenceNumber: z.string().max(60).optional(),
  reraBrokerNumber: z.string().max(60).optional(),
  trn: z.string().max(30).optional(),
  registeredAddress: z.string().max(300).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().or(z.literal("")).optional(),

  // Stored as a fraction (0.05), entered as a percentage (5).
  vatRatePercent: z.coerce.number().min(0).max(100),
  defaultManagementFeePct: z.coerce.number().min(0).max(100),
  defaultStrManagementFeePct: z.coerce.number().min(0).max(100),

  rentIncreaseNoticeDays: z.coerce.number().int().min(0).max(365),
  leaseRenewalNoticeDays: z.coerce.number().int().min(0).max(365),
  ejariOccupantUpdateDays: z.coerce.number().int().min(1).max(365),
  permitRenewalReminderDays: z.coerce.number().int().min(1).max(365),
  maintenanceThreshold: z.coerce.number().min(0),
  // A checkbox: present when ticked.
  emailOwnersAboutBookings: z.literal("on").optional(),
  emailOfficeAboutBookings: z.literal("on").optional(),
  showGuestFirstNameToOwners: z.literal("on").optional(),
  statementApproverId: z.string().uuid().or(z.literal("")).optional(),
});

export async function updateCompanySettings(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "settings.manage")) {
    return { error: "Only administrators may change company settings." };
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const input = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_settings")
    .update({
      legal_name: input.legalName,
      trade_name: input.tradeName,
      trade_licence_number: input.tradeLicenceNumber || null,
      rera_broker_number: input.reraBrokerNumber || null,
      trn: input.trn || null,
      registered_address: input.registeredAddress || null,
      phone: input.phone || null,
      email: input.email || null,
      vat_rate: input.vatRatePercent / 100,
      default_management_fee_pct: input.defaultManagementFeePct,
      default_str_management_fee_pct: input.defaultStrManagementFeePct,
      rent_increase_notice_days: input.rentIncreaseNoticeDays,
      lease_renewal_notice_days: input.leaseRenewalNoticeDays,
      ejari_occupant_update_days: input.ejariOccupantUpdateDays,
      permit_renewal_reminder_days: input.permitRenewalReminderDays,
      maintenance_owner_approval_threshold: input.maintenanceThreshold,
      email_owners_about_bookings: input.emailOwnersAboutBookings === "on",
      email_office_about_bookings: input.emailOfficeAboutBookings === "on",
      show_guest_first_name_to_owners: input.showGuestFirstNameToOwners === "on",
      statement_approver_id: input.statementApproverId || null,
    })
    .eq("id", true);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { success: "Company settings saved." };
}
