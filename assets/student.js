import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { APP_CONFIG } from "./config.js";
import { AREAS, RATINGS, searchAreas } from "./catalog.js";

const fb=initializeApp(APP_CONFIG.firebase), db=getFirestore(fb);
const S={student:null,area:null,rating:null,hadProblem:null,issues:[],resolution:null,evaluations:[],contactRequested:false};
const $=id=>document.getElementById(id);
const steps=["stepStudent","stepArea","stepExperience","stepFinish"];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
function show(id,pct){steps.forEach(x=>$(x).classList.toggle("hidden",x!==id));$("done").classList.add("hidden");$("progress").style.width=pct+"%";window.scrollTo({top:0,behavior:"smooth"});}
function status(id,type,msg){$(id).innerHTML=msg?'<div class="status '+type+'">'+esc(msg)+'</div>':"";}
function renderAreas(q=""){const found=searchAreas(q);$("suggestions").innerHTML=found.map(a=>'<button type="button" class="suggestion" data-area="'+a.key+'">'+esc(a.name)+'</button>').join("");$("suggestions").querySelectorAll("[data-area]").forEach(b=>b.onclick=()=>chooseArea(b.dataset.area));}

$("cedula").oninput=e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,10);
$("studentForm").onsubmit=async e=>{
  e.preventDefault(); const cedula=$("cedula").value;
  if(cedula.length!==10){status("studentStatus","error","Ingresa una cédula de 10 dígitos.");return;}
  $("lookupBtn").disabled=true;$("lookupBtn").textContent="Consultando...";
  try{
    const snap=await getDoc(doc(db,"Estudiante",cedula));
    if(!snap.exists()) throw new Error("No encontramos un estudiante con esa cédula.");
    const d=snap.data(); if(d.eliminado===true) throw new Error("El registro no se encuentra activo.");
    S.student={cedula,nombres:d.nombres||"",carreraCodigo:d.codigoCarreraActual||"",carreraNombre:d.nombreCarreraActual||"",sede:d.sede||"",correoInstitucional:d.correoInstitucional||"",celular:d.celular||""};
    $("studentInfo").innerHTML="<strong>"+esc(S.student.nombres)+"</strong><span>"+esc(S.student.carreraNombre)+" · "+esc(S.student.sede)+"</span>";
    renderAreas(); show("stepArea",50);
  }catch(err){status("studentStatus","error",err.message||"No fue posible consultar tus datos.");}
  finally{$("lookupBtn").disabled=false;$("lookupBtn").textContent="Continuar";}
};
$("areaSearch").oninput=e=>renderAreas(e.target.value);

function chooseArea(key){
  S.area=AREAS.find(a=>a.key===key);S.rating=null;S.hadProblem=null;S.issues=[];S.resolution=null;$("comment").value="";
  $("areaTitle").textContent=S.area.name;
  $("ratings").innerHTML=RATINGS.map(r=>'<button type="button" class="rating" data-rating="'+r.value+'"><span>'+r.emoji+'</span>'+r.label+'</button>').join("");
  $("ratings").querySelectorAll("[data-rating]").forEach(b=>b.onclick=()=>{S.rating=Number(b.dataset.rating);$("ratings").querySelectorAll(".rating").forEach(x=>x.classList.toggle("selected",x===b));});
  $("issues").innerHTML=S.area.issues.map(i=>'<button type="button" class="chip" data-issue="'+esc(i)+'">'+esc(i)+'</button>').join("");
  $("issues").querySelectorAll("[data-issue]").forEach(b=>b.onclick=()=>{const i=b.dataset.issue;if(S.issues.includes(i))S.issues=S.issues.filter(x=>x!==i);else S.issues.push(i);b.classList.toggle("selected");});
  document.querySelectorAll("#hadProblem button,#resolution button").forEach(x=>x.classList.remove("selected"));
  $("problemBlock").classList.add("hidden");show("stepExperience",75);
}
document.querySelectorAll("#hadProblem button").forEach(b=>b.onclick=()=>{S.hadProblem=b.dataset.value==="true";document.querySelectorAll("#hadProblem button").forEach(x=>x.classList.toggle("selected",x===b));$("problemBlock").classList.toggle("hidden",!S.hadProblem);if(!S.hadProblem){S.issues=[];S.resolution="no-aplica";}});
document.querySelectorAll("#resolution button").forEach(b=>b.onclick=()=>{S.resolution=b.dataset.value;document.querySelectorAll("#resolution button").forEach(x=>x.classList.toggle("selected",x===b));});
document.querySelectorAll("#contactChoice button").forEach(b=>b.onclick=()=>{S.contactRequested=b.dataset.value==="true";document.querySelectorAll("#contactChoice button").forEach(x=>x.classList.toggle("selected",x===b));});

$("addEvaluation").onclick=()=>{
  if(!S.rating){status("experienceStatus","error","Selecciona una calificación.");return;}
  if(S.hadProblem===null){status("experienceStatus","error","Indica si tuviste algún inconveniente.");return;}
  if(S.hadProblem&&!S.resolution){status("experienceStatus","error","Indica si el problema fue solucionado.");return;}
  S.evaluations.push({areaKey:S.area.key,areaName:S.area.name,rating:S.rating,hadProblem:S.hadProblem,issues:[...S.issues],resolution:S.resolution||"no-aplica",comment:$("comment").value.trim()});
  renderList();show("stepFinish",100);
};
function renderList(){
  $("evaluationList").innerHTML=S.evaluations.map((e,i)=>'<div class="evaluation-item"><div><strong>'+esc(e.areaName)+'</strong><div class="muted">'+e.rating+'/5'+(e.issues.length?' · '+esc(e.issues.join(", ")):"")+'</div></div><button type="button" class="btn ghost remove-eval" data-i="'+i+'">Quitar</button></div>').join("");
  document.querySelectorAll(".remove-eval").forEach(b=>b.onclick=()=>{S.evaluations.splice(Number(b.dataset.i),1);renderList();if(!S.evaluations.length)show("stepArea",50);});
}
$("anotherArea").onclick=()=>{ $("areaSearch").value="";renderAreas();show("stepArea",50); };
$("submitSurvey").onclick=async()=>{
  if(!APP_CONFIG.apiBase){status("submitStatus","warn","Falta enlazar el backend de Neon.");return;}
  const btn=$("submitSurvey");btn.disabled=true;btn.textContent="Enviando...";
  try{
    const payload={student:{cedula:S.student.cedula,carreraCodigo:S.student.carreraCodigo,carreraNombre:S.student.carreraNombre,sede:S.student.sede,correoInstitucional:S.contactRequested?S.student.correoInstitucional:"",celular:S.contactRequested?S.student.celular:""},contactRequested:S.contactRequested,evaluations:S.evaluations};
    const r=await fetch(APP_CONFIG.apiBase.replace(/\/$/,"")+"/survey",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||"No fue posible registrar la encuesta.");
    steps.forEach(x=>$(x).classList.add("hidden"));$("done").classList.remove("hidden");
  }catch(err){status("submitStatus","error",err.message);}
  finally{btn.disabled=false;btn.textContent="Enviar encuesta";}
};