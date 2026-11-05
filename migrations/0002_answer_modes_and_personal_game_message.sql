ALTER TABLE quizzes ADD COLUMN answer_mode TEXT NOT NULL DEFAULT 'text' CHECK(answer_mode IN ('text','choice'));
ALTER TABLE quizzes ADD COLUMN category TEXT NOT NULL DEFAULT 'Фильм';
ALTER TABLE questions ADD COLUMN options TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN game_message_id INTEGER;
