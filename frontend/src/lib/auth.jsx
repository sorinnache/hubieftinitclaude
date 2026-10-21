import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = se încarcă, null = neautentificat

  useEffect(() => {
    api("/auth/me").then(setUser).catch(() => setUser(null));
    const h = () => setUser(null);
    window.addEventListener("hub:unauthorized", h);
    return () => window.removeEventListener("hub:unauthorized", h);
  }, []);

  const login = async (email, password) => {
    const { user } = await api("/auth/login", { method: "POST", body: { email, password } });
    setUser(user);
  };
  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  };
  return <AuthCtx.Provider value={{ user, login, logout, isAdmin: user?.role === "admin" }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
