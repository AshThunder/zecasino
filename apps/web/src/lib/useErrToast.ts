"use client";
import { useEffect } from "react";
import { toast } from "./toast";
const nice = (e: string) => e === "insufficient balance" ? "Not enough balance for that stake. Top up in the Cashier." : e.charAt(0).toUpperCase() + e.slice(1) + (/[.!?]$/.test(e) ? "" : ".");
/** Table errors go to the toast stack instead of sitting on the felt. */
export function useErrToast(err: string | null | undefined, title = "Couldn't place that") { useEffect(() => { if (err) toast({ kind: "error", title, body: nice(err) }); }, [err, title]); }
