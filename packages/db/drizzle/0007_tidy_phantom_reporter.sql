ALTER TYPE "public"."comment_origin" RENAME VALUE 'collab' TO 'scholia';--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "origin" SET DEFAULT 'scholia';