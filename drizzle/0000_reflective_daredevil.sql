CREATE TABLE `domain_discovery_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain_id` integer NOT NULL,
	`source` text NOT NULL,
	`source_date` text NOT NULL,
	`observed_at` text NOT NULL,
	`raw_source_metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_discovery_event` ON `domain_discovery_events` (`domain_id`,`source`,`source_date`);--> statement-breakpoint
CREATE TABLE `domain_hunter_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'smet' NOT NULL,
	`preferred_tlds` text NOT NULL,
	`keywords` text NOT NULL,
	`minimum_discovery_score` integer DEFAULT 30 NOT NULL,
	`minimum_lead_score` integer DEFAULT 50 NOT NULL,
	`delhi_ncr_enabled` integer DEFAULT true NOT NULL,
	`scan_concurrency` integer DEFAULT 10 NOT NULL,
	`max_pages` integer DEFAULT 10 NOT NULL,
	`timeout_ms` integer DEFAULT 10000 NOT NULL,
	`max_html_bytes` integer DEFAULT 2097152 NOT NULL,
	`daily_scan_time` text DEFAULT '06:00' NOT NULL,
	`retention_days` integer DEFAULT 90 NOT NULL,
	`auto_add_prospects` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`normalized_domain` text NOT NULL,
	`tld` text NOT NULL,
	`sld` text NOT NULL,
	`source` text NOT NULL,
	`source_date` text NOT NULL,
	`source_generated_at` text,
	`discovered_at` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`discovery_score` integer DEFAULT 0 NOT NULL,
	`filter_reasons` text DEFAULT '[]' NOT NULL,
	`website_status` text DEFAULT 'UNCHECKED' NOT NULL,
	`website_checked_at` text,
	`http_status` integer,
	`final_url` text,
	`redirect_chain` text DEFAULT '[]' NOT NULL,
	`tls_available` integer,
	`response_time_ms` integer,
	`classification` text DEFAULT 'UNKNOWN' NOT NULL,
	`classification_confidence` real DEFAULT 0 NOT NULL,
	`classification_reasons` text DEFAULT '[]' NOT NULL,
	`country` text,
	`country_confidence` text DEFAULT 'UNKNOWN' NOT NULL,
	`city` text,
	`city_confidence` text DEFAULT 'UNKNOWN' NOT NULL,
	`state` text,
	`location_source` text,
	`company_name` text,
	`company_type` text,
	`business_email` text,
	`email_type` text,
	`phone` text,
	`normalized_phone` text,
	`technologies` text DEFAULT '[]' NOT NULL,
	`social_links` text DEFAULT '[]' NOT NULL,
	`lead_score` integer DEFAULT 0 NOT NULL,
	`lead_reasons` text DEFAULT '[]' NOT NULL,
	`recommended_service` text,
	`status` text DEFAULT 'NEW' NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_domains_domain_source_date` ON `domains` (`normalized_domain`,`source_date`,`source`);--> statement-breakpoint
CREATE INDEX `idx_domains_source_date` ON `domains` (`source_date`);--> statement-breakpoint
CREATE INDEX `idx_domains_tld` ON `domains` (`tld`);--> statement-breakpoint
CREATE INDEX `idx_domains_website_status` ON `domains` (`website_status`);--> statement-breakpoint
CREATE INDEX `idx_domains_classification` ON `domains` (`classification`);--> statement-breakpoint
CREATE INDEX `idx_domains_location` ON `domains` (`country`,`city`);--> statement-breakpoint
CREATE INDEX `idx_domains_lead_score` ON `domains` (`lead_score`);--> statement-breakpoint
CREATE INDEX `idx_domains_status` ON `domains` (`status`);--> statement-breakpoint
CREATE INDEX `idx_domains_created_at` ON `domains` (`created_at`);--> statement-breakpoint
CREATE TABLE `domain_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain_id` integer NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`source_url` text NOT NULL,
	`snippet` text,
	`confidence` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_evidence_domain` ON `domain_evidence` (`domain_id`);--> statement-breakpoint
CREATE TABLE `prospects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`company_name` text,
	`contact_name` text,
	`business_email` text,
	`phone` text,
	`website` text,
	`location` text,
	`industry` text,
	`technology` text,
	`lead_score` integer,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_prospects_domain` ON `prospects` (`domain`);--> statement-breakpoint
CREATE INDEX `idx_prospects_email` ON `prospects` (`business_email`);--> statement-breakpoint
CREATE INDEX `idx_prospects_phone` ON `prospects` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_prospects_company` ON `prospects` (`company_name`);--> statement-breakpoint
CREATE TABLE `technology_detections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain_id` integer NOT NULL,
	`technology` text NOT NULL,
	`confidence` real NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_technology_domain` ON `technology_detections` (`domain_id`,`technology`);