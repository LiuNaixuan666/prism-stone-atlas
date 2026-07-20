import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const collectionSnapshots = sqliteTable("collection_snapshots", {
  userEmail: text("user_email").primaryKey(),
  payload: text("payload").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});
