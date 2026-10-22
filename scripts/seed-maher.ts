/**
 * Seed MAHER MOBILE CARE with sample Bangla service entries.
 *
 *   npm run seed            → inserts samples (keeps existing data)
 *   npm run seed -- --fresh → clears all services first, then inserts
 *
 * Fully offline against the database selected by lib/db-path.
 */
import { prisma } from "../lib/prisma";
import { normalizeShopExpense } from "../lib/expense-code";
import { computeDue } from "../lib/utils";

const fresh = process.argv.includes("--fresh");

async function main() {
  if (fresh) {
    await prisma.service.deleteMany();
    console.log("Cleared existing services.");
  }

const midday = (daysAgo: number, h = 11, m = 30) => {
  const now = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  const key = new Date(now).toISOString().slice(0, 10);
  void h;
  void m;
  return new Date(`${key}T12:00:00.000+06:00`);
};

interface Seed {
  customerName: string;
  phone: string;
  model: string;
  technician: string;
  problem: string;
  totalBill: number;
  advance: number;
  status: string;
  shopExpense?: string;
  daysAgo: number;
}

const SEED: Seed[] = [
  { customerName: "রহিম উদ্দিন", phone: "01711223344", model: "Redmi Note 13", technician: "NURUL", problem: "ডিসপ্লে পরিবর্তন", totalBill: 2800, advance: 1000, status: "In-Progress", shopExpense: "1900", daysAgo: 0 },
  { customerName: "করিম শেখ", phone: "01819876543", model: "Galaxy A54", technician: "RONI", problem: "ব্যাটারি সমস্যা", totalBill: 1200, advance: 0, status: "Pending", shopExpense: "", daysAgo: 0 },
  { customerName: "নাসরিন আক্তার", phone: "01912345678", model: "iPhone 11", technician: "ASRAFUL", problem: "চার্জিং পোর্ট", totalBill: 1050, advance: 1050, status: "Completed", shopExpense: "*C#", daysAgo: 0 },
  { customerName: "আব্দুল মালেক", phone: "01611223344", model: "Oppo A78", technician: "NAYEM", problem: "স্পিকার নষ্ট", totalBill: 650, advance: 200, status: "Pending", shopExpense: "300", daysAgo: 0 },
  { customerName: "শামীম হোসেন", phone: "01555667788", model: "Realme Narzo 60", technician: "NURUL", problem: "পানি ঢুকেছে", totalBill: 1900, advance: 1900, status: "Delivered", shopExpense: "1200", daysAgo: 1 },
  { customerName: "ফাতেমা বেগম", phone: "01399887766", model: "Vivo Y36", technician: "RONI", problem: "টাচ কাজ করে না", totalBill: 1400, advance: 500, status: "Completed", shopExpense: "*M#", daysAgo: 2 },
  { customerName: "তানভীর আহমেদ", phone: "01733445566", model: "Poco X6", technician: "ASRAFUL", problem: "ডিসপ্লে ফ্লিকার", totalBill: 3200, advance: 1000, status: "Delivered", shopExpense: "২৪০০", daysAgo: 4 },
  { customerName: "মিতু রানী", phone: "01877665544", model: "Walton Primo S8", technician: "NAYEM", problem: "মাইক সমস্যা", totalBill: 350, advance: 350, status: "Delivered", shopExpense: "", daysAgo: 6 },
  { customerName: "কামরুল ইসলাম", phone: "01944556677", model: "Nova 9", technician: "NURUL", problem: "সফটওয়্যার ফ্ল্যাশ", totalBill: 400, advance: 0, status: "Delivered", shopExpense: "", daysAgo: 9 },
  { customerName: "জামাল ভূঁইয়া", phone: "01677889900", model: "Nokia G42", technician: "RONI", problem: "রিংগার বিকৃত", totalBill: 500, advance: 500, status: "Delivered", shopExpense: "200", daysAgo: 12 },
  { customerName: "সালমা খাতুন", phone: "01511223344", model: "iPhone 12", technician: "ASRAFUL", problem: "ফেস আইডি", totalBill: 1500, advance: 500, status: "Delivered", shopExpense: "*F#", daysAgo: 15 },
  { customerName: "রফিকুল ইসলাম", phone: "01788990011", model: "Redmi 12", technician: "NAYEM", problem: "ব্যাটারি ফুলে গেছে", totalBill: 1450, advance: 1450, status: "Delivered", shopExpense: "১০৫০", daysAgo: 18 },
  { customerName: "হাবিবা সুলতানা", phone: "01966778899", model: "Reno 11", technician: "NURUL", problem: "ক্যামেরা ঝাপসা", totalBill: 850, advance: 0, status: "Delivered", shopExpense: "550", daysAgo: 22 },
  { customerName: "রহিম উদ্দিন", phone: "01711223344", model: "Galaxy M34", technician: "RONI", problem: "পাওয়ার বাটন", totalBill: 470, advance: 470, status: "Delivered", shopExpense: "220", daysAgo: 26 },
  { customerName: "মনির হোসেন", phone: "01811223399", model: "Symphony Z60", technician: "ASRAFUL", problem: "নেটওয়ার্ক পায় না", totalBill: 600, advance: 200, status: "Delivered", shopExpense: "", daysAgo: 30 },
  { customerName: "দেলোয়ার", phone: "01699001122", model: "OnePlus Nord", technician: "NAYEM", problem: "ডিসপ্লে পরিবর্তন", totalBill: 3500, advance: 2000, status: "Delivered", shopExpense: "2600", daysAgo: 33 },
];

let ok = 0;
  for (const s of SEED) {
    const normalizedExpense = normalizeShopExpense(s.shopExpense ?? "");
    const created = await prisma.service.create({
      data: {
        customerName: s.customerName,
        phone: s.phone,
        model: s.model,
        technician: s.technician,
        problem: s.problem,
        totalBill: s.totalBill,
        advance: s.advance,
        due: computeDue(s.totalBill, s.advance),
        status: s.status,
        shopExpense: normalizedExpense.stored,
        expenseAmount: normalizedExpense.amount ?? 0,
        serviceDate: midday(s.daysAgo),
      },
    });
    ok += 1;
    console.log(
      `#${created.id} | ${created.customerName} | ${created.technician} | বিল=${created.totalBill} জমা=${created.advance} বাকি=${created.due} | খরচ=${created.shopExpense ?? "—"} (${created.expenseAmount}) | ${created.status}`
    );
  }
    console.log(`\nSeeded ${ok} services`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
