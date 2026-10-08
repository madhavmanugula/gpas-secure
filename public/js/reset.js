const img = document.getElementById("resetImage");
const imgBox = document.getElementById("imgBox");
const imageWrapper = document.getElementById("imageWrapper");
const fileInput = document.getElementById("newImage");

let points = [];

/* ========= IMAGE PREVIEW ON SELECT ========= */
fileInput.addEventListener("change", function(){

  const file = this.files[0];

  if(!file) return;

  // 🔒 SIZE CHECK
  if(file.size > 300 * 1024){
    alert("Image must be < 300KB ❌");
    fileInput.value = "";
    return;
  }

  // 🔥 PREVIEW IMAGE
  const reader = new FileReader();

  reader.onload = function(e){

    img.src = e.target.result;

    document.getElementById("previewText")
      .classList.remove("hidden");

    // 🔥 RESET OLD POINTS (VERY IMPORTANT)
    clearPoints();

    // Animation
    img.style.opacity = "0.5";
    setTimeout(()=>{
      img.style.opacity = "1";
    }, 200);

  };

  reader.readAsDataURL(file);
});


/* ========= LOAD IMAGE ========= */
window.onload = async function(){

  const email = localStorage.getItem("resetEmail");

  // 🔒 Prevent direct access
  if(!email){
    alert("Unauthorized access ❌");
    window.location.href = "forgot.html";
    return;
  }

  try{
    const res = await fetch(`/get-image?email=${email}&t=${Date.now()}`);
    const data = await res.json();

    if(!data.image){
      alert("Image not found ❌");
      return;
    }

// 🔥 ADD TIMESTAMP TO BUST CACHE
// 🔥 SUPPORT BOTH LOCAL AND CLOUDINARY IMAGES
const imagePath = data.image.replace(/\\/g, "/");

img.src = imagePath.startsWith("http")
  ? imagePath + "?t=" + Date.now()
  : "/" + imagePath + "?t=" + Date.now();

} catch(err) {
  console.log("LOAD IMAGE ERROR:", err);
  alert("Server error ❌");
}
};


/* ========= CLICK POINTS ========= */
img.addEventListener("click", function(e){

  if(points.length >= 4) return;

  const rect = img.getBoundingClientRect();

  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;

  points.push({x, y});

  let dot = document.createElement("div");
  dot.className = "dot";

  dot.style.position = "absolute";
  dot.style.left = x + "%";
  dot.style.top = y + "%";
  dot.style.width = "12px";
  dot.style.height = "12px";
  dot.style.background = "red";
  dot.style.borderRadius = "50%";
  dot.style.border = "2px solid white";
  dot.style.transform = "translate(-50%,-50%)";
  dot.style.pointerEvents = "none";
  dot.style.zIndex = "10";

  imageWrapper.appendChild(dot);

});


/* ========= CLEAR ========= */
function clearPoints(){
  points = [];
  imageWrapper.querySelectorAll(".dot").forEach(d => d.remove());
}


/* ========= UNDO ========= */
function undoPoint(){
  if(points.length === 0) return;

  points.pop();

  const dots = imageWrapper.querySelectorAll(".dot");
  if(dots.length > 0){
    dots[dots.length - 1].remove();
  }
}


/* ========= SAVE ========= */
async function saveNewPassword(){

  if(points.length !== 4){
    alert("Select 4 points ❌");
    return;
  }

  const email = localStorage.getItem("resetEmail");

  try{
    const res = await fetch("/reset-password",{
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        points: points
      })
    });

    const data = await res.json();

    if(data.success){

      alert("Password Updated ✔");

      // ⭐ VERY IMPORTANT (clear session)
      localStorage.removeItem("resetEmail");

      setTimeout(()=>{
        window.location.href = "login.html";
      },1000);

    }else{
      alert("Error updating password ❌");
    }

  }catch(err){
    console.log("RESET ERROR:", err);
    alert("Server error ❌");
  }

}

/* ========= UPDATE IMAGE + PASSWORD ========= */
async function updateImageAndPassword(){

  const file = fileInput.files[0];

  if(!file){
    alert("Select image ❌");
    return;
  }

  if(points.length !== 4){
    alert("Select 4 points ❌");
    return;
  }

  const email = localStorage.getItem("resetEmail");

  const formData = new FormData();
  formData.append("image", file);
  formData.append("email", email);
  formData.append("points", JSON.stringify(points));

  console.log("SENDING UPDATE WITH POINTS:", points);  // 🔥 DEBUG

  try{
    const res = await fetch("/update-image-password",{
      method: "POST",
      body: formData
    });

    let data;
    const text = await res.text();

    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error("UPDATE IMAGE RESPONSE TEXT:", text);
      throw new Error("Invalid JSON response from server");
    }

    console.log("UPDATE RESPONSE:", data);  // 🔥 DEBUG

    if(data.success){
      alert("Image + Password Updated ✔");

      localStorage.removeItem("resetEmail");

      setTimeout(()=>{
        window.location.href = "login.html";
      }, 1000);
    }else{
      alert("Error updating ❌");
    }

  }catch(err){
    console.log("UPDATE IMAGE ERROR:", err);
    alert("Server error ❌");
  }

}