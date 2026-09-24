CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_hash text NOT NULL,
  carrera_codigo text,
  carrera_nombre text,
  sede text,
  contact_requested boolean NOT NULL DEFAULT false,
  contact_email text,
  contact_cell text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS surveys_student_hash_idx ON surveys(student_hash);
CREATE INDEX IF NOT EXISTS surveys_created_at_idx ON surveys(created_at DESC);

CREATE TABLE IF NOT EXISTS evaluations (
  id bigserial PRIMARY KEY,
  survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  area_key text NOT NULL,
  area_name text NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  had_problem boolean NOT NULL DEFAULT false,
  resolution text NOT NULL DEFAULT 'no-aplica',
  selected_issues text[] NOT NULL DEFAULT '{}',
  comment text NOT NULL DEFAULT '',
  ai_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_sentiment text,
  ai_severity text,
  ai_summary text,
  ai_themes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_model text,
  ai_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evaluations_survey_id_idx ON evaluations(survey_id);
CREATE INDEX IF NOT EXISTS evaluations_area_key_idx ON evaluations(area_key);
CREATE INDEX IF NOT EXISTS evaluations_created_at_idx ON evaluations(created_at DESC);
CREATE INDEX IF NOT EXISTS evaluations_rating_idx ON evaluations(rating);