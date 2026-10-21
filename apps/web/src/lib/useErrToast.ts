"use client";
import { useEffect } from "react";
import { toast } from "./toast";
import { explain } from "./errors";
/** Table errors go to the toast stack: the concrete reason is the title, the fix is the body, actions sit underneath. */
export function useErrToast(err: string | null | undefined) { useEffect(() => { if (err) toast({ kind: "error", ...explain(err) }); }, [err]); }
