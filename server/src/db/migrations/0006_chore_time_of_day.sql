-- Which part of the day a chore belongs to. Parents set it when creating a
-- chore; the Child Portal groups chores under it instead of by frequency,
-- showing only the headings that actually have chores under them.
ALTER TABLE chores ADD COLUMN time_of_day TEXT NOT NULL DEFAULT 'all_day'
  CHECK (time_of_day IN ('all_day', 'morning', 'afternoon', 'evening'));
