import { useEffect, useState } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App";
import { useConfigStore } from "@/store/configStore";
import { useAuthStore } from "@/store/authStore";
import { useMissionStore } from "@/store/missionStore";
import { VerificationGate } from "@/components/auth/VerificationGate";

export function AppWrapper() {
  const { selfHosted, googleClientId, loaded, fetchConfig } = useConfigStore();
  const { needsVerification, token } = useAuthStore();

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Anyone who can save missions starts on the list of saved missions; the
  // editor opens once a mission is picked or a new one is started. Guests have
  // nothing saved, so they go straight to the editor. Decided before the first
  // render so the editor (and its map) never flashes up first.
  const [startPageChosen, setStartPageChosen] = useState(false);
  useEffect(() => {
    if (!loaded || startPageChosen) return;
    const canSave =
      useConfigStore.getState().singleUser ||
      !!localStorage.getItem("droneroute_token");
    if (window.location.pathname === "/" && canSave) {
      useMissionStore.getState().setCurrentPage("routes");
    }
    setStartPageChosen(true);
  }, [loaded, startPageChosen]);

  if (!loaded || !startPageChosen) {
    return null;
  }

  const showVerificationGate = !selfHosted && token && needsVerification;

  // In cloud mode, wrap with GoogleOAuthProvider
  if (!selfHosted && googleClientId) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        <App />
        {showVerificationGate && <VerificationGate />}
      </GoogleOAuthProvider>
    );
  }

  return (
    <>
      <App />
      {showVerificationGate && <VerificationGate />}
    </>
  );
}
