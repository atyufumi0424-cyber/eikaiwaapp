import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata={title:"SpeakUp! AI英会話",description:"会話から苦手を見つけ、復習テストまでできるAI英会話アプリ",manifest:"/manifest.webmanifest",icons:{icon:"/favicon.svg"}};
export const viewport: Viewport={width:"device-width",initialScale:1,themeColor:"#5b5bd6"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ja"><body>{children}</body></html>}
