import { relations } from "drizzle-orm";

import {
  changeEventsTable,
  evidenceTable,
  investigationNotesTable,
  investigationSummariesTable,
  runtimeSignalsTable,
  serviceDependenciesTable,
  servicesTable,
} from "./models/investigation-os";
import { investigationsTable, investigationTimelineEntriesTable } from "./models/investigation";
import { usersTable } from "./models/user";

export const investigationsOsRelations = relations(investigationsTable, ({ many, one }) => ({
  user: one(usersTable, {
    fields: [investigationsTable.userId],
    references: [usersTable.id],
  }),
  timelineEntries: many(investigationTimelineEntriesTable),
  changeEvents: many(changeEventsTable),
  runtimeSignals: many(runtimeSignalsTable),
  evidence: many(evidenceTable),
  notes: many(investigationNotesTable),
  summaries: many(investigationSummariesTable),
}));

export const investigationTimelineRelations = relations(investigationTimelineEntriesTable, ({ one, many }) => ({
  investigation: one(investigationsTable, {
    fields: [investigationTimelineEntriesTable.investigationId],
    references: [investigationsTable.id],
  }),
  evidence: many(evidenceTable),
}));

export const changeEventsRelations = relations(changeEventsTable, ({ one }) => ({
  investigation: one(investigationsTable, {
    fields: [changeEventsTable.investigationId],
    references: [investigationsTable.id],
  }),
}));

export const runtimeSignalsRelations = relations(runtimeSignalsTable, ({ one }) => ({
  investigation: one(investigationsTable, {
    fields: [runtimeSignalsTable.investigationId],
    references: [investigationsTable.id],
  }),
}));

export const evidenceRelations = relations(evidenceTable, ({ one }) => ({
  investigation: one(investigationsTable, {
    fields: [evidenceTable.investigationId],
    references: [investigationsTable.id],
  }),
  timelineEntry: one(investigationTimelineEntriesTable, {
    fields: [evidenceTable.timelineEntryId],
    references: [investigationTimelineEntriesTable.id],
  }),
}));

export const servicesRelations = relations(servicesTable, ({ many }) => ({
  outgoing: many(serviceDependenciesTable, { relationName: "sourceService" }),
  incoming: many(serviceDependenciesTable, { relationName: "destinationService" }),
}));

export const serviceDependenciesRelations = relations(serviceDependenciesTable, ({ one }) => ({
  sourceService: one(servicesTable, {
    fields: [serviceDependenciesTable.sourceServiceId],
    references: [servicesTable.id],
    relationName: "sourceService",
  }),
  destinationService: one(servicesTable, {
    fields: [serviceDependenciesTable.destinationServiceId],
    references: [servicesTable.id],
    relationName: "destinationService",
  }),
}));

export const investigationNotesRelations = relations(investigationNotesTable, ({ one }) => ({
  investigation: one(investigationsTable, {
    fields: [investigationNotesTable.investigationId],
    references: [investigationsTable.id],
  }),
  user: one(usersTable, {
    fields: [investigationNotesTable.userId],
    references: [usersTable.id],
  }),
}));

export const investigationSummariesRelations = relations(investigationSummariesTable, ({ one }) => ({
  investigation: one(investigationsTable, {
    fields: [investigationSummariesTable.investigationId],
    references: [investigationsTable.id],
  }),
}));
