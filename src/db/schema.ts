// منظومة لجان الاتحاد الليبي لكرة القدم — مخطط قاعدة البيانات (Drizzle / PostgreSQL)
import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  pgTable, pgEnum, serial, integer, bigserial, text, boolean, timestamp, date, jsonb, real,
  numeric, primaryKey, uniqueIndex, index, uuid,
} from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const d = (n: string) => date(n, { mode: "string" });

// ======================= المستخدمون والصلاحيات =======================
export const roleEnum = pgEnum("role", [
  "ADMIN", "PRESIDENT", "SECRETARY_GENERAL",
  "REG_HEAD", "REG_STAFF", "COMP_HEAD", "COMP_STAFF", "REF_HEAD", "REF_STAFF",
  "CLUB_MANAGER", "CLUB_EMPLOYEE", "CLUB_VIEWER", "REFEREE", "OBSERVER", "FIN_HEAD", "FIN_STAFF", "SEC_STAFF",
]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  role: roleEnum("role").notNull(),
  clubId: integer("club_id").references(() => clubs.id),
  officialId: integer("official_id").unique().references(() => officials.id),
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedAt: ts("verified_at"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const rolePermissions = pgTable("role_permissions", {
  role: roleEnum("role").notNull(),
  permission: text("permission").notNull(),
}, (t) => [primaryKey({ columns: [t.role, t.permission] })]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: ts("at").notNull().defaultNow(),
  userId: integer("user_id"),
  userName: text("user_name"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  details: text("details"),
}, (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_at_idx").on(t.at)]);

export const notifications = pgTable("notifications", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  isRead: boolean("is_read").notNull().default(false),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("notif_user_idx").on(t.userId, t.isRead)]);

export const counters = pgTable("counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
});

// ======================= المواسم والأندية =======================
export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  startDate: d("start_date").notNull(),
  endDate: d("end_date").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  notes: text("notes"),
});

export const registrationWindows = pgTable("registration_windows", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  startDate: d("start_date").notNull(),
  endDate: d("end_date").notNull(),
  isException: boolean("is_exception").notNull().default(false),
  clubId: integer("club_id").references(() => clubs.id), // استثناء لنادٍ بعينه
  isClosed: boolean("is_closed").notNull().default(false),
});

