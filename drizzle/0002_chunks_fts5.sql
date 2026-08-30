-- Hand-written. Drizzle has no way to express a virtual table, and pretending
-- otherwise in schema.ts would mean a schema file that does not describe the
-- database.
--
-- WHY THIS EXISTS AT ALL: CLAUDE.md specifies hybrid retrieval — "Vectorize
-- dense results fused with D1 FTS5 lexical results via Reciprocal Rank Fusion.
-- Vectorize is dense-only; FTS5 supplies the other half." This is that half.
--
-- Dense and lexical fail in different directions, which is the point of fusing
-- them. A vector search for "rash on both hands" happily returns a passage
-- about pruritus and misses one that says "erythema" three times; a lexical
-- search does the reverse. In a safety document the exact word often IS the
-- answer — a reviewer looking for "Stevens-Johnson" wants the passage
-- containing those words, not its nearest neighbour in embedding space.

-- External content: the index points back at `chunks` by rowid rather than
-- keeping a second copy of every passage. The text of a 400-page CCDS is not
-- something to store twice.
--
-- `unicode61 remove_diacritics 2` so that a label printed with an accent and a
-- reviewer typing without one find each other. Safety documents are full of
-- transliterated substance names.
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  section,
  content = 'chunks',
  content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2"
);

-- Triggers rather than application code, so that a chunk cannot be written
-- without being indexed. The alternative — remembering to update the index at
-- every write site — fails silently: retrieval simply stops finding the newest
-- document, which reads as "the search is bad" rather than "the index is
-- stale".
CREATE TRIGGER chunks_fts_insert AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts (rowid, text, section)
  VALUES (new.rowid, new.text, new.section);
END;

-- The 'delete' command form is how FTS5 removes a row from an external-content
-- index: it needs the OLD values to unindex the right terms.
CREATE TRIGGER chunks_fts_delete AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, text, section)
  VALUES ('delete', old.rowid, old.text, old.section);
END;

CREATE TRIGGER chunks_fts_update AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, text, section)
  VALUES ('delete', old.rowid, old.text, old.section);
  INSERT INTO chunks_fts (rowid, text, section)
  VALUES (new.rowid, new.text, new.section);
END;
