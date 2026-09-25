import { Hono } from "hono";
import { cors } from "hono/cors";
import { attachDatabasePool } from "@neon/functions";
import { Pool } from "pg";
import { neon } from "@neon/ai-sdk-provider";
import { generateText } from "ai";
import crypto from "node:crypto";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5
});
attachDatabasePool(pool);

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "https://jeffer91.github.io",
    allowHeaders: ["Content-Type", "X-Admin-Key"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400
  })
);

app.use("/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

function clean(v: any, max = 2000) {
  return String(v ?? "").trim().slice(0, max);
}

function experienceType(ev: any) {
  if (ev?.experienceType === "positive") return "positive";
  if (ev?.experienceType === "improvement") return "improvement";
  return "";
}

function hashStudent(cedula: string) {
  const pepper = process.env.HASH_PEPPER || "";
  if (!pepper) throw new Error("HASH_PEPPER_MISSING");
  return crypto.createHmac("sha256", pepper).update(cedula).digest("hex");
}

function isAdmin(c: any) {
  const expected = process.env.ADMIN_KEY || "";
  const provided = c.req.header("X-Admin-Key") || "";
  if (!expected || !provided || expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

let schemaPromise: Promise<void> | null = null;

function ensureSchema() {
  if (schemaPromise) return schemaPromise;

  const statements = [
    "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    `CREATE TABLE IF NOT EXISTS surveys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      student_hash text NOT NULL,
      carrera_codigo text,
      carrera_nombre text,
      sede text,
      contact_requested boolean NOT NULL DEFAULT false,
      contact_email text,
      contact_cell text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS evaluations (
      id bigserial PRIMARY KEY,
      survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      experience_type text NOT NULL DEFAULT 'general',
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
    )`,
    "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS experience_type text NOT NULL DEFAULT 'general'",
    "CREATE INDEX IF NOT EXISTS surveys_student_hash_idx ON surveys(student_hash)",
    "CREATE INDEX IF NOT EXISTS surveys_created_at_idx ON surveys(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS evaluations_survey_id_idx ON evaluations(survey_id)",
    "CREATE INDEX IF NOT EXISTS evaluations_area_key_idx ON evaluations(area_key)",
    "CREATE INDEX IF NOT EXISTS evaluations_experience_type_idx ON evaluations(experience_type)",
    "CREATE INDEX IF NOT EXISTS evaluations_created_at_idx ON evaluations(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS evaluations_rating_idx ON evaluations(rating)"
  ];

  schemaPromise = (async () => {
    for (const sql of statements) await pool.query(sql);
  })().catch((err) => {
    schemaPromise = null;
    throw err;
  });

  return schemaPromise;
}

function normalizeEvaluation(ev: any) {
  const type = experienceType(ev);
  if (!type) throw new Error("Tipo de experiencia inválido.");

  const areaKey = clean(ev?.areaKey, 80);
  const areaName = clean(ev?.areaName, 160);
  const rating = Number(ev?.rating);

  if (!/^[a-z0-9-]{1,80}$/.test(areaKey) || !areaName) {
    throw new Error("Área inválida.");
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("Calificación inválida.");
  }

  if (type === "positive" && rating < 4) {
    throw new Error("Un reconocimiento debe tener calificación 4 o 5.");
  }

  if (type === "improvement" && rating > 3) {
    throw new Error("Un aspecto por mejorar debe tener calificación entre 1 y 3.");
  }

  const issues = Array.isArray(ev?.issues)
    ? ev.issues.map((x: any) => clean(x, 120)).filter(Boolean).slice(0, 20)
    : [];

  let resolution = type === "positive" ? "no-aplica" : clean(ev?.resolution, 40);
  if (type === "improvement" && !["si", "parcial", "no"].includes(resolution)) {
    throw new Error("Resolución inválida.");
  }

  return {
    experienceType: type,
    areaKey,
    areaName,
    rating,
    issues,
    resolution,
    comment: clean(ev?.comment, 2000)
  };
}

function fallback(ev: any) {
  const type = ev.experienceType;
  const text = (clean(ev.comment) + " " + (ev.issues || []).join(" ")).toLowerCase();

  if (type === "positive") {
    const categories = Array.isArray(ev.issues) ? ev.issues.slice(0, 8) : [];
    return {
      categories,
      sentiment: "positivo",
      severity: "baja",
      summary:
        clean(ev.comment, 280) ||
        ("Reconocimiento a " +
          clean(ev.areaName, 120) +
          " por " +
          (categories.join(", ") || "una experiencia positiva") +
          "."),
      themes: categories,
      model: "fallback-rules",
      status: "fallback"
    };
  }

  const rules: Record<string, string[]> = {
    Demora: ["demora", "tarde", "espera", "semana", "dias", "días"],
    "Sin respuesta": ["no respond", "sin respuesta", "nadie contest"],
    "Información confusa": ["confus", "contradict", "diferente", "no entend"],
    "Trato inadecuado": ["maltrato", "groser", "mala atencion", "mala atención"],
    "Derivación entre áreas": ["me enviaron", "otra area", "otra área", "deriv"]
  };

  const detected = Object.entries(rules)
    .filter(([_, keys]) => keys.some((key) => text.includes(key)))
    .map(([key]) => key);

  const categories = [...new Set([...(ev.issues || []), ...detected])].slice(0, 8);

  return {
    categories,
    sentiment: ev.rating <= 2 ? "negativo" : "neutral",
    severity: ev.rating === 1 ? "alta" : "media",
    summary:
      clean(ev.comment, 280) ||
      ("Aspecto por mejorar en " +
        clean(ev.areaName, 120) +
        (categories.length ? ": " + categories.join(", ") : ".")),
    themes: categories,
    model: "fallback-rules",
    status: "fallback"
  };
}

async function analyze(ev: any) {
  const type = ev.experienceType;
  const prompt = [
    "Analiza una respuesta de satisfacción estudiantil en español.",
    "Tipo de respuesta: " +
      (type === "positive" ? "RECONOCIMIENTO POSITIVO" : "ASPECTO POR MEJORAR") +
      ".",
    "Devuelve solo JSON válido con las claves categories, sentiment, severity, summary y themes.",
    "sentiment debe ser positivo, neutral o negativo.",
    "severity debe ser baja, media o alta. Un reconocimiento positivo normalmente es baja.",
    "No inventes hechos.",
    type === "positive"
      ? "Organiza los elogios en categorías concretas como Buena atención, Rapidez, Información clara, Solución efectiva, Amabilidad, Buen seguimiento o Facilidad del proceso."
      : "Organiza los problemas en categorías concretas como Demora, Sin respuesta, Información confusa, Información incorrecta, Trato inadecuado, Derivación entre áreas, Problema documental, Problema de plataforma o No solucionado.",
    "Área: " + ev.areaName,
    "Calificación: " + String(ev.rating) + "/5",
    "Categorías marcadas por el estudiante: " + ev.issues.join(", "),
    "Resolución: " + ev.resolution,
    "Comentario: " + ev.comment
  ].join("\n");

  for (const model of ["gpt-oss-20b", "meta-llama-3-3-70b-instruct"]) {
    try {
      const out = await generateText({
        model: neon(model),
        prompt,
        experimental_telemetry: { isEnabled: false }
      });

      const raw = out.text.trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);

      return {
        categories: Array.isArray(parsed.categories)
          ? parsed.categories.map((x: any) => clean(x, 120)).filter(Boolean).slice(0, 8)
          : [],
        sentiment: ["positivo", "neutral", "negativo"].includes(parsed.sentiment)
          ? parsed.sentiment
          : type === "positive"
            ? "positivo"
            : "neutral",
        severity: ["baja", "media", "alta"].includes(parsed.severity)
          ? parsed.severity
          : type === "positive"
            ? "baja"
            : "media",
        summary: clean(parsed.summary, 280),
        themes: Array.isArray(parsed.themes)
          ? parsed.themes.map((x: any) => clean(x, 120)).filter(Boolean).slice(0, 8)
          : [],
        model,
        status: "ok"
      };
    } catch (_) {
      // Try the next model.
    }
  }

  return fallback(ev);
}

app.get("/health", async (c) => {
  try {
    await pool.query("SELECT 1");
    return c.json({
      ok: true,
      database: true,
      aiGateway: true,
      adminConfigured: Boolean(process.env.ADMIN_KEY),
      hashPepperConfigured: Boolean(process.env.HASH_PEPPER),
      service: "survey"
    });
  } catch (err) {
    console.error("Health check failed", err);
    return c.json(
      {
        ok: false,
        database: false,
        aiGateway: true,
        adminConfigured: Boolean(process.env.ADMIN_KEY),
        hashPepperConfigured: Boolean(process.env.HASH_PEPPER),
        service: "survey"
      },
      503
    );
  }
});

app.post("/survey", async (c) => {
  try {
    if (!process.env.HASH_PEPPER) {
      return c.json({ error: "El servidor todavía no tiene configurada la seguridad de la encuesta." }, 503);
    }

    await ensureSchema();

    const body = await c.req.json();
    const student = body?.student || {};
    const cedula = clean(student.cedula, 20).replace(/\D/g, "");
    const rawEvaluations = Array.isArray(body?.evaluations) ? body.evaluations.slice(0, 4) : [];

    if (cedula.length !== 10 || !rawEvaluations.length) {
      return c.json({ error: "Datos incompletos." }, 400);
    }

    let evaluations;
    try {
      evaluations = rawEvaluations.map(normalizeEvaluation);
    } catch (err: any) {
      return c.json({ error: clean(err?.message, 220) || "Datos de evaluación inválidos." }, 400);
    }

    const positiveCount = evaluations.filter((ev: any) => ev.experienceType === "positive").length;
    const improvementCount = evaluations.filter((ev: any) => ev.experienceType === "improvement").length;

    if (positiveCount > 2 || improvementCount > 2) {
      return c.json(
        { error: "Puedes registrar máximo 2 reconocimientos y 2 aspectos por mejorar." },
        400
      );
    }

    const unique = new Set<string>();
    for (const ev of evaluations) {
      const key = ev.experienceType + ":" + ev.areaKey;
      if (unique.has(key)) {
        return c.json({ error: "No puedes registrar dos veces la misma área en el mismo bloque." }, 400);
      }
      unique.add(key);
    }

    const aiResults = await Promise.all(evaluations.map((ev: any) => analyze(ev)));
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const survey = await client.query(
        "INSERT INTO surveys(student_hash,carrera_codigo,carrera_nombre,sede,contact_requested,contact_email,contact_cell) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [
          hashStudent(cedula),
          clean(student.carreraCodigo, 80),
          clean(student.carreraNombre, 180),
          clean(student.sede, 80),
          Boolean(body.contactRequested),
          body.contactRequested ? clean(student.correoInstitucional, 180) : null,
          body.contactRequested ? clean(student.celular, 30) : null
        ]
      );

      const surveyId = survey.rows[0].id;

      for (let i = 0; i < evaluations.length; i++) {
        const ev = evaluations[i];
        const ai = aiResults[i];

        await client.query(
          "INSERT INTO evaluations(survey_id,experience_type,area_key,area_name,rating,had_problem,resolution,selected_issues,comment,ai_categories,ai_sentiment,ai_severity,ai_summary,ai_themes,ai_model,ai_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,$15,$16)",
          [
            surveyId,
            ev.experienceType,
            ev.areaKey,
            ev.areaName,
            ev.rating,
            ev.experienceType === "improvement",
            ev.resolution,
            ev.issues,
            ev.comment,
            JSON.stringify(ai.categories),
            ai.sentiment,
            ai.severity,
            ai.summary,
            JSON.stringify(ai.themes),
            ai.model,
            ai.status
          ]
        );
      }

      await client.query("COMMIT");
      return c.json({ ok: true, id: surveyId });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    return c.json({ error: "No fue posible registrar la encuesta." }, 500);
  }
});

app.get("/admin/summary", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "No autorizado." }, 401);

  try {
    await ensureSchema();

    const [totals, areas, highlights, issues] = await Promise.all([
      pool.query(
        "SELECT (SELECT count(*) FROM surveys)::int surveys,count(*)::int evaluations,count(*) FILTER(WHERE experience_type='positive')::int positive_count,count(*) FILTER(WHERE experience_type='improvement')::int improvement_count,coalesce(avg(rating),0)::numeric(10,2) avg_rating,count(*) FILTER(WHERE experience_type='improvement' AND ai_severity='alta')::int high_severity,count(*) FILTER(WHERE ai_status='fallback')::int fallback_count FROM evaluations"
      ),
      pool.query(
        "SELECT area_key,area_name,count(*)::int count,avg(rating)::numeric(10,2) avg_rating,count(*) FILTER(WHERE experience_type='positive')::int positive_count,count(*) FILTER(WHERE experience_type='improvement')::int improvement_count FROM evaluations GROUP BY area_key,area_name ORDER BY count(*) DESC"
      ),
      pool.query(
        "SELECT category AS issue,count(*)::int count FROM evaluations CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_array_length(ai_categories)>0 THEN ai_categories ELSE to_jsonb(selected_issues) END) category WHERE experience_type='positive' GROUP BY category ORDER BY count(*) DESC LIMIT 30"
      ),
      pool.query(
        "SELECT category AS issue,count(*)::int count FROM evaluations CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_array_length(ai_categories)>0 THEN ai_categories ELSE to_jsonb(selected_issues) END) category WHERE experience_type='improvement' GROUP BY category ORDER BY count(*) DESC LIMIT 30"
      )
    ]);

    const x = totals.rows[0] || {};
    return c.json({
      surveys: x.surveys || 0,
      evaluations: x.evaluations || 0,
      positiveCount: x.positive_count || 0,
      improvementCount: x.improvement_count || 0,
      avgRating: x.avg_rating || 0,
      highSeverity: x.high_severity || 0,
      fallbackCount: x.fallback_count || 0,
      areas: areas.rows,
      highlights: highlights.rows,
      issues: issues.rows
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "No fue posible cargar el resumen." }, 500);
  }
});

app.get("/admin/responses", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "No autorizado." }, 401);

  try {
    await ensureSchema();
    const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit")) || 250));

    const result = await pool.query(
      "SELECT e.id,e.created_at,e.experience_type,s.carrera_nombre,s.sede,e.area_key,e.area_name,e.rating,e.had_problem,e.resolution,e.selected_issues,e.comment,e.ai_categories,e.ai_sentiment,e.ai_severity,e.ai_summary,e.ai_themes,e.ai_model,e.ai_status,s.contact_requested,s.contact_email,s.contact_cell FROM evaluations e JOIN surveys s ON s.id=e.survey_id ORDER BY e.created_at DESC LIMIT $1",
      [limit]
    );

    return c.json({ items: result.rows });
  } catch (err) {
    console.error(err);
    return c.json({ error: "No fue posible cargar las respuestas." }, 500);
  }
});

export default app;
