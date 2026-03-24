import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Next.js Fullstack Demo — DaoFlow",
  description:
    "A full-stack Next.js app with Better Auth, Postgres, and Inngest — deployed via DaoFlow."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: "Inter, system-ui, sans-serif",
          background: "#0a0a0f",
          color: "#e4e4e7",
          minHeight: "100vh"
        }}
      >
        {children}
      </body>
    </html>
  );
}
