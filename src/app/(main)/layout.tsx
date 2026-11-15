import Link from "next/link";
import { WaOutbox } from "@/components/WaOutbox";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, eq, sql, lt, notInArray, inArray, gte, desc } from "drizzle-orm";
import { db } from "@/db";
import { notifications, registrations, matches, assignments, staff, appeals, matchRequests, users, decisions, contracts, waOutbox, officialExpenses } from "@/db/schema";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { scopeOf, regIn, clubIn, compIn } from "@/lib/scope";
import { ROLE_LABEL, ROLE_COMMITTEE } from "@/lib/labels";
import { today } from "@/lib/util";
import { maybeRunRegJobs } from "@/lib/regjobs";
import { NavMenu, type NavItem } from "@/components/Client";

async function count(q: Promise<{ n: number }[]>) {
  const [r] = await q;
  return r?.n ?? 0;
}

async function buildNav(u: CurrentUser): Promise<NavItem[]> {
  const n = sql<number>`count(*)::int`;
  if (u.isClub) {
    const open = await db.select({ t: registrations.type, st: registrations.status, n }).from(registrations)
      .where(and(eq(registrations.clubId, u.clubId!), inArray(registrations.status, ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION"])))
      .groupBy(registrations.type, registrations.status);
    // شارة كل قسم: الطلبات المعادة للتصحيح + المسودات غير المرسلة (ما يحتاج عملًا من النادي)
    const todo = (types: string[]) => open.filter((x) => types.includes(x.t) && x.st !== "SUBMITTED").reduce((a, x) => a + x.n, 0);
    const origin = u.can("club.origin")
      ? await count(db.select({ n }).from(registrations).where(and(eq(registrations.fromClubId, u.clubId!), eq(registrations.originResponse, "PENDING"))))
      : 0;
    const edit = u.can("club.edit");
    const tNew = todo(["NEW"]), tRen = todo(["RENEWAL"]), tTr = todo(["TRANSFER", "LOAN", "LOAN_RETURN"]);
    return [
      { label: "الرئيسية", href: "/club" },
      { label: "لاعبو النادي", href: "/club/players" },
      {
        label: "➕ تسجيل جديد", badge: tNew,
        children: [
          ...(edit ? [{ label: "➕ تسجيل لاعب جديد", href: "/club/players/new?mode=new" }] : []),
          { label: "طلبات التسجيل الجديد", href: "/club/requests?kind=new", badge: tNew },
          ...(edit ? ["sep" as const, { label: "⬆ استيراد لاعبين جدد من Excel", href: "/club/import" }] : []),
        ],
      },
      {
        label: "🔄 التجديد", badge: tRen,
        children: [
          ...(edit ? [{ label: "🔄 تجديد قيد لاعبي النادي", href: "/club/renew" }] : []),
          { label: "طلبات التجديد", href: "/club/requests?kind=renew", badge: tRen },
        ],
      },
      {
        label: "⇄ الانتقالات والإعارات", badge: tTr + origin,
        children: [
          ...(edit ? [{ label: "⇄ ضم لاعب من نادٍ آخر (انتقال / إعارة)", href: "/club/players/new?mode=transfer" },
            { label: "↩ عودة لاعب من إعارة", href: "/club/players/new?mode=return" }] : []),
          { label: "طلبات الانتقال والإعارة الواردة", href: "/club/requests?kind=transfer", badge: tTr },
          ...(u.can("club.origin") ? ["sep" as const, { label: "📤 طلبات انتقال لاعبينا لأندية أخرى", href: "/club/origin", badge: origin }] : []),
        ],
      },
      {
        label: "الطلبات والعقود",
        children: [
          { label: "كل طلبات القيد", href: "/club/requests" },
          { label: "عقود المحترفين", href: "/club/contracts" },
        ],
      },
      { label: "المدربون والإداريون", href: "/club/staff" },
      {
        label: "المباريات",
        children: [
          { label: "المباريات والقوائم", href: "/club/matches" },
          { label: "قائمة الفريق المعتمدة", href: "/club/roster" },
          { label: "العقوبات", href: "/club/sanctions" },
          { label: "ملاعب النادي", href: "/club/stadiums" },
        ],
      },
      ...(u.can("club.finance") ? [{ label: "الحساب المالي", href: "/club/finance" }] : []),
      {
        label: "النادي",
        children: [
          { label: "مراسلات الاتحاد", href: "/club/mail" },
          ...(u.role === "CLUB_MANAGER" ? [{ label: "مستخدمو النادي", href: "/club/users" }] : []),
        ],
      },
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
        { label: "🧑‍💼 المدربون والإداريون", href: "/registration/staff", badge: await count(db.select({ n }).from(staff).where(and(clubIn(sc, staff.clubId), eq(staff.status, "SUBMITTED")))) },
        { label: "👤 سجل اللاعبين", href: "/registration/players" },
        { label: "⇄ الانتقالات والإعارات", href: "/registration/transfers" },
        ...(u.can("reg.contracts") ? [{ label: "📄 عقود المحترفين", href: "/registration/contracts", badge: await count(db.select({ n }).from(contracts).innerJoin(registrations, eq(registrations.id, contracts.registrationId)).where(and(clubIn(sc, contracts.clubId), eq(contracts.status, "SUBMITTED"), eq(registrations.status, "APPROVED")))) }] : []),
        ...(u.can("reg.suspend") || u.can("reg.view") ? [{ label: "⛔ الإيقافات", href: "/registration/suspensions" }] : []),
        "sep",
        ...(u.can("reg.lists") ? [{ label: "📋 قوائم الفرق", href: "/registration/lists" }] : []),
        ...(u.can("reg.edit") ? [{ label: "🌐 أرقام FIFA ID", href: "/registration/fifa-ids" }] : []),
        ...(u.can("reg.edit") ? [{ label: "🔀 السجلات المكررة", href: "/registration/duplicates" }] : []),
        { label: "🪪 فحص الأرقام الوطنية", href: "/registration/nid-check" },
        { label: "🏷 تصنيف الأندية للتدريب", href: "/registration/club-categories" },
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
        { label: "💼 مصاريف الحكام", href: "/referees/expenses", badge: await count(db.select({ n }).from(officialExpenses).where(eq(officialExpenses.status, "SUBMITTED"))) },
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
  // المهام الدورية للجنة القيد (المهل، الإعارات، التذكيرات، الكشف الطبي) — مرة كل ساعة عند دخول موظف اللجنة
  if (u && (u.role === "REG_HEAD" || u.role === "REG_STAFF" || u.role === "ADMIN")) await maybeRunRegJobs();
  if (!u) redirect("/login");
  const path = (await headers()).get("x-path") ?? "";
  if (u.mustChangePassword && !path.startsWith("/profile")) redirect("/profile?mustchange=1");
  if (u.needs2fa && !path.startsWith("/profile")) redirect("/profile/2fa");

  const [items, unread] = await Promise.all([
    buildNav(u),
    count(db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, u.id), eq(notifications.isRead, false)))),
  ]);
  const [me] = await db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, u.id));
  const missingContact = (!me?.email && u.role !== "OBSERVER") || !me?.phone; // البريد اختياري لمراقبي المباريات
  const sub = u.isClub ? `بوابة الأندية — ${u.clubName}` : u.isOfficial ? (u.role === "OBSERVER" ? "بوابة مراقبي المباريات" : "بوابة الحكام") : "منظومة القيد والمسابقات والحكام";

  // رسائل واتساب الجاهزة من آخر 24 ساعة لهذا المستخدم
  const wa = (await db.select().from(waOutbox).where(and(eq(waOutbox.userId, u.id), inArray(waOutbox.status, ["PENDING", "NO_PHONE", "FAILED"]), gte(waOutbox.createdAt, new Date(Date.now() - 864e5)))).orderBy(desc(waOutbox.id)).limit(30))
    .map((w) => ({ id: w.id, toName: w.toName, status: w.status, preview: w.body, link: w.status === "PENDING" && w.phone ? `https://wa.me/${w.phone}?text=${encodeURIComponent(w.body)}` : null }));
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
        <WaOutbox items={wa} />
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
