import { redirect } from "next/navigation";
import { resolveRequestLocale } from "../../../i18n/request";
import { withLocalePath } from "../../../i18n/config";

export default async function LegacyExchangeAccountsPage() {
  const locale = await resolveRequestLocale();
  redirect(withLocalePath("/settings", locale));
}