export const ageCategories = pgTable("age_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  maxAge: integer("max_age"), // null = الفريق الأول
  maxForeign: integer("max_foreign"), // الحد الأقصى للتعاقد مع الأجانب لكل نادٍ في هذه الفئة (null = بلا حد)
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const clubs = pgTable("clubs", {
  id: serial("id").primaryKey(),
  code: text("code").unique(),
  name: text("name").notNull().unique(),
  nameEn: text("name_en"),
  shortName: text("short_name"),
  city: text("city"),
  region: text("region"),
  stadium: text("stadium"), // قديم: اسم الملعب نصًا — حلّ محله الملعب الأساسي والاحتياطي من سجل الملاعب
  mainStadiumId: integer("main_stadium_id").references((): AnyPgColumn => stadiums.id, { onDelete: "set null" }), // م26: الملعب الأساسي
  backupStadiumId: integer("backup_stadium_id").references((): AnyPgColumn => stadiums.id, { onDelete: "set null" }), // م26: الملعب البديل
  phone: text("phone"),
  email: text("email"),
  logoKey: text("logo_key"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ======================= القيد وأوضاع اللاعبين =======================
export const genderEnum = pgEnum("gender", ["MALE", "FEMALE"]);
export const playerStatusEnum = pgEnum("player_status", ["ACTIVE", "RETIRED", "BLOCKED"]);
export const proLevelEnum = pgEnum("pro_level", ["AMATEUR", "AMATEUR_CONTRACT", "PROFESSIONAL"]);
export const positionEnum = pgEnum("position", ["UNKNOWN", "GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD"]);

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  fullNameEn: text("full_name_en"),
  motherName: text("mother_name"),
  nationalId: text("national_id").unique(),
  passportNo: text("passport_no"),
  dateOfBirth: d("date_of_birth").notNull(),
  placeOfBirth: text("place_of_birth"),
  gender: genderEnum("gender").notNull().default("MALE"),
  nationality: text("nationality").notNull().default("ليبي"),
  isForeign: boolean("is_foreign").notNull().default(false),
  position: positionEnum("position").notNull().default("UNKNOWN"),
  professionalLevel: proLevelEnum("professional_level").notNull().default("AMATEUR"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  photoKey: text("photo_key"),
  photoHash: text("photo_hash"),
  status: playerStatusEnum("status").notNull().default("ACTIVE"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdByClubId: integer("created_by_club_id"),
}, (t) => [index("players_name_idx").on(t.fullName), index("players_dob_idx").on(t.dateOfBirth)]);

export const regTypeEnum = pgEnum("reg_type", ["NEW", "RENEWAL", "TRANSFER", "LOAN", "LOAN_RETURN"]);
export const regStatusEnum = pgEnum("reg_status", [
  "DRAFT", "SUBMITTED", "NEEDS_CORRECTION", "APPROVED", "REJECTED", "CANCELLED", "TRANSFERRED", "EXPIRED",
]);
export const originResponseEnum = pgEnum("origin_response", ["NOT_REQUIRED", "PENDING", "AGREED", "OBJECTED"]);

export const registrations = pgTable("registrations", {
  id: serial("id").primaryKey(),
  number: text("number").unique(),
  playerId: integer("player_id").notNull().references(() => players.id),
  clubId: integer("club_id").notNull().references(() => clubs.id),
  seasonId: integer("season_id").notNull().references(() => seasons.id),
  type: regTypeEnum("type").notNull().default("NEW"),
  status: regStatusEnum("status").notNull().default("DRAFT"),
  categoryId: integer("category_id").references(() => ageCategories.id),
  shirtNumber: integer("shirt_number"),
  contractStart: d("contract_start"),
  contractEnd: d("contract_end"),
  fromClubId: integer("from_club_id").references(() => clubs.id),
  originResponse: originResponseEnum("origin_response").notNull().default("NOT_REQUIRED"),
  originReason: text("origin_reason"),
  originRespondedAt: ts("origin_responded_at"),
  loanEndDate: d("loan_end_date"),
  transferFee: numeric("transfer_fee", { precision: 14, scale: 2 }),
  parentalConsent: boolean("parental_consent").notNull().default(false),
  notes: text("notes"),
  possibleDuplicates: text("possible_duplicates"),
  submittedAt: ts("submitted_at"),
  submittedBy: text("submitted_by"),
  decidedAt: ts("decided_at"),
  decidedBy: text("decided_by"),
  decisionReason: text("decision_reason"),
  verifyToken: uuid("verify_token").notNull().unique().default(sql`gen_random_uuid()`),
  cardPrintCount: integer("card_print_count").notNull().default(0),
  lastCardPrintedAt: ts("last_card_printed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("reg_club_season_idx").on(t.clubId, t.seasonId, t.status), index("reg_player_idx").on(t.playerId)]);

export const documentTypes = pgTable("document_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  requiredFor: text("required_for").array().notNull().default(sql`'{}'::text[]`),
  onlyProfessional: boolean("only_professional").notNull().default(false),
  onlyMinor: boolean("only_minor").notNull().default(false),
  onlyForeign: boolean("only_foreign").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const docStatusEnum = pgEnum("doc_status", ["PENDING", "APPROVED", "REJECTED"]);

export const registrationDocuments = pgTable("registration_documents", {
  id: serial("id").primaryKey(),
  registrationId: integer("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }),
  documentTypeId: integer("document_type_id").notNull().references(() => documentTypes.id),
  fileKey: text("file_key").notNull(),
  originalName: text("original_name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  status: docStatusEnum("status").notNull().default("PENDING"),
  rejectionReason: text("rejection_reason"),
  uploadedAt: ts("uploaded_at").notNull().defaultNow(),
  uploadedBy: text("uploaded_by").notNull(),
  reviewedAt: ts("reviewed_at"),
  reviewedBy: text("reviewed_by"),
});

export const registrationEvents = pgTable("registration_events", {
  id: serial("id").primaryKey(),
  registrationId: integer("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }),
  at: ts("at").notNull().defaultNow(),
  userName: text("user_name").notNull(),
  action: text("action").notNull(),
  note: text("note"),
});

export const suspensionKindEnum = pgEnum("suspension_kind", ["ADMIN", "MATCHES"]);

export const suspensions = pgTable("suspensions", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => players.id),
  kind: suspensionKindEnum("kind").notNull(),
  reason: text("reason").notNull(),
  startDate: d("start_date").notNull().default(sql`CURRENT_DATE`),
  endDate: d("end_date"),
  matchesTotal: integer("matches_total"),
  matchesServed: integer("matches_served").notNull().default(0),
  competitionId: integer("competition_id").references(() => competitions.id),
  sourceMatchId: integer("source_match_id").references(() => matches.id),
  isAutomatic: boolean("is_automatic").notNull().default(false),
  isLifted: boolean("is_lifted").notNull().default(false),
  liftedAt: ts("lifted_at"),
  liftedBy: text("lifted_by"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("susp_player_idx").on(t.playerId)]);

export const listTemplates = pgTable("list_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  columns: jsonb("columns").$type<string[]>().notNull(),
  options: jsonb("options").$type<ListOptions>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type ListOptions = { title?: string; landscape?: boolean; signatures?: string[]; showStamp?: boolean };

export type CardElement = {
  id: string;
  kind: "field" | "text" | "image" | "qr" | "photo" | "logo" | "rect";
  field?: string; // اسم الحقل للبيانات
  text?: string; // نص ثابت أو بادئة
  x: number; y: number; w: number; h: number; // بالملّيمتر
  fontSize?: number; bold?: boolean; color?: string; align?: "right" | "center" | "left";
  bg?: string; radius?: number; imageKey?: string;
};

export const cardTemplates = pgTable("card_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  widthMm: real("width_mm").notNull().default(85.6),
  heightMm: real("height_mm").notNull().default(54),
  frontBg: text("front_bg"),
  backBg: text("back_bg"),
  front: jsonb("front").$type<CardElement[]>().notNull(),
  back: jsonb("back").$type<CardElement[]>(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const cardPrints = pgTable("card_prints", {
  id: serial("id").primaryKey(),
  registrationId: integer("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }),
  templateId: integer("template_id").references(() => cardTemplates.id, { onDelete: "set null" }),
  printedAt: ts("printed_at").notNull().defaultNow(),
  printedBy: text("printed_by").notNull(),
  isReplacement: boolean("is_replacement").notNull().default(false),
  reason: text("reason"),
});

// ======================= المسابقات =======================
export const compTypeEnum = pgEnum("competition_type", ["LEAGUE", "GROUPS", "CUP", "GROUPS_KNOCKOUT"]);
export const compStatusEnum = pgEnum("competition_status", ["DRAFT", "ACTIVE", "FINISHED"]);

export const competitions = pgTable("competitions", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => seasons.id),
  name: text("name").notNull(),
  type: compTypeEnum("type").notNull().default("LEAGUE"),
  categoryId: integer("category_id").references(() => ageCategories.id),
  legs: integer("legs").notNull().default(2),
  pointsWin: integer("points_win").notNull().default(3),
  pointsDraw: integer("points_draw").notNull().default(1),
  squadMax: integer("squad_max").notNull().default(18), // م65: 11 أساسيًا + 7 بدلاء
  startersCount: integer("starters_count").notNull().default(11),
  maxForeign: integer("max_foreign"), // الأجانب في قائمة المباراة
  maxForeignOnPitch: integer("max_foreign_on_pitch"), // الأجانب داخل الملعب في نفس الوقت
  squadListMax: integer("squad_list_max"), // قائمة الموسم (null = غير مطلوبة)
  yellowThreshold: integer("yellow_threshold").notNull().default(3),
  yellowRules: text("yellow_rules"), // مستويات: "3:1,5:2,7:3"
  entryFee: numeric("entry_fee", { precision: 12, scale: 2 }),
  redBanMatches: integer("red_ban_matches").notNull().default(1),
  tiebreak: text("tiebreak").notNull().default("LFF"), // LFF = المادة 24 من لائحة المسابقات، GD = فارق الأهداف أولًا، H2H = المواجهات المباشرة أولًا
  maxSubs: integer("max_subs").notNull().default(3), // م65: التبديلات المسموحة
  maxSubsExtra: integer("max_subs_extra").notNull().default(1), // م65: تبديل إضافي في الوقت الإضافي
  maxLowerCategory: integer("max_lower_category").default(3), // م69: لاعبو الفئة الأدنى في القائمة
  noForeignGK: boolean("no_foreign_gk").notNull().default(true), // م71: لا يحرس المرمى لاعب أجنبي
  forfeitGoals: integer("forfeit_goals").notNull().default(2), // م42/43/68: النتيجة الاعتبارية (صفر - 2)
  status: compStatusEnum("status").notNull().default("DRAFT"),
  startDate: d("start_date"),
  notes: text("notes"),
});

export const competitionTeams = pgTable("competition_teams", {
  id: serial("id").primaryKey(),
  competitionId: integer("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  clubId: integer("club_id").notNull().references(() => clubs.id),
  groupName: text("group_name"),
}, (t) => [uniqueIndex("comp_team_uq").on(t.competitionId, t.clubId)]);

// مراحل المسابقة: دوري، مجموعات، خروج المغلوب — بالترتيب، مع تأهل الفرق من مرحلة لأخرى
export const stageFormatEnum = pgEnum("stage_format", ["LEAGUE", "GROUPS", "KNOCKOUT"]);
export const stageStatusEnum = pgEnum("stage_status", ["PENDING", "ACTIVE", "DONE"]);
export const competitionStages = pgTable("competition_stages", {
  id: serial("id").primaryKey(),
  competitionId: integer("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull().default(1),
  name: text("name").notNull(),
  format: stageFormatEnum("format").notNull().default("LEAGUE"),
  legs: integer("legs").notNull().default(2), // دوري/مجموعات: عدد الأدوار — خروج المغلوب: مباراة أو ذهاب وإياب
  finalLegs: integer("final_legs").notNull().default(1), // خروج المغلوب: النهائي مباراة واحدة أو ذهاب وإياب
  groupsCount: integer("groups_count"),
  qualifyPerGroup: integer("qualify_per_group"), // عدد المتأهلين من كل مجموعة للمرحلة التالية
  status: stageStatusEnum("status").notNull().default("PENDING"),
  notes: text("notes"),
}, (t) => [index("stage_comp_idx").on(t.competitionId, t.seq)]);

export const stageTeams = pgTable("stage_teams", {
  id: serial("id").primaryKey(),
  stageId: integer("stage_id").notNull().references(() => competitionStages.id, { onDelete: "cascade" }),
  clubId: integer("club_id").notNull().references(() => clubs.id),
  groupName: text("group_name"),
  seed: integer("seed"), // الترتيب في المرحلة السابقة (1 = الأول)
  fromGroup: text("from_group"), // المجموعة التي تأهل منها
}, (t) => [uniqueIndex("stage_team_uq").on(t.stageId, t.clubId)]);

export const matchStatusEnum = pgEnum("match_status", ["SCHEDULED", "PLAYED", "POSTPONED", "CANCELLED", "FORFEIT"]);
export const reportStatusEnum = pgEnum("report_status", ["NONE", "SUBMITTED", "RETURNED", "APPROVED"]);

export const matches = pgTable("matches", {
  id: serial("id").primaryKey(),
  competitionId: integer("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  stageId: integer("stage_id").references(() => competitionStages.id, { onDelete: "cascade" }),
  stadiumId: integer("stadium_id").references(() => stadiums.id, { onDelete: "set null" }),
  round: integer("round").notNull().default(1),
  groupName: text("group_name"),
  tieNo: integer("tie_no"), // رقم المواجهة في خروج المغلوب (يجمع الذهاب والإياب)
  leg: integer("leg"),
  homePens: integer("home_pens"),
  awayPens: integer("away_pens"),
  homeClubId: integer("home_club_id").notNull().references(() => clubs.id),
  awayClubId: integer("away_club_id").notNull().references(() => clubs.id),
  kickoff: ts("kickoff"),
  venue: text("venue"),
  city: text("city"),
  status: matchStatusEnum("status").notNull().default("SCHEDULED"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  reportStatus: reportStatusEnum("report_status").notNull().default("NONE"),
  reportNotes: text("report_notes"),
  reportReturn: text("report_return"),
  reportSubmittedAt: ts("report_submitted_at"),
  attendance: integer("attendance"),
  approvedAt: ts("approved_at"),
  approvedBy: text("approved_by"),
  notes: text("notes"),
}, (t) => [index("match_comp_idx").on(t.competitionId, t.round)]);

export const matchSquads = pgTable("match_squads", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  clubId: integer("club_id").notNull().references(() => clubs.id),
  playerId: integer("player_id").notNull().references(() => players.id),
  registrationId: integer("registration_id").notNull().references(() => registrations.id),
  isStarter: boolean("is_starter").notNull().default(true),
  isCaptain: boolean("is_captain").notNull().default(false),
  shirtNumber: integer("shirt_number"),
}, (t) => [uniqueIndex("squad_uq").on(t.matchId, t.playerId)]);

export const eventTypeEnum = pgEnum("event_type", [
  "GOAL", "PENALTY_GOAL", "OWN_GOAL", "YELLOW", "SECOND_YELLOW", "RED", "SUB_IN", "SUB_OUT", "INCIDENT",
]);

export const matchEvents = pgTable("match_events", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  clubId: integer("club_id").notNull().references(() => clubs.id),
  playerId: integer("player_id").references(() => players.id),
  type: eventTypeEnum("type").notNull(),
  minute: integer("minute"),
  note: text("note"),
});

// ======================= الحكام والمراقبون =======================
export const officialTypeEnum = pgEnum("official_type", ["REFEREE", "ASSISTANT", "VAR", "REF_OBSERVER", "COMMISSIONER"]);
export const officialGradeEnum = pgEnum("official_grade", ["INTERNATIONAL", "FIRST", "SECOND", "THIRD", "TRAINEE"]);
export const fitnessEnum = pgEnum("fitness", ["NOT_TESTED", "PASSED", "FAILED"]);
export const officialStatusEnum = pgEnum("official_status", ["ACTIVE", "SUSPENDED", "INJURED", "RETIRED"]);

export const officials = pgTable("officials", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  type: officialTypeEnum("type").notNull(),
  grade: officialGradeEnum("grade").notNull().default("THIRD"),
  city: text("city"),
  phone: text("phone"),
  email: text("email"),
  dateOfBirth: d("date_of_birth"),
  licenseNo: text("license_no"),
  licenseExpiry: d("license_expiry"),
  fitness: fitnessEnum("fitness").notNull().default("NOT_TESTED"),
  lastTestAt: d("last_test_at"),
  status: officialStatusEnum("status").notNull().default("ACTIVE"),
  suspendedUntil: d("suspended_until"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const officialTests = pgTable("official_tests", {
  id: serial("id").primaryKey(),
  officialId: integer("official_id").notNull().references(() => officials.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  date: d("date").notNull(),
  passed: boolean("passed").notNull(),
  score: real("score"),
  notes: text("notes"),
});

export const assignRoleEnum = pgEnum("assign_role", ["REFEREE", "AR1", "AR2", "FOURTH", "VAR", "REF_OBSERVER", "COMMISSIONER"]);
export const assignStatusEnum = pgEnum("assign_status", ["DRAFT", "APPROVED", "DECLINED"]);

export const assignments = pgTable("assignments", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  officialId: integer("official_id").notNull().references(() => officials.id),
  role: assignRoleEnum("role").notNull(),
  status: assignStatusEnum("status").notNull().default("DRAFT"),
  assignedBy: text("assigned_by").notNull(),
  assignedAt: ts("assigned_at").notNull().defaultNow(),
  approvedBy: text("approved_by"),
  approvedAt: ts("approved_at"),
  declineReason: text("decline_reason"),
  fee: numeric("fee", { precision: 10, scale: 2 }),
}, (t) => [uniqueIndex("assign_uq").on(t.matchId, t.role)]);

export const evaluations = pgTable("evaluations", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  observerId: integer("observer_id").notNull().references(() => officials.id),
  officialId: integer("official_id").notNull().references(() => officials.id),
  role: assignRoleEnum("role").notNull(),
  score: real("score").notNull(),
  positioning: integer("positioning"),
  fitness: integer("fitness"),
  decisions: integer("decisions"),
  control: integer("control"),
  notes: text("notes"),
  isSubmitted: boolean("is_submitted").notNull().default(false),
  submittedAt: ts("submitted_at"),
}, (t) => [uniqueIndex("eval_uq").on(t.matchId, t.officialId)]);

export const commissionerReports = pgTable("commissioner_reports", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull().unique().references(() => matches.id, { onDelete: "cascade" }),
  officialId: integer("official_id").notNull().references(() => officials.id),
  actualKickoff: text("actual_kickoff"),
  attendance: integer("attendance"),
  pitch: text("pitch"),
  organization: text("organization"),
  security: text("security"),
  incidents: text("incidents"),
  recommendations: text("recommendations"),
  isSubmitted: boolean("is_submitted").notNull().default(false),
  submittedAt: ts("submitted_at"),
});

// ======================= المرحلة الثانية =======================

// رموز التحقق: تفعيل الحساب، استعادة كلمة المرور، تغيير البريد
export const tokenKindEnum = pgEnum("token_kind", ["VERIFY", "RESET", "EMAIL_CHANGE"]);
export const userTokens = pgTable("user_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: tokenKindEnum("kind").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  newEmail: text("new_email"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// صندوق الرسائل الصادرة (بريد / SMS) — يحفظ كل رسالة ونتيجة إرسالها
export const outbox = pgTable("outbox", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(), // EMAIL | SMS
  to: text("to").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  link: text("link"),
  userId: integer("user_id"),
  status: text("status").notNull().default("PENDING"), // PENDING | SENT | FAILED | NOT_CONFIGURED
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
});

// العقود
export const contractStatusEnum = pgEnum("contract_status", ["ACTIVE", "TERMINATED", "EXPIRED"]);
export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  registrationId: integer("registration_id").notNull().unique().references(() => registrations.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => players.id),
  clubId: integer("club_id").notNull().references(() => clubs.id),
  startDate: d("start_date").notNull(),
  endDate: d("end_date").notNull(),
  currency: text("currency").notNull().default("LYD"),
  totalValue: numeric("total_value", { precision: 14, scale: 2 }),
  monthlySalary: numeric("monthly_salary", { precision: 12, scale: 2 }),
  signingBonus: numeric("signing_bonus", { precision: 12, scale: 2 }),
  bonuses: text("bonuses"),
  housing: boolean("housing").notNull().default(false),
  transport: boolean("transport").notNull().default(false),
  otherBenefits: text("other_benefits"),
  releaseClause: numeric("release_clause", { precision: 14, scale: 2 }),
  renewalOption: text("renewal_option"),
  notes: text("notes"),
  status: contractStatusEnum("status").notNull().default("ACTIVE"),
  terminatedAt: ts("terminated_at"),
  terminationReason: text("termination_reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// الإداريون والجهاز الفني
export const staffRoleEnum = pgEnum("staff_role", ["COACH", "ASSISTANT_COACH", "GK_COACH", "FITNESS_COACH", "TEAM_MANAGER", "DOCTOR", "PHYSIO", "ADMIN", "OTHER"]);
export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull().references(() => clubs.id),
  seasonId: integer("season_id").notNull().references(() => seasons.id),
  fullName: text("full_name").notNull(),
  role: staffRoleEnum("role").notNull(),
  nationalId: text("national_id"),
  nationality: text("nationality").notNull().default("ليبي"),
  dateOfBirth: d("date_of_birth"),
  phone: text("phone"),
  licenseNo: text("license_no"),
  licenseLevel: text("license_level"),
  photoKey: text("photo_key"),
  documentKey: text("document_key"),
  status: regStatusEnum("status").notNull().default("DRAFT"),
  decisionReason: text("decision_reason"),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  submittedAt: ts("submitted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// لائحة العقوبات (تُعبأ لاحقًا من اللائحة الرسمية)
export const sanctionTypeEnum = pgEnum("sanction_type", [
  "WARNING", "FINE", "MATCH_BAN", "TIME_BAN", "STADIUM_BAN", "POINTS_DEDUCTION", "CLOSED_DOORS", "VENUE_CHANGE", "FORFEIT", "REGISTRATION_BAN",
]);
export const sanctionArticles = pgTable("sanction_articles", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // رقم المادة
  title: text("title").notNull(),
  body: text("body"),
  target: text("target"), // PLAYER | STAFF | CLUB | ANY
  defaultType: sanctionTypeEnum("default_type"),
  minMatches: integer("min_matches"),
  maxMatches: integer("max_matches"),
  minFine: numeric("min_fine", { precision: 12, scale: 2 }),
  maxFine: numeric("max_fine", { precision: 12, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
});

export const sanctionTargetEnum = pgEnum("sanction_target", ["PLAYER", "STAFF", "CLUB"]);
export const sanctionStatusEnum = pgEnum("sanction_status", ["ACTIVE", "APPEALED", "REVOKED", "COMPLETED"]);
export const sanctions = pgTable("sanctions", {
  id: serial("id").primaryKey(),
  number: text("number").notNull().unique(),
  targetType: sanctionTargetEnum("target_type").notNull(),
  playerId: integer("player_id").references(() => players.id),
  staffId: integer("staff_id").references(() => staff.id),
  clubId: integer("club_id").notNull().references(() => clubs.id), // نادي المعاقَب (أو النادي نفسه)
  competitionId: integer("competition_id").references(() => competitions.id),
  stageId: integer("stage_id").references(() => competitionStages.id, { onDelete: "set null" }), // خصم النقاط يُطبق على هذه المرحلة
  matchId: integer("match_id").references(() => matches.id),
  articleId: integer("article_id").references(() => sanctionArticles.id),
  articleText: text("article_text"),
  type: sanctionTypeEnum("type").notNull(),
  matchesCount: integer("matches_count"),
  fromDate: d("from_date"),
  toDate: d("to_date"),
  points: integer("points"),
  fineAmount: numeric("fine_amount", { precision: 12, scale: 2 }),
  reason: text("reason").notNull(),
  decisionDate: d("decision_date").notNull(),
  appealDeadline: d("appeal_deadline"),
  status: sanctionStatusEnum("status").notNull().default("ACTIVE"),
  suspensionId: integer("suspension_id").references(() => suspensions.id),
  chargeId: integer("charge_id"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  notes: text("notes"),
}, (t) => [index("sanction_club_idx").on(t.clubId)]);

export const appealStatusEnum = pgEnum("appeal_status", ["PENDING", "ACCEPTED", "REJECTED", "REDUCED"]);
export const appeals = pgTable("appeals", {
  id: serial("id").primaryKey(),
  sanctionId: integer("sanction_id").notNull().references(() => sanctions.id, { onDelete: "cascade" }),
  clubId: integer("club_id").notNull().references(() => clubs.id),
  text: text("text").notNull(),
  documentKey: text("document_key"),
  submittedBy: text("submitted_by").notNull(),
  submittedAt: ts("submitted_at").notNull().defaultNow(),
  status: appealStatusEnum("status").notNull().default("PENDING"),
  decision: text("decision"),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
});

// قائمة الفريق الموسمية لكل مسابقة
export const competitionSquads = pgTable("competition_squads", {
  id: serial("id").primaryKey(),
  competitionId: integer("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  clubId: integer("club_id").notNull().references(() => clubs.id),
  playerId: integer("player_id").notNull().references(() => players.id),
  addedAt: ts("added_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("comp_squad_uq").on(t.competitionId, t.playerId)]);

// طلبات الأندية على المباريات (تأجيل)
export const matchRequests = pgTable("match_requests", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  clubId: integer("club_id").notNull().references(() => clubs.id),
  kind: text("kind").notNull().default("POSTPONE"),
  reason: text("reason").notNull(),
  proposedDate: ts("proposed_date"),
  documentKey: text("document_key"),
  status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED
  decision: text("decision"),
  decidedBy: text("decided_by"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ======================= اللجنة المالية =======================
export const feeTypes = pgTable("fee_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // REG_NEW, REG_RENEWAL, REG_TRANSFER, REG_LOAN, REG_LOAN_RETURN, CARD_REPLACEMENT, STAFF_REG
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  amountPro: numeric("amount_pro", { precision: 12, scale: 2 }), // قيمة مختلفة للمحترف
  isActive: boolean("is_active").notNull().default(true),
});

export const refereeRates = pgTable("referee_rates", {
  id: serial("id").primaryKey(),
  role: assignRoleEnum("role").notNull(),
  grade: officialGradeEnum("grade"), // null = كل الدرجات
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
}, (t) => [uniqueIndex("rate_uq").on(t.role, t.grade)]);

export const chargeDirectionEnum = pgEnum("charge_direction", ["IN", "OUT"]); // IN مستحق للاتحاد، OUT مستحق على الاتحاد (للحكام)
export const chargeStatusEnum = pgEnum("charge_status", ["OPEN", "PARTIAL", "PAID", "WAIVED", "CANCELLED"]);
export const charges = pgTable("charges", {
  id: serial("id").primaryKey(),
  direction: chargeDirectionEnum("direction").notNull().default("IN"),
  clubId: integer("club_id").references(() => clubs.id),
  officialId: integer("official_id").references(() => officials.id),
  category: text("category").notNull(), // FINE | REG_FEE | CARD_FEE | ENTRY_FEE | STAFF_FEE | REFEREE_FEE | OTHER
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  refType: text("ref_type"),
  refId: integer("ref_id"),
  dueDate: d("due_date"),
  status: chargeStatusEnum("status").notNull().default("OPEN"),
  waiveReason: text("waive_reason"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("charge_club_idx").on(t.clubId, t.status), uniqueIndex("charge_ref_uq").on(t.refType, t.refId, t.officialId)]);

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  receiptNo: text("receipt_no").notNull().unique(),
  direction: chargeDirectionEnum("direction").notNull().default("IN"),
  chargeId: integer("charge_id").notNull().references(() => charges.id),
  clubId: integer("club_id").references(() => clubs.id),
  officialId: integer("official_id").references(() => officials.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  method: text("method").notNull(), // CASH | CHEQUE | TRANSFER
  reference: text("reference"),
  date: d("date").notNull(),
  attachmentKey: text("attachment_key"),
  notes: text("notes"),
  receivedBy: text("received_by").notNull(),
  isVoided: boolean("is_voided").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ======================= العلاقات =======================
export const usersRel = relations(users, ({ one }) => ({
  club: one(clubs, { fields: [users.clubId], references: [clubs.id] }),
  official: one(officials, { fields: [users.officialId], references: [officials.id] }),
}));
export const seasonsRel = relations(seasons, ({ many }) => ({ windows: many(registrationWindows) }));
export const windowsRel = relations(registrationWindows, ({ one }) => ({
  season: one(seasons, { fields: [registrationWindows.seasonId], references: [seasons.id] }),
  club: one(clubs, { fields: [registrationWindows.clubId], references: [clubs.id] }),
}));
export const playersRel = relations(players, ({ many }) => ({ registrations: many(registrations), suspensions: many(suspensions) }));
export const registrationsRel = relations(registrations, ({ one, many }) => ({
  player: one(players, { fields: [registrations.playerId], references: [players.id] }),
  club: one(clubs, { fields: [registrations.clubId], references: [clubs.id], relationName: "regClub" }),
  fromClub: one(clubs, { fields: [registrations.fromClubId], references: [clubs.id], relationName: "regFrom" }),
  season: one(seasons, { fields: [registrations.seasonId], references: [seasons.id] }),
  category: one(ageCategories, { fields: [registrations.categoryId], references: [ageCategories.id] }),
  documents: many(registrationDocuments),
  events: many(registrationEvents),
  prints: many(cardPrints),
}));
export const clubsRel = relations(clubs, ({ many }) => ({
  registrations: many(registrations, { relationName: "regClub" }),
  fromRegs: many(registrations, { relationName: "regFrom" }),
}));
export const regDocsRel = relations(registrationDocuments, ({ one }) => ({
  registration: one(registrations, { fields: [registrationDocuments.registrationId], references: [registrations.id] }),
  documentType: one(documentTypes, { fields: [registrationDocuments.documentTypeId], references: [documentTypes.id] }),
}));
export const regEventsRel = relations(registrationEvents, ({ one }) => ({
  registration: one(registrations, { fields: [registrationEvents.registrationId], references: [registrations.id] }),
}));
export const cardPrintsRel = relations(cardPrints, ({ one }) => ({
  registration: one(registrations, { fields: [cardPrints.registrationId], references: [registrations.id] }),
}));
export const suspensionsRel = relations(suspensions, ({ one }) => ({
  player: one(players, { fields: [suspensions.playerId], references: [players.id] }),
  competition: one(competitions, { fields: [suspensions.competitionId], references: [competitions.id] }),
  sourceMatch: one(matches, { fields: [suspensions.sourceMatchId], references: [matches.id] }),
}));
export const competitionsRel = relations(competitions, ({ one, many }) => ({
  season: one(seasons, { fields: [competitions.seasonId], references: [seasons.id] }),
  category: one(ageCategories, { fields: [competitions.categoryId], references: [ageCategories.id] }),
  teams: many(competitionTeams),
  matches: many(matches),
}));
export const compTeamsRel = relations(competitionTeams, ({ one }) => ({
  competition: one(competitions, { fields: [competitionTeams.competitionId], references: [competitions.id] }),
  club: one(clubs, { fields: [competitionTeams.clubId], references: [clubs.id] }),
}));
export const matchesRel = relations(matches, ({ one, many }) => ({
  competition: one(competitions, { fields: [matches.competitionId], references: [competitions.id] }),
  homeClub: one(clubs, { fields: [matches.homeClubId], references: [clubs.id], relationName: "home" }),
  awayClub: one(clubs, { fields: [matches.awayClubId], references: [clubs.id], relationName: "away" }),
  squads: many(matchSquads),
  events: many(matchEvents),
  assignments: many(assignments),
  evaluations: many(evaluations),
}));
export const squadsRel = relations(matchSquads, ({ one }) => ({
  match: one(matches, { fields: [matchSquads.matchId], references: [matches.id] }),
  player: one(players, { fields: [matchSquads.playerId], references: [players.id] }),
  registration: one(registrations, { fields: [matchSquads.registrationId], references: [registrations.id] }),
}));
export const eventsRel = relations(matchEvents, ({ one }) => ({
  match: one(matches, { fields: [matchEvents.matchId], references: [matches.id] }),
  player: one(players, { fields: [matchEvents.playerId], references: [players.id] }),
}));
export const officialsRel = relations(officials, ({ many }) => ({ tests: many(officialTests), assignments: many(assignments) }));
export const testsRel = relations(officialTests, ({ one }) => ({ official: one(officials, { fields: [officialTests.officialId], references: [officials.id] }) }));
export const assignmentsRel = relations(assignments, ({ one }) => ({
  match: one(matches, { fields: [assignments.matchId], references: [matches.id] }),
  official: one(officials, { fields: [assignments.officialId], references: [officials.id] }),
}));
export const evaluationsRel = relations(evaluations, ({ one }) => ({
  match: one(matches, { fields: [evaluations.matchId], references: [matches.id] }),
  observer: one(officials, { fields: [evaluations.observerId], references: [officials.id], relationName: "evaluator" }),
  official: one(officials, { fields: [evaluations.officialId], references: [officials.id], relationName: "evaluated" }),
}));
export const commReportsRel = relations(commissionerReports, ({ one }) => ({
  match: one(matches, { fields: [commissionerReports.matchId], references: [matches.id] }),
  official: one(officials, { fields: [commissionerReports.officialId], references: [officials.id] }),
}));

export type Role = (typeof roleEnum.enumValues)[number];
export type RegStatus = (typeof regStatusEnum.enumValues)[number];
export type RegType = (typeof regTypeEnum.enumValues)[number];

// مكتبة اللوائح (لائحة تنظيم المسابقات، لائحة الانضباط، أوضاع اللاعبين ...) — متاحة لكل المستخدمين
export const regulations = pgTable("regulations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("OTHER"), // COMPETITIONS | DISCIPLINE | STATUS | REFEREES | FINANCE | OTHER
  fileKey: text("file_key").notNull(),
  fileName: text("file_name"),
  approvedOn: d("approved_on"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});


// ======================= سجل الملاعب =======================
export const stadiums = pgTable("stadiums", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  city: text("city"),
  capacity: integer("capacity"),
  clubId: integer("club_id").references(() => clubs.id, { onDelete: "set null" }), // غير مستخدم: الأندية تختار ملاعبها (الأساسي والاحتياطي)
  surface: text("surface").notNull().default("NATURAL"), // NATURAL | ARTIFICIAL
  hasLights: boolean("has_lights").notNull().default(false),
  status: text("status").notNull().default("APPROVED"), // APPROVED | CONDITIONAL | SUSPENDED | CLOSED
  approvalUntil: d("approval_until"),
  lastInspection: d("last_inspection"),
  suspendedUntil: d("suspended_until"),
  suspensionReason: text("suspension_reason"),
  decisionRef: text("decision_ref"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const stadiumInspections = pgTable("stadium_inspections", {
  id: serial("id").primaryKey(),
  stadiumId: integer("stadium_id").notNull().references(() => stadiums.id, { onDelete: "cascade" }),
  date: d("date").notNull(),
  result: text("result").notNull(), // PASS | CONDITIONAL | FAIL
  inspector: text("inspector"),
  notes: text("notes"),
  fileKey: text("file_key"),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ======================= الأمانة العامة =======================
export const correspondence = pgTable("correspondence", {
  id: serial("id").primaryKey(),
  direction: text("direction").notNull(), // IN وارد | OUT صادر
  number: text("number").notNull().unique(),
  refNumber: text("ref_number"), // رقم الجهة المرسلة
  date: d("date").notNull(),
  subject: text("subject").notNull(),
  party: text("party").notNull(), // من / إلى
  committee: text("committee"), // الجهة المختصة داخل الاتحاد
  clubId: integer("club_id").references(() => clubs.id, { onDelete: "set null" }),
  playerId: integer("player_id").references(() => players.id, { onDelete: "set null" }),
  matchId: integer("match_id").references(() => matches.id, { onDelete: "set null" }),
  summary: text("summary"),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  status: text("status").notNull().default("OPEN"), // OPEN | REPLIED | CLOSED
  replyToId: integer("reply_to_id"),
  dueDate: d("due_date"),
  visibleToClub: boolean("visible_to_club").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("corr_date_idx").on(t.date)]);

export const meetings = pgTable("meetings", {
  id: serial("id").primaryKey(),
  body: text("body").notNull(), // BOARD | REG | COMP | REF | FIN | DISC | OTHER
  number: text("number").notNull().unique(),
  date: d("date").notNull(),
  location: text("location"),
  attendees: text("attendees"),
  agenda: text("agenda"),
  minutes: text("minutes"),
  fileKey: text("file_key"),
  status: text("status").notNull().default("DRAFT"), // DRAFT | APPROVED
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const decisions = pgTable("decisions", {
  id: serial("id").primaryKey(),
  number: text("number").notNull().unique(),
  meetingId: integer("meeting_id").references(() => meetings.id, { onDelete: "set null" }),
  body: text("body").notNull(), // الجهة المصدرة
  date: d("date").notNull(),
  title: text("title").notNull(),
  text: text("text"),
  assignee: text("assignee"), // الجهة المكلفة بالتنفيذ
  dueDate: d("due_date"),
  status: text("status").notNull().default("PENDING"), // PENDING | IN_PROGRESS | DONE | CANCELLED
  followUp: text("follow_up"),
  clubId: integer("club_id").references(() => clubs.id, { onDelete: "set null" }),
  fileKey: text("file_key"),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ======================= الأرشيف الإلكتروني =======================
export const archiveDocs = pgTable("archive_docs", {
  id: serial("id").primaryKey(),
  number: text("number").notNull().unique(), // أر/2026/00001
  title: text("title").notNull(),
  category: text("category").notNull().default("OTHER"),
  committee: text("committee"),
  docDate: d("doc_date"),
  refNumber: text("ref_number"), // رقم الوثيقة الأصلي
  description: text("description"),
  tags: text("tags"),
  confidentiality: text("confidentiality").notNull().default("GENERAL"), // GENERAL | COMMITTEE | SECRET
  clubId: integer("club_id").references(() => clubs.id, { onDelete: "set null" }),
  playerId: integer("player_id").references(() => players.id, { onDelete: "set null" }),
  matchId: integer("match_id").references(() => matches.id, { onDelete: "set null" }),
  officialId: integer("official_id").references(() => officials.id, { onDelete: "set null" }),
  competitionId: integer("competition_id").references(() => competitions.id, { onDelete: "set null" }),
  seasonId: integer("season_id").references(() => seasons.id, { onDelete: "set null" }),
  physicalLocation: text("physical_location"), // موقع النسخة الورقية (الخزانة/الرف/الملف)
  retentionUntil: d("retention_until"),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name"),
  mime: text("mime"),
  size: integer("size"),
  hash: text("hash"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("archive_cat_idx").on(t.category, t.docDate), index("archive_hash_idx").on(t.hash)]);

export const archiveVersions = pgTable("archive_versions", {
  id: serial("id").primaryKey(),
  docId: integer("doc_id").notNull().references(() => archiveDocs.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name"),
  replacedBy: text("replaced_by"),
  replacedAt: ts("replaced_at").notNull().defaultNow(),
  note: text("note"),
});
