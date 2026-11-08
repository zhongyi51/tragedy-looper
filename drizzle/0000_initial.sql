CREATE TABLE games (id TEXT PRIMARY KEY, owner TEXT NOT NULL, mode TEXT NOT NULL, state TEXT NOT NULL, budget REAL NOT NULL, spent REAL NOT NULL DEFAULT 0, created TEXT NOT NULL, lock_token TEXT, locked_until INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE INDEX games_owner_created ON games(owner,created);
--> statement-breakpoint
CREATE TABLE frames (game TEXT NOT NULL, revision INTEGER NOT NULL, command TEXT, state TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(game,revision));
--> statement-breakpoint
CREATE TABLE receipts (game TEXT NOT NULL, command_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(game,command_id));
--> statement-breakpoint
CREATE TABLE calls (id TEXT PRIMARY KEY, game TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
