CREATE TABLE transcription_cache (
  file_unique_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  transcription TEXT,
  claim_token TEXT,
  claimed_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (file_unique_id, model_version)
);
