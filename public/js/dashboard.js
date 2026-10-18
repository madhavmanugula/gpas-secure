let interval;

/* ========= CHART ========= */
function loadChart(){

  const attempts = parseInt(localStorage.getItem("attempts") || 0);

  new Chart(document.getElementById("attemptChart"),{
    type:'line',
    data:{
      labels:["Attempt 1","Attempt 2","Attempt 3"],
      datasets:[{
        data:[
          attempts >=1 ? 1 : 0,
          attempts >=2 ? 2 : 0,
          attempts >=3 ? 3 : 0
        ],
        borderColor:"#22d3ee",
        backgroundColor:"rgba(34,211,238,0.2)",
        fill:true,
        tension:0.4
      }]
    },
    options:{
      plugins:{legend:{display:false}},
      scales:{
        x:{ticks:{color:"#aaa"}},
        y:{ticks:{color:"#aaa"}}
      }
    }
  });
}

window.onload = async function(){

  const username = localStorage.getItem("username");
  const loginTime = localStorage.getItem("loginTime");

  if(!username){
    location.href="login.html";
    return;
  }

  if(!loginTime){
    logout();
    return;
  }

  document.getElementById("userDisplay").innerText = username;
  document.getElementById("userEmail").innerText = username + "@gmail.com";

  // Check admin access via backend
  const res = await fetch("/session");
  if (!res.ok) { logout(); return; }
  const sessionData = await res.json();
  if (sessionData.role === "admin") document.getElementById("adminButton").classList.remove("hidden");
  /* Admin role is verified by the server, not local storage. */
  const adminCheck = await fetch("/all-users");
  if(adminCheck.ok){ document.getElementById("adminButton").classList.remove("hidden"); }

  let time = new Date(parseInt(loginTime));

  document.getElementById("sessionInfo").innerText =
    "Session: " + time.toLocaleTimeString();

  document.getElementById("lastLogin").innerText =
    "Last Login: " + time.toLocaleString();

  let attempts = parseInt(localStorage.getItem("lastAttempts") || localStorage.getItem("attempts") || 0);

  document.getElementById("attemptInfo").innerText =
    "Attempts: " + attempts;

  /* SECURITY SCORE */
  let score = 100 - (attempts * 10);
  if(score < 50) score = 50;

  document.getElementById("score").innerText = score + "%";
  document.getElementById("score").style.color = score < 80 ? "red" : "#facc15";

  /* WARNING SYSTEM */
  const alertBox = document.getElementById("alertBox");
  if(attempts >= 2){
    alertBox.innerHTML = "⚠️ Suspicious Activity Detected";
    alertBox.classList.remove("hidden");
  }else{
    alertBox.classList.add("hidden");
  }

  /* ATTEMPTS COLOR */
  if(attempts > 0){
    document.getElementById("attemptInfo").style.color = "orange";
  }

  /* TIMELINE */
  const timeline = document.getElementById("timeline");
  let timelineHTML = "";

  if(attempts > 0){
    timelineHTML += `<li>⚠️ ${attempts} Failed Attempts Detected</li>`;
  }

  timelineHTML += `
    <li>✔ Login Success</li>
    <li>✔ Session Started</li>
    <li>✔ Secure Access Granted</li>
  `;

  timeline.innerHTML = timelineHTML;

  /* LOAD IMAGE */
  try{
    let res = await fetch(`/user/${encodeURIComponent(username)}`);
    let data = await res.json();

    if(data.success){
      let img = document.getElementById("profileImage");
      img.src = "/" + data.image_path;
      img.classList.remove("hidden");
    }
  }catch(e){}

  /* 🔥 CALL EVERYTHING */
  loadChart();
  loadFiles();
  updateStorage();

  startTimer(loginTime);
};


/* TIMER */
function startTimer(loginTime){

  let total = 5 * 60 * 1000;

  interval = setInterval(()=>{

    let remain = total - (Date.now() - parseInt(loginTime));

    if(remain <= 0){
      logout();
    }

    let m = Math.floor(remain/60000);
    let s = Math.floor((remain%60000)/1000);

    document.getElementById("timer").innerText =
      `${m}:${s<10?"0"+s:s}`;

  },1000);
}


/* LOGOUT */
async function logout(){
  clearInterval(interval);
  try { await fetch("/logout", { method: "POST", credentials: "same-origin" }); } catch (_) {}
  localStorage.clear();
  location.href="login.html";
}

/* ========= DRAG & DROP ========= */
window.addEventListener("DOMContentLoaded", ()=>{
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");

  if(!dropZone || !fileInput) return;

  dropZone.onclick = () => fileInput.click();

  dropZone.addEventListener("dragover", e=>{
    e.preventDefault();
    dropZone.classList.add("bg-white/10");
  });

  dropZone.addEventListener("dragleave", ()=>{
    dropZone.classList.remove("bg-white/10");
  });

  dropZone.addEventListener("drop", e=>{
    e.preventDefault();
    fileInput.files = e.dataTransfer.files;
    uploadFile();
  });

  fileInput.addEventListener("change", uploadFile);
});

