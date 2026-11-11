export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contracts, players, clubs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { inScopeClub } from "@/lib/scope";
import { amountWords } from "@/lib/contracts";
import { PrintButton } from "@/components/Client";

const DOTS = "..............................";
/** قيمة مكتوبة أو نقاط للتعبئة اليدوية */
const v = (x: React.ReactNode, w = DOTS) => (x === null || x === undefined || x === "" ? <span className="ec-dots">{w}</span> : <b className="ec-v">{x}</b>);
const dmy = (s?: string | null) => { if (!s) return null; const [y, m, d] = s.split("-"); return <span className="ltr">{d}/{m}/{y}</span>; };
const dayName = (s?: string | null) => (s ? new Date(s + "T12:00:00Z").toLocaleDateString("ar-LY", { weekday: "long", timeZone: "UTC" }) : null);
const fmt = (n: string | null) => (Number(n) > 0 ? Number(n).toLocaleString("en", { maximumFractionDigits: 2 }) : null);

/** طباعة عقد لاعب كرة قدم محترف على النموذج الموحد للاتحاد الليبي لكرة القدم */
export default async function ContractPrint({ params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  const id = Number((await params).id);
  const [row] = await db.select({ c: contracts, name: players.fullName, club: clubs.name }).from(contracts)
    .innerJoin(players, eq(players.id, contracts.playerId)).innerJoin(clubs, eq(clubs.id, contracts.clubId)).where(eq(contracts.id, id));
  if (!row) notFound();
  const { c, name, club } = row;
  if (u.clubId) { if (u.clubId !== c.clubId) redirect("/denied"); }
  else if (!u.can("reg.contracts") || !(await inScopeClub(u, c.clubId))) redirect("/denied");
  const d = c.doc;
  const cur = c.currency;
  const amt = (k: "totalValue" | "signingBonus" | "monthlySalary" | "housingAmount" | "transportAmount") => (
    <>مبلغ{k === "totalValue" ? " إجمالي" : ""} وقدره <span className="ec-box">{v(fmt(c[k]), "")}</span> ( {cur === "LYD" ? "د.ل" : cur} ) بالحروف/ {v(amountWords(c[k], cur), "..................................................")}</>
  );
  const draft = c.status !== "ACTIVE" && c.status !== "SUBMITTED";
  const Sheet = ({ children, title, n }: { children: React.ReactNode; title?: string; n: number }) => {
    return (
      <div className="sheet ec">
        {draft && <div className="ec-wm">مسودة</div>}
        <div className="ec-head">
          <div className="ar">الاتحاد الليبي لكرة القدم</div>
          <img src="/img/logo-256.png" alt="" />
          <div className="en">Libyan Football Federation</div>
        </div>
        {title && <div className="ec-title">{title}</div>}
        <div className="ec-body">{children}</div>
        <div className="ec-foot">
          <div>الطرف الأول: <span className="ec-sl" /></div>
          <div className="pg">{n}</div>
          <div>الطرف الثاني: <span className="ec-sl" /></div>
        </div>
      </div>
    );
  };
  const ol = (items: string[], start = 1) => <ol className="ec-ol" start={start}>{items.map((t, i) => <li key={i}>{t}</li>)}</ol>;

  return (
    <div className="print-root">
      <style>{CSS}</style>
      <div className="print-toolbar no-print">{draft && <span style={{ color: "#b45309", fontWeight: 700 }}>مسودة — تظهر عليها علامة «مسودة» حتى إرسالها للاعتماد</span>}<PrintButton /></div>

      {/* الغلاف */}
      <div className="sheet ec ec-cover">
        <div className="ec-frame">
          <div className="ec-ch">
            <div><div className="b">الاتحاد الليبي لكرة القدم</div><div>لجنة أوضاع اللاعبين وانتقالاتهم</div></div>
            <img src="/img/logo-256.png" alt="" />
            <div className="ltr-b"><div className="b">Libyan Football Federation</div><div>Players Status And Transfers Committee</div></div>
          </div>
          <div className="ec-ct">عقد لاعب كرة قدم محترف</div>
          <div className="ec-nr">رقم <span className="ec-nbox">{c.number ?? ""}</span> Nr</div>
          <div className="ec-cl"><span>اسم اللاعب رباعي/</span><b>{name}</b></div>
          <div className="ec-cl ltr-b"><span>PLAYER NAME:</span><b>{d?.player.nameEn}</b></div>
          <div className="ec-cl"><span>نادي/</span><b>{club}</b></div>
          <div className="ec-cl ltr-b"><span>CLUB:</span><b></b></div>
          <div className="ec-note">(أعد هذا العقد وتم إصداره من الاتحاد الليبي لكرة القدم كنموذج موحد ولا يعتد بأي نموذج آخر)</div>
        </div>
      </div>

      <Sheet n={1} title="عقد لاعب كرة قدم محترف">
        <p>إنه في يوم {v(dayName(d?.signDate), "..........")} الموافق {v(dmy(d?.signDate), "..../..../20....")}م. في مدينة {v(d?.signCity, "..............")} بدولة {v(d?.signCountry, "..............")}.</p>
        <p className="ec-k">- تم الاتفاق بين كل من:-</p>
        <p>1. نادي/ {v(club)} . عنوانه/ {v(d?.club.address)} هاتف ({v(d?.club.phone && <span className="ltr">{d.club.phone}</span>, "..............")}). البريد الالكتروني/ {v(d?.club.email && <span className="ltr">{d.club.email}</span>)} ويمثله في التوقيع على هذا العقد السيد/ {v(d?.club.repName)} بصفته {v(d?.club.repTitle, "رئيس النادي")}. ويشار إليه في هذا العقد <b>&quot;بالطرف الأول&quot;</b></p>
        <p>2. اللاعب/ {v(name)} الجنسية/ {v(d?.player.nationality, "..............")} مكان الميلاد/ {v(d?.player.birthPlace, "..............")}. تاريخ الميلاد: {v(dmy(d?.player.birthDate), "..../..../......")} رقم الاثبات الشخصي ({v(d?.player.idNumber && <span className="ltr">{d.player.idNumber}</span>, "..................")}) نوعه: {v(d?.player.idType, "..........")} مكان الاصدار/ {v(d?.player.idIssuePlace, "..........")} تاريخ الاصدار: {v(dmy(d?.player.idIssueDate), "..../..../......")} صلاحيته: {v(dmy(d?.player.idExpiry), "..../..../......")} العنوان/ {v(d?.player.address)} هاتف ({v(d?.player.phone && <span className="ltr">{d.player.phone}</span>, "..............")}). البريد الالكتروني/ {v(d?.player.email && <span className="ltr">{d.player.email}</span>)} ويشار إليه في هذا العقد <b>&quot;بالطرف الثاني&quot;</b></p>
        <p>3. و بحضور وكيل اللاعب. السيد/ {v(d?.agent?.name)} الجنسية/ {v(d?.agent?.nationality, "..........")} رقم جواز السفر ({v(d?.agent?.passportNo && <span className="ltr">{d.agent.passportNo}</span>, "..............")}). مكان الاصدار/ {v(d?.agent?.passportPlace, "..........")} تاريخ الاصدار {v(dmy(d?.agent?.passportIssue), "..../..../......")} صلاحيته {v(dmy(d?.agent?.passportExpiry), "..../..../......")} المعتمد بموجب بطاقة رقم [{v(d?.agent?.licenseNo && <span className="ltr">{d.agent.licenseNo}</span>, "..........")}] الصادرة عن {v(d?.agent?.licenseIssuer, "..............")} صالحة حتى تاريخ {v(dmy(d?.agent?.licenseExpiry), "..../..../......")}.</p>
        {!d?.agent && <p className="ec-small">(لا يوجد وكيل للاعب في هذا العقد)</p>}
      </Sheet>

      <Sheet n={2}>
        <p className="ec-art">التمهيد</p>
        <p>حيث أن الطرف الأول (النادي) يرغب في إبرام علاقة تعاقدية ملزمة قانوناً مع الطرف الثاني (اللاعب) من أجل الاستفادة من خدماته كلاعب كرة قدم محترف للعب معه بالفريق الاول لكرة القدم، وحيث أن الطرف الثاني يوافق على اللعب مع الطرف الأول كلاعب محترف طبقاً لشروط هذا العقد وأحكامه. وبعد أن أقرّ الطرفان بأهليتهما القانونية للتعاقد، فقد اتفقا الطرفان وتراضيا فيما بينهما على إبرام هذا العقد وفقاً لشروطه وأحكامه.</p>
        <p className="ec-art">المادة (1)</p>
        <p>يُعتبر هذا التمهيد جزءاً لا يتجزأ من هذا العقد</p>
        <p className="ec-art">المادة (2)</p>
        <p>مدة هذا العقد ({v(d?.duration, "..............")}). يبدأ سريان هذا العقد من يوم/ {v(dayName(c.startDate), "..........")} الموافق: {v(dmy(c.startDate), "..../..../20....")}م.
          {" "}وينتهي بانتهاء الموسم الرياضي ({v(d?.termType === "SEASON" ? <span className="ltr">{d.endSeason}</span> : null, "20....م/20....م")}). للعقد المحدد بنهاية موسمية.
          {" "}وينتهي في يوم/ {v(d?.termType === "DATE" ? dayName(c.endDate) : null, "..........")}. الموافق: {v(d?.termType === "DATE" ? dmy(c.endDate) : null, "..../..../20....")}م. للعقد المحدد بفترة زمنية.</p>
        <p className="ec-art">المادة (3)</p>
        <p>يلتزم الطرفان باحترام هذا العقد وتنفيذ القوانين واللوائح والقرارات والتعميمات الصادرة عن الاتحاد الليبي لكرة القدم (LFF) ولجانه ذات الاختصاص والاتحادين الدولي (FIFA) والافريقي (CAF).</p>
        <p className="ec-art">المادة (4) المقابل المالي</p>
        <p>1. اتفق الطرفان على تحديد قيمة هذا العقد عن كامل المدة ب{amt("totalValue")}</p>
        <p>2. يلتزم الطرف الأول بدفع قيمة هذا العقد وفق الآلية التالية:</p>
        <p className="ec-in">أ. {amt("signingBonus")} يدفع كمقدم عقد للطرف الثاني من القيمة الإجمالية للعقد فور توقيعه إذا اتفق الطرفان على ذلك، وتعتبر هذه القيمة مقدم مرتبات.</p>
        <p className="ec-in">ب. {amt("monthlySalary")} كراتب شهري يدفع للطرف الثاني من القيمة الاجمالية للعقد في نهاية كل شهر ميلادي طيلة مدة هذا العقد.</p>
      </Sheet>

      <Sheet n={3}>
        <p>3. {amt("housingAmount")} يدفعه الطرف الأول للطرف الثاني بدل سكن سنوي (حسب الاتفاق بين الطرفين).</p>
        <p>4. {amt("transportAmount")} بدل مواصلات (حسب الاتفاق بين الطرفين).</p>
        <p>5. يتحمل الطرف الثاني القيمة المالية المقررة بنسبة (3%) ثلاثة في المائة تستقطع من قبل الطرف الأول من إجمالي قيمة العقد لصالح الاتحاد الليبي لكرة القدم عند اعتماده من لجنة أوضاع اللاعبين وانتقالاتهم المحلية.</p>
        <p>6. يتحمل الطرف الأول مسؤولية إيداع نسخة من هذا العقد لدى مصلحة الضرائب.</p>
        <p className="ec-art">المادة (5) التزامات الطرف الأول</p>
        <p>يلتزم الطرف الاول تجاه الطرف الثاني بالآتي:</p>
        {ol([
          "تسديد قيمة الرواتب الشهرية في حينها طيلة مدة العقد.",
          "إخطار اللاعب بصورة من اللائحة الداخلية للنادي المعتمدة من لجنة أوضاع اللاعبين وانتقالاتهم.",
          "تسليم اللاعب نسخة من هذا العقد فور توقيعه.",
          "السماح للاعب المحلي الذي يقع عليه الاختيار ضمن صفوف المنتخب الوطني بالالتحاق فوراً عند طلبه من الاتحاد للتدريب أو اللعب في المباريات الدولية والقارية والإقليمية والودية.",
          "السماح للاعب الاجنبي بالالتحاق بمنتخب بلاده عند طلبه طبقاً للضوابط المنصوص عليها بلوائح الاتحاد الدولي (FIFA).",
          "السماح للاعب المحلي بالدراسة وأداء الامتحانات بالداخل بموافقة الطرف الاول.",
          "التأمين الصحي الذي يغطي حالات الإصابة والعجز أو الوفاة طيلة مدة عقد اللاعب مع النادي والحالات التي تمتد آثارها بعد نهاية العقد لمدة (3) ثلاثة أشهر كحد اقصى.",
          "لا يجوز للطرف الأول (النادي) أن يوقع غرامات مالية على الطرف الثاني (اللاعب) بنسبة تزيد عن (50%) من قيمة العقد.",
          "في حالة إصابة اللاعب يتم تطبيق المادة (15) من لائحة أوضاع اللاعبين وانتقالاتهم المحلية.",
          "أية امتيازات أخرى يتم الاتفاق والنص عليها في ملحق العقد الإضافي.",
          "إجازة سنوية مدفوعة الأجر لمدة لا تقل عن (28) ثمانية وعشرون يوماً تمنح نهاية كل موسم رياضي يقضيه الطرف الثاني مع النادي وبما لا يتعارض مع مصلحة النادي.",
        ])}
      </Sheet>

      <Sheet n={4}>
        {ol(["دفع مرتبات الطرف الثاني في حالة الاصابة وفق ما تنص عليه أحكام لائحة أوضاع اللاعبين وانتقالاتهم المحلية."], 12)}
        <p className="ec-art">المادة (6) التزامات الطرف الثاني</p>
        <p>يلتزم الطرف الثاني تجاه الطرف الاول بالآتي:</p>
        {ol([
          "التفرغ لمهمته كلاعب محترف والعمل على تحقيق أهداف الطرف الأول (النادي).",
          "حضور التدريبات والمعسكرات والندوات والمؤتمرات الصحفية والمشاركة في المباريات الرسمية والودية مع النادي حسب المواعيد المقررة.",
          "عدم القيام بأي عمل خارج وظيفته الأصلية ومهامه كلاعب بالنادي إلا بموافقة الطرف الأول كتابياً وبعد التأكد بأن هذا العمل لا يتعارض ومهامه كلاعب.",
          "عدم قبول أي دعم مادي أو هدايا من أية جهة كانت دون الحصول على موافقة الطرف الأول.",
          "أن يؤدي مهامه بدقة وأمانة وأن يحافظ على المواعيد المحددة له وأن يلتزم بكافة بنود هذا العقد.",
          "أن يحافظ على الأدوات والمهمات التي يستعملها أثناء تنفيذ مهامه.",
          "الالتزام على الفور لكافة طلبات ومتطلبات هيئات مكافحة المنشطات المحلية والدولية المختصة.",
          "الالتزام بتنفيذ كافة اللوائح والنظم الداخلية المعمول بها في النادي وقبول قرارات المسؤولين في المباراة وتمثيل الطرف الأول خير تمثيل والمحافظة على أسراره وعدم الاساءة له ولمنتسبيه والجماهير بأي شكل من الاشكال.",
          "التقيد بالتشريعات المحلية واحترام عادات وتقاليد المجتمع.",
          "الالتحاق بالمنتخب الوطني في حالة استدعائه وفقاً لما تنص عليه لائحة أوضاع اللاعبين وانتقالاتهم المحلية ولائحة المنتخبات الوطنية واللوائح الدولية.",
          "الحصول على الموافقة الكتابية من الطرف الأول في حالة مغادرته لمدينة أو دولة مقر النادي أثناء الموسم الرياضي أو الإجازات.",
          "إخطار الطرف الأول عند إصابته أو مرضه وعدم استخدام أي علاج طبي دون علم طبيب النادي عدا الحالات الطارئة والالتزام بالعلاج المقرر له بموافقة طبيب النادي. وتمنح الاجازات المرضية بناء على شهادة صادرة من إحدى الجهات الطبية المعتمدة من الاتحاد أو طبيب النادي وفق أحكام لائحة أوضاع اللاعبين المحلية.",
        ])}
      </Sheet>

      <Sheet n={5}>
        {ol([
          "إخطار الطرف الأول والحصول على موافقته عند التفاوض والتعاقد مع نادٍ جديد، إلا إذا كان هذا العقد انتهى أو سينتهي خلال الستة الأشهر الأخيرة منه.",
          "عدم إجراء أية مفاوضات مع الأندية أو أية جهة أخرى أثناء تواجده بمعسكرات المنتخبات الوطنية وأية مخالفة من قبل اللاعب ستجعله عرضة للعقوبات المنصوص عليها في لوائح الاتحاد.",
          "احترام الاتفاقيات والعقود المبرمة مع الرعاة الرسميين للطرف الأول وبما لا يتعارض مع نصوص لائحة أوضاع اللاعبين وانتقالاتهم ولائحة التسويق بالاتحاد.",
          "الامتناع عن أي تصرف أو الأدلاء بأي تصريحات في وسائل الاعلام المختلفة أو التعليق على الصفحات الإلكترونية، تسئ لسمعة الطرف الأول ولشركائه ورعاته.",
          "عدم المشاركة أو اللعب في أية مباراة ودية أو خيرية مع أي نادٍ آخر أو أية جهة أخرى كانت إلا بموافقة خطية من الطرف الأول.",
          "عدم اعتزال اللعب بإرادته المنفردة خلال مدة سريان العقد بدون موافقة الطرف الأول.",
        ], 13)}
        <p className="ec-art">المادة (7)</p>
        <p>لا يجوز إنهاء هذا العقد بين الطرفين إلا بعد انتهاء مدته أو بالتراضي أو ثبوت عدم تقاضي الطرف الثاني لمرتباته أو لأسباب ومبررات مشروعة لأي من الطرفين بما يتوافق وأحكام لائحة أوضاع اللاعبين وانتقالاتهم المحلية.</p>
        <p className="ec-art">المادة (8)</p>
        <p>لا يجوز إنهاء هذا العقد من طرف واحد أثناء الموسم الرياضي في حالة السبب الغير مشروع (بعد انتهاء الفترة المحمية أو في حالة الفسخ الرياضي العادل).</p>
        <p className="ec-art">المادة (9)</p>
        <p>يحق للطرف الاول اتخاذ قرارات وعقوبات ضد الطرف الثاني في حال ثبوت إخلاله بالتزاماته المنصوص عليها في لائحة أوضاع اللاعبين وانتقالاتهم المحلية واللائحة الداخلية للنادي أو في هذا العقد على أن يُخطر الطرف الثاني كتابياً بذلك، ويحق للطرف الثاني الاعتراض والتظلم منها والاستئناف لدى اللجان المختصة في الاتحاد.</p>
        <p className="ec-art">المادة (10)</p>
        <p>يجوز للطرف الأول إعارة الطرف الثاني لنادٍ آخر بموجب عقد إعارة وفقاً للضوابط المنصوص عليها بلائحة أوضاع اللاعبين وانتقالاتهم المحلية.</p>
      </Sheet>

      <Sheet n={6}>
        <p className="ec-art">المادة (11)</p>
        <p>للطرف الأول الحق في استثمار صور الطرف الثاني، وللطرف الثاني الحق في استثمار أسمه وصورته الفردية في الإعلان بعد موافقة الطرف الأول كتابياً على شكل ومضمون الإعلان، على ألا يتعارض الإعلان مع النظام العام والآداب للدولة، والامتناع عن الإعلان للمنتجات المضرة بالصحة العامة.</p>
        <p className="ec-art">المادة (12)</p>
        <p>يجوز تعديل وإضافة شروط أخرى على هذا العقد بموافقة الطرفين بموجب ملحق عقد إضافي يوقع عليه الطرفين ويحيل النادي نسخ ملحق العقد الإضافي إلى لجنة أوضاع اللاعبين وانتقالاتهم بالاتحاد للاعتماد في موعد أقصاه (10) عشرة أيام عمل من تاريخ توقيعه، ويُعد باطلاً أي نص يرد بملحق العقد الإضافي يتعارض مع القوانين واللوائح والتعميمات الصادرة عن الاتحاد الليبي لكرة القدم (LFF) ولجانه ذات الاختصاص والاتحادين الدولي (FIFA) والافريقي (CAF).</p>
        <p className="ec-art">المادة (13) تسوية المنازعات</p>
        {ol([
          "يسعى الطرفان لحل خلافاتهما حول تنفيذ بنود العقد بالتسوية الودية إن أمكن.",
          "تختص غرفة فض المنازعات بالاتحاد حال تشكيلها النظر في المنازعات التي تنشأ بين الطرفين حول هذا العقد ذات البعد المحلي.",
          "تخضع المنازعات ذات البعد الدولي للاختصاص القضائي لغرفة فض المنازعات بالاتحاد الدولي لكرة القدم (FIFA)، ويجوز لأطراف هذا العقد الاتفاق على الاختصاص القضائي لغرفة فض المنازعات التابعة للاتحاد الليبي لكرة القدم (LFF).",
        ])}
        <p className="ec-art">المادة (14)</p>
        <p>اللغة العربية هي اللغة المعتمدة لهذا العقد ويترجم إلى لغة اجنبية أخرى معتمدة لدى الاتحاد الدولي لكرة القدم إذا كان الطرف الثاني أجنبي غير ناطق باللغة العربية.</p>
        <p className="ec-art">المادة (15)</p>
        <p>يحرر هذا العقد من (5) خمسة نسخ موقع حسب الأصول على جميع صفحاته ومؤرخ بالصفحة الاخيرة ومختوم من قبل الطرف الأول وتسلم نسخه منه للطرف الثاني فور توقيعه وتحال النسخ الأربعة الأخرى إلى لجنة أوضاع اللاعبين لاعتمادها وتوزع وفق أحكام لائحة أوضاع اللاعبين وانتقالاتهم المحلية.</p>
      </Sheet>

      <Sheet n={7}>
        <p className="ec-art">المادة (16)</p>
        <p>يعتبر هذا العقد ملزماً للطرفين من تاريخ التوقيع عليه ويكون نافذاً تجاه الأخرين بعد المصادقة عليه من لجنة أوضاع اللاعبين وانتقالاتهم.</p>
        <p className="ec-art">المادة (17)</p>
        <p>تطبق أحكام لائحة أوضاع اللاعبين وانتقالاتهم بالاتحادين الليبي (LFF) والدولي (FIFA) لكرة القدم فيما لم يرد بشأنه نص في هذا العقد.</p>
        <p className="ec-art" style={{ textAlign: "center", marginTop: "8mm" }}>التوقيعات</p>
        <div className="ec-sigs">
          <div>
            <div className="h">الطرف الأول (النادي)</div>
            <div>الاسم/ {v(d?.club.repName)}</div>
            <div>الصفة/ {v(d?.club.repTitle)}</div>
            <div>التوقيع ( <span className="ec-sl" /> )</div>
            <div className="ec-stamp">ختم النادي</div>
          </div>
          <div>
            <div className="h">الطرف الثاني (اللاعب)</div>
            <div>الاسم/ {v(name)}</div>
            <div>الصفة/ <b className="ec-v">لاعب محترف</b></div>
            <div>التوقيع ( <span className="ec-sl" /> )</div>
            <div className="ec-finger">بصمة اللاعب</div>
          </div>
        </div>
        <p style={{ textAlign: "center" }}>التاريخ: {v(dmy(d?.signDate), "..../..../20....")}م</p>
        <div className="ec-approve">
          <div className="h">يعتمد // رئيس لجنة اوضاع اللاعبين وانتقالاتهم</div>
          <div className="row3">
            <div>الاسم/ <span className="ec-dots">..................</span></div><div>الصفة/ <span className="ec-dots">..................</span></div><div>التوقيع/ <span className="ec-dots">..................</span></div>
          </div>
          <div className="row3"><div className="ec-stamp sm">ختم اللجنة</div><div>التاريخ: {v(c.reviewedAt ? dmy(c.reviewedAt.toLocaleDateString("en-CA", { timeZone: "Africa/Tripoli" })) : null, "..../..../20....")}م</div><div>رقم العقد: {v(c.number && <span className="ltr">{c.number}</span>, "..........")}</div></div>
        </div>
      </Sheet>

      {c.otherBenefits && (
        <Sheet n={8} title="ملحق العقد الإضافي">
          <p>ملحق لعقد اللاعب/ <b className="ec-v">{name}</b> مع نادي/ <b className="ec-v">{club}</b>، يُعد جزءاً من العقد ويخضع للمادة (12) منه:</p>
          <div className="ec-annex">{c.otherBenefits}</div>
        </Sheet>
      )}
    </div>
  );
}

const CSS = `
.ec { font-family: "Cairo", "Traditional Arabic", Tahoma, sans-serif; color: #000; padding: 10mm 16mm 26mm; page-break-after: always; break-after: page; font-size: 11pt; line-height: 1.95; margin-bottom: 1rem; overflow: hidden; }
.ec:last-child { page-break-after: auto; break-after: auto; }
.ec .ltr, .ec-v .ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
.ec p { margin: 0 0 2.2mm; text-align: justify; }
.ec-wm { position: absolute; top: 45%; left: 0; right: 0; text-align: center; font-size: 90pt; font-weight: 800; color: rgba(200,0,0,.07); transform: rotate(-25deg); pointer-events: none; }
.ec-head { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #0b5d3b; padding-bottom: 2mm; margin-bottom: 4mm; }
.ec-head img { width: 18mm; height: 18mm; object-fit: contain; }
.ec-head .ar { font-weight: 800; font-size: 13pt; } .ec-head .en { font-weight: 700; font-size: 11pt; direction: ltr; }
.ec-title { text-align: center; font-weight: 800; font-size: 15pt; margin: 2mm 0 4mm; text-decoration: underline; }
.ec-art { font-weight: 800; text-decoration: underline; margin-top: 3mm !important; }
.ec-k { font-weight: 800; }
.ec-in { padding-inline-start: 7mm; }
.ec-small { font-size: 9pt; color: #555; }
.ec-v { font-weight: 800; color: #0a2d6e; }
.ec-dots { color: #555; letter-spacing: 1px; }
.ec-box { display: inline-block; min-width: 26mm; border: 1.2px solid #000; text-align: center; padding: 0 2mm; line-height: 1.5; }
.ec-ol { margin: 0 0 2mm; padding-inline-start: 7mm; } .ec-ol li { margin-bottom: 1.2mm; text-align: justify; }
.ec-foot { position: absolute; bottom: 9mm; inset-inline: 16mm; display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid #999; padding-top: 2mm; font-size: 10pt; font-weight: 700; }
.ec-foot .pg { font-weight: 800; border: 1px solid #000; border-radius: 50%; width: 7mm; height: 7mm; display: flex; align-items: center; justify-content: center; font-size: 9pt; }
.ec-sl { display: inline-block; width: 38mm; border-bottom: 1px dotted #000; }
.ec-cover { padding: 12mm; }
.ec-frame { border: 4px double #0b5d3b; height: 271mm; padding: 10mm 12mm; position: relative; display: flex; flex-direction: column; }
.ec-ch { display: flex; justify-content: space-between; align-items: center; font-size: 11pt; }
.ec-ch .b { font-weight: 800; font-size: 13pt; } .ec-ch img { width: 30mm; height: 30mm; object-fit: contain; }
.ltr-b { direction: ltr; text-align: left; }
.ec-ct { text-align: center; font-weight: 800; font-size: 26pt; margin: 22mm 0 10mm; }
.ec-nr { text-align: center; font-weight: 800; font-size: 15pt; margin-bottom: 18mm; }
.ec-nbox { display: inline-block; min-width: 50mm; border: 2px solid #000; padding: 1mm 4mm; margin: 0 4mm; direction: ltr; }
.ec-cl { display: flex; gap: 4mm; font-size: 14pt; font-weight: 700; margin-bottom: 9mm; align-items: baseline; }
.ec-cl b { flex: 1; border-bottom: 1px dotted #000; min-height: 9mm; color: #0a2d6e; }
.ec-note { margin-top: auto; text-align: center; font-size: 10pt; font-weight: 700; }
.ec-sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin: 4mm 0; }
.ec-sigs > div { line-height: 2.4; } .ec-sigs .h, .ec-approve .h { font-weight: 800; text-decoration: underline; }
.ec-stamp, .ec-finger { width: 30mm; height: 30mm; border: 1.5px dashed #555; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #555; margin-top: 2mm; }
.ec-stamp { border-radius: 50%; } .ec-stamp.sm { width: 24mm; height: 24mm; }
.ec-approve { border: 1.5px solid #000; padding: 3mm 5mm; margin-top: 4mm; }
.ec-approve .row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; align-items: center; margin-top: 2mm; }
.ec-annex { white-space: pre-wrap; border: 1px solid #999; padding: 4mm; min-height: 80mm; line-height: 2; }
@media print { @page { size: A4; margin: 0; } .ec { min-height: 297mm; height: 297mm; margin: 0; } }
`;
