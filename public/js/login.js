/* ================= 3 Attempts Lock ================= */
let attempts = parseInt(localStorage.getItem("attempts") || 0);
let lockUntil = null;


/* ================= CAPTCHA ================= */
let a = Math.floor(Math.random()*10);
let b = Math.floor(Math.random()*10);

document.getElementById("captchaQ").innerText = `Solve: ${a}+${b}`;


/* ================= ELEMENTS ================= */
const usernameInput = document.getElementById("username");
const captchaInput  = document.getElementById("captchaInput");
const loader        = document.getElementById("loader");
const img           = document.getElementById("loginImage");
const imageWrapper  = document.getElementById("imageWrapper");


/* ================= STORAGE ================= */
let storedPoints = [];
let loginPoints  = [];


/* ================= Toast ================= */
function showToast(msg){
  const t = document.getElementById("toast");
  t.innerText = msg;
  t.classList.remove("hidden");
  setTimeout(()=>t.classList.add("hidden"),2000);
}


/* =================================================
   LOAD USER IMAGE + POINTS FROM BACKEND
================================================= */
async function loadUser(){

  const username = usernameInput.value.trim();
  if(!username) return;

  try{

    document.getElementById("imageLoader").classList.remove("hidden");

    const res  = await fetch(`/user/${username}`);
    const data = await res.json();

    if(!data.success){
      showToast("User not found ❌");
      return;
    }

    const imagePath = data.image_path.replace(/\\/g, "/");

  img.src = imagePath.startsWith("http")
    ? imagePath + "?t=" + Date.now()
    : "/" + imagePath + "?t=" + Date.now();

    img.onload = () => {
      document.getElementById("imageLoader").classList.add("hidden");
    };

    document.getElementById("imgBox").classList.remove("hidden");

    storedPoints = typeof data.points === "string"
      ? JSON.parse(data.points)
      : data.points;

    clearLoginPoints();

  }catch(err){
    console.log(err);
    showToast("Server error ❌");
  }
}


/* =================================================
   CAPTURE CLICK POINTS
================================================= */
img.addEventListener("click", function(e){

  if(loginPoints.length >= 4) return;

  const rect = img.getBoundingClientRect();

  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;

  loginPoints.push({x,y});

  let dot = document.createElement("div");
  dot.className = "dot";

  dot.style.position = "absolute";
  dot.style.left = x + "%";
  dot.style.top  = y + "%";
  dot.style.width = "12px";
  dot.style.height = "12px";
  dot.style.background = "yellow";
  dot.style.borderRadius = "50%";
  dot.style.transform = "translate(-50%,-50%)";

  imageWrapper.appendChild(dot);
});


/* =================================================
   CLEAR LOGIN POINTS
================================================= */
function clearLoginPoints(){

  loginPoints = [];

  const dots = imageWrapper.querySelectorAll(".dot");
  dots.forEach(d => d.remove());
}


/* =================================================
   UNDO LOGIN POINT
================================================= */
function undoLoginPoint(){

  if(loginPoints.length === 0) return;

  loginPoints.pop();

  const dots = imageWrapper.querySelectorAll(".dot");

  if(dots.length > 0){
    dots[dots.length - 1].remove();
  }
}


/* =================================================
   TOLERANCE CHECK
================================================= */
function isClose(p1,p2,tol=5){
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx*dx + dy*dy) <= tol;
}


/* =================================================
   LOCK COUNTDOWN TIMER
================================================= */
function startCountdown(){

  const overlay  = document.getElementById("lockOverlay");
  const timerTxt = document.getElementById("lockTimerText");
  const circle   = document.getElementById("progressCircle");
  const loginBtn = document.querySelector("button[onclick='login()']");
  const card     = document.querySelector(".fade-in");
  const sound    = document.getElementById("lockSound");

  overlay.classList.remove("hidden");
  card.classList.add("locked-glow");
  sound.play();

  /* disable inputs */
  usernameInput.disabled = true;
  captchaInput.disabled  = true;
  loginBtn.disabled      = true;

  const totalTime = 5 * 60;
  const circumference = 2 * Math.PI * 60;

  circle.style.strokeDasharray = circumference;

const interval = setInterval(()=>{

  const remaining = lockUntil - Date.now();
  const secondsLeft = Math.ceil(remaining / 1000);

  if(secondsLeft <= 0){

    clearInterval(interval);

    overlay.classList.add("hidden");
    card.classList.remove("locked-glow");

    circle.style.stroke = "#22c55e";

    setTimeout(()=>{
      circle.style.stroke = "#ef4444";
    },1500);

    attempts = 0;
    lockUntil = null;

    usernameInput.disabled = false;
    captchaInput.disabled  = false;
    loginBtn.disabled      = false;

    showToast("Unlocked ✅");
    return;
  }

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  timerTxt.innerText =
    `${mins}:${secs < 10 ? "0"+secs : secs}`;

  const progress = secondsLeft / totalTime;
  circle.style.strokeDashoffset =
    circumference * (1 - progress);

},1000);
}

/* =================================================
   LOGIN
================================================= */
function login(){

  const username = usernameInput.value.trim();
  const captcha  = parseInt(captchaInput.value);

  loader.classList.remove("hidden");

  setTimeout(()=>{

    loader.classList.add("hidden");

    /* 🔒 LOCK CHECK */
    if(lockUntil && Date.now() < lockUntil){
      showToast("Account locked.🔒  Wait ⏳");
      return;
    }

    if(username===""){
      showToast("Enter username ❌");
      return;
    }

    if(username.length<3){
      showToast("Invalid username ❌");
      return;
    }

    if(captcha !== a+b){
      showToast("Wrong captcha ❌");
      return;
    }

    if(loginPoints.length !== 4){
      showToast("Click 4 points ❌");
      return;
    }

    if(!storedPoints || storedPoints.length !== 4){
      showToast("User data error ❌");
      return;
    }

    let matched = 0;

    for(let i=0;i<4;i++){
      if(isClose(loginPoints[i], storedPoints[i])) matched++;
    }

    if(matched === 4)
{
  showToast("Login success ✅");

  localStorage.setItem("loginTime", Date.now());
  localStorage.setItem("username", username);
  localStorage.setItem("lastAttempts", attempts);
  localStorage.setItem("attempts", attempts);
  document.getElementById("attemptDisplay").innerText = "";
  setTimeout(()=>location.href="dashboard.html",1000);
}
    else{

      attempts++;
      localStorage.setItem("attempts", attempts);

      document.getElementById("attemptDisplay").innerText =
        `Attempts: ${attempts}/3`;

      if(attempts >= 3){
        lockUntil = Date.now() + 5 * 60 * 1000;
        showToast("Locked for 5 minutes 🔒");
        startCountdown();
      }else
        {
        document.querySelector(".fade-in").classList.add("shake");
            setTimeout(()=>
          {
        document.querySelector(".fade-in").classList.remove("shake");
          },400);

showToast(`Wrong secret points ❌ (${attempts}/3)`);

      }
    }

  },1000);
}


/* =================================================
   THEME TOGGLE
================================================= */
function toggleTheme(){
  const body=document.getElementById("body");
  body.classList.toggle("from-indigo-600");
  body.classList.toggle("to-purple-700");
  body.classList.toggle("bg-gray-900");
}


/* =================================================
   AUTO LOAD IMAGE WHEN USERNAME ENTERED
================================================= */
usernameInput.addEventListener("blur", loadUser);

usernameInput.addEventListener("input", () => {

  clearLoginPoints();
  img.src = "";
  document.getElementById("imgBox").classList.add("hidden");

});