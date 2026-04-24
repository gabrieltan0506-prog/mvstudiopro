-- Beta invite codes: supervisor generates, user redeems for credits
CREATE TABLE IF NOT EXISTS `beta_invite_codes` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `code`        VARCHAR(20) NOT NULL UNIQUE,
  `credits`     INT NOT NULL DEFAULT 200,
  `max_uses`    INT NOT NULL DEFAULT 1,
  `used_count`  INT NOT NULL DEFAULT 0,
  `created_by`  INT NOT NULL,
  `note`        VARCHAR(120),
  `expires_at`  TIMESTAMP NULL,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `beta_code_usages` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `code_id`         INT NOT NULL,
  `user_id`         INT NOT NULL,
  `credits_awarded` INT NOT NULL,
  `redeemed_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_code_user` (`code_id`, `user_id`)
);
