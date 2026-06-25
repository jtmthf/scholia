CREATE TYPE "public"."anchor_status" AS ENUM('live', 'outdated');--> statement-breakpoint
CREATE TYPE "public"."comment_origin" AS ENUM('collab', 'github');--> statement-breakpoint
CREATE TYPE "public"."manifest_kind" AS ENUM('markdown', 'html', 'asset');--> statement-breakpoint
CREATE TYPE "public"."mirror_status" AS ENUM('pending', 'synced', 'failed', 'detached');--> statement-breakpoint
CREATE TYPE "public"."site_state" AS ENUM('open', 'read_only', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."token_kind" AS ENUM('owner', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TABLE "comment_mirrors" (
	"comment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_url" text,
	"status" "mirror_status" DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "comment_mirrors_comment_id_provider_pk" PRIMARY KEY("comment_id","provider")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"author" jsonb NOT NULL,
	"origin" "comment_origin" DEFAULT 'collab' NOT NULL,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"created_version_id" uuid NOT NULL,
	"page_path" text,
	"visibility" "visibility" NOT NULL,
	"owner_viewer_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"anchor" jsonb,
	"anchor_status" "anchor_status" DEFAULT 'live' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifest_entries" (
	"version_id" uuid NOT NULL,
	"path" text NOT NULL,
	"kind" "manifest_kind" NOT NULL,
	"content_hash" text NOT NULL,
	"title" text,
	"rendered_hash" text,
	"source_map_hash" text,
	CONSTRAINT "manifest_entries_version_id_path_pk" PRIMARY KEY("version_id","path")
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"comment_id" uuid NOT NULL,
	"target_identity" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"author" jsonb NOT NULL,
	"emoji" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" "token_kind" NOT NULL,
	"label" text,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "site_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"state" "site_state" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mirror_binding" jsonb,
	CONSTRAINT "sites_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_source" jsonb NOT NULL,
	"provenance" jsonb,
	"is_latest" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "viewer_state" (
	"viewer_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"last_seen_version_id" uuid,
	CONSTRAINT "viewer_state_viewer_id_site_id_pk" PRIMARY KEY("viewer_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "viewers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_mirrors" ADD CONSTRAINT "comment_mirrors_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_version_id_versions_id_fk" FOREIGN KEY ("created_version_id") REFERENCES "public"."versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_viewer_id_viewers_id_fk" FOREIGN KEY ("owner_viewer_id") REFERENCES "public"."viewers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_entries" ADD CONSTRAINT "manifest_entries_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_tokens" ADD CONSTRAINT "site_tokens_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_state" ADD CONSTRAINT "viewer_state_viewer_id_viewers_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."viewers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_state" ADD CONSTRAINT "viewer_state_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_state" ADD CONSTRAINT "viewer_state_last_seen_version_id_versions_id_fk" FOREIGN KEY ("last_seen_version_id") REFERENCES "public"."versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewers" ADD CONSTRAINT "viewers_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;