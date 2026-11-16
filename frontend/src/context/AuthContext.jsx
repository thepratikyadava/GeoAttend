import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState
} from "react";

import { supabase } from "../lib/supabase";
import { apiFetch } from "../lib/api";


const AuthContext = createContext(null);

const DEMO_STORAGE_KEY = "geoattend_active_role_token";


export function AuthProvider({ children }) {

  const [session, setSession] = useState(null);

  const [profile, setProfile] = useState(null);

  const [institution, setInstitution] = useState(null);

  const [sessionLoading, setSessionLoading] = useState(true);

  const [profileLoading, setProfileLoading] = useState(false);

  const [authError, setAuthError] = useState(null);


  // Initialize and monitor authentication
  useEffect(() => {

    let active = true;

    async function initialize() {

      // 1. Check if an instant Admin/Student role session is stored
      const savedDemoToken = localStorage.getItem(DEMO_STORAGE_KEY);
      if (savedDemoToken) {
        if (active) {
          setSession({
            access_token: savedDemoToken,
            is_demo: true
          });
          setSessionLoading(false);
        }
        return;
      }

      if (!supabase) {
        if (active) {
          setSessionLoading(false);
        }
        return;
      }

      const { data, error } =
        await supabase.auth.getSession();

      if (!active) return;

      if (error) {
        setAuthError(error.message);
      }

      setSession(data?.session ?? null);

      setSessionLoading(false);

    }

    initialize();

    let subscription = null;
    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange(
        (_event, newSession) => {
          if (newSession) {
            localStorage.removeItem(DEMO_STORAGE_KEY);
            setSession(newSession);
          } else if (!localStorage.getItem(DEMO_STORAGE_KEY)) {
            setSession(null);
            setProfile(null);
            setInstitution(null);
            setAuthError(null);
          }
        }
      );
      subscription = data.subscription;
    }

    return () => {

      active = false;

      if (subscription) {
        subscription.unsubscribe();
      }

    };

  }, []);


  const fetchProfile = useCallback(async (accessToken) => {

    if (!accessToken) {
      setProfile(null);
      setInstitution(null);
      setProfileLoading(false);
      return null;
    }

    setProfileLoading(true);
    setAuthError(null);

    try {

      const result = await apiFetch(
        "/api/me",
        accessToken
      );

      setProfile(result.profile || null);
      setInstitution(result.institution || null);
      return result.profile;

    } catch (error) {

      setProfile(null);
      setInstitution(null);
      setAuthError(error.message);
      return null;

    } finally {

      setProfileLoading(false);

    }

  }, []);


  // Load authenticated user's database profile
  useEffect(() => {

    if (!session?.access_token) {
      setProfile(null);
      setInstitution(null);
      setProfileLoading(false);
      return;
    }

    fetchProfile(session.access_token);

  }, [session?.access_token, fetchProfile]);


  const refreshProfile = useCallback(async () => {
    if (!session?.access_token) return null;
    return fetchProfile(session.access_token);
  }, [session?.access_token, fetchProfile]);


  const loginWithRole = useCallback(async (role) => {
    const token =
      role === "admin" ? "demo-admin-token" : "demo-student-token";
    localStorage.setItem(DEMO_STORAGE_KEY, token);
    const demoSession = {
      access_token: token,
      is_demo: true
    };
    setSession(demoSession);
    return fetchProfile(token);
  }, [fetchProfile]);


  const switchRole = useCallback(async (targetRole) => {
    if (!session?.access_token) return null;

    if (session.is_demo) {
      return loginWithRole(targetRole);
    }

    await apiFetch("/api/me/role", session.access_token, {
      method: "POST",
      body: JSON.stringify({ role: targetRole })
    });

    return fetchProfile(session.access_token);
  }, [session, loginWithRole, fetchProfile]);


  async function signOut() {

    localStorage.removeItem(DEMO_STORAGE_KEY);

    if (supabase && !session?.is_demo) {
      await supabase.auth.signOut().catch(() => {});
    }

    setProfile(null);
    setInstitution(null);
    setSession(null);
    setAuthError(null);

  }


  const value = {

    session,
    profile,
    institution,

    loading: sessionLoading ||
      (!!session && profileLoading),

    authError,

    refreshProfile,
    loginWithRole,
    switchRole,
    signOut

  };


  return (

    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>

  );

}


export function useAuth() {

  const context = useContext(AuthContext);

  if (!context) {

    throw new Error(
      "useAuth must be used inside AuthProvider"
    );

  }

  return context;

}
