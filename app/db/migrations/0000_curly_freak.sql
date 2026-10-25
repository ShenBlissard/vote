CREATE TABLE `ballots` (
	`id` varchar(64) NOT NULL,
	`poll_id` varchar(32) NOT NULL,
	`voter_id` varchar(64) NOT NULL,
	`submitted_at` bigint NOT NULL,
	CONSTRAINT `ballots_id` PRIMARY KEY(`id`),
	CONSTRAINT `ballots_voter_idx` UNIQUE(`voter_id`)
);
--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` varchar(64) NOT NULL,
	`poll_id` varchar(32) NOT NULL,
	`name` varchar(50) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `candidates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `choices` (
	`ballot_id` varchar(64) NOT NULL,
	`candidate_id` varchar(64) NOT NULL,
	CONSTRAINT `choices_ballot_id_candidate_id_pk` PRIMARY KEY(`ballot_id`,`candidate_id`)
);
--> statement-breakpoint
CREATE TABLE `polls` (
	`id` varchar(32) NOT NULL,
	`creator_id` varchar(64) NOT NULL,
	`title` varchar(100) NOT NULL,
	`description` varchar(1024) NOT NULL DEFAULT '',
	`min_choices` int NOT NULL DEFAULT 1,
	`max_choices` int NOT NULL DEFAULT 1,
	`shuffle_candidates` boolean NOT NULL DEFAULT false,
	`anonymous` boolean NOT NULL DEFAULT true,
	`deadline` bigint NOT NULL,
	`allow_change` boolean NOT NULL DEFAULT false,
	`auto_publish` boolean NOT NULL DEFAULT true,
	`pub_top_n` int NOT NULL DEFAULT -1,
	`turnout_mode` varchar(16) NOT NULL DEFAULT 'both',
	`published` boolean NOT NULL DEFAULT false,
	`status` varchar(16) NOT NULL DEFAULT 'open',
	`created_at` bigint NOT NULL,
	CONSTRAINT `polls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`created_at` bigint NOT NULL,
	`expires_at` bigint NOT NULL,
	CONSTRAINT `sessions_token` PRIMARY KEY(`token`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(64) NOT NULL,
	`code` varchar(4) NOT NULL,
	`name` varchar(50) NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_code_name_idx` UNIQUE(`code`,`name`)
);
--> statement-breakpoint
CREATE TABLE `voters` (
	`id` varchar(64) NOT NULL,
	`poll_id` varchar(32) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`seq` serial AUTO_INCREMENT,
	CONSTRAINT `voters_id` PRIMARY KEY(`id`),
	CONSTRAINT `voters_poll_user_idx` UNIQUE(`poll_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `ballots` ADD CONSTRAINT `ballots_poll_id_polls_id_fk` FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ballots` ADD CONSTRAINT `ballots_voter_id_voters_id_fk` FOREIGN KEY (`voter_id`) REFERENCES `voters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidates` ADD CONSTRAINT `candidates_poll_id_polls_id_fk` FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `choices` ADD CONSTRAINT `choices_ballot_id_ballots_id_fk` FOREIGN KEY (`ballot_id`) REFERENCES `ballots`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `choices` ADD CONSTRAINT `choices_candidate_id_candidates_id_fk` FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `polls` ADD CONSTRAINT `polls_creator_id_users_id_fk` FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `voters` ADD CONSTRAINT `voters_poll_id_polls_id_fk` FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `voters` ADD CONSTRAINT `voters_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ballots_poll_idx` ON `ballots` (`poll_id`);--> statement-breakpoint
CREATE INDEX `candidates_poll_idx` ON `candidates` (`poll_id`);--> statement-breakpoint
CREATE INDEX `choices_candidate_idx` ON `choices` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `polls_creator_idx` ON `polls` (`creator_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `voters_poll_idx` ON `voters` (`poll_id`);--> statement-breakpoint
CREATE INDEX `voters_user_idx` ON `voters` (`user_id`);