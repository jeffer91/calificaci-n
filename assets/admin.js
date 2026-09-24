import { APP_CONFIG } from "./config.js";
import { AREAS } from "./catalog.js";
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
let adminKey=sessionStorage.getItem("surveyAdminKey")||"", allResponses=[];
function status(id,type,msg){$(id).innerHTML=msg?'<div class="status '+type+'">'+esc(msg)+'</div>':"";}
function headers(){return {"X-Admin-Key":adminKey};}
function api(path){return APP_CONFIG.apiBase.replace(/\/$/,"")+path;}

$("loginForm").onsubmit=async e=>{e.preventDefault();adminKey=$("adminKey").value.trim();await load(true);};
$("refreshBtn").onclick=()=>load(false);
["areaFilter","ratingFilter","severityFilter","searchFilter"].forEach(id=>$(id).addEventListener(id==="searchFilter"?"input":"change",renderResponses));
if(adminKey) load(true);

async function load(fromLogin){
  if(!APP_CONFIG.apiBase){status("loginStatus","warn","Falta enlazar el backend de Neon.");return;}
  try{
    const [sRes,rRes]=await Promise.all([fetch(api("/admin/summary"),{headers:headers()}),fetch(api("/admin/responses?limit=500"),{headers:headers()})]);
    if(sRes.status===401||rRes.status===401) throw new Error("Clave administrativa incorrecta.");
    if(!sRes.ok||!rRes.ok) throw new Error("No fue posible cargar el panel.");
    const summary=await sRes.json(), responses=await rRes.json();
    sessionStorage.setItem("surveyAdminKey",adminKey); allResponses=responses.items||[];
    $("loginBox").classList.add("hidden");$("dashboard").classList.remove("hidden");
    renderSummary(summary);renderResponses();status("adminStatus","","");
  }catch(err){if(fromLogin){sessionStorage.removeItem("surveyAdminKey");status("loginStatus","error",err.message);}else status("adminStatus","error",err.message);}
}
function renderSummary(s){
  const cards=[["Encuestas",s.surveys||0],["Evaluaciones",s.evaluations||0],["Satisfacción",Number(s.avgRating||0).toFixed(1)+"/5"],["Casos críticos",s.highSeverity||0]];
  $("metrics").innerHTML=cards.map(x=>'<div class="metric"><b>'+esc(x[1])+'</b><span>'+esc(x[0])+'</span></div>').join("");
  $("areaRows").innerHTML=(s.areas||[]).map(a=>'<tr><td>'+esc(a.area_name)+'</td><td>'+a.count+'</td><td>'+Number(a.avg_rating).toFixed(1)+'/5</td><td>'+Number(a.problem_pct).toFixed(0)+'%</td></tr>').join("");
  $("issueSummary").innerHTML=(s.issues||[]).map(i=>'<span class="chip">'+esc(i.issue)+' · '+i.count+'</span>').join("");
  const current=$("areaFilter").value;$("areaFilter").innerHTML='<option value="">Todas las áreas</option>'+AREAS.map(a=>'<option value="'+a.key+'">'+esc(a.name)+'</option>').join("");$("areaFilter").value=current;
}
function renderResponses(){
  const area=$("areaFilter").value,rating=$("ratingFilter").value,severity=$("severityFilter").value,q=$("searchFilter").value.toLowerCase().trim();
  const items=allResponses.filter(r=>(!area||r.area_key===area)&&(!rating||String(r.rating)===rating)&&(!severity||r.ai_severity===severity)&&(!q||String(r.comment||"").toLowerCase().includes(q)||String(r.ai_summary||"").toLowerCase().includes(q)));
  $("responseCount").textContent=items.length+" resultados";
  $("responseRows").innerHTML=items.map(r=>{const sev=r.ai_severity?'<span class="pill '+(r.ai_severity==="alta"?"bad":r.ai_severity==="baja"?"good":"")+'">'+esc(r.ai_severity)+'</span>':"";return '<tr><td>'+date(r.created_at)+'</td><td>'+esc(r.carrera_nombre||"")+'</td><td>'+esc(r.area_name||"")+'</td><td>'+r.rating+'/5</td><td>'+esc((r.selected_issues||[]).join(", "))+'</td><td>'+sev+'<div class="detail">'+esc(r.ai_summary||"Pendiente")+'</div></td><td class="detail">'+esc(r.comment||"—")+'</td></tr>';}).join("");
}
function date(v){try{return new Intl.DateTimeFormat("es-EC",{dateStyle:"short",timeStyle:"short"}).format(new Date(v));}catch{return v||"";}}