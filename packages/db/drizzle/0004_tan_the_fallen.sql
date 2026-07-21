CREATE TABLE "github_installations" (
	"installation_id" bigint PRIMARY KEY NOT NULL,
	"account" text,
	"repos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_site_state" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"last_pr_comment_id" bigint,
	"last_pr_review_id" bigint,
	"last_head_sha" text,
	"last_reconciled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "comment_mirrors" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "comment_mirrors" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "github_site_state" ADD CONSTRAINT "github_site_state_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_mirrors_drain_idx" ON "comment_mirrors" USING btree ("provider","status");