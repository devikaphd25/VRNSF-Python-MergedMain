-- Tags each stored game result with the Python puzzle it belongs to.
-- Run after app-data-migration.sql in the hosted Supabase SQL Editor.
-- 1 = Castle, 2 = Forest, 3 = Ocean. NULL for the Python Type Lab and quizzes.

alter table public.game_results
add column if not exists pythonpuzzle integer;

alter table public.game_results
drop constraint if exists game_results_pythonpuzzle_check;

alter table public.game_results
add constraint game_results_pythonpuzzle_check
check (pythonpuzzle is null or pythonpuzzle between 1 and 3);
