import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
  getMe,
} from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await getMe());
    } catch {
      setUser(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (username, password) => {
    const me = await apiLogin(username, password);
    setUser(me);
    return me;
  };

  // data: { username, password, name, phone, address, idPhoto, selfie, consent }
  const signup = async (data) => {
    const me = await apiSignup(data);
    setUser(me);
    return me;
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch {
      /* clear locally regardless */
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, signup, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
