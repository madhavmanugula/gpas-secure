window.onload = async function(){

  const res = await fetch("/all-users");
  const data = await res.json();

  if(data.error){
    alert("Access denied ❌");
    location.href="dashboard.html";
    return;
  }

  const div = document.getElementById("users");

  data.users.forEach(u=>{
    div.innerHTML += `
      <div class="border p-2 mb-2 flex justify-between">
        ${u.username} (${u.role})
        <button onclick="deleteUser('${u.username}')"
          class="bg-red-500 px-2 py-1 text-xs rounded">
          Delete
        </button>
      </div>
    `;
  });
};

async function deleteUser(username){

  await fetch("/delete-user",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      username
    })
  });

  location.reload();
}