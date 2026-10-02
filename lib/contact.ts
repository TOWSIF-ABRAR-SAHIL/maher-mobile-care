import { formatTaka } from "./utils";

/** Keep only digits; Bangladesh mobile numbers become 8801XXXXXXXXX. */
export function normalizeBdPhone(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (/^8801\d{9}$/.test(digits)) return digits;
  if (/^01\d{9}$/.test(digits)) return `880${digits.slice(1)}`;
  if (/^1\d{9}$/.test(digits)) return `880${digits}`;
  return digits;
}

export function telHref(phone: string): string {
  const digits = normalizeBdPhone(phone);
  return `tel:${digits.startsWith("880") ? `+${digits}` : digits}`;
}

export function whatsAppHref(service: {
  id: number;
  phone: string;
  model: string;
  due: number;
}): string {
  const message =
    `আসসালামু আলাইকুম, MAHER MOBILE CARE থেকে বলছি। ` +
    `বিল নং ${service.id} (${service.model})-এর ${formatTaka(service.due)} বাকি আছে।`;
  return `https://wa.me/${normalizeBdPhone(service.phone)}?text=${encodeURIComponent(
    message
  )}`;
}
