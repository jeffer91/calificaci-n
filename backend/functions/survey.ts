import { Hono } from "hono";
import { cors } from "hono/cors";
import { attachDatabasePool } from "@neon/functions";
import { Pool } from "pg";
import { neon } from "@neon/ai-sdk-provider";
import { generateText } from "ai";
import crypto from "node:crypto";

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
attachDatabasePool(pool);

const app=new Hono();
app.use("/*",cors({
  origin:"https://jeffer91.github.io",
  allowHeaders:["Content-Type","X-Admin-Key"],
  allowMethods:["GET","POST","OPTIONS"]
}));

function clean(v:any,max=2000){return String(v??"").trim().slice(0,max);}
function hashStudent(cedula:string){
  const pepper=process.env.HASH_PEPPER||"survey-v1";
  return crypto.createHash("sha256").update(pepper+":"+cedula).digest("hex");
}
function isAdmin(c:any){
  const expected=process.env.ADMIN_KEY||"", provided=c.req.header("X-Admin-Key")||"";
  if(!expected||!provided||expected.length!==provided.length)return false;
  return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(provided));
}
function fallback(ev:any){
  const text=(clean(ev.comment)+" "+(ev.issues||[]).join(" ")).toLowerCase();
  const rules:any={
    "Demora":["demora","tarde","espera","semana","dias","días"],
    "Sin respuesta":["no respond","sin respuesta","nadie contest"],
    "Información confusa":["confus","contradict","diferente","no entend"],
    "Trato inadecuado":["maltrato","groser","mala atencion","mala atención"],
    "Derivación entre áreas":["me enviaron","otra area","otra área","deriv"]
  };
  const categories=Object.entries(rules).filter(([_,ks]:any)=>ks.some((k:string)=>text.includes(k))).map(([k])=>k);
  return {categories,sentiment:Number(ev.rating)<=2?"negativo":Number(ev.rating)>=4?"positivo":"neutral",severity:Number(ev.rating)===1&&ev.hadProblem?"alta":ev.hadProblem?"media":"baja",summary:clean(ev.comment,280)||"Sin comentario textual.",themes:categories,model:"fallback-rules",status:"fallback"};
}
async function analyze(ev:any){
  const prompt=[
    "Analiza una respuesta de satisfacción estudiantil en español.",
    "Devuelve solo JSON válido con las claves categories, sentiment, severity, summary y themes.",
    "sentiment debe ser positivo, neutral o negativo.",
    "severity debe ser baja, media o alta.",
    "No inventes hechos. Reutiliza categorías como Demora, Sin respuesta, Información confusa, Información incorrecta, Trato inadecuado, Derivación entre áreas, Problema documental, Problema de plataforma y No solucionado.",
    "Área: "+clean(ev.areaName,120),
    "Calificación: "+String(ev.rating)+"/5",
    "Marcó problema: "+String(!!ev.hadProblem),
    "Problemas seleccionados: "+(ev.issues||[]).join(", "),
    "Resolución: "+clean(ev.resolution,40),
    "Comentario: "+clean(ev.comment,2000)
  ].join("\n");
  for(const model of ["gpt-oss-20b","meta-llama-3-3-70b-instruct"]){
    try{
      const out=await generateText({model:neon(model),prompt,experimental_telemetry:{isEnabled:false}});
      const raw=out.text.trim(),start=raw.indexOf("{"),end=raw.lastIndexOf("}");
      const p=JSON.parse(start>=0&&end>start?raw.slice(start,end+1):raw);
      return {
        categories:Array.isArray(p.categories)?p.categories.slice(0,8):[],
        sentiment:["positivo","neutral","negativo"].includes(p.sentiment)?p.sentiment:"neutral",
        severity:["baja","media","alta"].includes(p.severity)?p.severity:"media",
        summary:clean(p.summary,280),
        themes:Array.isArray(p.themes)?p.themes.slice(0,8):[],
        model,status:"ok"
      };
    }catch(_){}
  }
  return fallback(ev);
}

app.get("/health",c=>c.json({ok:true,service:"survey"}));

