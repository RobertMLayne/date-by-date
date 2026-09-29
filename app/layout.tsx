import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"Date-By-Date · One connection at a time",description:"Intentional dating with transparent queues and room for a real connection.",icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>;}
