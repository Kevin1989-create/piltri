"use client";

import { useEffect } from "react";

/** On every page: once someone has signed in on this browser, their saves
 *  follow the account (lib/account.ts). The account code only loads when
 *  a session is stored, so pages stay as light as before for everyone
 *  else. */
export function AccountSync() {
  useEffect(() => {
    try {
      if (!window.localStorage.getItem("piltri:auth")) return;
    } catch {
      return;
    }
    import("@/lib/account").then((m) => m.startAccountSync()).catch(() => {});
  }, []);
  return null;
}
