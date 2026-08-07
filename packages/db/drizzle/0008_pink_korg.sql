ALTER TABLE "comment_mirrors" ADD COLUMN "site_id" uuid;--> statement-breakpoint

UPDATE "comment_mirrors"
SET "site_id" = "conversations"."site_id"
FROM "comments"
INNER JOIN "conversations" ON "conversations"."id" = "comments"."conversation_id"
WHERE "comment_mirrors"."comment_id" = "comments"."id";--> statement-breakpoint

ALTER TABLE "comment_mirrors" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "comment_mirrors" ADD CONSTRAINT "comment_mirrors_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

DROP INDEX IF EXISTS "comment_mirrors_external_id_idx";--> statement-breakpoint

CREATE UNIQUE INDEX "comment_mirrors_site_external_id_idx" ON "comment_mirrors" USING btree ("site_id","provider","external_id") WHERE "comment_mirrors"."external_id" <> '';