app.post("/survey",async c=>{
  try{
    const body=await c.req.json(),student=body.student||{};
    const cedula=clean(student.cedula,20).replace(/\D/g,"");
    const evaluations=Array.isArray(body.evaluations)?body.evaluations.slice(0,20):[];
    if(cedula.length!==10||!evaluations.length)return c.json({error:"Datos incompletos."},400);

    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const s=await client.query(
        "INSERT INTO surveys(student_hash,carrera_codigo,carrera_nombre,sede,contact_requested,contact_email,contact_cell) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [hashStudent(cedula),clean(student.carreraCodigo,80),clean(student.carreraNombre,180),clean(student.sede,80),!!body.contactRequested,body.contactRequested?clean(student.correoInstitucional,180):null,body.contactRequested?clean(student.celular,30):null]
      );
      const surveyId=s.rows[0].id;
      for(const ev of evaluations){
        const ai=await analyze(ev);
        await client.query(
          "INSERT INTO evaluations(survey_id,area_key,area_name,rating,had_problem,resolution,selected_issues,comment,ai_categories,ai_sentiment,ai_severity,ai_summary,ai_themes,ai_model,ai_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15)",
          [surveyId,clean(ev.areaKey,80),clean(ev.areaName,160),Math.max(1,Math.min(5,Number(ev.rating)||3)),!!ev.hadProblem,clean(ev.resolution,40),Array.isArray(ev.issues)?ev.issues.map((x:any)=>clean(x,120)).slice(0,20):[],clean(ev.comment,2000),JSON.stringify(ai.categories),ai.sentiment,ai.severity,ai.summary,JSON.stringify(ai.themes),ai.model,ai.status]
        );
      }
      await client.query("COMMIT");
      return c.json({ok:true,id:surveyId});
    }catch(err){await client.query("ROLLBACK");throw err;}
    finally{client.release();}
  }catch(err){console.error(err);return c.json({error:"No fue posible registrar la encuesta."},500);}
});

app.get("/admin/summary",async c=>{
  if(!isAdmin(c))return c.json({error:"No autorizado."},401);
  const [t,a,i]=await Promise.all([
    pool.query("SELECT (SELECT count(*) FROM surveys)::int surveys,count(*)::int evaluations,coalesce(avg(rating),0)::numeric(10,2) avg_rating,count(*) FILTER(WHERE ai_severity='alta')::int high_severity FROM evaluations"),
    pool.query("SELECT area_key,area_name,count(*)::int count,avg(rating)::numeric(10,2) avg_rating,(100.0*count(*) FILTER(WHERE had_problem)/nullif(count(*),0))::numeric(10,2) problem_pct FROM evaluations GROUP BY area_key,area_name ORDER BY count(*) DESC"),
    pool.query("SELECT issue,count(*)::int count FROM evaluations CROSS JOIN LATERAL unnest(selected_issues) issue GROUP BY issue ORDER BY count(*) DESC LIMIT 30")
  ]);
  const x=t.rows[0]||{};
  return c.json({surveys:x.surveys||0,evaluations:x.evaluations||0,avgRating:x.avg_rating||0,highSeverity:x.high_severity||0,areas:a.rows,issues:i.rows});
});

app.get("/admin/responses",async c=>{
  if(!isAdmin(c))return c.json({error:"No autorizado."},401);
  const limit=Math.min(1000,Math.max(1,Number(c.req.query("limit"))||250));
  const r=await pool.query("SELECT e.id,e.created_at,s.carrera_nombre,s.sede,e.area_key,e.area_name,e.rating,e.had_problem,e.resolution,e.selected_issues,e.comment,e.ai_categories,e.ai_sentiment,e.ai_severity,e.ai_summary,e.ai_themes,e.ai_model,e.ai_status,s.contact_requested,s.contact_email,s.contact_cell FROM evaluations e JOIN surveys s ON s.id=e.survey_id ORDER BY e.created_at DESC LIMIT $1",[limit]);
  return c.json({items:r.rows});
});

export default app;