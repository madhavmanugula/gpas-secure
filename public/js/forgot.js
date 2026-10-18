let recoveryRequestId = null;

async function sendOTP() {
  const identifier = document.getElementById("email").value.trim();
  const status = document.getElementById("recoveryStatus");
  status.textContent = "";

  if (!identifier) {
    status.textContent = "Enter your registered email or username.";
    return;
  }

  try {
    const res = await fetch("/recovery/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      status.textContent = data.error || "Could not start recovery.";
      return;
    }

    recoveryRequestId = data.requestId;
    sessionStorage.removeItem("recoveryToken");
    sessionStorage.removeItem("recoveryRequestId");
    sessionStorage.setItem("recoveryRequestId", recoveryRequestId);

    document.getElementById("otp").value = "";
    status.textContent = data.message || "If the account exists with a registered email, a recovery code will be sent.";
  } catch (err) {
    console.error("RECOVERY REQUEST ERROR:", err);
    status.textContent = "Server error. Try again.";
  }
}

async function verifyOTP() {
  const entered = document.getElementById("otp").value.trim();
  const status = document.getElementById("recoveryStatus");
  const requestId = recoveryRequestId || sessionStorage.getItem("recoveryRequestId");

  if (!requestId) {
    status.textContent = "Generate an OTP first.";
    return;
  }
  if (!entered) {
    status.textContent = "Enter the OTP.";
    return;
  }

  try {
    const res = await fetch("/recovery/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, otp: entered })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      status.textContent = data.error || "OTP verification failed.";
      return;
    }

    sessionStorage.setItem("recoveryToken", data.recoveryToken);
    sessionStorage.removeItem("recoveryRequestId");
    window.location.href = "reset.html";
  } catch (err) {
    console.error("OTP VERIFY ERROR:", err);
    status.textContent = "Server error. Try again.";
  }
}
