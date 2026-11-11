import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, eq, sql, lt, notInArray, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notifications, registrations, matches, assignments, staff, appeals, matchRequests, users, decisions, contracts } from "@/db/schema";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { scopeOf, regIn, clubIn, compIn } from "@/lib/scope";
import { ROLE_LABEL, ROLE_COMMITTEE } from "@/lib/labels";
import { today } from "@/lib/util";
import { NavMenu, type NavItem } from "@/components/Client";

async function count(q: Promise<{ n: number }[]>) {
  const [r] = await q;
  return r?.n ?? 0;
}

async function buildNav(u: CurrentUser): Promise<NavItem[]> {
  const n = sql<number>`count(*)::int`;
  if (u.isClub) {
    const corr = await count(db.select({ n }).from(registrations).where(and(eq(registrations.clubId, u.clubId!), eq(registrations.status, "NEEDS_CORRECTION"))));
    const origin = u.can("club.origin")
      ? await count(db.select({ n }).from(registrations).where(and(eq(registrations.fromClubId, u.clubId!), eq(registrations.originResponse, "PENDING"))))
      : 0;
    return [
      { label: "الرئيسية", href: "/club" },
      { label: "لاعبو النادي", href: "/club/players" },
      { label: "الطلبات", href: "/club/requests", badge: corr },
      { label: "عقود المحترفين", href: "/club/contracts" },
      ...(u.can("club.origin") ? [{ label: "طلبات انتقال لاعبينا", href: "/club/origin", badge: origin }] : []),
      { label: "الجهاز الفني", href: "/club/staff" },
      { label: "المباريات والقوائم", href: "/club/matches" },
      { label: "العقوبات", href: "/club/sanctions" },
      ...(u.can("club.finance") ? [{ label: "الحساب المالي", href: "/club/finance" }] : []),
      { label: "قائمة الفريق المعتمدة", href: "/club/roster" },
      { label: "مراسلات الاتحاد", href: "/club/mail" },
      { label: "ملاعب النادي", href: "/club/stadiums" },
      ...(u.role === "CLUB_MANAGER" ? [{ label: "مستخدمو النادي", href: "/club/users" }] : []),
    ];
  }
  if (u.isOfficial) {
    return [
      { label: "مبارياتي", href: "/portal" },
      { label: "تقاريري السابقة", href: "/portal/history" },
    ];
  }

  const items: NavItem[] = [{ label: "الرئيسية", href: "/dashboard" }];
  const sc = await scopeOf(u); // عدادات القائمة لمدير الدرجة تخص درجته فقط
  if (u.can("reg.view")) {
    const pending = await count(db.select({ n }).from(registrations).where(and(regIn(sc), eq(registrations.status, "SUBMITTED"))));
    items.push({
      label: "لجنة القيد",
      badge: pending,
      children: [
        { label: "📝 طلبات القيد", href: "/registration/requests", badge: pending },
        { label: "🧑‍💼 الإداريون والجهاز الفني", href: "/registration/staff", badge: await count(db.select({ n }).from(staff).where(and(clubIn(sc, staff.clubId), eq(staff.status, "SUBMITTED")))) },
        { label: "👤 سجل اللاعبين", href: "/registration/players" },
        { label: "⇄ الانتقالات والإعارات", href: "/registration/transfers" },
        ...(u.can("reg.contracts") ? [{ label: "📄 عقود المحترفين", href: "/registration/contracts", badge: await count(db.select({ n }).from(contracts).innerJoin(registrations, eq(registrations.id, contracts.registrationId)).where(and(clubIn(sc, contracts.clubId), eq(contracts.status, "SUBMITTED"), eq(registrations.status, "APPROVED")))) }] : []),
        ...(u.can("reg.suspend") || u.can("reg.view") ? [{ label: "⛔ الإيقافات", href: "/registration/suspensions" }] : []),
        "sep",
        ...(u.can("reg.lists") ? [{ label: "📋 قوائم الفرق", href: "/registration/lists" }] : []),
        ...(u.can("cards.print") ? [{ label: "🪪 طباعة البطاقات", href: "/registration/cards" }] : []),
        ...(u.can("cards.design") ? [{ label: "🎨 تصميم البطاقات", href: "/registration/cards/templates" }] : []),
        ...(u.can("reg.windows") ? ["sep" as const, { label: u.divisionId ? "📅 فترات القيد للدرجة" : "📅 المواسم وفترات القيد", href: "/registration/settings" }] : []),
      ],
    });
  }
  if (u.can("comp.view")) {
    const reports = await count(db.select({ n }).from(matches).where(and(compIn(sc, matches.competitionId), eq(matches.reportStatus, "SUBMITTED"))));
    items.push({
      label: "لجنة المسابقات",
      badge: u.can("comp.reports") ? reports : 0,
      children: [
        { label: "🏆 المسابقات", href: "/competitions" },
        { label: "⚽ المباريات", href: "/matches" },
        { label: "📅 التقويم والتعارضات", href: "/competitions/calendar" },
        { label: "🏟 سجل الملاعب", href: "/competitions/stadiums" },
        ...(u.can("comp.observers") ? [{ label: "🕵 مراقبو المباريات", href: "/competitions/observers" }] : []),
        ...(u.can("comp.manage") && !u.divisionId ? [{ label: "📝 نماذج تقارير الحكم والمراقب", href: "/competitions/report-templates" }] : []),
        ...(u.can("comp.reports") ? [{ label: "📄 تقارير بانتظار الاعتماد", href: "/matches?report=SUBMITTED", badge: reports }] : []),
        { label: "⛔ الإيقافات", href: "/registration/suspensions?kind=MATCHES" },
        "sep",
        { label: "⚖ العقوبات والقرارات", href: "/competitions/sanctions", badge: await count(db.select({ n }).from(appeals).where(and(clubIn(sc, appeals.clubId), eq(appeals.status, "PENDING")))) },
        ...(u.can("comp.articles") ? [{ label: "📖 لائحة العقوبات", href: "/competitions/articles" }] : []),
        { label: "🗓 طلبات التأجيل", href: "/competitions/requests", badge: await count(db.select({ n }).from(matchRequests).where(and(clubIn(sc, matchRequests.clubId), eq(matchRequests.status, "PENDING")))) },
      ],
    });
  }
  if (u.can("ref.view")) {
    const drafts = u.can("ref.approve")
      ? await count(db.select({ n }).from(assignments).innerJoin(matches, eq(matches.id, assignments.matchId)).where(and(compIn(sc, matches.competitionId), eq(assignments.status, "DRAFT"))))
      : 0;
    items.push({
      label: "لجنة الحكام",
      badge: drafts,
      children: [
        { label: "🟨 الحكام", href: "/referees" },
        { label: "📋 تعيين الطواقم", href: "/referees/assignments", badge: drafts },
        ...(u.can("ref.evals") ? [{ label: "★ تقييمات الحكام", href: "/referees/evaluations" }] : []),
      ],
    });
  }
  if (u.can("fin.view")) {
    items.push({
      label: "اللجنة المالية",
      children: [
        { label: "💰 لوحة المالية", href: "/finance" },
        { label: "🏟 حسابات الأندية", href: "/finance/clubs" },
        { label: "🟨 مستحقات الحكام", href: "/finance/officials" },
        { label: "🧾 الإيصالات وسندات الصرف", href: "/finance/payments" },
        ...(u.can("fin.settings") ? ["sep" as const, { label: "⚙ الرسوم والأجور والقواعد", href: "/finance/settings" }] : []),
      ],
    });
  }
  if (u.canAny("sec.view", "kpi.view")) {
    const late = u.can("sec.view") ? await count(db.select({ n }).from(decisions).where(and(lt(decisions.dueDate, today()), notInArray(decisions.status, ["DONE", "CANCELLED"])))) : 0;
    items.push({
      label: "الأمانة العامة",
      badge: late,
      children: [
        ...(u.can("sec.view") ? [
          { label: "✉ الصادر والوارد", href: "/secretariat/mail" },
          { label: "📝 محاضر الاجتماعات", href: "/secretariat/meetings" },
          { label: "📌 القرارات ومتابعة التنفيذ", href: "/secretariat/decisions", badge: late },
        ] : []),
        ...(u.can("kpi.view") ? [{ label: "📊 لوحة المؤشرات", href: "/kpis" }] : []),
      ],
    });
  } else if (ROLE_COMMITTEE[u.role]) {
    const mine = await count(db.select({ n }).from(decisions).where(and(eq(decisions.assignee, ROLE_COMMITTEE[u.role]), inArray(decisions.status, ["PENDING", "IN_PROGRESS"]))));
    if (mine) items.push({ label: "📌 قرارات مطلوبة", href: "/secretariat/decisions", badge: mine });
  }
  // إدارة الدرجة: لمدير الدرجة (ومدير المنظومة يختار الدرجة)
  if (u.canAny("div.clubs", "div.users") && (u.divisionId || u.role === "ADMIN")) {
    items.push({
      label: u.divisionId ? "🪜 إدارة الدرجة" : "🪜 إدارة الدرجات",
      children: [
        ...(u.can("div.clubs") ? [{ label: "🏟 أندية الدرجة", href: "/division/clubs" }] : []),
        ...(u.can("div.users") ? [{ label: "👥 الحسابات والصلاحيات", href: "/division/users" }, { label: "🧾 سجل عمليات الدرجة", href: "/division/audit" }] : []),
      ],
    });
  }
  if (u.can("archive.view")) items.push({ label: "🗄 الأرشيف", href: "/archive" });
  if (u.can("reports.view")) items.push({ label: "التقارير", href: "/reports" });
  items.push({ label: "📚 اللوائح", href: "/regulations" });
  if (u.canAny("admin.users", "admin.permissions", "admin.clubs", "admin.audit", "admin.settings", "admin.outbox")) {
    items.push({
      label: "الإدارة",
      children: [
        ...(u.can("admin.users") ? [{ label: "👥 المستخدمون والحسابات", href: "/admin/users" }] : []),
        ...(u.can("admin.permissions") ? [{ label: "🔐 مصفوفة الصلاحيات", href: "/admin/permissions" }] : []),
        ...(u.can("admin.clubs") ? [{ label: "🏟 الأندية", href: "/admin/clubs" }, { label: "🪜 الدرجات ومديروها", href: "/admin/divisions" }] : []),
        ...(u.can("admin.settings") ? [{ label: "⚙ الإعدادات العامة", href: "/admin/settings" }, { label: "📧 إعدادات البريد (Gmail)", href: "/admin/mail" }] : []),
        ...(u.can("admin.outbox") ? [{ label: "✉ صندوق الرسائل (روابط التفعيل)", href: "/admin/outbox" }] : []),
        ...(u.can("admin.audit") ? [{ label: "🛡 سجل العمليات", href: "/admin/audit" }] : []),
      ],
    });
  }
  return items;
}

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  const path = (await headers()).get("x-path") ?? "";
  if (u.mustChangePassword && !path.startsWith("/profile")) redirect("/profile?mustchange=1");

  const [items, unread] = await Promise.all([
    buildNav(u),
    count(db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, u.id), eq(notifications.isRead, false)))),
  ]);
  const [me] = await db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, u.id));
  const missingContact = (!me?.email && u.role !== "OBSERVER") || !me?.phone; // البريد اختياري لمراقبي المباريات
  const sub = u.isClub ? `بوابة الأندية — ${u.clubName}` : u.isOfficial ? (u.role === "OBSERVER" ? "بوابة مراقبي المباريات" : "بوابة الحكام") : "منظومة القيد والمسابقات والحكام";

  return (
    <>
      <header className="lff-header" style={{ position: "relative" }}>
        <div className="lff-container hdr-row">
          <Link className="brand" href="/">
            <img src="/img/logo-128.png" alt="شعار الاتحاد الليبي لكرة القدم" />
            <span>
              <span className="t1">الاتحاد الليبي لكرة القدم</span>
              <span className="t2">{sub}</span>
            </span>
          </Link>
          <div className="hdr-actions">
            <Link className="hdr-icon" href="/notifications" title="الإشعارات">
              <span>🔔</span>
              {unread > 0 && <span className="count">{unread}</span>}
            </Link>
            <Link className="hdr-user" href="/profile" title="حسابي">
              <span className="avatar">{u.fullName.slice(0, 1)}</span>
              <span className="who">
                <strong>{u.fullName}</strong>
                <small>{ROLE_LABEL[u.role]}</small>
              </span>
            </Link>
            <form action="/logout" method="post">
              <button className="btn btn-outline-light btn-sm">خروج</button>
            </form>
          </div>
        </div>
      </header>
      <div className="lff-flagbar" />
      <NavMenu items={items} />
      <main className="lff-container content">
        {missingContact && !path.startsWith("/profile") && <div className="alert warn">أكمل بيانات حسابك: البريد الإلكتروني ورقم الهاتف مطلوبان. <Link href="/profile">تحديث الآن</Link></div>}
        {children}
      </main>
      <footer className="lff-footer no-print">
        <div className="lff-container ftr-row">
          <span>© {new Date().getFullYear()} الاتحاد الليبي لكرة القدم — {sub}</span>
          <span>{ROLE_LABEL[u.role]}</span>
        </div>
      </footer>
    </>
  );
}

export const dynamic = "force-dynamic";
