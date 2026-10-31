import { Hono } from "hono";
import { authValidator } from "../validators/authValidator.js";
import { getUser, login, logout, register } from "../database/auth.js";
import { requireAuth } from "../middleware/auth.js";

const auth = new Hono({
  strict: false,
});

function authErrorStatus(error: unknown): 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = error.status;
    if (
      status === 400 || status === 401 || status === 403 || status === 404 ||
      status === 409 || status === 422 || status === 429 || status === 500 ||
      status === 502 || status === 503
    ) {
      return status;
    }
  }
  return 500;
}

auth.post("/register", authValidator, async (c) => {
  const { email, password } = c.req.valid("json");

  try {
    const sb = c.get("supabase");
    const user = await register(sb, email, password);
    return c.json({ user }, 201);
  } catch (error) {
    const status = authErrorStatus(error);
    return c.json({ message: status < 500 ? "Could not create account" : "Could not register" }, status);
  }
});

auth.post("/login", authValidator, async (c) => {
  const { email, password } = c.req.valid("json");

  try {
    const sb = c.get("supabase");
    const user = await login(sb, email, password);
    return c.json({ user }, 200);
  } catch (error) {
    const status = authErrorStatus(error);
    const responseStatus = status === 400 ? 401 : status;
    return c.json(
      { message: responseStatus === 401 ? "Invalid credentials" : "Could not log in" },
      responseStatus,
    );
  }
});

auth.post("/logout", async (c) => {
  try {
    await logout(c.get("supabase"));
    return c.json({ message: "Logged out" }, 200);
  } catch {
    return c.json({ message: "Could not log out" }, 500);
  }
});

auth.get("/me", requireAuth, async (c) => {
  const sb = c.get("supabase");
  try {

    const user = await getUser(sb);
    return c.json({ user }, 200);
  } catch {
    return c.json(
      {
        message: "Error in getting user",
      },
      500,
    );
  }
});

export default auth;
