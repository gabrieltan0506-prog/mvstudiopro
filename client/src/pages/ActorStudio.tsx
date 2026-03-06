import React, { useEffect, useState } from "react";
import ActorStudioShell from "../components/ActorStudioShell";
import { getMe } from "../lib/auth";

export default function ActorStudioPage() {
  const [email, setEmail] = useState("");

  useEffect(() => {
    let alive = true;
    getMe()
      .then((j) => {
        if (!alive) return;
        const userEmail = String(j?.user?.email || "");
        setEmail(userEmail);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return <ActorStudioShell userEmail={email} />;
}
