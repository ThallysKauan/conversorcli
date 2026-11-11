import type { ReactNode } from "react";
import "@/styles/globals.scss";
export default function Layout({children}:{children:ReactNode}) { return <html lang="pt-BR"><body>{children}</body></html>; }
