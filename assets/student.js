import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { APP_CONFIG } from "./config.js";
import { AREAS, RATINGS, POSITIVE_TAGS, searchAreas } from "./catalog.js";

const fb=initializeApp(APP_CONFIG.firebase),db=getFirestore(fb);
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const state={
  student:null,
  mode:null,
  area:null,
  rating:null,
  tags:[],
  resolution:null,
  evaluations:[],
  contactRequested:false
};
const steps=["stepStudent","stepArea","stepExperience","stepFinish"];

function show(id,pct){
  steps.forEach(x=>$(x).classList.toggle("hidden",x!==id));
  $("done").classList.add("hidden");
  $("progress").style.width=pct+"%";
  window.scrollTo({top:0,behavior:"smooth"});
}
function status(id,type,msg){$(id).innerHTML=msg?'<div class="status '+type+'">'+esc(msg)+'</div>':"";}
function count(type){return state.evaluations.filter(x=>x.experienceType===type).length;}
function labelType(type){return type==="positive"?"Reconocimiento":"Por mejorar";}

async function checkBackend(){
  if(!APP_CONFIG.apiBase){
    status("systemStatus","warn","La encuesta todavía no está enlazada al servidor de envío.");
    return false;
  }
  try{
    const r=await fetch(APP_CONFIG.apiBase.replace(/\/$/,"")+"/health",{cache:"no-store"});
    const j=await r.json().catch(()=>({}));
    if(r.ok&&j.ok&&j.database&&j.hashPepperConfigured){
      status("systemStatus","ok","Sistema conectado y listo para recibir respuestas.");
      return true;
    }
    status("systemStatus","warn","El servidor responde, pero la configuración todavía no está completa.");
    return false;
  }catch(_){
    status("systemStatus","error","No se pudo verificar la conexión con el servidor.");
    return false;
  }
}
checkBackend();

$("cedula").oninput=e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,10);
$("studentForm").onsubmit=async e=>{
  e.preventDefault();
  const cedula=$("cedula").value;
  if(cedula.length!==10){status("studentStatus","error","Ingresa una cédula de 10 dígitos.");return;}
  $("lookupBtn").disabled=true;$("lookupBtn").textContent="Consultando...";
  try{
    const snap=await getDoc(doc(db,"Estudiante",cedula));
    if(!snap.exists()) throw new Error("No encontramos un estudiante con esa cédula.");
    const d=snap.data();
    if(d.eliminado===true) throw new Error("El registro no se encuentra activo.");
    state.student={
      cedula,
      nombres:d.nombres||"",
      carreraCodigo:d.codigoCarreraActual||"",
      carreraNombre:d.nombreCarreraActual||"",
      sede:d.sede||"",
      correoInstitucional:d.correoInstitucional||"",
      celular:d.celular||""
    };
    $("studentInfo").innerHTML="<strong>"+esc(state.student.nombres)+"</strong><span>"+esc(state.student.carreraNombre)+" · "+esc(state.student.sede)+"</span>";
    renderAreaSummary();
    show("stepArea",50);
  }catch(err){
    status("studentStatus","error",err.message||"No fue posible consultar tus datos.");
  }finally{
    $("lookupBtn").disabled=false;$("lookupBtn").textContent="Continuar";
  }
};

$("addPositive").onclick=()=>beginExperience("positive");
$("addImprovement").onclick=()=>beginExperience("improvement");
$("continueReview").onclick=()=>{
  if(!state.evaluations.length){status("areaStatus","warn","Agrega al menos una experiencia antes de continuar.");return;}
  renderFinalList();
  show("stepFinish",100);
};
$("backToAreas").onclick=()=>{renderAreaSummary();show("stepArea",50);};

