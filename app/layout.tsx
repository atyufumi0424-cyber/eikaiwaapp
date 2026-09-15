import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./logo.css";
import "./features.css";
import RegisterServiceWorker from "./register-service-worker";
export const metadata: Metadata={title:"SpeakUp! AI英会話",description:"会話から苦手を見つけ、復習テストまでできるAI英会話アプリ",manifest:"/manifest.webmanifest",icons:{icon:"/speakup-favicon.png",apple:"/speakup-apple-touch-icon.png"}};
export const viewport: Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#4421a8"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ja"><body>{children}<RegisterServiceWorker /></body></html>}
