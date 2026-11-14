CREATE TABLE script_feedback (game TEXT PRIMARY KEY, owner TEXT NOT NULL, script_hash TEXT NOT NULL, source TEXT NOT NULL, rating TEXT NOT NULL, updated TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX feedback_script_hash ON script_feedback(script_hash);
--> statement-breakpoint
CREATE TABLE game_creation (owner TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL, game TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created TEXT NOT NULL, PRIMARY KEY(owner,request_id));
