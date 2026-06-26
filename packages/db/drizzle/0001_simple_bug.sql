ALTER TABLE "comments" ADD COLUMN "author_viewer_id" uuid;--> statement-breakpoint
ALTER TABLE "reactions" ADD COLUMN "author_viewer_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_viewer_id_viewers_id_fk" FOREIGN KEY ("author_viewer_id") REFERENCES "public"."viewers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_author_viewer_id_viewers_id_fk" FOREIGN KEY ("author_viewer_id") REFERENCES "public"."viewers"("id") ON DELETE set null ON UPDATE no action;