/* ========= FILE UPLOAD ========= */
async function uploadFile(){
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];
  const username = localStorage.getItem("username");
  if(!file) return;
  if(!username){ alert("Please log in again before uploading."); return; }

  const formData = new FormData();
  formData.append("file", file);
  const xhr = new XMLHttpRequest();
  xhr.upload.onprogress = e=>{
    if(e.lengthComputable){
      document.getElementById("progressBar").style.width = (e.loaded / e.total * 100) + "%";
    }
  };
  xhr.onload = ()=>{
    let result = {};
    try { result = JSON.parse(xhr.responseText); } catch (_) {}
    if(xhr.status < 200 || xhr.status >= 300 || !result.success){
      alert(result.error || "Upload failed. Please try again.");
      return;
    }
    fileInput.value = "";
    document.getElementById("progressBar").style.width = "0%";
    loadFiles();
    updateStorage();
  };
  xhr.onerror = ()=>alert("Upload failed. Check your connection and try again.");
  xhr.open("POST","/upload-file");
  xhr.send(formData);
}

function escapeFileText(value){
  return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[ch]));
}

/* LOAD FILES */
async function loadFiles(){
  const username = localStorage.getItem("username");
  const list = document.getElementById("fileList");
  if(!username || !list) return;
  try {
    const res = await fetch("/get-files");
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Could not load files");
    list.innerHTML = "";
    data.files.forEach(file=>{
      const key = String(file.key || "");
      const name = String(file.name || key.split("/").pop() || "file");
      const lower = name.toLowerCase();
      const fileUrl = String(file.url || "");
      const downloadUrl = String(file.downloadUrl || file.url || "");
      let icon = "📄";
      if(/\.(jpg|png|jpeg|gif|avif|webp)$/i.test(lower)) icon = "🖼️";
      else if(lower.endsWith(".pdf")) icon = "📕";
      else if(/\.(docx|doc)$/i.test(lower)) icon = "📄";
      else if(/\.(zip|rar)$/i.test(lower)) icon = "📦";
      const previewable = /\.(jpg|png|jpeg|gif|avif|webp|pdf)$/i.test(lower);
      list.innerHTML += `
        <div class="flex items-center justify-between bg-white/10 p-3 rounded-xl hover:scale-105 transition">
          <div class="flex items-center gap-2"><span>${icon}</span><span class="text-xs">${escapeFileText(name)}</span></div>
          <div class="flex gap-2">
            ${previewable ? `<button data-file-url="${escapeFileText(fileUrl)}" class="preview-file bg-blue-500 px-2 py-1 text-xs rounded hover:scale-110">👁️</button>` : `<button disabled class="bg-slate-500/60 px-2 py-1 text-xs rounded cursor-not-allowed">👁️</button>`}
            <a href="${escapeFileText(downloadUrl)}" target="_blank" rel="noopener noreferrer" class="bg-green-500 px-2 py-1 text-xs rounded hover:scale-110">⬇️</a>
            <button data-file-key="${escapeFileText(key)}" class="delete-file bg-red-500 px-2 py-1 text-xs rounded hover:scale-110">🗑️</button>
          </div>
        </div>`;
    });
    list.querySelectorAll(".preview-file").forEach(btn=>btn.addEventListener("click",()=>previewFile(btn.dataset.fileUrl)));
    list.querySelectorAll(".delete-file").forEach(btn=>btn.addEventListener("click",()=>deleteFile(btn.dataset.fileKey)));
  } catch(err) {
    console.error("LOAD FILES ERROR:", err);
    list.innerHTML = `<p class="text-sm text-red-300">${escapeFileText(err.message || "Could not load files")}</p>`;
  }
}

/* PREVIEW SYSTEM: signed R2 links expire after five minutes. */
function previewFile(fileUrl){
  const modal = document.getElementById("previewModal");
  const img = document.getElementById("previewImg");
  const pdf = document.getElementById("previewPdf");
  const lower = String(fileUrl || "").toLowerCase().split("?")[0];
  modal.classList.remove("hidden");
  if(/\.(jpg|png|jpeg|gif|avif|webp)$/i.test(lower)){
    img.src = fileUrl;
    img.classList.remove("hidden");
    pdf.classList.add("hidden");
  } else if(lower.endsWith(".pdf")){
    pdf.data = fileUrl;
    pdf.classList.remove("hidden");
    img.classList.add("hidden");
  } else {
    modal.classList.add("hidden");
    alert("Preview not supported for this file type. Please download the file instead.");
  }
}

function closePreview(){
  const modal = document.getElementById("previewModal");
  const img = document.getElementById("previewImg");
  const pdf = document.getElementById("previewPdf");
  img.src = "";
  pdf.data = "";
  img.classList.add("hidden");
  pdf.classList.add("hidden");
  modal.classList.add("hidden");
}

/* STORAGE METER (demo estimate retained) */
async function updateStorage(){
  const username = localStorage.getItem("username");
  if(!username) return;
  try {
    const res = await fetch("/get-files");
    const data = await res.json();
    const size = (data.files || []).length * 2;
    const storage = document.getElementById("storage");
    if(storage) storage.innerText = size + "%";
  } catch(err) { console.error("STORAGE METER ERROR:", err); }
}

/* DELETE FILE */
async function deleteFile(key){
  if(!confirm("Delete this file?")) return;
  const username = localStorage.getItem("username");
  try{
    const res = await fetch("/delete-file",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({path:key})
    });
    const data = await res.json();
    if(!res.ok || !data.success){ alert("Delete failed: " + (data.error || "Unknown error")); return; }
    loadFiles();
    updateStorage();
  }catch(err){ alert("Delete failed: " + err.message); }
}
