import {
  mysqlTable,
  varchar,
  int,
  boolean,
  bigint,
  serial,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

// 时间统一用 epoch 毫秒（bigint）存储，避免 MySQL TIMESTAMP 时区换算问题

export const users = mysqlTable(
  "users",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    code: varchar("code", { length: 4 }).notNull(), // 四位数字，对应学号后四位
    name: varchar("name", { length: 50 }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("users_code_name_idx").on(t.code, t.name)],
);

export const sessions = mysqlTable(
  "sessions",
  {
    token: varchar("token", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const polls = mysqlTable(
  "polls",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    creatorId: varchar("creator_id", { length: 64 })
      .notNull()
      .references(() => users.id),
    title: varchar("title", { length: 100 }).notNull(),
    description: varchar("description", { length: 1024 }).notNull().default(""),
    minChoices: int("min_choices").notNull().default(1),
    maxChoices: int("max_choices").notNull().default(1),
    shuffleCandidates: boolean("shuffle_candidates").notNull().default(false),
    anonymous: boolean("anonymous").notNull().default(true),
    deadline: bigint("deadline", { mode: "number" }).notNull(),
    allowChange: boolean("allow_change").notNull().default(false),
    autoPublish: boolean("auto_publish").notNull().default(true),
    pubTopN: int("pub_top_n").notNull().default(-1),
    turnoutMode: varchar("turnout_mode", { length: 16 }).notNull().default("both"),
    published: boolean("published").notNull().default(false),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("polls_creator_idx").on(t.creatorId)],
);

export const candidates = mysqlTable(
  "candidates",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    pollId: varchar("poll_id", { length: 32 })
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 50 }).notNull(),
    sortOrder: int("sort_order").notNull().default(0),
  },
  (t) => [index("candidates_poll_idx").on(t.pollId)],
);

export const voters = mysqlTable(
  "voters",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    pollId: varchar("poll_id", { length: 32 })
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id),
    seq: serial("seq"),
  },
  (t) => [
    index("voters_poll_idx").on(t.pollId),
    index("voters_user_idx").on(t.userId),
    uniqueIndex("voters_poll_user_idx").on(t.pollId, t.userId),
  ],
);

export const ballots = mysqlTable(
  "ballots",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    pollId: varchar("poll_id", { length: 32 })
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    voterId: varchar("voter_id", { length: 64 })
      .notNull()
      .references(() => voters.id, { onDelete: "cascade" }),
    submittedAt: bigint("submitted_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("ballots_poll_idx").on(t.pollId),
    uniqueIndex("ballots_voter_idx").on(t.voterId),
  ],
);

export const choices = mysqlTable(
  "choices",
  {
    ballotId: varchar("ballot_id", { length: 64 })
      .notNull()
      .references(() => ballots.id, { onDelete: "cascade" }),
    candidateId: varchar("candidate_id", { length: 64 })
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.ballotId, t.candidateId] }),
    index("choices_candidate_idx").on(t.candidateId),
  ],
);

export type User = typeof users.$inferSelect;
export type Poll = typeof polls.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type Voter = typeof voters.$inferSelect;
export type Ballot = typeof ballots.$inferSelect;
