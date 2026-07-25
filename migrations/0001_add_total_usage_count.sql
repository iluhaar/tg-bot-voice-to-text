ALTER TABLE users
ADD COLUMN total_usage_count INTEGER NOT NULL DEFAULT 0;

-- Earlier reset periods cannot be recovered, so preserve the current known count.
UPDATE users
SET total_usage_count = usage_count;
