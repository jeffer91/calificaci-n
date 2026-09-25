import { APP_CONFIG } from "./config.js";
import { AREAS } from "./catalog.js";

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
let adminKey=sessionStorage.getItem("surveyAdminKey")||"",allResponses=[];

function status(id,type,msg){$(id).innerHTML=msg?'<div class="status '+type+'">'+esc(msg)+'</div>':"";}
function headers(){return {"X-Admin-Key":adminKey};}
function api(path){return APP_CONFIG.apiBase.replace(/\/$/,"")+path;}
function typeLabel(type){return type==="positive"?"Reconocimiento":type==="improvement"?"Por mejorar":"General";}

async function checkBackend(){
  if(!APP_CONFIG.apiBase){
    status("backendStatus","warn","Neon todavía no está enlazado a esta interfaz.");
    return false;
  }
  try{
    const r=await fetch(api("/health"),{cache:"no-store"});
    const j=await r.json().catch(()=>({}));
    if(r.ok&&j.ok&&j.database&&j.adminConfigured&&j.hashPepperConfigured){
      status("backendStatus","ok","Neon conectado · base de datos y seguridad listas.");
      return true;
    }
    if(r.ok&&j.database){
      status("backendStatus","warn","Neon está conectado, pero faltan variables de seguridad del backend.");
      return false;
    }
    status("backendStatus","error","El backend no pudo verificar la base de datos.");
    return false;
  }catch(_){
    status("backendStatus","error","No se pudo conectar con el backend de Neon.");
    return false;
  }
}
checkBackend();

$("loginForm").onsubmit=async e=>{e.preventDefault();adminKey=$("adminKey").value.trim();await load(true);};
$("refreshBtn").onclick=()=>load(false);
["typeFilter","areaFilter","ratingFilter","severityFilter","searchFilter"].forEach(id=>{
  $(id).addEventListener(id==="searchFilter"?"input":"change",renderResponses);
});
if(adminKey) load(true);

async function load(fromLogin){
  if(!APP_CONFIG.apiBase){status("loginStatus","warn","La interfaz está lista, pero todavía falta enlazar el backend de Neon.");return;}
  try{
    const [sRes,rRes]=await Promise.all([
      fetch(api("/admin/summary"),{headers:headers()}),
      fetch(api("/admin/responses?limit=500"),{headers:headers()})
    ]);
    if(sRes.status===401||rRes.status===401) throw new Error("Clave administrativa incorrecta.");
    if(!sRes.ok||!rRes.ok) throw new Error("No fue posible cargar el panel.");
    const summary=await sRes.json(),responses=await rRes.json();
    sessionStorage.setItem("surveyAdminKey",adminKey);
    allResponses=responses.items||[];
    $("loginBox").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    renderSummary(summary);
    renderResponses();
    status("adminStatus","","");
  }catch(err){
    if(fromLogin){sessionStorage.removeItem("surveyAdminKey");status("loginStatus","error",err.message);}
    else status("adminStatus","error",err.message);
  }
}

function renderSummary(s){
  const cards=[
    ["Encuestas",s.surveys||0],
    ["Reconocimientos",s.positiveCount||0],
    ["Por mejorar",s.improvementCount||0],
    ["Satisfacción",Number(s.avgRating||0).toFixed(1)+"/5"],
    ["Casos críticos",s.highSeverity||0]
  ];
  $("metrics").innerHTML=cards.map(x=>'<div class="metric"><b>'+esc(x[1])+'</b><span>'+esc(x[0])+'</span></div>').join("");

  $("areaRows").innerHTML=(s.areas||[]).map(a=>
    '<tr><td>'+esc(a.area_name)+'</td><td>'+a.count+'</td><td>'+Number(a.avg_rating).toFixed(1)+'/5</td><td>'+Number(a.positive_count||0)+'</td><td>'+Number(a.improvement_count||0)+'</td></tr>'
  ).join("");

  $("highlightSummary").innerHTML=(s.highlights||[]).length
    ? s.highlights.map(i=>'<span class="chip">'+esc(i.issue)+' · '+i.count+'</span>').join("")
    : '<span class="muted">Todavía no hay reconocimientos registrados.</span>';

  $("issueSummary").innerHTML=(s.issues||[]).length
    ? s.issues.map(i=>'<span class="chip">'+esc(i.issue)+' · '+i.count+'</span>').join("")
    : '<span class="muted">Todavía no hay inconvenientes registrados.</span>';

  const current=$("areaFilter").value;
  $("areaFilter").innerHTML='<option value="">Todas las áreas</option>'+AREAS.map(a=>'<option value="'+a.key+'">'+esc(a.name)+'</option>').join("");
  $("areaFilter").value=current;
}

function renderResponses(){
  const type=$("typeFilter").value;
  const area=$("areaFilter").value;
  const rating=$("ratingFilter").value;
  const severity=$("severityFilter").value;
  const q=$("searchFilter").value.toLowerCase().trim();

  const items=allResponses.filter(r=>{
    const searchable=[
      r.comment,
      r.ai_summary,
      r.area_name,
      r.carrera_nombre,
      ...(r.selected_issues||[]),
      ...(r.ai_categories||[])
    ].join(" ").toLowerCase();
    return (!type||r.experience_type===type)&&
      (!area||r.area_key===area)&&
      (!rating||String(r.rating)===rating)&&
      (!severity||r.ai_severity===severity)&&
      (!q||searchable.includes(q));
  });

  $("responseCount").textContent=items.length+" resultados";
  $("responseRows").innerHTML=items.map(r=>{
    const positive=r.experience_type==="positive";
    const type='<span class="type-badge '+(positive?"positive":"improvement")+'">'+typeLabel(r.experience_type)+'</span>';
    const sev=r.ai_severity?'<span class="pill '+(r.ai_severity==="alta"?"bad":r.ai_severity==="baja"?"good":"")+'">'+esc(r.ai_severity)+'</span>':"";
    const categories=(r.ai_categories||[]).length?r.ai_categories:(r.selected_issues||[]);
    return '<tr><td>'+date(r.created_at)+'</td><td>'+type+'</td><td>'+esc(r.carrera_nombre||"")+'</td><td>'+esc(r.area_name||"")+'</td><td>'+r.rating+'/5</td><td>'+esc(categories.join(", "))+'</td><td>'+sev+'<div class="detail">'+esc(r.ai_summary||"Pendiente")+'</div></td><td class="detail">'+esc(r.comment||"—")+'</td></tr>';
  }).join("");
}

function date(v){
  try{return new Intl.DateTimeFormat("es-EC",{dateStyle:"short",timeStyle:"short"}).format(new Date(v));}
  catch{return v||"";}
}