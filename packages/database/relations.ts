import { relations } from "drizzle-orm";

import { usersTable } from "./models/user";

export const usersRelations = relations(usersTable, () => ({}));
