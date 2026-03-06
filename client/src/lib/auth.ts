export async function getMe() {
  const r = await fetch("/api/auth/me", { credentials: "include" });
  return r.json();
}

export async function login(email: string, password: string) {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  return r.json();
}

export async function logout() {
  const r = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include"
  });
  return r.json();
}
