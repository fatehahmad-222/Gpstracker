import "./globals.css";
import RootProviders from "@/components/providers/RootProviders";

export const metadata = {
  title: "Fleet Console",
  description:
    "Real-time employee GPS tracking and location-based task assignment.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

const themeInitScript = `(function(){try{var t=localStorage.getItem("fleet-console-theme");var dark=t?t==="dark":true;document.documentElement.classList.toggle("dark",dark);}catch(e){document.documentElement.classList.add("dark");}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-bg text-ink">
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
