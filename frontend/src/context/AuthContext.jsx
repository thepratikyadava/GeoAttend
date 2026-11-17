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


export function AuthProvider({ children }) {

  const [session, setSession] = useState(null);

  const [profile, setProfile] = useState(null);

  const [institution, setInstitution] = useState(null);

  const [sessionLoading, setSessionLoading] = useState(true);

  const [profileLoading, setProfileLoading] = useState(false);

  const [authError, setAuthError] = useState(null);


  // Initialize and monitor Supabase authentication
  useEffect(() => {

    let active = true;

    if (!supabase) {
      setAuthError("Supabase client is not configured. Check your frontend environment variables.");
      setSessionLoading(false);
      return;
    }

    async function initialize() {

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

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {

        setSession(newSession);

        if (!newSession) {
          setProfile(null);
          setInstitution(null);
          setAuthError(null);
        }

      }
    );

    return () => {

      active = false;

      subscription.unsubscribe();

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


  async function signOut() {

    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
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