function renderAreaSummary(){
  const positives=state.evaluations.filter(x=>x.experienceType==="positive");
  const improvements=state.evaluations.filter(x=>x.experienceType==="improvement");
  $("positiveCount").textContent=positives.length+" de 2";
  $("improvementCount").textContent=improvements.length+" de 2";
  $("addPositive").disabled=positives.length>=2;
  $("addImprovement").disabled=improvements.length>=2;
  $("positiveList").innerHTML=positives.map((e,i)=>miniItem(e,state.evaluations.indexOf(e))).join("");
  $("improvementList").innerHTML=improvements.map((e,i)=>miniItem(e,state.evaluations.indexOf(e))).join("");
  document.querySelectorAll(".remove-mini").forEach(b=>b.onclick=()=>{state.evaluations.splice(Number(b.dataset.i),1);renderAreaSummary();});
  status("areaStatus","","");
}
function miniItem(e,index){
  return '<div class="mini-item"><div><strong>'+esc(e.areaName)+'</strong><div class="muted">'+esc(e.tags.join(", ")||"Sin categoría adicional")+'</div></div><button type="button" class="btn ghost remove-mini" data-i="'+index+'">Quitar</button></div>';
}

function beginExperience(type){
  if(count(type)>=2) return;
  state.mode=type;
  state.area=null;
  state.rating=null;
  state.tags=[];
  state.resolution=type==="positive"?"no-aplica":null;
  $("areaSearch").value="";
  $("experienceForm").classList.add("hidden");
  $("suggestions").innerHTML="";
  status("experienceStatus","","");
  if(type==="positive"){
    $("experienceTypeBadge").innerHTML='<span class="type-badge positive">Lo que hicieron bien</span>';
    $("experienceHeading").textContent="Reconoce un área";
    $("experienceHelp").textContent="Puedes registrar una sola área positiva, dos o ninguna. El comentario es opcional.";
  }else{
    $("experienceTypeBadge").innerHTML='<span class="type-badge improvement">Lo que podemos mejorar</span>';
    $("experienceHeading").textContent="Reporta un inconveniente";
    $("experienceHelp").textContent="Selecciona el área donde tuviste una dificultad. Puedes registrar hasta dos.";
  }
  renderSuggestions("");
  show("stepExperience",75);
}

$("areaSearch").oninput=e=>renderSuggestions(e.target.value);
function renderSuggestions(q){
  const found=searchAreas(q);
  $("suggestions").innerHTML=found.map(a=>'<button type="button" class="suggestion" data-area="'+a.key+'">'+esc(a.name)+'</button>').join("");
  $("suggestions").querySelectorAll("[data-area]").forEach(b=>b.onclick=()=>selectArea(b.dataset.area));
}
function selectArea(key){
  state.area=AREAS.find(a=>a.key===key);
  state.rating=null;state.tags=[];state.resolution=state.mode==="positive"?"no-aplica":null;
  $("selectedArea").innerHTML="<strong>"+esc(state.area.name)+"</strong><span>"+esc(state.mode==="positive"?"Área que quieres reconocer":"Área con oportunidad de mejora")+"</span>";
  $("experienceForm").classList.remove("hidden");
  $("suggestions").innerHTML="";
  $("areaSearch").value=state.area.name;

  const allowedRatings=state.mode==="positive"?RATINGS.filter(r=>r.value>=4):RATINGS.filter(r=>r.value<=3);
  $("ratingLabel").textContent=state.mode==="positive"?"¿Qué tan buena fue la experiencia?":"¿Cómo calificarías esa experiencia?";
  $("ratings").innerHTML=allowedRatings.map(r=>'<button type="button" class="rating" data-rating="'+r.value+'"><span>'+r.emoji+'</span>'+r.label+'</button>').join("");
  $("ratings").querySelectorAll("[data-rating]").forEach(b=>b.onclick=()=>{
    state.rating=Number(b.dataset.rating);
    $("ratings").querySelectorAll(".rating").forEach(x=>x.classList.toggle("selected",x===b));
  });

  const tags=state.mode==="positive"?POSITIVE_TAGS:state.area.issues;
  $("tagsLabel").textContent=state.mode==="positive"?"¿Qué hicieron bien? Puedes marcar varios puntos.":"¿Qué ocurrió? Puedes marcar varios puntos.";
  $("issues").innerHTML=tags.map(t=>'<button type="button" class="chip" data-tag="'+esc(t)+'">'+esc(t)+'</button>').join("");
  $("issues").querySelectorAll("[data-tag]").forEach(b=>b.onclick=()=>{
    const t=b.dataset.tag;
    if(state.tags.includes(t)) state.tags=state.tags.filter(x=>x!==t); else state.tags.push(t);
    b.classList.toggle("selected");
  });

  $("resolutionBlock").classList.toggle("hidden",state.mode==="positive");
  document.querySelectorAll("#resolution button").forEach(x=>x.classList.remove("selected"));
  $("comment").value="";
  $("comment").placeholder=state.mode==="positive"?"Puedes dejar un reconocimiento breve si deseas.":"Cuéntanos brevemente qué pasó, si deseas.";
}
document.querySelectorAll("#resolution button").forEach(b=>b.onclick=()=>{
  state.resolution=b.dataset.value;
  document.querySelectorAll("#resolution button").forEach(x=>x.classList.toggle("selected",x===b));
});

