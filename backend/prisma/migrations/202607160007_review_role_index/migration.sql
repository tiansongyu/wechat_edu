-- Keep public teacher and private parent reputation scans role-isolated at the
-- index level as well as in the application query predicate.
DROP INDEX "reviews_revieweeId_status_createdAt_idx";

CREATE INDEX "reviews_revieweeId_revieweeRole_status_createdAt_idx"
  ON "reviews"("revieweeId", "revieweeRole", "status", "createdAt" DESC);
