import { Hono } from "hono";
import { authValidator } from "../validators/authValidator.js";
import { getUser, login, logout, register } from "../database/auth.js";
import { requireAuth } from "../middleware/auth.js";

const auth = new Hono({
  strict: false,
});

auth.post("/register", authValidator, async (c) => {
  const { email, password } = c.req.valid("json");

  try {
    const sb = c.get("supabase");
    const user = await register(sb, email, password);
    return c.json({ user }, 201);
  } catch (e: any) {
    return c.json(
      {
        message: e?.message,
      },
      400,
    );
  }
});

auth.post("/login", authValidator, async (c) => {
  const { email, password } = c.req.valid("json");

  try {
    const sb = c.get("supabase");
    const user = await login(sb, email, password);
    return c.json({ user }, 200);
  } catch {
    return c.json(
      {
        message: "Invalid credentials",
      },
      400,
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