$("cancelExperience").onclick=()=>{renderAreaSummary();show("stepArea",50);};
$("saveExperience").onclick=()=>{
  if(!state.area){status("experienceStatus","error","Selecciona un área.");return;}
  if(!state.rating){status("experienceStatus","error","Selecciona una calificación.");return;}
  if(state.mode==="improvement"&&!state.resolution){status("experienceStatus","error","Indica si el problema fue solucionado.");return;}
  if(count(state.mode)>=2){status("experienceStatus","warn","Ya registraste el máximo de 2 áreas en este bloque.");return;}
  if(state.evaluations.some(x=>x.experienceType===state.mode&&x.areaKey===state.area.key)){
    status("experienceStatus","warn","Esta área ya está registrada en este bloque.");
    return;
  }

  state.evaluations.push({
    experienceType:state.mode,
    areaKey:state.area.key,
    areaName:state.area.name,
    rating:state.rating,
    hadProblem:state.mode==="improvement",
    issues:[...state.tags],
    tags:[...state.tags],
    resolution:state.resolution||"no-aplica",
    comment:$("comment").value.trim()
  });
  renderAreaSummary();
  show("stepArea",50);
};

function renderFinalList(){
  $("evaluationList").innerHTML=state.evaluations.map((e,i)=>{
    const cls=e.experienceType==="positive"?"positive":"improvement";
    return '<div class="evaluation-item"><div><span class="type-badge '+cls+'">'+labelType(e.experienceType)+'</span><strong style="display:block;margin-top:6px">'+esc(e.areaName)+'</strong><div class="muted">'+e.rating+'/5'+(e.tags.length?' · '+esc(e.tags.join(", ")):"")+(e.comment?' · '+esc(e.comment):"")+'</div></div><button type="button" class="btn ghost remove-final" data-i="'+i+'">Quitar</button></div>';
  }).join("");
  document.querySelectorAll(".remove-final").forEach(b=>b.onclick=()=>{state.evaluations.splice(Number(b.dataset.i),1);renderFinalList();if(!state.evaluations.length){renderAreaSummary();show("stepArea",50);}});
}

document.querySelectorAll("#contactChoice button").forEach(b=>b.onclick=()=>{
  state.contactRequested=b.dataset.value==="true";
  document.querySelectorAll("#contactChoice button").forEach(x=>x.classList.toggle("selected",x===b));
});

$("submitSurvey").onclick=async()=>{
  if(!state.evaluations.length){status("submitStatus","error","Agrega al menos una experiencia.");return;}
  if(!APP_CONFIG.apiBase){status("submitStatus","warn","La encuesta ya está corregida, pero todavía falta enlazar el backend de Neon.");return;}
  const btn=$("submitSurvey");btn.disabled=true;btn.textContent="Enviando...";
  try{
    const payload={
      student:{
        cedula:state.student.cedula,
        carreraCodigo:state.student.carreraCodigo,
        carreraNombre:state.student.carreraNombre,
        sede:state.student.sede,
        correoInstitucional:state.contactRequested?state.student.correoInstitucional:"",
        celular:state.contactRequested?state.student.celular:""
      },
      contactRequested:state.contactRequested,
      evaluations:state.evaluations
    };
    const r=await fetch(APP_CONFIG.apiBase.replace(/\/$/,"")+"/survey",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error||"No fue posible registrar la encuesta.");
    steps.forEach(x=>$(x).classList.add("hidden"));
    $("done").classList.remove("hidden");
    $("progress").style.width="100%";
  }catch(err){
    status("submitStatus","error",err.message);
  }finally{
    btn.disabled=false;btn.textContent="Enviar encuesta";
  }
};