CREATE TABLE IF NOT EXISTS workshop_drafts (
 owner TEXT NOT NULL,
 id TEXT NOT NULL,
 title TEXT NOT NULL,
 content TEXT NOT NULL,
 revision INTEGER NOT NULL,
 updated TEXT NOT NULL,
 PRIMARY KEY(owner,id)
);
