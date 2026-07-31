-- Desk list perf: indexable ORDER BY + COUNT via secondary index (évite scan LONGTEXT body).
UPDATE el_articles SET modified = date WHERE modified IS NULL;

ALTER TABLE el_articles
  ADD KEY idx_list_modified (modified, article_id),
  ADD KEY idx_list_draft_modified (draft, modified, article_id);
