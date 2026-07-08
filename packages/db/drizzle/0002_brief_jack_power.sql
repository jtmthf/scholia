ALTER TABLE "comments" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_tokens" ADD COLUMN "viewer_id" uuid;--> statement-breakpoint
ALTER TABLE "site_tokens" ADD CONSTRAINT "site_tokens_viewer_id_viewers_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."viewers"("id") ON DELETE cascade ON UPDATE no action;